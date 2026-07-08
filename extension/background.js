// SEOSONA SRT Studio — background service worker
// Vai trò: điều phối tab provider, chuyển job từ side panel -> content script,
// nhận kết quả từ content script -> lưu storage.session + broadcast cho UI.

const PROVIDERS = {
  chatgpt: {
    label: 'ChatGPT',
    baseUrl: 'https://chatgpt.com/',
    match: ['*://chatgpt.com/*'],
    scripts: ['content/common.js', 'content/chatgpt.js'],
  },
  gemini: {
    label: 'Gemini',
    baseUrl: 'https://gemini.google.com/app',
    match: ['*://gemini.google.com/*'],
    scripts: ['content/common.js', 'content/gemini.js'],
  },
  grok: {
    label: 'Grok',
    baseUrl: 'https://grok.com/',
    match: ['https://grok.com/*', 'https://*.grok.com/*'],
    scripts: ['content/common.js', 'content/grok.js'],
  },
  claude: {
    label: 'Claude',
    baseUrl: 'https://claude.ai/new',
    match: ['https://claude.ai/*'],
    scripts: ['content/common.js', 'content/claude.js'],
  },
};

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// ---------------------------------------------------------------- context menu (audit/rewrite nhanh)
// Bôi đen văn bản trên bất kỳ trang nào -> chuột phải -> chọn action.
// Lưu "pending" vào storage.local rồi mở side panel; side panel tự nạp + chạy.
const QUICK_MENU = [
  { id: 'quick_audit', title: '🔍 Audit nhanh' },
  { id: 'quick_rewrite', title: '✍️ Viết lại hay hơn' },
  { id: 'quick_grammar', title: '✅ Sửa ngữ pháp' },
  { id: 'quick_shorten', title: '✂️ Rút gọn' },
  { id: 'quick_expand', title: '➕ Mở rộng' },
  { id: 'quick_ab', title: '🔀 Tạo A/B' },
];
function buildContextMenus() {
  if (!chrome.contextMenus) return;
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'seosona_root', title: 'SEOSONA Content', contexts: ['selection'] });
    for (const m of QUICK_MENU) {
      chrome.contextMenus.create({ id: m.id, parentId: 'seosona_root', title: m.title, contexts: ['selection'] });
    }
  });
}
chrome.runtime.onInstalled.addListener(buildContextMenus);
chrome.runtime.onStartup && chrome.runtime.onStartup.addListener(buildContextMenus);

if (chrome.contextMenus && chrome.contextMenus.onClicked) {
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    const text = (info.selectionText || '').trim();
    if (!text || !info.menuItemId || info.menuItemId === 'seosona_root') return;
    try {
      await chrome.storage.local.set({ srtQuickPending: { action: info.menuItemId, text, ts: Date.now() } });
    } catch (_) {}
    try {
      if (tab && tab.windowId != null) await chrome.sidePanel.open({ windowId: tab.windowId });
    } catch (_) {}
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- job store
// Job state được lưu ở storage.session để side panel đóng/mở lại vẫn thấy.
async function setJob(jobId, patch) {
  const { srtJobs = {} } = await chrome.storage.session.get('srtJobs');
  srtJobs[jobId] = Object.assign({}, srtJobs[jobId], patch);
  await chrome.storage.session.set({ srtJobs });
  return srtJobs[jobId];
}

function broadcast(payload) {
  chrome.runtime.sendMessage(payload).catch(() => {});
}

// ---------------------------------------------------------------- tab utils
async function findProviderTab(provider) {
  const tabs = await chrome.tabs.query({ url: PROVIDERS[provider].match });
  return tabs[0] || null;
}

function waitTabComplete(tabId, timeout = 45000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const timer = setInterval(async () => {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === 'complete' || Date.now() - t0 > timeout) {
          clearInterval(timer);
          resolve(tab);
        }
      } catch (e) {
        clearInterval(timer);
        resolve(null);
      }
    }, 400);
  });
}

async function pingContent(tabId, provider, { tries = 30, gap = 500 } = {}) {
  let reinjected = false;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await chrome.tabs.sendMessage(tabId, { action: 'srt:ping' });
      if (r && r.ok) return true;
    } catch (e) {
      // Tab load xong nhưng content script chưa có (vd extension vừa reload) -> inject lại 1 lần
      if (!reinjected && i >= 4) {
        reinjected = true;
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: PROVIDERS[provider].scripts,
          });
        } catch (_) {}
      }
    }
    await sleep(gap);
  }
  throw new Error('Content script chưa sẵn sàng — hãy tải lại tab ' + PROVIDERS[provider].label);
}

// freshChat=true -> mở hội thoại mới (baseUrl). freshChat=false + chatUrl ->
// nối tiếp đúng cuộc chat cũ (điều hướng tab tới chatUrl nếu chưa ở đó).
async function ensureProviderTab(provider, { freshChat = false, chatUrl = null } = {}) {
  let tab = await findProviderTab(provider);
  const continueUrl = (!freshChat && chatUrl) ? chatUrl : null;
  if (!tab) {
    tab = await chrome.tabs.create({ url: continueUrl || PROVIDERS[provider].baseUrl, active: true });
    await waitTabComplete(tab.id);
    await sleep(600);
  } else if (freshChat) {
    await chrome.tabs.update(tab.id, { url: PROVIDERS[provider].baseUrl });
    await waitTabComplete(tab.id);
    await sleep(800);
  } else if (continueUrl && !String(tab.url || '').startsWith(continueUrl.split('?')[0])) {
    await chrome.tabs.update(tab.id, { url: continueUrl });
    await waitTabComplete(tab.id);
    await sleep(800);
  }
  await pingContent(tab.id, provider);
  return tab;
}

// ---------------------------------------------------------------- handlers
async function handleRunJob({ jobId, provider, text, timeout, freshChat, chatUrl }) {
  if (!PROVIDERS[provider]) return { ok: false, error: 'Provider không hợp lệ: ' + provider };
  try {
    await setJob(jobId, { provider, status: 'preparing', startedAt: Date.now() });
    broadcast({ action: 'srt:jobUpdate', jobId, provider, status: 'preparing' });

    const tab = await ensureProviderTab(provider, { freshChat, chatUrl });

    // Tab phải active để tránh Chrome throttle timer/rAF của trang nền
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    await sleep(500);

    const ack = await chrome.tabs.sendMessage(tab.id, {
      action: 'srt:submitAndWait',
      jobId,
      text,
      timeout: timeout || 600000,
    });
    if (!ack || !ack.accepted) throw new Error('Content script từ chối job');

    // Lưu spec để auto-retry khi lỗi tạm thời
    await setJob(jobId, { status: 'running', tabId: tab.id, spec: { text, timeout: timeout || 600000 }, attempt: 0, maxRetries: 2 });
    broadcast({ action: 'srt:jobUpdate', jobId, provider, status: 'running', tabId: tab.id });
    return { ok: true, tabId: tab.id };
  } catch (e) {
    const error = String((e && e.message) || e);
    await setJob(jobId, { status: 'error', result: { success: false, error } });
    broadcast({ action: 'srt:jobUpdate', jobId, provider, status: 'error', result: { success: false, error } });
    return { ok: false, error };
  }
}

// Lỗi tạm thời -> đáng thử lại. Lỗi do đăng nhập/nội dung/hủy -> không.
const RETRYABLE_ERRORS = new Set(['NO_RESPONSE_STARTED', 'NO_RESPONSE', 'TIMEOUT', 'NETWORK', 'EXCEPTION']);

async function maybeRetry(jobId, provider, result) {
  const err = result && result.error;
  if (!RETRYABLE_ERRORS.has(err)) return false;
  const { srtJobs = {} } = await chrome.storage.session.get('srtJobs');
  const job = srtJobs[jobId];
  if (!job || !job.spec) return false;
  const attempt = (job.attempt || 0) + 1;
  const max = job.maxRetries || 2;
  if (attempt > max) return false;

  await setJob(jobId, { attempt, status: 'running' });
  broadcast({ action: 'srt:jobUpdate', jobId, provider, status: 'running', result: { retrying: true, attempt, message: `Thử lại ${attempt}/${max}…` } });
  await sleep(3000 * attempt); // backoff: 3s, 6s

  try {
    const tab = await ensureProviderTab(provider, {});
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    await sleep(400);
    const ack = await chrome.tabs.sendMessage(tab.id, {
      action: 'srt:submitAndWait', jobId, text: job.spec.text, timeout: job.spec.timeout,
    });
    if (!ack || !ack.accepted) throw new Error('reject');
    await setJob(jobId, { tabId: tab.id });
    return true;
  } catch (_) {
    return false; // không retry được -> để finalize thành lỗi
  }
}

async function handleJobResult({ jobId, provider, result }) {
  const success = result && result.success;
  if (!success && jobId) {
    const retried = await maybeRetry(jobId, provider, result);
    if (retried) return; // đang thử lại, chưa chốt kết quả
  }
  const status = success ? 'done' : 'error';
  await setJob(jobId, { status, result, finishedAt: Date.now() });
  broadcast({ action: 'srt:jobUpdate', jobId, provider, status, result });
  notifyDone(jobId, provider, status, result);
}

// Thông báo hệ thống khi job xong — hữu ích khi user đang ở tab khác.
function notifyDone(jobId, provider, status, result) {
  try {
    const label = (PROVIDERS[provider] && PROVIDERS[provider].label) || provider || '';
    let kind = jobId && jobId.startsWith('review_') ? 'Đánh giá'
      : jobId && jobId.startsWith('meta_') ? 'Metadata' : 'Phân tích';
    const title = status === 'done' ? `✅ ${kind} xong — ${label}` : `⚠ ${kind} lỗi — ${label}`;
    const message = status === 'done'
      ? (result && result.text ? result.text.slice(0, 120) : 'Hoàn tất.')
      : (result && (result.message || result.error)) || 'Có lỗi xảy ra.';
    chrome.notifications.create(`srt_${jobId}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title,
      message,
      priority: 0,
    }, () => void chrome.runtime.lastError);
  } catch (_) {}
}

// Mở lại đúng cuộc chat AI đã dùng (nhảy tab provider tới URL đã lưu)
async function handleOpenChat({ provider, url }) {
  if (!url) return { ok: false, error: 'Không có link chat' };
  try {
    let tab = provider ? await findProviderTab(provider) : null;
    if (tab) {
      await chrome.tabs.update(tab.id, { url, active: true });
      await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    } else {
      await chrome.tabs.create({ url, active: true });
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

async function handleAbort({ jobId }) {
  const { srtJobs = {} } = await chrome.storage.session.get('srtJobs');
  const job = srtJobs[jobId];
  if (job && job.tabId) {
    try { await chrome.tabs.sendMessage(job.tabId, { action: 'srt:abort' }); } catch (_) {}
  }
  await setJob(jobId, { status: 'aborted' });
  broadcast({ action: 'srt:jobUpdate', jobId, provider: job && job.provider, status: 'aborted' });
  return { ok: true };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.action) return;
  if (msg.action === 'srt:runJob') {
    handleRunJob(msg).then(sendResponse);
    return true;
  }
  if (msg.action === 'srt:jobResult') {
    handleJobResult(msg);
    sendResponse({ ok: true });
    return;
  }
  if (msg.action === 'srt:abortJob') {
    handleAbort(msg).then(sendResponse);
    return true;
  }
  if (msg.action === 'srt:openChat') {
    handleOpenChat(msg).then(sendResponse);
    return true;
  }
  if (msg.action === 'srt:listProviders') {
    sendResponse(Object.fromEntries(Object.entries(PROVIDERS).map(([k, v]) => [k, v.label])));
    return;
  }
});

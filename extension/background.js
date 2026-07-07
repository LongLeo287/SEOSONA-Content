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

async function ensureProviderTab(provider, { freshChat = false } = {}) {
  let tab = await findProviderTab(provider);
  if (!tab) {
    tab = await chrome.tabs.create({ url: PROVIDERS[provider].baseUrl, active: true });
    await waitTabComplete(tab.id);
  } else if (freshChat) {
    await chrome.tabs.update(tab.id, { url: PROVIDERS[provider].baseUrl });
    await waitTabComplete(tab.id);
    await sleep(800);
  }
  await pingContent(tab.id, provider);
  return tab;
}

// ---------------------------------------------------------------- handlers
async function handleRunJob({ jobId, provider, text, timeout, freshChat }) {
  if (!PROVIDERS[provider]) return { ok: false, error: 'Provider không hợp lệ: ' + provider };
  try {
    await setJob(jobId, { provider, status: 'preparing', startedAt: Date.now() });
    broadcast({ action: 'srt:jobUpdate', jobId, provider, status: 'preparing' });

    const tab = await ensureProviderTab(provider, { freshChat });

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

    await setJob(jobId, { status: 'running', tabId: tab.id });
    broadcast({ action: 'srt:jobUpdate', jobId, provider, status: 'running', tabId: tab.id });
    return { ok: true, tabId: tab.id };
  } catch (e) {
    const error = String((e && e.message) || e);
    await setJob(jobId, { status: 'error', result: { success: false, error } });
    broadcast({ action: 'srt:jobUpdate', jobId, provider, status: 'error', result: { success: false, error } });
    return { ok: false, error };
  }
}

async function handleJobResult({ jobId, provider, result }) {
  const status = result && result.success ? 'done' : 'error';
  await setJob(jobId, { status, result, finishedAt: Date.now() });
  broadcast({ action: 'srt:jobUpdate', jobId, provider, status, result });
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
  if (msg.action === 'srt:listProviders') {
    sendResponse(Object.fromEntries(Object.entries(PROVIDERS).map(([k, v]) => [k, v.label])));
    return;
  }
});

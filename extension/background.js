// SEOSONA SRT Studio — background service worker
// Vai trò: điều phối tab provider, chuyển job từ side panel -> content script,
// nhận kết quả từ content script -> lưu storage.session + broadcast cho UI.

importScripts(
  'lib/provider-registry.js', 'lib/browser-provider-adapter.js',
  'lib/runtime-client.js', 'lib/context-actions.js',
  'lib/facebook-factory.js', 'lib/facebook-batch.js', 'lib/facebook-state.js',
  'lib/facebook-provider-lease.js', 'lib/facebook-orchestrator.js',
);

// Danh mục provider đã dọn sang lib/provider-registry.js để Runtime và test dùng chung
// đúng một nguồn. Ở đây chỉ còn phần cần Chrome thật.
const providerInfo = (provider) => BrowserProviderRegistry.get(provider);

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

    // Dựng payload NGAY, để nếu có gì sai (chưa chọn dự án, trang không hỗ trợ, đoạn quá dài)
    // thì side panel mở ra đã biết vì sao — thay vì để người dùng bấm chạy rồi mới báo lỗi.
    let pending;
    try {
      const { seosonaProjectId } = await chrome.storage.local.get('seosonaProjectId');
      pending = {
        payload: ContextActions.buildContextActionPayload({
          action: info.menuItemId,
          selectionText: text,
          pageUrl: (tab && tab.url) || info.pageUrl,
          pageTitle: (tab && tab.title) || '',
          projectId: seosonaProjectId || null,
        }),
        error: null,
        ts: Date.now(),
      };
    } catch (error) {
      pending = { payload: null, error: { code: error.code || 'CONTEXT_ACTION_FAILED', message: error.message }, ts: Date.now() };
    }

    // Chỉ lưu một THAM CHIẾU tạm cho giao diện. Đây không phải kho nội dung thứ hai:
    // bản ghi chính thức do Runtime tạo khi hành động thật sự chạy.
    try { await chrome.storage.session.set({ seosonaPendingAction: pending }); } catch (_) {}
    try { if (tab && tab.windowId != null) await chrome.sidePanel.open({ windowId: tab.windowId }); } catch (_) {}
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
  const tabs = await chrome.tabs.query({ url: providerInfo(provider).match });
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
            files: providerInfo(provider).scripts,
          });
        } catch (_) {}
      }
    }
    await sleep(gap);
  }
  throw new Error('Content script chưa sẵn sàng — hãy tải lại tab ' + providerInfo(provider).label);
}

// freshChat=true -> mở hội thoại mới (baseUrl). freshChat=false + chatUrl ->
// nối tiếp đúng cuộc chat cũ (điều hướng tab tới chatUrl nếu chưa ở đó).
async function ensureProviderTab(provider, { freshChat = false, chatUrl = null } = {}) {
  let tab = await findProviderTab(provider);
  const continueUrl = (!freshChat && chatUrl) ? chatUrl : null;
  if (!tab) {
    tab = await chrome.tabs.create({ url: continueUrl || providerInfo(provider).baseUrl, active: true });
    await waitTabComplete(tab.id);
    await sleep(600);
  } else if (freshChat) {
    await chrome.tabs.update(tab.id, { url: providerInfo(provider).baseUrl });
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

async function getJob(jobId) {
  const { srtJobs = {} } = await chrome.storage.session.get('srtJobs');
  return srtJobs[jobId] || null;
}

// ---------------------------------------------------------------- bộ điều hợp provider
// Toàn bộ chính sách chạy job (chuẩn bị tab -> gửi prompt -> lease -> thử lại -> huỷ) nằm
// trong lib/browser-provider-adapter.js và được test độc lập với Chrome. Ở đây chỉ nối
// những phụ thuộc THẬT vào: tab, message, storage, thông báo.
const browserProvider = BrowserProviderAdapter.create({
  registry: BrowserProviderRegistry,
  ensureProviderTab,
  focusTab: async (tab) => {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
  },
  sendMessage: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
  jobStore: { get: getJob, set: setJob },
  broadcast,
  sleep,
  now: () => Date.now(),
});

// ---------------------------------------------------------------- cầu nối Local Runtime
// Extension làm worker cho Runtime: hỏi job, chạy, trả kết quả. Token CHỈ nằm ở
// storage.session (mất khi đóng Chrome) — không bao giờ ghi xuống storage.local.
const RUNTIME_POLL_ALARM = 'seosona-provider-bridge-poll';

async function readRuntimeConfig() {
  const [{ seosonaRuntime }, { seosonaRuntimeToken }] = await Promise.all([
    chrome.storage.local.get('seosonaRuntime'),
    chrome.storage.session.get('seosonaRuntimeToken'),
  ]);
  if (!seosonaRuntime || !seosonaRuntime.url || !seosonaRuntimeToken) return null;
  return { url: seosonaRuntime.url, token: seosonaRuntimeToken };
}

const runtimeBridge = BrowserProviderAdapter.createRuntimeBridgeClient({
  fetchImpl: (url, init) => fetch(url, init),
  readConfig: readRuntimeConfig,
  adapter: browserProvider,
  jobStore: {
    get: getJob,
    set: setJob,
    listActive: async () => {
      const { srtJobs = {} } = await chrome.storage.session.get('srtJobs');
      return Object.entries(srtJobs)
        .filter(([, job]) => ['preparing', 'running'].includes(job && job.status))
        .map(([jobId, job]) => Object.assign({ jobId }, job));
    },
  },
  newNonce: () => crypto.randomUUID().replace(/-/g, ''),
});

// Poll ngắn qua alarm thay vì giữ kết nối mở: MV3 tắt service worker bất cứ lúc nào, nên một
// kết nối "luôn mở" không phải thứ dựa vào được. Hàng đợi rỗng trả 204, một lượt hỏi rất rẻ.
async function runtimeBridgeTick() {
  await runtimeBridge.renewActive().catch(() => {});
  await runtimeBridge.pollOnce().catch(() => {});
}

async function setRuntimeBridge({ url, token, enabled }) {
  if (enabled === false) {
    await chrome.alarms.clear(RUNTIME_POLL_ALARM).catch(() => false);
    await chrome.storage.session.remove('seosonaRuntimeToken');
    return { ok: true, enabled: false };
  }
  if (!BrowserProviderAdapter.isLoopbackUrl(url)) {
    return { ok: false, error: 'Runtime URL phải là loopback (http://127.0.0.1:cổng).' };
  }
  await chrome.storage.local.set({ seosonaRuntime: { url: String(url).replace(/\/$/, '') } });
  await chrome.storage.session.set({ seosonaRuntimeToken: token });
  chrome.alarms.create(RUNTIME_POLL_ALARM, { periodInMinutes: 0.5 });
  return { ok: true, enabled: true };
}

// ---------------------------------------------------------------- client Local Runtime
// Đây là đường ĐI TỚI KHO DỮ LIỆU GỐC. Nó tách hẳn với cầu nối provider phía trên: cầu nối
// kia chỉ để lái tab AI, còn đường này mới là nơi bài viết được lưu.
const runtimeClient = RuntimeClient.create({
  fetchImpl: (url, init) => fetch(url, init),
  storage: {
    getLocal: (key) => chrome.storage.local.get(key),
    setLocal: (patch) => chrome.storage.local.set(patch),
    getSession: (key) => chrome.storage.session.get(key),
    setSession: (patch) => chrome.storage.session.set(patch),
  },
  readUrl: async () => {
    const { seosonaRuntime } = await chrome.storage.local.get('seosonaRuntime');
    return (seosonaRuntime && seosonaRuntime.url) || 'http://127.0.0.1:43118';
  },
  newNonce: () => crypto.randomUUID().replace(/-/g, ''),
});

// Runtime chưa bật là một TRẠNG THÁI, không phải sự cố. Giao diện cần phân biệt được
// "chưa ghép cặp", "Runtime chưa chạy" và "sẵn sàng" để nói đúng việc người dùng phải làm.
async function runtimeStatus() {
  if (!(await runtimeClient.isPaired())) return { state: 'NOT_PAIRED' };
  try {
    const health = await runtimeClient.health();
    return { state: 'READY', health };
  } catch (error) {
    return { state: error.code === 'RUNTIME_URL_INVALID' ? 'RUNTIME_URL_INVALID' : 'RUNTIME_OFFLINE', message: error.message };
  }
}

// Chạy một hành động ngữ cảnh qua Runtime. KHÔNG có đường dự phòng ghi vào một kho riêng:
// lưu tạm ở đâu đó rồi hy vọng đồng bộ sau sẽ tạo ra một tập nội dung thứ hai mà không ai
// biết bản nào đúng.
async function runContextAction(payload) {
  const projectId = payload.projectId;
  if (payload.runtimeKind === 'SOURCE') {
    return runtimeClient.request(`/v1/projects/${encodeURIComponent(projectId)}/sources`, {
      method: 'POST',
      body: {
        kind: 'note',
        title: payload.provenance.pageTitle || null,
        canonicalUrl: payload.provenance.pageUrl,
        bytesBase64: btoa(unescape(encodeURIComponent(payload.selectionText))),
      },
    });
  }
  if (payload.runtimeKind === 'EDIT' || payload.runtimeKind === 'AUDIT' || payload.runtimeKind === 'REPURPOSE') {
    // V1: hành động trên đoạn bôi đen chạy qua luồng viết của Runtime, với chính đoạn đó
    // làm nguồn. Runtime cấp contentId/revisionId — extension không tự đặt.
    return runtimeClient.request(`/v1/projects/${encodeURIComponent(projectId)}/write`, {
      method: 'POST',
      body: {
        jobType: 'article',
        brief: {
          objective: `Xử lý đoạn văn từ ${payload.provenance.pageUrl}`,
          intent: 'INFORMATIONAL',
          angle: payload.operation || payload.action,
        },
        contextSnapshotId: `contextsnapshot_${Date.now()}`,
        context: { evidenceById: {}, claimsById: {} },
        userInstruction: payload.selectionText,
      },
    });
  }
  throw new Error(`Unsupported runtime kind: ${payload.runtimeKind}`);
}

// ---------------------------------------------------------------- đọc/ghi trang theo yêu cầu
// context-editor.js được TIÊM TỪNG LẦN qua activeTab, không khai báo thường trú trong
// manifest. Nghĩa là extension chỉ chạm được vào trang khi người dùng vừa yêu cầu một hành
// động trên đúng tab đó — không có quyền đọc mọi trang họ mở.
async function withContextEditor(tabId, message) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content/context-editor.js'] });
  } catch (error) {
    return { ok: false, code: 'PAGE_NOT_ACCESSIBLE', message: String((error && error.message) || error) };
  }
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    return { ok: false, code: 'PAGE_NOT_ACCESSIBLE', message: String((error && error.message) || error) };
  }
}

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ? tab.id : null;
}

// ---------------------------------------------------------------- handlers
// Chữ ký cũ được giữ nguyên (jobId/provider/timeout, lỗi là chuỗi) vì Facebook orchestrator
// và side panel đang gọi đúng hình dạng này.
async function handleRunJob({ jobId, provider, text, timeout, freshChat, chatUrl, modelMatch }) {
  const result = await browserProvider.start({
    taskId: jobId, providerId: provider, text, timeoutMs: timeout, freshChat, chatUrl, modelMatch,
  });
  return result.ok ? result : { ok: false, error: result.error.message, code: result.error.code };
}

async function handleJobResult({ jobId, provider, result }) {
  const success = result && result.success;
  if (!success && jobId) {
    const retried = await browserProvider.retry(jobId, browserProvider.normalizeResult(result));
    if (retried) return { finalized: false }; // đang thử lại, chưa chốt kết quả
  }
  const status = success ? 'done' : 'error';
  await setJob(jobId, { status, result, finishedAt: Date.now() });
  broadcast({ action: 'srt:jobUpdate', jobId, provider, status, result });
  notifyDone(jobId, provider, status, result);
  // Job do Runtime giao thì trả kết quả về đó. Job của side panel thì client tự bỏ qua.
  await runtimeBridge.report(jobId, browserProvider.normalizeResult(result)).catch(() => {});
  return { finalized: true, status };
}

// Thông báo hệ thống khi job xong — hữu ích khi user đang ở tab khác.
function notifyDone(jobId, provider, status, result) {
  try {
    const label = (providerInfo(provider) && providerInfo(provider).label) || provider || '';
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
  return browserProvider.abort(jobId);
}

function facebookError(error) {
  const source = error && error.error || error || {};
  return {
    code: String(source.code || 'FACEBOOK_FACTORY_FAILED'),
    message: String(source.message || error && error.message || 'Facebook Content Factory failed.'),
    retryable: source.retryable === true,
  };
}

async function facebookConfig() {
  const [{ srtFacebookCompanion }, { srtFacebookCompanionToken }] = await Promise.all([
    chrome.storage.local.get('srtFacebookCompanion'),
    chrome.storage.session.get('srtFacebookCompanionToken'),
  ]);
  const url = String(srtFacebookCompanion && srtFacebookCompanion.url || '').replace(/\/$/, '');
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(?::\d+)?$/.test(url)) throw new Error('Companion URL must use local loopback.');
  if (!srtFacebookCompanionToken) throw new Error('Companion token is missing.');
  return { url, token: srtFacebookCompanionToken };
}

async function facebookCompanion(path, body) {
  const config = await facebookConfig();
  let response;
  try {
    response = await fetch(config.url + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: 'Bearer ' + config.token,
        'x-seosona-nonce': crypto.randomUUID().replace(/-/g, ''),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (cause) {
    const error = new Error('Content Companion is unavailable.');
    error.code = 'COMPANION_UNAVAILABLE'; error.retryable = true; error.cause = cause;
    throw error;
  }
  const value = await response.json().catch(() => ({}));
  if (!response.ok) {
    const normalized = facebookError(value);
    const error = new Error(normalized.message);
    Object.assign(error, normalized);
    throw error;
  }
  return value;
}

async function indexFacebookLibrary(batch) {
  const ready = (batch && batch.drafts || []).filter((draft) => draft.packageReceipt && draft.package && draft.package.parsed);
  if (!ready.length) return;
  const { srtLibrary = [] } = await chrome.storage.local.get('srtLibrary');
  for (const draft of ready) {
    const id = 'facebook:' + batch.id + '/' + draft.id;
    const parsed = draft.package.parsed;
    const assetRef = draft.receipt && draft.receipt.fileRef || draft.status;
    const packageRef = draft.packageReceipt.draftRef || '';
    const entry = {
      id,
      ts: Date.now(),
      type: 'Facebook',
      task: 'group-batch',
      title: 'Facebook ' + draft.id + ' — ' + parsed.idea,
      text: parsed.copy + '\n\nCTA: ' + parsed.cta + '\n\nAsset: ' + assetRef + '\nPackage: ' + packageRef,
    };
    const index = srtLibrary.findIndex((item) => item.id === id);
    if (index >= 0) srtLibrary[index] = entry; else srtLibrary.unshift(entry);
  }
  if (srtLibrary.length > 200) srtLibrary.length = 200;
  await chrome.storage.local.set({ srtLibrary });
}

const FACEBOOK_VISUAL_ALARM = 'seosona-facebook-visual-poll';
async function scheduleFacebookVisualPoll(batch) {
  const waiting = batch && batch.status === 'visuals_running' && batch.active && batch.active.kind === 'visual';
  if (waiting) chrome.alarms.create(FACEBOOK_VISUAL_ALARM, { delayInMinutes: 0.5 });
  else await chrome.alarms.clear(FACEBOOK_VISUAL_ALARM).catch(() => false);
}

const facebookOrchestrator = FacebookOrchestrator.createOrchestrator({
  load: async () => (await chrome.storage.local.get('srtFacebookBatchLast')).srtFacebookBatchLast || null,
  persist: async (batch) => chrome.storage.local.set({ srtFacebookBatchLast: batch }),
  emit: async (batch) => {
    await indexFacebookLibrary(batch);
    await scheduleFacebookVisualPoll(batch);
    broadcast({ action: 'facebook:batchUpdate', batch });
  },
  providerStart: handleRunJob,
  providerStatus: async (jobId) => {
    // Lease do adapter tính; ở đây chỉ bổ sung một điều adapter không biết: tab còn mở không.
    const job = await browserProvider.status(jobId);
    if (!job || !['preparing', 'running'].includes(job.status)) return job;
    if (job.tabId) {
      try { await chrome.tabs.get(job.tabId); } catch { return { ...job, status: 'stale', reason: 'provider_tab_closed' }; }
    }
    return job;
  },
  providerAbort: handleAbort,
  companion: facebookCompanion,
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm) return;
  if (alarm.name === RUNTIME_POLL_ALARM) { runtimeBridgeTick(); return; }
  if (alarm.name !== FACEBOOK_VISUAL_ALARM) return;
  facebookOrchestrator.resume().then(scheduleFacebookVisualPoll).catch((error) => {
    broadcast({ action: 'facebook:batchError', error: facebookError(error) });
  });
});

if (chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(() => {
    facebookOrchestrator.getState().then(scheduleFacebookVisualPoll).catch(() => {});
  });
}

async function handleFacebookAction(action, msg) {
  try {
    if (action === 'facebook:startBatch') return { ok: true, batch: await facebookOrchestrator.start({ requestedCount: msg.requestedCount, provider: msg.provider }) };
    if (action === 'facebook:getBatch') return { ok: true, batch: await facebookOrchestrator.getState() };
    if (action === 'facebook:resumeBatch') return { ok: true, batch: await facebookOrchestrator.resume() };
    if (action === 'facebook:cancelBatch') return { ok: true, batch: await facebookOrchestrator.cancel('user') };
    if (action === 'facebook:getHealth') return { ok: true, health: await facebookCompanion('/v1/health') };
    throw new Error('Unknown Facebook background action.');
  } catch (error) {
    return { ok: false, error: facebookError(error) };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.action) return;
  if (msg.action === 'srt:runJob') {
    handleRunJob(msg).then(sendResponse);
    return true;
  }
  if (msg.action === 'srt:jobResult') {
    handleJobResult(msg).then(async (outcome) => {
      if (outcome && outcome.finalized && msg.jobId && msg.jobId.startsWith('facebook_')) {
        try {
          await facebookOrchestrator.handleProviderResult({
            jobId: msg.jobId,
            success: msg.result && msg.result.success === true,
            text: msg.result && msg.result.text || '',
            error: msg.result && { code: msg.result.error || 'PROVIDER_ERROR', message: msg.result.message || msg.result.error || 'Provider failed.' },
          });
        } catch (error) {
          broadcast({ action: 'facebook:batchError', error: facebookError(error) });
        }
      }
      sendResponse({ ok: true });
    });
    return true;
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
    sendResponse(BrowserProviderRegistry.labels());
    return;
  }
  // Tên message chung, không dính SRT. Các tên `srt:*` phía trên là BÍ DANH của đúng
  // những hàm này và còn được giữ cho đến khi side panel di trú xong.
  if (msg.action === 'provider:runBrowserJob') {
    browserProvider.start(msg.task || msg).then(sendResponse);
    return true;
  }
  if (msg.action === 'provider:abortBrowserJob') {
    browserProvider.abort(msg.taskId || msg.jobId).then(sendResponse);
    return true;
  }
  if (msg.action === 'provider:getBrowserJob') {
    browserProvider.status(msg.taskId || msg.jobId).then((job) => sendResponse({ ok: true, job }));
    return true;
  }
  if (msg.action === 'provider:listBrowserProviders') {
    sendResponse({ ok: true, providers: BrowserProviderRegistry.list() });
    return;
  }
  if (msg.action === 'runtime:status') {
    runtimeStatus().then(sendResponse);
    return true;
  }
  if (msg.action === 'runtime:pair') {
    runtimeClient.pair(msg.code)
      .then((r) => sendResponse({ ok: true, ...r }))
      .catch((e) => sendResponse({ ok: false, error: { code: e.code, message: e.message } }));
    return true;
  }
  if (msg.action === 'runtime:forget') {
    runtimeClient.forget().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.action === 'runtime:listProjects') {
    runtimeClient.listProjects()
      .then((projects) => sendResponse({ ok: true, projects }))
      .catch((e) => sendResponse({ ok: false, error: { code: e.code, message: e.message } }));
    return true;
  }
  if (msg.action === 'runtime:runContextAction') {
    runContextAction(msg.payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((e) => sendResponse({ ok: false, error: { code: e.code || 'RUNTIME_ERROR', message: e.message } }));
    return true;
  }
  if (msg.action.startsWith('context:')) {
    // Áp dụng lên trang là một hành động RIÊNG, người dùng bấm sau khi đã xem bản đề xuất.
    // Không có đường nào ở đây tự chạy sau khi AI trả kết quả.
    activeTabId().then((tabId) => {
      if (tabId == null) return sendResponse({ ok: false, code: 'NO_ACTIVE_TAB' });
      return withContextEditor(tabId, msg).then(sendResponse);
    });
    return true;
  }
  if (msg.action === 'runtime:signal') {
    const payload = msg.payload || {};
    runtimeClient.request(`/v1/content/${encodeURIComponent(payload.contentId)}/signals`, { method: 'POST', body: payload })
      .then((signal) => sendResponse({ ok: true, signal }))
      .catch((e) => sendResponse({ ok: false, error: { code: e.code || 'RUNTIME_ERROR', message: e.message } }));
    return true;
  }
  if (msg.action === 'runtime:getPendingAction') {
    chrome.storage.session.get('seosonaPendingAction').then(({ seosonaPendingAction }) => {
      sendResponse({ ok: true, pending: seosonaPendingAction || null });
    });
    return true;
  }
  if (msg.action === 'provider:setRuntimeBridge') {
    setRuntimeBridge(msg).then(sendResponse);
    return true;
  }
  if (msg.action === 'provider:pollRuntimeBridge') {
    runtimeBridgeTick().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.action.startsWith('facebook:')) {
    handleFacebookAction(msg.action, msg).then(sendResponse);
    return true;
  }
});

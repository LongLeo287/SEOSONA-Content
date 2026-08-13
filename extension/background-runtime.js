// SEOSONA Content Runtime wrapper: preserves legacy background worker and layers generic provider execution on top.
importScripts(
  'lib/provider-registry.js',
  'lib/browser-provider-adapter.js',
  'lib/runtime-provider-bridge.js',
  'background.js'
);

const PROVIDER_BRIDGE_ALARM = 'seosona-provider-bridge-poll';
const PROVIDER_BRIDGE_STATE = 'seosonaRuntimeActiveProviderTask';

async function seosonaRuntimeConfig() {
  const [{ seosonaRuntime }, { seosonaRuntimeToken }] = await Promise.all([
    chrome.storage.local.get('seosonaRuntime'),
    chrome.storage.session.get('seosonaRuntimeToken'),
  ]);
  const url = String(seosonaRuntime && seosonaRuntime.url || 'http://127.0.0.1:43118').replace(/\/$/, '');
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(?::\d+)?$/.test(url)) throw new Error('Runtime URL must use local loopback.');
  if (!seosonaRuntimeToken || String(seosonaRuntimeToken).length < 32) return null;
  return { url, token: String(seosonaRuntimeToken) };
}

async function seosonaRuntimeRequest(method, path, body) {
  const config = await seosonaRuntimeConfig();
  if (!config) throw new Error('Runtime is not configured.');
  const response = await fetch(config.url + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + config.token,
      'x-seosona-nonce': crypto.randomUUID().replace(/-/g, ''),
      'x-seosona-bridge-owner': chrome.runtime.id,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (response.status === 204) return { status: 204, body: null };
  const value = await response.json().catch(() => ({}));
  if (!response.ok) {
    const source = value && value.error || {};
    const error = new Error(String(source.message || `Runtime HTTP ${response.status}.`));
    error.code = String(source.code || `HTTP_${response.status}`);
    error.retryable = source.retryable === true;
    throw error;
  }
  return { status: response.status, body: value };
}

const runtimeBrowserAdapter = BrowserProviderAdapter.create({
  registry: BrowserProviderRegistry,
  runPage: handleRunJob,
  abortPage: handleAbort,
  getJob: async (jobId) => {
    const { srtJobs = {} } = await chrome.storage.session.get('srtJobs');
    return srtJobs[jobId] || null;
  },
  now: () => Date.now(),
});

const runtimeProviderBridge = RuntimeProviderBridge.create({
  runtimeRequest: seosonaRuntimeRequest,
  adapter: runtimeBrowserAdapter,
  ownerId: chrome.runtime.id,
  stateStore: {
    get: async () => (await chrome.storage.session.get(PROVIDER_BRIDGE_STATE))[PROVIDER_BRIDGE_STATE] || null,
    set: async (value) => chrome.storage.session.set({ [PROVIDER_BRIDGE_STATE]: value }),
    clear: async () => chrome.storage.session.remove(PROVIDER_BRIDGE_STATE),
  },
});

async function pollRuntimeProviders() {
  const result = await runtimeProviderBridge.poll().catch(() => ({ status: 'runtime_unavailable' }));
  chrome.alarms.create(PROVIDER_BRIDGE_ALARM, { delayInMinutes: 0.5 });
  return result;
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm && alarm.name === PROVIDER_BRIDGE_ALARM) pollRuntimeProviders().catch(() => {});
});
chrome.runtime.onStartup && chrome.runtime.onStartup.addListener(() => pollRuntimeProviders().catch(() => {}));
chrome.runtime.onInstalled.addListener(() => pollRuntimeProviders().catch(() => {}));

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.action) return;
  if (msg.action === 'provider:runBrowserJob') { runtimeBrowserAdapter.start(msg.task).then(sendResponse, (error) => sendResponse({ ok: false, error: String(error && error.message || error) })); return true; }
  if (msg.action === 'provider:abortBrowserJob') { runtimeBrowserAdapter.abort(msg.taskId).then(sendResponse); return true; }
  if (msg.action === 'provider:getBrowserJob') { runtimeBrowserAdapter.status(msg.taskId).then((job) => sendResponse({ ok: true, job })); return true; }
  if (msg.action === 'provider:listBrowserProviders') { sendResponse({ ok: true, providers: BrowserProviderRegistry.list() }); return; }
  if (msg.action === 'provider:setRuntimeConfig') {
    const url = String(msg.url || 'http://127.0.0.1:43118').replace(/\/$/, '');
    if (!/^http:\/\/(127\.0\.0\.1|localhost)(?::\d+)?$/.test(url) || typeof msg.token !== 'string' || msg.token.length < 32) { sendResponse({ ok: false, error: 'Runtime URL/token is invalid.' }); return; }
    chrome.storage.local.set({ seosonaRuntime: { url } })
      .then(() => chrome.storage.session.set({ seosonaRuntimeToken: msg.token }))
      .then(() => pollRuntimeProviders())
      .then(() => sendResponse({ ok: true }), (error) => sendResponse({ ok: false, error: String(error && error.message || error) }));
    return true;
  }
});

pollRuntimeProviders().catch(() => {});

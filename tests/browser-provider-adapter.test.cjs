const test = require('node:test');
const assert = require('node:assert/strict');

const BrowserProviderRegistry = require('../extension/lib/provider-registry.js');
const { MODEL_CATALOG, ModelPicker } = require('../extension/lib/models.js');
const BrowserProviderAdapter = require('../extension/lib/browser-provider-adapter.js');

// ================================================================ Danh mục provider

test('the registry maps generic provider ids onto the existing page adapters', () => {
  assert.deepEqual(
    BrowserProviderRegistry.list().map((p) => p.providerId).sort(),
    ['chatgpt-web', 'claude-web', 'gemini-web', 'grok-web'],
  );
  for (const [providerId, page] of [
    ['chatgpt-web', 'chatgpt'], ['gemini-web', 'gemini'], ['claude-web', 'claude'], ['grok-web', 'grok'],
  ]) {
    assert.equal(BrowserProviderRegistry.get(providerId).page, page);
    assert.equal(BrowserProviderRegistry.providerIdOf(page), providerId);
    // Trong lúc di trú, tên cũ vẫn phải tra được — side panel còn đang gửi tên cũ.
    assert.equal(BrowserProviderRegistry.get(page).providerId, providerId);
  }
  assert.equal(BrowserProviderRegistry.get('nope'), null);
});

test('every provider still carries the host, scripts and matches the background needs', () => {
  for (const provider of BrowserProviderRegistry.list()) {
    assert.ok(provider.baseUrl.startsWith('https://'), `${provider.providerId} needs an https base url`);
    assert.ok(provider.match.length, `${provider.providerId} needs tab match patterns`);
    assert.ok(provider.scripts.includes('content/common.js'), `${provider.providerId} needs the shared engine`);
    assert.ok(provider.label);
  }
});

// Bày ô chọn model cho một hãng không đổi được model là nói dối người dùng.
// Test này khóa hai file lại với nhau để chúng không trôi khỏi nhau.
test('model switch support in the registry matches the model catalog exactly', () => {
  for (const provider of BrowserProviderRegistry.list()) {
    assert.equal(
      provider.supportsModelSwitch,
      ModelPicker.supports(provider.page),
      `${provider.providerId} disagrees with MODEL_CATALOG about model switching`,
    );
  }
  assert.equal(BrowserProviderRegistry.get('grok-web').supportsModelSwitch, false);
  assert.equal(MODEL_CATALOG.grok, undefined, 'grok has no reliable model switcher');
});

test('model selection answers to the generic provider id as well as the page name', () => {
  assert.deepEqual(ModelPicker.list('chatgpt-web'), ModelPicker.list('chatgpt'));
  assert.deepEqual(
    ModelPicker.matchTexts('gemini-web', 'auto', 'longform'),
    ModelPicker.matchTexts('gemini', 'auto', 'longform'),
  );
  assert.equal(ModelPicker.supports('grok-web'), false);
});

// ================================================================ Chuẩn hóa kết quả

const { normalizeBrowserResult } = BrowserProviderAdapter;

test('a successful run normalizes to COMPLETED and keeps its receipt metadata', () => {
  const normalized = normalizeBrowserResult({
    success: true, text: 'answer', modelState: 'Thinking', chatUrl: 'https://chatgpt.com/c/1', elapsedMs: 4200,
  });
  assert.equal(normalized.status, 'COMPLETED');
  assert.equal(normalized.code, 'COMPLETED');
  assert.equal(normalized.retryable, false);
  assert.equal(normalized.output, 'answer');
  assert.equal(normalized.modelState, 'Thinking');
  assert.equal(normalized.chatUrl, 'https://chatgpt.com/c/1');
  assert.equal(normalized.elapsedMs, 4200);
});

test('page level failures map onto the typed provider codes', () => {
  const cases = [
    ['PAGE_BLOCKED', 'AUTH_REQUIRED', false],
    ['EDITOR_NOT_FOUND', 'UI_CHANGED', false],
    ['INSERT_FAILED', 'UI_CHANGED', false],
    ['RATE_LIMIT', 'RATE_LIMITED', true],
    ['CONTENT_BLOCKED', 'CONTENT_BLOCKED', false],
    ['SUBMIT_LOST', 'SUBMIT_LOST', true],
    ['ABORTED', 'ABORTED', false],
    ['TIMEOUT', 'TIMEOUT', true],
    ['NO_RESPONSE_STARTED', 'TIMEOUT', true],
    ['NETWORK', 'TIMEOUT', true],
    ['EXCEPTION', 'PROVIDER_ERROR', true],
  ];
  for (const [raw, code, retryable] of cases) {
    const normalized = normalizeBrowserResult({ success: false, error: raw, message: 'm' });
    assert.equal(normalized.code, code, `${raw} should normalize to ${code}`);
    assert.equal(normalized.retryable, retryable, `${raw} retryable should be ${retryable}`);
    assert.equal(normalized.status, 'FAILED');
    assert.equal(normalized.rawCode, raw, 'the original page code is kept for diagnosis');
  }
});

// Một mã lỗi lạ mà bị nhét vào "TIMEOUT" sẽ ghi một nguyên nhân SAI vào biên nhận.
test('an unrecognised failure is reported as such instead of being mislabelled', () => {
  const normalized = normalizeBrowserResult({ success: false, error: 'SOMETHING_NEW' });
  assert.equal(normalized.code, 'PROVIDER_ERROR');
  assert.equal(normalized.rawCode, 'SOMETHING_NEW');
  assert.equal(normalizeBrowserResult(null).code, 'PROVIDER_ERROR', 'a missing result is a failure, not a success');
  assert.equal(normalizeBrowserResult(undefined).status, 'FAILED');
});

// Biên nhận không được mang prompt đầy đủ hay cookie — chỉ dấu vết đủ để chẩn đoán.
test('normalized results never carry credentials', () => {
  const normalized = normalizeBrowserResult({
    success: true, text: 'answer', cookie: 'session=1', apiKey: 'sk-live', authorization: 'Bearer x',
  });
  assert.deepEqual(
    Object.keys(normalized).filter((k) => /cookie|apikey|authorization|token/i.test(k)),
    [],
  );
});

// ================================================================ Bộ điều hợp

function harness({ ack = { accepted: true }, ensure } = {}) {
  const sent = [];
  const broadcasts = [];
  const jobs = new Map();
  let ms = 1_000_000;

  const adapter = BrowserProviderAdapter.create({
    registry: BrowserProviderRegistry,
    ensureProviderTab: ensure || (async () => ({ id: 7, windowId: 1 })),
    focusTab: async () => {},
    sendMessage: async (tabId, message) => { sent.push({ tabId, message }); return typeof ack === 'function' ? ack(message) : ack; },
    jobStore: {
      get: async (id) => jobs.get(id) || null,
      set: async (id, patch) => { jobs.set(id, Object.assign({}, jobs.get(id), patch)); return jobs.get(id); },
    },
    broadcast: (payload) => broadcasts.push(payload),
    sleep: async () => {},
    now: () => ms,
  });

  return { adapter, sent, broadcasts, jobs, advance: (d) => { ms += d; }, at: () => ms };
}

test('an unknown provider fails fast with a typed error and starts no work', async () => {
  const { adapter, sent, jobs } = harness();
  const result = await adapter.start({ taskId: 'task_1', providerId: 'bing-web', text: 'hi' });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'INVALID_PROVIDER');
  assert.equal(sent.length, 0, 'no tab is opened for a provider we cannot drive');
  assert.equal(jobs.size, 0);
});

test('a started job moves preparing then running and hands the page its prompt', async () => {
  const { adapter, sent, broadcasts, jobs } = harness();
  const result = await adapter.start({
    taskId: 'task_1', providerId: 'chatgpt-web', text: 'write this', timeoutMs: 60_000, modelMatch: ['thinking'],
  });

  assert.equal(result.ok, true);
  assert.equal(result.tabId, 7);
  assert.deepEqual(broadcasts.map((b) => b.status), ['preparing', 'running']);
  assert.equal(broadcasts[0].provider, 'chatgpt', 'the legacy page name is kept on the wire during migration');

  assert.equal(sent.length, 1);
  assert.equal(sent[0].message.text, 'write this');
  assert.equal(sent[0].message.timeout, 60_000);
  assert.deepEqual(sent[0].message.modelMatch, ['thinking']);

  const job = jobs.get('task_1');
  assert.equal(job.status, 'running');
  assert.equal(job.tabId, 7);
  assert.equal(job.providerId, 'chatgpt-web');
  assert.ok(job.spec, 'the spec is stored so a retry can repeat the exact request');
});

test('a content script that refuses the job leaves it in a typed error state', async () => {
  const { adapter, jobs, broadcasts } = harness({ ack: { accepted: false } });
  const result = await adapter.start({ taskId: 'task_1', providerId: 'gemini-web', text: 'x' });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'CONTENT_SCRIPT_UNAVAILABLE');
  assert.equal(jobs.get('task_1').status, 'error');
  assert.equal(broadcasts.at(-1).status, 'error');
});

test('a tab that cannot be opened is reported, not swallowed', async () => {
  const { adapter, jobs } = harness({ ensure: async () => { throw new Error('Content script chưa sẵn sàng'); } });
  const result = await adapter.start({ taskId: 'task_1', providerId: 'claude-web', text: 'x' });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'PROVIDER_TAB_FAILED');
  assert.match(result.error.message, /sẵn sàng/);
  assert.equal(jobs.get('task_1').status, 'error');
});

test('status reports the live job and flags a lease that has gone stale', async () => {
  const { adapter, advance } = harness();
  await adapter.start({ taskId: 'task_1', providerId: 'chatgpt-web', text: 'x', timeoutMs: 60_000 });
  assert.equal((await adapter.status('task_1')).status, 'running');

  advance(30_000);
  assert.equal((await adapter.status('task_1')).status, 'running', 'a job inside its lease is still live');

  // Chrome tắt service worker giữa chừng: không ai còn làm việc này nữa.
  // Quá hạn chờ (60s) cộng biên an toàn (60s) thì coi như mất người làm.
  advance(120_000);
  const stale = await adapter.status('task_1');
  assert.equal(stale.status, 'stale');
  assert.equal(stale.reason, 'lease_expired');
  assert.equal(await adapter.status('ghost'), null);
});

test('aborting tells the page to stop and marks the job aborted', async () => {
  const { adapter, sent, jobs, broadcasts } = harness();
  await adapter.start({ taskId: 'task_1', providerId: 'chatgpt-web', text: 'x' });
  const result = await adapter.abort('task_1');
  assert.equal(result.ok, true);
  assert.equal(sent.at(-1).message.action, 'srt:abort');
  assert.equal(sent.at(-1).tabId, 7);
  assert.equal(jobs.get('task_1').status, 'aborted');
  assert.equal(broadcasts.at(-1).status, 'aborted');
});

test('aborting a job whose tab is already gone still settles the job', async () => {
  const { adapter, jobs } = harness({
    ack: (message) => { if (message.action === 'srt:abort') throw new Error('No receiving end'); return { accepted: true }; },
  });
  await adapter.start({ taskId: 'task_1', providerId: 'chatgpt-web', text: 'x' });
  assert.equal((await adapter.abort('task_1')).ok, true);
  assert.equal(jobs.get('task_1').status, 'aborted');
});

// ---------------------------------------------------------------- thử lại

test('a transient failure is retried with the stored spec and backs off', async () => {
  const { adapter, sent } = harness();
  await adapter.start({ taskId: 'task_1', providerId: 'chatgpt-web', text: 'original', timeoutMs: 60_000 });
  const retried = await adapter.retry('task_1', normalizeBrowserResult({ success: false, error: 'TIMEOUT' }));
  assert.equal(retried, true);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].message.text, 'original', 'the retry repeats the exact request');
});

test('a permanent failure is never retried', async () => {
  const { adapter, sent } = harness();
  await adapter.start({ taskId: 'task_1', providerId: 'chatgpt-web', text: 'x' });
  for (const code of ['PAGE_BLOCKED', 'CONTENT_BLOCKED', 'ABORTED', 'EDITOR_NOT_FOUND']) {
    assert.equal(await adapter.retry('task_1', normalizeBrowserResult({ success: false, error: code })), false, code);
  }
  assert.equal(sent.length, 1, 'no extra attempt was made');
});

test('retries stop at the configured ceiling', async () => {
  const { adapter } = harness();
  await adapter.start({ taskId: 'task_1', providerId: 'chatgpt-web', text: 'x' });
  const transient = () => normalizeBrowserResult({ success: false, error: 'TIMEOUT' });
  assert.equal(await adapter.retry('task_1', transient()), true);
  assert.equal(await adapter.retry('task_1', transient()), true);
  assert.equal(await adapter.retry('task_1', transient()), false, 'the third retry is refused');
});

test('a retry that cannot reach the page gives up instead of looping', async () => {
  const { adapter } = harness({
    ack: (message) => { if (message.action === 'srt:submitAndWait' && message.retryOf) throw new Error('gone'); return { accepted: true }; },
  });
  await adapter.start({ taskId: 'task_1', providerId: 'chatgpt-web', text: 'x' });
  assert.equal(await adapter.retry('task_1', normalizeBrowserResult({ success: false, error: 'TIMEOUT' })), false);
});

// ================================================================ Content script

// Không chạy DOM thật trong node:test — kiểm ở mức hợp đồng: content script phải hiểu
// cả tên mới lẫn tên cũ, và phải vẫn trả về đúng những trường mà biên nhận cần.
test('the content script accepts generic provider messages alongside the legacy ones', () => {
  const common = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../extension/content/common.js'), 'utf8',
  );
  for (const alias of ['provider:ping', 'provider:abort', 'provider:submitAndWait']) {
    assert.ok(common.includes(alias), `${alias} must be understood`);
  }
  for (const legacy of ['srt:ping', 'srt:abort', 'srt:submitAndWait', 'srt:jobResult']) {
    assert.ok(common.includes(legacy), `${legacy} must keep working during migration`);
  }
  // Engine giữ nguyên: đây là những hàm không được viết lại trong bước đổi tên này.
  for (const engine of ['insertText', 'submitPrompt', 'selectModel', 'srtSelectorOverrides']) {
    assert.ok(common.includes(engine), `${engine} must survive the rename untouched`);
  }
  assert.match(common, /success: true, text: txt, elapsedMs, chatUrl: location\.href, modelState/);
});

// ================================================================ Cầu nối Runtime

const { createRuntimeBridgeClient, isLoopbackUrl } = BrowserProviderAdapter;

const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function runtimeHarness({ routes = {}, config = { url: 'http://127.0.0.1:43118', token: 'x'.repeat(40) } } = {}) {
  const calls = [];
  const jobs = new Map();
  const started = [];
  const aborted = [];

  const jobStore = {
    get: async (id) => jobs.get(id) || null,
    set: async (id, patch) => { jobs.set(id, Object.assign({ jobId: id }, jobs.get(id), patch)); return jobs.get(id); },
    listActive: async () => [...jobs.values()].filter((j) => ['preparing', 'running'].includes(j.status)),
  };

  const adapter = {
    start: async (task) => {
      started.push(task);
      await jobStore.set(task.taskId, { status: 'running' });
      return routes.start || { ok: true, tabId: 3 };
    },
    abort: async (id) => { aborted.push(id); await jobStore.set(id, { status: 'aborted' }); return { ok: true }; },
  };

  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: init && init.body ? JSON.parse(init.body) : null });
    const path = url.replace('http://127.0.0.1:43118', '');
    const match = Object.entries(routes).find(([key]) => key.startsWith('/') && path.includes(key));
    if (!match) return jsonResponse(200, {});
    const value = typeof match[1] === 'function' ? match[1]() : match[1];
    if (value instanceof Error) throw value;
    return value;
  };

  const client = createRuntimeBridgeClient({
    fetchImpl, readConfig: async () => config, adapter, jobStore, newNonce: () => 'n'.repeat(20),
  });

  return { client, calls, jobs, jobStore, started, aborted, fetchImpl };
}

test('only loopback runtime urls are accepted', () => {
  for (const url of ['http://127.0.0.1:43118', 'http://localhost:43118', 'http://127.0.0.1']) {
    assert.equal(isLoopbackUrl(url), true, url);
  }
  for (const url of ['https://seosona.example.com', 'http://192.168.1.5:43118', 'http://evil.test', '']) {
    assert.equal(isLoopbackUrl(url), false, `${url} must never be treated as the local runtime`);
  }
});

test('a non loopback runtime url is refused instead of being called', async () => {
  const { client, calls } = runtimeHarness({ config: { url: 'https://runtime.example.com', token: 'x'.repeat(40) } });
  assert.equal((await client.pollOnce()).status, 'RUNTIME_URL_INVALID');
  assert.equal(calls.length, 0, 'the user content never leaves the machine');
});

test('polling without configuration or token does nothing', async () => {
  assert.equal((await runtimeHarness({ config: null }).client.pollOnce()).status, 'NOT_CONFIGURED');
  assert.equal(
    (await runtimeHarness({ config: { url: 'http://127.0.0.1:43118', token: '' } }).client.pollOnce()).status,
    'NOT_CONFIGURED',
  );
});

test('a runtime that is not running is not an extension error', async () => {
  const { client } = runtimeHarness({ routes: { '/jobs/next': new Error('ECONNREFUSED') } });
  assert.equal((await client.pollOnce()).status, 'RUNTIME_UNAVAILABLE');
});

test('an empty queue costs one cheap call and starts nothing', async () => {
  const { client, started } = runtimeHarness({ routes: { '/jobs/next': jsonResponse(204, null) } });
  assert.equal((await client.pollOnce()).status, 'IDLE');
  assert.equal(started.length, 0);
});

test('a claimed job is stored with its lease token before it is started', async () => {
  const { client, jobs, started } = runtimeHarness({
    routes: {
      '/jobs/next': jsonResponse(200, {
        taskId: 'providertask_1', providerId: 'chatgpt-web', leaseToken: 'lease-abc',
        payload: { prompt: 'write this', timeoutMs: 120000, modelMatch: ['thinking'] },
      }),
    },
  });

  assert.equal((await client.pollOnce()).status, 'STARTED');
  assert.deepEqual(started[0], {
    taskId: 'providertask_1', providerId: 'chatgpt-web', text: 'write this',
    timeoutMs: 120000, modelMatch: ['thinking'], freshChat: true, chatUrl: null,
  });
  assert.equal(jobs.get('providertask_1').leaseToken, 'lease-abc');
  assert.equal(jobs.get('providertask_1').runtimeTask, true);
});

test('the worker does not claim a second job while one is running', async () => {
  const { client, jobs, started } = runtimeHarness({
    routes: {
      '/jobs/next': jsonResponse(200, {
        taskId: 'providertask_2', providerId: 'chatgpt-web', leaseToken: 'l2', payload: { prompt: 'x' },
      }),
    },
  });
  jobs.set('providertask_1', { jobId: 'providertask_1', status: 'running', runtimeTask: true, leaseToken: 'l1' });
  assert.equal((await client.pollOnce()).status, 'BUSY');
  assert.equal(started.length, 0, 'only one AI tab can be driven at a time');
});

test('a job that cannot be started is reported back immediately', async () => {
  const { client, calls } = runtimeHarness({
    routes: {
      '/jobs/next': jsonResponse(200, {
        taskId: 'providertask_1', providerId: 'chatgpt-web', leaseToken: 'l1', payload: { prompt: 'x' },
      }),
      '/result': jsonResponse(200, { status: 'COMPLETED' }),
      start: { ok: false, error: { code: 'PROVIDER_TAB_FAILED', message: 'no tab' } },
    },
  });
  const outcome = await client.pollOnce();
  assert.equal(outcome.status, 'START_FAILED');
  const reported = calls.find((c) => c.url.includes('/result'));
  assert.equal(reported.body.result.code, 'PROVIDER_TAB_FAILED');
  assert.equal(reported.body.leaseToken, 'l1', 'the runtime learns now, not after the lease expires');
});

test('a finished job is reported with its lease token and released', async () => {
  const { client, jobs, calls } = runtimeHarness({ routes: { '/result': jsonResponse(200, { status: 'COMPLETED' }) } });
  jobs.set('providertask_1', { jobId: 'providertask_1', status: 'running', runtimeTask: true, leaseToken: 'lease-abc' });

  const result = await client.report('providertask_1', { status: 'COMPLETED', code: 'COMPLETED', output: 'answer' });
  assert.equal(result.status, 'REPORTED');
  const posted = calls.at(-1);
  assert.equal(posted.url, 'http://127.0.0.1:43118/v1/provider/browser/jobs/providertask_1/result');
  assert.equal(posted.body.leaseToken, 'lease-abc');
  assert.equal(posted.body.result.output, 'answer');
  assert.equal(posted.init.headers.Authorization, `Bearer ${'x'.repeat(40)}`);
  assert.ok(posted.init.headers['x-seosona-nonce']);
  assert.equal(jobs.get('providertask_1').leaseToken, null, 'the lease is released once reported');
});

test('a job the runtime never handed out is not reported to it', async () => {
  const { client, jobs, calls } = runtimeHarness();
  jobs.set('local_1', { jobId: 'local_1', status: 'running' });
  assert.equal((await client.report('local_1', { status: 'COMPLETED' })).status, 'NOT_A_RUNTIME_TASK');
  assert.equal(calls.length, 0, 'local side panel work stays local');
});

test('a typed provider failure is reported verbatim', async () => {
  const { client, jobs, calls } = runtimeHarness({ routes: { '/result': jsonResponse(200, {}) } });
  jobs.set('providertask_1', { jobId: 'providertask_1', status: 'running', runtimeTask: true, leaseToken: 'l1' });
  await client.report('providertask_1', normalizeBrowserResult({ success: false, error: 'RATE_LIMIT', message: 'hết lượt' }));
  assert.equal(calls.at(-1).body.result.code, 'RATE_LIMITED');
  assert.equal(calls.at(-1).body.result.retryable, true);
});

test('renewing keeps a long job alive', async () => {
  const { client, jobs, calls } = runtimeHarness({ routes: { '/lease': jsonResponse(200, { status: 'LEASED' }) } });
  jobs.set('providertask_1', { jobId: 'providertask_1', status: 'running', runtimeTask: true, leaseToken: 'l1' });
  const outcome = await client.renewActive();
  assert.deepEqual(outcome.results, [{ taskId: 'providertask_1', status: 'RENEWED' }]);
  assert.equal(calls.at(-1).url.endsWith('/providertask_1/lease'), true);
});

// Người dùng bấm huỷ ở Studio. Extension chỉ biết điều đó ở lần gọi tiếp theo — và phải
// dừng tab AI lại, chứ không viết tiếp một bài không ai cần nữa.
test('a cancellation discovered while renewing aborts the browser job', async () => {
  const { client, jobs, aborted } = runtimeHarness({
    routes: { '/lease': jsonResponse(409, { error: { code: 'TASK_CANCELLED', message: 'cancelled' } }) },
  });
  jobs.set('providertask_1', { jobId: 'providertask_1', status: 'running', runtimeTask: true, leaseToken: 'l1' });
  const outcome = await client.renewActive();
  assert.deepEqual(aborted, ['providertask_1']);
  assert.equal(outcome.results[0].status, 'CANCELLED');
  assert.equal(jobs.get('providertask_1').leaseToken, null);
});

test('a lease lost to another worker is reported without aborting blindly', async () => {
  const { client, jobs, aborted } = runtimeHarness({
    routes: { '/lease': jsonResponse(409, { error: { code: 'LEASE_LOST', message: 'gone' } }) },
  });
  jobs.set('providertask_1', { jobId: 'providertask_1', status: 'running', runtimeTask: true, leaseToken: 'l1' });
  assert.equal((await client.renewActive()).results[0].status, 'LEASE_LOST');
  assert.deepEqual(aborted, [], 'losing a lease is not a reason to kill a tab mid-answer');
});

// Chrome tắt service worker rồi bật lại: client mới, mọi biến trong bộ nhớ mất, nhưng job
// và lease token còn trong storage.session — kết quả vẫn về đúng chỗ.
test('a leased job survives a service worker restart', async () => {
  const first = runtimeHarness({
    routes: {
      '/jobs/next': jsonResponse(200, {
        taskId: 'providertask_1', providerId: 'chatgpt-web', leaseToken: 'lease-abc', payload: { prompt: 'x' },
      }),
      '/result': jsonResponse(200, {}),
    },
  });
  await first.client.pollOnce();

  const revived = createRuntimeBridgeClient({
    fetchImpl: first.fetchImpl,
    readConfig: async () => ({ url: 'http://127.0.0.1:43118', token: 'x'.repeat(40) }),
    adapter: { start: async () => ({ ok: true }), abort: async () => ({ ok: true }) },
    jobStore: first.jobStore,
    newNonce: () => 'n'.repeat(20),
  });

  assert.equal((await revived.report('providertask_1', { status: 'COMPLETED', output: 'answer' })).status, 'REPORTED');
  assert.equal(first.calls.at(-1).body.leaseToken, 'lease-abc', 'the revived worker still holds the right lease');
});

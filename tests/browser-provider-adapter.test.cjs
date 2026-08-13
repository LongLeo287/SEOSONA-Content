const test = require('node:test');
const assert = require('node:assert/strict');
const Registry = require('../extension/lib/provider-registry.js');
const Adapter = require('../extension/lib/browser-provider-adapter.js');

test('browser provider registry maps generic ids to existing page adapters', () => {
  assert.equal(Registry.get('chatgpt-web').pageKey, 'chatgpt');
  assert.equal(Registry.get('claude-web').baseUrl, 'https://claude.ai/new');
  assert.equal(Registry.fromPageKey('gemini').providerId, 'gemini-web');
  assert.deepEqual(Registry.list().map((p) => p.providerId), ['chatgpt-web','gemini-web','grok-web','claude-web']);
});

test('adapter starts generic task through legacy page runner and keeps browser details internal', async () => {
  const calls = [];
  const jobs = new Map();
  const adapter = Adapter.create({
    registry: Registry,
    runPage: async (spec) => { calls.push(spec); jobs.set(spec.jobId, { status: 'running', provider: spec.provider, startedAt: 1000, leaseUpdatedAt: 1000, spec: { timeout: spec.timeout } }); return { ok: true, tabId: 9 }; },
    abortPage: async ({ jobId }) => { jobs.set(jobId, { status: 'aborted' }); return { ok: true }; },
    getJob: async (jobId) => jobs.get(jobId) || null,
    now: () => 1000,
  });
  const task = { taskId: 'task_1', providerPreference: 'claude-web', timeoutMs: 1234, contextBundle: { compiledPrompt: 'Write article' } };
  const ack = await adapter.start(task);
  assert.equal(ack.ok, true);
  assert.deepEqual(calls[0], { jobId: 'task_1', provider: 'claude', text: 'Write article', timeout: 1234, freshChat: true, chatUrl: null, modelMatch: null });
  assert.equal((await adapter.status('task_1')).status, 'running');
  await adapter.abort('task_1');
  assert.equal((await adapter.status('task_1')).status, 'aborted');
});

test('adapter normalizes legacy browser results into ProviderResult states', () => {
  const success = Adapter.normalizeResult('claude-web', { success: true, text: '{"body":"done"}', elapsedMs: 40, chatUrl: 'https://claude.ai/chat/1', modelState: 'switched' }, { startedAt: 10, finishedAt: 50 });
  assert.equal(success.status, 'COMPLETED');
  assert.deepEqual(success.output, { body: 'done' });
  assert.equal(success.costClass, 'ZERO_INCREMENTAL');
  assert.equal(success.error, null);
  const auth = Adapter.normalizeResult('chatgpt-web', { success: false, error: 'PROVIDER_NOT_LOGGED_IN', message: 'login' }, { startedAt: 10, finishedAt: 20 });
  assert.equal(auth.status, 'FAILED');
  assert.equal(auth.error.code, 'AUTH_REQUIRED');
  assert.equal(auth.error.retryable, false);
  const ui = Adapter.normalizeResult('gemini-web', { success: false, error: 'EDITOR_NOT_FOUND', message: 'changed' }, { startedAt: 10, finishedAt: 20 });
  assert.equal(ui.error.code, 'UI_CHANGED');
});

test('adapter rejects unknown provider and marks expired running jobs stale', async () => {
  const adapter = Adapter.create({ registry: Registry, runPage: async () => ({ ok: true }), abortPage: async () => ({ ok: true }), getJob: async () => ({ status: 'running', startedAt: 1, leaseUpdatedAt: 1, spec: { timeout: 100 } }), now: () => 70000 });
  await assert.rejects(() => adapter.start({ taskId: 'x', providerPreference: 'missing', contextBundle: { compiledPrompt: 'x' } }), /Unknown browser provider/);
  assert.equal((await adapter.status('x')).status, 'stale');
});

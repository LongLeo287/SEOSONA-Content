const test = require('node:test');
const assert = require('node:assert/strict');
const Bridge = require('../extension/lib/runtime-provider-bridge.js');

function makeState(initial = null) {
  let value = initial;
  return { get: async () => value, set: async (next) => { value = next; }, clear: async () => { value = null; }, value: () => value };
}
function task(id = 'task_1', provider = 'claude-web') { return { taskId: id, providerPreference: provider, timeoutMs: 1000, contextBundle: { compiledPrompt: 'Write' } }; }

test('poll claims a pending Runtime task, starts browser adapter, and persists active lease state', async () => {
  const calls = []; const state = makeState();
  const runtime = async (method, path, body) => { calls.push({ method, path, body }); if (path.endsWith('/next')) return { status: 200, body: { task: task(), status: 'leased', leaseOwner: 'ext' } }; throw new Error('unexpected request'); };
  const started = []; const adapter = { start: async (value) => { started.push(value); return { ok: true }; }, status: async () => null, normalizeResult() {} };
  const bridge = Bridge.create({ runtimeRequest: runtime, adapter, stateStore: state, ownerId: 'ext' }); const result = await bridge.poll();
  assert.equal(result.status, 'started'); assert.deepEqual(started, [task()]); assert.deepEqual(state.value(), { taskId: 'task_1', providerId: 'claude-web' }); assert.equal(calls[0].path, '/v1/provider/browser/jobs/next');
});

test('poll renews lease for active running browser job without claiming another task', async () => {
  const calls = []; const state = makeState({ taskId: 'task_1', providerId: 'claude-web' });
  const runtime = async (method, path, body) => { calls.push({ method, path, body }); return { status: 200, body: {} }; };
  const adapter = { status: async () => ({ status: 'running', leaseUpdatedAt: 10 }), start: async () => { throw new Error('should not start'); }, normalizeResult() {} };
  const bridge = Bridge.create({ runtimeRequest: runtime, adapter, stateStore: state, ownerId: 'ext' }); const result = await bridge.poll();
  assert.equal(result.status, 'running'); assert.equal(calls.length, 1); assert.equal(calls[0].path, '/v1/provider/browser/jobs/task_1/lease');
});

test('poll posts typed completed result, clears active state, then does not leak legacy job internals', async () => {
  const calls = []; const state = makeState({ taskId: 'task_1', providerId: 'claude-web' });
  const legacy = { status: 'done', startedAt: 10, finishedAt: 20, tabId: 99, result: { success: true, text: '{"body":"done"}', chatUrl: 'https://claude.ai/c/1' } };
  const typed = { status: 'COMPLETED', providerId: 'claude-web', output: { body: 'done' }, error: null, receipt: { adapter: 'browser' } };
  const runtime = async (method, path, body) => { calls.push({ method, path, body }); return { status: 200, body: {} }; };
  const adapter = { status: async () => legacy, start: async () => {}, normalizeResult: (providerId, result, job) => { assert.equal(providerId, 'claude-web'); assert.equal(result, legacy.result); assert.equal(job, legacy); return typed; } };
  const bridge = Bridge.create({ runtimeRequest: runtime, adapter, stateStore: state, ownerId: 'ext' }); const result = await bridge.poll();
  assert.equal(result.status, 'completed'); assert.equal(state.value(), null); assert.deepEqual(calls[0].body, typed); assert.doesNotMatch(JSON.stringify(calls[0].body), /tabId/);
});

test('poll converts stale/aborted browser state to a non-success result and clears active state', async () => {
  for (const jobStatus of ['stale', 'aborted']) {
    const state = makeState({ taskId: `task_${jobStatus}`, providerId: 'gemini-web' }); const calls = [];
    const legacy = { status: jobStatus, startedAt: 10, leaseUpdatedAt: 20, result: null };
    const adapter = { status: async () => legacy, start: async () => {}, normalizeResult: (providerId, result, job) => ({ status: 'FAILED', providerId, output: null, error: { code: job.status === 'stale' ? 'TIMEOUT' : 'CANCELLED', retryable: job.status === 'stale' }, receipt: { adapter: 'browser' } }) };
    const runtime = async (method, path, body) => { calls.push({ method, path, body }); return { status: 200, body: {} }; };
    const bridge = Bridge.create({ runtimeRequest: runtime, adapter, stateStore: state, ownerId: 'ext' }); const result = await bridge.poll();
    assert.equal(result.status, 'failed'); assert.equal(state.value(), null); assert.equal(calls[0].body.status, 'FAILED');
  }
});

test('Runtime unavailable does not erase active browser task state', async () => {
  const state = makeState({ taskId: 'task_1', providerId: 'claude-web' });
  const adapter = { status: async () => ({ status: 'running' }), start: async () => {}, normalizeResult() {} };
  const bridge = Bridge.create({ runtimeRequest: async () => { throw new Error('offline'); }, adapter, stateStore: state, ownerId: 'ext' }); const result = await bridge.poll();
  assert.equal(result.status, 'runtime_unavailable'); assert.deepEqual(state.value(), { taskId: 'task_1', providerId: 'claude-web' });
});

test('no pending Runtime job is cheap and does not touch adapter state', async () => {
  const state = makeState(); let starts = 0;
  const bridge = Bridge.create({ runtimeRequest: async () => ({ status: 204, body: null }), adapter: { start: async () => { starts += 1; }, status: async () => null, normalizeResult() {} }, stateStore: state, ownerId: 'ext' });
  const result = await bridge.poll(); assert.equal(result.status, 'idle'); assert.equal(starts, 0);
});

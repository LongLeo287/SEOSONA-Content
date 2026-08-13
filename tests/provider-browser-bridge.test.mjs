import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserJobBridge } from '../runtime/http/extension-bridge.mjs';
import { createRuntimeServer } from '../runtime/http/server.mjs';

function task(id = 'task_1') { return { taskId: id, taskType: 'WRITE', contentJob: 'article', requiredCapabilities: ['writing'], contextSnapshotId: 'ctx_1', contextBundle: {}, outputContract: {}, privacyPolicy: {}, costPolicy: {}, timeoutMs: 1000, providerPreference: 'claude-web' }; }

test('bridge claims once, renews lease, expires to another owner, and accepts idempotent result', () => {
  let clock = 1000; const bridge = createBrowserJobBridge({ now: () => clock, leaseMs: 100 }); bridge.enqueue(task());
  const first = bridge.claimNext('extension-a'); assert.equal(first.task.taskId, 'task_1'); assert.equal(bridge.claimNext('extension-b'), null);
  clock = 1050; assert.equal(bridge.renewLease('task_1', 'extension-a').leaseUntil, 1150);
  clock = 1160; const reclaimed = bridge.claimNext('extension-b'); assert.equal(reclaimed.leaseOwner, 'extension-b');
  const result = { status: 'COMPLETED', output: { body: 'done' }, providerId: 'claude-web' };
  assert.deepEqual(bridge.submitResult('task_1', 'extension-b', result).result, result); assert.deepEqual(bridge.submitResult('task_1', 'extension-b', result).result, result);
  assert.throws(() => bridge.submitResult('task_1', 'extension-b', { ...result, output: { body: 'different' } }), /already finalized/i);
});

test('bridge cancellation is terminal and persisted snapshots contain no credential fields', () => {
  const bridge = createBrowserJobBridge({ now: () => 1, leaseMs: 100 }); bridge.enqueue(task('task_cancel')); bridge.cancel('task_cancel');
  assert.equal(bridge.get('task_cancel').status, 'cancelled'); assert.equal(bridge.claimNext('extension-a'), null);
  const snapshot = bridge.exportState(); assert.doesNotMatch(JSON.stringify(snapshot), /cookie|apiKey|authorization|bearer/i);
  const restored = createBrowserJobBridge({ now: () => 2, leaseMs: 100, initialState: snapshot }); assert.equal(restored.get('task_cancel').status, 'cancelled');
});

function fakeServices() { return { workspaceService: { listProjects: async () => [], createProject: async (x) => x, getProject: async () => null, createBrand: async (x) => ({ brandId: 'brand_1', ...x }) }, contentService: { addSource: async (x) => x, createContent: async (x) => x, appendRevision: async (x) => x, getContentHistory: async () => null } }; }
async function close(server) { await new Promise((resolve) => server.close(resolve)); }

test('Runtime mounts bridge endpoints and only extension auth may claim or lease browser jobs', async () => {
  const browserBridge = createBrowserJobBridge({ now: () => 1000, leaseMs: 100 }); const { workspaceService, contentService } = fakeServices();
  const token = 't'.repeat(32); const extensionOrigin = 'chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef';
  const server = createRuntimeServer({ token, extensionOrigin, workspaceId: 'workspace_local', workspaceService, contentService, browserBridge, studioHtml: '<title>S</title>' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const home = await fetch(`${base}/`); const cookie = (home.headers.get('set-cookie') || '').split(';')[0];
    const enqueue = await fetch(`${base}/v1/provider/browser/jobs`, { method: 'POST', headers: { cookie, origin: base, 'content-type': 'application/json' }, body: JSON.stringify(task()) }); assert.equal(enqueue.status, 202);
    const studioClaim = await fetch(`${base}/v1/provider/browser/jobs/next`, { headers: { cookie, origin: base, 'x-seosona-bridge-owner': 'studio' } }); assert.equal(studioClaim.status, 403);
    const headers = { origin: extensionOrigin, authorization: `Bearer ${token}`, 'x-seosona-nonce': 'noncebridge000001', 'x-seosona-bridge-owner': 'extension-a' };
    const claim = await fetch(`${base}/v1/provider/browser/jobs/next`, { headers }); assert.equal(claim.status, 200); assert.equal((await claim.json()).task.taskId, 'task_1');
    const lease = await fetch(`${base}/v1/provider/browser/jobs/task_1/lease`, { method: 'POST', headers: { ...headers, 'x-seosona-nonce': 'noncebridge000002', 'content-type': 'application/json' }, body: '{}' }); assert.equal(lease.status, 200);
    const result = await fetch(`${base}/v1/provider/browser/jobs/task_1/result`, { method: 'POST', headers: { ...headers, 'x-seosona-nonce': 'noncebridge000003', 'content-type': 'application/json' }, body: JSON.stringify({ status: 'COMPLETED', output: { body: 'done' }, providerId: 'claude-web' }) }); assert.equal(result.status, 200);
  } finally { await close(server); }
});

test('Runtime BrowserBridgeAdapter waits for typed extension result without changing the task', async () => {
  const { createBrowserBridgeAdapter } = await import('../runtime/providers/browser-bridge-adapter.mjs'); let clock = 0;
  const bridge = createBrowserJobBridge({ now: () => clock, leaseMs: 100 }); const original = task('task_adapter');
  const sleep = async () => { clock += 10; const claimed = bridge.claimNext('extension-a'); if (claimed) bridge.submitResult('task_adapter', 'extension-a', { status: 'COMPLETED', output: { body: 'browser answer' }, providerId: 'claude-web', modelSession: 'sonnet', startedAt: 't1', completedAt: 't2', costClass: 'ZERO_INCREMENTAL', parseStatus: 'VALID', warnings: [], error: null, receipt: { adapter: 'browser' } }); };
  const adapter = createBrowserBridgeAdapter({ providerId: 'claude-web', bridge, sleep, now: () => clock, pollMs: 10 }); const result = await adapter.execute(original);
  assert.equal(result.status, 'COMPLETED'); assert.equal(result.output.body, 'browser answer'); assert.equal(original.providerPreference, 'claude-web'); assert.equal(bridge.get('task_adapter').task.contextSnapshotId, 'ctx_1');
});

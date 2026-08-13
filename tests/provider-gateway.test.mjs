import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderGateway } from '../runtime/providers/gateway.mjs';
import { createProviderRegistry } from '../runtime/providers/registry.mjs';

const task = { taskId: 'task_1', taskType: 'WRITE', contentJob: 'article', requiredCapabilities: ['writing'], contextSnapshotId: 'ctx_1', contextBundle: { brief: 'same context' }, outputContract: {}, privacyPolicy: {}, costPolicy: { paidApi: false }, timeoutMs: 1000, providerPreference: 'auto' };
function record(providerId, quality, costClass = 'ZERO_INCREMENTAL') { return { providerId, adapterType: providerId.includes('web') ? 'browser' : 'api', capabilities: ['writing'], costClass, enabled: true, authStatus: 'READY', health: { availability: true, retryRate: 0, selectorHealth: 1 }, qualityByJob: { 'article:WRITE': { score: quality, observations: 2 } }, latencyMs: 100 }; }
function result(providerId, status, { retryable = false, output = null, costClass = 'ZERO_INCREMENTAL' } = {}) { return { status, output, providerId, modelSession: 'session', startedAt: 't1', completedAt: 't2', costClass, parseStatus: status === 'COMPLETED' ? 'VALID' : 'NOT_PARSED', warnings: [], error: status === 'COMPLETED' ? null : { code: 'PROVIDER_FAILED', message: 'failed', retryable }, receipt: { adapter: providerId } }; }

test('Gateway falls back only after retryable failure and preserves the exact task/context', async () => {
  const registry = createProviderRegistry([record('best-web', 0.95), record('next-web', 0.9)]); const seen = [];
  const gateway = createProviderGateway({ registry, adapters: new Map([
    ['best-web', { execute: async (value) => { seen.push(structuredClone(value)); return result('best-web', 'FAILED', { retryable: true }); } }],
    ['next-web', { execute: async (value) => { seen.push(structuredClone(value)); return result('next-web', 'COMPLETED', { output: { body: 'done' } }); } }],
  ]), now: () => 1000 });
  const out = await gateway.execute(task, { manualLocks: {}, paidApi: false, denyProviders: [] });
  assert.equal(out.providerId, 'next-web'); assert.equal(seen.length, 2); assert.deepEqual(seen[0], seen[1]); assert.deepEqual(seen[0].contextBundle, task.contextBundle); assert.equal(out.attempts.length, 2);
});

test('manual lock never silently falls back to another provider', async () => {
  const registry = createProviderRegistry([record('locked-web', 0.9), record('other-web', 1)]); let otherCalls = 0;
  const gateway = createProviderGateway({ registry, adapters: new Map([['locked-web', { execute: async () => result('locked-web', 'FAILED', { retryable: true }) }], ['other-web', { execute: async () => { otherCalls += 1; return result('other-web', 'COMPLETED', { output: {} }); } }]]) });
  const out = await gateway.execute(task, { manualLocks: { run: 'locked-web' }, paidApi: false, denyProviders: [] });
  assert.equal(out.status, 'FAILED'); assert.equal(otherCalls, 0);
});

test('paid provider is never used as fallback when paidApi=false', async () => {
  const registry = createProviderRegistry([record('free-web', 0.9), record('paid-api', 1, 'PAID_ALLOWED')]); let paidCalls = 0;
  const gateway = createProviderGateway({ registry, adapters: new Map([['free-web', { execute: async () => result('free-web', 'FAILED', { retryable: true }) }], ['paid-api', { execute: async () => { paidCalls += 1; return result('paid-api', 'COMPLETED', { output: {}, costClass: 'PAID_ALLOWED' }); } }]]) });
  const out = await gateway.execute(task, { manualLocks: {}, paidApi: false, denyProviders: [] });
  assert.equal(out.status, 'FAILED'); assert.equal(paidCalls, 0);
});

test('Gateway receipt hashes result without storing full sensitive context', async () => {
  const registry = createProviderRegistry([record('free-web', 1)]);
  const gateway = createProviderGateway({ registry, adapters: new Map([['free-web', { execute: async () => result('free-web', 'COMPLETED', { output: { body: 'answer' } }) }]]), now: () => 1234 });
  const out = await gateway.execute({ ...task, contextBundle: { secretBusinessContext: 'do-not-copy-to-receipt' } }, { manualLocks: {}, paidApi: false, denyProviders: [] });
  assert.match(out.receipt.resultDigest, /^[a-f0-9]{64}$/); assert.doesNotMatch(JSON.stringify(out.receipt), /do-not-copy-to-receipt/); assert.equal(out.receipt.contextSnapshotId, 'ctx_1');
});

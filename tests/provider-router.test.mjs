import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderRegistry, seedV1Providers } from '../runtime/providers/registry.mjs';
import { routeProvider } from '../runtime/providers/router.mjs';

const task = { taskId: 'task_1', taskType: 'WRITE', contentJob: 'article', requiredCapabilities: ['writing'] };
function provider(providerId, { quality = null, costClass = 'ZERO_INCREMENTAL', latencyMs = 1000, availability = true, retryRate = 0, enabled = true, capabilities = ['writing'], authStatus = 'READY' } = {}) {
  return { providerId, adapterType: providerId.includes('web') ? 'browser' : 'api', capabilities, costClass, enabled, authStatus, health: { availability, timeoutRate: 0, rateLimitRate: 0, selectorHealth: 1, parseFailureRate: 0, retryRate, lastUpdatedAt: 'now' }, qualityByJob: quality === null ? {} : { 'article:WRITE': { score: quality, observations: 3 } }, latencyMs };
}

test('V1 provider seeds classify browser sessions as zero incremental without invented quality', () => {
  const seeds = seedV1Providers();
  assert.deepEqual(seeds.map((x) => x.providerId), ['chatgpt-web','claude-web','gemini-web','grok-web','api-v1']);
  for (const item of seeds.filter((x) => x.adapterType === 'browser')) { assert.equal(item.costClass, 'ZERO_INCREMENTAL'); assert.deepEqual(item.qualityByJob, {}); }
  assert.equal(seeds.find((x) => x.providerId === 'api-v1').costClass, 'UNKNOWN_COST');
});

test('registry records bounded observed quality and health without static marketing score', () => {
  const registry = createProviderRegistry([provider('claude-web', { quality: null })], { qualityWindow: 3 });
  assert.equal(registry.get('claude-web').qualityByJob['article:WRITE'], undefined);
  registry.recordQualitySignal({ providerId: 'claude-web', contentJob: 'article', taskType: 'WRITE', evaluatorScore: 0.8, schemaCompliance: 1, accept: 1, reject: 0, repair: 0, at: 't1' });
  registry.recordQualitySignal({ providerId: 'claude-web', contentJob: 'article', taskType: 'WRITE', evaluatorScore: 0.6, schemaCompliance: 1, accept: 0, reject: 1, repair: 1, at: 't2' });
  registry.recordQualitySignal({ providerId: 'claude-web', contentJob: 'article', taskType: 'WRITE', evaluatorScore: 1, schemaCompliance: 1, accept: 1, reject: 0, repair: 0, at: 't3' });
  registry.recordQualitySignal({ providerId: 'claude-web', contentJob: 'article', taskType: 'WRITE', evaluatorScore: 1, schemaCompliance: 1, accept: 1, reject: 0, repair: 0, at: 't4' });
  const quality = registry.get('claude-web').qualityByJob['article:WRITE'];
  assert.equal(quality.observations, 3); assert.ok(quality.score > 0 && quality.score <= 1);
  registry.updateHealth('claude-web', { availability: false, timeoutRate: 0.2, lastUpdatedAt: 't5' });
  assert.equal(registry.get('claude-web').health.availability, false); assert.equal(registry.get('claude-web').health.timeoutRate, 0.2);
});

test('manual lock beats Auto while deny-list still fails closed', () => {
  const providers = [provider('claude-web', { quality: 0.9 }), provider('gemini-web', { quality: 0.8 })];
  const locked = routeProvider({ task, providers, policy: { manualLocks: { run: 'gemini-web' }, paidApi: false, denyProviders: [] } });
  assert.equal(locked.providerId, 'gemini-web'); assert.equal(locked.reason, 'manual-lock:run');
  assert.throws(() => routeProvider({ task, providers, policy: { manualLocks: { run: 'gemini-web' }, paidApi: false, denyProviders: ['gemini-web'] } }), /denied/i);
});

test('quality is first, then cost, stability, then speed', () => {
  assert.equal(routeProvider({ task, providers: [provider('free-web', { quality: 0.75, costClass: 'ZERO_INCREMENTAL', latencyMs: 100 }), provider('paid-api', { quality: 0.95, costClass: 'PAID_ALLOWED', latencyMs: 500 })], policy: { manualLocks: {}, paidApi: true, denyProviders: [] } }).providerId, 'paid-api');
  assert.equal(routeProvider({ task, providers: [provider('browser-web', { quality: 0.9, costClass: 'ZERO_INCREMENTAL', latencyMs: 2000 }), provider('free-api', { quality: 0.9, costClass: 'FREE_QUOTA', latencyMs: 100 })], policy: { manualLocks: {}, paidApi: false, denyProviders: [] } }).providerId, 'browser-web');
  assert.equal(routeProvider({ task, providers: [provider('stable-web', { quality: 0.9, retryRate: 0.02, latencyMs: 2000 }), provider('flaky-web', { quality: 0.9, retryRate: 0.4, latencyMs: 100 })], policy: { manualLocks: {}, paidApi: false, denyProviders: [] } }).providerId, 'stable-web');
  assert.equal(routeProvider({ task, providers: [provider('slow-web', { quality: 0.9, latencyMs: 2000 }), provider('fast-web', { quality: 0.9, latencyMs: 100 })], policy: { manualLocks: {}, paidApi: false, denyProviders: [] } }).providerId, 'fast-web');
});

test('cost policy blocks paid/unknown and allows free quota fallback', () => {
  const providers = [provider('blocked-api', { quality: 1, costClass: 'PAID_BLOCKED' }), provider('unknown-api', { quality: 1, costClass: 'UNKNOWN_COST' }), provider('paid-api', { quality: 0.95, costClass: 'PAID_ALLOWED' }), provider('free-api', { quality: 0.9, costClass: 'FREE_QUOTA' })];
  assert.equal(routeProvider({ task, providers, policy: { manualLocks: {}, paidApi: false, denyProviders: [] } }).providerId, 'free-api');
  assert.equal(routeProvider({ task, providers, policy: { manualLocks: {}, paidApi: true, denyProviders: [] } }).providerId, 'paid-api');
});

test('candidate filtering rejects denied, unhealthy, auth-required and missing capabilities', () => {
  const providers = [provider('denied-web', { quality: 1 }), provider('offline-web', { quality: 1, availability: false }), provider('auth-web', { quality: 1, authStatus: 'AUTH_REQUIRED' }), provider('wrong-web', { quality: 1, capabilities: ['vision'] }), provider('good-web', { quality: 0.8 })];
  const routed = routeProvider({ task, providers, policy: { manualLocks: {}, paidApi: false, denyProviders: ['denied-web'] } });
  assert.equal(routed.providerId, 'good-web'); assert.ok(routed.considered.some((x) => x.providerId === 'offline-web' && x.eligible === false));
});

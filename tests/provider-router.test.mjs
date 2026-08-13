import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderRegistry, SEED_PROVIDERS } from '../runtime/providers/registry.mjs';
import { createQualityTracker } from '../runtime/providers/quality-signals.mjs';
import { routeProvider, NEUTRAL_QUALITY_BAND } from '../runtime/providers/router.mjs';

const AT = '2026-08-13T00:00:00.000Z';

// ================================================================ Sổ đăng ký provider

test('seeded registry knows the five providers and invents no quality ratings', () => {
  const registry = createProviderRegistry(SEED_PROVIDERS);
  assert.deepEqual(
    registry.list().map((p) => p.providerId).sort(),
    ['api-v1', 'chatgpt-web', 'claude-web', 'gemini-web', 'grok-web'],
  );

  for (const id of ['chatgpt-web', 'claude-web', 'gemini-web', 'grok-web']) {
    const p = registry.get(id);
    assert.equal(p.adapterType, 'BROWSER');
    assert.equal(p.costClass, 'ZERO_INCREMENTAL', 'a logged-in session costs nothing extra');
    // Điểm chất lượng phải đến từ quan sát. Không hãng nào được "tặng" điểm sẵn.
    assert.deepEqual(p.qualityByJob, {}, `${id} must start with no quality claims`);
  }

  const api = registry.get('api-v1');
  assert.equal(api.adapterType, 'API');
  assert.equal(api.costClass, 'UNKNOWN_COST', 'an unconfigured API is not assumed to be free');
  assert.equal(api.enabled, false, 'the API adapter stays off until it is configured');
});

test('a freshly seeded provider claims no health it has not observed', () => {
  const registry = createProviderRegistry(SEED_PROVIDERS);
  const health = registry.get('chatgpt-web').health;
  assert.equal(health.availability, 'UNKNOWN');
  assert.equal(health.auth, 'UNKNOWN');
  for (const rate of ['timeoutRate', 'rateLimitRate', 'selectorHealth', 'parseFailureRate', 'retryRate']) {
    assert.equal(health[rate], null, `${rate} must be null until measured, not an optimistic zero`);
  }
  assert.equal(health.lastUpdatedAt, null);
});

test('registry rejects unknown providers and malformed records', () => {
  const registry = createProviderRegistry();
  assert.equal(registry.get('nope'), null);
  assert.throws(() => registry.upsert({ adapterType: 'API' }), /providerId/);
  assert.throws(() => registry.upsert({ providerId: 'x', adapterType: 'MAGIC' }), /adapterType/);
  assert.throws(() => registry.upsert({ providerId: 'x', adapterType: 'API', costClass: 'CHEAP' }), /costClass/);
  assert.throws(() => registry.updateHealth('ghost', { availability: 'UP' }), (e) => e.code === 'PROVIDER_NOT_FOUND');
});

test('upsert merges into an existing provider instead of wiping it', () => {
  const registry = createProviderRegistry(SEED_PROVIDERS);
  registry.updateHealth('gemini-web', { availability: 'UP', at: AT });
  registry.upsert({ providerId: 'gemini-web', enabled: false });

  const p = registry.get('gemini-web');
  assert.equal(p.enabled, false);
  assert.equal(p.adapterType, 'BROWSER', 'unrelated fields survive');
  assert.equal(p.health.availability, 'UP', 'observed health is not lost by a settings change');
});

test('registry hands out copies, so callers cannot mutate its state', () => {
  const registry = createProviderRegistry(SEED_PROVIDERS);
  registry.get('claude-web').enabled = false;
  registry.list()[0].costClass = 'PAID_BLOCKED';
  assert.equal(registry.get('claude-web').enabled, true);
  assert.equal(registry.get('chatgpt-web').costClass, 'ZERO_INCREMENTAL');
});

test('health updates validate their fields and stamp the observation time', () => {
  const registry = createProviderRegistry(SEED_PROVIDERS);
  registry.updateHealth('chatgpt-web', { availability: 'UP', auth: 'AUTHENTICATED', timeoutRate: 0.1, at: AT });
  const health = registry.get('chatgpt-web').health;
  assert.equal(health.availability, 'UP');
  assert.equal(health.timeoutRate, 0.1);
  assert.equal(health.lastUpdatedAt, AT);
  assert.equal(health.rateLimitRate, null, 'unobserved rates stay unknown');

  assert.throws(() => registry.updateHealth('chatgpt-web', { availability: 'GREAT' }), /availability/);
  assert.throws(() => registry.updateHealth('chatgpt-web', { timeoutRate: 1.5 }), /timeoutRate/);
  assert.throws(() => registry.updateHealth('chatgpt-web', { madeUpField: 1 }), /madeUpField/);
});

// ================================================================ Tín hiệu chất lượng

test('quality summary is null until something has actually been observed', () => {
  const tracker = createQualityTracker();
  assert.equal(tracker.summary('chatgpt-web', 'article'), null);
  tracker.record({ providerId: 'chatgpt-web', contentJob: 'article', accept: 1, at: AT });
  assert.equal(tracker.summary('chatgpt-web', 'article').observations, 1);
  assert.equal(tracker.summary('chatgpt-web', 'newsletter'), null, 'quality does not transfer across jobs');
});

test('quality score is built only from the components that were measured', () => {
  const tracker = createQualityTracker();
  // Chỉ đo được một thứ -> điểm chính là thứ đó, không pha thêm số bịa.
  tracker.record({ providerId: 'a', contentJob: 'article', schemaCompliance: 0.5, at: AT });
  assert.equal(tracker.summary('a', 'article').score, 0.5);
  assert.deepEqual(tracker.summary('a', 'article').components, ['schemaCompliance']);

  tracker.record({ providerId: 'b', contentJob: 'article', accept: 3, reject: 1, at: AT });
  const b = tracker.summary('b', 'article');
  assert.equal(b.acceptRate, 0.75);
  assert.equal(b.schemaCompliance, null, 'unmeasured stays null instead of defaulting to a number');
});

test('rejections and repairs pull the observed score down', () => {
  const tracker = createQualityTracker();
  tracker.record({ providerId: 'good', contentJob: 'article', accept: 10, evaluatorScore: 0.9, at: AT });
  tracker.record({ providerId: 'bad', contentJob: 'article', accept: 2, reject: 8, repair: 6, evaluatorScore: 0.3, at: AT });
  assert.ok(
    tracker.summary('good', 'article').score > tracker.summary('bad', 'article').score,
    'observed quality must order providers',
  );
});

test('the observation window is bounded and keeps the most recent signals', () => {
  const tracker = createQualityTracker({ windowSize: 3 });
  for (let i = 0; i < 5; i += 1) {
    tracker.record({ providerId: 'a', contentJob: 'article', evaluatorScore: i < 2 ? 0 : 1, at: AT });
  }
  const s = tracker.summary('a', 'article');
  assert.equal(s.observations, 3, 'old signals are dropped, memory stays bounded');
  assert.equal(s.evaluatorScore, 1, 'the surviving window is the recent one');
});

test('golden evaluations are tracked separately from everyday accepts', () => {
  const tracker = createQualityTracker();
  tracker.record({ providerId: 'a', contentJob: 'article', goldenEval: true, evaluatorScore: 0.8, at: AT });
  tracker.record({ providerId: 'a', contentJob: 'article', accept: 1, at: AT });
  const s = tracker.summary('a', 'article');
  assert.equal(s.goldenObservations, 1);
  assert.equal(s.observations, 2);
});

test('quality signals are validated before they can distort routing', () => {
  const tracker = createQualityTracker();
  assert.throws(() => tracker.record({ contentJob: 'article' }), /providerId/);
  assert.throws(() => tracker.record({ providerId: 'a' }), /contentJob/);
  assert.throws(() => tracker.record({ providerId: 'a', contentJob: 'article', accept: -1, at: AT }), /accept/);
  assert.throws(() => tracker.record({ providerId: 'a', contentJob: 'article', evaluatorScore: 2, at: AT }), /evaluatorScore/);
  assert.throws(() => tracker.record({ providerId: 'a', contentJob: 'article', taskType: 'SING', at: AT }), /taskType/);
});

test('registry exposes recorded quality per content job', () => {
  const registry = createProviderRegistry(SEED_PROVIDERS);
  registry.recordQualitySignal({ providerId: 'claude-web', contentJob: 'article', accept: 4, reject: 1, at: AT });
  const quality = registry.get('claude-web').qualityByJob;
  assert.equal(quality.article.observations, 1);
  assert.equal(quality.article.acceptRate, 0.8);
  assert.equal(registry.get('gemini-web').qualityByJob.article, undefined, 'signals do not spill across providers');
  assert.throws(
    () => registry.recordQualitySignal({ providerId: 'ghost', contentJob: 'article', at: AT }),
    (e) => e.code === 'PROVIDER_NOT_FOUND',
  );
});

// ================================================================ Auto Router

function provider(providerId, overrides = {}) {
  const { quality, health, ...rest } = overrides;
  return {
    providerId,
    adapterType: 'BROWSER',
    costClass: 'ZERO_INCREMENTAL',
    enabled: true,
    authStatus: 'AUTHENTICATED',
    capabilities: [],
    latencyMs: 1000,
    qualityByJob: quality === undefined ? {} : { article: { score: quality, observations: 5 } },
    health: {
      availability: 'UP', auth: 'AUTHENTICATED', timeoutRate: 0, rateLimitRate: 0,
      selectorHealth: 1, parseFailureRate: 0, retryRate: 0, lastUpdatedAt: AT, ...health,
    },
    ...rest,
  };
}

const task = (overrides = {}) => ({ contentJob: 'article', taskType: 'WRITE', requiredCapabilities: [], ...overrides });
const route = (providers, policy = {}, t = task()) => routeProvider({ task: t, providers, policy });

// ---------------------------------------------------------------- khóa tay

test('a manual lock overrides Auto even when the locked provider is worse', () => {
  const providers = [provider('best', { quality: 0.95 }), provider('locked', { quality: 0.2 })];
  const result = route(providers, { manualLocks: { global: 'locked' } });
  assert.equal(result.providerId, 'locked');
  assert.equal(result.reason, 'MANUAL_LOCK');
});

test('manual lock precedence is run over stage over workflow over project over global', () => {
  const providers = ['a', 'b', 'c', 'd', 'e'].map((id) => provider(id));
  const locks = { run: 'a', stage: 'b', workflow: 'c', project: 'd', global: 'e' };
  const order = ['a', 'b', 'c', 'd', 'e'];
  for (let i = 0; i < order.length; i += 1) {
    const scoped = Object.fromEntries(Object.entries(locks).slice(i));
    assert.equal(route(providers, { manualLocks: scoped }).providerId, order[i]);
  }
});

test('a task provider preference acts as the run-level lock', () => {
  const providers = [provider('a', { quality: 0.9 }), provider('b', { quality: 0.1 })];
  assert.equal(route(providers, {}, task({ providerPreference: 'b' })).providerId, 'b');
  assert.equal(route(providers, { manualLocks: { run: 'a' } }, task({ providerPreference: 'b' })).providerId, 'a');
});

// Khóa tay hỏng thì phải BÁO, không được lặng lẽ chạy sang hãng khác: người dùng khóa là
// vì họ có lý do, tự ý đổi hãng còn tệ hơn là dừng lại.
test('a broken manual lock never silently falls back to another provider', () => {
  const providers = [provider('a'), provider('down', { enabled: false })];
  const missing = route(providers, { manualLocks: { global: 'ghost' } });
  assert.equal(missing.providerId, null);
  assert.equal(missing.reason, 'MANUAL_LOCK_UNAVAILABLE');
  assert.equal(route(providers, { manualLocks: { global: 'down' } }).providerId, null);
});

// ---------------------------------------------------------------- lọc ứng viên

test('deny list, disabled, missing capability, auth and outage all remove candidates', () => {
  const good = provider('good', { quality: 0.5 });
  const providers = [
    good,
    provider('denied', { quality: 0.99 }),
    provider('off', { quality: 0.99, enabled: false }),
    provider('loggedout', { quality: 0.99, authStatus: 'AUTH_REQUIRED' }),
    provider('down', { quality: 0.99, health: { availability: 'DOWN' } }),
    provider('excluded', { quality: 0.99 }),
  ];
  const policy = { denyProviders: ['denied'], excluded: ['excluded'] };
  const needsCapability = task({ requiredCapabilities: ['long-form'] });
  assert.equal(route(providers, policy, needsCapability).providerId, null, 'nobody has the required capability');

  const withCapability = [...providers, provider('capable', { quality: 0.4, capabilities: ['long-form'] })];
  assert.equal(route(withCapability, policy, needsCapability).providerId, 'capable');
  assert.equal(good.enabled, true, 'input records are not mutated');
});

test('the considered list explains why each candidate was kept or dropped', () => {
  const result = route([provider('a', { quality: 0.8 }), provider('b', { enabled: false })]);
  const byId = Object.fromEntries(result.considered.map((c) => [c.providerId, c]));
  assert.equal(byId.a.eligible, true);
  assert.equal(byId.b.eligible, false);
  assert.equal(byId.b.reason, 'DISABLED');
  assert.ok(Array.isArray(byId.a.sortKey), 'the sort key is visible for route preview');
});

// ---------------------------------------------------------------- thứ tự từ điển

test('higher observed quality wins even when that provider is slower', () => {
  const result = route([
    provider('slow-good', { quality: 0.9, latencyMs: 9000 }),
    provider('fast-poor', { quality: 0.3, latencyMs: 100 }),
  ]);
  assert.equal(result.providerId, 'slow-good');
  assert.equal(result.reason, 'AUTO_ROUTED');
});

// Ràng buộc quan trọng nhất: miễn phí KHÔNG được thắng khi chất lượng thua thấy rõ.
test('a materially better paid provider beats a free but clearly worse one', () => {
  const result = route([
    provider('free-worse', { quality: 0.3 }),
    provider('paid-better', { quality: 0.9, adapterType: 'API', costClass: 'PAID_ALLOWED' }),
  ], { paidApi: true });
  assert.equal(result.providerId, 'paid-better');
});

test('at equal quality the zero incremental provider beats a paid one', () => {
  const result = route([
    provider('paid', { quality: 0.85, adapterType: 'API', costClass: 'PAID_ALLOWED', latencyMs: 10 }),
    provider('free', { quality: 0.85 }),
  ], { paidApi: true });
  assert.equal(result.providerId, 'free', 'cost only decides after quality is equal');
});

test('a healthy zero incremental candidate beats an equally qualified free quota one', () => {
  const result = route([
    provider('quota', { quality: 0.7, costClass: 'FREE_QUOTA', latencyMs: 10 }),
    provider('session', { quality: 0.7 }),
  ]);
  assert.equal(result.providerId, 'session');
});

test('free quota is selected when no zero incremental provider qualifies', () => {
  const result = route([
    provider('session', { quality: 0.7, enabled: false }),
    provider('quota', { quality: 0.7, costClass: 'FREE_QUOTA' }),
  ]);
  assert.equal(result.providerId, 'quota');
});

test('stability outranks speed but never outranks quality', () => {
  const shaky = { timeoutRate: 0.4, retryRate: 0.5, parseFailureRate: 0.3 };
  assert.equal(
    route([
      provider('shaky', { quality: 0.7, latencyMs: 10, health: shaky }),
      provider('steady', { quality: 0.7, latencyMs: 5000 }),
    ]).providerId,
    'steady',
  );
  assert.equal(
    route([
      provider('shaky-better', { quality: 0.95, health: shaky }),
      provider('steady-worse', { quality: 0.4 }),
    ]).providerId,
    'shaky-better',
  );
});

test('speed decides only when quality, cost and stability are all equal', () => {
  const result = route([
    provider('slow', { quality: 0.7, latencyMs: 5000 }),
    provider('fast', { quality: 0.7, latencyMs: 200 }),
  ]);
  assert.equal(result.providerId, 'fast');
  // …và chênh lệch chất lượng cỡ nhiễu thì không được lật ngược kết quả.
  const nearTie = route([
    provider('slow', { quality: 0.72, latencyMs: 5000 }),
    provider('fast', { quality: 0.70, latencyMs: 200 }),
  ]);
  assert.equal(nearTie.providerId, 'fast', 'noise-level quality differences must not decide routing');
});

// ---------------------------------------------------------------- chặn chi phí

test('a blocked paid provider is never selected automatically', () => {
  const result = route(
    [provider('blocked', { quality: 0.99, adapterType: 'API', costClass: 'PAID_BLOCKED' })],
    { paidApi: true },
  );
  assert.equal(result.providerId, null);
  assert.equal(result.reason, 'PAID_PROVIDER_BLOCKED');
});

test('paid providers require an explicit opt-in', () => {
  const providers = [provider('paid', { quality: 0.9, adapterType: 'API', costClass: 'PAID_ALLOWED' })];
  const blocked = route(providers, { paidApi: false });
  assert.equal(blocked.providerId, null);
  assert.equal(blocked.reason, 'PAID_PROVIDER_BLOCKED');
  assert.equal(route(providers, { paidApi: true }).providerId, 'paid');
});

// Không biết giá thì không được đoán là miễn phí — và cũng không được tự tiện chạy.
test('unknown cost is never treated as free and never auto-selected', () => {
  const providers = [provider('mystery', { quality: 0.99, adapterType: 'API', costClass: 'UNKNOWN_COST' })];
  assert.equal(route(providers, { paidApi: true }).providerId, null);
  assert.equal(route(providers).considered.find((c) => c.providerId === 'mystery').reason, 'UNKNOWN_COST');
  // Khóa tay vẫn chạy được: đó là quyết định có ý thức của người dùng.
  assert.equal(route(providers, { manualLocks: { global: 'mystery' } }).providerId, 'mystery');
});

// ---------------------------------------------------------------- provider chưa có quan sát

test('an unmeasured provider is neither assumed best nor frozen out forever', () => {
  const proven = provider('proven', { quality: 0.95 });
  const poor = provider('poor', { quality: 0.2 });
  const fresh = provider('fresh');
  assert.equal(route([proven, fresh]).providerId, 'proven', 'proven quality beats an unknown');
  assert.equal(route([poor, fresh]).providerId, 'fresh', 'an unknown beats a provider observed to be bad');
  assert.ok(NEUTRAL_QUALITY_BAND > 0, 'the neutral band is a declared policy constant, not a measurement');
});

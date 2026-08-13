import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderRegistry, SEED_PROVIDERS } from '../runtime/providers/registry.mjs';
import { createQualityTracker } from '../runtime/providers/quality-signals.mjs';

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

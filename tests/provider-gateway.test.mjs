import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProviderGateway, createRecordStores } from '../runtime/providers/gateway.mjs';
import { createProviderRegistry } from '../runtime/providers/registry.mjs';
import { createWorkspaceStore } from '../runtime/storage/workspace-store.mjs';

const START = '2026-08-13T00:00:00.000Z';
const END = '2026-08-13T00:00:05.000Z';

const task = (overrides = {}) => ({
  taskId: 'providertask_1',
  taskType: 'WRITE',
  contentJob: 'article',
  contextSnapshotId: 'contextsnapshot_1',
  contextBundle: { prompt: 'Write a piece about X' },
  ...overrides,
});

const providerRecord = (providerId, overrides = {}) => ({
  providerId,
  adapterType: overrides.costClass && overrides.costClass !== 'ZERO_INCREMENTAL' ? 'API' : 'BROWSER',
  costClass: 'ZERO_INCREMENTAL',
  enabled: true,
  ...overrides,
});

// Adapter giả: khai báo kết quả cho từng provider, và ghi lại nó đã bị gọi mấy lần.
function fakeAdapter(providerId, outcome) {
  const calls = [];
  return {
    providerId,
    calls,
    execute: async (t) => {
      calls.push(t);
      const value = typeof outcome === 'function' ? outcome(calls.length) : outcome;
      return {
        providerId,
        status: value.status || 'COMPLETED',
        output: value.output === undefined ? 'answer' : value.output,
        costClass: value.costClass || 'ZERO_INCREMENTAL',
        startedAt: START,
        completedAt: END,
        parseStatus: value.parseStatus || 'NOT_APPLICABLE',
        warnings: [],
        error: value.error || null,
        receipt: value.receipt === undefined ? null : value.receipt,
        modelSession: value.modelSession || null,
      };
    },
  };
}

const failure = (code, retryable) => ({
  status: 'FAILED', output: null, error: { code, message: code, retryable },
});

function harness({ providers = [], adapters = [], quality = [] } = {}) {
  const registry = createProviderRegistry(providers);
  for (const signal of quality) registry.recordQualitySignal(signal);

  const attempts = [];
  const receipts = [];
  let seq = 0;

  const gateway = createProviderGateway({
    registry,
    adapters: new Map(adapters.map((a) => [a.providerId, a])),
    attemptStore: {
      start: async (t, providerId) => {
        const attempt = { attemptId: `providerattempt_${++seq}`, taskId: t.taskId, providerId, startedAt: START, status: 'running' };
        attempts.push(attempt);
        return attempt;
      },
      finish: async (attemptId, result) => {
        const attempt = attempts.find((a) => a.attemptId === attemptId);
        attempt.status = result.status;
        attempt.endedAt = END;
      },
    },
    receiptStore: { write: async (receipt) => { receipts.push(receipt); return receipt; } },
    now: () => START,
    idFactory: (prefix) => `${prefix}_${++seq}`,
  });

  return { gateway, registry, attempts, receipts };
}

// ---------------------------------------------------------------- đường thẳng

test('a manually locked browser provider runs and returns its output', async () => {
  const chatgpt = fakeAdapter('chatgpt-web', { output: 'the article' });
  const { gateway, attempts, receipts } = harness({
    providers: [providerRecord('chatgpt-web'), providerRecord('claude-web')],
    adapters: [chatgpt, fakeAdapter('claude-web', {})],
  });

  const result = await gateway.execute(task(), { manualLocks: { global: 'chatgpt-web' } });
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.output, 'the article');
  assert.equal(result.providerId, 'chatgpt-web');
  assert.equal(attempts.length, 1);
  assert.equal(receipts.length, 1, 'every finished attempt leaves a receipt');
});

// ---------------------------------------------------------------- dự phòng

test('a retryable failure moves to the next zero incremental provider', async () => {
  const first = fakeAdapter('chatgpt-web', failure('RATE_LIMITED', true));
  const second = fakeAdapter('claude-web', { output: 'written elsewhere' });
  const { gateway, attempts } = harness({
    providers: [
      providerRecord('chatgpt-web', { latencyMs: 100 }),
      providerRecord('claude-web', { latencyMs: 200 }),
    ],
    adapters: [first, second],
  });

  const result = await gateway.execute(task(), {});
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.providerId, 'claude-web');
  assert.equal(first.calls.length, 1);
  assert.equal(second.calls.length, 1);
  assert.equal(attempts.length, 2, 'each provider gets its own attempt record');
  assert.notEqual(attempts[0].attemptId, attempts[1].attemptId);
});

// Chuyển sang hãng khác KHÔNG được đổi bối cảnh: nếu không, bài viết lần hai dựa trên
// một sự thật khác lần đầu và không ai đối chiếu được nữa.
test('fallback keeps the same task and frozen context', async () => {
  const first = fakeAdapter('chatgpt-web', failure('TIMEOUT', true));
  const second = fakeAdapter('claude-web', {});
  const { gateway, receipts } = harness({
    providers: [providerRecord('chatgpt-web'), providerRecord('claude-web')],
    adapters: [first, second],
  });

  await gateway.execute(task(), {});
  assert.equal(second.calls[0].taskId, 'providertask_1');
  assert.equal(second.calls[0].contextSnapshotId, 'contextsnapshot_1');
  assert.deepEqual(first.calls[0].contextBundle, second.calls[0].contextBundle);
  assert.deepEqual(receipts.map((r) => r.contextSnapshotId), ['contextsnapshot_1', 'contextsnapshot_1']);
});

test('a provider that already failed is never tried twice in one run', async () => {
  const only = fakeAdapter('chatgpt-web', failure('TIMEOUT', true));
  const { gateway } = harness({ providers: [providerRecord('chatgpt-web')], adapters: [only] });
  const result = await gateway.execute(task(), {});
  assert.equal(only.calls.length, 1, 'no blind retry against the same provider');
  // Hết chỗ để thử thì trả về LỖI THẬT của lần cuối, không phải "không còn provider nào":
  // người dùng cần biết nó hỏng vì sao.
  assert.equal(result.status, 'FAILED');
  assert.equal(result.error.code, 'TIMEOUT');
  assert.ok(result.warnings.some((w) => w.includes('No further providers')));
});

// Bị chặn nội dung là câu trả lời dứt khoát, không phải trục trặc. Thử lại chỉ tốn lượt
// và có thể bị gắn cờ nặng hơn.
test('a non retryable failure stops the run instead of walking every provider', async () => {
  const first = fakeAdapter('chatgpt-web', failure('CONTENT_BLOCKED', false));
  const second = fakeAdapter('claude-web', {});
  const { gateway, attempts } = harness({
    providers: [providerRecord('chatgpt-web', { latencyMs: 1 }), providerRecord('claude-web', { latencyMs: 2 })],
    adapters: [first, second],
  });

  const result = await gateway.execute(task(), {});
  assert.equal(result.status, 'FAILED');
  assert.equal(result.error.code, 'CONTENT_BLOCKED');
  assert.equal(second.calls.length, 0, 'the next provider is not tried after a definitive refusal');
  assert.equal(attempts.length, 1);
});

test('when every browser provider is unavailable a free quota api takes over', async () => {
  const api = fakeAdapter('api-v1', { output: 'from the api', costClass: 'FREE_QUOTA' });
  const { gateway } = harness({
    providers: [
      providerRecord('chatgpt-web', { enabled: false }),
      providerRecord('claude-web', { authStatus: 'AUTH_REQUIRED' }),
      providerRecord('api-v1', { adapterType: 'API', costClass: 'FREE_QUOTA' }),
    ],
    adapters: [fakeAdapter('chatgpt-web', {}), fakeAdapter('claude-web', {}), api],
  });

  const result = await gateway.execute(task(), {});
  assert.equal(result.providerId, 'api-v1');
  assert.equal(api.calls.length, 1);
});

// ---------------------------------------------------------------- tiền

test('a run that could only continue on a paid api is blocked, not billed', async () => {
  const paid = fakeAdapter('api-v1', { output: 'expensive', costClass: 'PAID_ALLOWED' });
  const { gateway, receipts } = harness({
    providers: [providerRecord('api-v1', { adapterType: 'API', costClass: 'PAID_ALLOWED' })],
    adapters: [paid],
  });

  const result = await gateway.execute(task(), { paidApi: false });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.error.code, 'PAID_PROVIDER_BLOCKED');
  assert.equal(paid.calls.length, 0, 'nothing was spent');
  assert.equal(receipts.length, 0, 'no attempt, no receipt');
});

// Quan trọng: trình duyệt hỏng KHÔNG được âm thầm biến thành một lần gọi API tính tiền.
test('a browser failure never falls back onto a paid api by itself', async () => {
  const browser = fakeAdapter('chatgpt-web', failure('TIMEOUT', true));
  const paid = fakeAdapter('api-v1', { costClass: 'PAID_ALLOWED' });
  const { gateway } = harness({
    providers: [providerRecord('chatgpt-web'), providerRecord('api-v1', { adapterType: 'API', costClass: 'PAID_ALLOWED' })],
    adapters: [browser, paid],
  });

  const result = await gateway.execute(task(), {});
  assert.equal(paid.calls.length, 0, 'the user is never billed by a fallback they did not ask for');
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.error.code, 'PAID_PROVIDER_BLOCKED');
});

test('an explicitly allowed paid api does run', async () => {
  const paid = fakeAdapter('api-v1', { output: 'paid answer', costClass: 'PAID_ALLOWED' });
  const { gateway } = harness({
    providers: [providerRecord('api-v1', { adapterType: 'API', costClass: 'PAID_ALLOWED' })],
    adapters: [paid],
  });
  const result = await gateway.execute(task(), { paidApi: true });
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.costClass, 'PAID_ALLOWED');
});

test('no configured provider at all is reported clearly', async () => {
  const { gateway } = harness({ providers: [], adapters: [] });
  const result = await gateway.execute(task(), {});
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.error.code, 'NO_ELIGIBLE_PROVIDER');
});

test('a manual lock on a provider with no adapter fails loudly', async () => {
  const { gateway } = harness({ providers: [providerRecord('chatgpt-web')], adapters: [] });
  const result = await gateway.execute(task(), { manualLocks: { global: 'chatgpt-web' } });
  assert.equal(result.status, 'FAILED');
  assert.equal(result.error.code, 'ADAPTER_NOT_REGISTERED');
});

test('an adapter that throws is contained and treated as a retryable failure', async () => {
  const broken = { providerId: 'chatgpt-web', execute: async () => { throw new Error('kaboom'); } };
  const backup = fakeAdapter('claude-web', { output: 'saved' });
  const { gateway, receipts } = harness({
    providers: [providerRecord('chatgpt-web', { latencyMs: 1 }), providerRecord('claude-web', { latencyMs: 2 })],
    adapters: [broken, backup],
  });
  const result = await gateway.execute(task(), {});
  assert.equal(result.status, 'COMPLETED');
  assert.equal(receipts[0].errorCode, 'ADAPTER_CRASHED');
});

// ---------------------------------------------------------------- biên nhận

test('receipts record the run without recording the prompt or any secret', async () => {
  const adapter = fakeAdapter('api-v1', {
    output: 'answer',
    costClass: 'FREE_QUOTA',
    receipt: { endpointHost: 'api.vendor.test', apiKey: 'sk-live-123', authorization: 'Bearer xyz', promptDigest: 'abc' },
  });
  const { gateway, receipts } = harness({
    providers: [providerRecord('api-v1', { adapterType: 'API', costClass: 'FREE_QUOTA' })],
    adapters: [adapter],
  });

  await gateway.execute(task(), {});
  const receipt = receipts[0];
  const serialized = JSON.stringify(receipt);
  assert.ok(!serialized.includes('sk-live-123'), 'a leaked key from an adapter is stripped here too');
  assert.ok(!serialized.includes('Bearer xyz'));
  assert.ok(!serialized.includes('Write a piece about X'), 'the prompt itself is never stored');

  assert.equal(receipt.providerId, 'api-v1');
  assert.equal(receipt.taskId, 'providertask_1');
  assert.equal(receipt.contextSnapshotId, 'contextsnapshot_1');
  assert.equal(receipt.costClass, 'FREE_QUOTA');
  assert.equal(receipt.outcome, 'COMPLETED');
  assert.ok(receipt.contextDigest, 'the context is identified by digest, not by copy');
  assert.equal(receipt.adapterReceipt.endpointHost, 'api.vendor.test', 'harmless adapter detail survives');
  assert.equal(receipt.adapterReceipt.promptDigest, 'abc');
});

test('the same context digests identically across providers and runs', async () => {
  const build = () => harness({
    providers: [providerRecord('chatgpt-web')],
    adapters: [fakeAdapter('chatgpt-web', {})],
  });
  const a = build();
  const b = build();
  await a.gateway.execute(task(), {});
  await b.gateway.execute(task(), {});
  await b.gateway.execute(task({ contextBundle: { prompt: 'different' } }), {});
  assert.equal(a.receipts[0].contextDigest, b.receipts[0].contextDigest);
  assert.notEqual(b.receipts[0].contextDigest, b.receipts[1].contextDigest);
});

// ---------------------------------------------------------------- tín hiệu quan sát

test('transport outcomes update health but never claim anything about writing quality', async () => {
  const { gateway, registry } = harness({
    providers: [providerRecord('chatgpt-web')],
    adapters: [fakeAdapter('chatgpt-web', { output: 'answer' })],
  });

  await gateway.execute(task(), {});
  const provider = registry.get('chatgpt-web');
  assert.equal(provider.health.availability, 'UP');
  assert.equal(provider.health.auth, 'AUTHENTICATED');
  // Gọi được không có nghĩa là viết hay. Chất lượng chỉ đến từ đánh giá/phản hồi người dùng.
  assert.deepEqual(provider.qualityByJob, {}, 'a successful call is not evidence of good writing');
});

test('an auth failure is recorded so the router stops choosing that provider', async () => {
  const { gateway, registry } = harness({
    providers: [providerRecord('chatgpt-web')],
    adapters: [fakeAdapter('chatgpt-web', failure('AUTH_REQUIRED', false))],
  });
  await gateway.execute(task(), {});
  assert.equal(registry.get('chatgpt-web').health.auth, 'AUTH_REQUIRED');
});

// ---------------------------------------------------------------- lưu trữ thật

test('attempts and receipts persist as immutable records', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'seosona-gateway-'));
  try {
    const store = createWorkspaceStore({ rootDir });
    let seq = 0;
    const stores = createRecordStores({
      store, workspaceId: 'workspace_local', now: () => START, idFactory: (p) => `${p}_${++seq}`,
    });
    const registry = createProviderRegistry([providerRecord('chatgpt-web')]);
    const gateway = createProviderGateway({
      registry,
      adapters: new Map([['chatgpt-web', fakeAdapter('chatgpt-web', { output: 'answer' })]]),
      ...stores,
      now: () => START,
    });

    const result = await gateway.execute(task(), {});
    assert.equal(result.status, 'COMPLETED');

    const attempts = await store.list('providerAttempt', 'workspace_local');
    const receipts = await store.list('providerReceipt', 'workspace_local');
    assert.equal(attempts.length, 1);
    assert.equal(receipts.length, 1);
    assert.equal(attempts[0].provider, 'chatgpt-web');
    assert.equal(attempts[0].status, 'COMPLETED');

    // Biên nhận là bằng chứng: sửa được thì không còn là bằng chứng.
    await assert.rejects(
      () => store.put('providerReceipt', 'workspace_local', { ...receipts[0], outcome: 'FAILED' }),
      (e) => e.code === 'IMMUTABLE_RECORD_CONFLICT',
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

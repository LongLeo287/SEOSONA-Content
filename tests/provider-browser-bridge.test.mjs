import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBrowserJobBridge, createFileJobPersistence } from '../runtime/http/extension-bridge.mjs';
import { createRuntimeServer } from '../runtime/http/server.mjs';

const TOKEN = 'a'.repeat(40);
const EXT_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

// Đồng hồ giả: lease là chuyện thời gian, test không được phụ thuộc đồng hồ thật.
function fakeClock(startMs = Date.parse('2026-08-13T00:00:00.000Z')) {
  let ms = startMs;
  return { now: () => new Date(ms).toISOString(), advance: (delta) => { ms += delta; } };
}

const job = (overrides = {}) => ({
  taskId: 'providertask_1',
  providerId: 'chatgpt-web',
  payload: { prompt: 'Write about X', outputContract: {} },
  ...overrides,
});

// ================================================================ Hàng đợi & lease

test('an enqueued job is pending and is handed out exactly once', async () => {
  const bridge = createBrowserJobBridge({ now: fakeClock().now });
  await bridge.enqueue(job());
  assert.equal((await bridge.get('providertask_1')).status, 'PENDING');

  const first = await bridge.claimNext({ claimant: 'ext-a' });
  assert.equal(first.taskId, 'providertask_1');
  assert.equal(first.status, 'LEASED');
  assert.equal(await bridge.claimNext({ claimant: 'ext-b' }), null, 'a leased job is not handed out twice');
});

test('enqueueing the same task id twice does not duplicate the job', async () => {
  const bridge = createBrowserJobBridge({ now: fakeClock().now });
  await bridge.enqueue(job());
  await bridge.enqueue(job({ payload: { prompt: 'different' } }));
  assert.equal((await bridge.list()).length, 1);
  assert.equal((await bridge.get('providertask_1')).payload.prompt, 'Write about X', 'the first enqueue wins');
});

test('jobs are handed out in the order they were enqueued', async () => {
  const bridge = createBrowserJobBridge({ now: fakeClock().now });
  await bridge.enqueue(job({ taskId: 'providertask_1' }));
  await bridge.enqueue(job({ taskId: 'providertask_2' }));
  assert.equal((await bridge.claimNext({ claimant: 'a' })).taskId, 'providertask_1');
  assert.equal((await bridge.claimNext({ claimant: 'a' })).taskId, 'providertask_2');
});

// Extension có thể bị Chrome tắt service worker giữa chừng. Không có lease hết hạn thì
// job đó treo vĩnh viễn và người dùng ngồi đợi một việc không còn ai làm.
test('an expired lease returns the job to the queue', async () => {
  const clock = fakeClock();
  const bridge = createBrowserJobBridge({ now: clock.now, leaseMs: 30_000 });
  await bridge.enqueue(job());
  await bridge.claimNext({ claimant: 'dead-worker' });

  clock.advance(29_000);
  assert.equal(await bridge.claimNext({ claimant: 'other' }), null, 'a live lease is respected');

  clock.advance(2_000);
  const reclaimed = await bridge.claimNext({ claimant: 'other' });
  assert.equal(reclaimed.taskId, 'providertask_1');
  assert.equal(reclaimed.attempts, 2, 'the retake is counted');
});

test('only the lease owner can renew or submit', async () => {
  const clock = fakeClock();
  const bridge = createBrowserJobBridge({ now: clock.now, leaseMs: 30_000 });
  await bridge.enqueue(job());
  await bridge.claimNext({ claimant: 'owner' });

  await assert.rejects(() => bridge.renewLease('providertask_1', { claimant: 'thief' }), (e) => e.code === 'LEASE_LOST');
  await assert.rejects(
    () => bridge.submitResult('providertask_1', { status: 'COMPLETED', output: 'x' }, { claimant: 'thief' }),
    (e) => e.code === 'LEASE_LOST',
  );

  clock.advance(20_000);
  const renewed = await bridge.renewLease('providertask_1', { claimant: 'owner' });
  assert.equal(Date.parse(renewed.leaseExpiresAt) - Date.parse(clock.now()), 30_000, 'the lease window restarts');
});

test('a long response keeps its job through repeated renewals', async () => {
  const clock = fakeClock();
  const bridge = createBrowserJobBridge({ now: clock.now, leaseMs: 30_000 });
  await bridge.enqueue(job());
  await bridge.claimNext({ claimant: 'owner' });
  for (let i = 0; i < 10; i += 1) {
    clock.advance(25_000);
    await bridge.renewLease('providertask_1', { claimant: 'owner' });
  }
  assert.equal(await bridge.claimNext({ claimant: 'other' }), null, 'still owned after 250 seconds of work');
});

test('submitting a result completes the job and is idempotent', async () => {
  const bridge = createBrowserJobBridge({ now: fakeClock().now });
  await bridge.enqueue(job());
  await bridge.claimNext({ claimant: 'owner' });

  const first = await bridge.submitResult('providertask_1', { status: 'COMPLETED', output: 'answer' }, { claimant: 'owner' });
  assert.equal(first.status, 'COMPLETED');

  // Extension gửi lại vì mất mạng lúc nhận phản hồi: nhận đúng kết quả cũ, không ghi đè.
  const again = await bridge.submitResult('providertask_1', { status: 'COMPLETED', output: 'different' }, { claimant: 'owner' });
  assert.equal(again.result.output, 'answer', 'a replayed submission must not overwrite the stored result');
  assert.equal(again.duplicate, true);
  assert.equal(await bridge.claimNext({ claimant: 'other' }), null, 'a completed job never returns to the queue');
});

test('a cancelled job is never handed out and refuses a late result', async () => {
  const bridge = createBrowserJobBridge({ now: fakeClock().now });
  await bridge.enqueue(job());
  await bridge.cancel('providertask_1');
  assert.equal((await bridge.get('providertask_1')).status, 'CANCELLED');
  assert.equal(await bridge.claimNext({ claimant: 'a' }), null);
});

test('cancelling in flight is observed by the worker on its next call', async () => {
  const bridge = createBrowserJobBridge({ now: fakeClock().now });
  await bridge.enqueue(job());
  await bridge.claimNext({ claimant: 'owner' });
  await bridge.cancel('providertask_1');

  await assert.rejects(() => bridge.renewLease('providertask_1', { claimant: 'owner' }), (e) => e.code === 'TASK_CANCELLED');
  await assert.rejects(
    () => bridge.submitResult('providertask_1', { status: 'COMPLETED', output: 'x' }, { claimant: 'owner' }),
    (e) => e.code === 'TASK_CANCELLED',
  );
});

test('unknown task ids are reported, not silently ignored', async () => {
  const bridge = createBrowserJobBridge({ now: fakeClock().now });
  await assert.rejects(() => bridge.renewLease('ghost', { claimant: 'a' }), (e) => e.code === 'TASK_NOT_FOUND');
  await assert.rejects(() => bridge.cancel('ghost'), (e) => e.code === 'TASK_NOT_FOUND');
  assert.equal(await bridge.get('ghost'), null);
});

// Hàng đợi này nằm trên đĩa. Cookie hay token của trang AI mà lọt vào đây là ta tự tay
// tạo ra một file chứa thông tin đăng nhập của người dùng.
test('credentials are refused before they can reach the persisted queue', async () => {
  const bridge = createBrowserJobBridge({ now: fakeClock().now });
  for (const payload of [
    { cookie: 'session=1' },
    { auth: { apiKey: 'sk-live-123' } },
    { headers: { Authorization: 'Bearer x' } },
    { nested: [{ password: 'hunter2' }] },
  ]) {
    await assert.rejects(
      () => bridge.enqueue(job({ payload })),
      (e) => e.code === 'CREDENTIAL_IN_QUEUE',
      `${JSON.stringify(payload)} must be refused`,
    );
  }
  assert.equal((await bridge.list()).length, 0);
});

test('the queue validates its input', async () => {
  const bridge = createBrowserJobBridge({ now: fakeClock().now });
  await assert.rejects(() => bridge.enqueue({ providerId: 'chatgpt-web' }), /taskId/);
  await assert.rejects(() => bridge.enqueue({ taskId: 'x' }), /providerId/);
});

// ================================================================ Sống sót qua khởi động lại

test('the queue survives a runtime restart', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'seosona-bridge-'));
  try {
    const clock = fakeClock();
    {
      const bridge = createBrowserJobBridge({
        now: clock.now, persistence: createFileJobPersistence({ rootDir }),
      });
      await bridge.enqueue(job({ taskId: 'providertask_pending' }));
      await bridge.enqueue(job({ taskId: 'providertask_leased' }));
      await bridge.claimNext({ claimant: 'owner' });
      await bridge.claimNext({ claimant: 'owner' });
      await bridge.submitResult('providertask_pending', { status: 'COMPLETED', output: 'kept' }, { claimant: 'owner' });
    }
    {
      const bridge = createBrowserJobBridge({
        now: clock.now, persistence: createFileJobPersistence({ rootDir }),
      });
      assert.equal((await bridge.get('providertask_pending')).result.output, 'kept', 'results survive a restart');
      assert.equal((await bridge.get('providertask_leased')).status, 'LEASED');

      // Runtime khởi động lại thì worker cũ chắc chắn đã mất. Lease cũ hết hạn -> nhận lại được.
      clock.advance(31_000);
      assert.equal((await bridge.claimNext({ claimant: 'fresh' })).taskId, 'providertask_leased');
    }
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

// ================================================================ Endpoint HTTP

let nonceSeq = 0;
const nextNonce = () => `nonce${String(++nonceSeq).padStart(16, '0')}`;

async function withServer(fn) {
  const rootDir = await mkdtemp(join(tmpdir(), 'seosona-bridge-http-'));
  const server = createRuntimeServer({ rootDir, token: TOKEN, extensionOrigin: EXT_ORIGIN });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, { method = 'GET', body, headers = {} } = {}) => fetch(`${base}${path}`, {
    method,
    headers: {
      origin: EXT_ORIGIN,
      authorization: `Bearer ${TOKEN}`,
      'x-seosona-nonce': nextNonce(),
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  try {
    await fn({ call, base });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(rootDir, { recursive: true, force: true });
  }
}

test('the extension can enqueue, claim, renew and complete over HTTP', async () => {
  await withServer(async ({ call }) => {
    const created = await call('/v1/provider/browser/jobs', { method: 'POST', body: job() });
    assert.equal(created.status, 201);

    const claimed = await call('/v1/provider/browser/jobs/next');
    assert.equal(claimed.status, 200);
    const claimedJob = await claimed.json();
    assert.equal(claimedJob.taskId, 'providertask_1');
    assert.ok(claimedJob.leaseToken, 'the claim returns a lease token identifying the owner');

    const renewed = await call('/v1/provider/browser/jobs/providertask_1/lease', {
      method: 'POST', body: { leaseToken: claimedJob.leaseToken },
    });
    assert.equal(renewed.status, 200);

    const done = await call('/v1/provider/browser/jobs/providertask_1/result', {
      method: 'POST',
      body: { leaseToken: claimedJob.leaseToken, result: { status: 'COMPLETED', output: 'answer' } },
    });
    assert.equal(done.status, 200);
    assert.equal((await done.json()).status, 'COMPLETED');
  });
});

test('an empty queue answers cheaply instead of erroring', async () => {
  await withServer(async ({ call }) => {
    const res = await call('/v1/provider/browser/jobs/next');
    assert.equal(res.status, 204, 'polling an empty queue is a no-content answer, not a 404');
  });
});

test('a stolen lease token is rejected over HTTP', async () => {
  await withServer(async ({ call }) => {
    await call('/v1/provider/browser/jobs', { method: 'POST', body: job() });
    await call('/v1/provider/browser/jobs/next');
    const res = await call('/v1/provider/browser/jobs/providertask_1/result', {
      method: 'POST', body: { leaseToken: 'not-the-owner', result: { status: 'COMPLETED', output: 'x' } },
    });
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error.code, 'LEASE_LOST');
  });
});

test('cancellation is visible to the worker over HTTP', async () => {
  await withServer(async ({ call }) => {
    await call('/v1/provider/browser/jobs', { method: 'POST', body: job() });
    const claimed = await (await call('/v1/provider/browser/jobs/next')).json();
    assert.equal((await call('/v1/provider/browser/jobs/providertask_1/cancel', { method: 'POST' })).status, 200);

    const res = await call('/v1/provider/browser/jobs/providertask_1/lease', {
      method: 'POST', body: { leaseToken: claimed.leaseToken },
    });
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error.code, 'TASK_CANCELLED');
  });
});

test('a wrong origin or token cannot touch the browser job queue', async () => {
  await withServer(async ({ call }) => {
    const badOrigin = await call('/v1/provider/browser/jobs/next', { headers: { origin: 'https://evil.test' } });
    assert.equal(badOrigin.status, 403);
    const badToken = await call('/v1/provider/browser/jobs/next', { headers: { authorization: 'Bearer wrong' } });
    assert.equal(badToken.status, 401);
  });
});

// Studio là trang web mở trong trình duyệt. Nó không phải worker và không được nhận job
// trình duyệt — nếu nhận được thì một tab bất kỳ có thể rút job ra rồi không bao giờ trả về.
test('a studio session cannot claim browser provider jobs', async () => {
  await withServer(async ({ base }) => {
    const page = await fetch(`${base}/`);
    const cookie = page.headers.getSetCookie().join('; ').split(';')[0];
    const res = await fetch(`${base}/v1/provider/browser/jobs/next`, { headers: { cookie } });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error.code, 'EXTENSION_ONLY');
  });
});

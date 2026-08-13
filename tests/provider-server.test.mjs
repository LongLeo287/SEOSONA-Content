import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuntimeServer } from '../runtime/http/server.mjs';
import { createBrowserBridgeAdapter } from '../runtime/providers/browser-bridge-adapter.mjs';
import { createBrowserJobBridge } from '../runtime/http/extension-bridge.mjs';
import { createApiHttpAdapter } from '../runtime/providers/api-http-adapter.mjs';

const TOKEN = 'a'.repeat(40);
const EXT_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

let nonceSeq = 0;
const nextNonce = () => `nonce${String(++nonceSeq).padStart(16, '0')}`;

const task = (overrides = {}) => ({
  taskId: 'providertask_1',
  taskType: 'WRITE',
  contentJob: 'article',
  contextSnapshotId: 'contextsnapshot_1',
  contextBundle: { prompt: 'Write about X' },
  ...overrides,
});

function stubAdapter(providerId, outcome = {}) {
  const calls = [];
  return {
    providerId,
    calls,
    execute: async (t) => {
      calls.push(t);
      return {
        providerId,
        status: outcome.status || 'COMPLETED',
        output: outcome.output === undefined ? `answer from ${providerId}` : outcome.output,
        costClass: outcome.costClass || 'ZERO_INCREMENTAL',
        startedAt: '2026-08-13T00:00:00.000Z',
        completedAt: '2026-08-13T00:00:01.000Z',
        parseStatus: 'NOT_APPLICABLE',
        warnings: [],
        error: outcome.error || null,
        receipt: null,
        modelSession: null,
      };
    },
  };
}

async function withServer(fn, opts = {}) {
  const rootDir = await mkdtemp(join(tmpdir(), 'seosona-provider-http-'));
  const server = createRuntimeServer({ rootDir, token: TOKEN, extensionOrigin: EXT_ORIGIN, ...opts });
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

// ---------------------------------------------------------------- liệt kê & cấu hình

test('the provider list reports configuration and observed state', async () => {
  await withServer(async ({ call }) => {
    const res = await call('/v1/providers');
    assert.equal(res.status, 200);
    const { providers } = await res.json();
    assert.deepEqual(
      providers.map((p) => p.providerId).sort(),
      ['api-v1', 'chatgpt-web', 'claude-web', 'gemini-web', 'grok-web'],
    );
    const chatgpt = providers.find((p) => p.providerId === 'chatgpt-web');
    assert.equal(chatgpt.costClass, 'ZERO_INCREMENTAL');
    assert.deepEqual(chatgpt.qualityByJob, {}, 'no invented ratings are served to the UI');
    assert.equal(chatgpt.health.availability, 'UNKNOWN');
  });
});

test('a provider can be disabled and the change survives a restart', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'seosona-provider-cfg-'));
  try {
    const start = async () => {
      const server = createRuntimeServer({ rootDir, token: TOKEN, extensionOrigin: EXT_ORIGIN });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const base = `http://127.0.0.1:${server.address().port}`;
      const call = (path, init = {}) => fetch(`${base}${path}`, {
        method: init.method || 'GET',
        headers: {
          origin: EXT_ORIGIN, authorization: `Bearer ${TOKEN}`, 'x-seosona-nonce': nextNonce(),
          ...(init.body ? { 'content-type': 'application/json' } : {}),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
      return { server, call };
    };

    const first = await start();
    const patched = await first.call('/v1/providers/grok-web', { method: 'PATCH', body: { enabled: false } });
    assert.equal(patched.status, 200);
    assert.equal((await patched.json()).enabled, false);
    await new Promise((resolve) => first.server.close(resolve));

    const second = await start();
    const { providers } = await (await second.call('/v1/providers')).json();
    assert.equal(providers.find((p) => p.providerId === 'grok-web').enabled, false, 'settings are not lost on restart');
    await new Promise((resolve) => second.server.close(resolve));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

// Cấu hình provider nằm trên đĩa. Nhận khóa ở đây là tự tay tạo ra file chứa bí mật.
test('the settings endpoint refuses raw secrets and only stores a reference', async () => {
  await withServer(async ({ call }) => {
    for (const body of [{ apiKey: 'sk-live-1' }, { token: 'abc' }, { credentials: { password: 'x' } }]) {
      const res = await call('/v1/providers/api-v1', { method: 'PATCH', body });
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal((await res.json()).error.code, 'SECRET_NOT_ACCEPTED');
    }
    const ok = await call('/v1/providers/api-v1', { method: 'PATCH', body: { secretRef: 'env:SEOSONA_API_KEY' } });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).secretRef, 'env:SEOSONA_API_KEY');
  });
});

test('patching an unknown provider is a 404', async () => {
  await withServer(async ({ call }) => {
    const res = await call('/v1/providers/nope', { method: 'PATCH', body: { enabled: false } });
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error.code, 'PROVIDER_NOT_FOUND');
  });
});

// ---------------------------------------------------------------- xem trước tuyến

test('route preview explains the choice without running anything', async () => {
  const chatgpt = stubAdapter('chatgpt-web');
  await withServer(async ({ call }) => {
    const res = await call('/v1/providers/route-preview', { method: 'POST', body: { task: task() } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.providerId, 'a provider is proposed');
    assert.equal(body.reason, 'AUTO_ROUTED');
    assert.ok(body.considered.length >= 4, 'the rejected candidates are explained too');
    assert.equal(chatgpt.calls.length, 0, 'preview never executes');
  }, { adapters: new Map([['chatgpt-web', chatgpt]]) });
});

test('route preview reports a paid only situation instead of proposing a bill', async () => {
  await withServer(async ({ call }) => {
    for (const id of ['chatgpt-web', 'claude-web', 'gemini-web', 'grok-web']) {
      await call(`/v1/providers/${id}`, { method: 'PATCH', body: { enabled: false } });
    }
    await call('/v1/providers/api-v1', { method: 'PATCH', body: { enabled: true, costClass: 'PAID_ALLOWED' } });

    const res = await call('/v1/providers/route-preview', { method: 'POST', body: { task: task() } });
    const body = await res.json();
    assert.equal(body.providerId, null);
    assert.equal(body.reason, 'PAID_PROVIDER_BLOCKED');
  });
});

// ---------------------------------------------------------------- chạy thật qua Gateway

test('a provider task runs through the gateway and records an attempt', async () => {
  const chatgpt = stubAdapter('chatgpt-web', { output: 'the article' });
  await withServer(async ({ call }) => {
    const res = await call('/v1/provider-tasks', {
      method: 'POST', body: { task: task(), policy: { manualLocks: { global: 'chatgpt-web' } } },
    });
    assert.equal(res.status, 200);
    const result = await res.json();
    assert.equal(result.status, 'COMPLETED');
    assert.equal(result.output, 'the article');
    assert.equal(result.providerId, 'chatgpt-web');
    assert.ok(result.attemptId);
  }, { adapters: new Map([['chatgpt-web', chatgpt]]) });
});

test('an invalid provider task is rejected with a stable envelope', async () => {
  await withServer(async ({ call }) => {
    const res = await call('/v1/provider-tasks', { method: 'POST', body: { task: { taskId: 'x' } } });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, 'INVALID_TASK');
  });
});

// Ràng buộc quan trọng nhất của cả kế hoạch: không có đường nào để một request bình thường
// tự động tiêu tiền của người dùng.
test('a paid provider cannot be triggered without an explicit opt in', async () => {
  const paid = stubAdapter('api-v1', { costClass: 'PAID_ALLOWED' });
  await withServer(async ({ call }) => {
    for (const id of ['chatgpt-web', 'claude-web', 'gemini-web', 'grok-web']) {
      await call(`/v1/providers/${id}`, { method: 'PATCH', body: { enabled: false } });
    }
    await call('/v1/providers/api-v1', { method: 'PATCH', body: { enabled: true, costClass: 'PAID_ALLOWED' } });

    const blockedRun = await call('/v1/provider-tasks', { method: 'POST', body: { task: task() } });
    assert.equal((await blockedRun.json()).error.code, 'PAID_PROVIDER_BLOCKED');
    assert.equal(paid.calls.length, 0, 'nothing was billed');

    const allowed = await call('/v1/provider-tasks', {
      method: 'POST', body: { task: task(), policy: { paidApi: true } },
    });
    assert.equal((await allowed.json()).status, 'COMPLETED');
    assert.equal(paid.calls.length, 1, 'it runs only once the user says yes');
  }, { adapters: new Map([['api-v1', paid]]) });
});

test('provider endpoints stay behind runtime auth', async () => {
  await withServer(async ({ call }) => {
    assert.equal((await call('/v1/providers', { headers: { origin: 'https://evil.test' } })).status, 403);
    assert.equal((await call('/v1/providers', { headers: { authorization: 'Bearer wrong' } })).status, 401);
  });
});

// ================================================================ Nghiệm thu trung lập

// Cùng MỘT ProviderTask, không sửa một dòng nào của task hay tầng miền, chạy qua hai đường
// hoàn toàn khác nhau: một tab trình duyệt và một endpoint HTTP.
test('the same provider task runs through both a browser and an api adapter', async () => {
  const shared = task();

  const bridge = createBrowserJobBridge({ now: () => new Date().toISOString() });
  const browser = createBrowserBridgeAdapter({ providerId: 'chatgpt-web', bridge, pollMs: 1 });
  // Extension đóng vai worker: nhận job rồi trả kết quả.
  const worker = (async () => {
    for (let i = 0; i < 200; i += 1) {
      const claimed = await bridge.claimNext({ claimant: 'test-worker' });
      if (claimed) {
        await bridge.submitResult(claimed.taskId, {
          status: 'COMPLETED', code: 'COMPLETED', output: 'written in a browser tab',
          chatUrl: 'https://chatgpt.com/c/1', modelState: 'Thinking', elapsedMs: 4200,
        }, { claimant: 'test-worker' });
        return;
      }
      await new Promise((r) => setTimeout(r, 1));
    }
  })();

  const browserResult = await browser.execute(shared);
  await worker;

  const api = createApiHttpAdapter({
    providerId: 'api-v1',
    endpoint: 'https://api.vendor.test/v1/responses',
    model: 'vendor-large',
    credentialProvider: async () => 'sk-test',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ output_text: 'written through an api' }) }),
    costResolver: () => 'FREE_QUOTA',
  });
  const apiResult = await api.execute(shared);

  assert.equal(browserResult.status, 'COMPLETED');
  assert.equal(apiResult.status, 'COMPLETED');
  assert.equal(browserResult.output, 'written in a browser tab');
  assert.equal(apiResult.output, 'written through an api');

  // Hai đường khác nhau, cùng một hình dạng kết quả — đó là điều cần chứng minh.
  const shape = (r) => Object.keys(r).sort();
  assert.deepEqual(shape(browserResult), shape(apiResult));
  assert.equal(browserResult.costClass, 'ZERO_INCREMENTAL', 'a logged-in tab costs nothing extra');
  assert.equal(apiResult.costClass, 'FREE_QUOTA');
  assert.deepEqual(shared, task(), 'the task itself was never modified by either adapter');
});

test('a browser task that forbids remote providers is blocked before it is queued', async () => {
  const bridge = createBrowserJobBridge({ now: () => new Date().toISOString() });
  const browser = createBrowserBridgeAdapter({ providerId: 'chatgpt-web', bridge, pollMs: 1 });
  const result = await browser.execute(task({ privacyPolicy: { allowRemote: false } }));
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.error.code, 'REMOTE_NOT_ALLOWED');
  assert.equal((await bridge.list()).length, 0, 'private content never entered the queue');
});

// Hết giờ mà bỏ lửng job thì lát nữa có worker nhặt lại, trong khi Gateway đã chuyển sang
// provider khác — người dùng nhận hai bài viết cho một yêu cầu.
test('a timed out browser task is cancelled in the queue, not abandoned', async () => {
  const bridge = createBrowserJobBridge({ now: () => new Date().toISOString() });
  const browser = createBrowserBridgeAdapter({ providerId: 'chatgpt-web', bridge, pollMs: 1 });
  const result = await browser.execute(task({ timeoutMs: 5 }));
  assert.equal(result.error.code, 'TIMEOUT');
  assert.equal(result.error.retryable, true);
  assert.equal((await bridge.get('providertask_1')).status, 'CANCELLED');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiHttpAdapter } from '../runtime/providers/api-http-adapter.mjs';
import { assertProviderResult } from '../runtime/providers/contracts.mjs';

const NOW = ['2026-08-13T00:00:00.000Z', '2026-08-13T00:00:02.000Z'];

const task = (overrides = {}) => ({
  taskId: 'providertask_1',
  taskType: 'WRITE',
  contentJob: 'article',
  contextSnapshotId: 'contextsnapshot_1',
  contextBundle: { prompt: 'Write about X' },
  ...overrides,
});

function adapter({ respond, credential = 'sk-live-secret-value', cost, ...rest } = {}) {
  const calls = [];
  let tick = 0;
  return {
    calls,
    instance: createApiHttpAdapter({
      providerId: 'api-v1',
      endpoint: 'https://api.vendor.test/v1/responses',
      model: 'vendor-large',
      credentialProvider: async () => credential,
      fetchImpl: async (url, init) => {
        calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null, signal: init.signal });
        if (respond instanceof Error) throw respond;
        return typeof respond === 'function' ? respond(calls.length) : respond;
      },
      costResolver: cost,
      now: () => NOW[Math.min(tick++, NOW.length - 1)],
      ...rest,
    }),
  };
}

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const httpError = (status, body = {}) => ({ ok: false, status, json: async () => body });
const completion = { output_text: 'the answer' };

// ---------------------------------------------------------------- yêu cầu gửi đi

test('the request carries the bearer credential and the mapped payload', async () => {
  const { instance, calls } = adapter({ respond: ok(completion) });
  await instance.execute(task());

  assert.equal(calls[0].url, 'https://api.vendor.test/v1/responses');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer sk-live-secret-value');
  assert.equal(calls[0].body.model, 'vendor-large');
  assert.deepEqual(calls[0].body.input, [{ role: 'user', content: 'Write about X' }]);
  assert.equal(calls[0].body.response_format, undefined, 'no schema, no response_format');
});

test('an output contract with a schema is passed through to the vendor', async () => {
  const jsonSchema = { name: 'article', schema: { type: 'object' } };
  const { instance, calls } = adapter({ respond: ok(completion) });
  await instance.execute(task({ outputContract: { jsonSchema } }));
  assert.deepEqual(calls[0].body.response_format, { type: 'json_schema', json_schema: jsonSchema });
});

// Bí mật lấy ở thời điểm chạy. Không giữ trong biến của adapter, không ghi xuống đĩa —
// nên đổi khóa là có hiệu lực ngay, và một adapter nằm im không ôm sẵn khóa nào cả.
test('the credential is fetched per execution, never cached in the adapter', async () => {
  let reads = 0;
  const instance = createApiHttpAdapter({
    providerId: 'api-v1',
    endpoint: 'https://api.vendor.test/v1/responses',
    model: 'vendor-large',
    credentialProvider: async () => { reads += 1; return `sk-${reads}`; },
    fetchImpl: async () => ok(completion),
    now: () => NOW[0],
  });
  await instance.execute(task());
  await instance.execute(task());
  assert.equal(reads, 2, 'each run asks for the secret again');
});

test('a missing credential fails before any request is sent', async () => {
  const { instance, calls } = adapter({ respond: ok(completion), credential: '' });
  const result = await instance.execute(task());
  assert.equal(result.status, 'FAILED');
  assert.equal(result.error.code, 'AUTH_REQUIRED');
  assert.equal(result.error.retryable, false);
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------- kết quả

test('a successful call produces a valid provider result', async () => {
  const { instance } = adapter({ respond: ok(completion) });
  const result = await instance.execute(task());
  assert.doesNotThrow(() => assertProviderResult(result), 'the adapter honours the shared contract');
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.output, 'the answer');
  assert.equal(result.providerId, 'api-v1');
  assert.equal(result.modelSession.model, 'vendor-large');
  assert.equal(result.startedAt, NOW[0]);
  assert.equal(result.completedAt, NOW[1]);
});

test('http failures map onto typed retryable errors', async () => {
  const cases = [
    [429, 'RATE_LIMITED', true],
    [401, 'AUTH_REQUIRED', false],
    [403, 'AUTH_REQUIRED', false],
    [400, 'INVALID_REQUEST', false],
    [500, 'PROVIDER_ERROR', true],
    [503, 'PROVIDER_ERROR', true],
  ];
  for (const [status, code, retryable] of cases) {
    const { instance } = adapter({ respond: httpError(status, { error: { message: 'boom' } }) });
    const result = await instance.execute(task());
    assert.equal(result.status, 'FAILED', `HTTP ${status}`);
    assert.equal(result.error.code, code, `HTTP ${status}`);
    assert.equal(result.error.retryable, retryable, `HTTP ${status} retryable`);
  }
});

test('a malformed vendor response is an invalid output, not a crash', async () => {
  const { instance } = adapter({ respond: { ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } } });
  const result = await instance.execute(task());
  assert.equal(result.error.code, 'INVALID_PROVIDER_OUTPUT');
  assert.equal(result.parseStatus, 'INVALID');
});

test('a response with no usable text is reported instead of returning an empty success', async () => {
  const { instance } = adapter({ respond: ok({ id: 'resp_1' }) });
  const result = await instance.execute(task());
  assert.equal(result.status, 'FAILED');
  assert.equal(result.error.code, 'INVALID_PROVIDER_OUTPUT');
});

test('a transport failure is retryable, not fatal', async () => {
  const { instance } = adapter({ respond: new Error('ECONNRESET') });
  const result = await instance.execute(task());
  assert.equal(result.error.code, 'PROVIDER_UNAVAILABLE');
  assert.equal(result.error.retryable, true);
});

// Timeout phải HUỶ THẬT request. Chỉ trả lỗi mà để kết nối chạy tiếp là vẫn tốn tiền
// cho một câu trả lời không ai đọc.
test('the task timeout aborts the request in flight', async () => {
  let signal = null;
  const instance = createApiHttpAdapter({
    providerId: 'api-v1',
    endpoint: 'https://api.vendor.test/v1/responses',
    model: 'vendor-large',
    credentialProvider: async () => 'sk-1',
    fetchImpl: (url, init) => new Promise((_, reject) => {
      signal = init.signal;
      init.signal.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    }),
    now: () => NOW[0],
  });
  const result = await instance.execute(task({ timeoutMs: 20 }));
  assert.equal(result.error.code, 'TIMEOUT');
  assert.equal(result.error.retryable, true);
  assert.equal(signal.aborted, true, 'the connection is actually cancelled, not just abandoned');
});

// ---------------------------------------------------------------- chi phí

test('cost defaults to UNKNOWN_COST when nothing has resolved it', async () => {
  const { instance } = adapter({ respond: ok(completion) });
  assert.equal((await instance.execute(task())).costClass, 'UNKNOWN_COST');
});

test('a cost resolver decides the class and must return an allowed one', async () => {
  const free = adapter({ respond: ok(completion), cost: () => 'FREE_QUOTA' });
  assert.equal((await free.instance.execute(task())).costClass, 'FREE_QUOTA');

  const bogus = adapter({ respond: ok(completion), cost: () => 'CHEAP' });
  const result = await bogus.instance.execute(task());
  assert.equal(result.costClass, 'UNKNOWN_COST', 'an invalid class degrades to unknown, never to free');
  assert.ok(result.warnings.some((w) => w.includes('costResolver')));
});

test('a paid provider refuses to run unless the task allows paying', async () => {
  const paid = adapter({ respond: ok(completion), cost: () => 'PAID_ALLOWED' });
  const blocked = await paid.instance.execute(task());
  assert.equal(blocked.status, 'BLOCKED');
  assert.equal(blocked.error.code, 'PAID_PROVIDER_BLOCKED');
  assert.equal(paid.calls.length, 0, 'nothing was billed');

  const allowed = adapter({ respond: ok(completion), cost: () => 'PAID_ALLOWED' });
  const result = await allowed.instance.execute(task({ costPolicy: { paidApi: true } }));
  assert.equal(result.status, 'COMPLETED');
});

test('a task that forbids remote providers is refused outright', async () => {
  const { instance, calls } = adapter({ respond: ok(completion) });
  const result = await instance.execute(task({ privacyPolicy: { allowRemote: false } }));
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.error.code, 'REMOTE_NOT_ALLOWED');
  assert.equal(calls.length, 0, 'private content never reaches a remote vendor');
});

// ---------------------------------------------------------------- biên nhận

// Biên nhận đi vào lưu trữ. Có key hay prompt đầy đủ trong đó là ta tự tạo ra chỗ rò rỉ.
test('the receipt records what happened without recording any secret', async () => {
  const { instance } = adapter({ respond: ok(completion) });
  const result = await instance.execute(task());
  const serialized = JSON.stringify(result.receipt);

  assert.ok(!serialized.includes('sk-live-secret-value'), 'the api key must never appear');
  assert.ok(!serialized.includes('Write about X'), 'the full prompt must never appear');
  assert.equal(result.receipt.providerId, 'api-v1');
  assert.equal(result.receipt.contextSnapshotId, 'contextsnapshot_1');
  assert.equal(result.receipt.endpointHost, 'api.vendor.test', 'the host is kept, the path and body are not');
  assert.ok(result.receipt.promptDigest, 'a digest lets two runs be compared without storing the text');
  assert.equal(result.receipt.promptChars, 'Write about X'.length);
  assert.equal(result.receipt.credentialRef, 'runtime:credential', 'only a reference to the secret');
});

test('the same prompt digests the same way and a different one does not', async () => {
  const a = adapter({ respond: ok(completion) });
  const b = adapter({ respond: ok(completion) });
  const first = await a.instance.execute(task());
  const same = await a.instance.execute(task());
  const other = await b.instance.execute(task({ contextBundle: { prompt: 'Write about Y' } }));
  assert.equal(first.receipt.promptDigest, same.receipt.promptDigest);
  assert.notEqual(first.receipt.promptDigest, other.receipt.promptDigest);
});

test('a failed attempt still produces a receipt', async () => {
  const { instance } = adapter({ respond: httpError(429, {}) });
  const result = await instance.execute(task());
  assert.ok(result.receipt, 'failures are as worth recording as successes');
  assert.equal(result.receipt.outcome, 'FAILED');
  assert.equal(result.receipt.errorCode, 'RATE_LIMITED');
});

// ---------------------------------------------------------------- trung lập

test('the adapter refuses a task that leaked browser fields into the contract', async () => {
  const { instance, calls } = adapter({ respond: ok(completion) });
  const result = await instance.execute({ ...task(), selector: '#prompt-textarea' });
  assert.equal(result.status, 'FAILED');
  assert.equal(result.error.code, 'INVALID_TASK');
  assert.equal(calls.length, 0);
});

test('the adapter needs no knowledge of the content job it is running', async () => {
  const { instance, calls } = adapter({ respond: ok(completion) });
  for (const contentJob of ['article', 'newsletter', 'landing-page', 'anything-new']) {
    const result = await instance.execute(task({ contentJob }));
    assert.equal(result.status, 'COMPLETED', contentJob);
  }
  const bodies = calls.map((c) => JSON.stringify(c.body));
  assert.equal(new Set(bodies).size, 1, 'the same prompt produces the same request whatever the job is called');
});

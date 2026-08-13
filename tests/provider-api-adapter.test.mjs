import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiHttpAdapter } from '../runtime/providers/api-http-adapter.mjs';

const task = { taskId: 'task_api', taskType: 'WRITE', contentJob: 'article', contextSnapshotId: 'ctx_1', contextBundle: { brief: 'write' }, outputContract: {}, costPolicy: { paidApi: true } };

test('API adapter resolves secret by reference and never includes it in result/receipt', async () => {
  let seen;
  const fetchImpl = async (url, options) => { seen = { url, options }; return new Response(JSON.stringify({ choices: [{ message: { content: '{"body":"done"}' } }], usage: { input_tokens: 10, output_tokens: 5 } }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  const adapter = createApiHttpAdapter({ providerId: 'api-v1', endpoint: 'https://api.example.test/v1/chat/completions', model: 'quality-model', secretRef: 'keychain://api-v1', resolveSecret: async (ref) => { assert.equal(ref, 'keychain://api-v1'); return 'super-secret-key'; }, costClass: 'PAID_ALLOWED', fetchImpl });
  const result = await adapter.execute(task);
  assert.equal(seen.options.headers.authorization, 'Bearer super-secret-key'); assert.equal(result.status, 'COMPLETED'); assert.deepEqual(result.output, { body: 'done' });
  assert.doesNotMatch(JSON.stringify(result), /super-secret-key/); assert.equal(result.costClass, 'PAID_ALLOWED');
});

test('API adapter blocks paid and unknown cost unless policy explicitly permits a known paid class', async () => {
  let calls = 0; const fetchImpl = async () => { calls += 1; return new Response('{}', { status: 200 }); };
  const paid = createApiHttpAdapter({ providerId: 'paid', endpoint: 'https://api.example.test', model: 'm', secretRef: 'keychain://paid', resolveSecret: async () => 'k', costClass: 'PAID_ALLOWED', fetchImpl });
  await assert.rejects(() => paid.execute({ ...task, costPolicy: { paidApi: false } }), /paid API is not authorized/i);
  const unknown = createApiHttpAdapter({ providerId: 'unknown', endpoint: 'https://api.example.test', model: 'm', secretRef: 'keychain://u', resolveSecret: async () => 'k', costClass: 'UNKNOWN_COST', fetchImpl });
  await assert.rejects(() => unknown.execute(task), /unknown cost/i); assert.equal(calls, 0);
});

test('API adapter normalizes HTTP failures without leaking response secrets', async () => {
  const adapter = createApiHttpAdapter({ providerId: 'api-v1', endpoint: 'https://api.example.test', model: 'm', secretRef: 'keychain://api', resolveSecret: async () => 'secret', costClass: 'FREE_QUOTA', fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'rate limited' } }), { status: 429 }) });
  const result = await adapter.execute({ ...task, costPolicy: { paidApi: false } });
  assert.equal(result.status, 'FAILED'); assert.equal(result.error.code, 'RATE_LIMITED'); assert.equal(result.error.retryable, true); assert.doesNotMatch(JSON.stringify(result), /secret/);
});

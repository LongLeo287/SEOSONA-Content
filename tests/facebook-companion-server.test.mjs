import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompanionServer } from '../scripts/companion/facebook-companion.mjs';

async function start(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

test('accepts only the configured extension origin and bearer token', async (t) => {
  const server = createCompanionServer({
    token: 'local-test-token',
    allowedOrigins: ['chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
    runVisual: async () => ({ status: 'asset_needs_review', retryCount: 0 }),
  });
  const port = await start(server);
  t.after(() => server.close());
  const url = `http://127.0.0.1:${port}/v1/flow/generate`;
  const body = JSON.stringify({ visualJob: { clientRef: 'week-1/post-01/r1', prompt: 'SEO desk', ratio: '1:1' } });

  const noAuth = await fetch(url, { method: 'POST', headers: { Origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'x-seosona-nonce': 'nonce-aaaaaaaaaaaaaaaa' }, body });
  assert.equal(noAuth.status, 401);

  const wrongOrigin = await fetch(url, { method: 'POST', headers: { Origin: 'chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', Authorization: 'Bearer local-test-token', 'x-seosona-nonce': 'nonce-bbbbbbbbbbbbbbbb' }, body });
  assert.equal(wrongOrigin.status, 403);

  const accepted = await fetch(url, { method: 'POST', headers: { Origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', Authorization: 'Bearer local-test-token', 'x-seosona-nonce': 'nonce-cccccccccccccccc', 'content-type': 'application/json' }, body });
  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), { status: 'asset_needs_review', retryCount: 0 });
});

test('returns a local receipt when a ready Flow asset is archived', async (t) => {
  const archived = [];
  const server = createCompanionServer({
    token: 'local-test-token',
    allowedOrigins: ['chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
    runVisual: async () => ({ status: 'asset_ready', retryCount: 1, asset: { asset_id: 'asset-1' } }),
    archiveAsset: async (input) => { archived.push(input); return { fileRef: 'library/week-1/post-01.png', receipt: { assetId: 'asset-1' } }; },
  });
  const port = await start(server);
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${port}/v1/flow/generate`, {
    method: 'POST',
    headers: { Origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', Authorization: 'Bearer local-test-token', 'x-seosona-nonce': 'nonce-dddddddddddddddd', 'content-type': 'application/json' },
    body: JSON.stringify({ batchId: 'week-1', draftId: 'post-01', visualJob: { clientRef: 'week-1/post-01/r1', prompt: 'SEO desk', ratio: '1:1' } }),
  });
  const result = await response.json();
  assert.equal(result.receipt.assetId, 'asset-1');
  assert.equal(archived.length, 1);
  assert.equal(archived[0].batchId, 'week-1');
});

test('serves the current OS context only to the authenticated extension', async (t) => {
  const server = createCompanionServer({
    token: 'local-test-token',
    allowedOrigins: ['chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
    contextProvider: async () => ({ brand: { id: 'seosona' }, group: { id: 'seo-vn' }, policy: {}, evidence: [] }),
  });
  const port = await start(server);
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${port}/v1/context`, {
    headers: { Origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', Authorization: 'Bearer local-test-token', 'x-seosona-nonce': 'nonce-eeeeeeeeeeeeeeee' },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).brand.id, 'seosona');
});

test('reports Companion, Flow, provider, and OS context readiness', async (t) => {
  const server = createCompanionServer({
    token: 'local-test-token',
    allowedOrigins: ['chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
    flow: { callTool: async () => ({ ok: true }) },
    contextProvider: async () => ({ brand: { id: 'seosona' }, group: { id: 'seo-vn' }, policy: {}, evidence: [] }),
    preflight: async () => ({ contractVersion: '1.1.0', provider: { provider: 'flow', ready: true, reason: 'ready' } }),
    companionVersion: '1.0.0',
  });
  const port = await start(server);
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${port}/v1/health`, {
    headers: { Origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', Authorization: 'Bearer local-test-token', 'x-seosona-nonce': 'nonce-ffffffffffffffff' },
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.ok, true);
  assert.equal(result.companion.version, '1.0.0');
  assert.equal(result.flow.contractVersion, '1.1.0');
  assert.equal(result.flow.provider.ready, true);
  assert.match(result.context.revision, /^ctx-[a-f0-9]{8}$/);
});

test('caches the health preflight briefly without caching request authorization', async (t) => {
  let checks = 0;
  const server = createCompanionServer({
    token: 'local-test-token',
    allowedOrigins: ['chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
    flow: { callTool: async () => ({ ok: true }) },
    contextProvider: async () => ({ brand: {}, group: {}, policy: {}, evidence: [] }),
    preflight: async () => { checks += 1; return { contractVersion: '1.1.0', provider: { provider: 'flow', ready: true } }; },
    preflightTtlMs: 5000,
  });
  const port = await start(server);
  t.after(() => server.close());
  const headers = (nonce) => ({ Origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', Authorization: 'Bearer local-test-token', 'x-seosona-nonce': nonce });
  assert.equal((await fetch(`http://127.0.0.1:${port}/v1/health`, { headers: headers('nonce-cache-aaaaaaaa') })).status, 200);
  assert.equal((await fetch(`http://127.0.0.1:${port}/v1/health`, { headers: headers('nonce-cache-bbbbbbbb') })).status, 200);
  assert.equal(checks, 1);
});

test('writes a complete draft package through the authenticated library endpoint', async (t) => {
  const writes = [];
  const server = createCompanionServer({
    token: 'local-test-token',
    allowedOrigins: ['chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
    writePackage: async (value) => { writes.push(value); return { draftRef: 'content-library://batch-1/post-01/draft.json' }; },
  });
  const port = await start(server);
  t.after(() => server.close());
  const body = { batch: { id: 'batch-1' }, snapshot: { contextRevision: 'ctx-1' }, draft: { id: 'post-01' } };
  const response = await fetch(`http://127.0.0.1:${port}/v1/library/package`, {
    method: 'POST',
    headers: { Origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', Authorization: 'Bearer local-test-token', 'x-seosona-nonce': 'nonce-gggggggggggggggg', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).draftRef, 'content-library://batch-1/post-01/draft.json');
  assert.deepEqual(writes, [body]);
});

test('uses a stable error envelope for incompatible Flow contracts', async (t) => {
  const server = createCompanionServer({
    token: 'local-test-token',
    allowedOrigins: ['chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
    flow: { callTool: async () => ({ ok: true }) },
    contextProvider: async () => ({ brand: {}, group: {}, policy: {}, evidence: [] }),
    preflight: async () => { const error = new Error('Wrong Flow version.'); error.code = 'INCOMPATIBLE_FLOW_CONTRACT'; error.retryable = false; throw error; },
  });
  const port = await start(server);
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${port}/v1/health`, {
    headers: { Origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', Authorization: 'Bearer local-test-token', 'x-seosona-nonce': 'nonce-hhhhhhhhhhhhhhhh' },
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: { code: 'INCOMPATIBLE_FLOW_CONTRACT', message: 'Wrong Flow version.', retryable: false } });
});

test('can cancel the Companion-owned active Flow generation without a leaked job id', async (t) => {
  const calls = [];
  const server = createCompanionServer({
    token: 'local-test-token',
    allowedOrigins: ['chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
    flow: { callTool: async (name, args) => { calls.push({ name, args }); return { ok: true, data: { cancelled: ['active-job'] } }; } },
  });
  const port = await start(server);
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${port}/v1/flow/cancel`, {
    method: 'POST',
    headers: { Origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', Authorization: 'Bearer local-test-token', 'x-seosona-nonce': 'nonce-iiiiiiiiiiiiiiii', 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [{ name: 'cancel_job', args: {} }]);
});

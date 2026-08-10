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

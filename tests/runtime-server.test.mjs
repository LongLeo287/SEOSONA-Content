import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaceStore } from '../runtime/storage/workspace-store.mjs';
import { createWorkspaceService } from '../runtime/domain/workspace-service.mjs';
import { createContentService } from '../runtime/domain/content-service.mjs';
import { createRuntimeServer } from '../runtime/http/server.mjs';

function sequenceIds() { let n = 0; return (prefix) => `${prefix}_${++n}`; }

async function setupServer() {
  const rootDir = await mkdtemp(join(tmpdir(), 'seosona-server-'));
  const store = createWorkspaceStore({ rootDir });
  const idFactory = sequenceIds();
  const workspaceService = createWorkspaceService({ store, idFactory, now: () => '2026-08-13T03:00:00.000Z' });
  const contentService = createContentService({ store, idFactory, now: () => '2026-08-13T03:00:00.000Z' });
  const workspace = await workspaceService.createWorkspace({ name: 'Local' });
  const token = 't'.repeat(32);
  const extensionOrigin = 'chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef';
  const server = createRuntimeServer({ token, extensionOrigin, workspaceId: workspace.workspaceId, workspaceService, contentService, studioHtml: '<!doctype html><title>SEOSONA</title>' });
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', (error) => error ? reject(error) : resolve()));
  const { port, address } = server.address();
  return { server, base: `http://127.0.0.1:${port}`, token, extensionOrigin, address };
}

function extHeaders({ token, extensionOrigin, nonce = 'abcdefghijklmnop' }) {
  return { authorization: `Bearer ${token}`, origin: extensionOrigin, 'x-seosona-nonce': nonce, 'content-type': 'application/json' };
}

async function close(server) { await new Promise((resolve) => server.close(resolve)); }

test('runtime binds loopback and serves Studio with a strict HttpOnly session cookie', async () => {
  const ctx = await setupServer();
  try {
    assert.equal(ctx.address, '127.0.0.1');
    const response = await fetch(`${ctx.base}/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('set-cookie') || '', /HttpOnly/i);
    assert.match(response.headers.get('set-cookie') || '', /SameSite=Strict/i);
    assert.match(response.headers.get('set-cookie') || '', /Path=\//i);
    assert.match(await response.text(), /SEOSONA/);
  } finally { await close(ctx.server); }
});

test('extension auth accepts one valid nonce and rejects replay, wrong token and wrong origin', async () => {
  const ctx = await setupServer();
  try {
    const ok = await fetch(`${ctx.base}/v1/health`, { headers: extHeaders(ctx) });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).ok, true);
    const replay = await fetch(`${ctx.base}/v1/health`, { headers: extHeaders(ctx) });
    assert.equal(replay.status, 401);
    assert.equal((await replay.json()).error.code, 'NONCE_REPLAYED');
    const wrongToken = await fetch(`${ctx.base}/v1/health`, { headers: extHeaders({ ...ctx, token: 'x'.repeat(32), nonce: 'bbbbbbbbbbbbbbbb' }) });
    assert.equal(wrongToken.status, 401);
    const wrongOrigin = await fetch(`${ctx.base}/v1/health`, { headers: extHeaders({ ...ctx, extensionOrigin: 'https://evil.example', nonce: 'cccccccccccccccc' }) });
    assert.equal(wrongOrigin.status, 403);
  } finally { await close(ctx.server); }
});

test('Studio API requires same-origin session cookie and rejects a foreign Origin', async () => {
  const ctx = await setupServer();
  try {
    const home = await fetch(`${ctx.base}/`);
    const cookie = (home.headers.get('set-cookie') || '').split(';')[0];
    const same = await fetch(`${ctx.base}/v1/projects`, { headers: { cookie, origin: ctx.base } });
    assert.equal(same.status, 200);
    assert.deepEqual(await same.json(), []);
    const foreign = await fetch(`${ctx.base}/v1/projects`, { headers: { cookie, origin: 'https://evil.example' } });
    assert.equal(foreign.status, 403);
  } finally { await close(ctx.server); }
});

test('project/brand/source/content/revision endpoints round trip through domain services', async () => {
  const ctx = await setupServer();
  try {
    let nonce = 100;
    const request = (path, { method = 'GET', body } = {}) => fetch(`${ctx.base}${path}`, {
      method, headers: extHeaders({ ...ctx, nonce: `nonce${++nonce}abcdefghijk` }), ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const brandRes = await request('/v1/brands', { method: 'POST', body: { name: 'SEOSONA' } });
    assert.equal(brandRes.status, 201);
    const brand = await brandRes.json();
    const projectRes = await request('/v1/projects', { method: 'POST', body: { name: 'Article', objective: 'Write', brandId: brand.brandId } });
    assert.equal(projectRes.status, 201);
    const project = await projectRes.json();
    const getProject = await request(`/v1/projects/${project.projectId}`);
    assert.equal(getProject.status, 200);
    assert.equal((await getProject.json()).name, 'Article');
    const sourceRes = await request(`/v1/projects/${project.projectId}/sources`, { method: 'POST', body: { kind: 'text', title: 'Source', text: 'Evidence text' } });
    assert.equal(sourceRes.status, 201);
    assert.match((await sourceRes.json()).blobRef, /^seosona-local:\/\//);
    const contentRes = await request(`/v1/projects/${project.projectId}/content`, { method: 'POST', body: { jobType: 'article', title: 'Draft', payload: { body: 'v1' } } });
    assert.equal(contentRes.status, 201);
    const created = await contentRes.json();
    const revisionRes = await request(`/v1/content/${created.content.contentId}/revisions`, { method: 'POST', body: { operation: 'EDIT', payload: { body: 'v2' } } });
    assert.equal(revisionRes.status, 201);
    const historyRes = await request(`/v1/content/${created.content.contentId}`);
    assert.equal(historyRes.status, 200);
    assert.deepEqual((await historyRes.json()).revisions.map((r) => r.payload.body), ['v1', 'v2']);
  } finally { await close(ctx.server); }
});

test('runtime rejects oversized JSON and returns stable unknown-endpoint envelope', async () => {
  const ctx = await setupServer();
  try {
    const tooLarge = await fetch(`${ctx.base}/v1/projects`, { method: 'POST', headers: extHeaders({ ...ctx, nonce: 'dddddddddddddddd' }), body: JSON.stringify({ name: 'x'.repeat(140 * 1024) }) });
    assert.equal(tooLarge.status, 413);
    assert.equal((await tooLarge.json()).error.code, 'PAYLOAD_TOO_LARGE');
    const missing = await fetch(`${ctx.base}/v1/not-real`, { headers: extHeaders({ ...ctx, nonce: 'eeeeeeeeeeeeeeee' }) });
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: { code: 'ENDPOINT_NOT_FOUND', message: 'Unknown Runtime endpoint.', retryable: false } });
  } finally { await close(ctx.server); }
});

test('runtime entrypoint resolves exact V1 defaults and requires extension identity/token', async () => {
  const { resolveRuntimeConfig, ensureLocalWorkspace } = await import('../runtime/index.mjs');
  assert.throws(() => resolveRuntimeConfig({}), /SEOSONA_CONTENT_EXTENSION_ID/);
  assert.throws(() => resolveRuntimeConfig({ SEOSONA_CONTENT_EXTENSION_ID: 'a'.repeat(32), SEOSONA_CONTENT_RUNTIME_TOKEN: 'short' }), /32 characters/);
  assert.equal(typeof ensureLocalWorkspace, 'function');
  assert.deepEqual(resolveRuntimeConfig({ SEOSONA_CONTENT_EXTENSION_ID: 'a'.repeat(32), SEOSONA_CONTENT_RUNTIME_TOKEN: 'z'.repeat(32) }), {
    rootDir: './.seosona-content', port: 43118, extensionId: 'a'.repeat(32), extensionOrigin: `chrome-extension://${'a'.repeat(32)}`, token: 'z'.repeat(32),
  });
});

test('runtime bootstrap reuses one deterministic local workspace across restarts', async () => {
  const { ensureLocalWorkspace } = await import('../runtime/index.mjs');
  const rootDir = await mkdtemp(join(tmpdir(), 'seosona-bootstrap-'));
  const firstStore = createWorkspaceStore({ rootDir });
  const first = await ensureLocalWorkspace(firstStore, () => '2026-08-13T03:00:00.000Z');
  const secondStore = createWorkspaceStore({ rootDir });
  const second = await ensureLocalWorkspace(secondStore, () => 'later');
  assert.equal(first.workspaceId, 'workspace_local');
  assert.deepEqual(second, first);
});

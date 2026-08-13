import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuntimeServer } from '../runtime/http/server.mjs';

const TOKEN = 'a'.repeat(40);
const EXT_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

let nonceSeq = 0;
const nextNonce = () => `nonce${String(++nonceSeq).padStart(16, '0')}`;

async function withServer(fn, opts = {}) {
  const rootDir = await mkdtemp(join(tmpdir(), 'seosona-server-'));
  const server = createRuntimeServer({
    rootDir, token: TOKEN, extensionOrigin: EXT_ORIGIN, ...opts,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port, address } = server.address();
  const base = `http://127.0.0.1:${port}`;

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
    await fn({ call, base, port, address, server });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(rootDir, { recursive: true, force: true });
  }
}

test('runtime binds loopback only', async () => {
  await withServer(async ({ address }) => {
    assert.equal(address, '127.0.0.1', 'the runtime must never bind a public interface');
  });
});

test('health reports readiness and versions without auth headers', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/v1/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'READY');
    assert.ok(body.apiVersion);
    assert.ok(body.schemaVersion);
  });
});

test('a valid extension token plus fresh nonce is accepted', async () => {
  await withServer(async ({ call }) => {
    const res = await call('/v1/projects');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), []);
  });
});

test('a wrong token is rejected with a stable error envelope', async () => {
  await withServer(async ({ call }) => {
    const res = await call('/v1/projects', { headers: { authorization: 'Bearer wrong' } });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(typeof body.error.code, 'string');
    assert.equal(typeof body.error.message, 'string');
    assert.equal(typeof body.error.retryable, 'boolean');
    assert.ok(!JSON.stringify(body).includes(TOKEN), 'the error must never echo the token');
  });
});

test('a replayed nonce is rejected', async () => {
  await withServer(async ({ call }) => {
    const nonce = nextNonce();
    assert.equal((await call('/v1/projects', { headers: { 'x-seosona-nonce': nonce } })).status, 200);
    const replay = await call('/v1/projects', { headers: { 'x-seosona-nonce': nonce } });
    assert.equal(replay.status, 401);
  });
});

test('a malformed or missing nonce is rejected', async () => {
  await withServer(async ({ call }) => {
    assert.equal((await call('/v1/projects', { headers: { 'x-seosona-nonce': 'short' } })).status, 401);
    assert.equal((await call('/v1/projects', { headers: { 'x-seosona-nonce': 'bad nonce!!' } })).status, 401);
  });
});

test('a foreign origin is rejected even with a valid token', async () => {
  await withServer(async ({ call }) => {
    for (const origin of ['https://evil.test', 'chrome-extension://someotherextensionidhere00', 'null']) {
      const res = await call('/v1/projects', { headers: { origin } });
      assert.equal(res.status, 403, `origin ${origin} must be refused`);
    }
  });
});

test('studio HTML sets an HttpOnly SameSite=Strict session cookie', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    const cookie = res.headers.get('set-cookie') || '';
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Strict/i);
    assert.match(cookie, /Path=\//);
  });
});

test('a studio session cookie authorises API calls from the studio origin', async () => {
  await withServer(async ({ base }) => {
    const html = await fetch(`${base}/`);
    const cookie = (html.headers.get('set-cookie') || '').split(';')[0];
    const res = await fetch(`${base}/v1/projects`, {
      headers: { origin: base, cookie },
    });
    assert.equal(res.status, 200);
  });
});

test('an oversized JSON body is refused', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/v1/projects`, {
      method: 'POST',
      headers: {
        origin: EXT_ORIGIN,
        authorization: `Bearer ${TOKEN}`,
        'x-seosona-nonce': nextNonce(),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'x'.repeat(2 * 1024 * 1024) }),
    });
    assert.equal(res.status, 413);
  });
});

test('invalid JSON is refused with the error envelope', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/v1/projects`, {
      method: 'POST',
      headers: {
        origin: EXT_ORIGIN,
        authorization: `Bearer ${TOKEN}`,
        'x-seosona-nonce': nextNonce(),
        'content-type': 'application/json',
      },
      body: '{not json',
    });
    assert.equal(res.status, 400);
    assert.equal(typeof (await res.json()).error.code, 'string');
  });
});

test('an unknown endpoint returns the same error envelope', async () => {
  await withServer(async ({ call }) => {
    const res = await call('/v1/nope');
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error.code, 'NOT_FOUND');
  });
});

test('project create/read round-trips through the API', async () => {
  await withServer(async ({ call }) => {
    const created = await call('/v1/projects', {
      method: 'POST',
      body: { name: 'Launch', objective: 'Grow signups' },
    });
    assert.equal(created.status, 201);
    const project = await created.json();
    assert.ok(project.projectId);
    assert.equal(project.status, 'active');

    const read = await call(`/v1/projects/${project.projectId}`);
    assert.equal(read.status, 200);
    assert.equal((await read.json()).name, 'Launch');

    const list = await call('/v1/projects');
    assert.equal((await list.json()).length, 1);
  });
});

test('content and revisions round-trip and keep lineage', async () => {
  await withServer(async ({ call }) => {
    const project = await (await call('/v1/projects', { method: 'POST', body: { name: 'P' } })).json();

    const content = await (await call(`/v1/projects/${project.projectId}/content`, {
      method: 'POST', body: { contentJob: 'article', payload: { body: 'v1' } },
    })).json();
    assert.ok(content.contentId);

    const rev = await (await call(`/v1/content/${content.contentId}/revisions`, {
      method: 'POST', body: { operation: 'EDIT', payload: { body: 'v2' } },
    })).json();
    assert.equal(rev.parentRevisionId, content.currentRevisionId);

    const history = await (await call(`/v1/content/${content.contentId}`)).json();
    assert.deepEqual(history.map((r) => r.payload.body), ['v1', 'v2']);
  });
});

test('sources and brands are reachable through the API', async () => {
  await withServer(async ({ call }) => {
    const brand = await (await call('/v1/brands', { method: 'POST', body: { name: 'Acme' } })).json();
    assert.ok(brand.brandId);

    const project = await (await call('/v1/projects', { method: 'POST', body: { name: 'P', brandId: brand.brandId } })).json();
    assert.equal(project.brandId, brand.brandId);

    const source = await (await call(`/v1/projects/${project.projectId}/sources`, {
      method: 'POST', body: { kind: 'note', title: 'A note' },
    })).json();
    assert.ok(source.sourceId);
    assert.ok(source.sha256);
  });
});

test('a domain error is surfaced with its code, not a stack trace', async () => {
  await withServer(async ({ call }) => {
    const res = await call('/v1/projects/project_missing');
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error.code, 'NOT_FOUND');
    assert.ok(!JSON.stringify(body).includes('at '), 'no stack trace may leak to the client');
  });
});

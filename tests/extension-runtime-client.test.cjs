const test = require('node:test');
const assert = require('node:assert/strict');
const RuntimeClient = require('../extension/lib/runtime-client.js');

const URL_OK = 'http://127.0.0.1:43118';
const CREDENTIAL = { credentialId: 'credential_abc', credentialSecret: 'f'.repeat(64) };

function harness({ routes = {}, url = URL_OK, local = {}, session = {} } = {}) {
  const calls = [];
  const localStore = { ...local };
  const sessionStore = { ...session };

  const client = RuntimeClient.create({
    fetchImpl: async (target, init) => {
      calls.push({ url: target, init, body: init.body ? JSON.parse(init.body) : null });
      const path = target.replace(URL_OK, '');
      const match = Object.entries(routes).find(([key]) => path.startsWith(key));
      if (!match) return { ok: true, status: 200, json: async () => ({}) };
      const value = typeof match[1] === 'function' ? match[1](calls.length) : match[1];
      if (value instanceof Error) throw value;
      return value;
    },
    storage: {
      getLocal: async (key) => ({ [key]: localStore[key] }),
      setLocal: async (patch) => Object.assign(localStore, patch),
      getSession: async (key) => ({ [key]: sessionStore[key] }),
      setSession: async (patch) => Object.assign(sessionStore, patch),
    },
    readUrl: async () => url,
    newNonce: () => 'n'.repeat(20),
  });

  return { client, calls, localStore, sessionStore };
}

const ok = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const fail = (code, status = 401) => ({ ok: false, status, json: async () => ({ error: { code, message: code } }) });

// ---------------------------------------------------------------- loopback

test('only a loopback runtime url is ever contacted', async () => {
  for (const url of ['http://127.0.0.1:43118', 'http://localhost:43118', 'http://127.0.0.1']) {
    assert.equal(RuntimeClient.isLoopbackUrl(url), true, url);
  }
  for (const url of ['https://runtime.example.com', 'http://192.168.1.5:43118', '']) {
    assert.equal(RuntimeClient.isLoopbackUrl(url), false, url);
  }

  const { client, calls } = harness({ url: 'https://runtime.example.com' });
  await assert.rejects(() => client.health(), (e) => e.code === 'RUNTIME_URL_INVALID');
  assert.equal(calls.length, 0, 'user content never leaves the machine');
});

// ---------------------------------------------------------------- ghép cặp

test('pairing exchanges the code and stores the credential locally', async () => {
  const { client, calls, localStore } = harness({ routes: { '/v1/pairing/exchange': ok(CREDENTIAL) } });
  const result = await client.pair(' abc-code ');
  assert.equal(result.credentialId, 'credential_abc');
  // Mã được chuẩn hóa: người dùng chép tay thì hay kèm khoảng trắng và chữ thường.
  assert.equal(calls[0].body.code, 'ABC-CODE');
  assert.deepEqual(localStore.seosonaRuntimePairing, CREDENTIAL);
  assert.equal(await client.isPaired(), true);
});

test('a bad code surfaces the runtime reason', async () => {
  const { client } = harness({ routes: { '/v1/pairing/exchange': fail('PAIRING_CODE_EXPIRED') } });
  await assert.rejects(() => client.pair('AAAAAAAA'), (e) => e.code === 'PAIRING_CODE_EXPIRED');
});

test('calling the api without a pairing says so plainly', async () => {
  const { client } = harness();
  await assert.rejects(() => client.listProjects(), (e) => e.code === 'NOT_PAIRED');
});

// Chứng chỉ sống qua khởi động lại Chrome; token phiên thì không cần và không nên.
test('the credential goes to local storage and the session token to session storage', async () => {
  const { client, localStore, sessionStore } = harness({
    routes: { '/v1/pairing/exchange': ok(CREDENTIAL), '/v1/session': ok({ token: 't'.repeat(64), expiresAt: 'X' }) },
  });
  await client.pair('CODE');
  await client.openSession();
  assert.ok(localStore.seosonaRuntimePairing, 'the pairing survives a browser restart');
  assert.ok(sessionStore.seosonaRuntimeSession, 'the bearer token does not');
  assert.equal(localStore.seosonaRuntimeSession, undefined, 'the token is never written to disk');
});

// ---------------------------------------------------------------- gọi API

test('every request carries a bearer token and a fresh nonce', async () => {
  const { client, calls } = harness({
    local: { seosonaRuntimePairing: CREDENTIAL },
    routes: { '/v1/session': ok({ token: 'tok', expiresAt: 'X' }), '/v1/projects': ok([]) },
  });
  await client.listProjects();
  const apiCall = calls.find((c) => c.url.includes('/v1/projects'));
  assert.equal(apiCall.init.headers.Authorization, 'Bearer tok');
  assert.ok(apiCall.init.headers['x-seosona-nonce'].length >= 16);
});

test('an existing session is reused instead of minting a new one every call', async () => {
  const { client, calls } = harness({
    local: { seosonaRuntimePairing: CREDENTIAL },
    session: { seosonaRuntimeSession: { token: 'tok', expiresAt: 'X' } },
    routes: { '/v1/projects': ok([]) },
  });
  await client.listProjects();
  await client.listProjects();
  assert.equal(calls.filter((c) => c.url.includes('/v1/session')).length, 0);
});

// Phiên hết hạn là chuyện thường sau 12 tiếng: tự làm mới đúng một lần rồi thử lại.
test('an expired session is renewed once and the call retried', async () => {
  let projectCalls = 0;
  const { client, calls } = harness({
    local: { seosonaRuntimePairing: CREDENTIAL },
    session: { seosonaRuntimeSession: { token: 'old', expiresAt: 'X' } },
    routes: {
      '/v1/session': ok({ token: 'fresh', expiresAt: 'Y' }),
      '/v1/projects': () => (++projectCalls === 1 ? fail('SESSION_EXPIRED') : ok([{ projectId: 'p1' }])),
    },
  });

  const projects = await client.listProjects();
  assert.deepEqual(projects, [{ projectId: 'p1' }]);
  assert.equal(calls.filter((c) => c.url.includes('/v1/session')).length, 1);
  assert.equal(calls.at(-1).init.headers.Authorization, 'Bearer fresh');
});

// Vòng lặp không giới hạn ở đây sẽ biến một chứng chỉ bị thu hồi thành một cơn bão request.
test('a revoked credential fails after exactly one renewal attempt', async () => {
  const { client, calls } = harness({
    local: { seosonaRuntimePairing: CREDENTIAL },
    session: { seosonaRuntimeSession: { token: 'old', expiresAt: 'X' } },
    routes: { '/v1/session': ok({ token: 'fresh', expiresAt: 'Y' }), '/v1/projects': fail('SESSION_EXPIRED') },
  });
  await assert.rejects(() => client.listProjects(), (e) => e.code === 'SESSION_EXPIRED');
  assert.equal(calls.filter((c) => c.url.includes('/v1/session')).length, 1, 'it does not loop');
  assert.equal(calls.filter((c) => c.url.includes('/v1/projects')).length, 2);
});

test('a non auth error is not retried at all', async () => {
  const { client, calls } = harness({
    local: { seosonaRuntimePairing: CREDENTIAL },
    session: { seosonaRuntimeSession: { token: 'tok', expiresAt: 'X' } },
    routes: { '/v1/projects': fail('PAID_PROVIDER_BLOCKED', 409) },
  });
  await assert.rejects(() => client.listProjects(), (e) => e.code === 'PAID_PROVIDER_BLOCKED');
  assert.equal(calls.filter((c) => c.url.includes('/v1/projects')).length, 1);
});

test('a runtime that is not running is reported as unavailable, not as an extension bug', async () => {
  const { client } = harness({ routes: { '/v1/health': new Error('ECONNREFUSED') } });
  await assert.rejects(() => client.health(), (e) => e.code === 'RUNTIME_UNAVAILABLE');
});

test('forgetting a pairing clears both stores', async () => {
  const { client, localStore, sessionStore } = harness({
    local: { seosonaRuntimePairing: CREDENTIAL },
    session: { seosonaRuntimeSession: { token: 'tok' } },
  });
  await client.forget();
  assert.equal(localStore.seosonaRuntimePairing, null);
  assert.equal(sessionStore.seosonaRuntimeSession, null);
  assert.equal(await client.isPaired(), false);
});

// Đây là chứng chỉ mở một tiến trình trên chính máy người dùng, không phải khóa của hãng AI nào.
test('the client holds no provider credential of any kind', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../extension/lib/runtime-client.js'), 'utf8');
  for (const leak of ['apiKey', 'openai', 'sk-', 'cookie']) {
    assert.ok(!source.toLowerCase().includes(leak.toLowerCase()), `runtime-client must not mention ${leak}`);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuntimeServer } from '../runtime/http/server.mjs';
import { createPairing } from '../runtime/http/auth.mjs';

const TOKEN = 'a'.repeat(40);
const EXT_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const OTHER_EXT = 'chrome-extension://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz';

let nonceSeq = 0;
const nextNonce = () => `nonce${String(++nonceSeq).padStart(16, '0')}`;

async function withServer(fn) {
  const rootDir = await mkdtemp(join(tmpdir(), 'seosona-pairing-'));
  const server = createRuntimeServer({ rootDir, token: TOKEN, extensionOrigin: EXT_ORIGIN });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const studioCookie = async () => {
    const page = await fetch(`${base}/`);
    return page.headers.getSetCookie().join('; ').split(';')[0];
  };
  const post = (path, { body, headers = {} } = {}) => fetch(`${base}${path}`, {
    method: 'POST',
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  try {
    await fn({ base, post, studioCookie, rootDir });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(rootDir, { recursive: true, force: true });
  }
}

async function pairedCredential({ post, studioCookie }) {
  const cookie = await studioCookie();
  const { code } = await (await post('/v1/pairing/start', { headers: { cookie } })).json();
  return (await (await post('/v1/pairing/exchange', { body: { code }, headers: { origin: EXT_ORIGIN } })).json());
}

// ---------------------------------------------------------------- mã ghép cặp

test('pairing codes are short, unambiguous and expire', async () => {
  const pairing = createPairing({ extensionOrigin: EXT_ORIGIN, now: () => 1000 });
  const { code, expiresAt } = pairing.startPairing();
  assert.equal(code.length, 8);
  // Không có I, O, 0, 1: người dùng chép tay mã này.
  assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
  assert.ok(Date.parse(expiresAt) > 0);

  const codes = new Set(Array.from({ length: 200 }, () => createPairing({ extensionOrigin: EXT_ORIGIN }).startPairing().code));
  assert.ok(codes.size > 190, 'codes must not repeat in practice');
});

test('an expired code cannot be exchanged', async () => {
  let clock = 0;
  const pairing = createPairing({ extensionOrigin: EXT_ORIGIN, now: () => clock, codeTtlMs: 1000 });
  const { code } = pairing.startPairing();
  clock = 1001;
  await assert.rejects(() => pairing.exchangePairing({ code, origin: EXT_ORIGIN }), (e) => e.code === 'PAIRING_CODE_EXPIRED');
});

// Mã hiện trên màn hình. Dùng lại được nghĩa là ai nhìn thấy nó một lần cũng ghép cặp được sau đó.
test('a pairing code works exactly once', async () => {
  await withServer(async ({ post, studioCookie }) => {
    const cookie = await studioCookie();
    const { code } = await (await post('/v1/pairing/start', { headers: { cookie } })).json();

    const first = await post('/v1/pairing/exchange', { body: { code }, headers: { origin: EXT_ORIGIN } });
    assert.equal(first.status, 200);

    const second = await post('/v1/pairing/exchange', { body: { code }, headers: { origin: EXT_ORIGIN } });
    assert.equal(second.status, 401);
    assert.equal((await second.json()).error.code, 'PAIRING_CODE_INVALID');
  });
});

test('a wrong code is refused without revealing anything', async () => {
  await withServer(async ({ post, studioCookie }) => {
    const cookie = await studioCookie();
    await post('/v1/pairing/start', { headers: { cookie } });
    const res = await post('/v1/pairing/exchange', { body: { code: 'AAAAAAAA' }, headers: { origin: EXT_ORIGIN } });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error.code, 'PAIRING_CODE_INVALID');
    assert.ok(!JSON.stringify(body).includes('credential'), 'a failed exchange returns no credential material');
  });
});

// Không kiểm origin thì bất kỳ tiện ích nào đọc được mã trên màn hình cũng ghép cặp được.
test('only the allowed extension origin can exchange a code', async () => {
  await withServer(async ({ post, studioCookie }) => {
    const cookie = await studioCookie();
    const { code } = await (await post('/v1/pairing/start', { headers: { cookie } })).json();

    const wrong = await post('/v1/pairing/exchange', { body: { code }, headers: { origin: OTHER_EXT } });
    assert.equal(wrong.status, 403);

    const web = await post('/v1/pairing/exchange', { body: { code }, headers: { origin: 'https://evil.test' } });
    assert.equal(web.status, 403);

    // Mã vẫn còn nguyên vẹn: một lần thử sai từ nơi khác không được phép đốt mã của người dùng.
    const right = await post('/v1/pairing/exchange', { body: { code }, headers: { origin: EXT_ORIGIN } });
    assert.equal(right.status, 200);
  });
});

// Extension tự mở mã cho chính nó thì toàn bộ cơ chế còn lại vô nghĩa.
test('only the local studio can open a pairing code', async () => {
  await withServer(async ({ post }) => {
    const asExtension = await post('/v1/pairing/start', {
      headers: { origin: EXT_ORIGIN, authorization: `Bearer ${TOKEN}`, 'x-seosona-nonce': nextNonce() },
    });
    assert.equal(asExtension.status, 403);
    assert.equal((await asExtension.json()).error.code, 'STUDIO_ONLY');

    assert.equal((await post('/v1/pairing/start')).status, 403, 'and an anonymous caller certainly cannot');
  });
});

// ---------------------------------------------------------------- lưu trữ bí mật

test('the runtime stores only a hash of the pairing secret', async () => {
  await withServer(async ({ post, studioCookie, rootDir }) => {
    const { credentialId, credentialSecret } = await pairedCredential({ post, studioCookie });
    assert.ok(credentialId.startsWith('credential_'));
    assert.equal(credentialSecret.length, 64);

    // Quét MỌI file đã ghi: bí mật không được xuất hiện ở bất kỳ đâu trên đĩa.
    const files = [];
    async function walk(dir) {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else files.push(full);
      }
    }
    await walk(rootDir);
    assert.ok(files.length > 0, 'something was persisted');
    for (const file of files) {
      const content = await readFile(file, 'utf8').catch(() => '');
      assert.ok(!content.includes(credentialSecret), `${file} contains the raw pairing secret`);
    }
  });
});

test('the secret is returned exactly once and never listed again', async () => {
  await withServer(async ({ base, post, studioCookie }) => {
    const { credentialId, credentialSecret } = await pairedCredential({ post, studioCookie });
    const cookie = await studioCookie();

    // Danh sách chứng chỉ chỉ mang siêu dữ liệu: đủ để thu hồi, không đủ để dùng.
    const { credentials } = await (await fetch(`${base}/v1/pairing/credentials`, { headers: { cookie } })).json();
    const record = credentials.find((c) => c.credentialId === credentialId);
    assert.ok(record, 'the credential is listed so it can be revoked');
    assert.ok(!JSON.stringify(record).includes(credentialSecret));
    assert.ok(!('secretHash' in record), 'not even the hash leaves the runtime');
    assert.equal(record.revokedAt, null);
  });
});

// ---------------------------------------------------------------- phiên

test('a pairing credential mints a short lived session that the api accepts', async () => {
  await withServer(async ({ base, post, studioCookie }) => {
    const credential = await pairedCredential({ post, studioCookie });
    const session = await (await post('/v1/session', { body: credential, headers: { origin: EXT_ORIGIN } })).json();
    assert.equal(session.token.length, 64, 'at least 256 bits of randomness');
    assert.ok(Date.parse(session.expiresAt) > Date.now());

    const res = await fetch(`${base}/v1/projects`, {
      headers: { origin: EXT_ORIGIN, authorization: `Bearer ${session.token}`, 'x-seosona-nonce': nextNonce() },
    });
    assert.equal(res.status, 200, 'a paired extension can now use the api without the machine token');
  });
});

test('the nonce rule still applies to session authenticated calls', async () => {
  await withServer(async ({ base, post, studioCookie }) => {
    const credential = await pairedCredential({ post, studioCookie });
    const { token } = await (await post('/v1/session', { body: credential, headers: { origin: EXT_ORIGIN } })).json();
    const nonce = nextNonce();
    const call = () => fetch(`${base}/v1/projects`, {
      headers: { origin: EXT_ORIGIN, authorization: `Bearer ${token}`, 'x-seosona-nonce': nonce },
    });
    assert.equal((await call()).status, 200);
    assert.equal((await call()).status, 401, 'a replayed request is refused even with a valid session');
  });
});

test('an expired session is reported as expired, not as a wrong token', async () => {
  let clock = 0;
  const pairing = createPairing({ extensionOrigin: EXT_ORIGIN, now: () => clock, sessionTtlMs: 1000 });
  const { code } = pairing.startPairing();
  const credential = await pairing.exchangePairing({ code, origin: EXT_ORIGIN });
  const { token } = await pairing.openSession({ ...credential, origin: EXT_ORIGIN });

  assert.equal(pairing.verifySession(token).ok, true);
  clock = 1001;
  const verdict = pairing.verifySession(token);
  assert.equal(verdict.ok, false);
  // Extension biết "hết hạn" thì tự mở phiên mới; "sai token" thì thử lại bao nhiêu cũng vô ích.
  assert.equal(verdict.code, 'SESSION_EXPIRED');
});

test('a wrong secret cannot open a session', async () => {
  await withServer(async ({ post, studioCookie }) => {
    const { credentialId } = await pairedCredential({ post, studioCookie });
    const res = await post('/v1/session', {
      body: { credentialId, credentialSecret: 'f'.repeat(64) }, headers: { origin: EXT_ORIGIN },
    });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error.code, 'PAIRING_INVALID');
  });
});

test('a credential from another origin cannot open a session', async () => {
  const pairing = createPairing({ extensionOrigin: EXT_ORIGIN });
  const { code } = pairing.startPairing();
  const credential = await pairing.exchangePairing({ code, origin: EXT_ORIGIN });
  await assert.rejects(
    () => pairing.openSession({ ...credential, origin: OTHER_EXT }),
    (e) => e.code === 'ORIGIN_NOT_ALLOWED',
  );
});

// Thu hồi mà chỉ có tác dụng sau 12 tiếng thì không phải là thu hồi.
test('revoking a credential kills its live sessions immediately', async () => {
  const pairing = createPairing({ extensionOrigin: EXT_ORIGIN });
  const { code } = pairing.startPairing();
  const credential = await pairing.exchangePairing({ code, origin: EXT_ORIGIN });
  const { token } = await pairing.openSession({ ...credential, origin: EXT_ORIGIN });
  assert.equal(pairing.verifySession(token).ok, true);

  assert.equal(await pairing.revokeCredential(credential.credentialId), true);
  const verdict = pairing.verifySession(token);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, 'PAIRING_REVOKED');

  await assert.rejects(
    () => pairing.openSession({ ...credential, origin: EXT_ORIGIN }),
    (e) => e.code === 'PAIRING_REVOKED',
  );
});

test('a random bearer token is still refused', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/v1/projects`, {
      headers: { origin: EXT_ORIGIN, authorization: `Bearer ${'0'.repeat(64)}`, 'x-seosona-nonce': nextNonce() },
    });
    assert.equal(res.status, 401);
  });
});

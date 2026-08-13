import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuntimeServer } from '../runtime/http/server.mjs';

const TOKEN = 'a'.repeat(40);
const EXT_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

async function withServer(fn) {
  const rootDir = await mkdtemp(join(tmpdir(), 'seosona-studio-'));
  const server = createRuntimeServer({ rootDir, token: TOKEN, extensionOrigin: EXT_ORIGIN });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn({ base });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(rootDir, { recursive: true, force: true });
  }
}

test('the runtime serves the studio shell at the root', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const html = await res.text();
    assert.match(html, /SEOSONA Content/);
    assert.match(html, /\/studio\/app\.mjs/);
    assert.match(html, /id="studio-main"/);
  });
});

// Studio là file tĩnh do Runtime phục vụ. Nhúng token vào đó nghĩa là bí mật nằm trong một
// file mà bất kỳ tiến trình nào đọc được đĩa cũng đọc được — và nó sẽ ở đó mãi.
test('no credential is embedded in the studio shell or its assets', async () => {
  await withServer(async ({ base }) => {
    for (const path of ['/', '/studio/app.mjs', '/studio/api-client.mjs', '/studio/styles.css']) {
      const body = await (await fetch(`${base}${path}`)).text();
      assert.doesNotMatch(body, /Bearer\s+[A-Za-z0-9]/, path);
      assert.doesNotMatch(body, /api[_-]?key\s*[:=]\s*['"]/i, path);
      assert.ok(!body.includes(TOKEN), `${path} must not contain the runtime token`);
    }
  });
});

test('the studio shell offers every workspace section', async () => {
  await withServer(async ({ base }) => {
    const html = await (await fetch(`${base}/`)).text();
    for (const section of ['Projects', 'Sources', 'Brand', 'Content', 'Audit', 'Transcript', 'Providers']) {
      assert.ok(html.includes(section), `the shell must offer ${section}`);
    }
  });
});

test('studio assets are served with the right content types', async () => {
  await withServer(async ({ base }) => {
    const expected = [
      ['/studio/app.mjs', /javascript/],
      ['/studio/api-client.mjs', /javascript/],
      ['/studio/styles.css', /text\/css/],
    ];
    for (const [path, type] of expected) {
      const res = await fetch(`${base}${path}`);
      assert.equal(res.status, 200, path);
      assert.match(res.headers.get('content-type'), type, path);
    }
  });
});

// Runtime chạy trong thư mục dự án của người dùng. Một trình phục vụ file "tiện dụng" ở đây
// sẽ phát tán mọi thứ nó với tới được.
test('only the declared studio files are reachable', async () => {
  await withServer(async ({ base }) => {
    const attempts = [
      '/studio/../../package.json',
      '/studio/../http/auth.mjs',
      '/studio/%2e%2e/%2e%2e/package.json',
      '/studio/../../.seosona-content/workspaces',
      '/package.json',
      '/studio/',
    ];
    for (const path of attempts) {
      const res = await fetch(`${base}${path}`, { redirect: 'manual' });
      // 403 cũng hợp lệ: đường dẫn không nằm trong bảng tài sản nên rơi xuống lớp xác thực và
      // bị chặn TRƯỚC khi định tuyến. Điều bắt buộc là không có nội dung file nào lọt ra.
      assert.ok([400, 403, 404].includes(res.status), `${path} returned ${res.status}`);
      const body = await res.text();
      assert.ok(!body.includes('"dependencies"'), `${path} leaked package.json`);
      assert.ok(!body.includes('timingSafeEqual'), `${path} leaked runtime source`);
    }
  });
});

test('the studio shell can be loaded without any auth header', async () => {
  await withServer(async ({ base }) => {
    // Studio là trang do chính Runtime phục vụ; nó lấy phiên qua cookie khi tải, không qua token.
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    const cookie = res.headers.getSetCookie().join(';');
    assert.match(cookie, /seosona_studio_session=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
  });
});

test('a studio session can call the api on the same origin', async () => {
  await withServer(async ({ base }) => {
    const page = await fetch(`${base}/`);
    const cookie = page.headers.getSetCookie().join('; ').split(';')[0];
    const res = await fetch(`${base}/v1/projects`, { headers: { cookie } });
    assert.equal(res.status, 200, 'the page it just served can talk to the api');
    assert.deepEqual(await res.json(), []);
  });
});

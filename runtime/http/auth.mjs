import { randomBytes, timingSafeEqual } from 'node:crypto';

// Xác thực cho Runtime cục bộ.
//
// "Chạy trên localhost" KHÔNG có nghĩa là tin được: mọi tiến trình khác trên máy, và mọi
// trang web đang mở, đều gọi được vào 127.0.0.1. Nên vẫn phải kiểm đủ 3 lớp:
//   1. ORIGIN nằm trong danh sách cho phép CHÍNH XÁC (không so khớp gần đúng, không wildcard)
//   2. TOKEN đúng, so sánh theo thời gian hằng số (không rò rỉ độ dài khớp qua thời gian)
//   3. NONCE dùng một lần — chặn phát lại một request đã bắt được
//
// Studio do chính Runtime phục vụ nên dùng cookie phiên HttpOnly thay cho token.

const NONCE_RE = /^[a-zA-Z0-9_-]{16,128}$/;
const NONCE_TTL_MS = 5 * 60 * 1000;
export const SESSION_COOKIE = 'seosona_studio_session';

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  // Khác độ dài thì timingSafeEqual ném lỗi; so với chính nó để vẫn tốn thời gian tương đương.
  if (ba.length !== bb.length) { timingSafeEqual(ba, ba); return false; }
  return timingSafeEqual(ba, bb);
}

function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function createAuth({ token, extensionOrigin = null, nonceTtlMs = NONCE_TTL_MS } = {}) {
  if (!token || String(token).length < 32) {
    throw new TypeError('Runtime token is required and must be at least 32 characters.');
  }
  const usedNonces = new Map(); // nonce -> hạn dùng
  const sessions = new Set();

  function sweep(now) {
    for (const [nonce, expiresAt] of usedNonces) if (expiresAt <= now) usedNonces.delete(nonce);
  }

  function issueSession() {
    const id = randomBytes(32).toString('hex');
    sessions.add(id);
    return id;
  }

  // Cookie phiên Studio: HttpOnly (JS trang không đọc được), SameSite=Strict (trang khác
  // không kéo theo cookie), Path=/ để áp cho toàn bộ API.
  const sessionCookieHeader = (id) => `${SESSION_COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/`;

  function authorize(req, { selfOrigins = [] } = {}) {
    const origin = req.headers.origin || '';
    const cookies = parseCookies(req.headers.cookie);
    const sessionId = cookies[SESSION_COOKIE];

    // Đường Studio: cookie phiên hợp lệ + origin chính là Runtime.
    if (sessionId && sessions.has(sessionId)) {
      if (origin && !selfOrigins.includes(origin)) {
        return { ok: false, status: 403, code: 'ORIGIN_NOT_ALLOWED', message: 'Origin is not allowed.' };
      }
      return { ok: true, actor: 'studio' };
    }

    // Đường Extension: origin đúng tuyệt đối + bearer token + nonce mới.
    if (!extensionOrigin || origin !== extensionOrigin) {
      return { ok: false, status: 403, code: 'ORIGIN_NOT_ALLOWED', message: 'Origin is not allowed.' };
    }
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ') || !safeEqual(header.slice(7), token)) {
      return { ok: false, status: 401, code: 'AUTH_REQUIRED', message: 'Invalid runtime token.' };
    }
    const nonce = req.headers['x-seosona-nonce'];
    const now = Date.now();
    sweep(now);
    if (typeof nonce !== 'string' || !NONCE_RE.test(nonce) || usedNonces.has(nonce)) {
      return { ok: false, status: 401, code: 'AUTH_REQUIRED', message: 'Missing or replayed request nonce.' };
    }
    usedNonces.set(nonce, now + nonceTtlMs);
    return { ok: true, actor: 'extension' };
  }

  return { authorize, issueSession, sessionCookieHeader };
}

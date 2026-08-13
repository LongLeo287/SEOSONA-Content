import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';

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

export function createAuth({ token, extensionOrigin = null, nonceTtlMs = NONCE_TTL_MS, bearerVerifier = null } = {}) {
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
    if (!header.startsWith('Bearer ')) {
      return { ok: false, status: 401, code: 'AUTH_REQUIRED', message: 'Invalid runtime token.' };
    }
    const bearer = header.slice(7);
    if (!safeEqual(bearer, token)) {
      // Không phải token của máy: thử token phiên do ghép cặp cấp. Phân biệt "phiên hết hạn"
      // với "sai token" là cần thiết — extension biết hết hạn thì tự mở phiên mới, còn sai
      // token thì thử lại bao nhiêu lần cũng vô ích.
      const session = bearerVerifier ? bearerVerifier(bearer) : { ok: false, code: 'AUTH_REQUIRED' };
      if (!session.ok) {
        return { ok: false, status: 401, code: session.code || 'AUTH_REQUIRED', message: 'Invalid runtime token.' };
      }
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

// ================================================================ Ghép cặp Extension
//
// Vì sao cần cả một luồng riêng thay vì dùng chung token của Runtime:
//
//   Token Runtime là bí mật của MÁY. Dán nó vào extension nghĩa là bí mật đó nằm trong
//   chrome.storage của một tiện ích, không thu hồi riêng được, và muốn đổi thì phải đổi
//   cho cả máy. Ghép cặp cho mỗi extension một chứng chỉ RIÊNG, thu hồi được riêng.
//
// Ba tính chất phải giữ:
//   1. Mã ghép cặp DÙNG MỘT LẦN và ngắn hạn — nó hiện trên màn hình, có thể bị nhìn trộm.
//   2. Runtime chỉ lưu HASH của bí mật. Lưu bản gốc nghĩa là ai đọc được thư mục dữ liệu
//      thì đọc được chứng chỉ, và nó nằm đó vĩnh viễn.
//   3. Phiên có hạn. Một bearer token vĩnh viễn thì mất là mất luôn, không ai gọi về được.

// Bảng chữ không nhập nhằng: bỏ I, O, 0, 1 để người dùng không gõ nhầm khi chép tay.
const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PAIRING_CODE_LENGTH = 8;
const PAIRING_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');

function randomCode() {
  // Lấy byte ngẫu nhiên thật; loại bỏ phần dư để không lệch phân phối về đầu bảng chữ.
  const limit = 256 - (256 % PAIRING_ALPHABET.length);
  let code = '';
  while (code.length < PAIRING_CODE_LENGTH) {
    for (const byte of randomBytes(PAIRING_CODE_LENGTH)) {
      if (byte >= limit) continue;
      code += PAIRING_ALPHABET[byte % PAIRING_ALPHABET.length];
      if (code.length === PAIRING_CODE_LENGTH) break;
    }
  }
  return code;
}

export function createPairing({
  extensionOrigin = null,
  now = () => Date.now(),
  codeTtlMs = PAIRING_TTL_MS,
  sessionTtlMs = SESSION_TTL_MS,
  store = null,
  workspaceId = 'workspace_local',
} = {}) {
  let pending = null; // { codeHash, expiresAt }
  const credentials = new Map(); // credentialId -> { secretHash, extensionOrigin, createdAt, revokedAt }
  const sessions = new Map(); // tokenHash -> { credentialId, expiresAt }

  function pairingError(code, message, status = 401) {
    const err = new Error(message);
    err.code = code;
    err.httpStatus = status;
    return err;
  }

  /** Studio (cùng origin) mở một mã ghép cặp. Mã cũ chưa dùng bị vô hiệu ngay. */
  function startPairing() {
    const code = randomCode();
    const expiresAt = now() + codeTtlMs;
    // Chỉ giữ hash: mã hiện trên màn hình, nhưng bản trong bộ nhớ không cần là bản đọc được.
    pending = { codeHash: sha256(code), expiresAt };
    return { code, expiresAt: new Date(expiresAt).toISOString() };
  }

  /** Extension đổi mã lấy chứng chỉ. Trả bí mật ĐÚNG MỘT LẦN. */
  async function exchangePairing({ code, origin }) {
    // Origin phải khớp tuyệt đối. Không có bước này thì bất kỳ tiện ích nào đọc được mã
    // trên màn hình cũng ghép cặp được.
    if (!extensionOrigin || origin !== extensionOrigin) {
      throw pairingError('ORIGIN_NOT_ALLOWED', 'Origin is not allowed to pair.', 403);
    }
    if (!pending) throw pairingError('PAIRING_CODE_INVALID', 'No pairing code is active.');
    if (pending.expiresAt <= now()) {
      pending = null;
      throw pairingError('PAIRING_CODE_EXPIRED', 'The pairing code has expired.');
    }
    if (!safeEqual(sha256(String(code || '').trim().toUpperCase()), pending.codeHash)) {
      throw pairingError('PAIRING_CODE_INVALID', 'The pairing code does not match.');
    }

    // Dùng một lần: đốt mã NGAY, kể cả khi các bước sau hỏng.
    pending = null;

    const credentialId = `credential_${randomBytes(9).toString('hex')}`;
    const credentialSecret = randomBytes(32).toString('hex');
    const record = {
      credentialId,
      secretHash: sha256(credentialSecret),
      extensionOrigin: origin,
      createdAt: new Date(now()).toISOString(),
      revokedAt: null,
    };
    credentials.set(credentialId, record);
    if (store) {
      // Trên đĩa cũng chỉ có hash — và bản ghi này KHÔNG bao giờ chứa credentialSecret.
      await store.put('providerConfig', workspaceId, {
        providerConfigId: `pairing_${credentialId}`,
        provider: 'extension-pairing',
        credentialId,
        secretHash: record.secretHash,
        extensionOrigin: origin,
        createdAt: record.createdAt,
        revokedAt: null,
      });
    }
    return { credentialId, credentialSecret };
  }

  async function loadCredentials() {
    if (!store || credentials.size) return;
    for (const record of await store.list('providerConfig', workspaceId)) {
      if (record.provider !== 'extension-pairing') continue;
      credentials.set(record.credentialId, {
        credentialId: record.credentialId,
        secretHash: record.secretHash,
        extensionOrigin: record.extensionOrigin,
        createdAt: record.createdAt,
        revokedAt: record.revokedAt || null,
      });
    }
  }

  /** Chứng chỉ ghép cặp -> bearer token ngắn hạn. */
  async function openSession({ credentialId, credentialSecret, origin }) {
    await loadCredentials();
    const record = credentials.get(credentialId);
    if (!record || record.revokedAt) throw pairingError('PAIRING_REVOKED', 'This pairing credential is no longer valid.');
    if (origin && record.extensionOrigin !== origin) {
      throw pairingError('ORIGIN_NOT_ALLOWED', 'Origin does not match this credential.', 403);
    }
    if (!safeEqual(sha256(credentialSecret), record.secretHash)) {
      throw pairingError('PAIRING_INVALID', 'The pairing secret does not match.');
    }

    const token = randomBytes(32).toString('hex'); // 256 bit
    const expiresAt = now() + sessionTtlMs;
    // Chỉ hash được lưu, nên kể cả đọc được bộ nhớ máy chủ cũng không lấy lại được token.
    sessions.set(sha256(token), { credentialId, expiresAt });
    return { token, expiresAt: new Date(expiresAt).toISOString() };
  }

  function verifySession(token) {
    const record = sessions.get(sha256(String(token || '')));
    if (!record) return { ok: false, code: 'SESSION_INVALID' };
    if (record.expiresAt <= now()) {
      sessions.delete(sha256(String(token)));
      return { ok: false, code: 'SESSION_EXPIRED' };
    }
    const credential = credentials.get(record.credentialId);
    // Thu hồi chứng chỉ phải giết luôn phiên đang mở, nếu không thì "thu hồi" chỉ có tác dụng
    // sau 12 tiếng nữa.
    if (!credential || credential.revokedAt) return { ok: false, code: 'PAIRING_REVOKED' };
    return { ok: true, credentialId: record.credentialId };
  }

  async function revokeCredential(credentialId) {
    const record = credentials.get(credentialId);
    if (!record) return false;
    record.revokedAt = new Date(now()).toISOString();
    if (store) {
      const stored = await store.get('providerConfig', workspaceId, `pairing_${credentialId}`);
      if (stored) await store.put('providerConfig', workspaceId, { ...stored, revokedAt: record.revokedAt });
    }
    return true;
  }

  return {
    startPairing,
    exchangePairing,
    openSession,
    verifySession,
    revokeCredential,
    listCredentials: async () => {
      await loadCredentials();
      // Không bao giờ trả secretHash ra ngoài: nó không phải bí mật, nhưng cũng không phải
      // thứ giao diện cần, và mọi thứ lọt ra ngoài đều là bề mặt tấn công thêm.
      return [...credentials.values()].map(({ secretHash, ...rest }) => rest);
    },
    PAIRING_ALPHABET,
  };
}

import { randomUUID } from 'node:crypto';

const NONCE_RE = /^[a-zA-Z0-9_-]{16,128}$/;
const SESSION_RE = /^[a-f0-9]{32}$/;

function failure(status, code, message) { return { ok: false, status, error: { code, message, retryable: false } }; }

function parseCookies(header) {
  return String(header || '').split(';').reduce((out, part) => {
    const at = part.indexOf('=');
    if (at > 0) out[part.slice(0, at).trim()] = part.slice(at + 1).trim();
    return out;
  }, {});
}

export function createRuntimeAuth({ token, extensionOrigin, nonceTtlMs = 5 * 60 * 1000 }) {
  if (typeof token !== 'string' || token.length < 32) throw new Error('Runtime token must contain at least 32 characters.');
  if (!/^chrome-extension:\/\/[a-z]{32}$/.test(String(extensionOrigin || ''))) throw new Error('extensionOrigin must be an explicit Chrome extension origin.');
  const nonces = new Set();
  const sessions = new Set();

  function newStudioSession() {
    const id = randomUUID().replace(/-/g, '');
    sessions.add(id);
    return { id, cookie: `seosona_session=${id}; HttpOnly; SameSite=Strict; Path=/` };
  }

  function authorize(req) {
    const origin = String(req.headers.origin || '');
    if (origin === extensionOrigin) {
      if (req.headers.authorization !== `Bearer ${token}`) return failure(401, 'UNAUTHORIZED', 'Invalid Runtime token.');
      const nonce = req.headers['x-seosona-nonce'];
      if (typeof nonce !== 'string' || !NONCE_RE.test(nonce)) return failure(401, 'INVALID_NONCE', 'A valid request nonce is required.');
      if (nonces.has(nonce)) return failure(401, 'NONCE_REPLAYED', 'Request nonce has already been used.');
      nonces.add(nonce);
      const timer = setTimeout(() => nonces.delete(nonce), nonceTtlMs);
      timer.unref?.();
      return { ok: true, kind: 'extension', origin };
    }

    const expectedOrigin = `http://${req.headers.host || ''}`;
    if (origin !== expectedOrigin) return failure(403, 'ORIGIN_DENIED', 'Origin is not allowed.');
    const session = parseCookies(req.headers.cookie).seosona_session;
    if (!SESSION_RE.test(String(session || '')) || !sessions.has(session)) return failure(401, 'STUDIO_SESSION_REQUIRED', 'Studio session is missing or invalid.');
    return { ok: true, kind: 'studio', origin };
  }

  return { authorize, newStudioSession };
}

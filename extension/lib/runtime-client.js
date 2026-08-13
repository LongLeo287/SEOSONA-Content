/* SEOSONA Content — client gọi Local Runtime từ Extension (MV3). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.RuntimeClient = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Nơi cất giữ, và vì sao lại tách làm hai:
  //
  //   chrome.storage.local   -> credentialId + credentialSecret (chứng chỉ ghép cặp)
  //   chrome.storage.session -> bearer token của phiên
  //
  // Chứng chỉ phải sống qua lần khởi động lại Chrome, nếu không người dùng phải ghép cặp lại
  // mỗi sáng. Token phiên thì KHÔNG: nó ngắn hạn, và mất đi là lấy lại được từ chứng chỉ.
  // Cất token dài hạn xuống đĩa chỉ để đỡ một lần gọi mạng là đánh đổi sai.
  //
  // Đây là chứng chỉ của LOCAL RUNTIME, không phải khóa API của nhà cung cấp nào. Nó chỉ mở
  // được một tiến trình trên chính máy người dùng.

  const LOOPBACK_RE = /^http:\/\/(127\.0\.0\.1|localhost)(?::\d+)?$/;

  function runtimeError(code, message) {
    const err = new Error(message || code);
    err.code = code;
    return err;
  }

  function isLoopbackUrl(url) {
    return LOOPBACK_RE.test(String(url || '').replace(/\/$/, ''));
  }

  function create(deps) {
    const fetchImpl = deps.fetchImpl;
    const storage = deps.storage; // { getLocal, setLocal, getSession, setSession }
    const readUrl = deps.readUrl;
    const newNonce = deps.newNonce || (() => Math.random().toString(36).slice(2).padEnd(20, 'x').slice(0, 20));

    async function baseUrl() {
      const url = await readUrl();
      // Kiểm loopback ở NGAY chỗ dùng. Một URL công khai ở đây nghĩa là nội dung người dùng
      // rời khỏi máy họ mà không ai hỏi — và cấu hình đã lưu thì có thể bị sửa.
      if (!isLoopbackUrl(url)) throw runtimeError('RUNTIME_URL_INVALID', 'Runtime URL must use local loopback.');
      return String(url).replace(/\/$/, '');
    }

    async function call(path, { method = 'GET', body, headers = {} } = {}) {
      const url = await baseUrl();
      let response;
      try {
        response = await fetchImpl(url + path, {
          method,
          headers: Object.assign(body === undefined ? {} : { 'content-type': 'application/json' }, headers),
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (cause) {
        // Runtime chưa bật là chuyện bình thường, không phải sự cố của extension.
        const err = runtimeError('RUNTIME_UNAVAILABLE', 'Local Runtime is not reachable.');
        err.cause = cause;
        throw err;
      }
      if (response.status === 204) return null;
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw runtimeError(
          (payload && payload.error && payload.error.code) || 'RUNTIME_ERROR',
          (payload && payload.error && payload.error.message) || ('Runtime returned ' + response.status),
        );
      }
      return payload;
    }

    /** Đổi mã người dùng đọc từ Studio lấy chứng chỉ ghép cặp. */
    async function pair(code) {
      const credential = await call('/v1/pairing/exchange', { method: 'POST', body: { code: String(code || '').trim().toUpperCase() } });
      await storage.setLocal({ seosonaRuntimePairing: credential });
      return { credentialId: credential.credentialId };
    }

    async function openSession() {
      const stored = await storage.getLocal('seosonaRuntimePairing');
      const credential = stored && stored.seosonaRuntimePairing;
      if (!credential || !credential.credentialId) throw runtimeError('NOT_PAIRED', 'This extension is not paired with a local Runtime.');
      const session = await call('/v1/session', { method: 'POST', body: credential });
      await storage.setSession({ seosonaRuntimeSession: session });
      return session;
    }

    async function currentToken() {
      const stored = await storage.getSession('seosonaRuntimeSession');
      return (stored && stored.seosonaRuntimeSession && stored.seosonaRuntimeSession.token) || null;
    }

    /**
     * Gọi API kèm bearer token + nonce mới.
     *
     * Hết phiên thì mở phiên mới và thử lại ĐÚNG MỘT LẦN. Vòng lặp không giới hạn ở đây sẽ
     * biến một chứng chỉ đã bị thu hồi thành một cơn bão request vào Runtime.
     */
    async function request(path, { method = 'GET', body } = {}, { retried = false } = {}) {
      let token = await currentToken();
      if (!token) {
        await openSession();
        token = await currentToken();
      }
      try {
        return await call(path, {
          method, body,
          headers: { Authorization: 'Bearer ' + token, 'x-seosona-nonce': newNonce() },
        });
      } catch (error) {
        const expired = ['SESSION_EXPIRED', 'AUTH_REQUIRED', 'SESSION_INVALID'].includes(error.code);
        if (!expired || retried) throw error;
        await openSession();
        return request(path, { method, body }, { retried: true });
      }
    }

    return {
      isLoopbackUrl,
      pair,
      openSession,
      request,
      health: () => call('/v1/health'),
      listProjects: () => request('/v1/projects'),
      runAction: (action, payload) => request(action.path, { method: action.method || 'POST', body: payload }),
      isPaired: async () => {
        const stored = await storage.getLocal('seosonaRuntimePairing');
        return Boolean(stored && stored.seosonaRuntimePairing && stored.seosonaRuntimePairing.credentialId);
      },
      forget: async () => {
        await storage.setLocal({ seosonaRuntimePairing: null });
        await storage.setSession({ seosonaRuntimeSession: null });
      },
    };
  }

  return { create, isLoopbackUrl };
});

/* SEOSONA Content — bộ điều hợp provider trình duyệt (thuần, mọi phụ thuộc Chrome đều tiêm vào). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BrowserProviderAdapter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Toàn bộ hiểu biết về "cách lái một trang AI" nằm ở đây và ở content script.
  // Runtime/Gateway phía trên chỉ thấy ProviderTask -> ProviderResult.
  //
  // File này KHÔNG gọi thẳng `chrome.*`: mọi phụ thuộc đều tiêm qua deps, nên chạy test được
  // trong node mà không cần trình duyệt. background.js là chỗ duy nhất nối deps thật vào.

  const SUBMIT_ACTION = 'srt:submitAndWait';
  const ABORT_ACTION = 'srt:abort';
  const DEFAULT_TIMEOUT_MS = 600000;
  const MAX_RETRIES = 2;
  const RETRY_BACKOFF_MS = 3000; // 3s, rồi 6s
  const LEASE_GRACE_MS = 60000;

  // Mã lỗi thô của content script -> mã chuẩn + có đáng thử lại không.
  //
  // "retryable" ở đây nghĩa là "một lần thử nữa có thể ăn" — Gateway dùng đúng cờ này để
  // quyết định chuyển sang provider khác. Chưa đăng nhập, bị chặn nội dung hay UI đã đổi thì
  // thử lại chỉ tốn thêm lượt và có thể bị gắn cờ nặng hơn.
  const ERROR_MAP = {
    PAGE_BLOCKED: ['AUTH_REQUIRED', false],
    EDITOR_NOT_FOUND: ['UI_CHANGED', false],
    INSERT_FAILED: ['UI_CHANGED', false],
    RATE_LIMIT: ['RATE_LIMITED', true],
    CONTENT_BLOCKED: ['CONTENT_BLOCKED', false],
    SUBMIT_LOST: ['SUBMIT_LOST', true],
    ABORTED: ['ABORTED', false],
    TIMEOUT: ['TIMEOUT', true],
    NO_RESPONSE: ['TIMEOUT', true],
    NO_RESPONSE_STARTED: ['TIMEOUT', true],
    NETWORK: ['TIMEOUT', true],
  };

  /**
   * Chuẩn hóa kết quả thô của content script.
   *
   * Mã lạ KHÔNG bị nhét vào một trong các mã đã biết: gán bừa "TIMEOUT" cho một lỗi chưa
   * từng gặp là ghi một nguyên nhân SAI vào biên nhận, và người đọc log sau này sẽ đi sai
   * hướng. Nó thành PROVIDER_ERROR, và `rawCode` giữ nguyên mã gốc để còn lần ra.
   */
  function normalizeBrowserResult(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const base = {
      modelState: source.modelState || null,
      chatUrl: source.chatUrl || null,
      elapsedMs: Number.isFinite(source.elapsedMs) ? source.elapsedMs : null,
    };
    if (source.success === true) {
      return Object.assign({ status: 'COMPLETED', code: 'COMPLETED', rawCode: null, retryable: false, output: typeof source.text === 'string' ? source.text : '', message: null }, base);
    }
    const rawCode = typeof source.error === 'string' && source.error ? source.error : null;
    const mapped = (rawCode && ERROR_MAP[rawCode]) || ['PROVIDER_ERROR', true];
    return Object.assign({
      status: 'FAILED',
      code: mapped[0],
      rawCode,
      // Content script tự khai retryable thì tôn trọng; không thì theo bảng.
      retryable: typeof source.retryable === 'boolean' ? source.retryable : mapped[1],
      output: typeof source.text === 'string' ? source.text : '',
      message: source.message || null,
    }, base);
  }

  function providerError(code, message) {
    return { code: code, message: String(message || code), retryable: false };
  }

  function create(deps) {
    const registry = deps.registry;
    const ensureProviderTab = deps.ensureProviderTab;
    const focusTab = deps.focusTab || (async () => {});
    const sendMessage = deps.sendMessage;
    const jobStore = deps.jobStore;
    const broadcast = deps.broadcast || (() => {});
    const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    const now = deps.now || (() => Date.now());
    const maxRetries = Number.isInteger(deps.maxRetries) ? deps.maxRetries : MAX_RETRIES;

    function announce(taskId, page, status, extra) {
      // Vẫn phát tên message cũ: side panel đang nghe đúng tên này.
      broadcast(Object.assign({ action: 'srt:jobUpdate', jobId: taskId, provider: page, status: status }, extra || {}));
    }

    async function failJob(taskId, page, error) {
      const result = { success: false, error: error.code, message: error.message };
      await jobStore.set(taskId, { status: 'error', result: result, finishedAt: now() });
      announce(taskId, page, 'error', { result: result });
      return { ok: false, error: error };
    }

    async function start(task) {
      const provider = registry.get(task && task.providerId);
      // Fail nhanh TRƯỚC khi mở tab hay ghi job: không lái được thì đừng bày ra dấu vết.
      if (!provider) return { ok: false, error: providerError('INVALID_PROVIDER', 'Provider không hợp lệ: ' + (task && task.providerId)) };

      const taskId = task.taskId;
      const timeout = task.timeoutMs || DEFAULT_TIMEOUT_MS;
      const spec = { text: task.text, timeout: timeout, modelMatch: task.modelMatch || null };

      await jobStore.set(taskId, {
        provider: provider.page, providerId: provider.providerId,
        status: 'preparing', startedAt: now(), leaseUpdatedAt: now(),
      });
      announce(taskId, provider.page, 'preparing');

      let tab;
      try {
        tab = await ensureProviderTab(provider.page, { freshChat: task.freshChat, chatUrl: task.chatUrl });
        // Tab phải active: Chrome bóp timer/rAF của tab nền, response detection sẽ đứng hình.
        await focusTab(tab);
        await sleep(500);
      } catch (e) {
        return failJob(taskId, provider.page, providerError('PROVIDER_TAB_FAILED', (e && e.message) || e));
      }

      try {
        const ack = await sendMessage(tab.id, {
          action: SUBMIT_ACTION, jobId: taskId, text: spec.text, timeout: spec.timeout, modelMatch: spec.modelMatch,
        });
        if (!ack || !ack.accepted) throw new Error('Content script từ chối job');
      } catch (e) {
        return failJob(taskId, provider.page, providerError('CONTENT_SCRIPT_UNAVAILABLE', (e && e.message) || e));
      }

      // Lưu spec để thử lại lặp đúng yêu cầu cũ, không dựng lại prompt từ đầu (dễ lệch).
      await jobStore.set(taskId, {
        status: 'running', tabId: tab.id, spec: spec, attempt: 0, maxRetries: maxRetries, leaseUpdatedAt: now(),
      });
      announce(taskId, provider.page, 'running', { tabId: tab.id });
      return { ok: true, tabId: tab.id };
    }

    // Job "còn sống" hay không: service worker của Chrome có thể bị tắt giữa chừng và
    // không ai báo. Quá hạn lease + biên an toàn thì coi như mất người làm.
    async function status(taskId) {
      const job = await jobStore.get(taskId);
      if (!job) return null;
      if (!['preparing', 'running'].includes(job.status)) return job;
      const timeout = Number(job.spec && job.spec.timeout) || 300000;
      const leaseAt = Number(job.leaseUpdatedAt || job.startedAt || 0);
      if (!leaseAt || now() - leaseAt > timeout + LEASE_GRACE_MS) {
        return Object.assign({}, job, { status: 'stale', reason: 'lease_expired' });
      }
      return job;
    }

    async function retry(taskId, normalized) {
      if (!normalized || normalized.retryable !== true) return false;
      const job = await jobStore.get(taskId);
      if (!job || !job.spec) return false;
      const attempt = (job.attempt || 0) + 1;
      const max = Number.isInteger(job.maxRetries) ? job.maxRetries : maxRetries;
      if (attempt > max) return false;

      await jobStore.set(taskId, { attempt: attempt, status: 'running', leaseUpdatedAt: now() });
      announce(taskId, job.provider, 'running', {
        result: { retrying: true, attempt: attempt, message: 'Thử lại ' + attempt + '/' + max + '…' },
      });
      await sleep(RETRY_BACKOFF_MS * attempt);

      try {
        const tab = await ensureProviderTab(job.provider, {});
        await focusTab(tab);
        await sleep(400);
        const ack = await sendMessage(tab.id, {
          action: SUBMIT_ACTION, jobId: taskId, text: job.spec.text,
          timeout: job.spec.timeout, modelMatch: job.spec.modelMatch || null, retryOf: attempt,
        });
        if (!ack || !ack.accepted) throw new Error('reject');
        await jobStore.set(taskId, { tabId: tab.id, leaseUpdatedAt: now() });
        return true;
      } catch (_) {
        return false; // không nối lại được -> để bên gọi chốt thành lỗi
      }
    }

    async function abort(taskId) {
      const job = await jobStore.get(taskId);
      if (job && job.tabId) {
        // Tab có thể đã đóng; huỷ vẫn phải chốt được trạng thái, không kẹt ở 'running'.
        try { await sendMessage(job.tabId, { action: ABORT_ACTION, jobId: taskId }); } catch (_) {}
      }
      await jobStore.set(taskId, { status: 'aborted', finishedAt: now() });
      announce(taskId, job && job.provider, 'aborted');
      return { ok: true };
    }

    return { start, status, retry, abort, normalizeResult: normalizeBrowserResult };
  }

  return { create, normalizeBrowserResult, ERROR_MAP };
});

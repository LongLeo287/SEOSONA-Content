import { assertProviderTask } from './contracts.mjs';

// Adapter phía Runtime cho các provider chạy bằng trình duyệt.
//
// Nó không biết gì về DOM, selector hay tab — những thứ đó nằm trong Extension. Việc của nó
// là biến một ProviderTask thành một job trong hàng đợi, đợi Extension làm xong, rồi dịch
// kết quả trả về thành ProviderResult. Nhờ vậy Gateway đối xử với "ChatGPT trên trình duyệt"
// và "một API HTTP" y hệt nhau.
//
// Chỉ gửi sang Extension ĐÚNG những gì cần để chạy: prompt, thời hạn, gợi ý model. Không gửi
// theo evidence, nguồn hay hồ sơ dự án — hàng đợi nằm trên đĩa và chạy qua ranh giới tiến trình.

const DEFAULT_POLL_MS = 500;

// Mã lỗi chuẩn từ Extension -> có nên chuyển provider khác không.
const RETRYABLE_CODES = new Set(['RATE_LIMITED', 'TIMEOUT', 'SUBMIT_LOST', 'PROVIDER_ERROR', 'PROVIDER_UNAVAILABLE']);

export function createBrowserBridgeAdapter({
  providerId,
  bridge,
  now = () => new Date().toISOString(),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  pollMs = DEFAULT_POLL_MS,
} = {}) {
  if (!providerId || !bridge) {
    throw new TypeError('createBrowserBridgeAdapter: providerId and bridge are required.');
  }

  function resultFor(task, startedAt, fields) {
    return {
      providerId,
      modelSession: null,
      warnings: [],
      output: null,
      parseStatus: 'NOT_APPLICABLE',
      error: null,
      // Phiên đăng nhập sẵn có: chạy thêm một lần không phát sinh hóa đơn mới.
      costClass: 'ZERO_INCREMENTAL',
      startedAt,
      completedAt: now(),
      receipt: null,
      ...fields,
    };
  }

  async function execute(rawTask) {
    const startedAt = now();
    const task = assertProviderTask(rawTask);

    if (task.privacyPolicy.allowRemote === false) {
      // Trang AI công khai vẫn là bên thứ ba, dù người dùng đã đăng nhập sẵn ở đó.
      return resultFor(task, startedAt, {
        status: 'BLOCKED',
        error: { code: 'REMOTE_NOT_ALLOWED', message: 'This task forbids sending content to a remote provider.', retryable: false },
      });
    }

    await bridge.enqueue({
      taskId: task.taskId,
      providerId,
      payload: {
        prompt: task.contextBundle?.prompt ?? '',
        timeoutMs: task.timeoutMs,
        modelMatch: task.contextBundle?.modelMatch ?? null,
        chatUrl: task.contextBundle?.chatUrl ?? null,
      },
      meta: { contentJob: task.contentJob, taskType: task.taskType, contextSnapshotId: task.contextSnapshotId },
    });

    const deadline = Date.parse(startedAt) + task.timeoutMs;
    // Đợi Extension. Không giữ kết nối, không đăng ký callback: chỉ hỏi lại hàng đợi —
    // service worker có thể chết và sống lại giữa chừng, trạng thái nằm ở hàng đợi mới đáng tin.
    for (;;) {
      const job = await bridge.get(task.taskId);
      if (!job) {
        return resultFor(task, startedAt, {
          status: 'FAILED',
          error: { code: 'PROVIDER_UNAVAILABLE', message: 'The browser job disappeared from the queue.', retryable: true },
        });
      }
      if (job.status === 'CANCELLED') {
        return resultFor(task, startedAt, {
          status: 'FAILED',
          error: { code: 'ABORTED', message: 'The browser job was cancelled.', retryable: false },
        });
      }
      if (job.status === 'COMPLETED') return translate(task, startedAt, job.result);

      if (Date.parse(now()) >= deadline) {
        // Hết giờ thì huỷ hẳn job trong hàng đợi: bỏ lửng sẽ có worker nhặt lại sau khi
        // Gateway đã chuyển sang provider khác, và người dùng nhận hai bài viết.
        await bridge.cancel(task.taskId).catch(() => {});
        return resultFor(task, startedAt, {
          status: 'FAILED',
          error: { code: 'TIMEOUT', message: 'The browser provider did not answer in time.', retryable: true },
        });
      }
      await sleep(pollMs);
    }
  }

  function translate(task, startedAt, raw) {
    const result = raw && typeof raw === 'object' ? raw : {};
    const receipt = {
      providerId,
      adapterType: 'BROWSER',
      chatUrl: result.chatUrl ?? null,
      modelState: result.modelState ?? null,
      elapsedMs: result.elapsedMs ?? null,
      rawCode: result.rawCode ?? null,
    };
    if (result.status === 'COMPLETED') {
      return resultFor(task, startedAt, {
        status: 'COMPLETED', output: result.output ?? '', parseStatus: 'OK',
        modelSession: result.modelState ? { model: result.modelState, providerId } : null,
        receipt,
      });
    }
    const code = result.code || 'PROVIDER_ERROR';
    return resultFor(task, startedAt, {
      status: 'FAILED',
      error: {
        code,
        message: result.message || `The browser provider failed with ${code}.`,
        // Extension đã tự đánh giá; chỉ suy từ bảng khi nó không nói gì.
        retryable: typeof result.retryable === 'boolean' ? result.retryable : RETRYABLE_CODES.has(code),
      },
      receipt,
    });
  }

  return { providerId, adapterType: 'BROWSER', execute };
}

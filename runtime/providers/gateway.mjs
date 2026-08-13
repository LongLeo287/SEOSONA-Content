import { createHash } from 'node:crypto';
import { assertProviderTask, assertProviderResult } from './contracts.mjs';
import { routeProvider as defaultRouteProvider } from './router.mjs';
import { canonicalize } from '../domain/context-snapshot.mjs';
import { makeId } from '../lib/ids.mjs';

// Provider Gateway: chọn provider, chạy, ghi lại, và nếu cần thì chuyển sang provider khác.
//
// Ba quyết định định hình toàn bộ file này:
//
//  1. Chuyển provider KHÔNG được đổi bối cảnh. Cùng taskId, cùng contextSnapshotId, cùng
//     contextBundle; chỉ attemptId là mới. Nếu lần chạy thứ hai dựa trên một sự thật khác
//     lần đầu thì hai kết quả không còn so được với nhau, và biên nhận mất ý nghĩa.
//
//  2. Trình duyệt hỏng KHÔNG tự động biến thành một lần gọi API tính tiền. Đây là kiểu
//     "tiện tay" dễ viết nhất và cũng là kiểu làm người dùng nhận hóa đơn họ chưa từng đồng ý.
//     Provider tốn tiền chỉ vào cuộc khi được cho phép rõ ràng.
//
//  3. Gateway KHÔNG có ý kiến gì về chất lượng bài viết. Gọi được API hay bấm được nút gửi
//     chỉ chứng minh đường truyền chạy. Nó chỉ cập nhật sức khỏe/độ ổn định; điểm chất lượng
//     đến từ đánh giá và phản hồi người dùng, ở tầng khác.

const MAX_ATTEMPTS = 6;

// Tên trường mang bí mật — quét sâu trước khi biên nhận được ghi xuống đĩa. Adapter đã tự
// dọn một lần rồi, đây là lớp chặn thứ hai: một adapter viết ẩu không được phép làm rò rỉ
// khóa vào kho lưu trữ.
const SECRET_FIELDS = new Set([
  'apikey', 'token', 'accesstoken', 'refreshtoken', 'secret', 'password',
  'cookie', 'cookies', 'authorization', 'bearer', 'credential', 'credentials',
]);

// Cả prompt lẫn nội dung nguồn đều không được nằm trong biên nhận: biên nhận để đối chiếu,
// không phải để lưu bài.
const CONTENT_FIELDS = new Set(['prompt', 'input', 'text', 'output', 'contextbundle', 'messages']);

function redact(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 6) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const clean = {};
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[_-]/g, '');
    if (SECRET_FIELDS.has(normalized) || CONTENT_FIELDS.has(normalized)) continue;
    clean[key] = redact(child, depth + 1);
  }
  return clean;
}

function digestOf(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function blocked(task, code, message, considered) {
  return {
    status: 'BLOCKED',
    output: null,
    providerId: 'none',
    modelSession: null,
    startedAt: null,
    completedAt: null,
    costClass: 'UNKNOWN_COST',
    parseStatus: 'NOT_APPLICABLE',
    warnings: [],
    error: { code, message, retryable: false },
    receipt: null,
    taskId: task.taskId,
    considered: considered || [],
  };
}

/** Kho attempt/receipt ghi thẳng vào Local Runtime store. */
export function createRecordStores({ store, workspaceId, now = () => new Date().toISOString(), idFactory = makeId }) {
  return {
    attemptStore: {
      start: async (task, providerId) => {
        const attempt = {
          attemptId: idFactory('providerattempt'),
          // Attempt gắn với công việc đã sinh ra nó; V1 dùng taskId làm jobId.
          jobId: task.taskId,
          taskId: task.taskId,
          contextSnapshotId: task.contextSnapshotId,
          provider: providerId,
          status: 'running',
          startedAt: now(),
        };
        await store.put('providerAttempt', workspaceId, attempt);
        return attempt;
      },
      finish: async (attemptId, result) => {
        const attempt = await store.get('providerAttempt', workspaceId, attemptId);
        if (!attempt) return null;
        const finished = { ...attempt, status: result.status, errorCode: result.error?.code ?? null, endedAt: now() };
        await store.put('providerAttempt', workspaceId, finished);
        return finished;
      },
    },
    receiptStore: {
      write: async (receipt) => {
        await store.put('providerReceipt', workspaceId, receipt);
        return receipt;
      },
    },
  };
}

export function createProviderGateway({
  registry,
  adapters,
  attemptStore,
  receiptStore,
  routeProvider = defaultRouteProvider,
  now = () => new Date().toISOString(),
  idFactory = makeId,
  maxAttempts = MAX_ATTEMPTS,
} = {}) {
  if (!registry || !adapters || !attemptStore || !receiptStore) {
    throw new TypeError('createProviderGateway: registry, adapters, attemptStore and receiptStore are required.');
  }

  const adapterFor = (providerId) => (typeof adapters.get === 'function' ? adapters.get(providerId) : adapters[providerId]);

  // Sức khỏe chỉ nói về ĐƯỜNG TRUYỀN, không nói về nội dung.
  function observe(providerId, result) {
    const patch = { at: now() };
    if (result.status === 'COMPLETED') {
      patch.availability = 'UP';
      patch.auth = 'AUTHENTICATED';
    } else if (result.error?.code === 'AUTH_REQUIRED') {
      patch.auth = 'AUTH_REQUIRED';
    } else if (['TIMEOUT', 'PROVIDER_UNAVAILABLE', 'ADAPTER_CRASHED'].includes(result.error?.code)) {
      patch.availability = 'DEGRADED';
    }
    try { registry.updateHealth(providerId, patch); } catch { /* provider đã bị gỡ giữa chừng */ }
  }

  function receiptFor(task, providerId, attempt, result) {
    return {
      receiptId: idFactory('providerreceipt'),
      provider: providerId,
      providerId,
      at: now(),
      taskId: task.taskId,
      attemptId: attempt.attemptId,
      contextSnapshotId: task.contextSnapshotId,
      // Bối cảnh nhận diện bằng digest: hai lần chạy so được với nhau mà không phải lưu bản sao.
      contextDigest: digestOf(task.contextBundle),
      contentJob: task.contentJob,
      taskType: task.taskType,
      costClass: result.costClass,
      outcome: result.status,
      errorCode: result.error?.code ?? null,
      startedAt: result.startedAt,
      completedAt: result.completedAt,
      // Biên nhận của adapter đi qua bộ lọc lần nữa trước khi chạm đĩa.
      adapterReceipt: redact(result.receipt ?? null),
    };
  }

  async function execute(rawTask, policy = {}) {
    const task = assertProviderTask(rawTask);
    const excluded = [];
    let lastRoute = null;
    let lastFailure = null;

    for (let round = 0; round < maxAttempts; round += 1) {
      const route = routeProvider({ task, providers: registry.list(), policy: { ...policy, excluded } });
      lastRoute = route;
      if (!route.providerId) {
        // "Chỉ còn hãng tốn tiền mà chưa được phép" là câu trả lời HÀNH ĐỘNG ĐƯỢC (cho phép
        // trả tiền, hoặc sửa provider miễn phí), nên nó thắng cả lỗi trước đó.
        if (route.reason === 'PAID_PROVIDER_BLOCKED' || !lastFailure) {
          const stop = blocked(task, route.reason, routeMessage(route.reason), route.considered);
          if (lastFailure) stop.warnings = [`Last provider failure: ${lastFailure.error.code} (${lastFailure.providerId}).`];
          return stop;
        }
        // Hết provider để thử: trả về LỖI THẬT của lần cuối, không phải một câu chung chung —
        // người dùng cần biết nó hỏng vì sao, không phải biết "không còn ai".
        return { ...lastFailure, warnings: [...lastFailure.warnings, 'No further providers were eligible for a retry.'] };
      }

      const adapter = adapterFor(route.providerId);
      if (!adapter) {
        return {
          ...blocked(task, 'ADAPTER_NOT_REGISTERED', `No adapter is registered for provider "${route.providerId}".`, route.considered),
          status: 'FAILED',
          providerId: route.providerId,
        };
      }

      const attempt = await attemptStore.start(task, route.providerId);
      let result;
      try {
        // Adapter nhận ĐÚNG task ban đầu, không phải bản đã chỉnh cho lần chạy này.
        result = assertProviderResult(await adapter.execute(task));
      } catch (e) {
        // Adapter vỡ là lỗi của adapter, không phải lý do để cả job chết. Ghi lại rồi đi tiếp.
        result = {
          status: 'FAILED', output: null, providerId: route.providerId, modelSession: null,
          startedAt: now(), completedAt: now(), costClass: 'UNKNOWN_COST', parseStatus: 'NOT_APPLICABLE',
          warnings: [], receipt: null,
          error: { code: 'ADAPTER_CRASHED', message: `Adapter for "${route.providerId}" threw: ${e.message}`, retryable: true },
        };
      }

      await attemptStore.finish(attempt.attemptId, result);
      await receiptStore.write(receiptFor(task, route.providerId, attempt, result));
      observe(route.providerId, result);

      if (result.status === 'COMPLETED') return { ...result, taskId: task.taskId, attemptId: attempt.attemptId };
      // Lỗi dứt khoát (chưa đăng nhập, bị chặn nội dung) thì dừng: đi hết mọi provider chỉ
      // tốn lượt và có thể bị gắn cờ nặng hơn.
      if (!result.error?.retryable) return { ...result, taskId: task.taskId, attemptId: attempt.attemptId };
      lastFailure = { ...result, taskId: task.taskId, attemptId: attempt.attemptId };
      excluded.push(route.providerId);
    }

    return blocked(task, 'ATTEMPT_LIMIT_REACHED', `Gave up after ${maxAttempts} provider attempts.`, lastRoute?.considered);
  }

  return { execute };
}

function routeMessage(reason) {
  if (reason === 'PAID_PROVIDER_BLOCKED') return 'Only paid providers remain and paid execution was not allowed.';
  if (reason === 'MANUAL_LOCK_UNAVAILABLE') return 'The manually locked provider is not available.';
  return 'No provider is eligible for this task.';
}

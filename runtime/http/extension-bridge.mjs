import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { writeJsonAtomic, readJsonOrNull } from '../lib/atomic-json.mjs';

// Cầu nối Runtime -> Extension cho các job chạy bằng trình duyệt.
//
// Runtime không tự mở được trang AI; Extension làm việc đó. Nên Runtime xếp job vào hàng đợi,
// Extension hỏi lấy job, làm xong thì trả kết quả về.
//
// Hai thứ khiến chỗ này khó hơn vẻ ngoài:
//
//  1. Service worker của Chrome BỊ TẮT bất cứ lúc nào. Một job đang chạy có thể mất người làm
//     giữa chừng mà không ai báo. Vì vậy mỗi job được giao kèm LEASE có hạn: worker còn sống thì
//     gia hạn, chết thì lease hết hạn và job quay lại hàng đợi. Không có cơ chế này, job treo
//     vĩnh viễn và người dùng ngồi đợi một việc không còn ai làm.
//
//  2. Mạng đứt lúc trả kết quả. Extension sẽ gửi lại. Nên nộp kết quả phải BẤT BIẾN theo taskId:
//     lần nộp thứ hai nhận lại đúng kết quả lần đầu, không ghi đè.
//
// Hàng đợi này nằm trên đĩa, nên tuyệt đối không được chứa cookie/token của trang AI.

const DEFAULT_LEASE_MS = 30_000;
const QUEUE_FILE = 'provider-browser-queue.json';

// Tên trường mang thông tin đăng nhập. So khớp bỏ qua hoa thường và dấu ngăn.
const CREDENTIAL_FIELDS = new Set([
  'cookie', 'cookies', 'apikey', 'token', 'accesstoken', 'refreshtoken', 'idtoken',
  'authorization', 'bearer', 'password', 'secret', 'sessionid', 'credential', 'credentials',
]);

function bridgeError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// Quét SÂU: secret hay lọt vào qua các object lồng nhau (headers, auth, config…),
// nên chỉ kiểm tra khóa ở tầng ngoài là bỏ sót.
function assertNoCredentials(value, path = 'payload', seen = new Set()) {
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoCredentials(item, `${path}[${i}]`, seen));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (CREDENTIAL_FIELDS.has(key.toLowerCase().replace(/[_-]/g, ''))) {
      throw bridgeError(
        'CREDENTIAL_IN_QUEUE',
        `${path}.${key} looks like credential material; the browser job queue is written to disk and must never hold it.`,
      );
    }
    assertNoCredentials(child, `${path}.${key}`, seen);
  }
}

/** Lưu hàng đợi ra một file JSON duy nhất, ghi nguyên tử. */
export function createFileJobPersistence({ rootDir, file = QUEUE_FILE }) {
  const target = join(rootDir, file);
  return {
    read: () => readJsonOrNull(target),
    write: (jobs) => writeJsonAtomic(target, jobs),
  };
}

export function createBrowserJobBridge({
  now = () => new Date().toISOString(),
  leaseMs = DEFAULT_LEASE_MS,
  persistence = null,
  leaseTokenFactory = () => randomBytes(18).toString('hex'),
} = {}) {
  let jobs = null; // taskId -> job (nạp lười từ đĩa)

  async function load() {
    if (jobs) return jobs;
    const stored = persistence ? await persistence.read() : null;
    jobs = new Map((stored || []).map((j) => [j.taskId, j]));
    return jobs;
  }

  async function flush() {
    if (persistence) await persistence.write([...jobs.values()]);
  }

  const nowMs = () => Date.parse(now());
  const leaseExpired = (record) => !record.leaseExpiresAt || Date.parse(record.leaseExpiresAt) <= nowMs();

  async function requireJob(taskId) {
    const store = await load();
    const record = store.get(taskId);
    if (!record) throw bridgeError('TASK_NOT_FOUND', `Unknown browser task "${taskId}".`);
    return record;
  }

  // Cùng một chỗ kiểm cho cả gia hạn lẫn nộp kết quả: đã huỷ thì báo huỷ, không phải chủ lease
  // thì báo mất lease. Thứ tự này quan trọng — worker cần biết "việc đã bị huỷ" trước tiên.
  function assertOwner(record, claimant) {
    if (record.status === 'CANCELLED') {
      throw bridgeError('TASK_CANCELLED', `Browser task "${record.taskId}" was cancelled.`);
    }
    if (record.status !== 'LEASED' || record.leaseOwner !== claimant || leaseExpired(record)) {
      throw bridgeError('LEASE_LOST', `The lease on "${record.taskId}" is no longer held by this worker.`);
    }
  }

  async function enqueue(input) {
    const store = await load();
    if (typeof input?.taskId !== 'string' || !input.taskId.trim()) {
      throw new TypeError('browserJob: "taskId" is required.');
    }
    if (typeof input?.providerId !== 'string' || !input.providerId.trim()) {
      throw new TypeError('browserJob: "providerId" is required.');
    }
    assertNoCredentials(input.payload ?? {});

    // Idempotent theo taskId: Runtime thử lại lệnh xếp hàng không được tạo ra job thứ hai.
    const existing = store.get(input.taskId);
    if (existing) return structuredClone(existing);

    const record = {
      taskId: input.taskId,
      providerId: input.providerId,
      payload: structuredClone(input.payload ?? {}),
      meta: structuredClone(input.meta ?? {}),
      status: 'PENDING',
      attempts: 0,
      createdAt: now(),
      updatedAt: now(),
      leaseOwner: null,
      leaseExpiresAt: null,
      result: null,
    };
    store.set(record.taskId, record);
    await flush();
    return structuredClone(record);
  }

  async function claimNext({ claimant } = {}) {
    if (typeof claimant !== 'string' || !claimant.trim()) {
      throw new TypeError('claimNext: "claimant" is required.');
    }
    const store = await load();
    for (const record of store.values()) {
      const takeable = record.status === 'PENDING' || (record.status === 'LEASED' && leaseExpired(record));
      if (!takeable) continue;
      record.status = 'LEASED';
      record.leaseOwner = claimant;
      record.leaseExpiresAt = new Date(nowMs() + leaseMs).toISOString();
      record.attempts += 1;
      record.updatedAt = now();
      await flush();
      return structuredClone(record);
    }
    return null;
  }

  async function renewLease(taskId, { claimant } = {}) {
    const record = await requireJob(taskId);
    assertOwner(record, claimant);
    record.leaseExpiresAt = new Date(nowMs() + leaseMs).toISOString();
    record.updatedAt = now();
    await flush();
    return structuredClone(record);
  }

  async function submitResult(taskId, result, { claimant } = {}) {
    const record = await requireJob(taskId);
    // Nộp lại sau khi đã hoàn tất: trả về đúng kết quả cũ. Đây là đường phục hồi khi
    // Extension mất mạng lúc nhận phản hồi, không phải lỗi.
    if (record.status === 'COMPLETED') return { ...structuredClone(record), duplicate: true };
    assertOwner(record, claimant);
    record.status = 'COMPLETED';
    record.result = structuredClone(result ?? null);
    record.leaseOwner = null;
    record.leaseExpiresAt = null;
    record.updatedAt = now();
    await flush();
    return { ...structuredClone(record), duplicate: false };
  }

  async function cancel(taskId) {
    const record = await requireJob(taskId);
    if (record.status !== 'COMPLETED') {
      record.status = 'CANCELLED';
      record.leaseOwner = null;
      record.leaseExpiresAt = null;
      record.updatedAt = now();
      await flush();
    }
    return structuredClone(record);
  }

  return {
    enqueue,
    claimNext,
    renewLease,
    submitResult,
    cancel,
    newLeaseToken: leaseTokenFactory,
    get: async (taskId) => {
      const record = (await load()).get(taskId);
      return record ? structuredClone(record) : null;
    },
    list: async () => [...(await load()).values()].map((r) => structuredClone(r)),
  };
}

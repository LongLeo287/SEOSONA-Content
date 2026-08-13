// Hợp đồng provider TRUNG LẬP.
//
// Đây là hàng rào giữa hai thế giới:
//   - Bên trên (Writing Core / Gateway) mô tả VIỆC CẦN LÀM: viết gì, theo hợp đồng đầu ra nào,
//     dựa trên ảnh chụp ngữ cảnh nào, được phép tốn tiền hay không.
//   - Bên dưới (adapter) biết CÁCH làm: bấm nút nào trên trang web, gọi endpoint nào, dùng khóa nào.
//
// Nếu `selector`, `tabId`, `cookie`, `apiKey` lọt được lên ProviderTask thì hàng rào đã thủng:
// Writing Core lập tức phụ thuộc vào một nhà cung cấp cụ thể. Nên ở đây từ chối thẳng.

export const COST_CLASSES = new Set([
  'ZERO_INCREMENTAL', // phiên đăng nhập sẵn có — chạy thêm một lần không tốn thêm đồng nào
  'FREE_QUOTA',       // có hạn mức miễn phí, hết hạn mức là hết
  'PAID_ALLOWED',     // trả tiền, và người dùng đã đồng ý rõ ràng
  'PAID_BLOCKED',     // trả tiền, đang bị chặn
  'UNKNOWN_COST',     // KHÔNG BIẾT — và không biết thì không được coi là miễn phí
]);

export const BROWSER_STATES = new Set([
  'READY', 'AUTH_REQUIRED', 'BUSY', 'RATE_LIMITED', 'UI_CHANGED',
  'CONTENT_BLOCKED', 'TIMEOUT', 'COMPLETED', 'UNAVAILABLE',
]);

export const TASK_TYPES = new Set([
  'WRITE', 'EDIT', 'AUDIT', 'RESEARCH', 'EXTRACT', 'STRUCTURE', 'REPURPOSE',
]);

export const RESULT_STATUSES = new Set(['COMPLETED', 'FAILED', 'BLOCKED']);

export const PARSE_STATUSES = new Set(['NOT_APPLICABLE', 'OK', 'REPAIRED', 'INVALID']);

// Tên trường thuộc về tầng dưới. So khớp không phân biệt hoa thường và bỏ qua `_`/`-`
// để `tab_id`, `TabId`, `API-KEY` đều bị bắt.
const LAYER_LEAK_FIELDS = new Map([
  ['selector', 'selector'], ['selectors', 'selector'],
  ['tabid', 'tabId'], ['tab', 'tabId'],
  ['chrome', 'chrome'],
  ['cookie', 'cookie'], ['cookies', 'cookie'],
  ['apikey', 'apiKey'], ['authorization', 'apiKey'], ['bearer', 'apiKey'],
]);

const DEFAULT_TIMEOUT_MS = 180_000;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** Chỉ phiên đăng nhập sẵn có mới là "không tốn thêm". Mọi thứ khác, kể cả không rõ, đều không. */
export function isZeroIncremental(costClass) {
  return costClass === 'ZERO_INCREMENTAL';
}

function fail(what, message) {
  throw new TypeError(`${what}: ${message}`);
}

function requireString(value, field, what) {
  if (typeof value !== 'string' || !value.trim()) fail(what, `"${field}" is required and must be a non-empty string.`);
  return value;
}

function requireIso(value, field, what) {
  if (typeof value !== 'string' || !ISO_RE.test(value) || Number.isNaN(Date.parse(value))) {
    fail(what, `"${field}" must be an ISO-8601 timestamp.`);
  }
  return value;
}

function requireStringArray(value, field, what) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !v.trim())) {
    fail(what, `"${field}" must be an array of non-empty strings.`);
  }
  return [...value];
}

function requirePlainObject(value, field, what, { allowMissing = false } = {}) {
  if (value === undefined && allowMissing) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(what, `"${field}" must be an object.`);
  }
  return value;
}

function assertNoLayerLeak(value, what) {
  for (const key of Object.keys(value)) {
    const canonical = LAYER_LEAK_FIELDS.get(key.toLowerCase().replace(/[_-]/g, ''));
    if (canonical) {
      fail(what, `field "${key}" (${canonical}) belongs to a provider adapter and must not cross the provider contract boundary.`);
    }
  }
}

function assertCostPolicy(value, what) {
  const policy = requirePlainObject(value, 'costPolicy', what, { allowMissing: true });
  const allow = requireStringArray(policy.allow, 'costPolicy.allow', what);
  for (const cls of allow) {
    if (!COST_CLASSES.has(cls)) fail(what, `costPolicy.allow contains unknown cost class "${cls}".`);
  }
  if (policy.paidApi !== undefined && typeof policy.paidApi !== 'boolean') {
    fail(what, '"costPolicy.paidApi" must be a boolean.');
  }
  // Mặc định: KHÔNG dùng API trả tiền. Muốn tốn tiền thì phải nói rõ.
  return { paidApi: policy.paidApi === true, allow };
}

export function assertProviderTask(value) {
  const what = 'providerTask';
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(what, 'must be an object.');
  assertNoLayerLeak(value, what);

  const taskType = value.taskType === undefined ? 'WRITE' : value.taskType;
  if (!TASK_TYPES.has(taskType)) fail(what, `"taskType" must be one of ${[...TASK_TYPES].join(', ')}.`);

  const timeoutMs = value.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : value.timeoutMs;
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    fail(what, '"timeoutMs" must be a positive finite number of milliseconds.');
  }

  const privacy = requirePlainObject(value.privacyPolicy, 'privacyPolicy', what, { allowMissing: true });

  const task = {
    taskId: requireString(value.taskId, 'taskId', what),
    taskType,
    contentJob: requireString(value.contentJob, 'contentJob', what),
    requiredCapabilities: requireStringArray(value.requiredCapabilities, 'requiredCapabilities', what),
    contextSnapshotId: requireString(value.contextSnapshotId, 'contextSnapshotId', what),
    contextBundle: requirePlainObject(value.contextBundle, 'contextBundle', what),
    outputContract: requirePlainObject(value.outputContract, 'outputContract', what, { allowMissing: true }),
    privacyPolicy: {
      // allowRemote=false nghĩa là nội dung này không được gửi ra provider ngoài máy.
      allowRemote: privacy.allowRemote !== false,
      redactFields: requireStringArray(privacy.redactFields, 'privacyPolicy.redactFields', what),
    },
    costPolicy: assertCostPolicy(value.costPolicy, what),
    timeoutMs,
    // Khóa tay: chỉ định thẳng provider, Auto Router phải nhường.
    providerPreference: value.providerPreference === undefined ? null : value.providerPreference,
  };

  if (task.providerPreference !== null) requireString(task.providerPreference, 'providerPreference', what);
  return structuredClone(task);
}

export function assertProviderResult(value) {
  const what = 'providerResult';
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(what, 'must be an object.');

  const { status } = value;
  if (!RESULT_STATUSES.has(status)) fail(what, `"status" must be one of ${[...RESULT_STATUSES].join(', ')}.`);
  if (!COST_CLASSES.has(value.costClass)) fail(what, `"costClass" must be one of ${[...COST_CLASSES].join(', ')}.`);

  const parseStatus = value.parseStatus === undefined ? 'NOT_APPLICABLE' : value.parseStatus;
  if (!PARSE_STATUSES.has(parseStatus)) fail(what, `"parseStatus" must be one of ${[...PARSE_STATUSES].join(', ')}.`);

  const startedAt = requireIso(value.startedAt, 'startedAt', what);
  const completedAt = requireIso(value.completedAt, 'completedAt', what);
  if (Date.parse(completedAt) < Date.parse(startedAt)) {
    fail(what, '"completedAt" must not be earlier than "startedAt".');
  }

  // Thành công thì không kèm lỗi; thất bại/bị chặn thì bắt buộc phải nói rõ vì sao và
  // có đáng thử lại không — Gateway dựa vào đúng cờ này để quyết định chuyển provider.
  const error = value.error === undefined ? null : value.error;
  if (status === 'COMPLETED' && error !== null) {
    fail(what, 'a COMPLETED result must not carry an "error".');
  }
  if (status !== 'COMPLETED') {
    requirePlainObject(error, 'error', what);
    requireString(error.code, 'error.code', what);
    requireString(error.message, 'error.message', what);
    if (typeof error.retryable !== 'boolean') fail(what, '"error.retryable" must be an explicit boolean.');
  }

  return structuredClone({
    status,
    output: value.output === undefined ? null : value.output,
    providerId: requireString(value.providerId, 'providerId', what),
    modelSession: value.modelSession === undefined ? null : value.modelSession,
    startedAt,
    completedAt,
    costClass: value.costClass,
    parseStatus,
    warnings: requireStringArray(value.warnings, 'warnings', what),
    error: error === null ? null : { code: error.code, message: error.message, retryable: error.retryable },
    receipt: value.receipt === undefined ? null : value.receipt,
  });
}

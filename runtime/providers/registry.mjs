import { COST_CLASSES } from './contracts.mjs';
import { createQualityTracker } from './quality-signals.mjs';

// Sổ đăng ký provider: cấu hình + những gì QUAN SÁT ĐƯỢC về từng provider.
//
// Điểm dễ sai nhất ở đây là "gieo sẵn" chất lượng hay sức khỏe cho provider — kiểu đặt
// timeoutRate = 0 cho gọn. Số 0 đó không phải "chưa lỗi lần nào", mà là "chưa đo lần nào";
// để nó lọt vào router là ta đang thay người dùng chọn hãng dựa trên dữ liệu tưởng tượng.
// Nên mọi chỉ số chưa đo đều là `null`.

export const ADAPTER_TYPES = new Set(['BROWSER', 'API']);
export const AVAILABILITY = new Set(['UNKNOWN', 'UP', 'DEGRADED', 'DOWN']);
export const AUTH_STATES = new Set(['UNKNOWN', 'AUTHENTICATED', 'AUTH_REQUIRED']);

const RATE_FIELDS = ['timeoutRate', 'rateLimitRate', 'selectorHealth', 'parseFailureRate', 'retryRate'];

function emptyHealth() {
  return {
    availability: 'UNKNOWN',
    auth: 'UNKNOWN',
    timeoutRate: null,
    rateLimitRate: null,
    selectorHealth: null,
    parseFailureRate: null,
    retryRate: null,
    lastUpdatedAt: null,
  };
}

// Danh sách hạt giống. Provider trình duyệt là ZERO_INCREMENTAL vì dùng đúng phiên đăng nhập
// người dùng đã trả tiền sẵn; chạy thêm một lần không phát sinh hóa đơn mới.
// `api-v1` cố ý tắt và UNKNOWN_COST: chưa cấu hình thì không được đoán là miễn phí.
export const SEED_PROVIDERS = Object.freeze([
  { providerId: 'chatgpt-web', adapterType: 'BROWSER', costClass: 'ZERO_INCREMENTAL', enabled: true },
  { providerId: 'claude-web', adapterType: 'BROWSER', costClass: 'ZERO_INCREMENTAL', enabled: true },
  { providerId: 'gemini-web', adapterType: 'BROWSER', costClass: 'ZERO_INCREMENTAL', enabled: true },
  { providerId: 'grok-web', adapterType: 'BROWSER', costClass: 'ZERO_INCREMENTAL', enabled: true },
  { providerId: 'api-v1', adapterType: 'API', costClass: 'UNKNOWN_COST', enabled: false },
]);

function providerError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function validatePatch(patch) {
  if (!patch || typeof patch !== 'object') throw new TypeError('provider: record must be an object.');
  if (patch.adapterType !== undefined && !ADAPTER_TYPES.has(patch.adapterType)) {
    throw new TypeError(`provider: "adapterType" must be one of ${[...ADAPTER_TYPES].join(', ')}.`);
  }
  if (patch.costClass !== undefined && !COST_CLASSES.has(patch.costClass)) {
    throw new TypeError(`provider: "costClass" must be one of ${[...COST_CLASSES].join(', ')}.`);
  }
  if (patch.authStatus !== undefined && !AUTH_STATES.has(patch.authStatus)) {
    throw new TypeError(`provider: "authStatus" must be one of ${[...AUTH_STATES].join(', ')}.`);
  }
  if (patch.capabilities !== undefined
    && (!Array.isArray(patch.capabilities) || patch.capabilities.some((c) => typeof c !== 'string'))) {
    throw new TypeError('provider: "capabilities" must be an array of strings.');
  }
  if (patch.latencyMs !== undefined && patch.latencyMs !== null
    && (typeof patch.latencyMs !== 'number' || !Number.isFinite(patch.latencyMs) || patch.latencyMs < 0)) {
    throw new TypeError('provider: "latencyMs" must be a non-negative number.');
  }
}

function validateHealthPatch(patch) {
  if (!patch || typeof patch !== 'object') throw new TypeError('providerHealth: patch must be an object.');
  const allowed = new Set([...RATE_FIELDS, 'availability', 'auth', 'at']);
  for (const key of Object.keys(patch)) {
    if (!allowed.has(key)) throw new TypeError(`providerHealth: unknown field "${key}".`);
  }
  if (patch.availability !== undefined && !AVAILABILITY.has(patch.availability)) {
    throw new TypeError(`providerHealth: "availability" must be one of ${[...AVAILABILITY].join(', ')}.`);
  }
  if (patch.auth !== undefined && !AUTH_STATES.has(patch.auth)) {
    throw new TypeError(`providerHealth: "auth" must be one of ${[...AUTH_STATES].join(', ')}.`);
  }
  for (const field of RATE_FIELDS) {
    const v = patch[field];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
      throw new TypeError(`providerHealth: "${field}" must be a number between 0 and 1.`);
    }
  }
}

export function createProviderRegistry(initial = [], { windowSize } = {}) {
  const providers = new Map();
  const quality = createQualityTracker(windowSize ? { windowSize } : {});

  function upsert(record) {
    validatePatch(record);
    if (typeof record.providerId !== 'string' || !record.providerId.trim()) {
      throw new TypeError('provider: "providerId" is required.');
    }
    const existing = providers.get(record.providerId);
    if (!existing && !record.adapterType) {
      throw new TypeError('provider: "adapterType" is required when creating a provider.');
    }
    const merged = {
      providerId: record.providerId,
      adapterType: record.adapterType ?? existing?.adapterType,
      capabilities: record.capabilities ? [...record.capabilities] : existing?.capabilities ?? [],
      costClass: record.costClass ?? existing?.costClass ?? 'UNKNOWN_COST',
      enabled: record.enabled === undefined ? existing?.enabled ?? true : record.enabled === true,
      authStatus: record.authStatus ?? existing?.authStatus ?? 'UNKNOWN',
      latencyMs: record.latencyMs === undefined ? existing?.latencyMs ?? null : record.latencyMs,
      label: record.label ?? existing?.label ?? record.providerId,
      // Sức khỏe là kết quả quan sát, không bị một lần đổi cài đặt xóa mất.
      health: existing?.health ?? emptyHealth(),
    };
    providers.set(merged.providerId, merged);
    return read(merged.providerId);
  }

  function requireProvider(providerId) {
    const provider = providers.get(providerId);
    if (!provider) throw providerError('PROVIDER_NOT_FOUND', `Unknown provider "${providerId}".`);
    return provider;
  }

  function read(providerId) {
    const provider = providers.get(providerId);
    if (!provider) return null;
    // Trả bản sao: người gọi sửa tay cũng không đụng được vào trạng thái thật.
    return structuredClone({ ...provider, qualityByJob: quality.summaryByJob(providerId) });
  }

  function updateHealth(providerId, patch) {
    const provider = requireProvider(providerId);
    validateHealthPatch(patch);
    const { at, ...fields } = patch;
    for (const [key, value] of Object.entries(fields)) provider.health[key] = value;
    provider.health.lastUpdatedAt = at ?? new Date().toISOString();
    return read(providerId);
  }

  function recordQualitySignal(signal) {
    requireProvider(signal?.providerId);
    quality.record(signal);
    return read(signal.providerId);
  }

  for (const record of initial) upsert(record);

  return {
    upsert,
    get: read,
    list: () => [...providers.keys()].map(read),
    updateHealth,
    recordQualitySignal,
    qualitySummary: (providerId, contentJob) => quality.summary(providerId, contentJob),
  };
}

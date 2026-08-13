export const COST_CLASSES = new Set(['ZERO_INCREMENTAL','FREE_QUOTA','PAID_ALLOWED','PAID_BLOCKED','UNKNOWN_COST']);
export const BROWSER_STATES = new Set(['READY','AUTH_REQUIRED','BUSY','RATE_LIMITED','UI_CHANGED','CONTENT_BLOCKED','TIMEOUT','COMPLETED','UNAVAILABLE']);
export const TASK_TYPES = new Set(['WRITE','EDIT','AUDIT','RESEARCH','EXTRACT','STRUCTURE','REPURPOSE']);
const RESULT_STATES = new Set(['COMPLETED','FAILED','BLOCKED']);
const FORBIDDEN_TASK_FIELDS = ['selector', 'tabId', 'chrome', 'cookie', 'apiKey'];

function object(value, label) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`); }
function string(value, label) { if (typeof value !== 'string' || !value) throw new Error(`${label} is required.`); }

export function assertProviderTask(value) {
  object(value, 'ProviderTask');
  for (const field of FORBIDDEN_TASK_FIELDS) if (Object.prototype.hasOwnProperty.call(value, field)) throw new Error(`${field} is not allowed in ProviderTask.`);
  string(value.taskId, 'taskId');
  if (!TASK_TYPES.has(value.taskType)) throw new Error('taskType is invalid.');
  string(value.contentJob, 'contentJob');
  if (!Array.isArray(value.requiredCapabilities)) throw new Error('requiredCapabilities must be an array.');
  string(value.contextSnapshotId, 'contextSnapshotId');
  object(value.contextBundle, 'contextBundle');
  object(value.outputContract, 'outputContract');
  object(value.privacyPolicy, 'privacyPolicy');
  object(value.costPolicy, 'costPolicy');
  if (!Number.isFinite(value.timeoutMs) || value.timeoutMs <= 0) throw new Error('timeoutMs must be a positive number.');
  if (typeof value.providerPreference !== 'string') throw new Error('providerPreference must be a string.');
  return structuredClone(value);
}

export function assertProviderResult(value) {
  object(value, 'ProviderResult');
  if (!RESULT_STATES.has(value.status)) throw new Error('status is invalid.');
  string(value.providerId, 'providerId');
  if (typeof value.modelSession !== 'string') throw new Error('modelSession must be a string.');
  string(value.startedAt, 'startedAt');
  string(value.completedAt, 'completedAt');
  if (!COST_CLASSES.has(value.costClass)) throw new Error('costClass is invalid.');
  string(value.parseStatus, 'parseStatus');
  if (!Array.isArray(value.warnings)) throw new Error('warnings must be an array.');
  if (value.error !== null) {
    object(value.error, 'error'); string(value.error.code, 'error.code'); string(value.error.message, 'error.message');
    if (typeof value.error.retryable !== 'boolean') throw new Error('error.retryable must be boolean.');
  }
  object(value.receipt, 'receipt');
  return structuredClone(value);
}

export const RECORD_TYPES = new Set([
  'workspace', 'project', 'brand', 'source', 'sourceBlock', 'evidence', 'claim', 'content', 'revision',
  'job', 'jobStage', 'providerAttempt', 'providerReceipt', 'evaluation', 'contextSnapshot', 'providerConfig',
  'signal', 'appliedPageEvent',
]);

const REQUIRED = {
  workspace: ['workspaceId', 'name', 'createdAt'],
  project: ['projectId', 'workspaceId', 'name', 'status', 'createdAt'],
  brand: ['brandId', 'workspaceId', 'name'],
  source: ['sourceId', 'projectId', 'kind', 'title', 'retrievedAt'],
  sourceBlock: ['blockId', 'sourceId', 'type', 'locator'],
  evidence: ['evidenceId', 'projectId', 'sourceId', 'statement', 'type', 'locator'],
  claim: ['claimId', 'proposition', 'type', 'strength', 'status'],
  content: ['contentId', 'projectId', 'jobType', 'title', 'status', 'currentRevisionId'],
  revision: ['revisionId', 'contentId', 'operation', 'payload', 'createdAt'],
  job: ['jobId', 'projectId', 'workflowVersion', 'contentJob', 'status', 'contextSnapshotId', 'createdAt'],
  jobStage: ['stageId', 'jobId', 'type', 'status'],
  providerAttempt: ['attemptId', 'jobId', 'stageId', 'providerId', 'status'],
  providerReceipt: ['receiptId', 'attemptId', 'providerId', 'costClass', 'resultDigest'],
  evaluation: ['evaluationId', 'revisionId', 'evaluatorType', 'verdict'],
  contextSnapshot: ['contextSnapshotId', 'projectId', 'hash', 'sourceRefs', 'evidenceRefs', 'jobPack', 'policy'],
  providerConfig: ['providerConfigId', 'workspaceId', 'providerId', 'enabled', 'costPolicy'],
  signal: ['signalId', 'projectId', 'type', 'value', 'createdAt'],
  appliedPageEvent: ['eventId', 'projectId', 'revisionId', 'url', 'surface', 'action', 'timestamp'],
};

const OBJECT_FIELDS = new Set(['payload', 'locator', 'jobPack', 'policy']);
const ARRAY_FIELDS = new Set(['sourceRefs', 'evidenceRefs']);
const BOOLEAN_FIELDS = new Set(['enabled']);
const ANY_FIELDS = new Set(['value']);

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
}

function assertPresent(record, key) {
  if (!(key in record) || record[key] === undefined || record[key] === null || record[key] === '') {
    throw new Error(`${key} is required.`);
  }
  if (OBJECT_FIELDS.has(key)) assertObject(record[key], key);
  else if (ARRAY_FIELDS.has(key) && !Array.isArray(record[key])) throw new Error(`${key} must be an array.`);
  else if (BOOLEAN_FIELDS.has(key) && typeof record[key] !== 'boolean') throw new Error(`${key} must be a boolean.`);
  else if (!OBJECT_FIELDS.has(key) && !ARRAY_FIELDS.has(key) && !BOOLEAN_FIELDS.has(key) && !ANY_FIELDS.has(key) && typeof record[key] !== 'string') {
    throw new Error(`${key} must be a string.`);
  }
}

export function assertRecord(type, value) {
  if (!RECORD_TYPES.has(type)) throw new Error(`Unknown record type: ${type}.`);
  assertObject(value, type);
  const record = structuredClone(value);
  for (const key of REQUIRED[type]) assertPresent(record, key);
  if (type === 'claim') {
    const scopes = ['contentId', 'brandId'].filter((key) => typeof record[key] === 'string' && record[key]);
    if (scopes.length !== 1) throw new Error('Claim requires exactly one of contentId or brandId.');
  }
  if (type === 'providerConfig' && record.secretRef !== null && record.secretRef !== undefined && typeof record.secretRef !== 'string') {
    throw new Error('secretRef must be a string or null.');
  }
  return record;
}

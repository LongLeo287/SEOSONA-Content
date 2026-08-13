import test from 'node:test';
import assert from 'node:assert/strict';
import { makeId } from '../runtime/lib/ids.mjs';
import { assertRecord, RECORD_TYPES } from '../runtime/domain/records.mjs';

test('makeId is prefix-scoped and portable', () => {
  const id = makeId('project', { now: () => 123, random: () => 'ABC-DEF' });
  assert.equal(id, 'project_123_abcdef');
  assert.match(id, /^[a-z]+_[a-z0-9_]+$/);
});

test('revision requires contentId and immutable payload', () => {
  assert.throws(() => assertRecord('revision', { revisionId: 'rev_1' }), /contentId/);
  const value = assertRecord('revision', {
    revisionId: 'revision_1', contentId: 'content_1', operation: 'CREATE', payload: { body: 'Hello' }, createdAt: '2026-08-12T00:00:00.000Z'
  });
  assert.equal(value.contentId, 'content_1');
});

test('record contracts validate every V1 primary and foreign key', () => {
  const valid = {
    workspace: { workspaceId: 'workspace_1', name: 'Local', createdAt: '2026-08-13T00:00:00.000Z' },
    project: { projectId: 'project_1', workspaceId: 'workspace_1', name: 'P', status: 'active', createdAt: '2026-08-13T00:00:00.000Z' },
    brand: { brandId: 'brand_1', workspaceId: 'workspace_1', name: 'B' },
    source: { sourceId: 'source_1', projectId: 'project_1', kind: 'url', title: 'S', retrievedAt: '2026-08-13T00:00:00.000Z' },
    sourceBlock: { blockId: 'block_1', sourceId: 'source_1', type: 'text', text: 'x', locator: { index: 0 } },
    evidence: { evidenceId: 'evidence_1', projectId: 'project_1', sourceId: 'source_1', statement: 'Fact', type: 'FACT', locator: { index: 0 } },
    claim: { claimId: 'claim_1', contentId: 'content_1', proposition: 'Claim', type: 'FACTUAL', strength: 'qualified', status: 'SUPPORTED' },
    content: { contentId: 'content_1', projectId: 'project_1', jobType: 'article', title: 'T', status: 'draft', currentRevisionId: 'revision_1' },
    revision: { revisionId: 'revision_1', contentId: 'content_1', operation: 'CREATE', payload: { body: 'x' }, createdAt: '2026-08-13T00:00:00.000Z' },
    job: { jobId: 'job_1', projectId: 'project_1', workflowVersion: '1.0', contentJob: 'article', status: 'queued', contextSnapshotId: 'context_1', createdAt: '2026-08-13T00:00:00.000Z' },
    jobStage: { stageId: 'stage_1', jobId: 'job_1', type: 'WRITE', status: 'queued' },
    providerAttempt: { attemptId: 'attempt_1', jobId: 'job_1', stageId: 'stage_1', providerId: 'browser:claude', status: 'queued' },
    providerReceipt: { receiptId: 'receipt_1', attemptId: 'attempt_1', providerId: 'browser:claude', costClass: 'ZERO_INCREMENTAL', resultDigest: 'abc' },
    evaluation: { evaluationId: 'evaluation_1', revisionId: 'revision_1', evaluatorType: 'factuality', verdict: 'PASS' },
    contextSnapshot: { contextSnapshotId: 'context_1', projectId: 'project_1', hash: 'abc', sourceRefs: [], evidenceRefs: [], jobPack: { id: 'article', version: '1.0' }, policy: {} },
    providerConfig: { providerConfigId: 'providerconfig_1', workspaceId: 'workspace_1', providerId: 'browser:claude', enabled: true, costPolicy: 'ZERO_INCREMENTAL', secretRef: null },
    signal: { signalId: 'signal_1', projectId: 'project_1', type: 'accept', value: true, createdAt: '2026-08-13T00:00:00.000Z' },
    appliedPageEvent: { eventId: 'event_1', projectId: 'project_1', revisionId: 'revision_1', url: 'https://example.com', surface: 'browser', action: 'replace', timestamp: '2026-08-13T00:00:00.000Z' },
  };
  assert.deepEqual([...RECORD_TYPES].sort(), Object.keys(valid).sort());
  for (const [type, record] of Object.entries(valid)) assert.deepEqual(assertRecord(type, record), record);
});

test('assertRecord rejects unknown types and missing foreign keys without mutating input', () => {
  assert.throws(() => assertRecord('unknown', {}), /Unknown record type/);
  assert.throws(() => assertRecord('project', { projectId: 'project_1' }), /workspaceId/);
  const original = { projectId: 'project_1', workspaceId: 'workspace_1', name: 'P', status: 'active', createdAt: 'now', nested: { x: 1 } };
  const cloned = assertRecord('project', original);
  cloned.nested.x = 2;
  assert.equal(original.nested.x, 1);
});

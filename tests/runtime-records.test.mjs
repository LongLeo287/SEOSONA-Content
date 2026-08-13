import test from 'node:test';
import assert from 'node:assert/strict';
import { makeId } from '../runtime/lib/ids.mjs';
import { assertRecord, RECORD_TYPES } from '../runtime/domain/records.mjs';

test('makeId is prefix-scoped and portable', () => {
  const id = makeId('project', { now: () => 123, random: () => 'ABC-DEF' });
  assert.equal(id, 'project_123_abcdef');
  assert.match(id, /^[a-z]+_[a-z0-9_]+$/);
});

test('makeId rejects empty prefix or empty suffix', () => {
  assert.throws(() => makeId('', { now: () => 1, random: () => 'abc' }), /required/);
  assert.throws(() => makeId('project', { now: () => 1, random: () => '---' }), /required/);
});

test('revision requires contentId and immutable payload', () => {
  assert.throws(() => assertRecord('revision', { revisionId: 'rev_1' }), /contentId/);
  const value = assertRecord('revision', {
    revisionId: 'revision_1',
    contentId: 'content_1',
    operation: 'CREATE',
    payload: { body: 'Hello' },
    createdAt: '2026-08-12T00:00:00.000Z',
  });
  assert.equal(value.contentId, 'content_1');
});

test('assertRecord rejects unknown entity types', () => {
  assert.throws(() => assertRecord('nope', { id: 'x' }), /unknown record type/i);
});

test('assertRecord returns a clone and never mutates input', () => {
  const input = {
    revisionId: 'revision_1',
    contentId: 'content_1',
    operation: 'CREATE',
    payload: { body: 'Hello' },
    createdAt: '2026-08-12T00:00:00.000Z',
  };
  const out = assertRecord('revision', input);
  out.payload.body = 'Changed';
  assert.equal(input.payload.body, 'Hello', 'input must not be mutated');
  assert.notEqual(out, input);
});

// Every V1 entity: a minimal valid record, plus proof that dropping one required key throws.
const VALID = {
  workspace: { workspaceId: 'workspace_1', name: 'WS', createdAt: '2026-08-12T00:00:00.000Z' },
  project: { projectId: 'project_1', workspaceId: 'workspace_1', name: 'P', createdAt: '2026-08-12T00:00:00.000Z' },
  brand: { brandId: 'brand_1', workspaceId: 'workspace_1', name: 'B', createdAt: '2026-08-12T00:00:00.000Z' },
  source: { sourceId: 'source_1', projectId: 'project_1', sha256: 'sha256-abc', retrievedAt: '2026-08-12T00:00:00.000Z' },
  sourceBlock: { blockId: 'sourceblock_1', sourceId: 'source_1', locator: { page: 1 } },
  evidence: { evidenceId: 'evidence_1', sourceId: 'source_1', statement: 'X is Y' },
  claim: { claimId: 'claim_1', proposition: 'X causes Y', strength: 'ASSOCIATED' },
  content: { contentId: 'content_1', projectId: 'project_1', contentJob: 'article', createdAt: '2026-08-12T00:00:00.000Z' },
  revision: { revisionId: 'revision_1', contentId: 'content_1', operation: 'CREATE', payload: { body: 'x' }, createdAt: '2026-08-12T00:00:00.000Z' },
  job: { jobId: 'job_1', projectId: 'project_1', contextSnapshotId: 'contextsnapshot_1', status: 'PENDING', createdAt: '2026-08-12T00:00:00.000Z' },
  jobStage: { stageId: 'jobstage_1', jobId: 'job_1', stage: 'WRITE', status: 'PENDING' },
  providerAttempt: { attemptId: 'providerattempt_1', jobId: 'job_1', provider: 'browser-a', startedAt: '2026-08-12T00:00:00.000Z' },
  providerReceipt: { receiptId: 'providerreceipt_1', provider: 'browser-a', at: '2026-08-12T00:00:00.000Z' },
  evaluation: { evaluationId: 'evaluation_1', revisionId: 'revision_1', evaluator: 'fact', verdict: 'PASS' },
  contextSnapshot: { contextSnapshotId: 'contextsnapshot_1', hash: 'sha256-abc', compiledAt: '2026-08-12T00:00:00.000Z' },
  providerConfig: { providerConfigId: 'providerconfig_1', provider: 'browser-a' },
  signal: { signalId: 'signal_1', type: 'ACCEPT', at: '2026-08-12T00:00:00.000Z' },
  appliedPageEvent: { eventId: 'appliedpageevent_1', revisionId: 'revision_1', url: 'https://x.test/a', surface: 'extension', action: 'INSERT', at: '2026-08-12T00:00:00.000Z' },
};

test('every V1 record type is declared exactly once', () => {
  assert.deepEqual([...RECORD_TYPES].sort(), Object.keys(VALID).sort());
});

for (const [type, value] of Object.entries(VALID)) {
  test(`${type}: minimal valid record passes`, () => {
    const out = assertRecord(type, value);
    assert.equal(typeof out, 'object');
  });

  test(`${type}: dropping any required key throws`, () => {
    for (const key of Object.keys(value)) {
      const partial = { ...value };
      delete partial[key];
      assert.throws(
        () => assertRecord(type, partial),
        new RegExp(key),
        `${type} must reject a record missing "${key}"`,
      );
    }
  });
}

test('providerReceipt refuses to carry secret material', () => {
  assert.throws(
    () => assertRecord('providerReceipt', { ...VALID.providerReceipt, apiKey: 'sk-live-123' }),
    /secret/i,
  );
});

test('claim strength must belong to the known ladder', () => {
  assert.throws(() => assertRecord('claim', { ...VALID.claim, strength: 'VERY_STRONG' }), /strength/);
});

test('evaluation verdict must belong to the known set', () => {
  assert.throws(() => assertRecord('evaluation', { ...VALID.evaluation, verdict: 'MAYBE' }), /verdict/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as JobState from '../runtime/domain/job-state.mjs';

function initial() {
  return JobState.create({
    jobId: 'job_1', projectId: 'project_1', workflowVersion: '1.0', contentJob: 'article', contextSnapshotId: 'context_1', at: '2026-08-13T01:00:00.000Z'
  });
}

test('job reducer tracks append-only history, stages, checkpoints and provider attempts', () => {
  let state = initial();
  state = JobState.transition(state, { type: 'JOB_STARTED', at: 't1' });
  state = JobState.transition(state, { type: 'STAGE_STARTED', stageId: 'stage_write', stageType: 'WRITE', attempt: 1, at: 't2' });
  state = JobState.transition(state, { type: 'PROVIDER_ATTEMPT_STARTED', attemptId: 'attempt_1', providerId: 'browser:claude', at: 't3' });
  state = JobState.transition(state, { type: 'STAGE_CHECKPOINTED', checkpointRef: 'checkpoint_1', at: 't4' });
  state = JobState.transition(state, { type: 'PROVIDER_ATTEMPT_COMPLETED', attemptId: 'attempt_1', status: 'completed', receiptId: 'receipt_1', at: 't5' });
  state = JobState.transition(state, { type: 'STAGE_COMPLETED', outputRef: 'revision_1', at: 't6' });

  assert.equal(state.status, 'running');
  assert.equal(state.activeStage, null);
  assert.equal(state.completedStages[0].stageId, 'stage_write');
  assert.equal(state.completedStages[0].checkpointRef, 'checkpoint_1');
  assert.equal(state.providerAttempts[0].receiptId, 'receipt_1');
  assert.deepEqual(state.history.map((x) => x.event), [
    'CREATED', 'JOB_STARTED', 'STAGE_STARTED', 'PROVIDER_ATTEMPT_STARTED', 'STAGE_CHECKPOINTED', 'PROVIDER_ATTEMPT_COMPLETED', 'STAGE_COMPLETED'
  ]);
});

test('failed stage can resume but a completed stage cannot be started again', () => {
  let state = initial();
  state = JobState.transition(state, { type: 'JOB_STARTED' });
  state = JobState.transition(state, { type: 'STAGE_STARTED', stageId: 'stage_a', stageType: 'WRITE' });
  state = JobState.transition(state, { type: 'STAGE_FAILED', error: { code: 'TIMEOUT', message: 'Retry' } });
  assert.equal(state.status, 'failed');
  assert.equal(state.failedStage.stageId, 'stage_a');

  state = JobState.transition(state, { type: 'JOB_RESUMED' });
  assert.equal(state.status, 'running');
  state = JobState.transition(state, { type: 'STAGE_STARTED', stageId: 'stage_a', stageType: 'WRITE', attempt: 2 });
  state = JobState.transition(state, { type: 'STAGE_COMPLETED', outputRef: 'revision_1' });
  assert.throws(() => JobState.transition(state, { type: 'STAGE_STARTED', stageId: 'stage_a', stageType: 'WRITE' }), /already completed/i);
});

test('cancelled and completed jobs are terminal', () => {
  let cancelled = initial();
  cancelled = JobState.transition(cancelled, { type: 'JOB_CANCELLED', reason: 'user' });
  assert.equal(cancelled.status, 'cancelled');
  assert.throws(() => JobState.transition(cancelled, { type: 'JOB_STARTED' }), /terminal/i);

  let completed = initial();
  completed = JobState.transition(completed, { type: 'JOB_STARTED' });
  completed = JobState.transition(completed, { type: 'JOB_COMPLETED', outputRef: 'content_1' });
  assert.equal(completed.status, 'completed');
  assert.throws(() => JobState.transition(completed, { type: 'JOB_RESUMED' }), /terminal/i);
});

test('illegal provider completion and stage completion without an active stage are rejected', () => {
  let state = initial();
  state = JobState.transition(state, { type: 'JOB_STARTED' });
  assert.throws(() => JobState.transition(state, { type: 'PROVIDER_ATTEMPT_COMPLETED', attemptId: 'missing', status: 'completed' }), /provider attempt/i);
  assert.throws(() => JobState.transition(state, { type: 'STAGE_COMPLETED' }), /active stage/i);
});

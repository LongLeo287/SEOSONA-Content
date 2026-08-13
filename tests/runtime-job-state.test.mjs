import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JobState } from '../runtime/domain/job-state.mjs';

const AT = '2026-08-12T00:00:00.000Z';

const base = () => JobState.create({
  jobId: 'job_1',
  projectId: 'project_1',
  workflowVersion: 'write@1',
  contentJob: 'article',
  contextSnapshotId: 'contextsnapshot_1',
  at: AT,
});

const apply = (state, events) => events.reduce((s, e) => JobState.transition(s, e), state);

const startedStage = () => apply(base(), [
  { type: 'JOB_STARTED', at: AT },
  { type: 'STAGE_STARTED', stageId: 'jobstage_1', stageType: 'WRITE', at: AT },
]);

test('create requires the identifying fields and pins the job to a context snapshot', () => {
  const s = base();
  assert.equal(s.status, 'queued');
  assert.equal(s.contextSnapshotId, 'contextsnapshot_1');
  assert.deepEqual(s.history.map((h) => h.event), ['CREATED']);
  assert.throws(() => JobState.create({ jobId: 'job_1' }), /required/i);
  assert.throws(
    () => JobState.create({ jobId: 'job_1', projectId: 'project_1', workflowVersion: 'w', contentJob: 'article' }),
    /contextSnapshotId/,
  );
});

test('reducer is pure: the input state is never mutated', () => {
  const before = base();
  const snapshot = JSON.stringify(before);
  JobState.transition(before, { type: 'JOB_STARTED', at: AT });
  assert.equal(JSON.stringify(before), snapshot);
});

test('history is append-only and records every accepted event', () => {
  const s = apply(base(), [
    { type: 'JOB_STARTED', at: AT },
    { type: 'STAGE_STARTED', stageId: 'jobstage_1', stageType: 'WRITE', at: AT },
    { type: 'STAGE_COMPLETED', stageId: 'jobstage_1', at: AT },
  ]);
  assert.deepEqual(s.history.map((h) => h.event), ['CREATED', 'JOB_STARTED', 'STAGE_STARTED', 'STAGE_COMPLETED']);
});

test('terminal jobs refuse any further transition', () => {
  for (const terminal of ['JOB_CANCELLED', 'JOB_COMPLETED']) {
    const s = apply(base(), [
      { type: 'JOB_STARTED', at: AT },
      { type: 'STAGE_STARTED', stageId: 'jobstage_1', stageType: 'WRITE', at: AT },
      { type: 'STAGE_COMPLETED', stageId: 'jobstage_1', at: AT },
      { type: terminal, at: AT },
    ]);
    assert.ok(['cancelled', 'completed'].includes(s.status));
    assert.throws(() => JobState.transition(s, { type: 'STAGE_STARTED', stageId: 'jobstage_2', stageType: 'AUDIT', at: AT }), /terminal/i);
  }
});

test('illegal rollback is refused', () => {
  const s = startedStage();
  // completing a stage twice
  const done = JobState.transition(s, { type: 'STAGE_COMPLETED', stageId: 'jobstage_1', at: AT });
  assert.throws(() => JobState.transition(done, { type: 'STAGE_COMPLETED', stageId: 'jobstage_1', at: AT }), /running/i);
  // starting a job that already runs
  assert.throws(() => JobState.transition(s, { type: 'JOB_STARTED', at: AT }), /queued/i);
  // checkpointing a stage that is not running
  assert.throws(() => JobState.transition(done, { type: 'STAGE_CHECKPOINTED', stageId: 'jobstage_1', checkpointRef: 'c', at: AT }), /running/i);
});

test('unknown events are rejected instead of silently ignored', () => {
  assert.throws(() => JobState.transition(base(), { type: 'VISUAL_STARTED', at: AT }), /unknown/i);
});

test('checkpoint refs are persisted on the stage so a restart can resume', () => {
  const s = apply(startedStage(), [
    { type: 'STAGE_CHECKPOINTED', stageId: 'jobstage_1', checkpointRef: 'seosona-local://workspace_1/blobs/abc', at: AT },
  ]);
  const stage = s.stages.find((x) => x.stageId === 'jobstage_1');
  assert.equal(stage.checkpointRef, 'seosona-local://workspace_1/blobs/abc');
});

test('a failed stage can be resumed and the error is cleared on restart', () => {
  const failed = apply(startedStage(), [
    { type: 'STAGE_FAILED', stageId: 'jobstage_1', error: { code: 'TIMEOUT', message: 'too slow' }, at: AT },
  ]);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.activeStage, null);
  assert.equal(failed.error.code, 'TIMEOUT');

  const resumed = JobState.transition(failed, { type: 'JOB_RESUMED', at: AT });
  assert.equal(resumed.status, 'running');
  assert.equal(resumed.error, undefined, 'stale error must not survive a resume');

  const restarted = JobState.transition(resumed, { type: 'STAGE_STARTED', stageId: 'jobstage_1', stageType: 'WRITE', attempt: 2, at: AT });
  assert.equal(restarted.activeStage.attempt, 2);
  assert.equal(restarted.stages.filter((x) => x.stageId === 'jobstage_1').length, 1, 'resuming must not duplicate the stage');
});

test('resume is only legal from a failed job', () => {
  assert.throws(() => JobState.transition(startedStage(), { type: 'JOB_RESUMED', at: AT }), /failed/i);
});

test('provider attempts are tracked per stage and cannot complete twice', () => {
  const s = apply(startedStage(), [
    { type: 'PROVIDER_ATTEMPT_STARTED', attemptId: 'providerattempt_1', stageId: 'jobstage_1', provider: 'browser-a', at: AT },
  ]);
  assert.equal(s.attempts.length, 1);
  assert.equal(s.attempts[0].status, 'running');

  const done = JobState.transition(s, {
    type: 'PROVIDER_ATTEMPT_COMPLETED', attemptId: 'providerattempt_1', status: 'succeeded', receiptId: 'providerreceipt_1', at: AT,
  });
  assert.equal(done.attempts[0].status, 'succeeded');
  assert.equal(done.attempts[0].receiptId, 'providerreceipt_1');
  assert.throws(
    () => JobState.transition(done, { type: 'PROVIDER_ATTEMPT_COMPLETED', attemptId: 'providerattempt_1', status: 'succeeded', at: AT }),
    /running/i,
  );
});

test('a provider attempt requires a running stage', () => {
  const queued = JobState.transition(base(), { type: 'JOB_STARTED', at: AT });
  assert.throws(
    () => JobState.transition(queued, { type: 'PROVIDER_ATTEMPT_STARTED', attemptId: 'providerattempt_1', stageId: 'jobstage_1', provider: 'browser-a', at: AT }),
    /stage/i,
  );
});

test('cancellation records a reason and closes any open stage and attempt', () => {
  const s = apply(startedStage(), [
    { type: 'PROVIDER_ATTEMPT_STARTED', attemptId: 'providerattempt_1', stageId: 'jobstage_1', provider: 'browser-a', at: AT },
    { type: 'JOB_CANCELLED', reason: 'user', at: AT },
  ]);
  assert.equal(s.status, 'cancelled');
  assert.equal(s.cancelReason, 'user');
  assert.equal(s.activeStage, null);
  assert.equal(s.stages.find((x) => x.stageId === 'jobstage_1').status, 'cancelled');
  assert.equal(s.attempts[0].status, 'cancelled');
  assert.equal(s.history.at(-1).event, 'JOB_CANCELLED', 'cancellation must not erase history');
});

test('a job cannot complete while a stage is still running', () => {
  assert.throws(() => JobState.transition(startedStage(), { type: 'JOB_COMPLETED', at: AT }), /running/i);
});

test('the module carries no Facebook or media concepts', async () => {
  const src = await readFile(new URL('../runtime/domain/job-state.mjs', import.meta.url), 'utf8');
  for (const banned of ['VISUAL_', 'ASSET_', 'draft', 'facebook', 'companion']) {
    assert.ok(!src.toLowerCase().includes(banned.toLowerCase()), `job-state.mjs must not mention "${banned}"`);
  }
});

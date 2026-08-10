const test = require('node:test');
const assert = require('node:assert/strict');

const State = require('../extension/lib/facebook-state.js');

function initial() {
  return State.create({ id: 'batch-1', requestedCount: 1, contextRevision: 'ctx-1', provider: 'gemini' });
}

test('reduces the happy path into a completed batch with append-only history', () => {
  let state = initial();
  state = State.transition(state, { type: 'IDEAS_STARTED', jobId: 'ideas-1' });
  assert.equal(state.status, 'ideas_running');
  state = State.transition(state, {
    type: 'IDEAS_CREATED',
    drafts: [{ id: 'post-01', topic: 'SEO audit', angle: 'Evidence first', status: 'idea_queued', clientRef: 'batch-1/post-01/r1' }],
  });
  state = State.transition(state, { type: 'COPY_STARTED', draftId: 'post-01', jobId: 'copy-1' });
  state = State.transition(state, { type: 'VISUAL_STARTED', draftId: 'post-01', package: { idea: 'SEO audit' } });
  state = State.transition(state, { type: 'ASSET_READY', draftId: 'post-01', receipt: { assetId: 'asset-1' } });
  state = State.transition(state, { type: 'BATCH_FINALIZED' });

  assert.equal(state.status, 'completed');
  assert.equal(state.drafts[0].status, 'asset_ready');
  assert.equal(state.history.length, 7);
  assert.deepEqual(state.history.map((item) => item.event), [
    'CREATED', 'IDEAS_STARTED', 'IDEAS_CREATED', 'COPY_STARTED', 'VISUAL_STARTED', 'ASSET_READY', 'BATCH_FINALIZED',
  ]);
});

test('blocks illegal rollback from a hard-terminal draft state', () => {
  let state = initial();
  state = State.transition(state, { type: 'IDEAS_STARTED', jobId: 'ideas-1' });
  state = State.transition(state, {
    type: 'IDEAS_CREATED',
    drafts: [{ id: 'post-01', topic: 'SEO audit', status: 'idea_queued', clientRef: 'batch-1/post-01/r1' }],
  });
  state = State.transition(state, { type: 'COPY_STARTED', draftId: 'post-01', jobId: 'copy-1' });
  state = State.transition(state, { type: 'COPY_BLOCKED', draftId: 'post-01', issues: [{ code: 'MISSING_EVIDENCE' }] });

  assert.throws(() => State.transition(state, { type: 'COPY_STARTED', draftId: 'post-01', jobId: 'copy-2' }), /terminal/i);
});

test('marks unfinished drafts cancelled and never resumes a cancelled batch', () => {
  let state = initial();
  state = State.transition(state, { type: 'IDEAS_STARTED', jobId: 'ideas-1' });
  state = State.transition(state, { type: 'BATCH_CANCELLED', reason: 'user' });
  assert.equal(state.status, 'cancelled');
  assert.throws(() => State.transition(state, { type: 'IDEAS_STARTED', jobId: 'ideas-2' }), /terminal/i);
});

test('records an idea-generation failure so the same batch can be resumed', () => {
  let state = initial();
  state = State.transition(state, { type: 'IDEAS_STARTED', jobId: 'ideas-1', prompt: 'ideas' });
  state = State.transition(state, { type: 'IDEAS_FAILED', error: { code: 'PROVIDER_ERROR', message: 'Try again.' } });
  assert.equal(state.status, 'failed');
  assert.equal(state.error.code, 'PROVIDER_ERROR');
  state = State.transition(state, { type: 'IDEAS_STARTED', jobId: 'ideas-1', prompt: 'ideas' });
  assert.equal(state.status, 'ideas_running');
  assert.equal(state.error, undefined);
});

test('halts on infrastructure errors and clears the halt reason when the failed draft is resumed', () => {
  let state = initial();
  state = State.transition(state, { type: 'IDEAS_STARTED', jobId: 'ideas-1' });
  state = State.transition(state, {
    type: 'IDEAS_CREATED',
    drafts: [{ id: 'post-01', topic: 'SEO audit', status: 'idea_queued', clientRef: 'batch-1/post-01/r1' }],
  });
  state = State.transition(state, { type: 'COPY_STARTED', draftId: 'post-01', jobId: 'copy-1' });
  state = State.transition(state, { type: 'VISUAL_STARTED', draftId: 'post-01', package: { idea: 'SEO audit' } });
  state = State.transition(state, {
    type: 'BATCH_HALTED', draftId: 'post-01', error: { code: 'DAILY_QUOTA_EXCEEDED', message: 'Quota reached.' },
  });
  assert.equal(state.status, 'failed');
  assert.equal(state.haltReason.code, 'DAILY_QUOTA_EXCEEDED');

  state = State.transition(state, { type: 'COPY_STARTED', draftId: 'post-01', jobId: 'copy-2' });
  assert.equal(state.status, 'drafts_running');
  assert.equal(state.haltReason, undefined);
  assert.equal(state.drafts[0].error, undefined);
});

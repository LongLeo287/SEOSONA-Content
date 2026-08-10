const test = require('node:test');
const assert = require('node:assert/strict');

global.FacebookFactory = require('../extension/lib/facebook-factory.js');
global.FacebookBatch = require('../extension/lib/facebook-batch.js');
global.FacebookState = require('../extension/lib/facebook-state.js');
const { createOrchestrator } = require('../extension/lib/facebook-orchestrator.js');

const CONTEXT = {
  brand: { id: 'seosona', name: 'SEOSONA', voice: ['practical', 'evidence-led'] },
  group: { id: 'seo-vn', audience: 'Vietnamese SEO practitioners' },
  policy: { cadencePerWeek: 5, batchSize: { default: 5, min: 1, max: 20 } },
  evidence: [],
};

function draftJson(overrides = {}) {
  return JSON.stringify({
    idea: 'Audit SEO', copy: 'Một góc nhìn thực hành về audit SEO.', cta: 'Bạn đang làm thế nào?', claims: [],
    creativeBrief: { visualPrompt: 'SEO analyst at a clean desk, no text.', ratio: '1:1', mode: 'lightEditorial', component: 'explain_light' },
    ...overrides,
  });
}

function harness(options = {}) {
  let saved = options.initial || null;
  const jobs = [];
  const calls = [];
  const packages = [];
  let visualPoll = 0;
  const companion = async (path, body) => {
    calls.push({ path, body });
    if (path === '/v1/health') return { ok: true, flow: { contractVersion: '1.1.0', provider: { ready: true } }, context: { revision: 'ctx-health' } };
    if (path === '/v1/context') return CONTEXT;
    if (path === '/v1/flow/jobs') {
      const status = Array.isArray(options.visualJobStates) ? options.visualJobStates[Math.min(visualPoll++, options.visualJobStates.length - 1)] : 'done';
      if (options.visualError) return { jobId: 'visual-test', status: 'error', error: options.visualError };
      if (status === 'running') return { jobId: 'visual-test', status: 'running' };
      return { jobId: 'visual-test', status: 'done', result: options.visual || { status: 'asset_ready', receipt: { assetId: 'asset-1', fileRef: 'content-library://batch/post/image.png' } } };
    }
    if (path === '/v1/library/package') {
      packages.push(body);
      if (options.packageError) throw Object.assign(new Error(options.packageError.message), options.packageError);
      if (options.packageDeferred) await options.packageDeferred.promise;
      return { draftRef: `content-library://${body.batch.id}/${body.draft.id}/draft.json`, runtimeDraftRef: 'machine-path' };
    }
    if (/^\/v1\/flow\/jobs\/[^/]+\/cancel$/.test(path)) return { ok: true };
    throw new Error('Unexpected Companion path: ' + path);
  };
  const orchestrator = createOrchestrator({
    load: async () => saved,
    persist: async (state) => { saved = JSON.parse(JSON.stringify(state)); },
    providerStart: async (job) => { jobs.push(job); return { ok: true }; },
    providerStatus: options.providerStatus || (async (jobId) => jobs.some((job) => job.jobId === jobId) ? { status: 'running' } : null),
    providerAbort: async () => ({ ok: true }),
    companion,
    now: () => '2026-08-10T00:00:00.000Z',
  });
  return { orchestrator, jobs, calls, packages, current: () => saved };
}

test('runs start through ideas, copy, QA, visual, package, and completion', async () => {
  const h = harness();
  let state = await h.orchestrator.start({ requestedCount: 1, provider: 'gemini' });
  assert.equal(state.status, 'ideas_running');
  assert.match(h.jobs[0].text, /exactly 1/i);

  state = await h.orchestrator.handleProviderResult({ jobId: h.jobs[0].jobId, success: true, text: JSON.stringify({ ideas: [{ title: 'Audit SEO', angle: 'Evidence first' }] }) });
  assert.equal(state.drafts[0].status, 'copy_running');
  state = await h.orchestrator.handleProviderResult({ jobId: h.jobs[1].jobId, success: true, text: draftJson() });

  assert.equal(state.status, 'completed');
  assert.equal(state.drafts[0].status, 'asset_ready');
  assert.deepEqual(state.drafts[0].packageReceipt, { draftRef: `content-library://${state.id}/post-01/draft.json` });
  assert.equal(h.packages.length, 1);
  assert.equal(h.packages[0].draft.assetReceipt.assetId, 'asset-1');
  assert.equal(h.packages[0].batch.status, 'completed');
  assert.equal(h.packages[0].batch.drafts[0].status, 'asset_ready');
  assert.equal(h.current().status, 'completed');
});

test('blocks unsupported claims without calling Flow', async () => {
  const h = harness();
  await h.orchestrator.start({ requestedCount: 1, provider: 'gemini' });
  await h.orchestrator.handleProviderResult({ jobId: h.jobs[0].jobId, success: true, text: JSON.stringify({ ideas: [{ title: 'Claim', angle: 'Check it' }] }) });
  const state = await h.orchestrator.handleProviderResult({
    jobId: h.jobs[1].jobId, success: true,
    text: draftJson({ claims: [{ text: 'Guaranteed ranking', evidenceId: null }] }),
  });
  assert.equal(state.status, 'needs_review');
  assert.equal(state.drafts[0].status, 'copy_blocked');
  assert.equal(h.calls.some((call) => call.path === '/v1/flow/jobs'), false);
});

test('keeps an unjudged visual out of ready state', async () => {
  const h = harness({ visual: { status: 'asset_needs_review', receipt: { assetId: 'asset-unjudged', quality: { judged: false } } } });
  await h.orchestrator.start({ requestedCount: 1, provider: 'gemini' });
  await h.orchestrator.handleProviderResult({ jobId: h.jobs[0].jobId, success: true, text: JSON.stringify({ ideas: [{ title: 'Visual', angle: 'Review' }] }) });
  const state = await h.orchestrator.handleProviderResult({ jobId: h.jobs[1].jobId, success: true, text: draftJson() });
  assert.equal(state.status, 'needs_review');
  assert.equal(state.drafts[0].status, 'asset_needs_review');
});

test('cancels an active batch and ignores later provider completion', async () => {
  const h = harness();
  await h.orchestrator.start({ requestedCount: 1, provider: 'gemini' });
  const state = await h.orchestrator.cancel('user');
  assert.equal(state.status, 'cancelled');
  await assert.rejects(() => h.orchestrator.handleProviderResult({ jobId: h.jobs[0].jobId, success: true, text: '{}' }), /active batch/i);
});

test('deduplicates concurrent resume requests for the same provider job', async () => {
  const h = harness();
  await h.orchestrator.start({ requestedCount: 1, provider: 'gemini' });
  await Promise.all([h.orchestrator.resume(), h.orchestrator.resume()]);
  assert.equal(h.jobs.length, 1);
});

test('halts the batch on quota errors without spending later draft work', async () => {
  const h = harness({ visualError: { code: 'DAILY_QUOTA_EXCEEDED', message: 'Quota exhausted.', retryable: false } });
  await h.orchestrator.start({ requestedCount: 2, provider: 'gemini' });
  await h.orchestrator.handleProviderResult({ jobId: h.jobs[0].jobId, success: true, text: JSON.stringify({ ideas: [
    { title: 'First', angle: 'One' }, { title: 'Second', angle: 'Two' },
  ] }) });
  const state = await h.orchestrator.handleProviderResult({ jobId: h.jobs[1].jobId, success: true, text: draftJson() });
  assert.equal(state.status, 'failed');
  assert.equal(state.haltReason.code, 'DAILY_QUOTA_EXCEEDED');
  assert.deepEqual(state.drafts.map((draft) => draft.status), ['failed', 'idea_queued']);
  assert.equal(h.jobs.length, 2);
});

test('halts the batch when the Content Library cannot persist a package', async () => {
  const h = harness({ packageError: { code: 'CONTENT_LIBRARY_FAILED', message: 'Disk unavailable.' } });
  await h.orchestrator.start({ requestedCount: 2, provider: 'gemini' });
  await h.orchestrator.handleProviderResult({ jobId: h.jobs[0].jobId, success: true, text: JSON.stringify({ ideas: [
    { title: 'First', angle: 'One' }, { title: 'Second', angle: 'Two' },
  ] }) });
  const state = await h.orchestrator.handleProviderResult({ jobId: h.jobs[1].jobId, success: true, text: draftJson() });
  assert.equal(state.status, 'failed');
  assert.equal(state.haltReason.code, 'CONTENT_LIBRARY_FAILED');
  assert.deepEqual(state.drafts.map((draft) => draft.status), ['failed', 'idea_queued']);
  assert.equal(h.jobs.length, 2);
});

test('continues after one draft fails and preserves the successful draft', async () => {
  const h = harness();
  await h.orchestrator.start({ requestedCount: 2, provider: 'gemini' });
  await h.orchestrator.handleProviderResult({ jobId: h.jobs[0].jobId, success: true, text: JSON.stringify({ ideas: [
    { title: 'First', angle: 'One' }, { title: 'Second', angle: 'Two' },
  ] }) });
  let state = await h.orchestrator.handleProviderResult({ jobId: h.jobs[1].jobId, success: false, error: { code: 'PROVIDER_ERROR', message: 'Bad response' } });
  assert.equal(state.drafts[0].status, 'failed');
  assert.equal(state.drafts[1].status, 'copy_running');
  state = await h.orchestrator.handleProviderResult({ jobId: h.jobs[2].jobId, success: true, text: draftJson({ idea: 'Second' }) });
  assert.equal(state.status, 'needs_review');
  assert.deepEqual(state.drafts.map((draft) => draft.status), ['failed', 'asset_ready']);
});

test('resumes a persisted visual with the same client reference', async () => {
  const snapshot = global.FacebookFactory.createContextSnapshot(CONTEXT);
  let state = global.FacebookState.create({ id: 'batch-resume', requestedCount: 1, contextRevision: snapshot.contextRevision, provider: 'gemini' });
  state.contextSnapshot = snapshot;
  state = global.FacebookState.transition(state, { type: 'IDEAS_STARTED', jobId: 'facebook_batch-resume_ideas', prompt: 'ideas' });
  state = global.FacebookState.transition(state, { type: 'IDEAS_CREATED', drafts: global.FacebookFactory.createWeeklyBatch({ id: 'batch-resume', snapshot, ideas: [{ title: 'Resume', angle: 'Safe' }] }).drafts });
  state = global.FacebookState.transition(state, { type: 'COPY_STARTED', draftId: 'post-01', jobId: 'facebook_batch-resume_post-01', prompt: 'copy' });
  state = global.FacebookState.transition(state, { type: 'VISUAL_STARTED', draftId: 'post-01', package: { parsed: JSON.parse(draftJson()), visualJob: { clientRef: 'batch-resume/post-01/r1', prompt: 'SEO image', ratio: '1:1' } } });
  const h = harness({ initial: state });
  const resumed = await h.orchestrator.resume();
  assert.equal(resumed.status, 'completed');
  assert.equal(h.calls.find((call) => call.path === '/v1/flow/jobs').body.visualJob.clientRef, 'batch-resume/post-01/r1');
});

test('cancels a Companion-owned visual job and leaves the batch terminal', async () => {
  const snapshot = global.FacebookFactory.createContextSnapshot(CONTEXT);
  let state = global.FacebookState.create({ id: 'batch-cancel-visual', requestedCount: 1, contextRevision: snapshot.contextRevision, provider: 'gemini' });
  state.contextSnapshot = snapshot;
  state = global.FacebookState.transition(state, { type: 'IDEAS_STARTED', jobId: 'ideas' });
  state = global.FacebookState.transition(state, { type: 'IDEAS_CREATED', drafts: global.FacebookFactory.createWeeklyBatch({ id: state.id, snapshot, ideas: [{ title: 'Cancel', angle: 'Safe' }] }).drafts });
  state = global.FacebookState.transition(state, { type: 'COPY_STARTED', draftId: 'post-01', jobId: 'copy' });
  state = global.FacebookState.transition(state, { type: 'VISUAL_STARTED', draftId: 'post-01', package: { parsed: JSON.parse(draftJson()), visualJob: { clientRef: `${state.id}/post-01/r1`, prompt: 'SEO image', ratio: '1:1' } } });
  state = global.FacebookState.transition(state, { type: 'VISUAL_SUBMITTED', draftId: 'post-01', jobId: 'visual-cancel-test' });
  const h = harness({ initial: state });
  const cancelled = await h.orchestrator.cancel('user');
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.drafts[0].status, 'cancelled');
  assert.equal(h.calls.some((call) => /\/v1\/flow\/jobs\/[^/]+\/cancel$/.test(call.path)), true);
});

test('submits a short Companion visual job and completes it after a later resume poll', async () => {
  const h = harness({ visualJobStates: ['running', 'done'] });
  await h.orchestrator.start({ requestedCount: 1, provider: 'gemini' });
  await h.orchestrator.handleProviderResult({ jobId: h.jobs[0].jobId, success: true, text: JSON.stringify({ ideas: [{ title: 'MV3', angle: 'Wake safely' }] }) });
  let state = await h.orchestrator.handleProviderResult({ jobId: h.jobs[1].jobId, success: true, text: draftJson() });
  assert.equal(state.status, 'visuals_running');
  assert.equal(state.drafts[0].companionJobId, 'visual-test');
  assert.equal(h.packages.length, 0);

  state = await h.orchestrator.resume();
  assert.equal(state.status, 'completed');
  assert.equal(h.packages.length, 1);
  assert.equal(h.calls.some((call) => call.path === '/v1/flow/generate'), false);
});

test('does not let a late package completion overwrite a durable cancellation', async () => {
  let release;
  const packageDeferred = { promise: new Promise((resolve) => { release = resolve; }) };
  const h = harness({ packageDeferred });
  await h.orchestrator.start({ requestedCount: 1, provider: 'gemini' });
  await h.orchestrator.handleProviderResult({ jobId: h.jobs[0].jobId, success: true, text: JSON.stringify({ ideas: [{ title: 'Cancel race', angle: 'Safe' }] }) });
  const finishing = h.orchestrator.handleProviderResult({ jobId: h.jobs[1].jobId, success: true, text: draftJson() });
  while (!h.calls.some((call) => call.path === '/v1/library/package')) await new Promise((resolve) => setImmediate(resolve));
  const cancelled = await h.orchestrator.cancel('user');
  assert.equal(cancelled.status, 'cancelled');
  release();
  const final = await finishing;
  assert.equal(final.status, 'cancelled');
  assert.equal(h.current().status, 'cancelled');
});

test('redispatches a provider job whose persisted lease is stale', async () => {
  let saved;
  const first = harness();
  await first.orchestrator.start({ requestedCount: 1, provider: 'gemini' });
  saved = first.current();
  const resumed = harness({ initial: saved, providerStatus: async () => ({ status: 'stale' }) });
  await resumed.orchestrator.resume();
  assert.equal(resumed.jobs.length, 1);
  assert.equal(resumed.jobs[0].jobId, saved.active.jobId);
});

for (const requestedCount of [1, 5, 20]) {
  test(`completes a simulated end-to-end batch of ${requestedCount} drafts`, async () => {
    const h = harness();
    await h.orchestrator.start({ requestedCount, provider: 'gemini' });
    const ideas = Array.from({ length: requestedCount }, (_, index) => ({ title: `Idea ${index + 1}`, angle: `Angle ${index + 1}` }));
    let state = await h.orchestrator.handleProviderResult({ jobId: h.jobs[0].jobId, success: true, text: JSON.stringify({ ideas }) });
    for (let index = 0; index < requestedCount; index += 1) {
      state = await h.orchestrator.handleProviderResult({ jobId: h.jobs[index + 1].jobId, success: true, text: draftJson({ idea: `Idea ${index + 1}` }) });
    }
    assert.equal(state.status, 'completed');
    assert.equal(state.drafts.length, requestedCount);
    assert.equal(h.packages.length, requestedCount);
    assert.equal(state.drafts.every((draft) => draft.status === 'asset_ready'), true);
  });
}

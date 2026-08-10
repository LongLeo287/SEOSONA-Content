/* SEOSONA Facebook Batch State — pure, browser-safe transition reducer. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FacebookState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TERMINAL_BATCH = new Set(['completed', 'cancelled']);
  const TERMINAL_DRAFT = new Set(['asset_ready', 'asset_needs_review', 'copy_blocked', 'cancelled']);

  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function assert(condition, message) { if (!condition) throw new Error(message); }
  function history(event, at) {
    const item = { event, at: at || new Date().toISOString() };
    return item;
  }
  function withHistory(state, event, at) {
    state.history.push(history(event, at));
    return state;
  }
  function draftFor(state, draftId) {
    const draft = state.drafts.find((item) => item.id === draftId);
    assert(draft, 'Unknown draft: ' + draftId + '.');
    return draft;
  }
  function assertDraftOpen(draft) {
    assert(!TERMINAL_DRAFT.has(draft.status), 'Draft is already in a terminal state.');
  }

  function create({ id, requestedCount, contextRevision, provider, at }) {
    assert(id && contextRevision, 'Batch id and context revision are required.');
    assert(Number.isInteger(requestedCount) && requestedCount > 0, 'Requested count must be a positive integer.');
    return {
      contractVersion: '2.0', id, requestedCount, contextRevision, provider: provider || 'gemini',
      status: 'queued', drafts: [], active: null, history: [history('CREATED', at)],
    };
  }

  function transition(current, event) {
    assert(current && event && event.type, 'State and event type are required.');
    assert(!TERMINAL_BATCH.has(current.status), 'Batch is already in a terminal state.');
    const state = copy(current);
    const type = event.type;

    if (type === 'IDEAS_STARTED') {
      assert(['queued', 'failed'].includes(state.status), 'Ideas can start only from queued or failed.');
      state.status = 'ideas_running'; state.active = { kind: 'ideas', jobId: event.jobId, prompt: event.prompt || '' };
    } else if (type === 'IDEAS_FAILED') {
      assert(state.status === 'ideas_running', 'Ideas can fail only while ideas are running.');
      state.status = 'failed'; state.active = null; state.error = copy(event.error || { code: 'IDEAS_FAILED', message: 'Idea generation failed.' });
    } else if (type === 'IDEAS_CREATED') {
      assert(state.status === 'ideas_running', 'Ideas can be accepted only while ideas are running.');
      assert(Array.isArray(event.drafts) && event.drafts.length === state.requestedCount, 'Ideas must create exactly the requested number of drafts.');
      state.drafts = copy(event.drafts); state.status = 'drafts_running'; state.active = null;
    } else if (type === 'COPY_STARTED') {
      const draft = draftFor(state, event.draftId); assertDraftOpen(draft);
      assert(['idea_queued', 'failed'].includes(draft.status), 'Copy can start only for a queued or failed draft.');
      draft.status = 'copy_running'; draft.jobId = event.jobId; state.status = 'drafts_running';
      state.active = { kind: 'copy', draftId: draft.id, jobId: event.jobId, prompt: event.prompt || '' };
    } else if (type === 'COPY_BLOCKED') {
      const draft = draftFor(state, event.draftId); assert(draft.status === 'copy_running', 'Only running copy can be blocked.');
      draft.status = 'copy_blocked'; draft.issues = copy(event.issues || []); state.active = null; state.status = 'drafts_running';
    } else if (type === 'VISUAL_STARTED') {
      const draft = draftFor(state, event.draftId); assert(draft.status === 'copy_running', 'Visual can start only after copy is running.');
      draft.status = 'visual_running'; draft.package = copy(event.package); state.active = { kind: 'visual', draftId: draft.id };
      state.status = 'visuals_running';
    } else if (type === 'ASSET_READY' || type === 'ASSET_REVIEW') {
      const draft = draftFor(state, event.draftId); assert(draft.status === 'visual_running', 'Only a running visual can finish.');
      draft.status = type === 'ASSET_READY' ? 'asset_ready' : 'asset_needs_review';
      draft.receipt = copy(event.receipt || null); draft.packageReceipt = copy(event.packageReceipt || null); state.active = null; state.status = 'drafts_running';
    } else if (type === 'DRAFT_FAILED') {
      const draft = draftFor(state, event.draftId); assertDraftOpen(draft);
      draft.status = 'failed'; draft.error = copy(event.error || { code: 'UNKNOWN', message: 'Draft failed.' });
      state.active = null; state.status = 'drafts_running';
    } else if (type === 'BATCH_FINALIZED') {
      assert(state.drafts.length === state.requestedCount, 'Cannot finalize an incomplete batch.');
      assert(state.drafts.every((draft) => TERMINAL_DRAFT.has(draft.status) || draft.status === 'failed'), 'Cannot finalize while a draft is still running.');
      state.status = state.drafts.every((draft) => draft.status === 'asset_ready') ? 'completed' : 'needs_review';
      state.active = null;
    } else if (type === 'BATCH_CANCELLED') {
      state.status = 'cancelled'; state.active = null; state.cancelReason = String(event.reason || 'user');
      state.drafts.forEach((draft) => { if (!TERMINAL_DRAFT.has(draft.status)) draft.status = 'cancelled'; });
    } else {
      throw new Error('Unknown Facebook batch event: ' + type + '.');
    }
    return withHistory(state, type, event.at);
  }

  return { create, transition };
});

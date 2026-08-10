/* SEOSONA Facebook Orchestrator - resumable, event-driven batch coordination. */
(function (root, factory) {
  const api = factory(root.FacebookFactory, root.FacebookBatch, root.FacebookState);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FacebookOrchestrator = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Factory, Batch, State) {
  'use strict';

  if (!Factory || !Batch || !State) throw new Error('Facebook Factory, Batch, and State must load before the orchestrator.');
  const BATCH_HALTING_ERRORS = new Set([
    'DAILY_QUOTA_EXCEEDED', 'PROVIDER_NOT_LOGGED_IN', 'PROVIDER_TAB_NOT_READY', 'PROJECT_NOT_FOUND', 'WRONG_PROJECT',
    'INCOMPATIBLE_FLOW_CONTRACT', 'FLOW_EXTENSION_DISCONNECTED', 'FLOW_UNAVAILABLE', 'VALIDATION_ERROR',
    'CAPABILITIES_UNAVAILABLE', 'PROVIDER_STATUS_UNAVAILABLE', 'LIBRARY_UNAVAILABLE', 'CONTENT_LIBRARY_FAILED',
    'ASSET_ARCHIVE_FAILED', 'COMPANION_UNAVAILABLE',
  ]);

  function normalizeError(error, fallbackCode) {
    if (error && error.code && error.message) return { code: String(error.code), message: String(error.message) };
    if (error instanceof Error) return { code: fallbackCode || 'ORCHESTRATION_FAILED', message: error.message };
    return { code: fallbackCode || 'ORCHESTRATION_FAILED', message: String(error || 'Facebook orchestration failed.') };
  }

  function safeJobPart(value) { return String(value).replace(/[^a-zA-Z0-9_-]/g, '_'); }
  function portablePackageReceipt(receipt) {
    const output = {};
    ['batchRef', 'contextRef', 'draftRef'].forEach((key) => {
      if (typeof (receipt && receipt[key]) === 'string' && receipt[key].startsWith('content-library://')) output[key] = receipt[key];
    });
    if (!output.draftRef) throw new Error('Content Library did not return a portable draft reference.');
    return output;
  }

  function createOrchestrator(deps) {
    if (!deps || typeof deps.load !== 'function' || typeof deps.persist !== 'function') throw new Error('Orchestrator requires load and persist functions.');
    if (typeof deps.providerStart !== 'function' || typeof deps.companion !== 'function') throw new Error('Orchestrator requires provider and Companion adapters.');
    const clock = typeof deps.now === 'function' ? deps.now : () => new Date().toISOString();
    const emit = typeof deps.emit === 'function' ? deps.emit : () => {};
    let current = null;
    let serial = Promise.resolve();
    const dispatchedJobs = new Set();

    function enqueue(operation) {
      const run = serial.then(operation, operation);
      serial = run.catch(() => {});
      return run;
    }

    async function load() {
      if (!current) current = await deps.load() || null;
      return current;
    }

    async function commit(next) {
      current = next;
      await deps.persist(current);
      await emit(current);
      return current;
    }

    function transition(event) { return State.transition(current, { ...event, at: clock() }); }
    function jobId(kind, draftId) {
      return 'facebook_' + safeJobPart(current.id) + '_' + (kind === 'ideas' ? 'ideas' : safeJobPart(draftId));
    }

    async function providerState(id) {
      return typeof deps.providerStatus === 'function' ? deps.providerStatus(id) : null;
    }

    async function shouldDispatch(id) {
      if (dispatchedJobs.has(id)) return false;
      const saved = await providerState(id);
      return !(saved && ['preparing', 'running'].includes(saved.status));
    }

    async function dispatchIdeas(prompt, existingJobId) {
      const id = existingJobId || jobId('ideas');
      if (current.status !== 'ideas_running') await commit(transition({ type: 'IDEAS_STARTED', jobId: id, prompt }));
      if (!await shouldDispatch(id)) return current;
      try {
        const result = await deps.providerStart({ jobId: id, provider: current.provider, text: prompt, timeout: 300000, freshChat: true });
        if (!result || result.ok !== true) throw new Error(result && result.error || 'Provider rejected the idea job.');
        dispatchedJobs.add(id);
      } catch (error) {
        dispatchedJobs.delete(id);
        await commit(transition({ type: 'IDEAS_FAILED', error: normalizeError(error, 'IDEA_PROVIDER_FAILED') }));
      }
      return current;
    }

    async function dispatchCopy(draft, prompt, existingJobId) {
      const id = existingJobId || jobId('copy', draft.id);
      if (draft.status !== 'copy_running') await commit(transition({ type: 'COPY_STARTED', draftId: draft.id, jobId: id, prompt }));
      if (!await shouldDispatch(id)) return current;
      try {
        const result = await deps.providerStart({ jobId: id, provider: current.provider, text: prompt, timeout: 300000, freshChat: true });
        if (!result || result.ok !== true) throw new Error(result && result.error || 'Provider rejected the copy job.');
        dispatchedJobs.add(id);
      } catch (error) {
        dispatchedJobs.delete(id);
        await commit(transition({ type: 'DRAFT_FAILED', draftId: draft.id, error: normalizeError(error, 'COPY_PROVIDER_FAILED') }));
        return startNextDraft(false);
      }
      return current;
    }

    async function finalizeIfDone() {
      const open = current.drafts.some((draft) => ['idea_queued', 'copy_running', 'visual_running'].includes(draft.status));
      if (!open && current.drafts.length === current.requestedCount) await commit(transition({ type: 'BATCH_FINALIZED' }));
      return current;
    }

    async function startNextDraft(includeFailed) {
      const draft = current.drafts.find((item) => item.status === 'idea_queued' || (includeFailed && item.status === 'failed'));
      if (!draft) return finalizeIfDone();
      const prompt = Batch.buildDraftPrompt({ topic: draft.topic + (draft.angle ? ' - ' + draft.angle : ''), snapshot: current.contextSnapshot });
      return dispatchCopy(draft, prompt);
    }

    async function finalizeVisual(draft, visual) {
      try {
        if (current.status === 'cancelled') return current;
        if (!visual || !['asset_ready', 'asset_needs_review'].includes(visual.status)) throw new Error('Companion returned an unknown visual status.');
        let next = State.transition(current, {
          type: visual.status === 'asset_ready' ? 'ASSET_READY' : 'ASSET_REVIEW',
          draftId: draft.id,
          receipt: visual.receipt || null,
          at: clock(),
        });
        const hasOpenDraft = next.drafts.some((item) => ['idea_queued', 'copy_running', 'visual_running'].includes(item.status));
        if (!hasOpenDraft && next.drafts.length === next.requestedCount) {
          next = State.transition(next, { type: 'BATCH_FINALIZED', at: clock() });
        }
        const durableDraft = {
          id: draft.id,
          topic: draft.topic,
          angle: draft.angle || '',
          ...draft.package.parsed,
          status: visual.status,
          assetReceipt: visual.receipt || null,
        };
        const packageReceipt = portablePackageReceipt(await deps.companion('/v1/library/package', {
          batch: Object.keys(next).reduce((value, key) => {
            if (key !== 'contextSnapshot') value[key] = next[key];
            return value;
          }, {}),
          snapshot: current.contextSnapshot,
          draft: durableDraft,
        }));
        if (current.status === 'cancelled') return current;
        const completedDraft = next.drafts.find((item) => item.id === draft.id);
        completedDraft.packageReceipt = packageReceipt;
        await commit(next);
      } catch (error) {
        if (current.status === 'cancelled') return current;
        const normalized = normalizeError(error, 'VISUAL_OR_PACKAGE_FAILED');
        if (BATCH_HALTING_ERRORS.has(normalized.code)) {
          return commit(transition({ type: 'BATCH_HALTED', draftId: draft.id, error: normalized }));
        }
        await commit(transition({ type: 'DRAFT_FAILED', draftId: draft.id, error: normalized }));
      }
      if (['completed', 'needs_review', 'failed'].includes(current.status)) return current;
      return startNextDraft(false);
    }

    async function processVisual(draft) {
      try {
        const response = await deps.companion('/v1/flow/jobs', {
          batchId: current.id,
          draftId: draft.id,
          visualJob: draft.package.visualJob,
          restart: !draft.companionJobId,
        });
        if (current.status === 'cancelled') return current;
        if (!response || !response.jobId || !['running', 'done', 'error', 'cancelled'].includes(response.status)) {
          throw Object.assign(new Error('Companion returned an invalid asynchronous visual job.'), { code: 'COMPANION_JOB_INVALID' });
        }
        if (!draft.companionJobId) {
          await commit(transition({ type: 'VISUAL_SUBMITTED', draftId: draft.id, jobId: response.jobId }));
          if (current.status === 'cancelled') return current;
          draft = current.drafts.find((item) => item.id === draft.id);
        }
        if (response.status === 'running') return current;
        if (response.status === 'done') return finalizeVisual(draft, response.result);
        const remote = response.error || { code: response.status === 'cancelled' ? 'VISUAL_JOB_CANCELLED' : 'VISUAL_JOB_FAILED', message: 'Companion visual job did not complete.' };
        const error = new Error(remote.message); Object.assign(error, remote); throw error;
      } catch (error) {
        if (current.status === 'cancelled') return current;
        const normalized = normalizeError(error, 'VISUAL_JOB_FAILED');
        if (BATCH_HALTING_ERRORS.has(normalized.code)) return commit(transition({ type: 'BATCH_HALTED', draftId: draft.id, error: normalized }));
        await commit(transition({ type: 'DRAFT_FAILED', draftId: draft.id, error: normalized }));
        return startNextDraft(false);
      }
    }

    async function start({ requestedCount, provider }) {
      await load();
      if (current && ['queued', 'ideas_running', 'drafts_running', 'visuals_running'].includes(current.status)) {
        throw new Error('An unfinished Facebook batch already exists. Resume or cancel it before starting another batch.');
      }
      const health = await deps.companion('/v1/health');
      if (!health || health.ok !== true || !health.flow || !health.flow.provider || health.flow.provider.ready !== true) throw new Error('Flow and Companion are not ready.');
      const context = await deps.companion('/v1/context');
      const snapshot = Factory.createContextSnapshot(context);
      const count = Factory.resolveBatchSize(snapshot.policy, requestedCount);
      const stamp = clock();
      const id = 'facebook-' + stamp.slice(0, 10) + '-' + stamp.replace(/[^0-9]/g, '');
      current = State.create({ id, requestedCount: count, contextRevision: snapshot.contextRevision, provider, at: stamp });
      current.contextSnapshot = snapshot;
      current.flowContractVersion = health.flow.contractVersion;
      await commit(current);
      return dispatchIdeas(Batch.buildIdeaPrompt({ count, snapshot }));
    }

    async function handleProviderResult({ jobId: completedJobId, success, text, error }) {
      await load();
      if (!current || ['cancelled', 'completed'].includes(current.status) || !current.active) throw new Error('No active batch is waiting for this provider result.');
      if (current.active.jobId !== completedJobId) throw new Error('Provider result does not match the active Facebook job.');
      dispatchedJobs.delete(completedJobId);
      if (current.active.kind === 'ideas') {
        if (!success) return commit(transition({ type: 'IDEAS_FAILED', error: normalizeError(error, 'IDEA_PROVIDER_FAILED') }));
        try {
          const ideas = Batch.parseIdeaResponse(text, current.requestedCount);
          const drafts = Factory.createWeeklyBatch({ id: current.id, snapshot: current.contextSnapshot, ideas }).drafts;
          await commit(transition({ type: 'IDEAS_CREATED', drafts }));
          return startNextDraft(false);
        } catch (caught) {
          return commit(transition({ type: 'IDEAS_FAILED', error: normalizeError(caught, 'IDEA_PARSE_FAILED') }));
        }
      }

      const draftId = current.active.draftId;
      if (!success) {
        await commit(transition({ type: 'DRAFT_FAILED', draftId, error: normalizeError(error, 'COPY_PROVIDER_FAILED') }));
        return startNextDraft(false);
      }
      try {
        const parsed = Batch.parseDraftResponse(text);
        const gate = Factory.validateDraftPackage({ ...parsed, id: draftId }, current.contextSnapshot.evidence, {
          clientRef: current.drafts.find((draft) => draft.id === draftId).clientRef,
          brandKitSnapshot: current.contextSnapshot.brandKitSnapshot,
          expectedLanguage: current.contextSnapshot.policy.copyLanguage || current.contextSnapshot.group.language || null,
          contextRevision: current.contextRevision,
          brandProfile: current.contextSnapshot.brand,
          requiredEvidence: current.contextSnapshot.policy.requiredEvidence === true,
        });
        if (!gate.ok) {
          await commit(transition({ type: 'COPY_BLOCKED', draftId, issues: gate.issues }));
          return startNextDraft(false);
        }
        await commit(transition({ type: 'VISUAL_STARTED', draftId, package: { parsed: { ...parsed, copyQa: gate.copyQa }, visualJob: gate.visualJob } }));
        return processVisual(current.drafts.find((draft) => draft.id === draftId));
      } catch (caught) {
        await commit(transition({ type: 'DRAFT_FAILED', draftId, error: normalizeError(caught, 'COPY_PARSE_FAILED') }));
        return startNextDraft(false);
      }
    }

    async function resume() {
      await load();
      if (!current) throw new Error('No Facebook batch is available to resume.');
      if (current.status === 'cancelled') throw new Error('A cancelled batch cannot be resumed.');
      if (current.status === 'completed') return current;
      if (current.status === 'queued' || (current.status === 'failed' && !current.drafts.length)) {
        const prompt = Batch.buildIdeaPrompt({ count: current.requestedCount, snapshot: current.contextSnapshot });
        return dispatchIdeas(prompt);
      }
      if (current.active && current.active.kind === 'ideas') {
        const saved = await providerState(current.active.jobId);
        if (saved && ['done', 'error'].includes(saved.status) && saved.result) {
          return handleProviderResult({ jobId: current.active.jobId, success: saved.status === 'done', text: saved.result.text || '', error: saved.result });
        }
        if (saved && ['preparing', 'running'].includes(saved.status)) return current;
        return dispatchIdeas(current.active.prompt, current.active.jobId);
      }
      if (current.active && current.active.kind === 'copy') {
        const draft = current.drafts.find((item) => item.id === current.active.draftId);
        const saved = await providerState(current.active.jobId);
        if (saved && ['done', 'error'].includes(saved.status) && saved.result) {
          return handleProviderResult({ jobId: current.active.jobId, success: saved.status === 'done', text: saved.result.text || '', error: saved.result });
        }
        if (saved && ['preparing', 'running'].includes(saved.status)) return current;
        return dispatchCopy(draft, current.active.prompt, current.active.jobId);
      }
      if (current.active && current.active.kind === 'visual') {
        const draft = current.drafts.find((item) => item.id === current.active.draftId);
        return processVisual(draft);
      }
      return startNextDraft(true);
    }

    async function cancel(reason) {
      await load();
      if (!current) throw new Error('No Facebook batch is available to cancel.');
      if (current.status === 'cancelled') return current;
      const active = current.active;
      await commit(transition({ type: 'BATCH_CANCELLED', reason: reason || 'user' }));
      if (active && ['ideas', 'copy'].includes(active.kind) && typeof deps.providerAbort === 'function') {
        dispatchedJobs.delete(active.jobId);
        await deps.providerAbort({ jobId: active.jobId }).catch(() => {});
      }
      if (active && active.kind === 'visual') {
        const draft = current.drafts.find((item) => item.id === active.draftId);
        const id = active.jobId || draft && draft.companionJobId;
        if (id) await deps.companion('/v1/flow/jobs/' + encodeURIComponent(id) + '/cancel', {}).catch(() => {});
      }
      return current;
    }

    async function getState() { return load(); }

    return {
      start: (input) => enqueue(() => start(input)),
      handleProviderResult: (input) => enqueue(() => handleProviderResult(input)),
      resume: () => enqueue(() => resume()),
      cancel,
      getState,
    };
  }

  return { createOrchestrator };
});

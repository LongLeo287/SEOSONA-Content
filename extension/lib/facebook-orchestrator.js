/* SEOSONA Facebook Orchestrator - resumable, event-driven batch coordination. */
(function (root, factory) {
  const api = factory(root.FacebookFactory, root.FacebookBatch, root.FacebookState);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FacebookOrchestrator = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Factory, Batch, State) {
  'use strict';

  if (!Factory || !Batch || !State) throw new Error('Facebook Factory, Batch, and State must load before the orchestrator.');

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

    async function dispatchIdeas(prompt, existingJobId) {
      const id = existingJobId || jobId('ideas');
      if (current.status !== 'ideas_running') await commit(transition({ type: 'IDEAS_STARTED', jobId: id, prompt }));
      try {
        const result = await deps.providerStart({ jobId: id, provider: current.provider, text: prompt, timeout: 300000, freshChat: true });
        if (!result || result.ok !== true) throw new Error(result && result.error || 'Provider rejected the idea job.');
      } catch (error) {
        await commit(transition({ type: 'IDEAS_FAILED', error: normalizeError(error, 'IDEA_PROVIDER_FAILED') }));
      }
      return current;
    }

    async function dispatchCopy(draft, prompt, existingJobId) {
      const id = existingJobId || jobId('copy', draft.id);
      if (draft.status !== 'copy_running') await commit(transition({ type: 'COPY_STARTED', draftId: draft.id, jobId: id, prompt }));
      try {
        const result = await deps.providerStart({ jobId: id, provider: current.provider, text: prompt, timeout: 300000, freshChat: true });
        if (!result || result.ok !== true) throw new Error(result && result.error || 'Provider rejected the copy job.');
      } catch (error) {
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

    async function processVisual(draft) {
      try {
        const visual = await deps.companion('/v1/flow/generate', {
          batchId: current.id,
          draftId: draft.id,
          visualJob: draft.package.visualJob,
        });
        if (current.status === 'cancelled') return current;
        if (!visual || !['asset_ready', 'asset_needs_review'].includes(visual.status)) throw new Error('Companion returned an unknown visual status.');
        const durableDraft = {
          id: draft.id,
          topic: draft.topic,
          angle: draft.angle || '',
          ...draft.package.parsed,
          status: visual.status,
          assetReceipt: visual.receipt || null,
        };
        const packageReceipt = portablePackageReceipt(await deps.companion('/v1/library/package', {
          batch: Object.keys(current).reduce((value, key) => {
            if (key !== 'contextSnapshot') value[key] = current[key];
            return value;
          }, {}),
          snapshot: current.contextSnapshot,
          draft: durableDraft,
        }));
        await commit(transition({
          type: visual.status === 'asset_ready' ? 'ASSET_READY' : 'ASSET_REVIEW',
          draftId: draft.id,
          receipt: visual.receipt || null,
          packageReceipt,
        }));
      } catch (error) {
        if (current.status === 'cancelled') return current;
        await commit(transition({ type: 'DRAFT_FAILED', draftId: draft.id, error: normalizeError(error, 'VISUAL_OR_PACKAGE_FAILED') }));
      }
      return startNextDraft(false);
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
        });
        if (!gate.ok) {
          await commit(transition({ type: 'COPY_BLOCKED', draftId, issues: gate.issues }));
          return startNextDraft(false);
        }
        await commit(transition({ type: 'VISUAL_STARTED', draftId, package: { parsed, visualJob: gate.visualJob } }));
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
      if (current.status === 'queued' || current.status === 'failed') {
        const prompt = Batch.buildIdeaPrompt({ count: current.requestedCount, snapshot: current.contextSnapshot });
        return dispatchIdeas(prompt);
      }
      if (current.active && current.active.kind === 'ideas') return dispatchIdeas(current.active.prompt, current.active.jobId);
      if (current.active && current.active.kind === 'copy') {
        const draft = current.drafts.find((item) => item.id === current.active.draftId);
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
      if (current.active && ['ideas', 'copy'].includes(current.active.kind) && typeof deps.providerAbort === 'function') {
        await deps.providerAbort({ jobId: current.active.jobId }).catch(() => {});
      }
      if (current.active && current.active.kind === 'visual') {
        await deps.companion('/v1/flow/cancel', {}).catch(() => {});
      }
      return commit(transition({ type: 'BATCH_CANCELLED', reason: reason || 'user' }));
    }

    async function getState() { return load(); }

    return { start, handleProviderResult, resume, cancel, getState };
  }

  return { createOrchestrator };
});

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.RuntimeProviderBridge = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function create(deps) {
    if (!deps || typeof deps.runtimeRequest !== 'function' || !deps.adapter || !deps.stateStore || !deps.ownerId) throw new Error('RuntimeProviderBridge requires runtimeRequest, adapter, stateStore, and ownerId.');

    async function postResult(active, job) {
      const fallback = job.status === 'stale'
        ? { success: false, error: 'TIMEOUT', message: 'Browser provider lease expired.' }
        : job.status === 'aborted'
          ? { success: false, error: 'ABORTED', message: 'Browser provider job was aborted.' }
          : (job.result || { success: false, error: 'PROVIDER_FAILED', message: 'Browser provider job failed.' });
      const typed = deps.adapter.normalizeResult(active.providerId, fallback, job);
      await deps.runtimeRequest('POST', `/v1/provider/browser/jobs/${active.taskId}/result`, typed);
      await deps.stateStore.clear();
      return { status: typed.status === 'COMPLETED' ? 'completed' : typed.status === 'BLOCKED' ? 'blocked' : 'failed', result: typed };
    }

    return {
      async poll() {
        const active = await deps.stateStore.get();
        if (active) {
          const job = await deps.adapter.status(active.taskId);
          if (job && ['done', 'error', 'aborted', 'stale'].includes(job.status)) {
            try { return await postResult(active, job); }
            catch (_) { return { status: 'runtime_unavailable' }; }
          }
          if (job && ['preparing', 'running'].includes(job.status)) {
            try { await deps.runtimeRequest('POST', `/v1/provider/browser/jobs/${active.taskId}/lease`, {}); return { status: 'running' }; }
            catch (_) { return { status: 'runtime_unavailable' }; }
          }
          return { status: 'active_unknown' };
        }

        let claimed;
        try { claimed = await deps.runtimeRequest('GET', '/v1/provider/browser/jobs/next'); }
        catch (_) { return { status: 'runtime_unavailable' }; }
        if (!claimed || claimed.status === 204 || !claimed.body || !claimed.body.task) return { status: 'idle' };

        const task = claimed.body.task;
        const providerId = task.providerPreference;
        await deps.stateStore.set({ taskId: task.taskId, providerId });
        try {
          const ack = await deps.adapter.start(task);
          if (!ack || ack.ok !== true) throw new Error(ack && ack.error || 'Browser adapter rejected task.');
          return { status: 'started' };
        } catch (error) {
          const job = await deps.adapter.status(task.taskId).catch(() => null);
          const synthetic = job || { status: 'error', startedAt: Date.now(), finishedAt: Date.now(), result: { success: false, error: 'EXCEPTION', message: String(error && error.message || error) } };
          if (!synthetic.result) synthetic.result = { success: false, error: 'EXCEPTION', message: String(error && error.message || error) };
          try { return await postResult({ taskId: task.taskId, providerId }, synthetic); }
          catch (_) { return { status: 'runtime_unavailable' }; }
        }
      },
    };
  }

  return { create };
});

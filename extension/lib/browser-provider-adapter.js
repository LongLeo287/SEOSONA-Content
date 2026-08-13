(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BrowserProviderAdapter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const RETRYABLE = new Set(['NO_RESPONSE_STARTED', 'NO_RESPONSE', 'TIMEOUT', 'NETWORK', 'EXCEPTION', 'SUBMIT_LOST']);
  const ERROR_MAP = {
    PROVIDER_NOT_LOGGED_IN: 'AUTH_REQUIRED', AUTH_REQUIRED: 'AUTH_REQUIRED',
    DAILY_QUOTA_EXCEEDED: 'RATE_LIMITED', RATE_LIMITED: 'RATE_LIMITED',
    EDITOR_NOT_FOUND: 'UI_CHANGED', INSERT_FAILED: 'UI_CHANGED', SUBMIT_LOST: 'UI_CHANGED', UI_CHANGED: 'UI_CHANGED',
    CONTENT_BLOCKED: 'CONTENT_BLOCKED', BLOCKED: 'CONTENT_BLOCKED', TIMEOUT: 'TIMEOUT',
  };
  function parseOutput(text) { try { return JSON.parse(text); } catch (_) { return text; } }
  function iso(value) { return new Date(Number(value || Date.now())).toISOString(); }
  function normalizeResult(providerId, result, job) {
    const success = result && result.success === true;
    const rawCode = String(result && result.error || (success ? '' : 'PROVIDER_FAILED'));
    const code = ERROR_MAP[rawCode] || rawCode;
    return {
      status: success ? 'COMPLETED' : code === 'CONTENT_BLOCKED' ? 'BLOCKED' : 'FAILED',
      output: success ? parseOutput(String(result.text || '')) : null,
      providerId,
      modelSession: String(result && result.modelState || ''),
      startedAt: iso(job && job.startedAt),
      completedAt: iso(job && (job.finishedAt || job.leaseUpdatedAt || Date.now())),
      costClass: 'ZERO_INCREMENTAL',
      parseStatus: success ? 'VALID' : 'NOT_PARSED',
      warnings: result && result.modelState && ['no-match', 'not-found', 'error'].includes(result.modelState) ? [`model:${result.modelState}`] : [],
      error: success ? null : { code, message: String(result && result.message || rawCode), retryable: RETRYABLE.has(rawCode) || code === 'TIMEOUT' },
      receipt: { adapter: 'browser', chatUrl: result && result.chatUrl || null, elapsedMs: Number(result && result.elapsedMs || 0) },
    };
  }
  function create(deps) {
    if (!deps || !deps.registry || typeof deps.runPage !== 'function' || typeof deps.abortPage !== 'function' || typeof deps.getJob !== 'function') throw new Error('BrowserProviderAdapter requires registry, runPage, abortPage, and getJob.');
    const now = typeof deps.now === 'function' ? deps.now : Date.now;
    return {
      async start(task) {
        const record = deps.registry.get(task && task.providerPreference);
        if (!record) throw new Error('Unknown browser provider: ' + String(task && task.providerPreference));
        const text = String(task && task.contextBundle && (task.contextBundle.compiledPrompt || task.contextBundle.prompt) || '');
        if (!text) throw new Error('Browser provider task requires contextBundle.compiledPrompt.');
        return deps.runPage({ jobId: task.taskId, provider: record.pageKey, text, timeout: task.timeoutMs || 600000, freshChat: true, chatUrl: null, modelMatch: null });
      },
      abort(taskId) { return deps.abortPage({ jobId: taskId }); },
      async status(taskId) {
        const job = await deps.getJob(taskId);
        if (!job) return null;
        if (['preparing', 'running'].includes(job.status)) {
          const timeout = Number(job.spec && job.spec.timeout) || 300000;
          const leaseAt = Number(job.leaseUpdatedAt || job.startedAt || 0);
          if (!leaseAt || Number(now()) - leaseAt > timeout + 60000) return { ...job, status: 'stale', reason: 'lease_expired' };
        }
        return job;
      },
      normalizeResult(providerId, result, job) { return normalizeResult(providerId, result, job); },
    };
  }
  return { create, normalizeResult };
});

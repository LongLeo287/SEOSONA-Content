function parseOutput(data) {
  if (data && data.output !== undefined) return data.output;
  if (typeof data?.output_text === 'string') { try { return JSON.parse(data.output_text); } catch { return data.output_text; } }
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') { try { return JSON.parse(content); } catch { return content; } }
  return data;
}
function iso(now) { const value = now(); return typeof value === 'string' ? value : new Date(value).toISOString(); }

export function createApiHttpAdapter({ providerId, endpoint, model, secretRef, resolveSecret, costClass, fetchImpl = fetch, now = Date.now }) {
  if (!providerId || !endpoint || !model || !secretRef || typeof resolveSecret !== 'function') throw new Error('API adapter configuration is incomplete.');
  if (!/^https:\/\//.test(endpoint)) throw new Error('API endpoint must use HTTPS.');
  return {
    providerId,
    async execute(task) {
      if (costClass === 'UNKNOWN_COST') throw new Error('API provider has unknown cost and cannot execute automatically.');
      if (costClass === 'PAID_BLOCKED') throw new Error('Paid API is blocked by provider policy.');
      if (costClass === 'PAID_ALLOWED' && task?.costPolicy?.paidApi !== true) throw new Error('Paid API is not authorized for this task.');
      const startedAt = iso(now);
      const key = await resolveSecret(secretRef);
      if (!key) throw new Error('API secret could not be resolved.');
      try {
        const response = await fetchImpl(endpoint, {
          method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
          body: JSON.stringify({ model, messages: [{ role: 'user', content: JSON.stringify({ taskType: task.taskType, contentJob: task.contentJob, contextBundle: task.contextBundle, outputContract: task.outputContract }) }] }),
        });
        const data = await response.json().catch(() => ({}));
        const completedAt = iso(now);
        if (!response.ok) {
          const rateLimited = response.status === 429;
          return { status: 'FAILED', output: null, providerId, modelSession: model, startedAt, completedAt, costClass, parseStatus: 'NOT_PARSED', warnings: [], error: { code: rateLimited ? 'RATE_LIMITED' : `HTTP_${response.status}`, message: String(data?.error?.message || `API request failed with HTTP ${response.status}.`), retryable: rateLimited || response.status >= 500 }, receipt: { providerId, model, httpStatus: response.status, usage: data?.usage || null } };
        }
        return { status: 'COMPLETED', output: parseOutput(data), providerId, modelSession: model, startedAt, completedAt, costClass, parseStatus: 'VALID', warnings: [], error: null, receipt: { providerId, model, httpStatus: response.status, usage: data?.usage || null } };
      } catch (error) {
        return { status: 'FAILED', output: null, providerId, modelSession: model, startedAt, completedAt: iso(now), costClass, parseStatus: 'NOT_PARSED', warnings: [], error: { code: 'NETWORK', message: error instanceof Error ? error.message : 'API network failure.', retryable: true }, receipt: { providerId, model, httpStatus: null, usage: null } };
      }
    },
  };
}

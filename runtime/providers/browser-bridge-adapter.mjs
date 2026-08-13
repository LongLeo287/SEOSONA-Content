export function createBrowserBridgeAdapter({ providerId, bridge, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = Date.now, pollMs = 250 }) {
  if (!providerId || !bridge || typeof bridge.enqueue !== 'function' || typeof bridge.get !== 'function') throw new Error('providerId and browser bridge are required.');
  return {
    providerId,
    async execute(task) {
      const queuedTask = structuredClone({ ...task, providerPreference: providerId });
      bridge.enqueue(queuedTask);
      const started = Number(now());
      const timeoutMs = Number(task.timeoutMs || 300000);
      while (Number(now()) - started <= timeoutMs) {
        const item = bridge.get(task.taskId);
        if (!item) throw new Error(`Browser bridge lost task ${task.taskId}.`);
        if (['completed', 'failed', 'blocked'].includes(item.status)) return structuredClone(item.result);
        if (item.status === 'cancelled') return { status: 'FAILED', output: null, providerId, modelSession: '', startedAt: new Date(started).toISOString(), completedAt: new Date(Number(now())).toISOString(), costClass: 'ZERO_INCREMENTAL', parseStatus: 'NOT_PARSED', warnings: [], error: { code: 'CANCELLED', message: 'Browser provider task was cancelled.', retryable: false }, receipt: { adapter: 'browser-bridge' } };
        await sleep(pollMs);
      }
      return { status: 'FAILED', output: null, providerId, modelSession: '', startedAt: new Date(started).toISOString(), completedAt: new Date(Number(now())).toISOString(), costClass: 'ZERO_INCREMENTAL', parseStatus: 'NOT_PARSED', warnings: [], error: { code: 'TIMEOUT', message: 'Browser provider task timed out.', retryable: true }, receipt: { adapter: 'browser-bridge' } };
    },
  };
}

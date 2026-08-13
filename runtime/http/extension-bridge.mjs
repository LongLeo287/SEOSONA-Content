function clone(value) { return value == null ? value : structuredClone(value); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

export function createBrowserJobBridge({ now = Date.now, leaseMs = 30000, initialState = [] } = {}) {
  if (!Number.isFinite(leaseMs) || leaseMs <= 0) throw new Error('leaseMs must be positive.');
  const jobs = new Map();
  for (const item of initialState || []) jobs.set(item.task.taskId, clone(item));
  return {
    enqueue(task) {
      if (!task || !task.taskId) throw new Error('taskId is required.');
      const existing = jobs.get(task.taskId);
      if (existing) {
        if (!same(existing.task, task)) throw new Error(`Task ${task.taskId} already exists with different payload.`);
        return clone(existing);
      }
      const item = { task: clone(task), status: 'queued', createdAt: now(), leaseOwner: null, leaseUntil: null, result: null };
      jobs.set(task.taskId, item);
      return clone(item);
    },
    claimNext(owner) {
      if (!owner) throw new Error('lease owner is required.');
      const current = now();
      for (const item of jobs.values()) {
        const available = item.status === 'queued' || (item.status === 'leased' && Number(item.leaseUntil) <= current);
        if (!available) continue;
        item.status = 'leased'; item.leaseOwner = owner; item.leaseUntil = current + leaseMs;
        return clone(item);
      }
      return null;
    },
    renewLease(taskId, owner) {
      const item = jobs.get(taskId);
      if (!item) throw new Error(`Unknown task: ${taskId}.`);
      if (item.status !== 'leased' || item.leaseOwner !== owner) throw new Error('Lease is not owned by this extension instance.');
      if (Number(item.leaseUntil) < now()) throw new Error('Lease has expired.');
      item.leaseUntil = now() + leaseMs;
      return clone(item);
    },
    submitResult(taskId, owner, result) {
      const item = jobs.get(taskId);
      if (!item) throw new Error(`Unknown task: ${taskId}.`);
      if (item.status === 'completed' || item.status === 'failed' || item.status === 'blocked') {
        if (same(item.result, result)) return clone(item);
        throw new Error(`Task ${taskId} is already finalized.`);
      }
      if (item.status === 'cancelled') throw new Error(`Task ${taskId} is cancelled.`);
      if (item.status !== 'leased' || item.leaseOwner !== owner) throw new Error('Result submitter does not own the active lease.');
      item.result = clone(result);
      item.status = result && result.status === 'COMPLETED' ? 'completed' : result && result.status === 'BLOCKED' ? 'blocked' : 'failed';
      item.completedAt = now(); item.leaseUntil = null;
      return clone(item);
    },
    cancel(taskId) {
      const item = jobs.get(taskId);
      if (!item) throw new Error(`Unknown task: ${taskId}.`);
      if (['completed','failed','blocked','cancelled'].includes(item.status)) return clone(item);
      item.status = 'cancelled'; item.cancelledAt = now(); item.leaseUntil = null;
      return clone(item);
    },
    get(taskId) { return clone(jobs.get(taskId) || null); },
    exportState() { return [...jobs.values()].map(clone); },
  };
}

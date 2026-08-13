import { createHash } from 'node:crypto';
import { canonicalJson } from '../lib/atomic-json.mjs';
import { routeProvider } from './router.mjs';

function digest(value) { return createHash('sha256').update(canonicalJson(value)).digest('hex'); }
function hasManualLock(policy) { return Object.values(policy.manualLocks || {}).some(Boolean); }

export function createProviderGateway({ registry, adapters, now = Date.now }) {
  if (!registry || typeof registry.list !== 'function' || !(adapters instanceof Map)) throw new Error('registry and adapter map are required.');
  return {
    async execute(task, policy = {}) {
      const attempted = [];
      const deny = new Set(policy.denyProviders || []);
      let lastResult = null;
      const locked = hasManualLock(policy);
      while (true) {
        let routed;
        try { routed = routeProvider({ task, providers: registry.list(), policy: { ...policy, denyProviders: [...deny] } }); }
        catch (error) { if (lastResult) return { ...lastResult, attempts: attempted }; throw error; }
        const adapter = adapters.get(routed.providerId);
        if (!adapter || typeof adapter.execute !== 'function') throw new Error(`Provider adapter is unavailable: ${routed.providerId}.`);
        const started = Number(now());
        const result = await adapter.execute(structuredClone(task));
        const elapsed = Math.max(0, Number(now()) - started);
        const receipt = {
          receiptId: `receipt_${task.taskId}_${attempted.length + 1}`, providerId: routed.providerId, modelSession: result.modelSession || '', costClass: result.costClass,
          contextSnapshotId: task.contextSnapshotId, latencyMs: Number.isFinite(elapsed) ? elapsed : null,
          resultDigest: digest({ status: result.status, output: result.output, error: result.error }), routeReason: routed.reason,
        };
        const normalized = { ...result, receipt };
        attempted.push({ providerId: routed.providerId, status: result.status, receipt });
        lastResult = normalized;
        if (result.status === 'COMPLETED') return { ...normalized, attempts: attempted };
        if (locked || !result.error?.retryable) return { ...normalized, attempts: attempted };
        deny.add(routed.providerId);
      }
    },
  };
}

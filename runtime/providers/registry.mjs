import { createQualitySignalWindow } from './quality-signals.mjs';

const CAPABILITIES = ['writing','editing','audit','research','extract','structure','repurpose'];
const defaultHealth = () => ({ availability: true, auth: 'unknown', timeoutRate: 0, rateLimitRate: 0, selectorHealth: 1, parseFailureRate: 0, retryRate: 0, lastUpdatedAt: null });

export function seedV1Providers() {
  const browser = (providerId) => ({ providerId, adapterType: 'browser', capabilities: [...CAPABILITIES], costClass: 'ZERO_INCREMENTAL', enabled: true, authStatus: 'UNKNOWN', health: defaultHealth(), qualityByJob: {}, latencyMs: null });
  return [browser('chatgpt-web'), browser('claude-web'), browser('gemini-web'), browser('grok-web'), {
    providerId: 'api-v1', adapterType: 'api', capabilities: [...CAPABILITIES], costClass: 'UNKNOWN_COST', enabled: false, authStatus: 'UNKNOWN', health: defaultHealth(), qualityByJob: {}, latencyMs: null,
  }];
}

export function createProviderRegistry(initial = [], { qualityWindow = 50 } = {}) {
  const records = new Map();
  const signals = createQualitySignalWindow(qualityWindow);
  const clone = (value) => value == null ? value : structuredClone(value);
  const normalize = (record) => ({ ...clone(record), capabilities: [...(record.capabilities || [])], health: { ...defaultHealth(), ...(record.health || {}) }, qualityByJob: clone(record.qualityByJob || {}) });
  for (const record of initial) records.set(record.providerId, normalize(record));
  return {
    upsert(record) {
      if (!record || !record.providerId) throw new Error('providerId is required.');
      const previous = records.get(record.providerId) || {};
      const next = normalize({ ...previous, ...record, health: { ...(previous.health || {}), ...(record.health || {}) }, qualityByJob: { ...(previous.qualityByJob || {}), ...(record.qualityByJob || {}) } });
      records.set(next.providerId, next);
      return clone(next);
    },
    get(providerId) { return clone(records.get(providerId) || null); },
    list() { return [...records.values()].map(clone); },
    updateHealth(providerId, patch) {
      const current = records.get(providerId);
      if (!current) throw new Error(`Unknown provider: ${providerId}.`);
      current.health = { ...current.health, ...clone(patch) };
      return clone(current);
    },
    recordQualitySignal(signal) {
      const current = records.get(signal && signal.providerId);
      if (!current) throw new Error(`Unknown provider: ${signal && signal.providerId}.`);
      const summary = signals.record(signal);
      current.qualityByJob[`${signal.contentJob}:${signal.taskType}`] = summary;
      return clone(summary);
    },
  };
}

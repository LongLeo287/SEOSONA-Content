const COST_RANK = { ZERO_INCREMENTAL: 0, FREE_QUOTA: 1, PAID_ALLOWED: 2 };
const LOCK_PRECEDENCE = ['run', 'stage', 'workflow', 'project', 'global'];

function quality(provider, task) {
  const observed = provider.qualityByJob && provider.qualityByJob[`${task.contentJob}:${task.taskType}`];
  return observed && Number.isFinite(Number(observed.score)) ? Number(observed.score) : 0.5;
}
function stability(provider) {
  const h = provider.health || {};
  return Number(h.timeoutRate || 0) + Number(h.rateLimitRate || 0) + Number(h.parseFailureRate || 0) + Number(h.retryRate || 0) + Math.max(0, 1 - Number(h.selectorHealth ?? 1));
}
function ineligibleReason(provider, task, policy) {
  if (!provider || provider.enabled === false) return 'disabled';
  if ((policy.denyProviders || []).includes(provider.providerId)) return 'denied';
  if (!(task.requiredCapabilities || []).every((capability) => (provider.capabilities || []).includes(capability))) return 'missing-capability';
  if (provider.health && provider.health.availability === false) return 'unavailable';
  if (provider.authStatus === 'AUTH_REQUIRED') return 'auth-required';
  if (provider.costClass === 'PAID_BLOCKED') return 'paid-blocked';
  if (provider.costClass === 'UNKNOWN_COST') return 'unknown-cost';
  if (provider.costClass === 'PAID_ALLOWED' && policy.paidApi !== true) return 'paid-not-authorized';
  if (!(provider.costClass in COST_RANK)) return 'unsupported-cost';
  return null;
}
function chosenLock(manualLocks = {}) {
  for (const level of LOCK_PRECEDENCE) if (manualLocks[level]) return { level, providerId: manualLocks[level] };
  return null;
}

export function routeProvider({ task, providers, policy = {} }) {
  if (!task || !Array.isArray(providers)) throw new Error('task and providers are required.');
  const considered = providers.map((provider) => {
    const reason = ineligibleReason(provider, task, policy);
    return { providerId: provider.providerId, eligible: !reason, rejection: reason, quality: quality(provider, task), costClass: provider.costClass, stability: stability(provider), latencyMs: Number(provider.latencyMs ?? Infinity) };
  });
  const lock = chosenLock(policy.manualLocks);
  if (lock) {
    const candidate = providers.find((provider) => provider.providerId === lock.providerId);
    if (!candidate) throw new Error(`Manual provider ${lock.providerId} was not found.`);
    const reason = ineligibleReason(candidate, task, policy);
    if (reason) throw new Error(`Manual provider ${lock.providerId} is ${reason === 'denied' ? 'denied' : `ineligible: ${reason}`}.`);
    return { providerId: candidate.providerId, reason: `manual-lock:${lock.level}`, considered };
  }
  const eligible = providers.filter((provider) => !ineligibleReason(provider, task, policy));
  if (!eligible.length) throw new Error('No eligible provider is available for this task.');
  eligible.sort((a, b) => {
    const qualityDelta = quality(b, task) - quality(a, task);
    if (Math.abs(qualityDelta) > 1e-9) return qualityDelta;
    const costDelta = COST_RANK[a.costClass] - COST_RANK[b.costClass];
    if (costDelta) return costDelta;
    const stabilityDelta = stability(a) - stability(b);
    if (Math.abs(stabilityDelta) > 1e-9) return stabilityDelta;
    return Number(a.latencyMs ?? Infinity) - Number(b.latencyMs ?? Infinity);
  });
  return { providerId: eligible[0].providerId, reason: 'auto:quality-cost-stability-speed', considered };
}

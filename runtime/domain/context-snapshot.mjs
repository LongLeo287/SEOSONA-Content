import { createHash } from 'node:crypto';
import { canonicalize } from '../lib/atomic-json.mjs';
import { assertRecord } from './records.mjs';

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

export async function createContextSnapshot(input, { store, workspaceId, now = () => new Date().toISOString(), idFactory }) {
  if (!input || !input.project || !input.project.projectId) throw new Error('project is required for a context snapshot.');
  if (!store || typeof store.put !== 'function') throw new Error('store is required.');
  if (!workspaceId) throw new Error('workspaceId is required.');
  if (typeof idFactory !== 'function') throw new Error('idFactory is required.');

  const frozenInput = structuredClone({
    project: input.project,
    brand: input.brand || null,
    audience: input.audience || {},
    sourceRefs: input.sourceRefs || [],
    evidenceRefs: input.evidenceRefs || [],
    jobPack: input.jobPack,
    targetPack: input.targetPack || null,
    policy: input.policy || {},
    providerPolicy: input.providerPolicy || {},
  });
  if (!frozenInput.jobPack || !frozenInput.jobPack.id || !frozenInput.jobPack.version) throw new Error('jobPack id and version are required.');

  const hash = digest(frozenInput);
  const record = assertRecord('contextSnapshot', {
    contextSnapshotId: idFactory('context'),
    projectId: frozenInput.project.projectId,
    brandRef: frozenInput.brand,
    audience: frozenInput.audience,
    sourceRefs: frozenInput.sourceRefs,
    evidenceRefs: frozenInput.evidenceRefs,
    jobPack: frozenInput.jobPack,
    targetPack: frozenInput.targetPack,
    policy: frozenInput.policy,
    providerPolicy: frozenInput.providerPolicy,
    hash,
    createdAt: now(),
  });
  return store.put('contextSnapshot', workspaceId, record);
}

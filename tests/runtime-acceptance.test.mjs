import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaceStore } from '../runtime/storage/workspace-store.mjs';
import { createWorkspaceService } from '../runtime/domain/workspace-service.mjs';
import { createContentService } from '../runtime/domain/content-service.mjs';
import { createContextSnapshot } from '../runtime/domain/context-snapshot.mjs';

function idFactory() { let n = 0; return (prefix) => `${prefix}_accept_${++n}`; }

test('local Runtime survives restart with canonical writing lineage intact', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'seosona-acceptance-'));
  const ids = idFactory();
  const now = () => '2026-08-13T04:00:00.000Z';
  const store1 = createWorkspaceStore({ rootDir });
  const workspace1 = createWorkspaceService({ store: store1, idFactory: ids, now });
  const content1 = createContentService({ store: store1, idFactory: ids, now });

  const workspace = await workspace1.createWorkspace({ name: 'Local' });
  const brand = await workspace1.createBrand({ workspaceId: workspace.workspaceId, name: 'SEOSONA', voice: { tone: 'clear' } });
  const project = await workspace1.createProject({ workspaceId: workspace.workspaceId, brandId: brand.brandId, name: 'Writing V1', objective: 'Prove local source of truth' });
  const source = await content1.addSource({ workspaceId: workspace.workspaceId, projectId: project.projectId, kind: 'text', title: 'Source', bytes: Buffer.from('The verified fact is 42.'), parserVersion: '1.0' });
  const evidence = await content1.addEvidence({ workspaceId: workspace.workspaceId, projectId: project.projectId, sourceId: source.sourceId, statement: 'The verified fact is 42.', type: 'FACT', locator: { line: 1 }, verifiedAt: now() });
  const created = await content1.createContent({ workspaceId: workspace.workspaceId, projectId: project.projectId, jobType: 'article', title: 'Article', payload: { body: 'Draft says 42.' } });
  const edited = await content1.appendRevision({ workspaceId: workspace.workspaceId, contentId: created.content.contentId, operation: 'EDIT', payload: { body: 'Final says 42.' }, actor: 'user' });
  const claim = await content1.addClaim({ workspaceId: workspace.workspaceId, projectId: project.projectId, contentId: created.content.contentId, proposition: 'The verified fact is 42.', type: 'FACTUAL', strength: 'direct', status: 'SUPPORTED', evidenceRefs: [evidence.evidenceId] });
  const snapshot = await createContextSnapshot({
    project, brand, audience: { level: 'expert' }, sourceRefs: [{ sourceId: source.sourceId, sha256: source.sha256 }], evidenceRefs: [{ evidenceId: evidence.evidenceId }],
    jobPack: { id: 'article', version: '1.0' }, targetPack: { id: 'web', version: '1.0' }, policy: { paidApi: false }, providerPolicy: { mode: 'auto', paidAllowed: false },
  }, { store: store1, workspaceId: workspace.workspaceId, idFactory: ids, now });

  const store2 = createWorkspaceStore({ rootDir });
  const workspace2 = createWorkspaceService({ store: store2, idFactory: ids, now });
  const content2 = createContentService({ store: store2, idFactory: ids, now });
  const reloadedProject = await workspace2.getProject(workspace.workspaceId, project.projectId);
  const history = await content2.getContentHistory(workspace.workspaceId, created.content.contentId);
  const reloadedSource = await store2.get('source', workspace.workspaceId, source.sourceId);
  const reloadedEvidence = await store2.get('evidence', workspace.workspaceId, evidence.evidenceId);
  const reloadedClaim = await store2.get('claim', workspace.workspaceId, claim.claimId);
  const reloadedSnapshot = await store2.get('contextSnapshot', workspace.workspaceId, snapshot.contextSnapshotId);

  assert.equal(reloadedProject.brandId, brand.brandId);
  assert.equal((await store2.readBlob(reloadedSource.blobRef)).toString(), 'The verified fact is 42.');
  assert.equal(reloadedEvidence.sourceId, source.sourceId);
  assert.deepEqual(reloadedClaim.evidenceRefs, [evidence.evidenceId]);
  assert.deepEqual(history.revisions.map((r) => r.revisionId), [created.revision.revisionId, edited.revision.revisionId]);
  assert.equal(history.content.currentRevisionId, edited.revision.revisionId);
  assert.equal(reloadedSnapshot.hash, snapshot.hash);
});

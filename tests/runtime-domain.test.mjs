import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaceStore } from '../runtime/storage/workspace-store.mjs';
import { createWorkspaceService } from '../runtime/domain/workspace-service.mjs';
import { createContentService } from '../runtime/domain/content-service.mjs';

function sequenceIds() {
  let n = 0;
  return (prefix) => `${prefix}_${++n}`;
}

async function setup() {
  const rootDir = await mkdtemp(join(tmpdir(), 'seosona-domain-'));
  const store = createWorkspaceStore({ rootDir });
  const now = () => '2026-08-13T01:00:00.000Z';
  const idFactory = sequenceIds();
  const workspace = createWorkspaceService({ store, now, idFactory });
  const content = createContentService({ store, now, idFactory });
  return { store, workspace, content };
}

test('project requires an existing workspace and brand from the same workspace', async () => {
  const { workspace } = await setup();
  await assert.rejects(() => workspace.createProject({ workspaceId: 'workspace_missing', name: 'Nope' }), /WORKSPACE_NOT_FOUND/);
  const a = await workspace.createWorkspace({ name: 'A' });
  const b = await workspace.createWorkspace({ name: 'B' });
  const brand = await workspace.createBrand({ workspaceId: b.workspaceId, name: 'Brand B' });
  await assert.rejects(
    () => workspace.createProject({ workspaceId: a.workspaceId, brandId: brand.brandId, name: 'Wrong brand' }),
    (error) => error && error.code === 'SCOPE_MISMATCH'
  );
  const ownBrand = await workspace.createBrand({ workspaceId: a.workspaceId, name: 'Brand A' });
  const project = await workspace.createProject({ workspaceId: a.workspaceId, brandId: ownBrand.brandId, name: 'Project' });
  assert.equal(project.brandId, ownBrand.brandId);
  assert.equal((await workspace.getProject(a.workspaceId, project.projectId)).name, 'Project');
  assert.deepEqual((await workspace.listProjects(a.workspaceId)).map((x) => x.projectId), [project.projectId]);
});

test('source snapshots preserve blob hash and page changes create new source ids', async () => {
  const { workspace, content } = await setup();
  const ws = await workspace.createWorkspace({ name: 'A' });
  const project = await workspace.createProject({ workspaceId: ws.workspaceId, name: 'P' });
  const first = await content.addSource({ workspaceId: ws.workspaceId, projectId: project.projectId, kind: 'url', title: 'Page', canonicalUrl: 'https://example.com', bytes: Buffer.from('v1'), parserVersion: '1.0' });
  const second = await content.addSource({ workspaceId: ws.workspaceId, projectId: project.projectId, kind: 'url', title: 'Page', canonicalUrl: 'https://example.com', bytes: Buffer.from('v2'), parserVersion: '1.0' });
  assert.notEqual(first.sourceId, second.sourceId);
  assert.notEqual(first.sha256, second.sha256);
  assert.match(first.blobRef, /^seosona-local:\/\//);
});

test('content creation appends immutable first revision and later revisions preserve lineage', async () => {
  const { workspace, content, store } = await setup();
  const ws = await workspace.createWorkspace({ name: 'A' });
  const project = await workspace.createProject({ workspaceId: ws.workspaceId, name: 'P' });
  const created = await content.createContent({ workspaceId: ws.workspaceId, projectId: project.projectId, jobType: 'article', title: 'Article', payload: { body: 'v1' } });
  assert.equal(created.content.currentRevisionId, created.revision.revisionId);
  assert.equal(created.revision.operation, 'CREATE');
  assert.equal(created.revision.parentRevisionId, null);

  const updated = await content.appendRevision({ workspaceId: ws.workspaceId, contentId: created.content.contentId, operation: 'EDIT', payload: { body: 'v2' }, actor: 'user' });
  assert.equal(updated.revision.parentRevisionId, created.revision.revisionId);
  assert.equal(updated.content.currentRevisionId, updated.revision.revisionId);

  await assert.rejects(
    () => store.put('revision', ws.workspaceId, { ...created.revision, payload: { body: 'tampered' } }),
    (error) => error && error.code === 'IMMUTABLE_RECORD_CONFLICT'
  );

  const history = await content.getContentHistory(ws.workspaceId, created.content.contentId);
  assert.deepEqual(history.revisions.map((x) => x.payload.body), ['v1', 'v2']);
});

test('evidence and claims retain traceable project/content scope', async () => {
  const { workspace, content } = await setup();
  const ws = await workspace.createWorkspace({ name: 'A' });
  const project = await workspace.createProject({ workspaceId: ws.workspaceId, name: 'P' });
  const source = await content.addSource({ workspaceId: ws.workspaceId, projectId: project.projectId, kind: 'text', title: 'Source', bytes: Buffer.from('Fact') });
  const evidence = await content.addEvidence({ workspaceId: ws.workspaceId, projectId: project.projectId, sourceId: source.sourceId, statement: 'Fact', type: 'FACT', locator: { line: 1 } });
  const created = await content.createContent({ workspaceId: ws.workspaceId, projectId: project.projectId, jobType: 'product', title: 'Product', payload: { body: 'Draft' } });
  const claim = await content.addClaim({ workspaceId: ws.workspaceId, projectId: project.projectId, contentId: created.content.contentId, proposition: 'Fact', type: 'FACTUAL', strength: 'qualified', status: 'SUPPORTED', evidenceRefs: [evidence.evidenceId] });
  assert.equal(claim.contentId, created.content.contentId);
  assert.deepEqual(claim.evidenceRefs, [evidence.evidenceId]);
});

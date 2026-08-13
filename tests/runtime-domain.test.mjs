import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createWorkspaceStore } from '../runtime/storage/workspace-store.mjs';
import { createWorkspaceService } from '../runtime/domain/workspace-service.mjs';
import { createContentService } from '../runtime/domain/content-service.mjs';

const NOW = '2026-08-12T00:00:00.000Z';

// idFactory tất định: prefix_1, prefix_2… để test đọc được bằng mắt.
function makeHarness(store) {
  const counters = new Map();
  const idFactory = (prefix) => {
    const n = (counters.get(prefix) || 0) + 1;
    counters.set(prefix, n);
    return `${String(prefix).toLowerCase()}_${n}`;
  };
  const now = () => NOW;
  return {
    workspaces: createWorkspaceService({ store, now, idFactory }),
    content: createContentService({ store, now, idFactory }),
  };
}

async function withServices(fn) {
  const rootDir = await mkdtemp(join(tmpdir(), 'seosona-domain-'));
  try {
    const store = createWorkspaceStore({ rootDir });
    await fn(makeHarness(store), store);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

test('project must reference an existing workspace', async () => {
  await withServices(async ({ workspaces }) => {
    await assert.rejects(
      () => workspaces.createProject({ workspaceId: 'workspace_missing', name: 'P' }),
      (e) => e.code === 'WORKSPACE_NOT_FOUND',
    );
  });
});

test('project brand must live in the same workspace', async () => {
  await withServices(async ({ workspaces }) => {
    const a = await workspaces.createWorkspace({ name: 'A' });
    const b = await workspaces.createWorkspace({ name: 'B' });
    const brandOfB = await workspaces.createBrand({ workspaceId: b.workspaceId, name: 'Brand B' });
    await assert.rejects(
      () => workspaces.createProject({ workspaceId: a.workspaceId, name: 'P', brandId: brandOfB.brandId }),
      (e) => e.code === 'SCOPE_MISMATCH',
    );
  });
});

test('project is shaped as specified and is listable', async () => {
  await withServices(async ({ workspaces }) => {
    const ws = await workspaces.createWorkspace({ name: 'A' });
    const brand = await workspaces.createBrand({ workspaceId: ws.workspaceId, name: 'Brand' });
    const p = await workspaces.createProject({
      workspaceId: ws.workspaceId, name: 'P', brandId: brand.brandId, objective: 'Grow',
    });
    assert.equal(p.status, 'active');
    assert.equal(p.brandId, brand.brandId);
    assert.equal(p.objective, 'Grow');
    assert.equal(p.createdAt, NOW);

    const p2 = await workspaces.createProject({ workspaceId: ws.workspaceId, name: 'Q' });
    assert.equal(p2.brandId, null, 'brandId defaults to null, not undefined');
    assert.equal(p2.objective, '');

    assert.equal((await workspaces.getProject(ws.workspaceId, p.projectId)).name, 'P');
    assert.equal((await workspaces.listProjects(ws.workspaceId)).length, 2);
  });
});

test('source snapshot preserves the raw bytes hash and is never replaced', async () => {
  await withServices(async ({ workspaces, content }, store) => {
    const ws = await workspaces.createWorkspace({ name: 'A' });
    const p = await workspaces.createProject({ workspaceId: ws.workspaceId, name: 'P' });
    const bytes = Buffer.from('<html>original</html>', 'utf8');
    const expected = createHash('sha256').update(bytes).digest('hex');

    const s1 = await content.addSource({
      workspaceId: ws.workspaceId, projectId: p.projectId,
      kind: 'html', title: 'Page', canonicalUrl: 'https://x.test/a',
      bytes, parserVersion: 'html@1',
    });
    assert.equal(s1.sha256, expected);
    assert.deepEqual(await store.readBlob(s1.blobRef), bytes);

    // Trang đổi nội dung => phải sinh sourceId MỚI, không đè lên ảnh chụp cũ.
    const s2 = await content.addSource({
      workspaceId: ws.workspaceId, projectId: p.projectId,
      kind: 'html', title: 'Page', canonicalUrl: 'https://x.test/a',
      bytes: Buffer.from('<html>changed</html>', 'utf8'), parserVersion: 'html@1',
    });
    assert.notEqual(s2.sourceId, s1.sourceId);
    assert.notEqual(s2.sha256, s1.sha256);
    assert.deepEqual(await store.readBlob(s1.blobRef), bytes, 'old snapshot must survive');
  });
});

test('source without raw bytes still records provenance', async () => {
  await withServices(async ({ workspaces, content }) => {
    const ws = await workspaces.createWorkspace({ name: 'A' });
    const p = await workspaces.createProject({ workspaceId: ws.workspaceId, name: 'P' });
    const s = await content.addSource({
      workspaceId: ws.workspaceId, projectId: p.projectId, kind: 'note', title: 'Manual note',
    });
    assert.equal(s.blobRef, null);
    assert.ok(s.sha256, 'a digest of the logical record is still recorded');
    assert.equal(s.canonicalUrl, null);
  });
});

test('creating content also creates its first CREATE revision', async () => {
  await withServices(async ({ workspaces, content }) => {
    const ws = await workspaces.createWorkspace({ name: 'A' });
    const p = await workspaces.createProject({ workspaceId: ws.workspaceId, name: 'P' });
    const c = await content.createContent({
      workspaceId: ws.workspaceId, projectId: p.projectId, contentJob: 'article',
      payload: { body: 'v1' },
    });
    assert.ok(c.currentRevisionId);
    const history = await content.getContentHistory(ws.workspaceId, c.contentId);
    assert.equal(history.length, 1);
    assert.equal(history[0].operation, 'CREATE');
    assert.equal(history[0].parentRevisionId, null);
    assert.equal(history[0].payload.body, 'v1');
  });
});

test('later revisions point at their parent and move currentRevisionId', async () => {
  await withServices(async ({ workspaces, content }) => {
    const ws = await workspaces.createWorkspace({ name: 'A' });
    const p = await workspaces.createProject({ workspaceId: ws.workspaceId, name: 'P' });
    const c = await content.createContent({
      workspaceId: ws.workspaceId, projectId: p.projectId, contentJob: 'article', payload: { body: 'v1' },
    });
    const r2 = await content.appendRevision({
      workspaceId: ws.workspaceId, contentId: c.contentId, operation: 'EDIT', payload: { body: 'v2' },
    });
    assert.equal(r2.parentRevisionId, c.currentRevisionId);

    const history = await content.getContentHistory(ws.workspaceId, c.contentId);
    assert.deepEqual(history.map((r) => r.payload.body), ['v1', 'v2'], 'lineage kept in order');

    const fresh = await content.getContent(ws.workspaceId, c.contentId);
    assert.equal(fresh.currentRevisionId, r2.revisionId, 'only the pointer moves');
  });
});

test('an existing revision payload can never be overwritten', async () => {
  await withServices(async ({ workspaces, content }, store) => {
    const ws = await workspaces.createWorkspace({ name: 'A' });
    const p = await workspaces.createProject({ workspaceId: ws.workspaceId, name: 'P' });
    const c = await content.createContent({
      workspaceId: ws.workspaceId, projectId: p.projectId, contentJob: 'article', payload: { body: 'v1' },
    });
    const first = (await content.getContentHistory(ws.workspaceId, c.contentId))[0];
    await assert.rejects(
      () => store.put('revision', ws.workspaceId, { ...first, payload: { body: 'tampered' } }),
      (e) => e.code === 'IMMUTABLE_RECORD_CONFLICT',
    );
    const after = (await content.getContentHistory(ws.workspaceId, c.contentId))[0];
    assert.equal(after.payload.body, 'v1');
  });
});

test('appendRevision refuses unknown content', async () => {
  await withServices(async ({ workspaces, content }) => {
    const ws = await workspaces.createWorkspace({ name: 'A' });
    await assert.rejects(
      () => content.appendRevision({
        workspaceId: ws.workspaceId, contentId: 'content_missing', operation: 'EDIT', payload: {},
      }),
      (e) => e.code === 'CONTENT_NOT_FOUND',
    );
  });
});

test('evidence must reference a stored source, claim keeps its strength', async () => {
  await withServices(async ({ workspaces, content }) => {
    const ws = await workspaces.createWorkspace({ name: 'A' });
    const p = await workspaces.createProject({ workspaceId: ws.workspaceId, name: 'P' });
    await assert.rejects(
      () => content.addEvidence({ workspaceId: ws.workspaceId, sourceId: 'source_missing', statement: 'x' }),
      (e) => e.code === 'SOURCE_NOT_FOUND',
    );

    const s = await content.addSource({
      workspaceId: ws.workspaceId, projectId: p.projectId, kind: 'note', title: 'N',
    });
    const ev = await content.addEvidence({
      workspaceId: ws.workspaceId, sourceId: s.sourceId, statement: 'X is Y', locator: { page: 2 },
    });
    assert.equal(ev.sourceId, s.sourceId);

    const claim = await content.addClaim({
      workspaceId: ws.workspaceId, proposition: 'X relates to Y',
      strength: 'ASSOCIATED', evidenceRefs: [ev.evidenceId],
    });
    assert.equal(claim.strength, 'ASSOCIATED');
    await assert.rejects(
      () => content.addClaim({ workspaceId: ws.workspaceId, proposition: 'p', strength: 'ENORMOUS' }),
      /strength/,
    );
  });
});

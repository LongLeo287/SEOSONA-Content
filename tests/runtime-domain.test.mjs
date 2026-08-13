import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createWorkspaceStore } from '../runtime/storage/workspace-store.mjs';
import { createWorkspaceService } from '../runtime/domain/workspace-service.mjs';
import { createContentService } from '../runtime/domain/content-service.mjs';
import { createContextSnapshot, canonicalize } from '../runtime/domain/context-snapshot.mjs';

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

// ---------------------------------------------------------------- ContextSnapshot (Task 6)

const CTX_INPUT = () => ({
  project: { projectId: 'project_1', workspaceId: 'workspace_1' },
  brand: { brandId: 'brand_1', revision: 3 },
  audience: { segment: 'smb' },
  sourceRefs: [{ sourceId: 'source_1', sha256: 'aaa' }],
  evidenceRefs: [{ evidenceId: 'evidence_1', revision: 1 }],
  jobPack: { id: 'job.article', version: '1.2.0' },
  targetPack: { id: 'target.blog', version: '0.3.0' },
  policy: { paid: 'PAID_BLOCKED' },
  providerPolicy: { lock: null },
});

test('snapshot hash is stable regardless of object key order', async () => {
  await withServices(async (_svc, store) => {
    const deps = { store, now: () => NOW, idFactory: () => 'contextsnapshot_1' };
    const a = await createContextSnapshot(CTX_INPUT(), { ...deps, workspaceId: 'workspace_1' });

    // same content, keys written in a different order
    const reordered = {
      providerPolicy: { lock: null },
      policy: { paid: 'PAID_BLOCKED' },
      targetPack: { version: '0.3.0', id: 'target.blog' },
      jobPack: { version: '1.2.0', id: 'job.article' },
      evidenceRefs: [{ revision: 1, evidenceId: 'evidence_1' }],
      sourceRefs: [{ sha256: 'aaa', sourceId: 'source_1' }],
      audience: { segment: 'smb' },
      brand: { revision: 3, brandId: 'brand_1' },
      project: { workspaceId: 'workspace_1', projectId: 'project_1' },
    };
    const b = await createContextSnapshot(reordered, { ...deps, idFactory: () => 'contextsnapshot_2', workspaceId: 'workspace_1' });
    assert.equal(a.hash, b.hash, 'key order must not change the hash');
  });
});

test('canonicalize sorts keys deeply but keeps array order', () => {
  assert.deepEqual(
    JSON.stringify(canonicalize({ b: 1, a: { d: 2, c: 3 } })),
    JSON.stringify({ a: { c: 3, d: 2 }, b: 1 }),
  );
  assert.deepEqual(canonicalize([3, 1, 2]), [3, 1, 2], 'array order is meaningful and must survive');
});

test('changing any pinned revision changes the hash', async () => {
  await withServices(async (_svc, store) => {
    const deps = { store, now: () => NOW, workspaceId: 'workspace_1' };
    const base = await createContextSnapshot(CTX_INPUT(), { ...deps, idFactory: () => 'contextsnapshot_base' });

    const variants = {
      source: { ...CTX_INPUT(), sourceRefs: [{ sourceId: 'source_1', sha256: 'bbb' }] },
      evidence: { ...CTX_INPUT(), evidenceRefs: [{ evidenceId: 'evidence_1', revision: 2 }] },
      jobPack: { ...CTX_INPUT(), jobPack: { id: 'job.article', version: '1.3.0' } },
      targetPack: { ...CTX_INPUT(), targetPack: { id: 'target.blog', version: '0.4.0' } },
      policy: { ...CTX_INPUT(), policy: { paid: 'PAID_ALLOWED' } },
    };
    for (const [label, input] of Object.entries(variants)) {
      // id phải chữ thường — chính kho ép luật này, test không được lách
      const v = await createContextSnapshot(input, { ...deps, idFactory: () => `contextsnapshot_${label.toLowerCase()}` });
      assert.notEqual(v.hash, base.hash, `changing ${label} must change the hash`);
    }
  });
});

test('snapshot is persisted immutably and a mid-job edit creates a new one', async () => {
  await withServices(async (_svc, store) => {
    const deps = { store, now: () => NOW, workspaceId: 'workspace_1' };
    const first = await createContextSnapshot(CTX_INPUT(), { ...deps, idFactory: () => 'contextsnapshot_1' });
    assert.equal((await store.get('contextSnapshot', 'workspace_1', 'contextsnapshot_1')).hash, first.hash);

    // rewriting the same id with different content is refused by the store
    await assert.rejects(
      () => store.put('contextSnapshot', 'workspace_1', { ...first, hash: 'tampered' }),
      (e) => e.code === 'IMMUTABLE_RECORD_CONFLICT',
    );

    // an edit during the job produces a separate snapshot; the first survives untouched
    const second = await createContextSnapshot(
      { ...CTX_INPUT(), brand: { brandId: 'brand_1', revision: 4 } },
      { ...deps, idFactory: () => 'contextsnapshot_2' },
    );
    assert.notEqual(second.hash, first.hash);
    assert.equal((await store.get('contextSnapshot', 'workspace_1', 'contextsnapshot_1')).hash, first.hash);
  });
});

test('snapshot records the refs a run must be reproducible from', async () => {
  await withServices(async (_svc, store) => {
    const snap = await createContextSnapshot(CTX_INPUT(), {
      store, now: () => NOW, idFactory: () => 'contextsnapshot_1', workspaceId: 'workspace_1',
    });
    assert.equal(snap.compiledAt, NOW);
    assert.equal(snap.jobPack.version, '1.2.0');
    assert.equal(snap.targetPack.version, '0.3.0');
    assert.deepEqual(snap.sourceRefs, [{ sourceId: 'source_1', sha256: 'aaa' }]);
    assert.deepEqual(snap.evidenceRefs, [{ evidenceId: 'evidence_1', revision: 1 }]);
    assert.equal(snap.providerPolicy.lock, null);
  });
});

// ---------------------------------------------------------------- Nghiệm thu Runtime (Task 8)
// Dựng đủ một lát cắt dữ liệu, rồi VỨT BỎ mọi đối tượng trong bộ nhớ và mở lại kho
// trên cùng thư mục. Nếu dữ liệu chỉ sống trong RAM thì bài này sẽ vỡ.
test('runtime slice survives a full restart against the same root', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'seosona-acceptance-'));
  try {
    let ids;
    let firstHash;

    // --- phiên 1: ghi ---
    {
      const store = createWorkspaceStore({ rootDir });
      const { workspaces, content } = makeHarness(store);

      const ws = await workspaces.createWorkspace({ name: 'Acceptance' });
      const brand = await workspaces.createBrand({ workspaceId: ws.workspaceId, name: 'Acme' });
      const project = await workspaces.createProject({
        workspaceId: ws.workspaceId, name: 'Launch', brandId: brand.brandId, objective: 'Grow',
      });

      const bytes = Buffer.from('<html>source of truth</html>', 'utf8');
      const source = await content.addSource({
        workspaceId: ws.workspaceId, projectId: project.projectId,
        kind: 'html', title: 'Landing', canonicalUrl: 'https://x.test/a', bytes, parserVersion: 'html@1',
      });
      const evidence = await content.addEvidence({
        workspaceId: ws.workspaceId, sourceId: source.sourceId, statement: 'Ships in 2 days', locator: { line: 12 },
      });
      const claim = await content.addClaim({
        workspaceId: ws.workspaceId, proposition: 'Delivery is fast', strength: 'ASSOCIATED', evidenceRefs: [evidence.evidenceId],
      });

      const item = await content.createContent({
        workspaceId: ws.workspaceId, projectId: project.projectId, contentJob: 'article', payload: { body: 'v1' },
      });
      await content.appendRevision({
        workspaceId: ws.workspaceId, contentId: item.contentId, operation: 'EDIT', payload: { body: 'v2' },
      });

      const snapshot = await createContextSnapshot(
        {
          project: { projectId: project.projectId },
          brand: { brandId: brand.brandId },
          sourceRefs: [{ sourceId: source.sourceId, sha256: source.sha256 }],
          evidenceRefs: [{ evidenceId: evidence.evidenceId }],
          jobPack: { id: 'job.article', version: '1.0.0' },
        },
        { store, workspaceId: ws.workspaceId, now: () => NOW, idFactory: () => 'contextsnapshot_acceptance' },
      );
      firstHash = snapshot.hash;

      ids = {
        workspaceId: ws.workspaceId, brandId: brand.brandId, projectId: project.projectId,
        sourceId: source.sourceId, sha256: source.sha256, blobRef: source.blobRef,
        evidenceId: evidence.evidenceId, claimId: claim.claimId,
        contentId: item.contentId, snapshotId: snapshot.contextSnapshotId,
      };
    }

    // --- phiên 2: mở lại kho hoàn toàn mới trên cùng thư mục ---
    {
      const store = createWorkspaceStore({ rootDir });
      const { content } = makeHarness(store);

      assert.equal((await store.get('project', ids.workspaceId, ids.projectId)).brandId, ids.brandId);
      assert.equal((await store.get('brand', ids.workspaceId, ids.brandId)).name, 'Acme');

      const source = await store.get('source', ids.workspaceId, ids.sourceId);
      assert.equal(source.sha256, ids.sha256, 'source digest must survive a restart');
      assert.deepEqual(
        await store.readBlob(ids.blobRef),
        Buffer.from('<html>source of truth</html>', 'utf8'),
        'the raw snapshot bytes must still be readable',
      );

      assert.equal((await store.get('evidence', ids.workspaceId, ids.evidenceId)).sourceId, ids.sourceId);
      assert.equal((await store.get('claim', ids.workspaceId, ids.claimId)).strength, 'ASSOCIATED');

      const history = await content.getContentHistory(ids.workspaceId, ids.contentId);
      assert.deepEqual(history.map((r) => r.payload.body), ['v1', 'v2'], 'revision lineage must survive intact');
      assert.equal(history[0].parentRevisionId, null);
      assert.equal(history[1].parentRevisionId, history[0].revisionId);

      const snapshot = await store.get('contextSnapshot', ids.workspaceId, ids.snapshotId);
      assert.equal(snapshot.hash, firstHash, 'the frozen context hash must be reproducible after restart');

      // Và sau khi khởi động lại, dữ liệu bất biến vẫn không cho ghi đè.
      await assert.rejects(
        () => store.put('revision', ids.workspaceId, { ...history[0], payload: { body: 'tampered' } }),
        (e) => e.code === 'IMMUTABLE_RECORD_CONFLICT',
      );
    }
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

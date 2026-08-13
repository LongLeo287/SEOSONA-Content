import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaceStore } from '../runtime/storage/workspace-store.mjs';
import { createWorkspaceService } from '../runtime/domain/workspace-service.mjs';
import { createContentService } from '../runtime/domain/content-service.mjs';

const NOW = '2026-08-13T00:00:00.000Z';
const WS = 'workspace_signals';

async function withServices(fn) {
  const rootDir = await mkdtemp(join(tmpdir(), 'seosona-signals-'));
  try {
    let seq = 0;
    const idFactory = (prefix) => `${String(prefix).toLowerCase()}_${++seq}`;
    const store = createWorkspaceStore({ rootDir });
    const workspaces = createWorkspaceService({ store, now: () => NOW, idFactory });
    const content = createContentService({ store, now: () => NOW, idFactory });
    await store.put('workspace', WS, { workspaceId: WS, name: 'W', createdAt: NOW });

    const brandA = await workspaces.createBrand({ workspaceId: WS, name: 'Brand A' });
    const brandB = await workspaces.createBrand({ workspaceId: WS, name: 'Brand B' });
    const projectA = await workspaces.createProject({ workspaceId: WS, name: 'A', brandId: brandA.brandId });
    const projectB = await workspaces.createProject({ workspaceId: WS, name: 'B', brandId: brandB.brandId });

    const make = async (project, contentJob) => {
      const item = await content.createContent({
        workspaceId: WS, projectId: project.projectId, contentJob,
        payload: { contentId: 'x', jobType: contentJob, fields: { title: 'T' }, claims: [] },
      });
      const history = await content.getContentHistory(WS, item.contentId);
      return { contentId: item.contentId, revisionId: history[0].revisionId };
    };

    await fn({ content, store, brandA, brandB, projectA, projectB, make });
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

test('a signal records what happened, where, and to which revision', async () => {
  await withServices(async ({ content, projectA, brandA, make }) => {
    const { contentId, revisionId } = await make(projectA, 'article');
    const signal = await content.addSignal({
      workspaceId: WS, contentId, revisionId, type: 'ACCEPT', brandId: brandA.brandId, value: null,
    });
    assert.equal(signal.type, 'ACCEPT');
    assert.equal(signal.contentId, contentId);
    assert.equal(signal.revisionId, revisionId);
    // Phạm vi lấy từ chính bản ghi: một tín hiệu không thể tự khai sai chỗ nó thuộc về.
    assert.equal(signal.projectId, projectA.projectId);
    assert.equal(signal.jobType, 'article');
    assert.equal(signal.at, NOW);
  });
});

test('only the declared signal types are accepted', async () => {
  await withServices(async ({ content, projectA, make }) => {
    const { contentId, revisionId } = await make(projectA, 'article');
    for (const type of ['ACCEPT', 'REJECT', 'MANUAL_EDIT', 'AUDIT_REPAIR', 'APPLIED_TO_PAGE', 'PROVIDER_PREFERENCE']) {
      assert.ok(await content.addSignal({ workspaceId: WS, contentId, revisionId, type }));
    }
    await assert.rejects(
      () => content.addSignal({ workspaceId: WS, contentId, revisionId, type: 'LOVED_IT' }),
      (e) => e.code === 'INVALID_SIGNAL_TYPE',
    );
  });
});

test('a signal cannot point at a revision or content that does not exist', async () => {
  await withServices(async ({ content, projectA, make }) => {
    const { contentId } = await make(projectA, 'article');
    await assert.rejects(
      () => content.addSignal({ workspaceId: WS, contentId, revisionId: 'revision_ma', type: 'ACCEPT' }),
      (e) => e.code === 'REVISION_NOT_FOUND',
    );
    await assert.rejects(
      () => content.addSignal({ workspaceId: WS, contentId: 'content_ma', type: 'ACCEPT' }),
      (e) => e.code === 'CONTENT_NOT_FOUND',
    );
  });
});

// Không có phạm vi thì một câu bị từ chối ở thương hiệu A sẽ âm thầm ảnh hưởng thương hiệu B.
test('a rejection in one brand does not reach another brand', async () => {
  await withServices(async ({ content, brandA, brandB, projectA, projectB, make }) => {
    const a = await make(projectA, 'article');
    const b = await make(projectB, 'article');
    await content.addSignal({ workspaceId: WS, ...a, type: 'REJECT', brandId: brandA.brandId, value: 'giọng quá thổi phồng' });

    const forBrandB = await content.listSignals(WS, { brandId: brandB.brandId });
    assert.equal(forBrandB.length, 0, 'brand B sees nothing that happened in brand A');

    const forContentB = await content.listSignals(WS, { contentId: b.contentId });
    assert.equal(forContentB.length, 0);

    const forBrandA = await content.listSignals(WS, { brandId: brandA.brandId });
    assert.equal(forBrandA.length, 1);
    assert.equal(forBrandA[0].value, 'giọng quá thổi phồng');
  });
});

// Một lần bấm từ chối nghĩa là "lần này không hợp", không phải "cấm vĩnh viễn cách viết này".
test('one rejection stays an observation and creates no rule', async () => {
  await withServices(async ({ content, store, projectA, brandA, make }) => {
    const a = await make(projectA, 'article');
    await content.addSignal({ workspaceId: WS, ...a, type: 'REJECT', brandId: brandA.brandId, value: 'không thích mở bài' });

    // Không có bản ghi luật nào được sinh ra, và thương hiệu không bị sửa.
    const brand = await store.get('brand', WS, brandA.brandId);
    assert.ok(!JSON.stringify(brand).includes('không thích mở bài'), 'the brand record is untouched');
    assert.deepEqual(await store.list('claim', WS), [], 'no rule-like record appeared');

    const signals = await content.listSignals(WS, { type: 'REJECT' });
    assert.equal(signals.length, 1, 'it is stored as exactly what it is: one observation');
  });
});

// Thích một hãng cho bài dài không có nghĩa là thích hãng đó cho mọi việc.
test('a provider preference is scoped to the job type it was expressed for', async () => {
  await withServices(async ({ content, projectA, make }) => {
    const article = await make(projectA, 'article');
    const product = await make(projectA, 'product');

    await content.addSignal({ workspaceId: WS, ...article, type: 'PROVIDER_PREFERENCE', providerId: 'claude-web', value: 'prefer' });
    await content.addSignal({ workspaceId: WS, ...product, type: 'PROVIDER_PREFERENCE', providerId: 'chatgpt-web', value: 'prefer' });

    const forArticles = await content.listSignals(WS, { type: 'PROVIDER_PREFERENCE', jobType: 'article' });
    assert.equal(forArticles.length, 1);
    assert.equal(forArticles[0].providerId, 'claude-web');

    const forProducts = await content.listSignals(WS, { type: 'PROVIDER_PREFERENCE', jobType: 'product' });
    assert.equal(forProducts[0].providerId, 'chatgpt-web');
  });
});

// Lịch sử phản hồi mà sửa được thì nó không còn là bằng chứng về điều đã thật sự xảy ra.
test('signals are append only through the workflow api', async () => {
  await withServices(async ({ content, projectA, make }) => {
    const a = await make(projectA, 'article');
    await content.addSignal({ workspaceId: WS, ...a, type: 'ACCEPT' });
    await content.addSignal({ workspaceId: WS, ...a, type: 'REJECT' });
    const signals = await content.listSignals(WS, { contentId: a.contentId });
    assert.equal(signals.length, 2, 'a later rejection does not erase the earlier acceptance');
    assert.deepEqual(signals.map((s) => s.type).sort(), ['ACCEPT', 'REJECT']);

    // Service không hề có đường xóa hay sửa.
    assert.equal(typeof content.updateSignal, 'undefined');
    assert.equal(typeof content.deleteSignal, 'undefined');
  });
});

test('signals from different revisions of the same content stay distinguishable', async () => {
  await withServices(async ({ content, projectA, make }) => {
    const a = await make(projectA, 'article');
    const second = await content.appendRevision({
      workspaceId: WS, contentId: a.contentId, operation: 'EDIT',
      payload: { contentId: a.contentId, jobType: 'article', fields: { title: 'T2' }, claims: [] },
    });

    await content.addSignal({ workspaceId: WS, contentId: a.contentId, revisionId: a.revisionId, type: 'REJECT' });
    await content.addSignal({ workspaceId: WS, contentId: a.contentId, revisionId: second.revisionId, type: 'ACCEPT' });

    const rejected = await content.listSignals(WS, { revisionId: a.revisionId });
    const accepted = await content.listSignals(WS, { revisionId: second.revisionId });
    assert.equal(rejected[0].type, 'REJECT');
    assert.equal(accepted[0].type, 'ACCEPT', 'the fix being accepted does not retro-approve the version that was rejected');
  });
});

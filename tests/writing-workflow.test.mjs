import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adaptToTarget, assertTargetSpec } from '../runtime/writing/target-adapter.mjs';
import { createRepurposer } from '../runtime/writing/repurpose.mjs';
import { createWriter } from '../runtime/writing/writer.mjs';
import { createJobPackRegistry } from '../runtime/writing/job-packs/registry.mjs';
import { articlePack } from '../runtime/writing/job-packs/article.mjs';
import { productPack } from '../runtime/writing/job-packs/product.mjs';
import { transcriptPack } from '../runtime/writing/job-packs/transcript.mjs';
import { createWorkspaceStore } from '../runtime/storage/workspace-store.mjs';
import { createWorkspaceService } from '../runtime/domain/workspace-service.mjs';
import { createContentService } from '../runtime/domain/content-service.mjs';

const NOW = '2026-08-13T00:00:00.000Z';
const WS = 'workspace_test';

const ARTICLE = {
  title: 'Giao hàng nhanh cho cửa hàng nhỏ',
  outline: ['Vì sao tốc độ quan trọng'],
  sections: [{ heading: 'Vì sao tốc độ quan trọng', level: 2, body: 'Khách bỏ giỏ khi chờ lâu.' }],
  body: 'Khách bỏ giỏ khi chờ lâu.',
};

const content = (fields = ARTICLE, overrides = {}) => ({
  contentId: 'content_1', jobType: 'article', fields, sourceRefs: [], claimRefs: [], ...overrides,
});

// ================================================================ Target adaptation

test('a target spec cannot smuggle in publishing or media generation', () => {
  for (const field of ['publishAt', 'schedule', 'imagePrompt', 'generateImage', 'thumbnail']) {
    assert.throws(() => assertTargetSpec({ id: 't', [field]: 'x' }), /out of scope/, field);
  }
  const ok = assertTargetSpec({ id: 'target.blog', revision: 2, fieldSet: ['metaTitle'] });
  assert.equal(ok.revision, 2);
  assert.equal(ok.outputFormat, 'text');
});

// Khuyến nghị và ràng buộc cứng là hai chuyện khác nhau. Trộn chúng lại thì người dùng
// bị chặn vì những con số chỉ là gợi ý.
test('a recommended limit warns while a hard limit blocks', () => {
  const long = content({ ...ARTICLE, metaTitle: 'x'.repeat(100) });

  const recommended = adaptToTarget({
    content: long,
    targetSpec: { id: 't', lengthRules: { metaTitle: { max: 60, hard: false } } },
  });
  assert.equal(recommended.blocked, false);
  assert.equal(recommended.issues[0].severity, 'WARN');

  const hard = adaptToTarget({ content: long, targetSpec: { id: 't', lengthRules: { metaTitle: { max: 60 } } } });
  assert.equal(hard.blocked, true);
  assert.equal(hard.issues[0].severity, 'BLOCK');
});

// Ranh giới quan trọng nhất của file này: nó KHÔNG tự cắt bài cho vừa.
test('adaptation never shortens the text by itself', () => {
  const long = content({ ...ARTICLE, metaTitle: 'x'.repeat(100) });
  const result = adaptToTarget({ content: long, targetSpec: { id: 't', lengthRules: { metaTitle: { max: 60 } } } });
  assert.equal(result.content.fields.metaTitle.length, 100, 'the text is untouched; shortening goes through the editor');
  assert.equal(result.issues[0].repairAction, 'REWRITE_SECTION');
});

test('formatting normalisation is allowed because it changes no meaning', () => {
  const messy = content({ ...ARTICLE, body: 'Dòng một   \n\n\n\nDòng hai  ' });
  const result = adaptToTarget({ content: messy, targetSpec: { id: 't', formatRules: { collapseWhitespace: true } } });
  assert.equal(result.content.fields.body, 'Dòng một\n\nDòng hai');
  assert.deepEqual(result.issues, []);
});

test('a missing required field, too many links and a missing cta all block', () => {
  const missing = adaptToTarget({ content: content(), targetSpec: { id: 't', fieldSet: ['metaDescription'] } });
  assert.equal(missing.issues[0].code, 'MISSING_TARGET_FIELD');
  assert.equal(missing.blocked, true);

  const linky = content({ ...ARTICLE, body: 'https://a.test https://b.test https://c.test' });
  const links = adaptToTarget({ content: linky, targetSpec: { id: 't', linkRules: { maxLinks: 2 } } });
  assert.equal(links.issues[0].code, 'TOO_MANY_LINKS');

  const cta = adaptToTarget({ content: content(), targetSpec: { id: 't', ctaRules: { required: true } } });
  assert.equal(cta.issues[0].code, 'MISSING_CTA');
});

test('adaptation records which target the content was shaped for', () => {
  const result = adaptToTarget({ content: content(), targetSpec: { id: 'target.newsletter' } });
  assert.equal(result.content.targetRef, 'target.newsletter');
});

// ================================================================ Repurpose

function fakeGateway(outputs) {
  const queue = Array.isArray(outputs) ? [...outputs] : [outputs];
  const tasks = [];
  return {
    tasks,
    execute: async (task, policy) => {
      tasks.push({ task, policy });
      const output = queue.length > 1 ? queue.shift() : queue[0];
      return {
        status: 'COMPLETED', output: JSON.stringify(output), providerId: 'fake-provider',
        costClass: 'ZERO_INCREMENTAL', startedAt: NOW, completedAt: NOW,
        parseStatus: 'OK', warnings: [], error: null, receipt: null,
      };
    },
  };
}

async function withRepurposer(fn, { outputs = ARTICLE } = {}) {
  const rootDir = await mkdtemp(join(tmpdir(), 'seosona-repurpose-'));
  try {
    let seq = 0;
    const idFactory = (prefix) => `${String(prefix).toLowerCase()}_${++seq}`;
    const store = createWorkspaceStore({ rootDir });
    const workspaces = createWorkspaceService({ store, now: () => NOW, idFactory });
    const contentService = createContentService({ store, now: () => NOW, idFactory });
    const packRegistry = createJobPackRegistry();
    for (const pack of [articlePack, productPack, transcriptPack]) packRegistry.registerJobPack(pack);

    await store.put('workspace', WS, { workspaceId: WS, name: 'T', createdAt: NOW });
    const project = await workspaces.createProject({ workspaceId: WS, name: 'P' });

    const gateway = fakeGateway(outputs);
    const writer = createWriter({ gateway, packRegistry, contentService, now: () => NOW, idFactory });
    const repurposer = createRepurposer({ writer, contentService, store, now: () => NOW, idFactory });

    await fn({ repurposer, writer, contentService, store, project, gateway });
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

// Transcript có lời thoại và mốc thời gian; bài blog thì không. Nên một chiều đi được,
// chiều kia là bịa ra dữ liệu không tồn tại.
test('transcript to article is a valid route and article to transcript is not', async () => {
  await withRepurposer(async ({ repurposer, contentService, project }) => {
    const seed = await contentService.createContent({
      workspaceId: WS, projectId: project.projectId, contentJob: 'transcript',
      payload: { contentId: 'seed', jobType: 'transcript', fields: { operation: 'HIGHLIGHTS' }, claims: [] },
    });
    const history = await contentService.getContentHistory(WS, seed.contentId);

    const result = await repurposer.repurpose({
      workspaceId: WS, projectId: project.projectId,
      fromContentId: seed.contentId, fromRevisionId: history[0].revisionId,
      toJobType: 'article', context: { evidenceById: {}, claimsById: {} },
    });
    assert.ok(result.content, 'transcript to article works');
    assert.equal(result.lineage.relation, 'REPURPOSED_FROM');
  });
});

test('article to transcript is refused when there is no transcript source', async () => {
  await withRepurposer(async ({ repurposer, writer, contentService, project }) => {
    const created = await writer.write({
      workspaceId: WS, projectId: project.projectId, jobType: 'article',
      brief: { objective: 'o', intent: 'i', angle: 'a' }, contextSnapshotId: 'cs_1',
      context: { evidenceById: {}, claimsById: {} },
    });
    const history = await contentService.getContentHistory(WS, created.content.contentId);

    await assert.rejects(
      () => repurposer.repurpose({
        workspaceId: WS, projectId: project.projectId,
        fromContentId: created.content.contentId, fromRevisionId: history[0].revisionId,
        toJobType: 'transcript', context: {},
      }),
      (e) => e.code === 'MISSING_SOURCE_FOR_ROUTE',
    );
  });
});

test('an unsupported route is refused by name', async () => {
  await withRepurposer(async ({ repurposer, contentService, project }) => {
    const seed = await contentService.createContent({
      workspaceId: WS, projectId: project.projectId, contentJob: 'article',
      payload: { contentId: 'seed', jobType: 'article', fields: ARTICLE, claims: [] },
    });
    const history = await contentService.getContentHistory(WS, seed.contentId);
    await assert.rejects(
      () => repurposer.repurpose({
        workspaceId: WS, projectId: project.projectId,
        fromContentId: seed.contentId, fromRevisionId: history[0].revisionId, toJobType: 'newsletter',
      }),
      (e) => e.code === 'UNSUPPORTED_REPURPOSE_ROUTE',
    );
  });
});

// Bản gốc không bao giờ bị thay: ghi đè nghĩa là bài dài biến mất khi ai đó rút nó thành
// bản tóm tắt, và thứ họ mất là bản có nhiều công sức hơn.
test('repurposing creates a new content and leaves the source untouched', async () => {
  await withRepurposer(async ({ repurposer, contentService, project }) => {
    const seed = await contentService.createContent({
      workspaceId: WS, projectId: project.projectId, contentJob: 'transcript',
      payload: { contentId: 'seed', jobType: 'transcript', fields: { operation: 'QUOTES' }, claims: [] },
    });
    const before = await contentService.getContentHistory(WS, seed.contentId);

    const result = await repurposer.repurpose({
      workspaceId: WS, projectId: project.projectId,
      fromContentId: seed.contentId, fromRevisionId: before[0].revisionId,
      toJobType: 'article', context: { evidenceById: {}, claimsById: {} },
    });

    assert.notEqual(result.content.contentId, seed.contentId, 'a new content id');
    assert.deepEqual(await contentService.getContentHistory(WS, seed.contentId), before, 'the source is byte identical');
  });
});

test('lineage is queryable from both ends', async () => {
  await withRepurposer(async ({ repurposer, contentService, project }) => {
    const seed = await contentService.createContent({
      workspaceId: WS, projectId: project.projectId, contentJob: 'transcript',
      payload: { contentId: 'seed', jobType: 'transcript', fields: { operation: 'QUOTES' }, claims: [] },
    });
    const history = await contentService.getContentHistory(WS, seed.contentId);
    const result = await repurposer.repurpose({
      workspaceId: WS, projectId: project.projectId,
      fromContentId: seed.contentId, fromRevisionId: history[0].revisionId,
      toJobType: 'article', context: { evidenceById: {}, claimsById: {} },
    });

    const fromSource = await repurposer.lineageOf(WS, seed.contentId);
    const fromDerived = await repurposer.lineageOf(WS, result.content.contentId);
    assert.equal(fromSource.length, 1);
    assert.deepEqual(fromSource, fromDerived, 'the same edge answers from either side');
    assert.equal(fromSource[0].fromJobType, 'transcript');
    assert.equal(fromSource[0].toJobType, 'article');
  });
});

// Chuyển thể không được sinh dữ kiện mới — chỉ sắp xếp lại điều đã có bằng chứng.
test('the repurpose instruction forbids adding new facts', async () => {
  await withRepurposer(async ({ repurposer, contentService, project, gateway }) => {
    const seed = await contentService.createContent({
      workspaceId: WS, projectId: project.projectId, contentJob: 'transcript',
      payload: { contentId: 'seed', jobType: 'transcript', fields: { operation: 'QUOTES' }, claims: [] },
    });
    const history = await contentService.getContentHistory(WS, seed.contentId);
    await repurposer.repurpose({
      workspaceId: WS, projectId: project.projectId,
      fromContentId: seed.contentId, fromRevisionId: history[0].revisionId,
      toJobType: 'article', context: { evidenceById: {}, claimsById: {} },
    });
    assert.match(gateway.tasks.at(-1).task.contextBundle.prompt, /Không thêm dữ kiện mới/);
  });
});

test('repurposing a revision that does not exist is refused', async () => {
  await withRepurposer(async ({ repurposer, project }) => {
    await assert.rejects(
      () => repurposer.repurpose({
        workspaceId: WS, projectId: project.projectId,
        fromContentId: 'content_ma', fromRevisionId: 'revision_ma', toJobType: 'article',
      }),
      (e) => e.code === 'REVISION_NOT_FOUND',
    );
  });
});

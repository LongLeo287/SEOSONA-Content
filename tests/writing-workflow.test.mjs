import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adaptToTarget, assertTargetSpec } from '../runtime/writing/target-adapter.mjs';
import { createRepurposer } from '../runtime/writing/repurpose.mjs';
import { createWriter } from '../runtime/writing/writer.mjs';
import { createEditor } from '../runtime/writing/editor.mjs';
import { createEvaluator } from '../runtime/writing/evaluator.mjs';
import { createWriteEditAuditWorkflow } from '../runtime/workflows/write-edit-audit.mjs';
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

// ================================================================ Workflow

const TRANSCRIPT_CUES = [
  { cueId: 'cue_0001', index: 1, startMs: 0, endMs: 1000, rawText: 'Câu một.' },
  { cueId: 'cue_0002', index: 2, startMs: 1000, endMs: 2000, rawText: 'Câu hai.' },
];

const PRODUCT_FACTS = [{ factId: 'f1', name: 'Khối lượng', value: '1', unit: 'kg', sourceRef: 's1', locator: { row: 1 } }];

const OUTPUT_BY_JOB = {
  article: ARTICLE,
  product: {
    title: 'Đèn bàn', longDescription: 'Đèn nhôm.',
    specs: [{ name: 'Khối lượng', value: '1', unit: 'kg', factRef: 'f1' }],
    features: [{ text: 'Nhẹ', factRef: 'f1' }], benefits: [],
  },
  transcript: {
    operation: 'SHORT_CUT',
    selections: [{ cueIds: ['cue_0001'], sourceStartMs: 0, sourceEndMs: 1000, rawTranscript: 'Câu một.' }],
  },
};

const auditPass = JSON.stringify({ dimension: 'x', verdict: 'PASS', findings: [] });

// Gateway giả cho workflow: WRITE trả bản thảo theo loại nội dung, AUDIT trả phán quyết.
function workflowGateway({ write = null, audit = auditPass, failFirstWrite = false } = {}) {
  const tasks = [];
  let writes = 0;
  return {
    tasks,
    execute: async (task, policy) => {
      tasks.push({ task, policy });
      const base = { providerId: 'fake', costClass: 'ZERO_INCREMENTAL', startedAt: NOW, completedAt: NOW, parseStatus: 'OK', warnings: [], receipt: null, attemptId: `providerattempt_${tasks.length}` };
      if (task.taskType === 'AUDIT') return { ...base, status: 'COMPLETED', output: audit, error: null };
      writes += 1;
      if (failFirstWrite && writes === 1) {
        return { ...base, status: 'FAILED', output: null, parseStatus: 'NOT_APPLICABLE', error: { code: 'TIMEOUT', message: 'hết giờ', retryable: true } };
      }
      return { ...base, status: 'COMPLETED', output: JSON.stringify(write || OUTPUT_BY_JOB[task.contentJob]), error: null };
    },
  };
}

async function withWorkflow(fn, options = {}) {
  const rootDir = await mkdtemp(join(tmpdir(), 'seosona-workflow-'));
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

    const gateway = options.gateway || workflowGateway();
    const writer = createWriter({ gateway, packRegistry, contentService, now: () => NOW, idFactory });
    const editor = createEditor({ gateway, packRegistry, contentService, now: () => NOW, idFactory });
    const evaluator = createEvaluator({ gateway, packRegistry, contentService, now: () => NOW, idFactory });
    const workflow = createWriteEditAuditWorkflow({
      writer, editor, evaluator, packRegistry, contentService, store,
      workspaceId: WS, now: () => NOW, idFactory,
    });

    await fn({ workflow, gateway, contentService, store, project, packRegistry, writer, editor, evaluator, idFactory, rootDir });
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

const jobRequest = (overrides = {}) => ({
  workspaceId: WS,
  jobType: 'article',
  brief: { objective: 'Giải thích tốc độ giao hàng', intent: 'INFORMATIONAL', angle: 'thực dụng' },
  contextSnapshotId: 'contextsnapshot_1',
  context: { evidenceById: {}, claimsById: {} },
  ...overrides,
});

test('the happy path runs project to content to revision to audit to completed', async () => {
  await withWorkflow(async ({ workflow, project, contentService }) => {
    const result = await workflow.start({ ...jobRequest(), projectId: project.projectId });
    assert.equal(result.status, 'completed');
    assert.ok(result.contentId);
    assert.ok(result.revisionId);
    assert.ok(result.evaluationIds.length >= 1);

    const history = await contentService.getContentHistory(WS, result.contentId);
    assert.equal(history.length, 1);
    const evaluations = await contentService.listEvaluations(WS, result.revisionId);
    assert.equal(evaluations.length, articlePack.requiredEvaluators.length);
  });
});

// Trạng thái job là sổ theo dõi, không phải kho lưu bài viết.
test('job state holds references only, never prompts or content', async () => {
  await withWorkflow(async ({ workflow, project, store }) => {
    const result = await workflow.start({ ...jobRequest(), projectId: project.projectId });
    const stored = await store.get('job', WS, result.jobId);
    const serialized = JSON.stringify(stored);
    assert.ok(!serialized.includes('CORE_RULES'), 'no prompt body');
    assert.ok(!serialized.includes(ARTICLE.body), 'no article text');
    assert.ok(serialized.includes(result.contentId), 'but the reference is there');
    assert.ok(stored.checkpoints.WRITE.attemptId, 'and the provider attempt is traceable');
  });
});

test('every stage leaves a checkpoint before the next one starts', async () => {
  await withWorkflow(async ({ workflow, project }) => {
    const result = await workflow.start({ ...jobRequest(), projectId: project.projectId });
    assert.deepEqual(Object.keys(result.checkpoints), ['BRIEF', 'WRITE', 'DETERMINISTIC_VALIDATE', 'AUDIT']);
  });
});

// Khâu đắt nhất cũng là khâu dễ đứt nhất: chạy lại không được viết lại bài đã viết xong.
test('resuming a job does not repeat the stages that already succeeded', async () => {
  const gateway = workflowGateway();
  await withWorkflow(async ({ workflow, project }) => {
    const first = await workflow.start({ ...jobRequest(), projectId: project.projectId });
    const callsAfterFirst = gateway.tasks.length;

    const resumed = await workflow.resume(WS, first.jobId);
    assert.equal(resumed.status, 'completed');
    assert.equal(resumed.contentId, first.contentId, 'the same content, not a second one');
    assert.equal(gateway.tasks.length, callsAfterFirst, 'no provider run was repeated');
  }, { gateway });
});

test('a job resumes from its persisted checkpoint after a restart', async () => {
  await withWorkflow(async ({ workflow, project, store, contentService, packRegistry, idFactory }) => {
    const first = await workflow.start({ ...jobRequest(), projectId: project.projectId });

    // Tiến trình mới: không còn gì trong bộ nhớ, chỉ còn những gì đã ghi xuống đĩa.
    const gateway = workflowGateway();
    const revived = createWriteEditAuditWorkflow({
      writer: createWriter({ gateway, packRegistry, contentService, now: () => NOW, idFactory }),
      evaluator: createEvaluator({ gateway, packRegistry, contentService, now: () => NOW, idFactory }),
      packRegistry, contentService, store, workspaceId: WS, now: () => NOW, idFactory,
    });

    const resumed = await revived.resume(WS, first.jobId);
    assert.equal(resumed.contentId, first.contentId);
    assert.equal(gateway.tasks.length, 0, 'a completed job costs nothing to resume');
  });
});

test('a provider failure fails the job with the real reason and stops there', async () => {
  const gateway = workflowGateway({ failFirstWrite: true });
  await withWorkflow(async ({ workflow, project, store }) => {
    const result = await workflow.start({ ...jobRequest(), projectId: project.projectId });
    assert.equal(result.status, 'failed');
    assert.equal(result.outcome.error.code, 'PROVIDER_FAILED');
    assert.equal(result.contentId, null, 'nothing was persisted as content');

    const stored = await store.get('job', WS, result.jobId);
    assert.equal(stored.status, 'failed');
    assert.equal(stored.checkpoints.WRITE, undefined, 'the failed stage has no checkpoint');
  }, { gateway });
});

// Sau khi provider hỏng, chạy lại phải làm lại đúng khâu đó — chứ không nhảy qua.
test('a failed job resumes by retrying the stage that failed', async () => {
  const gateway = workflowGateway({ failFirstWrite: true });
  await withWorkflow(async ({ workflow, project }) => {
    const failed = await workflow.start({ ...jobRequest(), projectId: project.projectId });
    assert.equal(failed.status, 'failed');

    const resumed = await workflow.resume(WS, failed.jobId);
    assert.equal(resumed.status, 'completed', 'the second attempt gets through');
    assert.ok(resumed.contentId);
  }, { gateway });
});

test('an invalid draft fails deterministic validation instead of being audited', async () => {
  const gateway = workflowGateway({ write: { ...ARTICLE, title: '' } });
  await withWorkflow(async ({ workflow, project }) => {
    const result = await workflow.start({ ...jobRequest(), projectId: project.projectId });
    assert.equal(result.status, 'failed');
    assert.equal(result.checkpoints.AUDIT, undefined, 'a broken draft is never sent to the auditor');
  }, { gateway });
});

// Đánh giá đòi người xem thì job KHÔNG được đóng lại thành "xong".
test('an audit that requires review leaves the job unfinished', async () => {
  const gateway = workflowGateway({ audit: JSON.stringify({ dimension: 'brand', verdict: 'REVIEW', findings: [{ code: 'TONE', message: 'cần xem lại', repairAction: 'HUMAN_REVIEW' }] }) });
  await withWorkflow(async ({ workflow, project }) => {
    const result = await workflow.start({ ...jobRequest(), projectId: project.projectId });
    assert.equal(result.status, 'failed');
    assert.equal(result.outcome.error.code, 'DEFINITION_OF_DONE_UNMET');
    assert.ok(result.outcome.blocking.some((b) => b.code === 'HUMAN_REVIEW_REQUIRED'));
    assert.ok(result.contentId, 'the draft still exists for the human to look at');
  }, { gateway });
});

test('a cancelled job stops and refuses to be resumed', async () => {
  const gateway = workflowGateway({ failFirstWrite: true });
  await withWorkflow(async ({ workflow, project }) => {
    const started = await workflow.start({ ...jobRequest(), projectId: project.projectId });
    assert.equal(started.status, 'failed', 'it is still open, so it can be cancelled');

    const cancelled = await workflow.cancel(WS, started.jobId, 'user changed their mind');
    assert.equal(cancelled.status, 'cancelled');
    await assert.rejects(() => workflow.resume(WS, started.jobId), (e) => e.code === 'JOB_CANCELLED');
  }, { gateway });
});

// Việc đã xong thì không huỷ được nữa — huỷ một thứ đã hoàn tất chỉ làm sổ sách nói sai.
test('a completed job can no longer be cancelled', async () => {
  await withWorkflow(async ({ workflow, project }) => {
    const done = await workflow.start({ ...jobRequest(), projectId: project.projectId });
    assert.equal(done.status, 'completed');
    await assert.rejects(() => workflow.cancel(WS, done.jobId), /terminal state/);
  });
});

test('resuming a job that was never started is an error, not a silent no-op', async () => {
  await withWorkflow(async ({ workflow }) => {
    await assert.rejects(() => workflow.resume(WS, 'job_ma'), (e) => e.code === 'JOB_NOT_FOUND');
  });
});

// Khóa hãng cho khâu đánh giá là chuyện có thật: người viết dùng hãng này, người chấm hãng khác.
test('the audit stage can be locked to a different provider than the writer', async () => {
  const gateway = workflowGateway();
  await withWorkflow(async ({ workflow, project }) => {
    await workflow.start({
      ...jobRequest(), projectId: project.projectId,
      providerPolicy: { manualLocks: { run: 'chatgpt-web' } },
      auditProviderPolicy: { manualLocks: { run: 'api-v1' } },
    });
    const write = gateway.tasks.find((t) => t.task.taskType === 'WRITE');
    const audit = gateway.tasks.find((t) => t.task.taskType === 'AUDIT');
    assert.deepEqual(write.policy.manualLocks, { run: 'chatgpt-web' });
    assert.deepEqual(audit.policy.manualLocks, { run: 'api-v1' });
  }, { gateway });
});

test('a hard target constraint stops completion rather than trimming the text', async () => {
  await withWorkflow(async ({ workflow, project }) => {
    const result = await workflow.start({
      ...jobRequest(), projectId: project.projectId,
      targetSpec: { id: 'target.tight', lengthRules: { body: { max: 5 } } },
    });
    assert.equal(result.status, 'failed');
    assert.equal(result.outcome.error.code, 'TARGET_LENGTH_EXCEEDED');
  });
});

// Cùng một quy trình chạy cả ba loại nội dung: chỉ pack, schema và bộ đánh giá là khác.
test('one workflow runs article, product and transcript alike', async () => {
  for (const [jobType, context] of [
    ['article', { evidenceById: {}, claimsById: {} }],
    ['product', { productFacts: PRODUCT_FACTS, evidenceById: {} }],
    ['transcript', { transcript: { sourceId: 's_video', cues: TRANSCRIPT_CUES, durationMs: 2000 } }],
  ]) {
    await withWorkflow(async ({ workflow, project }) => {
      const result = await workflow.start({
        ...jobRequest(),
        projectId: project.projectId,
        jobType,
        brief: { objective: 'o', intent: 'i', angle: 'a' },
        context,
      });
      assert.equal(result.status, 'completed', `${jobType} should complete`);
      assert.ok(result.contentId, jobType);
    });
  }
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

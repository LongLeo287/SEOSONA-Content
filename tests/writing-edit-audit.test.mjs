import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWriter } from '../runtime/writing/writer.mjs';
import { createEditor } from '../runtime/writing/editor.mjs';
import { createEvaluator } from '../runtime/writing/evaluator.mjs';
import { createJobPackRegistry } from '../runtime/writing/job-packs/registry.mjs';
import { articlePack } from '../runtime/writing/job-packs/article.mjs';
import { productPack } from '../runtime/writing/job-packs/product.mjs';
import { createWorkspaceStore } from '../runtime/storage/workspace-store.mjs';
import { createWorkspaceService } from '../runtime/domain/workspace-service.mjs';
import { createContentService } from '../runtime/domain/content-service.mjs';

const NOW = '2026-08-13T00:00:00.000Z';
const WS = 'workspace_test';

const ARTICLE_OUTPUT = {
  title: 'Giao hàng nhanh cho cửa hàng nhỏ',
  outline: ['Vì sao tốc độ quan trọng'],
  sections: [{ heading: 'Vì sao tốc độ quan trọng', level: 2, body: 'Khách bỏ giỏ khi chờ lâu.', evidenceRefs: ['e1'] }],
  body: 'Khách bỏ giỏ khi chờ lâu.',
};

const PRODUCT_OUTPUT = {
  title: 'Đèn bàn Aurora',
  longDescription: 'Đèn bàn nhôm.',
  specs: [{ name: 'Khối lượng', value: '1', unit: 'kg', factRef: 'f_weight' }],
  features: [{ text: 'Vỏ nhôm', factRef: 'f_material' }],
  benefits: [],
};

const PRODUCT_FACTS = [
  { factId: 'f_weight', name: 'Khối lượng', value: '1', unit: 'kg', sourceRef: 's1', locator: { row: 1 } },
  { factId: 'f_material', name: 'Chất liệu', value: 'nhôm', sourceRef: 's1', locator: { row: 2 } },
];

const EVIDENCE = {
  e1: { evidenceId: 'e1', sourceId: 's1', type: 'FACT', text: 'Khách bỏ giỏ khi chờ lâu.', locator: { line: 1 }, relation: 'SUPPORTS' },
};

// Gateway giả: ghi lại ProviderTask nhận được và trả về đầu ra đã khai báo sẵn.
function fakeGateway(outcomes) {
  const tasks = [];
  const queue = Array.isArray(outcomes) ? [...outcomes] : [outcomes];
  return {
    tasks,
    execute: async (task, policy) => {
      tasks.push({ task, policy });
      const outcome = queue.length > 1 ? queue.shift() : queue[0];
      if (outcome.status && outcome.status !== 'COMPLETED') {
        return {
          status: outcome.status, output: null, providerId: outcome.providerId || 'fake-provider',
          costClass: 'ZERO_INCREMENTAL', startedAt: NOW, completedAt: NOW, parseStatus: 'NOT_APPLICABLE',
          warnings: [], error: outcome.error, receipt: null, attemptId: 'providerattempt_1',
        };
      }
      return {
        status: 'COMPLETED',
        output: typeof outcome.output === 'string' ? outcome.output : JSON.stringify(outcome.output),
        providerId: outcome.providerId || 'fake-provider',
        costClass: 'ZERO_INCREMENTAL', startedAt: NOW, completedAt: NOW, parseStatus: 'OK',
        warnings: [], error: null, receipt: null, attemptId: 'providerattempt_1',
      };
    },
  };
}

async function harness(fn, { gateway } = {}) {
  const rootDir = await mkdtemp(join(tmpdir(), 'seosona-writer-'));
  try {
    let seq = 0;
    const idFactory = (prefix) => `${String(prefix).toLowerCase()}_${++seq}`;
    const store = createWorkspaceStore({ rootDir });
    const workspaces = createWorkspaceService({ store, now: () => NOW, idFactory });
    const contentService = createContentService({ store, now: () => NOW, idFactory });
    const packRegistry = createJobPackRegistry();
    packRegistry.registerJobPack(articlePack);
    packRegistry.registerJobPack(productPack);

    await workspaces.createWorkspace({ name: 'T', workspaceId: WS });
    await store.put('workspace', WS, { workspaceId: WS, name: 'T', createdAt: NOW });
    const project = await workspaces.createProject({ workspaceId: WS, name: 'P' });

    const writer = createWriter({
      gateway: gateway || fakeGateway({ output: ARTICLE_OUTPUT }),
      packRegistry, contentService, now: () => NOW, idFactory,
    });
    const editor = createEditor({
      gateway: gateway || fakeGateway({ output: ARTICLE_OUTPUT }),
      packRegistry, contentService, now: () => NOW, idFactory,
    });

    await fn({ writer, editor, contentService, store, project, packRegistry });
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

const writeRequest = (overrides = {}) => ({
  workspaceId: WS,
  jobType: 'article',
  brief: { objective: 'Giải thích tốc độ giao hàng', intent: 'INFORMATIONAL', angle: 'thực dụng' },
  contextSnapshotId: 'contextsnapshot_1',
  evidence: Object.values(EVIDENCE),
  context: { evidenceById: EVIDENCE, claimsById: {} },
  ...overrides,
});

// ================================================================ Writer

test('writing produces content, a first revision and the provider result', async () => {
  await harness(async ({ writer, contentService, project }) => {
    const result = await writer.write({ ...writeRequest(), projectId: project.projectId });
    assert.equal(result.providerResult.status, 'COMPLETED');
    assert.equal(result.content.fields.title, ARTICLE_OUTPUT.title);
    assert.ok(result.revision.revisionId);
    assert.deepEqual(result.issues, []);

    const history = await contentService.getContentHistory(WS, result.content.contentId);
    assert.equal(history.length, 1);
    assert.equal(history[0].operation, 'CREATE');
  });
});

// Cùng một hình dạng ProviderTask cho mọi loại nội dung. Writer không có nhánh nào theo pack.
test('article and product send the same task shape with different job contracts', async () => {
  const gateway = fakeGateway([{ output: ARTICLE_OUTPUT }, { output: PRODUCT_OUTPUT }]);
  await harness(async ({ writer, project }) => {
    await writer.write({ ...writeRequest(), projectId: project.projectId });
    await writer.write({
      ...writeRequest(),
      projectId: project.projectId,
      jobType: 'product',
      brief: { objective: 'Mô tả đèn bàn', intent: 'TRANSACTIONAL' },
      context: { productFacts: PRODUCT_FACTS, evidenceById: {} },
    });

    const [article, product] = gateway.tasks.map((t) => t.task);
    assert.deepEqual(Object.keys(article).sort(), Object.keys(product).sort(), 'one task shape');
    assert.equal(article.contentJob, 'article');
    assert.equal(product.contentJob, 'product');
    assert.notDeepEqual(article.outputContract, product.outputContract, 'only the contract differs');
    assert.equal(article.taskType, 'WRITE');
  }, { gateway });
});

test('the writer never names a provider itself', async () => {
  const gateway = fakeGateway({ output: ARTICLE_OUTPUT, providerId: 'api-fake' });
  await harness(async ({ writer, project }) => {
    const result = await writer.write({ ...writeRequest(), projectId: project.projectId });
    assert.equal(result.providerResult.providerId, 'api-fake', 'whoever ran it, the content is the same shape');
    assert.equal(gateway.tasks[0].task.providerPreference, null, 'no vendor is pinned by the writer');
    assert.equal(result.content.jobType, 'article');
  }, { gateway });
});

test('a manual provider lock is passed through as policy, not baked into the task', async () => {
  const gateway = fakeGateway({ output: ARTICLE_OUTPUT });
  await harness(async ({ writer, project }) => {
    await writer.write({
      ...writeRequest(), projectId: project.projectId,
      providerPolicy: { manualLocks: { run: 'claude-web' } },
    });
    assert.deepEqual(gateway.tasks[0].policy.manualLocks, { run: 'claude-web' });
  }, { gateway });
});

// Đầu ra hỏng KHÔNG được lưu thành nội dung đã duyệt. Lưu nó rồi sửa sau nghe thì tiện,
// nhưng bản nháp hỏng sẽ nằm lẫn với bản tốt và không ai phân biệt được nữa.
test('unparseable provider output is reported and never persisted', async () => {
  const gateway = fakeGateway({ output: 'đây không phải JSON' });
  await harness(async ({ writer, contentService, project }) => {
    const result = await writer.write({ ...writeRequest(), projectId: project.projectId });
    assert.equal(result.content, null);
    assert.equal(result.issues[0].code, 'INVALID_PROVIDER_OUTPUT');
    assert.deepEqual(await contentService.listContent?.(WS) ?? [], []);
  }, { gateway });
});

test('a draft that fails deterministic validation is not persisted either', async () => {
  const gateway = fakeGateway({ output: { ...ARTICLE_OUTPUT, title: '' } });
  await harness(async ({ writer, project }) => {
    const result = await writer.write({ ...writeRequest(), projectId: project.projectId });
    assert.equal(result.content, null);
    assert.ok(result.issues.some((i) => i.code === 'MISSING_REQUIRED_FIELD'));
  }, { gateway });
});

test('a provider failure surfaces as a failure, not as an empty article', async () => {
  const gateway = fakeGateway({ status: 'FAILED', error: { code: 'RATE_LIMITED', message: 'hết lượt', retryable: true } });
  await harness(async ({ writer, project }) => {
    const result = await writer.write({ ...writeRequest(), projectId: project.projectId });
    assert.equal(result.content, null);
    assert.equal(result.issues[0].code, 'PROVIDER_FAILED');
    assert.equal(result.providerResult.error.code, 'RATE_LIMITED');
  }, { gateway });
});

test('an unknown job type fails before any provider is called', async () => {
  const gateway = fakeGateway({ output: ARTICLE_OUTPUT });
  await harness(async ({ writer, project }) => {
    await assert.rejects(
      () => writer.write({ ...writeRequest(), projectId: project.projectId, jobType: 'podcast' }),
      (e) => e.code === 'UNKNOWN_JOB_TYPE',
    );
    assert.equal(gateway.tasks.length, 0);
  }, { gateway });
});

test('an incomplete brief fails before any provider is called', async () => {
  const gateway = fakeGateway({ output: ARTICLE_OUTPUT });
  await harness(async ({ writer, project }) => {
    await assert.rejects(
      () => writer.write({ ...writeRequest(), projectId: project.projectId, brief: { objective: 'x' } }),
      /intent/,
    );
    assert.equal(gateway.tasks.length, 0, 'a bad brief must not cost a provider run');
  }, { gateway });
});

// Bối cảnh đã đóng băng đi cùng task, để bản viết ra truy được về đúng bộ dữ liệu đã dùng.
test('the frozen context id travels with the task', async () => {
  const gateway = fakeGateway({ output: ARTICLE_OUTPUT });
  await harness(async ({ writer, project }) => {
    await writer.write({ ...writeRequest(), projectId: project.projectId, contextSnapshotId: 'contextsnapshot_abc' });
    assert.equal(gateway.tasks[0].task.contextSnapshotId, 'contextsnapshot_abc');
  }, { gateway });
});

// ================================================================ Editor

async function seeded(fn, gateway) {
  await harness(async (ctx) => {
    const created = await ctx.writer.write({ ...writeRequest(), projectId: ctx.project.projectId });
    await fn({ ...ctx, created });
  }, { gateway });
}

test('an edit appends a revision and never overwrites the previous one', async () => {
  const edited = { ...ARTICLE_OUTPUT, body: 'Khách bỏ giỏ khi chờ lâu. Rút ngắn xuống hai ngày.' };
  const gateway = fakeGateway([{ output: ARTICLE_OUTPUT }, { output: edited }]);
  await seeded(async ({ editor, contentService, created }) => {
    const result = await editor.edit({
      workspaceId: WS, contentId: created.content.contentId, revisionId: created.revision.revisionId,
      operation: 'SHORTEN', context: { evidenceById: EVIDENCE, claimsById: {} },
    });
    assert.deepEqual(result.issues, []);

    const history = await contentService.getContentHistory(WS, created.content.contentId);
    assert.equal(history.length, 2);
    assert.equal(history[0].payload.fields.body, ARTICLE_OUTPUT.body, 'the first revision is untouched');
    assert.equal(history[1].payload.fields.body, edited.body);
    assert.equal(history[1].parentRevisionId, history[0].revisionId);
  }, gateway);
});

test('the edit operation must be one the editor knows', async () => {
  const gateway = fakeGateway([{ output: ARTICLE_OUTPUT }, { output: ARTICLE_OUTPUT }]);
  await seeded(async ({ editor, created }) => {
    await assert.rejects(
      () => editor.edit({
        workspaceId: WS, contentId: created.content.contentId, revisionId: created.revision.revisionId,
        operation: 'MAKE_IT_POP',
      }),
      /operation/,
    );
  }, gateway);
});

test('editing a revision that does not exist is refused', async () => {
  const gateway = fakeGateway([{ output: ARTICLE_OUTPUT }, { output: ARTICLE_OUTPUT }]);
  await seeded(async ({ editor, created }) => {
    await assert.rejects(
      () => editor.edit({
        workspaceId: WS, contentId: created.content.contentId, revisionId: 'revision_khong_co', operation: 'SHORTEN',
      }),
      (e) => e.code === 'REVISION_NOT_FOUND',
    );
  }, gateway);
});

// Ràng buộc trung tâm của Editor: sửa văn không được nâng mức khẳng định.
test('a rewrite that turns "may help" into "guarantees" is blocked', async () => {
  const before = {
    ...ARTICLE_OUTPUT,
    claims: [{ claimId: 'c1', proposition: 'Giao nhanh có thể giúp giữ khách.', type: 'CLAIM', strength: 'QUALIFIED', evidenceRefs: ['e1'] }],
  };
  const after = {
    ...ARTICLE_OUTPUT,
    claims: [{ claimId: 'c1', proposition: 'Giao nhanh bảo đảm giữ được khách.', type: 'CLAIM', strength: 'ABSOLUTE', evidenceRefs: ['e1'] }],
  };
  const gateway = fakeGateway([{ output: before }, { output: after }]);
  await seeded(async ({ editor, contentService, created }) => {
    const result = await editor.edit({
      workspaceId: WS, contentId: created.content.contentId, revisionId: created.revision.revisionId,
      operation: 'PROFESSIONALIZE', context: { evidenceById: EVIDENCE, claimsById: {} },
    });
    assert.equal(result.issues[0].code, 'CLAIM_STRENGTH_INCREASE_UNSUPPORTED');
    assert.equal(result.revision, null, 'a claim inflation is not saved as an improvement');
    assert.equal((await contentService.getContentHistory(WS, created.content.contentId)).length, 1);
  }, gateway);
});

test('the same rewrite passes once new supporting evidence exists', async () => {
  const before = {
    ...ARTICLE_OUTPUT,
    claims: [{ claimId: 'c1', proposition: 'Giao nhanh có thể giúp giữ khách.', type: 'CLAIM', strength: 'QUALIFIED', evidenceRefs: ['e1'] }],
  };
  const after = {
    ...ARTICLE_OUTPUT,
    claims: [{ claimId: 'c1', proposition: 'Giao nhanh giúp giữ khách.', type: 'CLAIM', strength: 'DIRECT', evidenceRefs: ['e1', 'e2'] }],
  };
  const gateway = fakeGateway([{ output: before }, { output: after }]);
  await seeded(async ({ editor, created }) => {
    const result = await editor.edit({
      workspaceId: WS, contentId: created.content.contentId, revisionId: created.revision.revisionId,
      operation: 'PROFESSIONALIZE',
      context: {
        evidenceById: { ...EVIDENCE, e2: { evidenceId: 'e2', sourceId: 's2', type: 'STATISTIC', text: 'Giữ chân tăng 12%.', locator: { line: 4 }, relation: 'SUPPORTS' } },
        claimsById: {},
      },
    });
    assert.deepEqual(result.issues, []);
    assert.ok(result.revision, 'evidence is exactly what licenses a firmer sentence');
  }, gateway);
});

// Trường có nguồn sự thật thì thao tác sửa văn chung không được đụng vào.
test('a generic edit cannot change an authoritative product number', async () => {
  const tampered = { ...PRODUCT_OUTPUT, specs: [{ name: 'Khối lượng', value: '0.8', unit: 'kg', factRef: 'f_weight' }] };
  const gateway = fakeGateway([{ output: PRODUCT_OUTPUT }, { output: tampered }]);
  await harness(async ({ writer, editor, contentService, project }) => {
    const created = await writer.write({
      ...writeRequest(), projectId: project.projectId, jobType: 'product',
      brief: { objective: 'Mô tả đèn bàn', intent: 'TRANSACTIONAL' },
      context: { productFacts: PRODUCT_FACTS, evidenceById: {} },
    });

    const result = await editor.edit({
      workspaceId: WS, contentId: created.content.contentId, revisionId: created.revision.revisionId,
      operation: 'SIMPLIFY', context: { productFacts: PRODUCT_FACTS, evidenceById: {} },
    });

    assert.ok(result.issues.some((i) => i.code === 'AUTHORITATIVE_FIELD_RESTORED'));
    // Bản sửa vẫn được lưu, nhưng con số đã bị trả về giá trị gốc — người dùng vẫn có bản
    // văn mượt hơn mà không mất dữ kiện đúng.
    const history = await contentService.getContentHistory(WS, created.content.contentId);
    assert.equal(history.at(-1).payload.fields.specs[0].value, '1');
  }, { gateway });
});

// ================================================================ Evaluator

const auditOutput = (verdict, findings = []) => JSON.stringify({ dimension: 'brand', verdict, findings });

async function withEvaluator(fn, { writeGateway, auditGateway } = {}) {
  const write = writeGateway || fakeGateway({ output: ARTICLE_OUTPUT });
  await harness(async (ctx) => {
    const created = await ctx.writer.write({ ...writeRequest(), projectId: ctx.project.projectId });
    const evaluator = createEvaluator({
      gateway: auditGateway || fakeGateway({ output: auditOutput('PASS') }),
      packRegistry: ctx.packRegistry, contentService: ctx.contentService,
      now: () => NOW, idFactory: (p) => `${p}_ev_${Math.random().toString(36).slice(2, 8)}`,
    });
    await fn({ ...ctx, created, evaluator });
  }, { gateway: write });
}

// Người viết và người chấm là hai hãng khác nhau — cùng một model thì cùng một điểm mù.
test('the auditor can run on a different provider than the writer', async () => {
  const writeGateway = fakeGateway({ output: ARTICLE_OUTPUT, providerId: 'chatgpt-web' });
  const auditGateway = fakeGateway({ output: auditOutput('PASS'), providerId: 'api-v1' });
  await withEvaluator(async ({ created, evaluator }) => {
    const results = await evaluator.evaluate({
      workspaceId: WS, contentId: created.content.contentId, revisionId: created.revision.revisionId,
      evaluatorSet: ['brand'], context: { evidenceById: EVIDENCE },
    });
    assert.equal(results[0].evaluatorId, 'provider:api-v1');
    assert.equal(writeGateway.tasks[0].task.taskType, 'WRITE');
    assert.equal(auditGateway.tasks[0].task.taskType, 'AUDIT');
  }, { writeGateway, auditGateway });
});

// Người chấm chỉ được thấy bản ĐÃ LƯU, không thấy quá trình của người viết.
test('the evaluator reads the persisted revision, not the writer state', async () => {
  const auditGateway = fakeGateway({ output: auditOutput('PASS') });
  await withEvaluator(async ({ created, evaluator }) => {
    await evaluator.evaluate({
      workspaceId: WS, contentId: created.content.contentId, revisionId: created.revision.revisionId,
      evaluatorSet: ['brand'], context: { evidenceById: EVIDENCE },
    });
    const prompt = auditGateway.tasks[0].task.contextBundle.prompt;
    assert.ok(prompt.includes(ARTICLE_OUTPUT.title), 'it sees the saved draft');
    assert.ok(!prompt.includes('providerattempt'), 'it does not see the writer run');
    assert.ok(prompt.includes('ĐÁNH GIÁ'));
  }, { auditGateway });
});

test('evaluating a revision that does not exist is refused', async () => {
  await withEvaluator(async ({ created, evaluator }) => {
    await assert.rejects(
      () => evaluator.evaluate({ workspaceId: WS, contentId: created.content.contentId, revisionId: 'revision_ma' }),
      (e) => e.code === 'REVISION_NOT_FOUND',
    );
  });
});

// Bài kiểm tất định chạy trước, và nếu nó đã chặn thì không tốn thêm một lượt provider nào.
test('deterministic checks run first and a block skips the model evaluators', async () => {
  const auditGateway = fakeGateway({ output: auditOutput('PASS') });
  await withEvaluator(async ({ created, evaluator, contentService }) => {
    // Bản thảo nói tới một luận điểm không có bằng chứng nào.
    await contentService.appendRevision({
      workspaceId: WS, contentId: created.content.contentId, operation: 'EDIT',
      payload: {
        contentId: created.content.contentId, jobType: 'article', fields: ARTICLE_OUTPUT,
        claims: [{ claimId: 'c1', proposition: 'Giao nhanh tăng doanh thu gấp đôi.', type: 'CLAIM', strength: 'ABSOLUTE', evidenceRefs: [] }],
      },
    });
    const history = await contentService.getContentHistory(WS, created.content.contentId);

    const results = await evaluator.evaluate({
      workspaceId: WS, contentId: created.content.contentId, revisionId: history.at(-1).revisionId,
      evaluatorSet: ['claim-support', 'brand'], context: { evidenceById: EVIDENCE },
    });

    const claimSupport = results.find((r) => r.dimension === 'claim-support');
    assert.equal(claimSupport.verdict, 'BLOCK');
    assert.equal(claimSupport.findings[0].code, 'CLAIM_UNSUPPORTED');
    assert.equal(claimSupport.evaluatorId, 'deterministic:claim-support');

    const brand = results.find((r) => r.dimension === 'brand');
    assert.equal(brand.verdict, 'REVIEW');
    assert.equal(brand.findings[0].code, 'EVALUATION_SKIPPED');
    assert.equal(auditGateway.tasks.length, 0, 'no provider run is spent on a draft already known to be broken');
  }, { auditGateway });
});

// Đánh giá không chạy được KHÔNG phải là đạt.
test('an evaluator that fails to answer yields REVIEW, never PASS', async () => {
  const auditGateway = fakeGateway({ status: 'FAILED', error: { code: 'TIMEOUT', message: 'hết giờ', retryable: true } });
  await withEvaluator(async ({ created, evaluator }) => {
    const results = await evaluator.evaluate({
      workspaceId: WS, contentId: created.content.contentId, revisionId: created.revision.revisionId,
      evaluatorSet: ['brand'], context: { evidenceById: EVIDENCE },
    });
    assert.equal(results[0].verdict, 'REVIEW');
    assert.equal(results[0].findings[0].code, 'EVALUATION_UNAVAILABLE');
  }, { auditGateway });
});

test('an unparseable verdict is REVIEW, not silently ignored', async () => {
  const auditGateway = fakeGateway({ output: 'bài này ổn đấy' });
  await withEvaluator(async ({ created, evaluator }) => {
    const results = await evaluator.evaluate({
      workspaceId: WS, contentId: created.content.contentId, revisionId: created.revision.revisionId,
      evaluatorSet: ['brand'], context: { evidenceById: EVIDENCE },
    });
    assert.equal(results[0].verdict, 'REVIEW');
    assert.equal(results[0].findings[0].code, 'EVALUATION_UNPARSEABLE');
  }, { auditGateway });
});

test('a finding may only request a known repair action', async () => {
  const auditGateway = fakeGateway({
    output: auditOutput('WARN', [{ code: 'TOO_LONG', message: 'dài quá', repairAction: 'JUST_FIX_IT' }]),
  });
  await withEvaluator(async ({ created, evaluator }) => {
    await assert.rejects(
      () => evaluator.evaluate({
        workspaceId: WS, contentId: created.content.contentId, revisionId: created.revision.revisionId,
        evaluatorSet: ['brand'], context: { evidenceById: EVIDENCE },
      }),
      /repairAction/,
    );
  }, { auditGateway });
});

// Chấm bài không được làm thay đổi bài.
test('evaluations are stored as immutable records and never touch the revision', async () => {
  await withEvaluator(async ({ created, evaluator, contentService }) => {
    const before = await contentService.getContentHistory(WS, created.content.contentId);
    await evaluator.evaluate({
      workspaceId: WS, contentId: created.content.contentId, revisionId: created.revision.revisionId,
      evaluatorSet: ['brand'], context: { evidenceById: EVIDENCE },
    });
    const after = await contentService.getContentHistory(WS, created.content.contentId);
    assert.deepEqual(after, before, 'scoring a draft does not alter it');

    const stored = await contentService.listEvaluations(WS, created.revision.revisionId);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].dimension, 'brand');
    assert.equal(stored[0].verdict, 'PASS');
  });
});

test('the evaluator proposes repairs but performs none', async () => {
  const auditGateway = fakeGateway({
    output: auditOutput('WARN', [{ code: 'HYPE', message: 'giọng thổi phồng', repairAction: 'REWRITE_SECTION' }]),
  });
  await withEvaluator(async ({ created, evaluator, contentService }) => {
    const results = await evaluator.evaluate({
      workspaceId: WS, contentId: created.content.contentId, revisionId: created.revision.revisionId,
      evaluatorSet: ['brand'], context: { evidenceById: EVIDENCE },
    });
    assert.equal(results[0].findings[0].repairAction, 'REWRITE_SECTION');
    assert.equal((await contentService.getContentHistory(WS, created.content.contentId)).length, 1, 'nothing was rewritten');
  }, { auditGateway });
});

test('the whole required evaluator set of the pack can be run at once', async () => {
  const auditGateway = fakeGateway({ output: auditOutput('PASS') });
  await withEvaluator(async ({ created, evaluator }) => {
    const results = await evaluator.evaluate({
      workspaceId: WS, contentId: created.content.contentId, revisionId: created.revision.revisionId,
      context: { evidenceById: EVIDENCE, claimsById: {} },
    });
    assert.deepEqual(
      results.map((r) => r.dimension).sort(),
      [...articlePack.requiredEvaluators].sort(),
    );
  }, { auditGateway });
});

test('the editor sends the current draft as data, not as a new instruction', async () => {
  const gateway = fakeGateway([{ output: ARTICLE_OUTPUT }, { output: ARTICLE_OUTPUT }]);
  await seeded(async ({ editor, created }) => {
    await editor.edit({
      workspaceId: WS, contentId: created.content.contentId, revisionId: created.revision.revisionId,
      operation: 'DESLOP', instruction: 'bỏ câu mở thừa', context: { evidenceById: EVIDENCE, claimsById: {} },
    });
    const editTask = gateway.tasks.at(-1).task;
    assert.equal(editTask.taskType, 'EDIT');
    assert.ok(editTask.contextBundle.prompt.includes('<<<SEOSONA:DATA'), 'the draft is fenced like any other data');
    assert.ok(editTask.contextBundle.prompt.includes('bỏ câu mở thừa'));
  }, gateway);
});

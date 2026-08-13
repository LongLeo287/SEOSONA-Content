import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWriter } from '../runtime/writing/writer.mjs';
import { createJobPackRegistry } from '../runtime/writing/job-packs/registry.mjs';
import { articlePack } from '../runtime/writing/job-packs/article.mjs';
import { productPack, validateProductClaims } from '../runtime/writing/job-packs/product.mjs';
import { transcriptPack } from '../runtime/writing/job-packs/transcript.mjs';
import { parseSrt } from '../runtime/writing/transcript/srt.mjs';
import { resolveClaimSupport } from '../runtime/writing/claims.mjs';
import { adaptToTarget } from '../runtime/writing/target-adapter.mjs';
import { createWorkspaceStore } from '../runtime/storage/workspace-store.mjs';
import { createWorkspaceService } from '../runtime/domain/workspace-service.mjs';
import { createContentService } from '../runtime/domain/content-service.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const NOW = '2026-08-13T00:00:00.000Z';
const WS = 'workspace_golden';

const golden = (name) => JSON.parse(readFileSync(join(here, `fixtures/${name}-golden.json`), 'utf8'));

// Golden case là NGUỒN + ĐẦU VÀO + KỲ VỌNG, không phải ảnh chụp câu trả lời của một hãng AI.
// Ảnh chụp sẽ hỏng vào ngày nhà cung cấp đổi cách viết, và khi đó không ai biết là hệ thống
// hỏng hay chỉ là model nói khác đi.

// ================================================================ Article

test('golden article: evidence backed, headings consistent, target fields present', () => {
  const fixture = golden('article');
  const evidenceById = Object.fromEntries(fixture.evidence.map((e) => [e.evidenceId, e]));
  const { claims, ...fields } = fixture.providerOutput;

  const content = {
    contentId: 'content_golden', jobType: 'article', fields,
    sourceRefs: fixture.sources.map((s) => s.sourceId), claimRefs: claims.map((c) => c.claimId),
  };

  const validation = articlePack.validateDraft(content, {
    evidenceById, claimsById: Object.fromEntries(claims.map((c) => [c.claimId, c])), target: fixture.target,
  });
  assert.deepEqual(validation, { ok: fixture.expect.valid, issues: [] });

  for (const claim of claims) {
    assert.equal(resolveClaimSupport(claim, evidenceById).status, fixture.expect.claimStatus[claim.claimId]);
  }

  // Ràng buộc của nơi đăng: metaTitle đã khai giới hạn 60 ký tự, nên nó được áp thật.
  const adapted = adaptToTarget({ content, targetSpec: fixture.target });
  assert.equal(adapted.blocked, false);
  assert.ok(fields.metaTitle.length <= fixture.target.lengthRules.metaTitle.max);
});

test('golden article: a citation that points nowhere breaks the same fixture', () => {
  const fixture = golden('article');
  const { claims, ...fields } = fixture.providerOutput;
  fields.sections[0].evidenceRefs = ['e_khong_ton_tai'];
  const result = articlePack.validateDraft(
    { contentId: 'c', jobType: 'article', fields, sourceRefs: [], claimRefs: [] },
    { evidenceById: {}, claimsById: {} },
  );
  assert.ok(result.issues.some((i) => i.code === 'UNSUPPORTED_CITATION'));
});

// ================================================================ Product

// Đây là ca cám dỗ: câu "bền hơn hẳn mẫu vỏ nhựa" nghe hoàn toàn hợp lý và suy ra được từ
// "vỏ nhôm". Nhưng suy ra không phải là chứng minh, và mô tả sản phẩm thì phải chứng minh.
test('golden product: a plausible but unsupported benefit is blocked', () => {
  const fixture = golden('product');
  const content = { contentId: 'content_golden', jobType: 'product', fields: fixture.providerOutput, sourceRefs: [], claimRefs: [] };
  const result = validateProductClaims(content, fixture.productFacts, {});

  assert.equal(result.ok, fixture.expect.valid);
  for (const code of fixture.expect.issues) {
    assert.ok(result.issues.some((i) => i.code === code), `expected ${code}`);
  }
  assert.deepEqual(result.issues.find((i) => i.code === 'UNSUPPORTED_BENEFIT').repairOptions, fixture.expect.repairOptions);
});

test('golden product: every declared spec matches its catalog fact exactly', () => {
  const fixture = golden('product');
  for (const spec of fixture.providerOutput.specs) {
    const fact = fixture.productFacts.find((f) => f.factId === spec.factRef);
    assert.equal(spec.value, fact.value, spec.name);
    assert.equal(spec.unit ?? undefined, fact.unit, spec.name);
  }
});

test('golden product: removing the unsupported benefit makes the same draft pass', () => {
  const fixture = golden('product');
  const fields = { ...fixture.providerOutput, benefits: [] };
  const result = validateProductClaims({ fields }, fixture.productFacts, {});
  assert.deepEqual(result, { ok: true, issues: [] }, 'the fix is to drop the promise, not to invent evidence');
});

// ================================================================ Transcript

test('golden transcript: a non linear cut keeps every raw field exact', () => {
  const fixture = golden('transcript');
  const cues = parseSrt(readFileSync(join(here, `fixtures/${fixture.fixtureSrt}`), 'utf8'));
  const transcript = { sourceId: 's_video', cues, durationMs: cues.at(-1).endMs };
  const content = { contentId: 'content_golden', jobType: 'transcript', fields: fixture.providerOutput, sourceRefs: ['s_video'], claimRefs: [] };

  const result = transcriptPack.validateDraft(content, { transcript });
  assert.deepEqual(result, { ok: fixture.expect.valid, issues: [] });

  const [first, second] = fixture.providerOutput.selections;
  assert.ok(first.sourceStartMs > second.sourceStartMs, 'the cut really is out of source order');
  assert.equal(transcriptPack.assertSourceFidelity(content, transcript).ok, true);
});

// Cue 5 chứa lỗi chính tả "logictics". Bản đã sửa cho đúng chính tả không còn khớp nguồn.
test('golden transcript: a corrected spelling is caught by the fidelity gate', () => {
  const fixture = golden('transcript');
  const cues = parseSrt(readFileSync(join(here, `fixtures/${fixture.fixtureSrt}`), 'utf8'));
  const transcript = { sourceId: 's_video', cues, durationMs: cues.at(-1).endMs };
  const tampered = { contentId: 'c', jobType: 'transcript', fields: fixture.tamperedOutput, sourceRefs: ['s_video'], claimRefs: [] };

  const result = transcriptPack.assertSourceFidelity(tampered, transcript);
  assert.equal(result.ok, false);
  assert.equal(result.issues[0].code, fixture.expect.tamperedIssue);
});

// ================================================================ Trung lập nhà cung cấp

function fakeGateway(providerId, output) {
  const tasks = [];
  return {
    tasks,
    execute: async (task, policy) => {
      tasks.push({ task, policy });
      return {
        status: 'COMPLETED', output: JSON.stringify(output), providerId,
        costClass: providerId === 'api-fake' ? 'FREE_QUOTA' : 'ZERO_INCREMENTAL',
        startedAt: NOW, completedAt: NOW, parseStatus: 'OK', warnings: [], error: null, receipt: null,
      };
    },
  };
}

async function runArticleThrough(providerId, output) {
  const rootDir = await mkdtemp(join(tmpdir(), 'seosona-neutral-'));
  try {
    let seq = 0;
    const idFactory = (prefix) => `${String(prefix).toLowerCase()}_${++seq}`;
    const store = createWorkspaceStore({ rootDir });
    const workspaces = createWorkspaceService({ store, now: () => NOW, idFactory });
    const contentService = createContentService({ store, now: () => NOW, idFactory });
    const packRegistry = createJobPackRegistry();
    packRegistry.registerJobPack(articlePack);
    await store.put('workspace', WS, { workspaceId: WS, name: 'G', createdAt: NOW });
    const project = await workspaces.createProject({ workspaceId: WS, name: 'P' });

    const gateway = fakeGateway(providerId, output);
    const writer = createWriter({ gateway, packRegistry, contentService, now: () => NOW, idFactory });
    const fixture = golden('article');
    const evidenceById = Object.fromEntries(fixture.evidence.map((e) => [e.evidenceId, e]));

    const result = await writer.write({
      workspaceId: WS, projectId: project.projectId, jobType: 'article',
      brief: fixture.brief, contextSnapshotId: 'contextsnapshot_golden',
      evidence: fixture.evidence,
      context: { evidenceById, claimsById: {}, target: fixture.target },
    });
    return { result, task: gateway.tasks[0].task };
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

// Cùng một việc, chạy qua hai hãng khác hẳn nhau: kết quả phải cùng hình dạng, và không có
// dòng code nào ở Writer hay ở Article pack rẽ nhánh theo tên hãng.
test('the same article job runs through a browser provider and an api provider alike', async () => {
  const output = golden('article').providerOutput;
  const viaBrowser = await runArticleThrough('browser-fake', output);
  const viaApi = await runArticleThrough('api-fake', output);

  assert.equal(viaBrowser.result.content.jobType, viaApi.result.content.jobType);
  assert.deepEqual(Object.keys(viaBrowser.result.content).sort(), Object.keys(viaApi.result.content).sort());
  assert.deepEqual(viaBrowser.result.content.fields, viaApi.result.content.fields);
  assert.deepEqual(viaBrowser.result.issues, []);
  assert.deepEqual(viaApi.result.issues, []);

  // Cùng một ProviderTask được gửi đi trong cả hai trường hợp.
  const strip = (task) => ({ ...task, taskId: 'x', contextBundle: { promptDigest: task.contextBundle.promptDigest } });
  assert.deepEqual(strip(viaBrowser.task), strip(viaApi.task));
  assert.equal(viaBrowser.result.providerResult.providerId, 'browser-fake');
  assert.equal(viaApi.result.providerResult.providerId, 'api-fake');
});

test('no writing module branches on a provider name', () => {
  const files = [
    '../runtime/writing/writer.mjs',
    '../runtime/writing/editor.mjs',
    '../runtime/writing/evaluator.mjs',
    '../runtime/writing/job-packs/article.mjs',
    '../runtime/writing/job-packs/product.mjs',
    '../runtime/writing/job-packs/transcript.mjs',
    '../runtime/writing/context-builder.mjs',
    '../runtime/writing/prompt-composer.mjs',
  ];
  for (const file of files) {
    const source = readFileSync(join(here, file), 'utf8').toLowerCase();
    for (const vendor of ['chatgpt', 'gemini', 'claude', 'grok', 'openai', 'anthropic']) {
      assert.ok(!source.includes(vendor), `${file} must not mention ${vendor}`);
    }
    assert.ok(!/if\s*\(\s*providerid/i.test(source), `${file} must not branch on providerId`);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertSourceArtifact,
  assertEvidenceIR,
  assertClaim,
  assertAudienceContext,
  assertBrandContext,
  assertBriefIR,
  assertContentIR,
  assertEvaluationResult,
  assertRevisionPayload,
  assertSpecializedContent,
  CLAIM_STATUSES,
  EVIDENCE_TYPES,
  ASSERTION_STRENGTH,
  VERDICTS,
} from '../runtime/writing/contracts.mjs';
import { createJobPackRegistry } from '../runtime/writing/job-packs/registry.mjs';

// ---------------------------------------------------------------- từ vựng

test('the shared vocabularies are exactly the declared ones', () => {
  assert.deepEqual(CLAIM_STATUSES, ['SUPPORTED', 'PARTIALLY_SUPPORTED', 'UNSUPPORTED', 'CONTRADICTED', 'NEEDS_REVIEW']);
  assert.deepEqual(EVIDENCE_TYPES, ['FACT', 'CLAIM', 'QUOTE', 'STATISTIC', 'OPINION', 'INFERENCE']);
  // Thứ tự có ý nghĩa: đây là thang ĐỘ CHẮC CHẮN, dùng để phát hiện một lần sửa đã
  // đẩy câu văn lên chắc hơn mức bằng chứng cho phép.
  assert.deepEqual(ASSERTION_STRENGTH, ['QUALIFIED', 'LIKELY', 'DIRECT', 'EXACT', 'ABSOLUTE']);
  assert.deepEqual(VERDICTS, ['PASS', 'WARN', 'REVIEW', 'BLOCK']);
});

// ---------------------------------------------------------------- nguồn & bằng chứng

test('a source artifact must be identifiable and content addressed', () => {
  assert.throws(() => assertSourceArtifact({ kind: 'html' }), /sourceId/);
  assert.throws(() => assertSourceArtifact({ sourceId: 's1' }), /kind/);
  assert.throws(() => assertSourceArtifact({ sourceId: 's1', kind: 'html' }), /sha256/);
  const source = assertSourceArtifact({ sourceId: 's1', kind: 'html', sha256: 'a'.repeat(64), title: 'Page' });
  assert.equal(source.canonicalUrl, null, 'a missing url is null, not undefined');
});

test('evidence keeps the source and the locator that points back into it', () => {
  assert.throws(() => assertEvidenceIR({ evidenceId: 'e1', type: 'FACT', text: 'x' }), /sourceId/);
  assert.throws(() => assertEvidenceIR({ evidenceId: 'e1', sourceId: 's1', type: 'GUESS', text: 'x' }), /type/);
  assert.throws(() => assertEvidenceIR({ evidenceId: 'e1', sourceId: 's1', type: 'FACT', text: '' }), /text/);

  const evidence = assertEvidenceIR({
    evidenceId: 'e1', sourceId: 's1', type: 'STATISTIC', text: 'Ships in 2 days', locator: { line: 12 },
  });
  assert.deepEqual(evidence.locator, { line: 12 });
  assert.equal(evidence.relation, 'SUPPORTS', 'evidence supports by default; contradiction must be stated');
});

test('evidence may be marked as contradicting or merely related', () => {
  for (const relation of ['SUPPORTS', 'CONTRADICTS', 'RELATED']) {
    assert.equal(assertEvidenceIR({ evidenceId: 'e1', sourceId: 's1', type: 'FACT', text: 't', relation }).relation, relation);
  }
  assert.throws(() => assertEvidenceIR({ evidenceId: 'e1', sourceId: 's1', type: 'FACT', text: 't', relation: 'MAYBE' }), /relation/);
});

// ---------------------------------------------------------------- luận điểm

test('claim requires proposition, strength, status and evidence refs', () => {
  assert.throws(() => assertClaim({ claimId: 'claim_1' }), /proposition/);
  const claim = assertClaim({
    claimId: 'claim_1',
    proposition: 'The product weighs 1 kg.',
    type: 'FACT',
    strength: 'EXACT',
    status: 'SUPPORTED',
    evidenceRefs: ['evidence_1'],
    confidence: 1,
  });
  assert.equal(claim.status, 'SUPPORTED');
  assert.deepEqual(claim.evidenceRefs, ['evidence_1']);
});

test('a claim with no stated status is NEEDS_REVIEW, never SUPPORTED', () => {
  const claim = assertClaim({ claimId: 'c1', proposition: 'It is fast.', type: 'CLAIM' });
  assert.equal(claim.status, 'NEEDS_REVIEW', 'silence is not support');
  assert.equal(claim.strength, 'QUALIFIED', 'and the weakest reading is the safe default');
  assert.deepEqual(claim.evidenceRefs, []);
  assert.equal(claim.confidence, null, 'an unmeasured confidence is null, not 1');
});

test('claim rejects unknown status, strength and confidence out of range', () => {
  const base = { claimId: 'c1', proposition: 'p', type: 'FACT' };
  assert.throws(() => assertClaim({ ...base, status: 'PROBABLY' }), /status/);
  assert.throws(() => assertClaim({ ...base, strength: 'VERY_STRONG' }), /strength/);
  assert.throws(() => assertClaim({ ...base, confidence: 1.5 }), /confidence/);
  assert.throws(() => assertClaim({ ...base, evidenceRefs: 'evidence_1' }), /evidenceRefs/);
});

// Hai thang đo khác nhau, cố ý giữ riêng: "chắc đến đâu" và "quan hệ nhân quả mạnh đến đâu".
// Gộp lại thì một câu "có thể góp phần" và một câu "chắc chắn có liên quan" trở nên không phân biệt được.
test('causal strength is a separate axis from assertion strength', () => {
  const claim = assertClaim({
    claimId: 'c1', proposition: 'X contributes to Y.', type: 'CLAIM',
    strength: 'LIKELY', causalStrength: 'CONTRIBUTES',
  });
  assert.equal(claim.strength, 'LIKELY');
  assert.equal(claim.causalStrength, 'CONTRIBUTES');
  assert.throws(() => assertClaim({ claimId: 'c1', proposition: 'p', type: 'CLAIM', causalStrength: 'PROVES' }), /causalStrength/);
});

// ---------------------------------------------------------------- ngữ cảnh

test('brand and audience context carry a revision so a run can be reproduced', () => {
  assert.throws(() => assertBrandContext({ brandId: 'b1' }), /revision/);
  const brand = assertBrandContext({ brandId: 'b1', revision: 3, voice: ['practical'], dont: ['hype'] });
  assert.equal(brand.revision, 3);
  assert.deepEqual(brand.do, [], 'unstated lists are empty, not undefined');

  assert.throws(() => assertAudienceContext({ description: 'SEO folks' }), /revision/);
  const audience = assertAudienceContext({ revision: 1, description: 'SEO practitioners', knowledgeLevel: 'INTERMEDIATE' });
  assert.equal(audience.knowledgeLevel, 'INTERMEDIATE');
  assert.throws(() => assertAudienceContext({ revision: 1, description: 'x', knowledgeLevel: 'GURU' }), /knowledgeLevel/);
});

test('a brief states what to write, for whom, and how evidence is handled', () => {
  assert.throws(() => assertBriefIR({ jobType: 'article' }), /objective/);
  const brief = assertBriefIR({
    jobType: 'article', objective: 'Explain X', intent: 'INFORMATIONAL', angle: 'practical',
    audience: { revision: 1, description: 'SEO practitioners' },
  });
  assert.equal(brief.language, 'vi-VN', 'the default language is stated, not left blank');
  assert.equal(brief.evidencePolicy, 'SOURCE_BACKED', 'the safe policy is the default');
  assert.throws(() => assertBriefIR({ ...brief, evidencePolicy: 'TRUST_ME' }), /evidencePolicy/);
});

// ---------------------------------------------------------------- nội dung

test('ContentIR is semantic content, not provider output metadata', () => {
  assert.throws(
    () => assertContentIR({ contentId: 'content_1', jobType: 'article', providerId: 'chatgpt-web' }),
    /provider/i,
  );
  for (const leak of ['modelSession', 'chatUrl', 'tabId', 'promptText', 'apiKey', 'selector']) {
    assert.throws(
      () => assertContentIR({ contentId: 'c1', jobType: 'article', fields: {}, [leak]: 'x' }),
      new RegExp(leak, 'i'),
      `${leak} belongs to the provider receipt, not to the content`,
    );
  }
});

test('ContentIR keeps its semantic fields and defaults the rest', () => {
  const content = assertContentIR({
    contentId: 'content_1', jobType: 'article', language: 'vi-VN',
    fields: { title: 'T', body: 'B' }, sourceRefs: ['s1'], claimRefs: ['c1'],
  });
  assert.deepEqual(content.fields, { title: 'T', body: 'B' });
  assert.deepEqual(content.sourceRefs, ['s1']);
  assert.equal(content.targetRef, null);
  assert.deepEqual(content.metadata, {});
  assert.throws(() => assertContentIR({ contentId: 'c1' }), /jobType/);
  assert.throws(() => assertContentIR({ contentId: 'c1', jobType: 'article', fields: 'text' }), /fields/);
});

test('validators return a detached copy so callers cannot mutate shared state', () => {
  const input = { contentId: 'c1', jobType: 'article', fields: { title: 'T' } };
  const content = assertContentIR(input);
  content.fields.title = 'changed';
  assert.equal(input.fields.title, 'T');
});

// ---------------------------------------------------------------- đánh giá & bản sửa

test('an evaluation result names what was judged and by which evaluator', () => {
  assert.throws(() => assertEvaluationResult({ evaluationId: 'ev1', dimension: 'factuality' }), /contentId/);
  assert.throws(
    () => assertEvaluationResult({ evaluationId: 'ev1', contentId: 'c1', revisionId: 'r1', dimension: 'vibes', verdict: 'PASS', evaluatorId: 'x' }),
    /dimension/,
  );
  const result = assertEvaluationResult({
    evaluationId: 'ev1', contentId: 'c1', revisionId: 'r1', dimension: 'factuality',
    verdict: 'BLOCK', evaluatorId: 'deterministic:claim-support',
    findings: [{ code: 'UNSUPPORTED_CLAIM', message: 'no evidence', repairAction: 'ADD_EVIDENCE' }],
  });
  assert.equal(result.verdict, 'BLOCK');
  assert.equal(result.score, null, 'an unscored dimension is null, not zero');
  assert.equal(result.findings[0].repairAction, 'ADD_EVIDENCE');
});

test('a finding may only ask for a known repair action', () => {
  const base = {
    evaluationId: 'ev1', contentId: 'c1', revisionId: 'r1', dimension: 'factuality',
    verdict: 'BLOCK', evaluatorId: 'x',
  };
  assert.throws(
    () => assertEvaluationResult({ ...base, findings: [{ code: 'X', message: 'm', repairAction: 'JUST_FIX_IT' }] }),
    /repairAction/,
  );
});

test('a revision payload records what changed and why', () => {
  assert.throws(() => assertRevisionPayload({ operation: 'EDIT' }), /content/);
  const payload = assertRevisionPayload({
    operation: 'EDIT',
    content: { contentId: 'c1', jobType: 'article', fields: { body: 'v2' } },
    instruction: 'shorten the intro',
  });
  assert.equal(payload.operation, 'EDIT');
  assert.equal(payload.content.fields.body, 'v2');
  assert.throws(() => assertRevisionPayload({ operation: 'MANGLE', content: { contentId: 'c1', jobType: 'article' } }), /operation/);
});

// ---------------------------------------------------------------- mở rộng theo pack

// Pack chuyên biệt kiểm phần riêng của nó. Cố ý KHÔNG dựng một union khổng lồ chứa mọi
// trường của mọi loại nội dung tương lai — thêm một loại nội dung không được buộc phải
// sửa hợp đồng dùng chung.
test('a job pack validates its own fields on top of the shared contract', () => {
  const productValidator = (content) => {
    if (!Array.isArray(content.fields.specs)) throw new TypeError('productContent: "specs" must be an array.');
    return content;
  };
  const ok = assertSpecializedContent(
    { contentId: 'c1', jobType: 'product', fields: { title: 'T', specs: [] } },
    productValidator,
  );
  assert.equal(ok.jobType, 'product');
  assert.throws(
    () => assertSpecializedContent({ contentId: 'c1', jobType: 'product', fields: { title: 'T' } }, productValidator),
    /specs/,
  );
  // Hợp đồng chung vẫn được kiểm TRƯỚC phần riêng.
  assert.throws(
    () => assertSpecializedContent({ contentId: 'c1', jobType: 'product', providerId: 'x', fields: {} }, productValidator),
    /provider/i,
  );
});

// ================================================================ Sổ đăng ký Job Pack

const pack = (overrides = {}) => ({
  id: 'job.article',
  version: '1.0.0',
  jobType: 'article',
  requiredBriefFields: ['objective', 'intent', 'angle'],
  outputContract: { format: 'json', jsonSchema: { name: 'article', schema: { type: 'object' } } },
  structureRules: { headings: ['H2'] },
  requiredEvaluators: ['factuality', 'claim-support', 'structure'],
  buildBrief: (input) => ({ ...input, jobType: 'article' }),
  validateDraft: () => ({ ok: true, issues: [] }),
  definitionOfDone: () => ({ done: true, blocking: [] }),
  ...overrides,
});

test('a registered pack can be found by its job type', () => {
  const registry = createJobPackRegistry();
  registry.registerJobPack(pack());
  assert.equal(registry.getJobPack('article').id, 'job.article');
  assert.deepEqual(registry.listJobPacks().map((p) => p.jobType), ['article']);
});

test('an unknown job type is an error, not an empty result', () => {
  const registry = createJobPackRegistry();
  assert.throws(() => registry.getJobPack('podcast'), (e) => e.code === 'UNKNOWN_JOB_TYPE');
});

// Đăng ký trùng mà im lặng ghi đè thì một pack có thể bị thay lúc chạy mà không ai biết.
test('registering the same pack twice is refused unless the version moves', () => {
  const registry = createJobPackRegistry();
  registry.registerJobPack(pack());
  assert.throws(() => registry.registerJobPack(pack()), (e) => e.code === 'DUPLICATE_JOB_PACK');
  registry.registerJobPack(pack({ version: '1.1.0' }));
  assert.equal(registry.getJobPack('article').version, '1.1.0', 'a newer version replaces the old one');
});

test('two packs cannot claim the same id under different job types', () => {
  const registry = createJobPackRegistry();
  registry.registerJobPack(pack());
  assert.throws(
    () => registry.registerJobPack(pack({ jobType: 'newsletter' })),
    (e) => e.code === 'DUPLICATE_JOB_PACK',
  );
});

test('a pack without an output contract or evaluators is rejected', () => {
  const registry = createJobPackRegistry();
  assert.throws(() => registry.registerJobPack(pack({ outputContract: null })), /outputContract/);
  assert.throws(() => registry.registerJobPack(pack({ requiredEvaluators: [] })), /requiredEvaluators/);
  assert.throws(() => registry.registerJobPack(pack({ requiredEvaluators: ['vibes'] })), /vibes/);
});

test('a pack must implement the whole interface', () => {
  const registry = createJobPackRegistry();
  for (const missing of ['buildBrief', 'validateDraft', 'definitionOfDone']) {
    assert.throws(() => registry.registerJobPack(pack({ [missing]: undefined })), new RegExp(missing));
  }
  assert.throws(() => registry.registerJobPack(pack({ jobType: '' })), /jobType/);
  assert.throws(() => registry.registerJobPack(pack({ version: '' })), /version/);
});

// Pack mô tả VIỆC CẦN LÀM. Nói tên hãng ở đây là buộc một loại nội dung vào một nhà cung cấp,
// và Auto Router mất quyền chọn.
test('a pack may require capabilities but must never name a vendor', () => {
  const registry = createJobPackRegistry();
  registry.registerJobPack(pack({ requiredCapabilities: ['long-context', 'structured-output'] }));
  assert.deepEqual(registry.getJobPack('article').requiredCapabilities, ['long-context', 'structured-output']);

  for (const leak of [
    { providerId: 'chatgpt-web' },
    { preferredProvider: 'claude-web' },
    { requiredCapabilities: ['gemini-pro'] },
    { model: 'vendor-large' },
  ]) {
    assert.throws(
      () => createJobPackRegistry().registerJobPack(pack({ ...leak, id: 'job.leak' })),
      /provider|vendor|model/i,
      JSON.stringify(leak),
    );
  }
});

test('packs are stored detached from the caller', () => {
  const registry = createJobPackRegistry();
  const original = pack();
  registry.registerJobPack(original);
  original.requiredEvaluators.push('seo');
  assert.deepEqual(registry.getJobPack('article').requiredEvaluators, ['factuality', 'claim-support', 'structure']);
});

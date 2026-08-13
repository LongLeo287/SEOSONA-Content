import test from 'node:test';
import assert from 'node:assert/strict';
import { articlePack } from '../runtime/writing/job-packs/article.mjs';
import { buildResearchPacket } from '../runtime/writing/research.mjs';
import { buildBrief } from '../runtime/writing/brief.mjs';
import { planStructure, validateStructure } from '../runtime/writing/structure.mjs';

const evidence = (overrides = {}) => ({
  evidenceId: 'e1', sourceId: 's1', type: 'FACT', text: 'Giao hàng trong 2 ngày.', locator: { line: 3 }, ...overrides,
});

const content = (overrides = {}) => ({
  contentId: 'content_1',
  jobType: 'article',
  language: 'vi-VN',
  fields: {
    title: 'Giao hàng nhanh cho cửa hàng nhỏ',
    outline: ['Vì sao tốc độ giao hàng quan trọng', 'Cách rút ngắn thời gian'],
    sections: [
      { heading: 'Vì sao tốc độ giao hàng quan trọng', level: 2, body: 'Khách bỏ giỏ khi chờ lâu.', evidenceRefs: ['e1'] },
      { heading: 'Cách rút ngắn thời gian', level: 2, body: 'Gom đơn theo khu vực.' },
    ],
    body: 'Khách bỏ giỏ khi chờ lâu.\n\nGom đơn theo khu vực.',
  },
  sourceRefs: ['s1'],
  claimRefs: [],
  ...overrides,
});

const context = (overrides = {}) => ({
  evidenceById: { e1: evidence() },
  claimsById: {},
  target: null,
  ...overrides,
});

const briefInput = {
  objective: 'Giúp chủ shop rút ngắn thời gian giao hàng',
  intent: 'INFORMATIONAL',
  angle: 'thực dụng, có ví dụ',
  audience: { revision: 1, description: 'Chủ cửa hàng nhỏ' },
};

// ================================================================ Brief

test('the article brief keeps what was asked and fills the safe defaults', () => {
  const brief = articlePack.buildBrief(briefInput);
  assert.equal(brief.jobType, 'article');
  assert.equal(brief.objective, briefInput.objective);
  assert.equal(brief.language, 'vi-VN');
  assert.equal(brief.evidencePolicy, 'SOURCE_BACKED');
});

test('a brief missing what the pack requires is refused with the field named', () => {
  for (const field of ['objective', 'intent', 'angle']) {
    const input = { ...briefInput };
    delete input[field];
    assert.throws(() => articlePack.buildBrief(input), new RegExp(field), `missing ${field}`);
  }
});

test('the generic brief builder enforces whatever the pack declares', () => {
  const brief = buildBrief({ ...briefInput, jobType: 'article' }, ['objective', 'intent']);
  assert.equal(brief.objective, briefInput.objective);
  assert.throws(() => buildBrief({ jobType: 'article', objective: 'x' }, ['objective', 'intent']), /intent/);
});

// ================================================================ Nghiên cứu

test('a research packet keeps sources, evidence and their links together', () => {
  const packet = buildResearchPacket({
    sources: [{ sourceId: 's1', kind: 'html', sha256: 'a'.repeat(64), title: 'Trang giao hàng' }],
    evidence: [evidence()],
    now: () => '2026-08-13T00:00:00.000Z',
  });
  assert.equal(packet.sources.length, 1);
  assert.equal(packet.evidence.length, 1);
  assert.deepEqual(packet.warnings, []);
});

test('evidence pointing at a source that is not in the packet is refused', () => {
  assert.throws(
    () => buildResearchPacket({ sources: [], evidence: [evidence()], now: () => '2026-08-13T00:00:00.000Z' }),
    /s1/,
  );
});

// Bằng chứng cũ vẫn dùng được, nhưng người viết phải BIẾT là nó cũ. Cảnh báo, không chặn.
test('stale evidence produces a warning rather than a silent pass', () => {
  const packet = buildResearchPacket({
    sources: [{ sourceId: 's1', kind: 'html', sha256: 'a'.repeat(64) }],
    evidence: [evidence({ capturedAt: '2024-01-01T00:00:00.000Z' })],
    maxAgeDays: 180,
    now: () => '2026-08-13T00:00:00.000Z',
  });
  assert.equal(packet.warnings[0].code, 'EVIDENCE_STALE');
  assert.equal(packet.warnings[0].evidenceId, 'e1');
  assert.equal(packet.evidence.length, 1, 'it is still available to write with');
});

test('evidence with no capture date is flagged as unknown age, not assumed fresh', () => {
  const packet = buildResearchPacket({
    sources: [{ sourceId: 's1', kind: 'html', sha256: 'a'.repeat(64) }],
    evidence: [evidence()],
    maxAgeDays: 180,
    now: () => '2026-08-13T00:00:00.000Z',
  });
  assert.equal(packet.warnings[0].code, 'EVIDENCE_AGE_UNKNOWN');
});

// ================================================================ Cấu trúc

test('the structure planner works from pack rules, not from baked in headings', () => {
  const outline = planStructure(
    { requiredSections: ['Bối cảnh', 'Cách làm'], headingLevels: [2, 3] },
    articlePack.buildBrief(briefInput),
  );
  assert.deepEqual(outline.map((s) => s.heading), ['Bối cảnh', 'Cách làm']);
  assert.equal(outline[0].level, 2);
  // Core không biết gì về heading của bài blog: đưa luật khác thì ra dàn bài khác.
  const other = planStructure({ requiredSections: ['Tóm tắt'] }, articlePack.buildBrief(briefInput));
  assert.deepEqual(other.map((s) => s.heading), ['Tóm tắt']);
});

test('structure validation catches duplicates, empty sections and heading jumps', () => {
  const duplicated = validateStructure(
    [{ heading: 'A', level: 2, body: 'x' }, { heading: 'A', level: 2, body: 'y' }], {},
  );
  assert.equal(duplicated.issues[0].code, 'DUPLICATE_HEADING');

  const empty = validateStructure([{ heading: 'A', level: 2, body: '   ' }], {});
  assert.equal(empty.issues[0].code, 'EMPTY_SECTION');

  const jumped = validateStructure([{ heading: 'A', level: 2, body: 'x' }, { heading: 'B', level: 4, body: 'y' }], {});
  assert.equal(jumped.issues[0].code, 'HEADING_LEVEL_JUMP');

  const missing = validateStructure([{ heading: 'A', level: 2, body: 'x' }], { requiredSections: ['Kết luận'] });
  assert.equal(missing.issues[0].code, 'MISSING_REQUIRED_SECTION');

  assert.equal(validateStructure([{ heading: 'A', level: 2, body: 'x' }], {}).ok, true);
});

// ================================================================ Kiểm bản thảo

test('a well formed article passes deterministic validation', () => {
  const result = articlePack.validateDraft(content(), context());
  assert.deepEqual(result, { ok: true, issues: [] });
});

test('a draft missing title, body or outline is blocked', () => {
  for (const field of ['title', 'body', 'outline']) {
    const draft = content();
    delete draft.fields[field];
    const result = articlePack.validateDraft(draft, context());
    assert.equal(result.ok, false, field);
    assert.ok(result.issues.some((i) => i.code === 'MISSING_REQUIRED_FIELD' && i.field === field), field);
  }
});

test('the outline and the sections must agree with each other', () => {
  const draft = content();
  draft.fields.outline = ['Vì sao tốc độ giao hàng quan trọng', 'Một mục không hề được viết'];
  const result = articlePack.validateDraft(draft, context());
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.code === 'OUTLINE_SECTION_MISMATCH'));
});

// Trích dẫn trỏ vào một mẩu bằng chứng không tồn tại là kiểu hỏng tệ nhất: bài đọc như
// có nguồn, mà lần theo thì không có gì ở đó.
test('a citation pointing at evidence that does not exist blocks the draft', () => {
  const draft = content();
  draft.fields.sections[1].evidenceRefs = ['e_khong_ton_tai'];
  const result = articlePack.validateDraft(draft, context());
  assert.equal(result.ok, false);
  const issue = result.issues.find((i) => i.code === 'UNSUPPORTED_CITATION');
  assert.equal(issue.evidenceId, 'e_khong_ton_tai');
  assert.equal(issue.repairAction, 'ADD_EVIDENCE');
});

test('a claim reference that resolves to nothing is blocked too', () => {
  const result = articlePack.validateDraft(content({ claimRefs: ['c_missing'] }), context());
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.code === 'UNKNOWN_CLAIM_REFERENCE'));
});

test('structure problems surface through the pack as well', () => {
  const draft = content();
  draft.fields.sections[1].heading = draft.fields.sections[0].heading;
  draft.fields.outline = [draft.fields.sections[0].heading, draft.fields.sections[0].heading];
  const result = articlePack.validateDraft(draft, context());
  assert.ok(result.issues.some((i) => i.code === 'DUPLICATE_HEADING'));
});

// ---------------------------------------------------------------- SEO là tùy chọn

// Không phải bài nào cũng là bài SEO. Bắt buộc metaTitle cho mọi bài là ép một mục tiêu
// lên những bài không có mục tiêu đó.
test('seo fields stay optional until the target asks for them', () => {
  assert.equal(articlePack.validateDraft(content(), context()).ok, true);

  const seoTarget = { id: 'target.blog', fieldSet: ['metaTitle', 'metaDescription'] };
  const withoutSeo = articlePack.validateDraft(content(), context({ target: seoTarget }));
  assert.equal(withoutSeo.ok, false);
  assert.ok(withoutSeo.issues.some((i) => i.code === 'MISSING_TARGET_FIELD' && i.field === 'metaTitle'));

  const draft = content();
  draft.fields.metaTitle = 'Giao hàng nhanh cho cửa hàng nhỏ';
  draft.fields.metaDescription = 'Cách rút ngắn thời gian giao hàng.';
  assert.equal(articlePack.validateDraft(draft, context({ target: seoTarget })).ok, true);
});

// Giới hạn độ dài chỉ được áp khi nơi đăng NÓI RÕ. Tự bịa ra "60 ký tự" rồi chặn bài của
// người dùng là áp đặt một con số không ai xác nhận.
test('length limits apply only when the target declares them', () => {
  const draft = content();
  draft.fields.metaTitle = 'x'.repeat(120);
  const noLimit = articlePack.validateDraft(draft, context({ target: { id: 't', fieldSet: ['metaTitle'] } }));
  assert.equal(noLimit.ok, true, 'no declared limit, no invented limit');

  const limited = articlePack.validateDraft(
    draft, context({ target: { id: 't', fieldSet: ['metaTitle'], lengthRules: { metaTitle: { max: 60 } } } }),
  );
  assert.equal(limited.ok, false);
  assert.equal(limited.issues.find((i) => i.code === 'TARGET_LENGTH_EXCEEDED').field, 'metaTitle');
});

// ================================================================ Thế nào là xong

test('the pack declares the evaluations an article must pass', () => {
  assert.deepEqual(articlePack.requiredEvaluators, [
    'factuality', 'claim-support', 'structure', 'brand', 'audience', 'readability',
  ]);
  assert.equal(articlePack.jobType, 'article');
  assert.ok(articlePack.outputContract.jsonSchema, 'the output shape is declared, not implied');
});

test('an article is done only when every required evaluation ran and none blocks', () => {
  const passing = articlePack.requiredEvaluators.map((dimension) => ({ dimension, verdict: 'PASS' }));
  assert.equal(articlePack.definitionOfDone(content(), passing).done, true);

  const missing = passing.slice(1);
  const notRun = articlePack.definitionOfDone(content(), missing);
  assert.equal(notRun.done, false);
  assert.equal(notRun.blocking[0].code, 'EVALUATION_MISSING');

  const blocked = passing.map((e) => (e.dimension === 'factuality' ? { ...e, verdict: 'BLOCK' } : e));
  assert.equal(articlePack.definitionOfDone(content(), blocked).done, false);

  // REVIEW là "cần người xem", không phải "coi như đạt".
  const review = passing.map((e) => (e.dimension === 'brand' ? { ...e, verdict: 'REVIEW' } : e));
  const reviewed = articlePack.definitionOfDone(content(), review);
  assert.equal(reviewed.done, false);
  assert.equal(reviewed.blocking[0].code, 'HUMAN_REVIEW_REQUIRED');

  // WARN thì không chặn — cảnh báo mà chặn thì người dùng sẽ học cách phớt lờ cảnh báo.
  const warned = passing.map((e) => (e.dimension === 'readability' ? { ...e, verdict: 'WARN' } : e));
  assert.equal(articlePack.definitionOfDone(content(), warned).done, true);
});

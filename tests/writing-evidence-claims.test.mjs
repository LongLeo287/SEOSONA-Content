import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyEvidenceCandidate, explainEvidenceClassification } from '../runtime/writing/evidence.mjs';
import {
  resolveClaimSupport,
  compareClaimStrength,
  assertClaimStrengthPreserved,
} from '../runtime/writing/claims.mjs';

const candidate = (overrides = {}) => ({
  evidenceId: 'e1', sourceId: 's1', text: 'The device weighs 1 kg.', locator: { line: 3 }, ...overrides,
});

const claim = (overrides = {}) => ({
  claimId: 'c1', proposition: 'The device weighs 1 kg.', type: 'FACT', strength: 'EXACT',
  evidenceRefs: ['e1'], ...overrides,
});

const evidence = (overrides = {}) => ({
  evidenceId: 'e1', sourceId: 's1', type: 'FACT', text: 'The device weighs 1 kg.', locator: { line: 3 }, ...overrides,
});

const byId = (...items) => Object.fromEntries(items.map((e) => [e.evidenceId, e]));

// ================================================================ Phân loại bằng chứng

test('an exact number with a unit is a statistic', () => {
  const result = classifyEvidenceCandidate(candidate({ text: 'Shipping takes 2 days in 87% of orders.', verbatim: true }));
  assert.equal(result.type, 'STATISTIC');
  assert.equal(result.sourceId, 's1', 'the source is carried through');
  assert.deepEqual(result.locator, { line: 3 }, 'the locator that points back is carried through');
});

test('a verbatim quotation stays a quote', () => {
  assert.equal(classifyEvidenceCandidate(candidate({ text: 'We never share your data.', verbatim: true, quote: true })).type, 'QUOTE');
});

test('a verbatim factual statement is a fact', () => {
  assert.equal(classifyEvidenceCandidate(candidate({ text: 'The device is made of aluminium.', verbatim: true })).type, 'FACT');
});

test('something the source asserts is a claim, not a fact', () => {
  const result = classifyEvidenceCandidate(candidate({ text: 'It is the best on the market.', attributedTo: 'vendor page' }));
  assert.equal(result.type, 'OPINION', 'a superlative from a vendor is opinion, not fact');
  assert.equal(classifyEvidenceCandidate(candidate({ text: 'The update improves battery life.', attributedTo: 'vendor page' })).type, 'CLAIM');
});

test('an opinion marker keeps it out of the fact bucket', () => {
  for (const text of ['Theo tôi, đây là lựa chọn tốt nhất.', 'I think this is the right tool.', 'Đây là sản phẩm tuyệt vời nhất.']) {
    assert.equal(classifyEvidenceCandidate(candidate({ text, verbatim: true })).type, 'OPINION', text);
  }
});

test('something we worked out ourselves is an inference, not something the source said', () => {
  const result = classifyEvidenceCandidate(candidate({ text: 'So the annual cost is about 1.2 million.', inferred: true }));
  assert.equal(result.type, 'INFERENCE');
});

// Không có tín hiệu nào thì KHÔNG được mặc định thành FACT: một câu chưa ai kiểm chứng mà
// được dán nhãn "sự thật" sẽ đi thẳng vào bài viết như thể đã xác minh.
test('an unmarked candidate defaults to a claim, never to a fact', () => {
  const result = classifyEvidenceCandidate(candidate({ text: 'The rollout went smoothly.' }));
  assert.equal(result.type, 'CLAIM');
  assert.equal(explainEvidenceClassification(candidate({ text: 'The rollout went smoothly.' })).basis, 'DEFAULT');
});

test('an explicit type from the caller wins over pattern guessing', () => {
  const result = classifyEvidenceCandidate(candidate({ text: '87% of orders ship in 2 days.', type: 'QUOTE', verbatim: true }));
  assert.equal(result.type, 'QUOTE');
  assert.equal(explainEvidenceClassification(candidate({ text: 'x', type: 'QUOTE' })).basis, 'EXPLICIT');
});

test('classification explains which signals it used', () => {
  const explained = explainEvidenceClassification(candidate({ text: '87% of users agree.', verbatim: true }));
  assert.equal(explained.type, 'STATISTIC');
  assert.equal(explained.basis, 'PATTERN');
  assert.ok(explained.signals.includes('NUMERIC'));
});

test('a candidate without a source cannot become evidence', () => {
  assert.throws(() => classifyEvidenceCandidate({ evidenceId: 'e1', text: 'x' }), /sourceId/);
});

// ================================================================ Trạng thái hỗ trợ

test('same proposition with authoritative evidence is supported', () => {
  const result = resolveClaimSupport(claim(), byId(evidence()));
  assert.equal(result.status, 'SUPPORTED');
  assert.deepEqual(result.supportingEvidenceRefs, ['e1']);
});

test('no evidence is unsupported, and it says so plainly', () => {
  const result = resolveClaimSupport(claim({ evidenceRefs: [] }), {});
  assert.equal(result.status, 'UNSUPPORTED');
  assert.deepEqual(result.reasons, ['NO_EVIDENCE']);
  assert.deepEqual(result.supportingEvidenceRefs, []);
});

test('a partial match is partially supported, not rounded up to supported', () => {
  const result = resolveClaimSupport(
    claim({ proposition: 'The device weighs 1 kg and ships in 2 days.' }),
    byId(evidence({ text: 'The device weighs 1 kg.' })),
  );
  assert.equal(result.status, 'PARTIALLY_SUPPORTED');
  assert.ok(result.reasons.includes('PARTIAL_NUMERIC_COVERAGE'));
});

// Con số khác nhau là mâu thuẫn, không phải "gần đúng".
test('a conflicting number contradicts the claim', () => {
  const result = resolveClaimSupport(
    claim({ proposition: 'The device weighs 1 kg.' }),
    byId(evidence({ text: 'The device weighs 2 kg.' })),
  );
  assert.equal(result.status, 'CONTRADICTED');
  assert.ok(result.reasons.includes('NUMERIC_CONFLICT'));
});

test('evidence explicitly marked as contradicting wins over any text similarity', () => {
  const result = resolveClaimSupport(claim(), byId(evidence({ relation: 'CONTRADICTS' })));
  assert.equal(result.status, 'CONTRADICTED');
  assert.ok(result.reasons.includes('CONTRADICTING_EVIDENCE'));
});

test('an evidence reference that points nowhere needs review, not a verdict', () => {
  const result = resolveClaimSupport(claim({ evidenceRefs: ['e_missing'] }), {});
  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.ok(result.reasons.includes('MISSING_EVIDENCE'));
});

test('evidence with no locator cannot be checked, so it needs review', () => {
  const result = resolveClaimSupport(claim(), byId(evidence({ locator: {} })));
  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.ok(result.reasons.includes('AMBIGUOUS_LOCATOR'));
});

// Ý kiến của một người không biến một câu thành sự thật.
test('an opinion cannot fully support a factual claim', () => {
  const result = resolveClaimSupport(
    claim({ proposition: 'The tool is reliable.', type: 'FACT' }),
    byId(evidence({ type: 'OPINION', text: 'The tool is reliable.' })),
  );
  assert.equal(result.status, 'PARTIALLY_SUPPORTED');
  assert.ok(result.reasons.includes('OPINION_CANNOT_ESTABLISH_FACT'));
});

test('an inference supports partially and is never mistaken for a source statement', () => {
  const result = resolveClaimSupport(
    claim({ proposition: 'Costs will fall.', type: 'CLAIM' }),
    byId(evidence({ type: 'INFERENCE', text: 'Costs will fall.' })),
  );
  assert.equal(result.status, 'PARTIALLY_SUPPORTED');
});

test('explicit coverage metadata from the caller is honoured', () => {
  const result = resolveClaimSupport(claim(), byId(evidence({ coverage: 'PARTIAL' })));
  assert.equal(result.status, 'PARTIALLY_SUPPORTED');
  assert.ok(result.reasons.includes('DECLARED_PARTIAL_COVERAGE'));
});

test('the resolver never calls out to a model', () => {
  // Không có deps nào để tiêm: hàm là thuần và tất định. Chạy hai lần cho cùng kết quả.
  const first = resolveClaimSupport(claim(), byId(evidence()));
  const second = resolveClaimSupport(claim(), byId(evidence()));
  assert.deepEqual(first, second);
  assert.equal(resolveClaimSupport.length, 2, 'it takes a claim and an evidence map, nothing else');
});

// ================================================================ Giữ độ chắc

test('strength moving up or down is detected with a direction', () => {
  assert.deepEqual(
    compareClaimStrength(claim({ strength: 'QUALIFIED' }), claim({ strength: 'ABSOLUTE' })),
    { changed: true, direction: 'UP', from: 'QUALIFIED', to: 'ABSOLUTE', reason: 'STRENGTH_INCREASED' },
  );
  assert.equal(compareClaimStrength(claim({ strength: 'EXACT' }), claim({ strength: 'LIKELY' })).direction, 'DOWN');
  assert.equal(compareClaimStrength(claim({ strength: 'DIRECT' }), claim({ strength: 'DIRECT' })).changed, false);
});

// Đây là ràng buộc trung tâm của cả plan: một lần sửa văn không được biến "có thể giúp"
// thành "bảo đảm" khi không có bằng chứng nào mới.
test('raising strength without new evidence is an issue, not a style improvement', () => {
  const before = [claim({ strength: 'QUALIFIED', evidenceRefs: ['e1'], proposition: 'It may help retention.' })];
  const after = [claim({ strength: 'ABSOLUTE', evidenceRefs: ['e1'], proposition: 'It guarantees retention.' })];
  const result = assertClaimStrengthPreserved(before, after, byId(evidence()));
  assert.equal(result.ok, false);
  assert.equal(result.issues[0].code, 'CLAIM_STRENGTH_INCREASE_UNSUPPORTED');
  assert.equal(result.issues[0].claimId, 'c1');
  assert.equal(result.issues[0].repairAction, 'QUALIFY_CLAIM');
});

test('raising strength is allowed when new supporting evidence arrived', () => {
  const before = [claim({ strength: 'QUALIFIED', evidenceRefs: ['e1'] })];
  const after = [claim({ strength: 'EXACT', evidenceRefs: ['e1', 'e2'] })];
  const result = assertClaimStrengthPreserved(before, after, byId(evidence(), evidence({ evidenceId: 'e2' })));
  assert.equal(result.ok, true, 'new evidence is exactly what justifies a firmer statement');
});

test('new evidence that contradicts does not license a stronger claim', () => {
  const before = [claim({ strength: 'QUALIFIED', evidenceRefs: ['e1'] })];
  const after = [claim({ strength: 'ABSOLUTE', evidenceRefs: ['e1', 'e2'] })];
  const result = assertClaimStrengthPreserved(
    before, after, byId(evidence(), evidence({ evidenceId: 'e2', relation: 'CONTRADICTS' })),
  );
  assert.equal(result.ok, false);
});

test('softening a claim is always allowed', () => {
  const result = assertClaimStrengthPreserved(
    [claim({ strength: 'ABSOLUTE' })], [claim({ strength: 'QUALIFIED' })], byId(evidence()),
  );
  assert.equal(result.ok, true);
});

test('a claim invented during an edit is flagged when it has no evidence', () => {
  const after = [claim(), claim({ claimId: 'c2', proposition: 'It doubles conversion.', evidenceRefs: [] })];
  const result = assertClaimStrengthPreserved([claim()], after, byId(evidence()));
  assert.equal(result.ok, false);
  assert.equal(result.issues[0].code, 'CLAIM_ADDED_UNSUPPORTED');
  assert.equal(result.issues[0].claimId, 'c2');
});

test('quietly dropping the evidence behind a claim is reported', () => {
  const result = assertClaimStrengthPreserved(
    [claim({ evidenceRefs: ['e1'] })], [claim({ evidenceRefs: [] })], byId(evidence()),
  );
  assert.equal(result.ok, false);
  assert.equal(result.issues[0].code, 'CLAIM_EVIDENCE_DROPPED');
});

test('an unchanged set of claims passes cleanly', () => {
  const claims = [claim({ evidenceRefs: ['e1'] })];
  const result = assertClaimStrengthPreserved(claims, claims, byId(evidence()));
  assert.deepEqual(result, { ok: true, issues: [] });
});

// Xóa hẳn một luận điểm là quyết định biên tập hợp lệ — không phải mọi thay đổi đều là lỗi.
test('removing a claim entirely is not treated as a violation', () => {
  const result = assertClaimStrengthPreserved([claim(), claim({ claimId: 'c2' })], [claim()], byId(evidence()));
  assert.equal(result.ok, true);
});

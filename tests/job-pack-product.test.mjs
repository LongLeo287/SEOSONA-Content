import test from 'node:test';
import assert from 'node:assert/strict';
import { productPack, validateProductClaims } from '../runtime/writing/job-packs/product.mjs';

const FACTS = [
  { factId: 'f_weight', name: 'Khối lượng', value: '1', unit: 'kg', sourceRef: 's1', locator: { row: 4 } },
  { factId: 'f_material', name: 'Chất liệu', value: 'nhôm', sourceRef: 's1', locator: { row: 5 } },
  { factId: 'f_battery', name: 'Thời lượng pin', value: '12', unit: 'giờ', sourceRef: 's1', locator: { row: 6 } },
];

const EVIDENCE = {
  e_test: {
    evidenceId: 'e_test', sourceId: 's2', type: 'STATISTIC',
    text: 'Thử nghiệm nội bộ: 12 giờ dùng liên tục.', locator: { line: 9 }, relation: 'SUPPORTS',
  },
};

const content = (overrides = {}) => ({
  contentId: 'content_1',
  jobType: 'product',
  fields: {
    title: 'Đèn bàn Aurora',
    longDescription: 'Đèn bàn nhôm, pin 12 giờ.',
    specs: [
      { name: 'Khối lượng', value: '1', unit: 'kg', factRef: 'f_weight' },
      { name: 'Chất liệu', value: 'nhôm', factRef: 'f_material' },
    ],
    features: [{ text: 'Vỏ nhôm nguyên khối', factRef: 'f_material' }],
    benefits: [],
    faq: [],
    ...(overrides.fields || {}),
  },
  sourceRefs: ['s1'],
  claimRefs: [],
  ...overrides,
});

const check = (draft) => validateProductClaims(draft, FACTS, EVIDENCE);
const codes = (result) => result.issues.map((i) => i.code);

// ---------------------------------------------------------------- dữ kiện

test('a spec copied exactly from a product fact passes', () => {
  const result = check(content());
  assert.deepEqual(result, { ok: true, issues: [] });
});

// Đây là ràng buộc quan trọng nhất của pack này: một con số bị đổi trong lúc viết cho ra
// mô tả sản phẩm sai, và người mua sẽ nhận về một thứ khác với thứ họ đọc.
test('a changed numeric spec is blocked, not smoothed over', () => {
  const draft = content();
  draft.fields.specs[0].value = '0.9';
  const result = check(draft);
  assert.equal(result.ok, false);
  const issue = result.issues.find((i) => i.code === 'NUMERIC_FACT_MISMATCH');
  assert.equal(issue.factId, 'f_weight');
  assert.equal(issue.expected, '1');
  assert.equal(issue.actual, '0.9');
  assert.equal(issue.repairAction, 'RESTORE_SOURCE_FACT');
});

test('a changed unit is a mismatch even when the number is right', () => {
  const draft = content();
  draft.fields.specs[0].unit = 'g';
  assert.ok(codes(check(draft)).includes('UNIT_FACT_MISMATCH'));
});

// V1 cố ý KHÔNG tự quy đổi đơn vị. "1 kg" và "1000 g" bằng nhau về mặt vật lý, nhưng một
// bộ quy đổi tự động chưa được kiểm chứng sẽ âm thầm đổi số liệu sản phẩm.
test('unit conversion is not attempted in V1', () => {
  const draft = content();
  draft.fields.specs[0].value = '1000';
  draft.fields.specs[0].unit = 'g';
  const result = check(draft);
  assert.equal(result.ok, false, 'an equivalent value is still a rewrite of the source figure');
});

test('a spec that maps to no product fact at all is blocked', () => {
  const draft = content();
  draft.fields.specs.push({ name: 'Độ sáng', value: '800', unit: 'lumen', factRef: 'f_khong_co' });
  assert.ok(codes(check(draft)).includes('UNKNOWN_FACT_REFERENCE'));

  const unlinked = content();
  unlinked.fields.specs.push({ name: 'Độ sáng', value: '800', unit: 'lumen' });
  assert.ok(codes(check(unlinked)).includes('SPEC_WITHOUT_SOURCE'));
});

test('a text spec must match its fact exactly too', () => {
  const draft = content();
  draft.fields.specs[1].value = 'hợp kim nhôm cao cấp';
  assert.ok(codes(check(draft)).includes('TEXT_FACT_MISMATCH'));
});

// ---------------------------------------------------------------- tính năng và lợi ích

test('a feature must trace back to a fact or to evidence', () => {
  const draft = content();
  draft.fields.features.push({ text: 'Chống nước' });
  const result = check(draft);
  assert.equal(result.ok, false);
  assert.equal(result.issues.find((i) => i.code === 'FEATURE_WITHOUT_SOURCE').text, 'Chống nước');
});

// Biến một đặc tính thành một lời hứa là bước nhảy mà không dữ kiện nào tự nó cho phép.
// "Vỏ nhôm" là dữ kiện; "bền hơn mọi đối thủ" là điều phải chứng minh riêng.
test('a feature turned into an unsupported benefit is blocked', () => {
  const draft = content();
  draft.fields.benefits.push({ text: 'Bền hơn mọi sản phẩm cùng tầm giá', derivedFromFactRef: 'f_material' });
  const result = check(draft);
  assert.equal(result.ok, false);
  const issue = result.issues.find((i) => i.code === 'UNSUPPORTED_BENEFIT');
  assert.equal(issue.repairAction, 'ADD_EVIDENCE');
});

test('a benefit with real supporting evidence passes', () => {
  const draft = content();
  draft.fields.benefits.push({ text: 'Dùng cả ngày không cần sạc', evidenceRefs: ['e_test'] });
  assert.equal(check(draft).ok, true);
});

test('a benefit pointing at evidence that does not exist is not support', () => {
  const draft = content();
  draft.fields.benefits.push({ text: 'Dùng cả ngày không cần sạc', evidenceRefs: ['e_khong_co'] });
  assert.ok(codes(check(draft)).includes('UNKNOWN_EVIDENCE_REFERENCE'));
});

test('a benefit backed by evidence that contradicts it is not support either', () => {
  const draft = content();
  draft.fields.benefits.push({ text: 'Pin 20 giờ', evidenceRefs: ['e_against'] });
  const result = validateProductClaims(draft, FACTS, {
    ...EVIDENCE,
    e_against: { ...EVIDENCE.e_test, evidenceId: 'e_against', relation: 'CONTRADICTS' },
  });
  assert.ok(codes(result).includes('CONTRADICTED_BENEFIT'));
});

// Thiếu chỗ dựa thì KHÔNG được tự vá bằng cách bịa ra bằng chứng. Cách sửa đúng là bỏ câu
// đó đi hoặc hạ giọng xuống, và đó là quyết định của người viết.
test('missing support is never auto repaired by inventing evidence', () => {
  const draft = content();
  draft.fields.benefits.push({ text: 'Tiết kiệm 50% điện' });
  const result = check(draft);
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.issues.find((i) => i.code === 'UNSUPPORTED_BENEFIT').repairOptions,
    ['ADD_EVIDENCE', 'QUALIFY_CLAIM', 'REMOVE_CLAIM'],
  );
});

// ---------------------------------------------------------------- dữ kiện thương mại

// Giá, tình trạng hàng và khuyến mãi là loại dữ kiện gây thiệt hại thật khi sai. Không có
// trong nguồn thì không được xuất hiện trong bài, kể cả nghe rất hợp lý.
test('price, stock and offers absent from the source are blocked', () => {
  for (const text of [
    'Giá chỉ 499.000đ',
    'Miễn phí vận chuyển toàn quốc',
    'Còn hàng, giao ngay hôm nay',
    'Giảm 30% trong tuần này',
    'Bảo hành 24 tháng',
  ]) {
    const draft = content();
    draft.fields.longDescription = `Đèn bàn nhôm, pin 12 giờ. ${text}`;
    const result = check(draft);
    assert.equal(result.ok, false, text);
    assert.ok(codes(result).includes('INVENTED_COMMERCIAL_FACT'), text);
  }
});

test('a commercial fact that is in the source is allowed through', () => {
  const draft = content();
  draft.fields.longDescription = 'Đèn bàn nhôm. Bảo hành 24 tháng.';
  const facts = [...FACTS, { factId: 'f_warranty', name: 'Bảo hành', value: '24', unit: 'tháng', sourceRef: 's1', locator: { row: 7 } }];
  const result = validateProductClaims(draft, facts, EVIDENCE);
  assert.equal(result.ok, true, 'the source really does say 24 months');
});

// ---------------------------------------------------------------- FAQ

test('an FAQ answer that introduces an unsupported claim is blocked', () => {
  const draft = content();
  draft.fields.faq = [{ question: 'Pin dùng được bao lâu?', answer: 'Khoảng 30 giờ liên tục.' }];
  const result = check(draft);
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('UNSUPPORTED_FAQ_CLAIM'));
});

test('an FAQ answer backed by evidence passes', () => {
  const draft = content();
  draft.fields.faq = [{ question: 'Pin dùng được bao lâu?', answer: 'Khoảng 12 giờ liên tục.', evidenceRefs: ['e_test'] }];
  assert.equal(check(draft).ok, true);
});

test('an FAQ answer with no checkable claim needs no evidence', () => {
  const draft = content();
  draft.fields.faq = [{ question: 'Có dùng được ngoài trời không?', answer: 'Sản phẩm được thiết kế cho không gian trong nhà.' }];
  assert.equal(check(draft).ok, true);
});

// ---------------------------------------------------------------- pack

test('the product pack declares its shape, evaluators and required brief', () => {
  assert.equal(productPack.jobType, 'product');
  assert.ok(productPack.requiredEvaluators.includes('factuality'));
  assert.ok(productPack.requiredEvaluators.includes('claim-support'));
  assert.ok(productPack.outputContract.jsonSchema);
  assert.throws(() => productPack.buildBrief({ intent: 'TRANSACTIONAL' }), /objective/);
});

test('the pack validation runs the fact gate, not just the schema', () => {
  const draft = content();
  draft.fields.specs[0].value = '3';
  const result = productPack.validateDraft(draft, { productFacts: FACTS, evidenceById: EVIDENCE });
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('NUMERIC_FACT_MISMATCH'));
});

test('a product draft with no long description is incomplete', () => {
  const draft = content();
  draft.fields.longDescription = '';
  const result = productPack.validateDraft(draft, { productFacts: FACTS, evidenceById: EVIDENCE });
  assert.ok(codes(result).includes('MISSING_REQUIRED_FIELD'));
});

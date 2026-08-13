import { buildBrief } from '../brief.mjs';
import { assertSpecializedContent } from '../contracts.mjs';

// Job Pack: nội dung sản phẩm.
//
// Khác biệt lớn nhất so với bài blog: ở đây có NGUỒN SỰ THẬT rõ ràng. ProductFact là điều
// nhà sản xuất/catalog nói ra, và mô tả sản phẩm không được đi chệch khỏi nó.
//
// Sai ở đây gây thiệt hại thật. Một con số bị "làm tròn cho đẹp" trong lúc viết sẽ thành
// một người mua nhận về thứ khác với thứ họ đọc. Một câu "miễn phí vận chuyển" nghe rất hợp
// lý mà nguồn không hề nói sẽ thành một lời hứa người bán phải gánh.
//
// Nên toàn bộ cổng kiểm ở đây là TẤT ĐỊNH và thiên về CHẶN. Không có đường nào tự sửa bằng
// cách bịa thêm bằng chứng.

const REQUIRED_FIELDS = ['title', 'longDescription'];
const REQUIRED_BRIEF_FIELDS = ['objective', 'intent'];

// Từ ngữ về giá, tồn kho, khuyến mãi và bảo hành. Đây là nhóm dữ kiện gây hậu quả thật khi
// sai, nên phải có trong nguồn mới được xuất hiện.
const COMMERCIAL_PATTERNS = [
  { code: 'PRICE', re: /(\d[\d.,]*\s*(đ|vnd|usd|\$))|(giá\s+(chỉ|từ)?\s*\d)|(price)/i },
  { code: 'DISCOUNT', re: /(giảm\s*\d+\s*%)|(sale\s*\d+)|(khuyến mãi)|(ưu đãi)|(discount)/i },
  { code: 'SHIPPING', re: /(miễn phí (vận chuyển|giao hàng))|(free ship)|(freeship)/i },
  { code: 'STOCK', re: /(còn hàng)|(hết hàng)|(giao ngay)|(in stock)|(sẵn hàng)/i },
  { code: 'WARRANTY', re: /(bảo hành)|(warranty)|(đổi trả trong)/i },
];

const NUMBER_RE = /\d+(?:[.,]\d+)?/g;
const NUMERIC_VALUE_RE = /^-?\d+(?:[.,]\d+)?$/;

const normalizeNumber = (value) => String(value).trim().replace(',', '.');
const normalizeText = (value) => String(value).trim().toLowerCase();

function issue(code, extra = {}) {
  return { code, repairAction: 'RESTORE_SOURCE_FACT', ...extra };
}

/**
 * Cổng kiểm dữ kiện: mọi spec, tính năng, lợi ích và câu trả lời FAQ phải truy về được
 * một ProductFact hoặc một mẩu Evidence.
 */
export function validateProductClaims(content, productFacts = [], evidenceById = {}) {
  const fields = content?.fields || {};
  const factsById = new Map(productFacts.map((f) => [f.factId, f]));
  const issues = [];

  const supportedBy = (refs = []) => {
    const missing = refs.filter((id) => !evidenceById[id]);
    const contradicting = refs.filter((id) => evidenceById[id]?.relation === 'CONTRADICTS');
    const supporting = refs.filter((id) => evidenceById[id] && evidenceById[id].relation !== 'CONTRADICTS');
    return { missing, contradicting, supporting };
  };

  // --- specs: phải khớp CHÍNH XÁC với ProductFact ---
  for (const [index, spec] of (fields.specs || []).entries()) {
    if (!spec.factRef) {
      issues.push(issue('SPEC_WITHOUT_SOURCE', { index, name: spec.name }));
      continue;
    }
    const fact = factsById.get(spec.factRef);
    if (!fact) {
      issues.push(issue('UNKNOWN_FACT_REFERENCE', { index, factId: spec.factRef }));
      continue;
    }

    const isNumeric = NUMERIC_VALUE_RE.test(String(fact.value).trim());
    if (isNumeric) {
      // V1 KHÔNG quy đổi đơn vị. "1 kg" và "1000 g" bằng nhau về vật lý, nhưng một bộ quy đổi
      // chưa được kiểm chứng sẽ âm thầm viết lại số liệu sản phẩm — và không ai phát hiện ra.
      if (normalizeNumber(spec.value) !== normalizeNumber(fact.value)) {
        issues.push(issue('NUMERIC_FACT_MISMATCH', { index, factId: fact.factId, expected: String(fact.value), actual: String(spec.value) }));
      }
    } else if (normalizeText(spec.value) !== normalizeText(fact.value)) {
      issues.push(issue('TEXT_FACT_MISMATCH', { index, factId: fact.factId, expected: fact.value, actual: spec.value }));
    }

    const factUnit = fact.unit ? normalizeText(fact.unit) : '';
    const specUnit = spec.unit ? normalizeText(spec.unit) : '';
    if (factUnit !== specUnit) {
      issues.push(issue('UNIT_FACT_MISMATCH', { index, factId: fact.factId, expected: fact.unit ?? null, actual: spec.unit ?? null }));
    }
  }

  // --- tính năng: là điều nguồn nói, phải truy về nguồn ---
  for (const [index, feature] of (fields.features || []).entries()) {
    const refs = feature.evidenceRefs || [];
    if (feature.factRef && factsById.has(feature.factRef)) continue;
    if (feature.factRef && !factsById.has(feature.factRef)) {
      issues.push(issue('UNKNOWN_FACT_REFERENCE', { index, factId: feature.factRef }));
      continue;
    }
    const { supporting, missing } = supportedBy(refs);
    if (missing.length) issues.push(issue('UNKNOWN_EVIDENCE_REFERENCE', { index, evidenceIds: missing, repairAction: 'ADD_EVIDENCE' }));
    else if (!supporting.length) {
      issues.push({ code: 'FEATURE_WITHOUT_SOURCE', index, text: feature.text, repairAction: 'ADD_EVIDENCE' });
    }
  }

  // --- lợi ích: phải có chỗ dựa RIÊNG ---
  // Biến một đặc tính thành một lời hứa là bước nhảy mà không dữ kiện nào tự nó cho phép:
  // "vỏ nhôm" là dữ kiện, "bền hơn mọi đối thủ" là điều phải chứng minh riêng.
  for (const [index, benefit] of (fields.benefits || []).entries()) {
    const { supporting, missing, contradicting } = supportedBy(benefit.evidenceRefs || []);
    if (missing.length) {
      issues.push({ code: 'UNKNOWN_EVIDENCE_REFERENCE', index, evidenceIds: missing, repairAction: 'ADD_EVIDENCE' });
      continue;
    }
    if (contradicting.length) {
      issues.push({ code: 'CONTRADICTED_BENEFIT', index, text: benefit.text, evidenceIds: contradicting, repairAction: 'REMOVE_CLAIM' });
      continue;
    }
    if (!supporting.length) {
      issues.push({
        code: 'UNSUPPORTED_BENEFIT', index, text: benefit.text,
        repairAction: 'ADD_EVIDENCE',
        // Nêu rõ các cách sửa HỢP LỆ. Không có lựa chọn nào là "tự tạo bằng chứng" —
        // cách sửa đúng là tìm chỗ dựa thật, hạ giọng, hoặc bỏ câu đó đi.
        repairOptions: ['ADD_EVIDENCE', 'QUALIFY_CLAIM', 'REMOVE_CLAIM'],
      });
    }
  }

  // --- FAQ: câu trả lời có dữ kiện kiểm chứng được thì phải có chỗ dựa ---
  for (const [index, entry] of (fields.faq || []).entries()) {
    const answer = String(entry.answer || '');
    const hasCheckableClaim = NUMBER_RE.test(answer);
    NUMBER_RE.lastIndex = 0;
    if (!hasCheckableClaim) continue;

    const { supporting } = supportedBy(entry.evidenceRefs || []);
    const numbers = answer.match(NUMBER_RE) || [];
    const backedByFact = numbers.every((n) => productFacts.some((f) => normalizeNumber(f.value) === normalizeNumber(n)));
    const backedByEvidence = supporting.some((id) => numbers.every((n) => (evidenceById[id].text.match(NUMBER_RE) || []).map(normalizeNumber).includes(normalizeNumber(n))));
    if (!backedByFact && !backedByEvidence) {
      issues.push({ code: 'UNSUPPORTED_FAQ_CLAIM', index, question: entry.question, repairAction: 'ADD_EVIDENCE' });
    }
  }

  // --- dữ kiện thương mại: có trong nguồn mới được nói ---
  const prose = [fields.title, fields.shortDescription, fields.longDescription,
    ...(fields.features || []).map((f) => f.text),
    ...(fields.benefits || []).map((b) => b.text),
    ...(fields.faq || []).map((f) => f.answer),
  ].filter(Boolean).join('\n');

  const factText = productFacts.map((f) => `${f.name} ${f.value} ${f.unit || ''}`).join('\n').toLowerCase();
  for (const pattern of COMMERCIAL_PATTERNS) {
    if (!pattern.re.test(prose)) continue;
    // Nguồn có nói về loại dữ kiện này không? Không thì đây là điều bịa ra, dù nghe hợp lý.
    if (!pattern.re.test(factText)) {
      issues.push({
        code: 'INVENTED_COMMERCIAL_FACT', kind: pattern.code,
        message: `The copy states a ${pattern.code.toLowerCase()} fact that no product fact supports.`,
        repairAction: 'REMOVE_CLAIM',
      });
    }
  }

  return { ok: issues.length === 0, issues };
}

function validateProductFields(content) {
  for (const field of ['specs', 'features', 'benefits']) {
    const value = content.fields[field];
    if (value !== undefined && !Array.isArray(value)) {
      throw new TypeError(`productContent: "${field}" must be an array.`);
    }
  }
  return content;
}

export const productPack = {
  id: 'job.product',
  version: '1.0.0',
  jobType: 'product',
  requiredBriefFields: REQUIRED_BRIEF_FIELDS,
  requiredCapabilities: ['structured-output'],

  outputContract: {
    format: 'json',
    jsonSchema: {
      name: 'product_content',
      schema: {
        type: 'object',
        required: ['title', 'longDescription', 'specs', 'features'],
        properties: {
          title: { type: 'string' },
          shortDescription: { type: 'string' },
          longDescription: { type: 'string' },
          features: {
            type: 'array',
            items: {
              type: 'object', required: ['text'],
              properties: { text: { type: 'string' }, factRef: { type: 'string' }, evidenceRefs: { type: 'array', items: { type: 'string' } } },
            },
          },
          benefits: {
            type: 'array',
            items: {
              type: 'object', required: ['text'],
              properties: { text: { type: 'string' }, evidenceRefs: { type: 'array', items: { type: 'string' } } },
            },
          },
          specs: {
            type: 'array',
            items: {
              type: 'object', required: ['name', 'value', 'factRef'],
              properties: { name: { type: 'string' }, value: { type: 'string' }, unit: { type: 'string' }, factRef: { type: 'string' } },
            },
          },
          faq: {
            type: 'array',
            items: {
              type: 'object', required: ['question', 'answer'],
              properties: { question: { type: 'string' }, answer: { type: 'string' }, evidenceRefs: { type: 'array', items: { type: 'string' } } },
            },
          },
          metaTitle: { type: 'string' },
          metaDescription: { type: 'string' },
        },
      },
    },
  },

  structureRules: {},

  rules: [
    'Mọi thông số phải sao ĐÚNG NGUYÊN VĂN từ dữ kiện sản phẩm: không làm tròn, không đổi đơn vị, không diễn đạt lại.',
    'Mỗi tính năng phải gắn factRef hoặc evidenceRefs.',
    'Lợi ích là lời hứa, phải có bằng chứng riêng — không suy ra từ một đặc tính.',
    'Không nhắc tới giá, khuyến mãi, phí vận chuyển, tồn kho hay bảo hành nếu nguồn không nói.',
  ],

  requiredEvaluators: ['factuality', 'claim-support', 'brand', 'audience', 'job-specific'],

  buildBrief(input) {
    return buildBrief({ ...input, jobType: 'product' }, REQUIRED_BRIEF_FIELDS);
  },

  validateDraft(contentIR, context = {}) {
    const content = assertSpecializedContent(contentIR, validateProductFields);
    const issues = [];

    for (const field of REQUIRED_FIELDS) {
      if (!String(content.fields[field] || '').trim()) {
        issues.push({ code: 'MISSING_REQUIRED_FIELD', field, repairAction: 'REWRITE_SECTION' });
      }
    }

    issues.push(...validateProductClaims(content, context.productFacts || [], context.evidenceById || {}).issues);
    return { ok: issues.length === 0, issues };
  },

  definitionOfDone(contentIR, evaluations = []) {
    const byDimension = new Map(evaluations.map((e) => [e.dimension, e]));
    const blocking = [];
    for (const dimension of this.requiredEvaluators) {
      const evaluation = byDimension.get(dimension);
      if (!evaluation) { blocking.push({ code: 'EVALUATION_MISSING', dimension }); continue; }
      if (evaluation.verdict === 'BLOCK') blocking.push({ code: 'EVALUATION_BLOCKED', dimension });
      if (evaluation.verdict === 'REVIEW') blocking.push({ code: 'HUMAN_REVIEW_REQUIRED', dimension });
    }
    return { done: blocking.length === 0, blocking };
  },
};

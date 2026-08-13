import { buildBrief } from '../brief.mjs';
import { validateStructure } from '../structure.mjs';
import { assertSpecializedContent } from '../contracts.mjs';

// Job Pack: bài blog / bài viết dài.
//
// Mọi thứ ở đây kiểm được bằng LUẬT, không cần hỏi model: trường bắt buộc, dàn bài khớp với
// các mục đã viết, trích dẫn trỏ về bằng chứng có thật, cấu trúc heading, và ràng buộc của
// nơi đăng. Chạy các bài kiểm này TRƯỚC khi gọi model đánh giá là để không tốn một lượt chạy
// chỉ để nghe model nói "bài này thiếu tiêu đề".

const REQUIRED_FIELDS = ['title', 'outline', 'sections', 'body'];
const REQUIRED_BRIEF_FIELDS = ['objective', 'intent', 'angle'];

function issue(code, extra = {}) {
  return { code, repairAction: 'FIX_STRUCTURE', ...extra };
}

function validateArticleFields(content) {
  const { fields } = content;
  if (!Array.isArray(fields.sections)) throw new TypeError('articleContent: "sections" must be an array.');
  if (fields.outline !== undefined && !Array.isArray(fields.outline)) {
    throw new TypeError('articleContent: "outline" must be an array.');
  }
  return content;
}

export const articlePack = {
  id: 'job.article',
  version: '1.0.0',
  jobType: 'article',
  requiredBriefFields: REQUIRED_BRIEF_FIELDS,

  // Pack khai NĂNG LỰC cần có, không khai tên hãng: bài dài cần ngữ cảnh lớn và đầu ra có
  // cấu trúc, còn hãng nào đáp ứng được là việc của Auto Router.
  requiredCapabilities: ['long-context', 'structured-output'],

  outputContract: {
    format: 'json',
    jsonSchema: {
      name: 'article',
      schema: {
        type: 'object',
        required: ['title', 'outline', 'sections', 'body'],
        properties: {
          title: { type: 'string' },
          slug: { type: 'string' },
          metaTitle: { type: 'string' },
          metaDescription: { type: 'string' },
          outline: { type: 'array', items: { type: 'string' } },
          sections: {
            type: 'array',
            items: {
              type: 'object',
              required: ['heading', 'body'],
              properties: {
                heading: { type: 'string' },
                level: { type: 'integer' },
                body: { type: 'string' },
                evidenceRefs: { type: 'array', items: { type: 'string' } },
              },
            },
          },
          body: { type: 'string' },
        },
      },
    },
  },

  structureRules: { headingLevels: [2, 3] },

  // Bài blog không có trường nào là nguồn sự thật bất biến — mọi câu đều sửa được.
  immutableFields: [],

  rules: [
    'Mỗi mục phải trả lời một câu hỏi cụ thể của người đọc, không phải một chủ đề chung chung.',
    'Câu nào có số liệu hoặc dữ kiện kiểm chứng được thì phải gắn evidenceRefs.',
    'Không mở bài bằng định nghĩa hay bối cảnh chung; vào thẳng việc người đọc đang cần.',
  ],

  // SEO/GEO cố ý KHÔNG nằm trong danh sách bắt buộc: không phải bài nào cũng là bài SEO,
  // và bắt mọi bài phải qua bài kiểm SEO là ép một mục tiêu lên bài không có mục tiêu đó.
  requiredEvaluators: ['factuality', 'claim-support', 'structure', 'brand', 'audience', 'readability'],

  buildBrief(input) {
    return buildBrief({ ...input, jobType: 'article' }, REQUIRED_BRIEF_FIELDS);
  },

  validateDraft(contentIR, context = {}) {
    const content = assertSpecializedContent(contentIR, validateArticleFields);
    const { fields } = content;
    const issues = [];

    for (const field of REQUIRED_FIELDS) {
      const value = fields[field];
      const empty = value === undefined || value === null
        || (typeof value === 'string' && !value.trim())
        || (Array.isArray(value) && !value.length);
      if (empty) issues.push(issue('MISSING_REQUIRED_FIELD', { field, repairAction: 'REWRITE_SECTION' }));
    }

    const sections = fields.sections || [];
    issues.push(...validateStructure(sections, this.structureRules).issues);

    // Dàn bài và bài viết phải là một. Lệch nhau nghĩa là có mục đã hứa mà không viết,
    // hoặc có mục viết ra mà dàn bài không nhắc — cả hai đều là bài chưa xong.
    const outline = (fields.outline || []).map((h) => String(h).trim().toLowerCase());
    const written = sections.map((s) => String(s?.heading || '').trim().toLowerCase());
    for (const heading of outline) {
      if (heading && !written.includes(heading)) {
        issues.push(issue('OUTLINE_SECTION_MISMATCH', { heading, side: 'OUTLINE_ONLY', repairAction: 'REWRITE_SECTION' }));
      }
    }
    for (const heading of written) {
      if (heading && outline.length && !outline.includes(heading)) {
        issues.push(issue('OUTLINE_SECTION_MISMATCH', { heading, side: 'SECTION_ONLY' }));
      }
    }

    // Trích dẫn trỏ vào bằng chứng không tồn tại là kiểu hỏng tệ nhất: bài đọc như có nguồn,
    // lần theo thì không có gì ở đó. Nguy hiểm hơn hẳn một bài thẳng thắn không dẫn nguồn.
    const evidenceById = context.evidenceById || {};
    for (const [index, section] of sections.entries()) {
      for (const evidenceId of section?.evidenceRefs || []) {
        if (!evidenceById[evidenceId]) {
          issues.push({ code: 'UNSUPPORTED_CITATION', index, evidenceId, repairAction: 'ADD_EVIDENCE' });
        }
      }
    }

    const claimsById = context.claimsById || {};
    for (const claimId of content.claimRefs) {
      if (!claimsById[claimId]) {
        issues.push({ code: 'UNKNOWN_CLAIM_REFERENCE', claimId, repairAction: 'ADD_EVIDENCE' });
      }
    }

    // Ràng buộc của nơi đăng chỉ áp khi nơi đăng NÓI RÕ. Tự đặt ra "tiêu đề tối đa 60 ký tự"
    // rồi chặn bài của người dùng là áp một con số không ai xác nhận.
    const target = context.target;
    if (target) {
      for (const field of target.fieldSet || []) {
        if (!String(fields[field] || '').trim()) {
          issues.push({ code: 'MISSING_TARGET_FIELD', field, repairAction: 'REWRITE_SECTION' });
        }
      }
      for (const [field, rule] of Object.entries(target.lengthRules || {})) {
        const value = String(fields[field] || '');
        if (rule.max && value.length > rule.max) {
          issues.push({ code: 'TARGET_LENGTH_EXCEEDED', field, length: value.length, max: rule.max, repairAction: 'REWRITE_SECTION' });
        }
        if (rule.min && value.length && value.length < rule.min) {
          issues.push({ code: 'TARGET_LENGTH_TOO_SHORT', field, length: value.length, min: rule.min, repairAction: 'REWRITE_SECTION' });
        }
      }
    }

    return { ok: issues.length === 0, issues };
  },

  definitionOfDone(contentIR, evaluations = []) {
    const byDimension = new Map(evaluations.map((e) => [e.dimension, e]));
    const blocking = [];

    for (const dimension of this.requiredEvaluators) {
      const evaluation = byDimension.get(dimension);
      // Chưa chạy thì không phải là đạt. "Không có tin xấu" khác "có tin tốt".
      if (!evaluation) { blocking.push({ code: 'EVALUATION_MISSING', dimension }); continue; }
      if (evaluation.verdict === 'BLOCK') blocking.push({ code: 'EVALUATION_BLOCKED', dimension });
      // REVIEW nghĩa là cần người xem, không phải "coi như đạt".
      if (evaluation.verdict === 'REVIEW') blocking.push({ code: 'HUMAN_REVIEW_REQUIRED', dimension });
      // WARN cố ý KHÔNG chặn: cảnh báo mà chặn thì người dùng sẽ học cách phớt lờ cảnh báo.
    }

    return { done: blocking.length === 0, blocking };
  },
};

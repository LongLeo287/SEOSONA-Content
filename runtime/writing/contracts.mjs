import { CLAIM_STRENGTH as CAUSAL_STRENGTH } from '../domain/records.mjs';

// Hợp đồng dùng chung của Writing Core.
//
// Hai nguyên tắc chạy suốt file này:
//
//  1. IM LẶNG KHÔNG PHẢI LÀ SỰ ĐỒNG Ý. Một luận điểm không nói rõ trạng thái thì là
//     NEEDS_REVIEW, không phải SUPPORTED; độ chắc mặc định là mức yếu nhất; độ tin cậy
//     chưa đo là `null`, không phải 1. Mặc định "lạc quan" ở đây nghĩa là hệ thống tự
//     khẳng định thay người viết những điều chưa ai kiểm chứng.
//
//  2. NỘI DUNG KHÔNG BIẾT NÓ ĐƯỢC VIẾT BỞI AI NÀO. ContentIR chỉ chứa dữ liệu ngữ nghĩa.
//     providerId, phiên model, URL chat, prompt… thuộc về ProviderReceipt. Để chúng lọt vào
//     đây là buộc nội dung dính vào một nhà cung cấp, và mọi thứ dựng trên nó cũng dính theo.

export const CLAIM_STATUSES = Object.freeze(['SUPPORTED', 'PARTIALLY_SUPPORTED', 'UNSUPPORTED', 'CONTRADICTED', 'NEEDS_REVIEW']);
export const EVIDENCE_TYPES = Object.freeze(['FACT', 'CLAIM', 'QUOTE', 'STATISTIC', 'OPINION', 'INFERENCE']);
export const EVIDENCE_RELATIONS = Object.freeze(['SUPPORTS', 'CONTRADICTS', 'RELATED']);

// Thang ĐỘ CHẮC CHẮN của câu khẳng định, có thứ tự. "có thể giúp" -> "bảo đảm" là đi lên,
// và đi lên mà không có bằng chứng mới là dấu hiệu bài viết đã hứa nhiều hơn nó chứng minh được.
export const ASSERTION_STRENGTH = Object.freeze(['QUALIFIED', 'LIKELY', 'DIRECT', 'EXACT', 'ABSOLUTE']);

// Thang QUAN HỆ NHÂN QUẢ giữ riêng, không gộp vào thang trên: "chắc chắn có liên quan" và
// "có thể gây ra" là hai chuyện khác nhau, gộp lại thì không phân biệt được nữa.
export { CAUSAL_STRENGTH };

export const VERDICTS = Object.freeze(['PASS', 'WARN', 'REVIEW', 'BLOCK']);
export const KNOWLEDGE_LEVELS = Object.freeze(['BEGINNER', 'INTERMEDIATE', 'EXPERT', 'MIXED']);
export const EVIDENCE_POLICIES = Object.freeze(['SOURCE_BACKED', 'SOURCE_REQUIRED', 'EXPLORATORY']);
export const REVISION_OPERATIONS = Object.freeze(['CREATE', 'EDIT', 'REPAIR', 'ADAPT', 'REPURPOSE', 'RESTORE']);

// Evaluator ĐỀ NGHỊ việc cần làm, không tự sửa bài. Danh sách đóng để một finding không thể
// yêu cầu một hành động mà không ai định nghĩa.
export const REPAIR_ACTIONS = Object.freeze([
  'REWRITE_SECTION', 'QUALIFY_CLAIM', 'ADD_EVIDENCE', 'REMOVE_CLAIM',
  'RESTORE_SOURCE_FACT', 'FIX_STRUCTURE', 'HUMAN_REVIEW',
]);

export const EVALUATION_DIMENSIONS = Object.freeze([
  'factuality', 'claim-support', 'claim-strength', 'brand', 'audience', 'structure',
  'readability', 'concision', 'deslop', 'redundancy', 'cta', 'seo', 'geo', 'target-fit', 'job-specific',
]);

// Tên trường thuộc tầng nhà cung cấp hoặc tầng trình duyệt. So khớp bỏ hoa thường và dấu ngăn.
const PROVIDER_FIELDS = new Map([
  ['providerid', 'provider'], ['provider', 'provider'], ['modelsession', 'modelSession'],
  ['model', 'modelSession'], ['chaturl', 'chatUrl'], ['tabid', 'tabId'], ['selector', 'selector'],
  ['prompt', 'promptText'], ['prompttext', 'promptText'], ['apikey', 'apiKey'],
  ['cookie', 'cookie'], ['authorization', 'apiKey'], ['receipt', 'providerReceipt'],
]);

function fail(what, message) {
  throw new TypeError(`${what}: ${message}`);
}

function text(value, field, what, { required = true, allowEmpty = false } = {}) {
  if (value === undefined || value === null) {
    if (required) fail(what, `"${field}" is required.`);
    return null;
  }
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) {
    fail(what, `"${field}" must be a non-empty string.`);
  }
  return value;
}

function oneOf(value, allowed, field, what, fallback) {
  if (value === undefined || value === null) {
    if (fallback !== undefined) return fallback;
    fail(what, `"${field}" is required and must be one of ${allowed.join(', ')}.`);
  }
  if (!allowed.includes(value)) fail(what, `"${field}" must be one of ${allowed.join(', ')}.`);
  return value;
}

function stringArray(value, field, what) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !v.trim())) {
    fail(what, `"${field}" must be an array of non-empty strings.`);
  }
  return [...value];
}

function plainObject(value, field, what, { required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) fail(what, `"${field}" is required.`);
    return {};
  }
  if (typeof value !== 'object' || Array.isArray(value)) fail(what, `"${field}" must be an object.`);
  return value;
}

function unitOrNull(value, field, what) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    fail(what, `"${field}" must be a number between 0 and 1.`);
  }
  return value;
}

function assertNoProviderFields(value, what) {
  for (const key of Object.keys(value)) {
    const canonical = PROVIDER_FIELDS.get(key.toLowerCase().replace(/[_-]/g, ''));
    if (canonical) {
      fail(what, `field "${key}" (${canonical}) belongs to the provider receipt, not to semantic content.`);
    }
  }
}

export function assertSourceArtifact(value) {
  const what = 'sourceArtifact';
  const v = plainObject(value, 'sourceArtifact', what, { required: true });
  return structuredClone({
    sourceId: text(v.sourceId, 'sourceId', what),
    kind: text(v.kind, 'kind', what),
    sha256: text(v.sha256, 'sha256', what),
    title: text(v.title, 'title', what, { required: false }),
    canonicalUrl: text(v.canonicalUrl, 'canonicalUrl', what, { required: false }),
    capturedAt: text(v.capturedAt, 'capturedAt', what, { required: false }),
    locatorScheme: text(v.locatorScheme, 'locatorScheme', what, { required: false }),
  });
}

export function assertEvidenceIR(value) {
  const what = 'evidenceIR';
  const v = plainObject(value, 'evidenceIR', what, { required: true });
  return structuredClone({
    evidenceId: text(v.evidenceId, 'evidenceId', what),
    // Bằng chứng không có nguồn thì không phải bằng chứng, chỉ là một câu ai đó đã gõ ra.
    sourceId: text(v.sourceId, 'sourceId', what),
    type: oneOf(v.type, EVIDENCE_TYPES, 'type', what),
    text: text(v.text, 'text', what),
    locator: plainObject(v.locator, 'locator', what),
    relation: oneOf(v.relation, EVIDENCE_RELATIONS, 'relation', what, 'SUPPORTS'),
    capturedAt: text(v.capturedAt, 'capturedAt', what, { required: false }),
  });
}

export function assertClaim(value) {
  const what = 'claim';
  const v = plainObject(value, 'claim', what, { required: true });
  return structuredClone({
    claimId: text(v.claimId, 'claimId', what),
    proposition: text(v.proposition, 'proposition', what),
    type: oneOf(v.type, EVIDENCE_TYPES, 'type', what, 'CLAIM'),
    // Mặc định là mức YẾU NHẤT và trạng thái CẦN XEM LẠI: hệ thống không tự khẳng định hộ.
    strength: oneOf(v.strength, ASSERTION_STRENGTH, 'strength', what, 'QUALIFIED'),
    causalStrength: v.causalStrength === undefined || v.causalStrength === null
      ? null
      : oneOf(v.causalStrength, CAUSAL_STRENGTH, 'causalStrength', what),
    status: oneOf(v.status, CLAIM_STATUSES, 'status', what, 'NEEDS_REVIEW'),
    evidenceRefs: stringArray(v.evidenceRefs, 'evidenceRefs', what),
    confidence: unitOrNull(v.confidence, 'confidence', what),
    locator: plainObject(v.locator, 'locator', what),
  });
}

export function assertAudienceContext(value) {
  const what = 'audienceContext';
  const v = plainObject(value, 'audienceContext', what, { required: true });
  if (typeof v.revision !== 'number' || !Number.isInteger(v.revision) || v.revision < 0) {
    fail(what, '"revision" is required so a run can be reproduced against the same audience.');
  }
  return structuredClone({
    audienceId: text(v.audienceId, 'audienceId', what, { required: false }),
    revision: v.revision,
    description: text(v.description, 'description', what),
    knowledgeLevel: oneOf(v.knowledgeLevel, KNOWLEDGE_LEVELS, 'knowledgeLevel', what, 'MIXED'),
    goals: stringArray(v.goals, 'goals', what),
    objections: stringArray(v.objections, 'objections', what),
    language: text(v.language, 'language', what, { required: false }),
  });
}

export function assertBrandContext(value) {
  const what = 'brandContext';
  const v = plainObject(value, 'brandContext', what, { required: true });
  if (typeof v.revision !== 'number' || !Number.isInteger(v.revision) || v.revision < 0) {
    fail(what, '"revision" is required so a run can be reproduced against the same brand voice.');
  }
  return structuredClone({
    brandId: text(v.brandId, 'brandId', what),
    revision: v.revision,
    voice: stringArray(v.voice, 'voice', what),
    do: stringArray(v.do, 'do', what),
    dont: stringArray(v.dont, 'dont', what),
    terminology: plainObject(v.terminology, 'terminology', what),
  });
}

export function assertBriefIR(value) {
  const what = 'briefIR';
  const v = plainObject(value, 'briefIR', what, { required: true });
  return structuredClone({
    briefId: text(v.briefId, 'briefId', what, { required: false }),
    jobType: text(v.jobType, 'jobType', what),
    objective: text(v.objective, 'objective', what),
    intent: text(v.intent, 'intent', what),
    angle: text(v.angle, 'angle', what),
    audience: v.audience ? assertAudienceContext(v.audience) : null,
    language: v.language === undefined || v.language === null ? 'vi-VN' : text(v.language, 'language', what),
    // Mặc định an toàn: bài viết phải dựa trên nguồn. Muốn viết tự do thì phải nói rõ.
    evidencePolicy: oneOf(v.evidencePolicy, EVIDENCE_POLICIES, 'evidencePolicy', what, 'SOURCE_BACKED'),
    mustCover: stringArray(v.mustCover, 'mustCover', what),
    mustAvoid: stringArray(v.mustAvoid, 'mustAvoid', what),
    notes: text(v.notes, 'notes', what, { required: false }),
  });
}

export function assertContentIR(value) {
  const what = 'contentIR';
  const v = plainObject(value, 'contentIR', what, { required: true });
  assertNoProviderFields(v, what);
  return structuredClone({
    contentId: text(v.contentId, 'contentId', what),
    jobType: text(v.jobType, 'jobType', what),
    language: v.language === undefined || v.language === null ? 'vi-VN' : text(v.language, 'language', what),
    fields: plainObject(v.fields, 'fields', what, { required: true }),
    sourceRefs: stringArray(v.sourceRefs, 'sourceRefs', what),
    claimRefs: stringArray(v.claimRefs, 'claimRefs', what),
    targetRef: text(v.targetRef, 'targetRef', what, { required: false }),
    metadata: plainObject(v.metadata, 'metadata', what),
  });
}

export function assertEvaluationResult(value) {
  const what = 'evaluationResult';
  const v = plainObject(value, 'evaluationResult', what, { required: true });
  const findings = (v.findings === undefined || v.findings === null ? [] : v.findings);
  if (!Array.isArray(findings)) fail(what, '"findings" must be an array.');

  return structuredClone({
    evaluationId: text(v.evaluationId, 'evaluationId', what),
    contentId: text(v.contentId, 'contentId', what),
    revisionId: text(v.revisionId, 'revisionId', what),
    dimension: oneOf(v.dimension, EVALUATION_DIMENSIONS, 'dimension', what),
    verdict: oneOf(v.verdict, VERDICTS, 'verdict', what),
    // Điểm số chưa chấm là null. Một số 0 ở đây sẽ bị đọc thành "chấm rồi và rất tệ".
    score: unitOrNull(v.score, 'score', what),
    evaluatorId: text(v.evaluatorId, 'evaluatorId', what),
    findings: findings.map((finding, i) => {
      const f = plainObject(finding, `findings[${i}]`, what, { required: true });
      return {
        code: text(f.code, `findings[${i}].code`, what),
        message: text(f.message, `findings[${i}].message`, what),
        locator: plainObject(f.locator, `findings[${i}].locator`, what),
        // Evaluator chỉ được đề nghị hành động đã định nghĩa; nó không tự sửa bài.
        repairAction: f.repairAction === undefined || f.repairAction === null
          ? null
          : oneOf(f.repairAction, REPAIR_ACTIONS, `findings[${i}].repairAction`, what),
      };
    }),
    at: text(v.at, 'at', what, { required: false }),
  });
}

export function assertRevisionPayload(value) {
  const what = 'revisionPayload';
  const v = plainObject(value, 'revisionPayload', what, { required: true });
  if (!v.content) fail(what, '"content" is required.');
  return structuredClone({
    operation: oneOf(v.operation, REVISION_OPERATIONS, 'operation', what),
    content: assertContentIR(v.content),
    instruction: text(v.instruction, 'instruction', what, { required: false }),
    evaluationRefs: stringArray(v.evaluationRefs, 'evaluationRefs', what),
    providerAttemptRef: text(v.providerAttemptRef, 'providerAttemptRef', what, { required: false }),
  });
}

/**
 * Hợp đồng chung kiểm trước, pack kiểm phần riêng của nó sau.
 *
 * Cố ý KHÔNG dựng một union khổng lồ chứa mọi trường của mọi loại nội dung: thêm một loại
 * nội dung mới không được buộc phải sửa hợp đồng mà mọi loại khác đang dùng.
 */
export function assertSpecializedContent(base, specializedValidator) {
  const content = assertContentIR(base);
  if (typeof specializedValidator !== 'function') return content;
  return specializedValidator(content);
}

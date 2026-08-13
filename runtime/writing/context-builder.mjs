import { assertBriefIR, assertBrandContext, assertAudienceContext } from './contracts.mjs';

// Dựng ContextBundle: gom mọi thứ cần để viết thành các KHỐI RIÊNG BIỆT, mỗi khối có
// định danh và số hiệu bản riêng.
//
// Vì sao không dùng một prompt lớn: khi mọi thứ trộn vào một chuỗi, không ai trả lời được
// mấy câu hỏi cơ bản — luật này đến từ đâu, bài hôm qua chạy với giọng thương hiệu bản mấy,
// đoạn văn bản kia là luật của ta hay là chữ lấy từ trang nguồn. Tách khối thì cả ba câu hỏi
// đều trả lời được, và mỗi phần thay đổi độc lập.

export const SECTION_ORDER = Object.freeze([
  'CORE_RULES', 'JOB_RULES', 'BRAND', 'AUDIENCE', 'BRIEF', 'EVIDENCE', 'TARGET', 'USER_TASK', 'OUTPUT_CONTRACT',
]);

function required(value, field) {
  if (!value) throw new TypeError(`contextBundle: "${field}" is required.`);
  return value;
}

function packOf(pack, field) {
  required(pack, field);
  if (!pack.id) throw new TypeError(`contextBundle: "${field}.id" is required.`);
  return {
    id: pack.id,
    version: pack.version || null,
    rules: Array.isArray(pack.rules) ? structuredClone(pack.rules) : [],
    outputContract: pack.outputContract ? structuredClone(pack.outputContract) : null,
  };
}

export function buildContextBundle({
  corePack,
  jobPack,
  brandContext = null,
  audienceContext = null,
  brief,
  evidence = [],
  targetPack = null,
  userInstruction = '',
  currentDraft = null,
} = {}) {
  const core = packOf(corePack, 'corePack');
  const job = packOf(jobPack, 'jobPack');
  required(brief, 'brief');

  return {
    corePack: core,
    jobPack: { ...job, jobType: jobPack.jobType || brief.jobType || null },
    brand: brandContext ? { ...assertBrandContext(brandContext), revision: brandContext.revision } : null,
    audience: audienceContext ? { ...assertAudienceContext(audienceContext), revision: audienceContext.revision } : null,
    // Brief mang số hiệu bản riêng: sửa brief rồi chạy lại là một lần chạy KHÁC, không phải
    // lần chạy cũ với kết quả khác.
    brief: { ...assertBriefIR(brief), revision: Number.isInteger(brief.revision) ? brief.revision : 0 },
    // Bằng chứng giữ nguyên sourceId và locator: không có hai thứ đó thì câu chữ trong bài
    // không truy ngược về đâu được nữa.
    evidence: (evidence || []).map((e) => ({
      evidenceId: e.evidenceId,
      sourceId: e.sourceId,
      type: e.type,
      text: e.text,
      locator: structuredClone(e.locator || {}),
    })),
    target: targetPack
      ? { id: targetPack.id, revision: targetPack.revision ?? 0, rules: structuredClone(targetPack.rules || []) }
      : null,
    userInstruction: String(userInstruction || ''),
    // Bản thảo đang sửa: đi kèm để model biết phải sửa cái gì, nhưng vẫn nằm trong hàng rào
    // dữ liệu như mọi văn bản khác.
    currentDraft: currentDraft ? structuredClone(currentDraft) : null,
  };
}

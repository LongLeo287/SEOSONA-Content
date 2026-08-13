// SEOSONA Content — IR CONTRACTS (IP-101)
// Bộ hợp đồng dữ liệu trung gian đi giữa các module, theo tab 04_IR_CONTRACTS của spec.
//
// BA NGUYÊN TẮC BẤT DI BẤT DỊCH (spec nhắc lại ở nhiều tab):
//   1. TRUNG LẬP NHÀ CUNG CẤP — không IR nào được chứa tên/đặc thù của ChatGPT/Gemini/...
//      Trao đổi với nhà cung cấp đi qua ProviderTask/ProviderResult/ProviderReceipt.
//   2. BẤT BIẾN — Revision, SourceArtifact, ContextSnapshot, EvaluationResult, ProviderReceipt
//      một khi đã tạo thì KHÔNG sửa. Muốn đổi thì tạo bản mới nối vào lineage.
//   3. GIỮ NGUYÊN MỨC KHẲNG ĐỊNH — Claim.strength chỉ được đổi khi có bằng chứng hỗ trợ.
//
// File này CHỈ định nghĩa hình dạng + kiểm tra. Không chứa logic UI, provider hay lưu trữ.

const IR_VERSION = '1.0.0';

// ---------------------------------------------------------------- tiện ích
const _isStr = (v) => typeof v === 'string' && v.length > 0;
const _isArr = (v) => Array.isArray(v);
const _now = () => new Date().toISOString();
let _seq = 0;
// id ổn định, không phụ thuộc thời gian hệ thống để dễ test
function irId(prefix) { _seq += 1; return `${prefix}_${Date.now().toString(36)}_${_seq.toString(36)}`; }

// ---------------------------------------------------------------- bảng khai báo
// Mỗi IR: required[] + optional[] + note. `immutable: true` = đã tạo thì không sửa.
const IR_SCHEMAS = {
  // ===== xương sống dùng chung =====
  BriefIR: {
    note: 'Chuẩn hóa ý định viết. Đầu vào của Structure/Generation.',
    required: ['objective', 'jobType'],
    optional: ['audience', 'topic', 'offer', 'constraints', 'target', 'deadline'],
  },
  ContentIR: {
    note: 'Nội dung ngữ nghĩa chuẩn, TRUNG LẬP nhà cung cấp.',
    required: ['intent', 'body'],
    optional: ['audience', 'angle', 'hook', 'cta', 'claims', 'sourceRefs'],
  },
  Revision: {
    note: 'Một lần thay đổi nội dung. BẤT BIẾN — chỉ nối thêm vào lineage.',
    immutable: true,
    required: ['revisionId', 'contentRef', 'operation', 'actor', 'at'],
    optional: ['parentRevisionId', 'diff', 'body', 'claimDiff'],
  },
  ContextBundle: {
    note: 'Ảnh chụp bối cảnh thực thi, ĐÓNG BĂNG theo job. Không đổi giữa chừng.',
    immutable: true,
    required: ['contextSnapshotId', 'hash', 'compiledAt'],
    optional: ['brand', 'audience', 'sources', 'evidence', 'jobPack', 'targetPack', 'policy', 'packVersions'],
  },

  // ===== IR chuyên biệt theo loại bài (V1 = 3 pack) =====
  ArticleIR: {
    note: 'Bài dài. V1 — chứng minh năng lực long-form.',
    required: ['title', 'outline'],
    optional: ['slug', 'intent', 'sections', 'faq', 'seo', 'geo', 'citations'],
  },
  ProductContentIR: {
    note: 'Nội dung sản phẩm. Dữ kiện sản phẩm là tối thượng — KHÔNG suy diễn lợi ích.',
    required: ['productRef', 'title'],
    optional: ['short', 'long', 'features', 'benefits', 'specs', 'faq', 'metadata'],
  },
  TranscriptIR: {
    note: 'Bản ghi lời. Nguồn thô là tối thượng.',
    immutable: true,
    required: ['sourceRef', 'cues'],
    optional: ['language', 'speakers', 'duration'],
  },
  CueIR: {
    note: 'Một cue phụ đề. rawText và timecode phải KHỚP 100% với nguồn.',
    immutable: true,
    required: ['index', 'start', 'end', 'rawText'],
    optional: ['speaker', 'sourceHash'],
  },

  // ===== chuỗi bằng chứng =====
  SourceArtifact: {
    note: 'Tài liệu nguồn đã nạp. Ảnh chụp gốc + hash không bao giờ đổi.',
    immutable: true,
    required: ['sourceId', 'hash', 'retrievedAt'],
    optional: ['mimeType', 'sourceUrl', 'parserVersion', 'title'],
  },
  Locator: {
    note: 'Chỉ chính xác vị trí trong nguồn (trang/dòng/timecode/DOM).',
    required: [],
    optional: ['page', 'sheet', 'range', 'slide', 'timestamp', 'dom', 'line'],
  },
  EvidenceIR: {
    note: 'Bằng chứng gắn với nguồn cụ thể. KHÔNG được bịa nguồn.',
    required: ['evidenceId', 'statement', 'sourceRef'],
    optional: ['locator', 'type', 'authority', 'verifiedAt', 'staleAfter'],
  },
  Claim: {
    note: 'Một khẳng định + mức độ. Đổi mức phải có bằng chứng hỗ trợ.',
    required: ['claimId', 'proposition', 'strength'],
    optional: ['type', 'qualification', 'evidenceRefs', 'status'],
  },

  // ===== bối cảnh thương hiệu / độc giả =====
  BrandContext: {
    note: 'Giọng, thuật ngữ, luật cấm, ví dụ đã duyệt.',
    required: [],
    optional: ['voice', 'terms', 'claims', 'evidence', 'negativeRules', 'examples'],
  },
  AudienceContext: {
    note: 'Chân dung độc giả. Không phải một dòng persona.',
    required: [],
    optional: ['awareness', 'pains', 'desires', 'objections', 'vocabulary', 'stage'],
  },

  // ===== đánh giá =====
  EvaluationResult: {
    note: 'Kết quả chấm ĐỘC LẬP, gắn cứng vào một revision bất biến. Self-score của bộ sinh KHÔNG thay thế được.',
    immutable: true,
    required: ['evaluationId', 'revisionId', 'evaluator', 'verdict'],
    optional: ['contextSnapshotId', 'score', 'findings', 'repairAction'],
  },

  // ===== giao tiếp với nhà cung cấp (KHÔNG mang tên vendor vào domain) =====
  ProviderTask: {
    note: 'Yêu cầu gửi cho gateway. Không chứa tên nhà cung cấp cụ thể.',
    required: ['taskType', 'outputContract'],
    optional: ['contentJob', 'capabilities', 'context', 'costPolicy', 'preference'],
  },
  ProviderResult: {
    note: 'Kết quả trả về từ adapter.',
    required: ['status'],
    optional: ['output', 'providerId', 'attempts', 'costClass', 'validation', 'warnings'],
  },
  ProviderReceipt: {
    note: 'Biên lai mỗi lần gọi. TUYỆT ĐỐI không lưu secret.',
    immutable: true,
    required: ['receiptId', 'provider', 'at'],
    optional: ['model', 'costClass', 'contextClass', 'resultDigest', 'latencyMs', 'attempts'],
  },
};

// Hạng chi phí (spec 10/23) — 'UNKNOWN_COST' KHÔNG được coi là miễn phí.
const COST_CLASS = ['ZERO_INCREMENTAL', 'FREE_QUOTA', 'PAID_ALLOWED', 'PAID_BLOCKED', 'UNKNOWN_COST'];
// Mức khẳng định, xếp từ yếu đến mạnh (dùng để phát hiện đẩy/hạ mức lén)
const CLAIM_STRENGTH = ['SUGGESTS', 'ASSOCIATED', 'PREDICTS', 'CONTRIBUTES', 'AFFECTS', 'CAUSES'];
// Trạng thái bằng chứng của một claim
const CLAIM_STATUS = ['SUPPORTED', 'PARTIALLY_SUPPORTED', 'UNSUPPORTED', 'CONTRADICTED', 'NEEDS_REVIEW'];
// Kết luận đánh giá
const VERDICT = ['PASS', 'WARN', 'REVIEW', 'BLOCK'];

// ---------------------------------------------------------------- kiểm tra
// Trả { ok, errors[] }. KHÔNG ném lỗi — nơi gọi tự quyết định xử lý.
function irValidate(kind, obj) {
  const schema = IR_SCHEMAS[kind];
  const errors = [];
  if (!schema) return { ok: false, errors: [`IR không tồn tại: ${kind}`] };
  if (!obj || typeof obj !== 'object') return { ok: false, errors: [`${kind}: không phải object`] };
  for (const f of schema.required) {
    const v = obj[f];
    const missing = v == null || v === '' || (_isArr(v) && v.length === 0);
    if (missing) errors.push(`${kind}: thiếu trường bắt buộc "${f}"`);
  }
  const known = new Set([...schema.required, ...schema.optional, '_ir', '_v']);
  for (const k of Object.keys(obj)) if (!known.has(k)) errors.push(`${kind}: trường lạ "${k}"`);
  // kiểm giá trị thuộc tập cho phép
  if (kind === 'Claim' && obj.strength && !CLAIM_STRENGTH.includes(obj.strength)) {
    errors.push(`Claim: strength "${obj.strength}" không thuộc ${CLAIM_STRENGTH.join('|')}`);
  }
  if (kind === 'Claim' && obj.status && !CLAIM_STATUS.includes(obj.status)) {
    errors.push(`Claim: status "${obj.status}" không hợp lệ`);
  }
  if (kind === 'EvaluationResult' && obj.verdict && !VERDICT.includes(obj.verdict)) {
    errors.push(`EvaluationResult: verdict "${obj.verdict}" không hợp lệ`);
  }
  if ((kind === 'ProviderResult' || kind === 'ProviderReceipt') && obj.costClass && !COST_CLASS.includes(obj.costClass)) {
    errors.push(`${kind}: costClass "${obj.costClass}" không hợp lệ`);
  }
  // biên lai không được mang secret
  if (kind === 'ProviderReceipt') {
    const blob = JSON.stringify(obj).toLowerCase();
    if (/"(apikey|api_key|token|secret|password|cookie)"/.test(blob)) {
      errors.push('ProviderReceipt: phát hiện trường giống secret — biên lai KHÔNG được chứa secret');
    }
  }
  return { ok: errors.length === 0, errors };
}

// Tạo một IR có gắn nhãn loại + version
function irMake(kind, data) {
  if (!IR_SCHEMAS[kind]) throw new Error('IR không tồn tại: ' + kind);
  return Object.assign({ _ir: kind, _v: IR_VERSION }, data || {});
}

// Kiểm tra một thao tác sửa có vi phạm tính bất biến không
function irAssertMutable(kind) {
  const s = IR_SCHEMAS[kind];
  return !(s && s.immutable);
}

// So mức khẳng định giữa 2 claim: trả 'same' | 'strengthened' | 'weakened' | 'unknown'
// Dùng ở bước Edit để phát hiện AI âm thầm đẩy/hạ mức mà không có bằng chứng mới.
function claimStrengthDelta(before, after) {
  const a = CLAIM_STRENGTH.indexOf(before);
  const b = CLAIM_STRENGTH.indexOf(after);
  if (a < 0 || b < 0) return 'unknown';
  if (a === b) return 'same';
  return b > a ? 'strengthened' : 'weakened';
}

const IRContracts = {
  VERSION: IR_VERSION, SCHEMAS: IR_SCHEMAS,
  COST_CLASS, CLAIM_STRENGTH, CLAIM_STATUS, VERDICT,
  make: irMake, validate: irValidate, id: irId, now: _now,
  isMutable: irAssertMutable, strengthDelta: claimStrengthDelta,
};

if (typeof module !== 'undefined' && module.exports) module.exports = IRContracts;

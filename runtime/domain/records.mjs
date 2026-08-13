// Hợp đồng BẢN GHI của Local Runtime — theo tab 25_LOCAL_DATA_MODEL của spec.
//
// PHÂN BIỆT VỚI extension/lib/ir-contracts.js:
//   - ir-contracts.js  = IR MIỀN (BriefIR, ContentIR…), chạy trong trình duyệt, mô tả *ngữ nghĩa* nội dung.
//   - records.mjs      = BẢN GHI LƯU TRỮ của Runtime, chạy trong Node, mô tả *thứ được ghi xuống đĩa*.
// Hai tầng khác nhau, cố ý không gộp: Runtime không được phụ thuộc code trình duyệt và ngược lại.
//
// Nguyên tắc:
//   - assertRecord() KHÔNG sửa đầu vào; trả về bản sao sâu.
//   - Loại bản ghi lạ bị từ chối thẳng (không im lặng bỏ qua).
//   - providerReceipt TUYỆT ĐỐI không được mang secret.

// Thang mức khẳng định (yếu → mạnh). Đổi mức phải có bằng chứng hỗ trợ.
export const CLAIM_STRENGTH = ['SUGGESTS', 'ASSOCIATED', 'PREDICTS', 'CONTRIBUTES', 'AFFECTS', 'CAUSES'];
export const VERDICT = ['PASS', 'WARN', 'REVIEW', 'BLOCK'];

// Tên trường trông giống secret — không bao giờ được nằm trong biên lai.
const SECRET_LIKE = /^(apikey|api_key|token|accesstoken|secret|password|cookie|authorization|bearer)$/i;

// Khai báo trường bắt buộc cho từng loại. Khóa chính + khóa ngoại theo 25_LOCAL_DATA_MODEL.
const SPEC = {
  workspace: { strings: ['workspaceId', 'name', 'createdAt'] },
  project: { strings: ['projectId', 'workspaceId', 'name', 'createdAt'] },
  brand: { strings: ['brandId', 'workspaceId', 'name', 'createdAt'] },
  // sha256 (không phải "hash" chung chung) vì blob được địa chỉ hóa bằng SHA-256;
  // giữ đúng một tên gọi để bản ghi và blobRef không lệch nhau.
  source: { strings: ['sourceId', 'projectId', 'sha256', 'retrievedAt'] },
  sourceBlock: { strings: ['blockId', 'sourceId'], objects: ['locator'] },
  evidence: { strings: ['evidenceId', 'sourceId', 'statement'] },
  claim: { strings: ['claimId', 'proposition', 'strength'] },
  content: { strings: ['contentId', 'projectId', 'contentJob', 'createdAt'] },
  // Cạnh phả hệ giữa hai nội dung: bài này được chuyển thể TỪ bài kia. Là bản ghi riêng chứ
  // không phải một trường trong content, để truy được cả hai chiều và để bản gốc không bị
  // sửa mỗi lần có ai chuyển thể từ nó.
  contentLineage: { strings: ['lineageId', 'fromContentId', 'toContentId', 'relation', 'createdAt'] },
  revision: { strings: ['revisionId', 'contentId', 'operation', 'createdAt'], objects: ['payload'] },
  // Job bị ghim vào một ContextSnapshot ngay từ đầu — chống "đổi bối cảnh giữa chừng".
  job: { strings: ['jobId', 'projectId', 'contextSnapshotId', 'status', 'createdAt'] },
  jobStage: { strings: ['stageId', 'jobId', 'stage', 'status'] },
  providerAttempt: { strings: ['attemptId', 'jobId', 'provider', 'startedAt'] },
  providerReceipt: { strings: ['receiptId', 'provider', 'at'] },
  evaluation: { strings: ['evaluationId', 'revisionId', 'evaluator', 'verdict'] },
  contextSnapshot: { strings: ['contextSnapshotId', 'hash', 'compiledAt'] },
  providerConfig: { strings: ['providerConfigId', 'provider'] },
  signal: { strings: ['signalId', 'type', 'at'] },
  appliedPageEvent: { strings: ['eventId', 'revisionId', 'url', 'surface', 'action', 'at'] },
};

export const RECORD_TYPES = Object.freeze(Object.keys(SPEC));

// Khóa chính của mỗi loại = trường string đầu tiên trong khai báo.
// Kho lưu trữ dùng bảng này để biết tên file, không tự đoán.
export const RECORD_ID_FIELD = Object.freeze(
  Object.fromEntries(Object.entries(SPEC).map(([type, s]) => [type, s.strings[0]])),
);

// Các loại BẤT BIẾN: ghi rồi thì nội dung khác không được đè lên (25_LOCAL_DATA_MODEL).
// Ghi lại y hệt thì chấp nhận (idempotent); khác byte thì báo IMMUTABLE_RECORD_CONFLICT.
export const IMMUTABLE_TYPES = Object.freeze(['revision', 'sourceBlock', 'providerReceipt', 'contextSnapshot']);

function requireString(value, field, type) {
  const v = value[field];
  if (typeof v !== 'string' || v.length === 0) {
    throw new TypeError(`${type}: field "${field}" must be a non-empty string.`);
  }
}

function requireObject(value, field, type) {
  const v = value[field];
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    throw new TypeError(`${type}: field "${field}" must be an object.`);
  }
}

export function assertRecord(type, value) {
  const spec = SPEC[type];
  if (!spec) throw new TypeError(`Unknown record type: ${type}`);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${type}: record must be an object.`);
  }

  for (const field of spec.strings || []) requireString(value, field, type);
  for (const field of spec.objects || []) requireObject(value, field, type);

  if (type === 'claim' && !CLAIM_STRENGTH.includes(value.strength)) {
    throw new TypeError(`claim: field "strength" must be one of ${CLAIM_STRENGTH.join('|')}.`);
  }
  if (type === 'evaluation' && !VERDICT.includes(value.verdict)) {
    throw new TypeError(`evaluation: field "verdict" must be one of ${VERDICT.join('|')}.`);
  }
  if (type === 'providerReceipt') {
    const offender = Object.keys(value).find((k) => SECRET_LIKE.test(k));
    if (offender) {
      throw new TypeError(`providerReceipt: field "${offender}" looks like secret material; receipts must never store secrets.`);
    }
  }

  return structuredClone(value);
}

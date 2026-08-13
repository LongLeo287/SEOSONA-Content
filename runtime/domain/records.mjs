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
  source: { strings: ['sourceId', 'projectId', 'hash', 'retrievedAt'] },
  sourceBlock: { strings: ['blockId', 'sourceId'], objects: ['locator'] },
  evidence: { strings: ['evidenceId', 'sourceId', 'statement'] },
  claim: { strings: ['claimId', 'proposition', 'strength'] },
  content: { strings: ['contentId', 'projectId', 'contentJob', 'createdAt'] },
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

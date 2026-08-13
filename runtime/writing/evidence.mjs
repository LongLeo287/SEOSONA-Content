import { assertEvidenceIR, EVIDENCE_TYPES } from './contracts.mjs';

// Phân loại bằng chứng — TẤT ĐỊNH, không gọi model.
//
// Việc ở đây không phải "đoán cho đúng" mà là "không đoán quá tay". Thứ tự ưu tiên:
//   1. Người gọi khai rõ loại  -> dùng luôn (họ biết nhiều hơn bất kỳ mẫu chuỗi nào).
//   2. Cờ cấu trúc rõ ràng     -> inferred / quote / attributedTo.
//   3. Mẫu trong văn bản       -> chỉ dùng để HẠ cấp, không dùng để nâng lên FACT.
//   4. Không có gì             -> CLAIM.
//
// Điểm quan trọng nhất là bước 4. Một câu chưa ai kiểm chứng mà mặc định thành FACT sẽ đi
// thẳng vào bài viết như thể đã xác minh, và không còn ai phân biệt được đâu là điều nguồn
// nói với đâu là điều ta tưởng nguồn nói.

// Số kèm đơn vị, phần trăm, tiền, ngày tháng — dấu hiệu của một con số cụ thể.
const NUMERIC_RE = /(\d+([.,]\d+)?\s*%)|(\d+([.,]\d+)?\s*(kg|g|mg|km|m|cm|mm|s|ms|h|giờ|phút|ngày|tuần|tháng|năm|đ|vnd|usd|\$))|(\d{1,3}([.,]\d{3})+)|(\b\d+([.,]\d+)?\b)/i;

// Dấu hiệu quan điểm cá nhân, cả tiếng Việt lẫn tiếng Anh.
const OPINION_MARKERS = [
  'theo tôi', 'tôi nghĩ', 'tôi thấy', 'cá nhân tôi', 'có lẽ là tốt nhất',
  'i think', 'i believe', 'in my opinion', 'we feel',
];

// Từ ngữ tuyệt đối/quảng cáo. Một câu như vậy, dù nguồn có nói, cũng là ý kiến chứ không
// phải sự thật kiểm chứng được.
const SUPERLATIVES = [
  'tốt nhất', 'số 1', 'số một', 'hàng đầu', 'tuyệt vời nhất', 'hoàn hảo', 'vô địch',
  'best', 'greatest', 'perfect', 'world-class', 'unbeatable',
];

const hasAny = (haystack, needles) => needles.some((n) => haystack.includes(n));

/** Giải thích quyết định phân loại — để người đọc log biết vì sao, và để test soi được. */
export function explainEvidenceClassification(candidate) {
  const c = candidate && typeof candidate === 'object' ? candidate : {};
  const text = String(c.text || '');
  const low = text.toLowerCase();
  const signals = [];

  if (c.type) {
    if (!EVIDENCE_TYPES.includes(c.type)) {
      throw new TypeError(`evidenceCandidate: "type" must be one of ${EVIDENCE_TYPES.join(', ')}.`);
    }
    return { type: c.type, basis: 'EXPLICIT', signals: ['DECLARED_TYPE'] };
  }

  if (c.inferred === true) return { type: 'INFERENCE', basis: 'STRUCTURAL', signals: ['INFERRED_BY_US'] };

  if (hasAny(low, OPINION_MARKERS)) signals.push('OPINION_MARKER');
  if (hasAny(low, SUPERLATIVES)) signals.push('SUPERLATIVE');
  if (signals.length) return { type: 'OPINION', basis: 'PATTERN', signals };

  if (c.quote === true) return { type: 'QUOTE', basis: 'STRUCTURAL', signals: ['VERBATIM_QUOTE'] };

  if (NUMERIC_RE.test(text)) {
    signals.push('NUMERIC');
    // Con số nguồn nói ra là thống kê; con số trong một câu nguồn TỰ NHẬN thì vẫn là claim.
    if (c.verbatim === true) return { type: 'STATISTIC', basis: 'PATTERN', signals };
  }

  // Nguồn tự khẳng định điều gì đó -> đó là claim CỦA NGUỒN, không phải sự thật đã kiểm chứng.
  if (c.attributedTo) return { type: 'CLAIM', basis: 'STRUCTURAL', signals: [...signals, 'ATTRIBUTED_TO_SOURCE'] };

  // Chỉ khi câu được sao NGUYÊN VĂN từ nguồn mới được coi là FACT.
  if (c.verbatim === true) return { type: 'FACT', basis: 'STRUCTURAL', signals: [...signals, 'VERBATIM_FROM_SOURCE'] };

  return { type: 'CLAIM', basis: 'DEFAULT', signals };
}

export function classifyEvidenceCandidate(candidate) {
  const c = candidate && typeof candidate === 'object' ? candidate : {};
  const { type } = explainEvidenceClassification(c);
  // Đi qua hợp đồng chung: thiếu sourceId hay text rỗng bị chặn ngay tại đây.
  return assertEvidenceIR({
    evidenceId: c.evidenceId,
    sourceId: c.sourceId,
    type,
    text: c.text,
    locator: c.locator,
    relation: c.relation,
    capturedAt: c.capturedAt,
  });
}

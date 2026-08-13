import { ASSERTION_STRENGTH } from './contracts.mjs';

// Trạng thái hỗ trợ và bảo vệ độ chắc của luận điểm.
//
// Cả file này TẤT ĐỊNH và không gọi model. Đó là chủ ý: câu hỏi "bài viết này có được bằng
// chứng chống lưng không" mà đem hỏi chính loại hệ thống vừa viết ra nó thì không còn là
// kiểm tra nữa. Model có thể đánh giá văn phong; quan hệ luận điểm ↔ bằng chứng thì đối chiếu
// bằng luật.
//
// Mọi ngả rẽ đều nghiêng về phía THẬN TRỌNG: không đủ dữ kiện thì NEEDS_REVIEW, khớp một phần
// thì PARTIALLY_SUPPORTED. Không có đường nào làm tròn lên thành SUPPORTED.

const NUMBER_RE = /\d+(?:[.,]\d+)?/g;

function numbersIn(text) {
  // Chuẩn hóa dấu thập phân để "1,5" và "1.5" là một; giữ nguyên giá trị, không làm tròn.
  return (String(text || '').match(NUMBER_RE) || []).map((n) => n.replace(',', '.'));
}

const rank = (strength) => ASSERTION_STRENGTH.indexOf(strength);

/**
 * @param {object} claim
 * @param {Record<string, object>} evidenceById
 * @returns {{status: string, supportingEvidenceRefs: string[], reasons: string[]}}
 */
export function resolveClaimSupport(claim, evidenceById) {
  const refs = Array.isArray(claim?.evidenceRefs) ? claim.evidenceRefs : [];
  const map = evidenceById || {};
  const reasons = [];

  if (!refs.length) return { status: 'UNSUPPORTED', supportingEvidenceRefs: [], reasons: ['NO_EVIDENCE'] };

  // Tham chiếu trỏ vào hư không: không kết luận được gì cả, kể cả "không có bằng chứng" —
  // bằng chứng có thể tồn tại mà chỉ là đang mất dấu.
  const missing = refs.filter((id) => !map[id]);
  if (missing.length) {
    return { status: 'NEEDS_REVIEW', supportingEvidenceRefs: [], reasons: ['MISSING_EVIDENCE'] };
  }

  const items = refs.map((id) => map[id]);

  // Khai báo rõ ràng thắng mọi suy luận từ văn bản.
  if (items.some((e) => e.relation === 'CONTRADICTS')) {
    return { status: 'CONTRADICTED', supportingEvidenceRefs: [], reasons: ['CONTRADICTING_EVIDENCE'] };
  }

  const supporting = items.filter((e) => e.relation !== 'RELATED');
  if (!supporting.length) {
    return { status: 'PARTIALLY_SUPPORTED', supportingEvidenceRefs: [], reasons: ['ONLY_RELATED_EVIDENCE'] };
  }

  // Không định vị được thì không kiểm được. Đây là "chưa biết", không phải "không có".
  if (supporting.some((e) => !e.locator || !Object.keys(e.locator).length)) {
    return { status: 'NEEDS_REVIEW', supportingEvidenceRefs: supporting.map((e) => e.evidenceId), reasons: ['AMBIGUOUS_LOCATOR'] };
  }

  const refsOut = supporting.map((e) => e.evidenceId);
  let partial = false;

  // --- đối chiếu con số ---
  const claimNumbers = numbersIn(claim.proposition);
  if (claimNumbers.length) {
    const evidenceNumbers = new Set(supporting.flatMap((e) => numbersIn(e.text)));
    const covered = claimNumbers.filter((n) => evidenceNumbers.has(n));
    const uncovered = claimNumbers.filter((n) => !evidenceNumbers.has(n));

    if (uncovered.length && evidenceNumbers.size) {
      // Bằng chứng CÓ nói về con số nhưng ra số khác: đó là mâu thuẫn, không phải "gần đúng".
      // Chỉ kết luận vậy khi câu và bằng chứng nói cùng một chuyện (có phần chữ trùng nhau) —
      // nếu không, hai con số khác nhau chỉ đơn giản là hai chuyện khác nhau.
      const conflicting = uncovered.some((n) => supporting.some((e) => sharesSubject(claim.proposition, e.text) && numbersIn(e.text).length && !numbersIn(e.text).includes(n)));
      if (conflicting && !covered.length) {
        return { status: 'CONTRADICTED', supportingEvidenceRefs: refsOut, reasons: ['NUMERIC_CONFLICT'] };
      }
      partial = true;
      reasons.push('PARTIAL_NUMERIC_COVERAGE');
    }
  }

  for (const e of supporting) {
    // Người gọi đã tự đánh giá mức phủ thì tôn trọng.
    if (e.coverage === 'PARTIAL') { partial = true; reasons.push('DECLARED_PARTIAL_COVERAGE'); continue; }
    if (e.coverage === 'FULL') continue;

    // Ý kiến của một người không biến một câu thành sự thật, dù chữ có trùng khít.
    if (e.type === 'OPINION' && claim.type === 'FACT') { partial = true; reasons.push('OPINION_CANNOT_ESTABLISH_FACT'); continue; }
    // Suy luận là của ta, không phải điều nguồn đã nói.
    if (e.type === 'INFERENCE') { partial = true; reasons.push('INFERENCE_NOT_SOURCE_STATEMENT'); continue; }
    // Nguồn tự nhận điều gì đó thì đó là lời của nguồn, chưa phải điều đã được kiểm chứng.
    if (e.type === 'CLAIM' && claim.type === 'FACT') { partial = true; reasons.push('SOURCE_CLAIM_NOT_VERIFIED'); }
  }

  return {
    status: partial ? 'PARTIALLY_SUPPORTED' : 'SUPPORTED',
    supportingEvidenceRefs: refsOut,
    reasons: [...new Set(reasons)],
  };
}

// Hai câu có nói về cùng một chuyện không — đo bằng phần chữ (không phải số) dùng chung.
// Cố tình thô và dễ đoán: đây chỉ là hàng rào để không tuyên bố "mâu thuẫn" giữa hai câu
// chẳng liên quan gì đến nhau.
function sharesSubject(a, b) {
  const words = (s) => new Set(String(s).toLowerCase().replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 2));
  const wa = words(a);
  const wb = words(b);
  if (!wa.size || !wb.size) return false;
  const shared = [...wa].filter((w) => wb.has(w)).length;
  return shared / Math.min(wa.size, wb.size) >= 0.5;
}

/** So độ chắc trước/sau một lần sửa. */
export function compareClaimStrength(before, after) {
  const from = before?.strength ?? 'QUALIFIED';
  const to = after?.strength ?? 'QUALIFIED';
  if (from === to) return { changed: false, direction: 'NONE', from, to, reason: 'STRENGTH_UNCHANGED' };
  const up = rank(to) > rank(from);
  return {
    changed: true,
    direction: up ? 'UP' : 'DOWN',
    from,
    to,
    reason: up ? 'STRENGTH_INCREASED' : 'STRENGTH_DECREASED',
  };
}

/**
 * Ràng buộc trung tâm: một lần sửa văn không được biến "có thể giúp" thành "bảo đảm"
 * khi không có bằng chứng nào mới. Đây chính là kiểu hỏng khó thấy nhất — bài đọc mượt hơn,
 * và mạnh hơn mức nó chứng minh được.
 */
export function assertClaimStrengthPreserved(beforeClaims, afterClaims, evidenceById) {
  const before = new Map((beforeClaims || []).map((c) => [c.claimId, c]));
  const map = evidenceById || {};
  const issues = [];

  for (const after of afterClaims || []) {
    const prior = before.get(after.claimId);
    const afterRefs = after.evidenceRefs || [];

    if (!prior) {
      // Luận điểm mới xuất hiện trong lúc sửa mà không có bằng chứng nào.
      if (!afterRefs.length) {
        issues.push({
          code: 'CLAIM_ADDED_UNSUPPORTED', claimId: after.claimId,
          message: `Claim "${after.proposition}" appeared during editing with no evidence.`,
          repairAction: 'ADD_EVIDENCE',
        });
      }
      continue;
    }

    const priorRefs = prior.evidenceRefs || [];
    const comparison = compareClaimStrength(prior, after);

    if (comparison.direction === 'UP') {
      // Bằng chứng MỚI và thực sự chống lưng mới cho phép nói chắc hơn.
      const added = afterRefs.filter((id) => !priorRefs.includes(id));
      const newlySupporting = added.filter((id) => map[id] && map[id].relation !== 'CONTRADICTS');
      if (!newlySupporting.length) {
        issues.push({
          code: 'CLAIM_STRENGTH_INCREASE_UNSUPPORTED', claimId: after.claimId,
          message: `Claim "${after.claimId}" moved from ${comparison.from} to ${comparison.to} without new supporting evidence.`,
          from: comparison.from, to: comparison.to, repairAction: 'QUALIFY_CLAIM',
        });
      }
      continue;
    }

    // Giữ nguyên độ chắc nhưng bỏ bằng chứng: câu văn vẫn quả quyết như cũ trong khi chỗ dựa
    // đã biến mất.
    const dropped = priorRefs.filter((id) => !afterRefs.includes(id));
    if (dropped.length && comparison.direction !== 'DOWN') {
      issues.push({
        code: 'CLAIM_EVIDENCE_DROPPED', claimId: after.claimId,
        message: `Claim "${after.claimId}" kept its strength but lost evidence ${dropped.join(', ')}.`,
        repairAction: 'ADD_EVIDENCE',
      });
    }
  }

  return { ok: issues.length === 0, issues };
}

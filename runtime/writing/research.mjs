import { assertSourceArtifact, assertEvidenceIR } from './contracts.mjs';

// Gói nghiên cứu: nguồn + bằng chứng + luận điểm đi cùng nhau.
//
// Hai việc file này làm mà nếu bỏ qua sẽ hỏng âm thầm:
//
//  1. Mọi mẩu bằng chứng phải trỏ về một nguồn CÓ TRONG gói. Bằng chứng mồ côi trông y hệt
//     bằng chứng thật cho đến khi ai đó cố lần theo nó.
//
//  2. Tuổi của bằng chứng được nói ra. Bằng chứng cũ vẫn dùng được — nhưng người viết phải
//     BIẾT là nó cũ. Cảnh báo chứ không chặn: chặn thì người dùng mất quyền quyết định
//     một việc mà chỉ họ mới đủ dữ kiện để quyết.

const DAY_MS = 24 * 60 * 60 * 1000;

export function buildResearchPacket({
  sources = [],
  evidence = [],
  claims = [],
  maxAgeDays = null,
  now = () => new Date().toISOString(),
} = {}) {
  const validatedSources = sources.map(assertSourceArtifact);
  const sourceIds = new Set(validatedSources.map((s) => s.sourceId));
  const warnings = [];

  const validatedEvidence = evidence.map((item) => {
    const e = assertEvidenceIR(item);
    if (!sourceIds.has(e.sourceId)) {
      throw new TypeError(`researchPacket: evidence "${e.evidenceId}" points at source "${e.sourceId}" which is not in the packet.`);
    }
    return e;
  });

  if (maxAgeDays) {
    const nowMs = Date.parse(now());
    for (const e of validatedEvidence) {
      if (!e.capturedAt) {
        // Không biết tuổi thì nói là không biết, đừng mặc định là mới.
        warnings.push({ code: 'EVIDENCE_AGE_UNKNOWN', evidenceId: e.evidenceId, message: `Evidence "${e.evidenceId}" has no capture date, so its age cannot be judged.` });
        continue;
      }
      const ageDays = Math.floor((nowMs - Date.parse(e.capturedAt)) / DAY_MS);
      if (ageDays > maxAgeDays) {
        warnings.push({ code: 'EVIDENCE_STALE', evidenceId: e.evidenceId, ageDays, message: `Evidence "${e.evidenceId}" was captured ${ageDays} days ago.` });
      }
    }
  }

  return { sources: validatedSources, evidence: validatedEvidence, claims: structuredClone(claims), warnings };
}

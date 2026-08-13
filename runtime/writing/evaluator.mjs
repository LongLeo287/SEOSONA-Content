import { CORE_PACK } from './core-pack.mjs';
import { buildContextBundle } from './context-builder.mjs';
import { composeProviderInput } from './prompt-composer.mjs';
import { assertEvaluationResult, VERDICTS } from './contracts.mjs';
import { resolveClaimSupport } from './claims.mjs';
import { makeId } from '../lib/ids.mjs';

// Máy đánh giá — ĐỘC LẬP với người viết.
//
// "Độc lập" ở đây có nghĩa cụ thể, không phải khẩu hiệu:
//   - Nó đọc REVISION ĐÃ LƯU và bối cảnh đã đóng băng, không đọc chuỗi suy nghĩ hay trạng
//     thái riêng của Writer. Hỏi lại chính lượt chạy vừa viết ra bài thì đó là tự chấm bài
//     mình, và câu trả lời gần như luôn là "ổn".
//   - Nó có thể chạy trên MỘT HÃNG KHÁC hẳn hãng đã viết. Cùng một model, cùng một điểm mù.
//   - Nó KHÔNG BAO GIỜ sửa bài. Nó chỉ ra vấn đề và đề nghị hành động; quyết định sửa gì
//     là của người viết.
//
// Bài kiểm TẤT ĐỊNH chạy TRƯỚC. Không có lý do gì phải tốn một lượt provider để nghe model
// nói "bài này thiếu tiêu đề" — và nếu bản thảo đã hỏng về mặt cấu trúc thì nhận xét văn
// phong của model cũng chẳng còn ý nghĩa.

const EVALUATOR_OUTPUT_CONTRACT = {
  format: 'json',
  jsonSchema: {
    name: 'evaluation',
    schema: {
      type: 'object',
      required: ['dimension', 'verdict', 'findings'],
      properties: {
        dimension: { type: 'string' },
        verdict: { type: 'string', enum: [...VERDICTS] },
        score: { type: 'number' },
        findings: {
          type: 'array',
          items: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              repairAction: { type: 'string' },
            },
          },
        },
      },
    },
  },
};

const worst = (verdicts) => ['BLOCK', 'REVIEW', 'WARN', 'PASS'].find((v) => verdicts.includes(v)) || 'PASS';

/** Bài kiểm tất định V1. Mỗi hàm trả về findings; rỗng nghĩa là đạt. */
export function createDeterministicEvaluators() {
  return {
    // Cấu trúc + trường bắt buộc + ràng buộc nơi đăng: chính là validateDraft của pack.
    structure: ({ pack, content, context }) => {
      const result = pack.validateDraft(content, context);
      return result.issues.map((i) => ({
        code: i.code,
        message: i.message || `${i.code}${i.field ? ` (${i.field})` : ''}`,
        repairAction: i.repairAction || 'FIX_STRUCTURE',
      }));
    },

    // Luận điểm nào chưa có chỗ dựa. Đây là bài kiểm phải TẤT ĐỊNH: hỏi model "bài này có
    // được chứng minh không" là hỏi đúng loại hệ thống có thể tự tin trả lời sai.
    'claim-support': ({ claims, context }) => {
      const findings = [];
      for (const claim of claims) {
        const support = resolveClaimSupport(claim, context.evidenceById || {});
        if (support.status === 'SUPPORTED') continue;
        findings.push({
          code: `CLAIM_${support.status}`,
          message: `Claim "${claim.proposition}" is ${support.status} (${support.reasons.join(', ') || 'no reason recorded'}).`,
          repairAction: support.status === 'CONTRADICTED' ? 'REMOVE_CLAIM' : 'ADD_EVIDENCE',
        });
      }
      return findings;
    },

    // Dữ kiện có nguồn sự thật (thông số sản phẩm, lời thoại nguyên văn): pack tự biết cách kiểm.
    'job-specific': ({ pack, content, context }) => {
      if (typeof pack.assertSourceFidelity === 'function' && context.transcript) {
        return pack.assertSourceFidelity(content, context.transcript).issues.map((i) => ({
          code: i.code, message: i.message || i.code, repairAction: i.repairAction || 'RESTORE_SOURCE_FACT',
        }));
      }
      return [];
    },
  };
}

export function createEvaluator({
  gateway,
  packRegistry,
  contentService,
  deterministicEvaluators = createDeterministicEvaluators(),
  corePack = CORE_PACK,
  now = () => new Date().toISOString(),
  idFactory = makeId,
} = {}) {
  if (!gateway || !packRegistry || !contentService) {
    throw new TypeError('createEvaluator: gateway, packRegistry and contentService are required.');
  }

  async function evaluate({
    workspaceId,
    contentId,
    revisionId,
    evaluatorSet = null,
    providerPolicy = {},
    context = {},
    persist = true,
  }) {
    const history = await contentService.getContentHistory(workspaceId, contentId);
    // Đánh giá luôn chạy trên bản ĐÃ LƯU, không phải trên một object đang truyền tay:
    // chấm một bản chưa lưu nghĩa là điểm số nói về một thứ không ai xem lại được.
    const revision = history.find((r) => r.revisionId === revisionId);
    if (!revision) {
      const err = new Error(`Revision "${revisionId}" does not belong to content "${contentId}".`);
      err.code = 'REVISION_NOT_FOUND';
      throw err;
    }

    const payload = revision.payload || {};
    const pack = packRegistry.getJobPack(payload.jobType);
    const content = { contentId, jobType: payload.jobType, language: payload.language, fields: payload.fields || {}, sourceRefs: payload.sourceRefs || [], claimRefs: (payload.claims || []).map((c) => c.claimId), metadata: {} };
    const claims = payload.claims || [];
    const dimensions = evaluatorSet || pack.requiredEvaluators;
    const results = [];

    // --- 1) tất định trước ---
    const deterministicRan = new Set();
    for (const dimension of dimensions) {
      const check = deterministicEvaluators[dimension];
      if (!check) continue;
      deterministicRan.add(dimension);
      const findings = check({ pack, content, claims, context });
      results.push(await record({
        workspaceId, contentId, revisionId, dimension,
        evaluatorId: `deterministic:${dimension}`,
        verdict: findings.length ? 'BLOCK' : 'PASS',
        findings, persist,
      }));
    }

    // --- 2) rồi mới tới model ---
    // Nếu phần tất định đã chặn thì bản thảo hỏng về cấu trúc/dữ kiện; nhận xét văn phong
    // lúc này vừa tốn tiền vừa không dùng được.
    const blockedAlready = results.some((r) => r.verdict === 'BLOCK');
    for (const dimension of dimensions) {
      if (deterministicRan.has(dimension)) continue;
      if (blockedAlready) {
        results.push(await record({
          workspaceId, contentId, revisionId, dimension,
          evaluatorId: 'skipped:deterministic-block',
          verdict: 'REVIEW',
          findings: [{ code: 'EVALUATION_SKIPPED', message: 'Deterministic checks already blocked this revision.', repairAction: 'HUMAN_REVIEW' }],
          persist,
        }));
        continue;
      }

      const bundle = buildContextBundle({
        corePack, jobPack: pack,
        brief: { jobType: pack.jobType, objective: `Đánh giá trục ${dimension}` },
        evidence: context.evidence || [],
        userInstruction: `Chấm trục "${dimension}". Chỉ ra vấn đề cụ thể, không viết lại bài.`,
        currentDraft: { fields: content.fields, claims },
      });
      const composed = composeProviderInput({ ...bundle, jobPack: { ...bundle.jobPack, outputContract: EVALUATOR_OUTPUT_CONTRACT } }, 'AUDIT');

      const providerResult = await gateway.execute({
        taskId: idFactory('providertask'),
        taskType: 'AUDIT',
        contentJob: pack.jobType,
        requiredCapabilities: [],
        contextSnapshotId: payload.contextSnapshotId || context.contextSnapshotId || 'contextsnapshot_inherited',
        contextBundle: { system: composed.system, prompt: composed.prompt, promptDigest: composed.promptDigest },
        outputContract: EVALUATOR_OUTPUT_CONTRACT,
        providerPreference: null,
      }, providerPolicy);

      results.push(await record({
        workspaceId, contentId, revisionId, dimension,
        evaluatorId: `provider:${providerResult.providerId || 'unknown'}`,
        ...interpret(providerResult, dimension),
        persist,
      }));
    }

    return results;
  }

  function interpret(providerResult, dimension) {
    if (providerResult.status !== 'COMPLETED') {
      // Đánh giá không chạy được thì KHÔNG phải là đạt. Coi lỗi provider là PASS chính là
      // cách một bài chưa ai kiểm đi thẳng ra ngoài.
      return {
        verdict: 'REVIEW',
        findings: [{ code: 'EVALUATION_UNAVAILABLE', message: providerResult.error?.message || 'The evaluator provider did not answer.', repairAction: 'HUMAN_REVIEW' }],
      };
    }
    try {
      const cleaned = String(providerResult.output).trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
      const parsed = JSON.parse(cleaned);
      const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
      return {
        verdict: VERDICTS.includes(parsed.verdict) ? parsed.verdict : 'REVIEW',
        score: typeof parsed.score === 'number' ? parsed.score : null,
        findings: findings.map((f) => ({
          code: String(f.code || 'FINDING'),
          message: String(f.message || ''),
          // Model đề nghị một hành động lạ thì quy về "cần người xem", không im lặng bỏ qua.
          repairAction: f.repairAction || 'HUMAN_REVIEW',
        })),
      };
    } catch {
      return {
        verdict: 'REVIEW',
        findings: [{ code: 'EVALUATION_UNPARSEABLE', message: `The ${dimension} evaluator returned something that is not a verdict.`, repairAction: 'HUMAN_REVIEW' }],
      };
    }
  }

  async function record({ workspaceId, contentId, revisionId, dimension, evaluatorId, verdict, score = null, findings, persist }) {
    const result = assertEvaluationResult({
      evaluationId: idFactory('evaluation'), contentId, revisionId, dimension,
      verdict, score, evaluatorId, findings, at: now(),
    });
    if (persist) {
      // Kết quả là BẢN GHI BẤT BIẾN và không đụng vào revision đang được chấm: chấm bài
      // không được làm thay đổi bài.
      await contentService.addEvaluation({
        workspaceId, revisionId, contentId, evaluator: evaluatorId,
        dimension, verdict, score, findings: result.findings,
      });
    }
    return result;
  }

  return { evaluate, worstVerdict: worst };
}

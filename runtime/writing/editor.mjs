import { CORE_PACK } from './core-pack.mjs';
import { buildContextBundle } from './context-builder.mjs';
import { composeProviderInput } from './prompt-composer.mjs';
import { assertContentIR } from './contracts.mjs';
import { assertClaimStrengthPreserved } from './claims.mjs';
import { makeId } from '../lib/ids.mjs';

// Editor: sửa CÁCH NÓI, không sửa ĐIỀU ĐƯỢC NÓI.
//
// Đây là nơi dễ mất dữ kiện nhất trong toàn hệ thống, vì bản sửa bao giờ cũng ĐỌC HAY HƠN
// bản gốc. Câu văn mượt hơn, mạnh hơn, dứt khoát hơn — và không ai đọc lại để hỏi "chỗ nào
// chứng minh điều này?". Nên sau khi model trả về, mọi thứ được đối chiếu lại bằng LUẬT.
//
// Hai loại vi phạm, xử lý khác nhau:
//
//   - Trường có NGUỒN SỰ THẬT (thông số sản phẩm, lời thoại nguyên văn): máy biết giá trị
//     đúng là gì, nên TRẢ LẠI giá trị gốc và ghi lại việc đó. Người dùng vẫn có bản văn mượt
//     hơn mà không mất dữ kiện đúng.
//
//   - Mức khẳng định bị nâng lên: máy KHÔNG biết người viết muốn câu nào, nên CHẶN và trả
//     về vấn đề. Tự hạ giọng hộ cũng là sửa nội dung mà không ai yêu cầu.

export const EDIT_OPERATIONS = Object.freeze([
  'REWRITE', 'SHORTEN', 'EXPAND', 'SIMPLIFY', 'PROFESSIONALIZE', 'CLARIFY',
  'DESLOP', 'FIX_REPETITION', 'IMPROVE_TRANSITIONS', 'IMPROVE_HOOK', 'IMPROVE_CTA', 'FIX_TERMINOLOGY',
]);

function editorError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function parseProviderOutput(output, outputContract) {
  if (typeof output !== 'string') return { ok: false, code: 'INVALID_PROVIDER_OUTPUT' };
  if ((outputContract?.format || 'json') !== 'json') return { ok: true, value: output };
  try {
    const cleaned = output.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
    return { ok: true, value: JSON.parse(cleaned) };
  } catch {
    return { ok: false, code: 'INVALID_PROVIDER_OUTPUT' };
  }
}

export function createEditor({
  gateway,
  packRegistry,
  contentService,
  corePack = CORE_PACK,
  now = () => new Date().toISOString(),
  idFactory = makeId,
} = {}) {
  if (!gateway || !packRegistry || !contentService) {
    throw new TypeError('createEditor: gateway, packRegistry and contentService are required.');
  }

  async function edit({
    workspaceId,
    contentId,
    revisionId,
    operation,
    instruction = '',
    evidence = [],
    brandContext = null,
    audienceContext = null,
    targetPack = null,
    providerPolicy = {},
    context = {},
  }) {
    if (!EDIT_OPERATIONS.includes(operation)) {
      throw new TypeError(`edit: "operation" must be one of ${EDIT_OPERATIONS.join(', ')}.`);
    }

    const history = await contentService.getContentHistory(workspaceId, contentId);
    const current = history.find((r) => r.revisionId === revisionId);
    if (!current) throw editorError('REVISION_NOT_FOUND', `Revision "${revisionId}" does not belong to content "${contentId}".`);

    const payload = current.payload || {};
    const pack = packRegistry.getJobPack(payload.jobType);
    const beforeFields = payload.fields || {};
    const beforeClaims = payload.claims || [];

    const bundle = buildContextBundle({
      corePack, jobPack: pack, brandContext, audienceContext,
      brief: { jobType: pack.jobType, objective: `Sửa nội dung: ${operation}`, intent: 'EDIT', angle: operation },
      evidence, targetPack,
      userInstruction: instruction,
      currentDraft: { fields: beforeFields, claims: beforeClaims },
    });
    const composed = composeProviderInput(bundle, 'EDIT');

    const providerResult = await gateway.execute({
      taskId: idFactory('providertask'),
      taskType: 'EDIT',
      contentJob: pack.jobType,
      requiredCapabilities: pack.requiredCapabilities,
      contextSnapshotId: payload.contextSnapshotId || context.contextSnapshotId || 'contextsnapshot_inherited',
      contextBundle: { system: composed.system, prompt: composed.prompt, promptDigest: composed.promptDigest },
      outputContract: composed.outputContract || {},
      providerPreference: null,
    }, providerPolicy);

    if (providerResult.status !== 'COMPLETED') {
      return { revision: null, providerResult, issues: [{ code: 'PROVIDER_FAILED', message: providerResult.error?.message || 'The provider did not complete the edit.' }] };
    }

    const parsed = parseProviderOutput(providerResult.output, composed.outputContract);
    if (!parsed.ok) {
      return { revision: null, providerResult, issues: [{ code: parsed.code, message: 'The edited output could not be parsed.' }] };
    }

    const { claims: afterClaims = [], ...afterFields } = parsed.value || {};
    const issues = [];

    // --- trả lại các trường có nguồn sự thật ---
    const restored = { ...afterFields };
    for (const field of pack.immutableFields || []) {
      if (beforeFields[field] === undefined) continue;
      if (JSON.stringify(restored[field]) !== JSON.stringify(beforeFields[field])) {
        restored[field] = structuredClone(beforeFields[field]);
        issues.push({
          code: 'AUTHORITATIVE_FIELD_RESTORED', field,
          message: `Field "${field}" is source-of-truth for job type "${pack.jobType}"; the edit was reverted to the recorded value.`,
          repairAction: 'RESTORE_SOURCE_FACT',
        });
      }
    }

    // --- mức khẳng định ---
    const preservation = assertClaimStrengthPreserved(beforeClaims, afterClaims, context.evidenceById || {});
    if (!preservation.ok) {
      // Chặn, không tự sửa: chỉ người viết mới biết họ muốn nói câu nào.
      return { revision: null, providerResult, issues: [...preservation.issues, ...issues] };
    }

    let draft;
    try {
      draft = assertContentIR({
        contentId, jobType: pack.jobType, language: payload.language,
        fields: restored, sourceRefs: payload.sourceRefs || [], claimRefs: afterClaims.map((c) => c.claimId),
      });
    } catch (e) {
      return { revision: null, providerResult, issues: [{ code: 'INVALID_PROVIDER_OUTPUT', message: e.message }, ...issues] };
    }

    const validation = pack.validateDraft(draft, {
      ...context,
      claimsById: { ...(context.claimsById || {}), ...Object.fromEntries(afterClaims.map((c) => [c.claimId, c])) },
    });
    if (!validation.ok) return { revision: null, providerResult, issues: [...validation.issues, ...issues] };

    const revision = await contentService.appendRevision({
      workspaceId, contentId, operation: 'EDIT',
      payload: { fields: draft.fields, claims: afterClaims, contentId, jobType: pack.jobType, editOperation: operation },
    });

    return { revision, providerResult, issues, at: now() };
  }

  return { edit };
}

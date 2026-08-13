import { CORE_PACK } from './core-pack.mjs';
import { buildContextBundle } from './context-builder.mjs';
import { composeProviderInput } from './prompt-composer.mjs';
import { assertContentIR } from './contracts.mjs';
import { makeId } from '../lib/ids.mjs';

// Writer: biến một brief thành một bản thảo đã được kiểm.
//
// Trong file này KHÔNG có một nhánh `if` nào theo loại nội dung hay theo nhà cung cấp.
// Mọi khác biệt giữa bài blog, mô tả sản phẩm và transcript đều nằm ở job pack; mọi khác
// biệt giữa các hãng AI đều nằm ở Gateway. Nếu sau này ở đây xuất hiện `if (jobType === ...)`
// thì đó là dấu hiệu một luật đã đặt sai chỗ.
//
// Thứ tự công việc có chủ ý: những gì kiểm được MIỄN PHÍ thì kiểm trước. Brief thiếu trường
// hay job type không tồn tại phải hỏng ngay, đừng để tốn một lượt chạy provider mới biết.

const WRITER_STAGE = 'WRITE';

function parseProviderOutput(output, outputContract) {
  if (typeof output !== 'string') return { ok: false, code: 'INVALID_PROVIDER_OUTPUT' };
  const wantsJson = (outputContract?.format || 'json') === 'json';
  if (!wantsJson) return { ok: true, value: output };
  try {
    // Model hay bọc JSON trong ```json … ```; gỡ lớp bọc là chuẩn hóa hình thức, không phải
    // sửa nội dung, nên được phép.
    const cleaned = output.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
    return { ok: true, value: JSON.parse(cleaned) };
  } catch {
    return { ok: false, code: 'INVALID_PROVIDER_OUTPUT' };
  }
}

export function createWriter({
  gateway,
  packRegistry,
  contentService,
  corePack = CORE_PACK,
  now = () => new Date().toISOString(),
  idFactory = makeId,
} = {}) {
  if (!gateway || !packRegistry || !contentService) {
    throw new TypeError('createWriter: gateway, packRegistry and contentService are required.');
  }

  async function write({
    workspaceId,
    projectId,
    jobType,
    brief,
    contextSnapshotId,
    evidence = [],
    brandContext = null,
    audienceContext = null,
    targetPack = null,
    userInstruction = '',
    providerPolicy = {},
    context = {},
    timeoutMs,
  }) {
    // 1) Những gì kiểm được không tốn gì thì kiểm trước.
    const pack = packRegistry.getJobPack(jobType);
    const validBrief = pack.buildBrief(brief);

    // 2) Ngữ cảnh có cấu trúc -> đầu vào cho provider.
    const bundle = buildContextBundle({
      corePack, jobPack: pack, brandContext, audienceContext,
      brief: validBrief, evidence, targetPack, userInstruction,
    });
    const composed = composeProviderInput(bundle, 'WRITE');

    // 3) Một hình dạng ProviderTask duy nhất cho mọi loại nội dung. Pack chỉ đổi contentJob,
    //    outputContract và các năng lực cần có — không đổi cấu trúc yêu cầu.
    const task = {
      taskId: idFactory('providertask'),
      taskType: WRITER_STAGE,
      contentJob: pack.jobType,
      requiredCapabilities: pack.requiredCapabilities,
      contextSnapshotId,
      contextBundle: { system: composed.system, prompt: composed.prompt, promptDigest: composed.promptDigest },
      outputContract: composed.outputContract || {},
      // Writer KHÔNG chọn hãng. Khóa tay (nếu có) đi qua policy, đúng đường của nó.
      providerPreference: null,
      ...(timeoutMs ? { timeoutMs } : {}),
    };

    const providerResult = await gateway.execute(task, providerPolicy);
    if (providerResult.status !== 'COMPLETED') {
      return {
        content: null, revision: null, providerResult,
        issues: [{ code: 'PROVIDER_FAILED', message: providerResult.error?.message || 'The provider did not complete the task.' }],
      };
    }

    const parsed = parseProviderOutput(providerResult.output, task.outputContract);
    if (!parsed.ok) {
      // Đầu ra hỏng KHÔNG được lưu thành nội dung. Lưu rồi sửa sau nghe thì tiện, nhưng
      // bản hỏng sẽ nằm lẫn với bản tốt và không ai phân biệt được nữa. Dấu vết lần chạy
      // vẫn còn — Gateway đã ghi attempt và biên nhận.
      return { content: null, revision: null, providerResult, issues: [{ code: parsed.code, message: 'The provider output could not be parsed against the job contract.' }] };
    }

    const { claims = [], ...fields } = parsed.value || {};
    const contentId = idFactory('content');
    let draft;
    try {
      draft = assertContentIR({
        contentId, jobType: pack.jobType, language: validBrief.language,
        fields, sourceRefs: (evidence || []).map((e) => e.sourceId), claimRefs: claims.map((c) => c.claimId),
      });
    } catch (e) {
      return { content: null, revision: null, providerResult, issues: [{ code: 'INVALID_PROVIDER_OUTPUT', message: e.message }] };
    }

    // 4) Kiểm tất định của pack TRƯỚC khi lưu.
    // Luận điểm do CHÍNH bản thảo này sinh ra thì được coi là đã biết — nó được định nghĩa
    // ngay trong bản thảo. Chỉ tham chiếu tới luận điểm KHÔNG tồn tại ở đâu cả mới là lỗi.
    const validation = pack.validateDraft(draft, {
      ...context,
      claimsById: { ...(context.claimsById || {}), ...Object.fromEntries(claims.map((c) => [c.claimId, c])) },
    });
    if (!validation.ok) {
      return { content: null, revision: null, providerResult, issues: validation.issues };
    }

    // 5) Lưu: ContentItem + revision đầu tiên + các luận điểm.
    const item = await contentService.createContent({
      workspaceId, projectId, contentJob: pack.jobType,
      payload: { fields: draft.fields, claims, contentId: draft.contentId, jobType: pack.jobType },
      title: draft.fields.title || null,
    });
    for (const claim of claims) {
      await contentService.addClaim({
        workspaceId, proposition: claim.proposition,
        strength: claim.causalStrength || 'ASSOCIATED',
        evidenceRefs: claim.evidenceRefs || [], status: claim.status || null,
      });
    }

    const history = await contentService.getContentHistory(workspaceId, item.contentId);
    return {
      content: { ...draft, contentId: item.contentId },
      revision: history[history.length - 1],
      providerResult,
      issues: [],
      promptDigest: composed.promptDigest,
      at: now(),
    };
  }

  return { write };
}

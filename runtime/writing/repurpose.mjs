import { makeId } from '../lib/ids.mjs';

// Chuyển thể nội dung sang một loại khác, GIỮ NGUYÊN phả hệ.
//
// Hai luật:
//
//  1. Bản gốc không bao giờ bị thay. Chuyển thể tạo ra một contentId MỚI cộng một cạnh phả hệ.
//     Ghi đè lên bản gốc nghĩa là bài blog biến mất khi ai đó rút nó thành bản tóm tắt —
//     và thứ họ mất là bản có nhiều công sức hơn.
//
//  2. Chuyển thể không được SINH RA dữ kiện mới. Nó sắp xếp lại điều đã có bằng chứng.
//     Chiều nào cần dữ liệu mà nguồn không có thì bị chặn: một bài blog không chứa lời thoại
//     và mốc thời gian, nên "bài blog -> transcript" không phải chuyển thể, mà là bịa.

// Chiều hợp lệ và điều kiện của từng chiều.
const ROUTES = {
  'transcript>article': { requires: [] },
  'transcript>product': { requires: [] },
  'article>product': { requires: [] },
  'article>article': { requires: [] },
  'product>article': { requires: [] },
  // Muốn ra transcript thì phải CÓ transcript. Không có nguồn thì mốc thời gian ở đâu ra?
  'article>transcript': { requires: ['transcriptSource'] },
  'product>transcript': { requires: ['transcriptSource'] },
};

function repurposeError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

export function createRepurposer({
  writer,
  contentService,
  store,
  now = () => new Date().toISOString(),
  idFactory = makeId,
} = {}) {
  if (!writer || !contentService) throw new TypeError('createRepurposer: writer and contentService are required.');

  async function repurpose({
    workspaceId,
    projectId,
    fromContentId,
    fromRevisionId,
    toJobType,
    briefOverrides = {},
    providerPolicy = {},
    context = {},
    evidence = [],
    contextSnapshotId,
  }) {
    const history = await contentService.getContentHistory(workspaceId, fromContentId);
    const source = history.find((r) => r.revisionId === fromRevisionId);
    if (!source) throw repurposeError('REVISION_NOT_FOUND', `Revision "${fromRevisionId}" does not belong to content "${fromContentId}".`);

    const fromJobType = source.payload?.jobType;
    const route = ROUTES[`${fromJobType}>${toJobType}`];
    if (!route) {
      throw repurposeError('UNSUPPORTED_REPURPOSE_ROUTE', `Repurposing ${fromJobType} into ${toJobType} is not a supported route.`);
    }
    for (const requirement of route.requires) {
      if (!context[requirement]) {
        // Chặn ở đây, trước khi gọi provider: thiếu nguồn thì kết quả chỉ có thể là bịa ra.
        throw repurposeError('MISSING_SOURCE_FOR_ROUTE', `Repurposing ${fromJobType} into ${toJobType} requires "${requirement}".`);
      }
    }

    const created = await writer.write({
      workspaceId, projectId, jobType: toJobType,
      brief: {
        objective: briefOverrides.objective || `Chuyển thể nội dung ${fromJobType} sang ${toJobType}`,
        intent: briefOverrides.intent || 'INFORMATIONAL',
        angle: briefOverrides.angle || 'giữ nguyên luận điểm của bản gốc',
        ...briefOverrides,
      },
      contextSnapshotId: contextSnapshotId || source.payload?.contextSnapshotId || 'contextsnapshot_inherited',
      evidence,
      userInstruction: `Chuyển thể từ nội dung đã có. Không thêm dữ kiện mới ngoài phần bằng chứng đã cung cấp.`,
      providerPolicy,
      context,
    });

    if (!created.content) return { content: null, revision: null, lineage: null, issues: created.issues, providerResult: created.providerResult };

    // Cạnh phả hệ là bản ghi riêng: truy được cả hai chiều, và bản gốc không bị sửa.
    const lineage = {
      lineageId: idFactory('contentlineage'),
      fromContentId, fromRevisionId,
      toContentId: created.content.contentId,
      relation: 'REPURPOSED_FROM',
      fromJobType, toJobType,
      createdAt: now(),
    };
    if (store) await store.put('contentLineage', workspaceId, lineage);

    return { content: created.content, revision: created.revision, lineage, issues: created.issues, providerResult: created.providerResult };
  }

  async function lineageOf(workspaceId, contentId) {
    if (!store) return [];
    const all = await store.list('contentLineage', workspaceId);
    return all.filter((edge) => edge.fromContentId === contentId || edge.toContentId === contentId);
  }

  return { repurpose, lineageOf, ROUTES };
}

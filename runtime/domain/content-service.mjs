import { createHash } from 'node:crypto';
import { makeId } from '../lib/ids.mjs';

// Dịch vụ Source / Evidence / Claim / Content / Revision.
//
// LUẬT LÕI — lineage chỉ được NỐI THÊM:
//   - Revision là bản ghi bất biến (kho từ chối ghi đè bằng IMMUTABLE_RECORD_CONFLICT).
//   - Sửa nội dung = tạo Revision mới trỏ về parent, rồi CHỈ dời con trỏ
//     ContentItem.currentRevisionId. Không bao giờ sửa nội dung revision cũ.
//   - Nguồn đổi nội dung = sinh sourceId MỚI; ảnh chụp cũ giữ nguyên vĩnh viễn.

function err(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

const sha256Hex = (buf) => createHash('sha256').update(buf).digest('hex');

export function createContentService({ store, now = () => new Date().toISOString(), idFactory = makeId } = {}) {
  if (!store) throw new TypeError('createContentService requires a store.');

  // Có bytes thật thì lưu blob và lấy digest của chính bytes đó.
  // Không có bytes (ghi chú tay) vẫn phải có digest để truy vết — băm bản ghi logic.
  async function addSource({
    workspaceId, projectId, kind, title,
    canonicalUrl = null, bytes = null, parserVersion = null,
  }) {
    const project = await store.get('project', workspaceId, projectId);
    if (!project) throw err('PROJECT_NOT_FOUND', `Project not found: ${projectId}`);

    const sourceId = idFactory('source');
    const retrievedAt = now();
    let blobRef = null;
    let sha256;

    if (bytes) {
      const put = await store.putBlob(workspaceId, sourceId, bytes);
      blobRef = put.blobRef;
      sha256 = put.sha256;
    } else {
      sha256 = sha256Hex(Buffer.from(JSON.stringify({ kind, title, canonicalUrl, retrievedAt }), 'utf8'));
    }

    return store.put('source', workspaceId, {
      sourceId,
      projectId,
      kind,
      title,
      canonicalUrl: canonicalUrl || null,
      blobRef,
      sha256,
      retrievedAt,
      parserVersion: parserVersion || null,
    });
  }

  // Bằng chứng BẮT BUỘC gắn với một nguồn đã lưu — chống "bịa nguồn" ở tầng dữ liệu.
  async function addEvidence({ workspaceId, sourceId, statement, locator = null, type = null }) {
    const source = await store.get('source', workspaceId, sourceId);
    if (!source) throw err('SOURCE_NOT_FOUND', `Source not found: ${sourceId}`);
    const evidenceId = idFactory('evidence');
    return store.put('evidence', workspaceId, {
      evidenceId, sourceId, statement, locator: locator || null, type: type || null, createdAt: now(),
    });
  }

  async function addClaim({ workspaceId, proposition, strength, evidenceRefs = [], status = null }) {
    const claimId = idFactory('claim');
    // strength được kho ràng vào thang SUGGESTS..CAUSES; sai thang là ném lỗi.
    return store.put('claim', workspaceId, {
      claimId, proposition, strength, evidenceRefs, status: status || null, createdAt: now(),
    });
  }

  async function createContent({ workspaceId, projectId, contentJob, payload = {}, title = null }) {
    const project = await store.get('project', workspaceId, projectId);
    if (!project) throw err('PROJECT_NOT_FOUND', `Project not found: ${projectId}`);

    const contentId = idFactory('content');
    const revisionId = idFactory('revision');
    const at = now();

    // Revision ghi TRƯỚC: nếu tiến trình chết giữa chừng thì tệ nhất là một revision
    // mồ côi, chứ không phải ContentItem trỏ tới revision không tồn tại.
    await store.put('revision', workspaceId, {
      revisionId, contentId, parentRevisionId: null, operation: 'CREATE',
      payload, actor: 'system', createdAt: at,
    });

    return store.put('content', workspaceId, {
      contentId, projectId, contentJob, title: title || null,
      currentRevisionId: revisionId, status: 'draft', createdAt: at,
    });
  }

  async function appendRevision({ workspaceId, contentId, operation, payload = {}, actor = 'system' }) {
    const content = await store.get('content', workspaceId, contentId);
    if (!content) throw err('CONTENT_NOT_FOUND', `Content not found: ${contentId}`);

    const revisionId = idFactory('revision');
    const at = now();
    const revision = await store.put('revision', workspaceId, {
      revisionId, contentId, parentRevisionId: content.currentRevisionId || null,
      operation, payload, actor, createdAt: at,
    });

    // ContentItem là metadata thay đổi được: CHỈ dời con trỏ, không đụng lineage.
    await store.put('content', workspaceId, { ...content, currentRevisionId: revisionId, updatedAt: at });
    return revision;
  }

  const getContent = (workspaceId, contentId) => store.get('content', workspaceId, contentId);

  // Lịch sử theo đúng thứ tự nối: đi từ revision gốc xuống, bám parentRevisionId.
  async function getContentHistory(workspaceId, contentId) {
    const all = (await store.list('revision', workspaceId)).filter((r) => r.contentId === contentId);
    const byParent = new Map();
    for (const r of all) byParent.set(r.parentRevisionId || null, r);
    const ordered = [];
    let cursor = byParent.get(null);
    const seen = new Set();
    while (cursor && !seen.has(cursor.revisionId)) {
      ordered.push(cursor);
      seen.add(cursor.revisionId);
      cursor = byParent.get(cursor.revisionId);
    }
    // Nhánh rẽ (cùng parent) không nằm trên chuỗi chính — nối vào cuối để không mất dữ liệu.
    for (const r of all) if (!seen.has(r.revisionId)) ordered.push(r);
    return ordered;
  }

  // Kết quả đánh giá gắn với ĐÚNG một revision và là bản ghi BẤT BIẾN: nó là nhận định về
  // một bản cụ thể tại một thời điểm. Sửa bài rồi giữ nguyên điểm cũ là nói dối về bản mới.
  async function addEvaluation({ workspaceId, revisionId, contentId, evaluator, dimension, verdict, score = null, findings = [] }) {
    const revision = await store.get('revision', workspaceId, revisionId);
    if (!revision) throw err('REVISION_NOT_FOUND', `Revision not found: ${revisionId}`);
    const evaluationId = idFactory('evaluation');
    return store.put('evaluation', workspaceId, {
      evaluationId, revisionId, contentId: contentId || revision.contentId,
      evaluator, dimension: dimension || null, verdict, score, findings, createdAt: now(),
    });
  }

  async function listEvaluations(workspaceId, revisionId) {
    const all = await store.list('evaluation', workspaceId);
    return revisionId ? all.filter((e) => e.revisionId === revisionId) : all;
  }

  // Tín hiệu người dùng: chấp nhận, từ chối, đã áp dụng lên trang…
  //
  // Đây là QUAN SÁT, không phải luật. Một lần từ chối nghĩa là "lần này không hợp", không
  // phải "cấm vĩnh viễn cách viết này". Biến tín hiệu thành luật cứng ngay lập tức sẽ khiến
  // hệ thống học sai từ một lần bấm nhầm, và người dùng không có cách nào lấy lại.
  //
  // Mỗi tín hiệu mang đủ PHẠM VI để sau này dùng đúng chỗ: dự án, thương hiệu, loại nội dung.
  // Thiếu phạm vi thì một câu bị từ chối ở thương hiệu A sẽ âm thầm ảnh hưởng thương hiệu B.
  const SIGNAL_TYPES = ['ACCEPT', 'REJECT', 'MANUAL_EDIT', 'AUDIT_REPAIR', 'APPLIED_TO_PAGE', 'PROVIDER_PREFERENCE'];

  async function addSignal({
    workspaceId, contentId, revisionId, type, value = null,
    projectId = null, brandId = null, providerId = null, jobType = null,
  }) {
    if (!SIGNAL_TYPES.includes(type)) {
      throw err('INVALID_SIGNAL_TYPE', `Signal type must be one of ${SIGNAL_TYPES.join(', ')}.`);
    }
    const revision = revisionId ? await store.get('revision', workspaceId, revisionId) : null;
    if (revisionId && !revision) throw err('REVISION_NOT_FOUND', `Revision not found: ${revisionId}`);

    const content = contentId ? await store.get('content', workspaceId, contentId) : null;
    if (contentId && !content) throw err('CONTENT_NOT_FOUND', `Content not found: ${contentId}`);

    return store.put('signal', workspaceId, {
      signalId: idFactory('signal'),
      type,
      at: now(),
      contentId: contentId || null,
      revisionId: revisionId || null,
      // Phạm vi lấy từ chính bản ghi khi có, để một tín hiệu không thể tự khai sai chỗ nó thuộc về.
      projectId: projectId || content?.projectId || null,
      brandId: brandId || null,
      providerId: providerId || null,
      jobType: jobType || content?.contentJob || null,
      value,
    });
  }

  async function listSignals(workspaceId, filter = {}) {
    const all = await store.list('signal', workspaceId);
    return all.filter((signal) => Object.entries(filter).every(([key, value]) => value === undefined || signal[key] === value));
  }

  return {
    addSource, addEvidence, addClaim, createContent, appendRevision,
    getContent, getContentHistory, addEvaluation, listEvaluations,
    addSignal, listSignals, SIGNAL_TYPES,
  };
}

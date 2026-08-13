import { el, card, empty, field, table, notice } from '../dom.mjs';
import { routeToHash } from '../state.mjs';

// Màn viết: brief -> chạy Write -> dòng thời gian revision -> Edit -> duyệt.
//
// Bản nháp trong ô textarea KHÔNG phải bản chính thức. Nó chỉ là chữ đang gõ; bấm lưu mới
// gọi Runtime, và revisionId trả về mới là thứ tồn tại. Coi bản trong trình duyệt là thật
// nghĩa là một lần đóng tab sẽ mất bài mà không ai được báo.

/** Dòng thời gian revision — mới nhất trước, nhưng số thứ tự theo đúng thứ tự tạo. */
export function revisionTimelineModel(history, { error = null } = {}) {
  if (error) return { state: 'error', code: error.code, message: error.message, rows: [] };
  if (!history || !history.length) return { state: 'empty', hint: 'Chưa có bản nào.', rows: [] };
  const rows = history.map((revision, index) => ({
    revisionId: revision.revisionId,
    ordinal: index + 1,
    operation: revision.operation,
    createdAt: revision.createdAt,
    parentRevisionId: revision.parentRevisionId || null,
    title: revision.payload?.fields?.title || '(không tiêu đề)',
    // Bản gốc không bao giờ biến mất khỏi danh sách: lịch sử là bằng chứng, không phải bộ đệm.
    isFirst: index === 0,
    isLatest: index === history.length - 1,
  }));
  return { state: 'data', rows: [...rows].reverse(), latestRevisionId: rows[rows.length - 1].revisionId };
}

export function draftFieldsModel(revision) {
  const fields = revision?.payload?.fields || {};
  return {
    title: fields.title || '',
    body: fields.body || '',
    sections: Array.isArray(fields.sections) ? fields.sections : [],
    // Bản trong trình duyệt luôn được đánh dấu là TẠM. Không có nhãn này, một ô chữ đã sửa
    // trông y hệt một bản đã lưu.
    pending: true,
  };
}

export async function render({ api, state, navigate }) {
  const projectId = state.selectedProjectId;
  if (!projectId) return el('section', {}, [el('h1', { text: 'Nội dung' }), empty('Chọn một dự án trước.')]);

  const contentId = state.selectedContentId;
  const jobTypeSelect = el('select', {}, [
    el('option', { value: 'article', text: 'Bài viết' }),
    el('option', { value: 'product', text: 'Nội dung sản phẩm' }),
    el('option', { value: 'transcript', text: 'Transcript' }),
  ]);
  const objectiveInput = el('input', { type: 'text', placeholder: 'Mục tiêu bài viết' });
  const intentInput = el('input', { type: 'text', value: 'INFORMATIONAL' });
  const angleInput = el('input', { type: 'text', placeholder: 'Góc tiếp cận' });
  const feedback = el('div');

  const writeButton = el('button', {
    class: 'primary',
    text: 'Chạy Write',
    onclick: async () => {
      writeButton.disabled = true;
      feedback.replaceChildren(notice('info', 'Đang chạy… nội dung sẽ được gửi tới nhà cung cấp đã chọn.'));
      try {
        const job = await api.runWrite(projectId, {
          jobType: jobTypeSelect.value,
          brief: {
            objective: objectiveInput.value.trim(),
            intent: intentInput.value.trim() || 'INFORMATIONAL',
            angle: angleInput.value.trim() || 'trung tính',
          },
          contextSnapshotId: `contextsnapshot_${Date.now()}`,
          context: { evidenceById: {}, claimsById: {} },
        });
        if (job.contentId) navigate(routeToHash({ section: 'content', projectId, contentId: job.contentId }));
        else feedback.replaceChildren(notice('error', `Job ${job.status} — ${job.outcome?.error?.code || 'chưa hoàn tất'}`));
      } catch (error) {
        feedback.replaceChildren(notice('error', `${error.code} — ${error.message}`));
      }
      writeButton.disabled = false;
    },
  });

  const briefCard = card([
    field('Loại nội dung', jobTypeSelect),
    field('Mục tiêu', objectiveInput),
    field('Ý định', intentInput),
    field('Góc tiếp cận', angleInput),
    writeButton,
    feedback,
  ]);

  if (!contentId) {
    return el('section', {}, [el('h1', { text: 'Nội dung' }), briefCard, empty('Chưa chọn nội dung nào.')]);
  }

  let model;
  try {
    model = revisionTimelineModel(await api.getContentHistory(contentId));
  } catch (error) {
    model = revisionTimelineModel(null, { error });
  }

  const editInstruction = el('input', { type: 'text', placeholder: 'Yêu cầu sửa, ví dụ: bỏ câu mở thừa' });
  const editOperation = el('select', {}, ['SHORTEN', 'EXPAND', 'SIMPLIFY', 'CLARIFY', 'DESLOP', 'PROFESSIONALIZE']
    .map((op) => el('option', { value: op, text: op })));
  const editFeedback = el('div');

  const editButton = el('button', {
    text: 'Chạy Edit',
    onclick: async () => {
      editButton.disabled = true;
      editFeedback.replaceChildren(notice('info', 'Đang sửa…'));
      try {
        const result = await api.runEdit(contentId, {
          revisionId: model.latestRevisionId,
          operation: editOperation.value,
          instruction: editInstruction.value.trim(),
          context: { evidenceById: {}, claimsById: {} },
        });
        if (result.revision) navigate(location.hash);
        else {
          // Sửa bị chặn thì nói RÕ lý do. Một câu "không thành công" khiến người dùng bấm lại
          // và nhận đúng kết quả đó lần nữa.
          editFeedback.replaceChildren(...result.issues.map((i) => notice('error', `${i.code} — ${i.message || ''}`)));
        }
      } catch (error) {
        editFeedback.replaceChildren(notice('error', `${error.code} — ${error.message}`));
      }
      editButton.disabled = false;
    },
  });

  const timeline = model.state === 'data'
    ? table(['#', 'Thao tác', 'Tiêu đề', 'Lúc', 'Bản'], model.rows.map((r) => [
      String(r.ordinal), r.operation, r.title, r.createdAt, r.isLatest ? 'mới nhất' : '',
    ]))
    : empty(model.state === 'error' ? `${model.code} — ${model.message}` : model.hint);

  return el('section', {}, [
    el('h1', { text: 'Nội dung' }),
    briefCard,
    card([el('h2', { text: 'Sửa' }), field('Thao tác', editOperation), field('Yêu cầu', editInstruction), editButton, editFeedback]),
    card([el('h2', { text: 'Lịch sử bản' }), timeline]),
  ]);
}

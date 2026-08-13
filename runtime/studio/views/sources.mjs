import { el, card, empty, table, field } from '../dom.mjs';

// Nguồn của một dự án: nơi mọi dữ kiện trong bài phải truy về được.

/**
 * Mô hình hiển thị THUẦN.
 *
 * Xuất xứ luôn hiện ra: hash, thời điểm chụp, đường dẫn gốc. Một nguồn không hiện được ba
 * thứ đó thì người dùng không có cách nào biết bài viết đang dựa trên cái gì.
 */
export function sourceListModel(sources, { loading = false, error = null } = {}) {
  if (error) return { state: 'error', message: error.message, code: error.code, rows: [] };
  if (loading) return { state: 'loading', rows: [] };
  if (!sources || !sources.length) {
    return { state: 'empty', hint: 'Chưa có nguồn nào. Thêm nguồn trước khi viết bài có dẫn chứng.', rows: [] };
  }
  return {
    state: 'data',
    rows: sources.map((s) => ({
      sourceId: s.sourceId,
      kind: s.kind || '—',
      title: s.title || '(không tiêu đề)',
      canonicalUrl: s.canonicalUrl || '(nguồn cục bộ)',
      // Rút gọn để đọc được, nhưng vẫn là hash thật — không phải một nhãn "đã xác minh" chung chung.
      sha256: s.sha256 ? `${s.sha256.slice(0, 12)}…` : '—',
      retrievedAt: s.retrievedAt || s.capturedAt || '—',
      evidenceCount: Number.isInteger(s.evidenceCount) ? s.evidenceCount : 0,
      // Chưa trích bằng chứng nào thì nói thẳng: nguồn có mặt không có nghĩa là bài đã dùng nó.
      verification: s.evidenceCount ? 'đã trích bằng chứng' : 'chưa trích bằng chứng',
    })),
  };
}

export async function render({ api, state, navigate }) {
  const projectId = state.selectedProjectId;
  if (!projectId) return el('section', {}, [el('h1', { text: 'Nguồn' }), empty('Chọn một dự án trước.')]);

  let model;
  try {
    const project = await api.getProject(projectId);
    model = sourceListModel(project.sources || []);
  } catch (error) {
    model = sourceListModel(null, { error });
  }

  const titleInput = el('input', { type: 'text', placeholder: 'Tiêu đề nguồn' });
  const urlInput = el('input', { type: 'url', placeholder: 'https://…  (tùy chọn)' });
  const textInput = el('textarea', { placeholder: 'Dán nội dung nguồn ở đây' });
  const feedback = el('p', { class: 'muted' });

  const addButton = el('button', {
    class: 'primary',
    text: 'Thêm nguồn',
    onclick: async () => {
      const text = textInput.value;
      if (!text.trim() && !urlInput.value.trim()) {
        feedback.textContent = 'Cần nội dung hoặc đường dẫn nguồn.';
        return;
      }
      addButton.disabled = true;
      feedback.textContent = 'Đang lưu…';
      try {
        await api.addSource(projectId, {
          kind: urlInput.value.trim() ? 'html' : 'note',
          title: titleInput.value.trim() || null,
          canonicalUrl: urlInput.value.trim() || null,
          // Runtime băm và lưu byte gốc; Studio không tự tính hash rồi khai là đã xác minh.
          bytesBase64: text.trim() ? btoa(unescape(encodeURIComponent(text))) : undefined,
        });
        navigate(location.hash);
      } catch (error) {
        feedback.textContent = `${error.code} — ${error.message}`;
        addButton.disabled = false;
      }
    },
  });

  const list = model.state === 'data'
    ? table(
      ['Loại', 'Tiêu đề', 'Đường dẫn', 'Hash', 'Lấy lúc', 'Bằng chứng'],
      model.rows.map((r) => [r.kind, r.title, r.canonicalUrl, r.sha256, r.retrievedAt, `${r.evidenceCount} — ${r.verification}`]),
    )
    : empty(model.state === 'error' ? `${model.code} — ${model.message}` : model.hint || 'Đang tải…');

  return el('section', {}, [
    el('h1', { text: 'Nguồn' }),
    card([field('Tiêu đề', titleInput), field('Đường dẫn gốc', urlInput), field('Nội dung', textInput), addButton, feedback]),
    card([list]),
  ]);
}

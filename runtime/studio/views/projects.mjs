import { el, card, empty, table } from '../dom.mjs';
import { routeToHash } from '../state.mjs';

// Danh sách và tạo dự án.

/** Mô hình hiển thị THUẦN — test được trong node, không cần trình duyệt. */
export function projectListModel(projects, { loading = false, error = null } = {}) {
  if (error) return { state: 'error', message: error.message, code: error.code, rows: [] };
  if (loading) return { state: 'loading', rows: [] };
  if (!projects || !projects.length) {
    return { state: 'empty', hint: 'Chưa có dự án nào. Tạo một dự án để bắt đầu.', rows: [] };
  }
  return {
    state: 'data',
    rows: projects.map((p) => ({
      projectId: p.projectId,
      name: p.name,
      objective: p.objective || '—',
      // Chưa gắn thương hiệu là một trạng thái BÌNH THƯỜNG, không phải lỗi: viết được mà
      // chưa có brand kit là chuyện hợp lệ.
      brand: p.brandId || 'chưa gắn',
      status: p.status || 'active',
    })),
  };
}

export async function render({ api, navigate }) {
  let model;
  try {
    model = projectListModel(await api.listProjects());
  } catch (error) {
    model = projectListModel(null, { error });
  }

  const nameInput = el('input', { type: 'text', placeholder: 'Tên dự án', required: 'required' });
  const objectiveInput = el('input', { type: 'text', placeholder: 'Mục tiêu (tùy chọn)' });
  const feedback = el('p', { class: 'muted' });

  const createButton = el('button', {
    class: 'primary',
    text: 'Tạo dự án',
    onclick: async () => {
      const name = nameInput.value.trim();
      if (!name) { feedback.textContent = 'Cần có tên dự án.'; return; }
      createButton.disabled = true;
      feedback.textContent = 'Đang tạo…';
      try {
        // ID do Runtime cấp. Sinh ID trong trình duyệt rồi hy vọng máy chủ dùng đúng nó là
        // cách chắc chắn để có hai bản ghi cho một dự án.
        const project = await api.createProject({ name, objective: objectiveInput.value.trim() || undefined });
        navigate(routeToHash({ section: 'content', projectId: project.projectId }));
      } catch (error) {
        feedback.textContent = `${error.code} — ${error.message}`;
        createButton.disabled = false;
      }
    },
  });

  const list = model.state === 'data'
    ? table(
      ['Dự án', 'Mục tiêu', 'Thương hiệu', 'Trạng thái', ''],
      model.rows.map((row) => [
        row.name, row.objective, row.brand, row.status,
        el('button', { text: 'Mở', onclick: () => navigate(routeToHash({ section: 'content', projectId: row.projectId })) }),
      ]),
    )
    : empty(model.state === 'error' ? `${model.code} — ${model.message}` : model.hint || 'Đang tải…');

  return el('section', {}, [
    el('h1', { text: 'Dự án' }),
    card([el('div', { class: 'row' }, [nameInput, objectiveInput, createButton]), feedback]),
    card([list]),
  ]);
}

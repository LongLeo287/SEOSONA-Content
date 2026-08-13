import { el, card } from '../dom.mjs';
import { routeToHash } from '../state.mjs';

// Thanh ngữ cảnh dự án dùng chung cho mọi màn: đang ở dự án nào, và đi nhanh sang khu vực khác.

const SECTIONS = [
  ['sources', 'Nguồn'], ['brand', 'Thương hiệu'], ['content', 'Nội dung'],
  ['audit', 'Đánh giá'], ['transcript', 'Transcript'],
];

/** Mô hình THUẦN của thanh ngữ cảnh. */
export function projectWorkspaceModel(project, route) {
  return {
    // Chưa chọn dự án là một trạng thái hợp lệ, không phải lỗi — màn hình phải nói phải làm gì.
    state: project ? 'data' : 'no-project',
    projectId: project?.projectId || null,
    name: project?.name || null,
    objective: project?.objective || '',
    activeSection: route?.section || 'content',
    links: SECTIONS.map(([section, label]) => ({
      section, label, active: route?.section === section,
      hash: project ? routeToHash({ section, projectId: project.projectId }) : '#/projects',
    })),
  };
}

export function render({ project, route, navigate }) {
  const model = projectWorkspaceModel(project, route);
  if (model.state === 'no-project') {
    return card([el('p', { class: 'muted', text: 'Chưa chọn dự án. Vào Projects để chọn hoặc tạo một dự án.' })]);
  }
  return card([
    el('div', { class: 'row' }, [
      el('strong', { text: model.name }),
      el('span', { class: 'muted', text: model.objective || '—' }),
    ]),
    el('div', { class: 'row' }, model.links.map((link) => el('button', {
      text: link.label,
      class: link.active ? 'primary' : '',
      onclick: () => navigate(link.hash),
    }))),
  ]);
}

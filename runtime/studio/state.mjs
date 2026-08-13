// Trạng thái điều hướng/hiển thị của Studio — HÀM THUẦN.
//
// Không DOM, không fetch, không biết Runtime hay nhà cung cấp nào tồn tại. Nhờ vậy toàn bộ
// luật "màn hình nào hiện gì" test được trong node, và giao diện không có chỗ nào giấu một
// quyết định mà không ai kiểm được.
//
// Trạng thái này chỉ nói MÀN HÌNH ĐANG Ở ĐÂU. Nội dung bài viết, revision, kết quả đánh giá
// đều lấy tươi từ Runtime — nhét bản sao của chúng vào đây sẽ tạo ra một phiên bản sự thật
// thứ hai, và bản trên màn hình sẽ lệch dần khỏi bản trên đĩa.

export const SECTIONS = Object.freeze(['projects', 'sources', 'brand', 'content', 'audit', 'transcript', 'providers']);

export const EVENTS = Object.freeze([
  'ROUTE_CHANGED', 'PROJECT_SELECTED', 'CONTENT_SELECTED',
  'REQUEST_STARTED', 'REQUEST_SUCCEEDED', 'REQUEST_FAILED', 'NOTICE_DISMISSED',
]);

export function createStudioState() {
  return Object.freeze({
    route: { section: 'projects', projectId: null, contentId: null },
    selectedProjectId: null,
    selectedContentId: null,
    busy: false,
    error: null,
    notice: null,
  });
}

/** `#/projects/:projectId/:section/:contentId?` hoặc `#/:section` */
export function parseRoute(hash) {
  const parts = String(hash || '').replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'projects' && parts[1]) {
    return {
      section: SECTIONS.includes(parts[2]) ? parts[2] : 'content',
      projectId: parts[1],
      contentId: parts[3] || null,
    };
  }
  return { section: SECTIONS.includes(parts[0]) ? parts[0] : 'projects', projectId: null, contentId: null };
}

export function routeToHash({ section = 'projects', projectId = null, contentId = null } = {}) {
  if (!projectId) return `#/${section}`;
  return contentId ? `#/projects/${projectId}/${section}/${contentId}` : `#/projects/${projectId}/${section}`;
}

export function reduceStudioState(state, event) {
  if (!event || !EVENTS.includes(event.type)) {
    // Sự kiện lạ bị ném lỗi thay vì lặng lẽ bỏ qua: một hành động không tới nơi mà giao diện
    // vẫn im lặng là kiểu lỗi người dùng chỉ phát hiện khi thấy dữ liệu sai.
    throw new Error(`Unknown studio event: ${event && event.type}.`);
  }

  switch (event.type) {
    case 'ROUTE_CHANGED': {
      const route = event.route || parseRoute(event.hash);
      const projectId = route.projectId ?? state.selectedProjectId;
      const projectChanged = projectId !== state.selectedProjectId;
      return {
        ...state,
        route,
        selectedProjectId: projectId,
        // Nội dung do CHÍNH route chỉ định luôn thắng. Chỉ phần chọn MANG THEO từ màn hình
        // trước mới bị bỏ khi đổi dự án — giữ lại sẽ khiến màn hình hiện bài của dự án cũ
        // dưới tên dự án mới, và thao tác tiếp theo ghi vào nhầm chỗ.
        selectedContentId: route.contentId ?? (projectChanged ? null : state.selectedContentId),
        error: null,
      };
    }

    case 'PROJECT_SELECTED': {
      if (event.projectId === state.selectedProjectId) return state;
      return { ...state, selectedProjectId: event.projectId, selectedContentId: null, error: null };
    }

    case 'CONTENT_SELECTED':
      return { ...state, selectedContentId: event.contentId ?? null };

    case 'REQUEST_STARTED':
      // Lỗi cũ biến mất khi bắt đầu việc mới; để nguyên sẽ khiến người dùng đọc một lỗi
      // thuộc về thao tác trước đó.
      return { ...state, busy: true, error: null };

    case 'REQUEST_SUCCEEDED':
      return { ...state, busy: false, error: null, notice: event.notice ?? null };

    case 'REQUEST_FAILED':
      // busy PHẢI được gỡ ở đây. Quên nó là giao diện kẹt ở "đang chạy…" vĩnh viễn và người
      // dùng không còn cách nào thử lại.
      return {
        ...state,
        busy: false,
        notice: null,
        error: {
          code: event.error?.code || 'RUNTIME_ERROR',
          message: event.error?.message || 'Runtime không hoàn tất được yêu cầu.',
          retryable: event.error?.retryable === true,
        },
      };

    case 'NOTICE_DISMISSED':
      return { ...state, notice: null, error: null };

    default:
      return state;
  }
}

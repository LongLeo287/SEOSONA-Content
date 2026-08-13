import { createStudioApiClient } from '/studio/api-client.mjs';
import { createStudioState, reduceStudioState, parseRoute, routeToHash } from '/studio/state.mjs';

// Bộ điều khiển cấp trang của Studio.
//
// Việc của file này chỉ có: đọc route từ hash, gọi API, đưa state cho view, gắn kết quả vào DOM.
// Không có luật viết, không có xét bằng chứng, không có chọn nhà cung cấp ở đây — những thứ đó
// nằm ở Runtime. Một bản sao logic trong trình duyệt sẽ là bản trôi khỏi bản thật.

const api = createStudioApiClient();
const main = document.getElementById('studio-main');
const statusEl = document.getElementById('runtime-status');
const statusText = document.getElementById('runtime-status-text');

function markActiveNav(section) {
  for (const link of document.querySelectorAll('.sidebar a')) {
    if (link.dataset.section === section) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

function showError(error) {
  main.replaceChildren();
  const box = document.createElement('div');
  box.className = 'notice error';
  // textContent, không innerHTML: thông điệp lỗi có thể mang theo chữ từ nguồn của người dùng.
  box.textContent = `${error.code || 'ERROR'} — ${error.message}`;
  main.append(box);
}

async function checkRuntime() {
  try {
    const health = await api.health();
    statusEl.dataset.state = 'ready';
    statusText.textContent = `Runtime ${health.status} · API ${health.apiVersion}`;
    return true;
  } catch {
    statusEl.dataset.state = 'offline';
    statusText.textContent = 'Không kết nối được Local Runtime';
    return false;
  }
}

const VIEWS = {
  projects: () => import('/studio/views/projects.mjs'),
  sources: () => import('/studio/views/sources.mjs'),
  brand: () => import('/studio/views/brand.mjs'),
  content: () => import('/studio/views/content-editor.mjs'),
  audit: () => import('/studio/views/audit.mjs'),
  transcript: () => import('/studio/views/transcript.mjs'),
  providers: () => import('/studio/views/providers.mjs'),
};

// Toàn bộ trạng thái màn hình đi qua reducer thuần. app.mjs không tự sửa state bằng tay —
// nếu nó tự sửa thì luật điều hướng lại có hai bản, và bản trong file này không ai test.
let state = createStudioState();

function dispatch(event) {
  state = reduceStudioState(state, event);
  return state;
}

async function render() {
  dispatch({ type: 'ROUTE_CHANGED', route: parseRoute(location.hash) });
  markActiveNav(state.route.section);
  main.replaceChildren(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'Đang tải…' }));

  try {
    dispatch({ type: 'REQUEST_STARTED' });
    const module = await VIEWS[state.route.section]();
    const node = await module.render({ api, state, navigate, dispatch });
    dispatch({ type: 'REQUEST_SUCCEEDED' });
    main.replaceChildren(node);
  } catch (error) {
    dispatch({ type: 'REQUEST_FAILED', error });
    showError(state.error);
  }
}

function navigate(target) {
  const hash = typeof target === 'string' ? target : routeToHash(target);
  if (location.hash === hash) render();
  else location.hash = hash;
}

window.addEventListener('hashchange', render);
checkRuntime().then(render);

export { dispatch, navigate };

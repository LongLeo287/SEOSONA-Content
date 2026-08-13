import { createStudioApiClient } from '/studio/api-client.mjs';

// Bộ điều khiển cấp trang của Studio.
//
// Việc của file này chỉ có: đọc route từ hash, gọi API, đưa state cho view, gắn kết quả vào DOM.
// Không có luật viết, không có xét bằng chứng, không có chọn nhà cung cấp ở đây — những thứ đó
// nằm ở Runtime. Một bản sao logic trong trình duyệt sẽ là bản trôi khỏi bản thật.

const api = createStudioApiClient();
const main = document.getElementById('studio-main');
const statusEl = document.getElementById('runtime-status');
const statusText = document.getElementById('runtime-status-text');

const SECTIONS = ['projects', 'sources', 'brand', 'content', 'audit', 'transcript', 'providers'];

function parseRoute(hash) {
  // #/projects/<projectId>/<section>  hoặc  #/<section>
  const parts = String(hash || '').replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'projects' && parts[1]) {
    return { section: SECTIONS.includes(parts[2]) ? parts[2] : 'content', projectId: parts[1], contentId: parts[3] || null };
  }
  return { section: SECTIONS.includes(parts[0]) ? parts[0] : 'projects', projectId: null, contentId: null };
}

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

async function render() {
  const route = parseRoute(location.hash);
  markActiveNav(route.section);
  main.replaceChildren(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'Đang tải…' }));

  try {
    const module = await VIEWS[route.section]();
    const node = await module.render({ api, route, navigate });
    main.replaceChildren(node);
  } catch (error) {
    showError(error);
  }
}

function navigate(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

window.addEventListener('hashchange', render);
checkRuntime().then(render);

export { parseRoute };

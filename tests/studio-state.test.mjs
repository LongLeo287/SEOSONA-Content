import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStudioState, reduceStudioState, parseRoute, routeToHash, SECTIONS } from '../runtime/studio/state.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const reduce = (state, event) => reduceStudioState(state, event);

test('a fresh studio starts on projects with nothing selected and nothing running', () => {
  const state = createStudioState();
  assert.equal(state.route.section, 'projects');
  assert.equal(state.selectedProjectId, null);
  assert.equal(state.selectedContentId, null);
  assert.equal(state.busy, false);
  assert.equal(state.error, null);
});

test('routes parse both the plain and the project scoped form', () => {
  assert.deepEqual(parseRoute('#/providers'), { section: 'providers', projectId: null, contentId: null });
  assert.deepEqual(parseRoute('#/projects/project_1/audit'), { section: 'audit', projectId: 'project_1', contentId: null });
  assert.deepEqual(parseRoute('#/projects/project_1/content/content_9'), { section: 'content', projectId: 'project_1', contentId: 'content_9' });
  // Khu vực không tồn tại thì về mặc định thay vì hiện một màn hình trắng.
  assert.equal(parseRoute('#/khong-co').section, 'projects');
  assert.equal(parseRoute('#/projects/project_1/khong-co').section, 'content');
  assert.equal(parseRoute('').section, 'projects');
});

test('routes round trip back to a hash', () => {
  for (const route of [
    { section: 'providers', projectId: null, contentId: null },
    { section: 'audit', projectId: 'project_1', contentId: null },
    { section: 'content', projectId: 'project_1', contentId: 'content_9' },
  ]) {
    assert.deepEqual(parseRoute(routeToHash(route)), route);
  }
});

test('navigating into a project selects it', () => {
  const state = reduce(createStudioState(), { type: 'ROUTE_CHANGED', hash: '#/projects/project_1/sources' });
  assert.equal(state.selectedProjectId, 'project_1');
  assert.equal(state.route.section, 'sources');
});

// Giữ lại nội dung của dự án cũ khi đã sang dự án mới nghĩa là màn hình hiện bài của A dưới
// tên B — và thao tác tiếp theo ghi vào nhầm chỗ.
test('switching project clears the previously selected content', () => {
  let state = reduce(createStudioState(), { type: 'ROUTE_CHANGED', hash: '#/projects/project_1/content/content_9' });
  assert.equal(state.selectedContentId, 'content_9');

  state = reduce(state, { type: 'ROUTE_CHANGED', hash: '#/projects/project_2/content' });
  assert.equal(state.selectedProjectId, 'project_2');
  assert.equal(state.selectedContentId, null, 'no content from the previous project may survive');

  const direct = reduce(
    reduce(createStudioState(), { type: 'CONTENT_SELECTED', contentId: 'content_9' }),
    { type: 'PROJECT_SELECTED', projectId: 'project_3' },
  );
  assert.equal(direct.selectedContentId, null);
});

test('selecting the same project again changes nothing', () => {
  const first = reduce(createStudioState(), { type: 'PROJECT_SELECTED', projectId: 'project_1' });
  const withContent = reduce(first, { type: 'CONTENT_SELECTED', contentId: 'content_9' });
  const again = reduce(withContent, { type: 'PROJECT_SELECTED', projectId: 'project_1' });
  assert.equal(again, withContent, 'a no-op selection does not throw away the open content');
});

test('staying in the same project keeps the content selection across sections', () => {
  let state = reduce(createStudioState(), { type: 'ROUTE_CHANGED', hash: '#/projects/project_1/content/content_9' });
  state = reduce(state, { type: 'ROUTE_CHANGED', hash: '#/projects/project_1/audit' });
  assert.equal(state.selectedContentId, 'content_9', 'auditing the piece you were writing needs it to still be selected');
});

test('a request marks busy and clears the previous error', () => {
  let state = reduce(createStudioState(), { type: 'REQUEST_FAILED', error: { code: 'TIMEOUT', message: 'hết giờ' } });
  assert.equal(state.error.code, 'TIMEOUT');

  state = reduce(state, { type: 'REQUEST_STARTED' });
  assert.equal(state.busy, true);
  assert.equal(state.error, null, 'a new attempt must not show the previous attempt error');
});

// Quên gỡ busy khi hỏng là giao diện kẹt ở "đang chạy…" và người dùng hết đường thử lại.
test('a failed request always releases busy and reports the real reason', () => {
  const running = reduce(createStudioState(), { type: 'REQUEST_STARTED' });
  const failed = reduce(running, {
    type: 'REQUEST_FAILED',
    error: { code: 'PAID_PROVIDER_BLOCKED', message: 'chỉ còn hãng tốn tiền', retryable: false },
  });
  assert.equal(failed.busy, false);
  assert.equal(failed.error.code, 'PAID_PROVIDER_BLOCKED');
  assert.equal(failed.error.retryable, false);
  assert.equal(failed.notice, null);
});

test('an error with no detail still gets a code and a message', () => {
  const failed = reduce(createStudioState(), { type: 'REQUEST_FAILED' });
  assert.equal(failed.error.code, 'RUNTIME_ERROR');
  assert.ok(failed.error.message.length > 0);
});

test('a successful request releases busy and may leave a notice', () => {
  const state = reduce(
    reduce(createStudioState(), { type: 'REQUEST_STARTED' }),
    { type: 'REQUEST_SUCCEEDED', notice: 'Đã lưu bản mới.' },
  );
  assert.equal(state.busy, false);
  assert.equal(state.notice, 'Đã lưu bản mới.');
  assert.equal(reduce(state, { type: 'NOTICE_DISMISSED' }).notice, null);
});

test('an unknown event is refused rather than silently ignored', () => {
  assert.throws(() => reduce(createStudioState(), { type: 'MAKE_COFFEE' }), /Unknown studio event/);
  assert.throws(() => reduce(createStudioState(), null), /Unknown studio event/);
});

test('the reducer never mutates the state it was given', () => {
  const before = createStudioState();
  const snapshot = JSON.parse(JSON.stringify(before));
  reduce(before, { type: 'PROJECT_SELECTED', projectId: 'project_1' });
  reduce(before, { type: 'REQUEST_STARTED' });
  assert.deepEqual(JSON.parse(JSON.stringify(before)), snapshot);
});

// Trạng thái giao diện là trạng thái giao diện. Có bài viết, revision hay kết quả chấm ở đây
// nghĩa là đã có phiên bản sự thật thứ hai trong trình duyệt.
test('state.mjs contains no dom, no fetch and no runtime knowledge', () => {
  const source = readFileSync(join(here, '../runtime/studio/state.mjs'), 'utf8');
  for (const forbidden of ['document', 'window', 'fetch(', 'localStorage', 'chatgpt', 'providerId']) {
    assert.ok(!source.includes(forbidden), `state.mjs must not reference ${forbidden}`);
  }
});

test('every navigable section is a real section', () => {
  const html = readFileSync(join(here, '../runtime/studio/index.html'), 'utf8');
  for (const section of SECTIONS) {
    assert.ok(html.includes(`data-section="${section}"`), `the shell must link ${section}`);
  }
});

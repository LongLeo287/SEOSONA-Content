import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStudioState, reduceStudioState, parseRoute, routeToHash, SECTIONS } from '../runtime/studio/state.mjs';
import { projectListModel } from '../runtime/studio/views/projects.mjs';
import { sourceListModel } from '../runtime/studio/views/sources.mjs';
import { brandFormModel } from '../runtime/studio/views/brand.mjs';
import { revisionTimelineModel, draftFieldsModel } from '../runtime/studio/views/content-editor.mjs';
import { auditFindingsModel } from '../runtime/studio/views/audit.mjs';
import { cueTableModel, formatMs } from '../runtime/studio/views/transcript.mjs';
import { providerListModel, routePreviewModel } from '../runtime/studio/views/providers.mjs';
import { projectWorkspaceModel } from '../runtime/studio/views/project-workspace.mjs';

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

// ================================================================ Mô hình hiển thị của view

const err = (code, message) => ({ code, message });

test('the project list shows empty, error and data states distinctly', () => {
  assert.equal(projectListModel([]).state, 'empty');
  assert.ok(projectListModel([]).hint.length > 0, 'an empty workspace says what to do next');
  assert.equal(projectListModel(null, { loading: true }).state, 'loading');
  assert.equal(projectListModel(null, { error: err('RUNTIME_ERROR', 'offline') }).state, 'error');

  const model = projectListModel([{ projectId: 'project_1', name: 'P', objective: '', brandId: null }]);
  assert.equal(model.state, 'data');
  // Chưa gắn thương hiệu là trạng thái bình thường, không phải lỗi.
  assert.equal(model.rows[0].brand, 'chưa gắn');
  assert.equal(model.rows[0].objective, '—');
});

// Xuất xứ phải nhìn thấy được: không có hash và thời điểm lấy thì người dùng không biết
// bài viết đang dựa trên cái gì.
test('sources always show provenance and whether evidence was extracted', () => {
  const model = sourceListModel([
    { sourceId: 's1', kind: 'html', title: 'T', canonicalUrl: 'https://x.test', sha256: 'a'.repeat(64), retrievedAt: '2026-08-13T00:00:00.000Z', evidenceCount: 2 },
    { sourceId: 's2', kind: 'note', sha256: 'b'.repeat(64), evidenceCount: 0 },
  ]);
  assert.equal(model.rows[0].sha256, `${'a'.repeat(12)}…`);
  assert.equal(model.rows[0].verification, 'đã trích bằng chứng');
  assert.equal(model.rows[1].verification, 'chưa trích bằng chứng', 'a source present is not a source used');
  assert.equal(model.rows[1].canonicalUrl, '(nguồn cục bộ)');
  assert.equal(sourceListModel([]).state, 'empty');
});

test('the brand form bumps the revision on every save', () => {
  const fresh = brandFormModel(null);
  assert.equal(fresh.state, 'empty');
  assert.equal(fresh.revision, 0);
  assert.equal(fresh.nextRevision, 1, 'an edit is always a new revision, so a run can be traced to a voice');

  const existing = brandFormModel({ brandId: 'brand_1', revision: 4, voice: ['thực tế'], dont: ['thổi phồng'] });
  assert.equal(existing.nextRevision, 5);
  assert.deepEqual(existing.fields.voice, ['thực tế']);
  assert.deepEqual(existing.fields.approvedExamples, []);
});

// Lịch sử là bằng chứng: bản đầu không bao giờ biến mất khỏi danh sách.
test('the revision timeline shows newest first while keeping the original', () => {
  const history = [
    { revisionId: 'r1', operation: 'CREATE', createdAt: 'A', parentRevisionId: null, payload: { fields: { title: 'v1' } } },
    { revisionId: 'r2', operation: 'EDIT', createdAt: 'B', parentRevisionId: 'r1', payload: { fields: { title: 'v2' } } },
  ];
  const model = revisionTimelineModel(history);
  assert.deepEqual(model.rows.map((r) => r.revisionId), ['r2', 'r1']);
  assert.deepEqual(model.rows.map((r) => r.ordinal), [2, 1], 'numbering follows creation order');
  assert.equal(model.latestRevisionId, 'r2');
  assert.equal(model.rows[1].isFirst, true);
  assert.equal(revisionTimelineModel([]).state, 'empty');
});

test('a browser draft is always marked pending', () => {
  const draft = draftFieldsModel({ payload: { fields: { title: 'T', body: 'B' } } });
  assert.equal(draft.pending, true, 'text in a textarea is not a saved revision');
  assert.equal(draft.title, 'T');
  assert.deepEqual(draftFieldsModel(null).sections, []);
});

test('audit findings are grouped worst first and never auto repair', () => {
  const model = auditFindingsModel([
    { dimension: 'readability', verdict: 'WARN', evaluatorId: 'provider:x', findings: [] },
    { dimension: 'factuality', verdict: 'BLOCK', evaluatorId: 'deterministic:claim-support', findings: [{ code: 'CLAIM_UNSUPPORTED', message: 'm', repairAction: 'ADD_EVIDENCE' }] },
    { dimension: 'brand', verdict: 'REVIEW', evaluatorId: 'provider:x', findings: [] },
  ]);
  assert.deepEqual(model.groups.map((g) => g.verdict), ['BLOCK', 'REVIEW', 'WARN']);
  assert.equal(model.blocking, true);
  assert.equal(model.needsHuman, true);
  // Đề nghị cách sửa, không phải đã sửa.
  assert.equal(model.groups[0].findings[0].repairAction, 'ADD_EVIDENCE');
  assert.equal(model.groups[0].score, null, 'an unscored dimension shows nothing, not zero');
});

// Bảng cue giữ chữ nguyên văn: khoảng trắng và lỗi chính tả đều phải nhìn thấy.
test('the cue table preserves raw text exactly', () => {
  const model = cueTableModel([
    { cueId: 'cue_0001', index: 1, startMs: 1000, endMs: 4250, rawText: '  Từ "logictics" viết sai  ' },
  ]);
  assert.equal(model.rows[0].rawText, '  Từ "logictics" viết sai  ', 'no trimming, no correcting');
  assert.equal(model.rows[0].timecode, '00:00:01,000 → 00:00:04,250');
  assert.equal(model.durationMs, 4250);
  assert.equal(formatMs(0), '00:00:00,000');
  assert.equal(cueTableModel([]).state, 'empty');
});

// Chưa rõ giá KHÔNG được hiển thị như miễn phí — người dùng sẽ đọc sự im lặng đó thành
// "không tốn gì".
test('provider costs are labelled and unknown cost warns like a paid one', () => {
  const model = providerListModel([
    { providerId: 'chatgpt-web', adapterType: 'BROWSER', enabled: true, costClass: 'ZERO_INCREMENTAL', qualityByJob: {}, health: {} },
    { providerId: 'api-v1', adapterType: 'API', enabled: false, costClass: 'UNKNOWN_COST', qualityByJob: {}, health: {} },
    { providerId: 'api-paid', adapterType: 'API', enabled: true, costClass: 'PAID_BLOCKED', qualityByJob: {}, health: {} },
  ]);
  assert.equal(model.rows[0].warnsAboutCost, false);
  assert.equal(model.rows[1].warnsAboutCost, true, 'unknown cost must not read as free');
  assert.equal(model.rows[2].blocked, true);
  // Chưa đo thì nói "chưa đo", không bịa một con số.
  assert.equal(model.rows[0].quality, 'chưa đo');
  assert.equal(model.rows[0].availability, 'UNKNOWN');
});

test('measured quality is shown with how many observations back it', () => {
  const model = providerListModel([
    { providerId: 'a', adapterType: 'BROWSER', enabled: true, costClass: 'ZERO_INCREMENTAL', health: {}, qualityByJob: { article: { score: 0.82, observations: 5 } } },
  ]);
  assert.match(model.rows[0].quality, /article: 0\.82 \(5 lần\)/);
});

test('route preview explains a refusal as usefully as a choice', () => {
  const chosen = routePreviewModel({ providerId: 'chatgpt-web', reason: 'AUTO_ROUTED', considered: [{ providerId: 'api-v1', eligible: false, reason: 'PAID_NOT_ALLOWED' }] });
  assert.equal(chosen.selected, true);
  assert.equal(chosen.considered[0].reason, 'PAID_NOT_ALLOWED');

  const refused = routePreviewModel({ providerId: null, reason: 'PAID_PROVIDER_BLOCKED', considered: [] });
  assert.equal(refused.selected, false);
  assert.equal(refused.reason, 'PAID_PROVIDER_BLOCKED');
});

test('the project context bar states plainly when no project is chosen', () => {
  const none = projectWorkspaceModel(null, { section: 'content' });
  assert.equal(none.state, 'no-project');

  const model = projectWorkspaceModel({ projectId: 'project_1', name: 'P' }, { section: 'audit' });
  assert.equal(model.links.find((l) => l.section === 'audit').active, true);
  assert.equal(model.links.find((l) => l.section === 'content').hash, '#/projects/project_1/content');
});

// Studio hiển thị chữ từ trang web của người khác, từ file transcript, từ mô tả sản phẩm.
// Một chỗ dùng innerHTML là một chỗ nguồn viết được HTML vào Studio.
test('no studio view ever assigns raw html', () => {
  const dir = join(here, '../runtime/studio');
  const files = [
    'app.mjs', 'dom.mjs', 'api-client.mjs', 'state.mjs',
    ...['projects', 'sources', 'brand', 'content-editor', 'audit', 'transcript', 'providers', 'project-workspace']
      .map((name) => join('views', `${name}.mjs`)),
  ];
  for (const file of files) {
    // Bỏ chú thích trước khi quét: nói VỀ innerHTML trong một dòng giải thích không phải là dùng nó.
    const source = readFileSync(join(dir, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/.*$/gm, '');
    assert.ok(!source.includes('innerHTML'), `${file} must not use innerHTML`);
    assert.ok(!source.includes('insertAdjacentHTML'), `${file} must not use insertAdjacentHTML`);
    assert.ok(!source.includes('document.write'), `${file} must not use document.write`);
  }
});

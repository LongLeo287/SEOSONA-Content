const test = require('node:test');
const assert = require('node:assert/strict');
const { buildContextActionPayload, resolveActionId, ACTIONS, LEGACY_ACTION_IDS, MAX_SELECTION_CHARS } = require('../extension/lib/context-actions.js');

const base = (overrides = {}) => ({
  action: 'AUDIT_SELECTION',
  selectionText: 'Giao hàng trong 2 ngày.',
  pageUrl: 'https://shop.test/bai-viet?utm_source=x',
  pageTitle: 'Bài viết về giao hàng',
  projectId: 'project_1',
  ...overrides,
});

test('every declared action is reachable and typed', () => {
  assert.deepEqual(Object.keys(ACTIONS).sort(), [
    'ADD_SOURCE', 'AUDIT_SELECTION', 'BRAND_VOICE_SELECTION', 'CLARIFY_SELECTION', 'EXPAND_SELECTION',
    'FACT_CHECK_SELECTION', 'GRAMMAR_SELECTION', 'REPURPOSE_PAGE', 'REWRITE_SELECTION', 'SHORTEN_SELECTION',
  ]);
});

test('the existing quick menu ids map onto generic actions', () => {
  assert.equal(resolveActionId('quick_audit'), 'AUDIT_SELECTION');
  assert.equal(resolveActionId('quick_rewrite'), 'REWRITE_SELECTION');
  assert.equal(resolveActionId('quick_shorten'), 'SHORTEN_SELECTION');
  assert.equal(resolveActionId('quick_expand'), 'EXPAND_SELECTION');
  assert.equal(Object.keys(LEGACY_ACTION_IDS).length, 6);
});

// Nút ghi "Sửa ngữ pháp" mà chạy "viết cho rõ hơn" là nói dối người dùng về việc sắp xảy ra.
test('the grammar menu item gets its own action, not clarify', () => {
  assert.equal(resolveActionId('quick_grammar'), 'GRAMMAR_SELECTION');
  assert.notEqual(resolveActionId('quick_grammar'), 'CLARIFY_SELECTION');
  assert.equal(ACTIONS.GRAMMAR_SELECTION.operation, 'FIX_TERMINOLOGY');
});

test('an unknown action is refused by name', () => {
  assert.throws(() => buildContextActionPayload(base({ action: 'MAKE_IT_VIRAL' })), (e) => e.code === 'UNKNOWN_ACTION');
});

test('a selection action needs an actual selection', () => {
  for (const selectionText of ['', '   ', null, undefined]) {
    assert.throws(() => buildContextActionPayload(base({ selectionText })), (e) => e.code === 'EMPTY_SELECTION');
  }
  // Hành động trên cả trang thì không cần bôi đen.
  assert.equal(buildContextActionPayload(base({ action: 'REPURPOSE_PAGE', selectionText: '' })).action, 'REPURPOSE_PAGE');
});

test('an action that saves work needs a project', () => {
  assert.throws(() => buildContextActionPayload(base({ projectId: null })), (e) => e.code === 'PROJECT_REQUIRED');
});

// Cắt bớt rồi chạy tiếp sẽ cho ra kết quả nói về một đoạn khác đoạn người dùng chọn.
test('an oversized selection is refused rather than silently truncated', () => {
  const long = 'x'.repeat(MAX_SELECTION_CHARS + 1);
  const error = (() => { try { buildContextActionPayload(base({ selectionText: long })); } catch (e) { return e; } })();
  assert.equal(error.code, 'SELECTION_TOO_LARGE');
  assert.match(error.message, new RegExp(String(MAX_SELECTION_CHARS)));
  assert.equal(buildContextActionPayload(base({ selectionText: 'y'.repeat(MAX_SELECTION_CHARS) })).selectionChars, MAX_SELECTION_CHARS);
});

// chrome:// và file:// không phải nguồn dẫn lại được, và một số là dữ liệu riêng của máy.
test('only http and https pages can be captured', () => {
  for (const pageUrl of ['chrome://settings', 'file:///C:/Users/Admin/note.txt', 'about:blank', 'javascript:alert(1)', 'not a url', '']) {
    assert.throws(() => buildContextActionPayload(base({ pageUrl })), (e) => e.code === 'UNSUPPORTED_PAGE', pageUrl);
  }
});

test('the payload carries provenance and nothing else about the browser', () => {
  const payload = buildContextActionPayload(base());
  assert.equal(payload.selectionText, 'Giao hàng trong 2 ngày.');
  assert.equal(payload.provenance.pageUrl, 'https://shop.test/bai-viet', 'tracking parameters are dropped');
  assert.equal(payload.provenance.pageTitle, 'Bài viết về giao hàng');

  const serialized = JSON.stringify(payload);
  for (const leak of ['cookie', 'localStorage', 'html', 'tabId', 'history']) {
    assert.ok(!serialized.toLowerCase().includes(leak.toLowerCase()), `the payload must not carry ${leak}`);
  }
});

test('an over long page title is bounded', () => {
  const payload = buildContextActionPayload(base({ pageTitle: 't'.repeat(1000) }));
  assert.equal(payload.provenance.pageTitle.length, 300);
});

test('each edit action names the runtime operation it will run', () => {
  assert.equal(buildContextActionPayload(base({ action: 'SHORTEN_SELECTION' })).operation, 'SHORTEN');
  assert.equal(buildContextActionPayload(base({ action: 'BRAND_VOICE_SELECTION' })).operation, 'PROFESSIONALIZE');
  assert.equal(buildContextActionPayload(base({ action: 'AUDIT_SELECTION' })).runtimeKind, 'AUDIT');
  assert.equal(buildContextActionPayload(base({ action: 'ADD_SOURCE' })).runtimeKind, 'SOURCE');
});

test('the module touches no chrome api at all', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../extension/lib/context-actions.js'), 'utf8');
  assert.ok(!source.includes('chrome.'), 'action mapping stays pure so it can be tested without a browser');
  assert.ok(!source.includes('fetch('), 'and it does not talk to the runtime itself');
});

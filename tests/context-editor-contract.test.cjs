const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ContextEditor = require('../extension/content/context-editor.js');

const { classifyEditableElement, buildEditableSnapshot, validateReplacement, MAX_REPLACEMENT_CHARS } = ContextEditor;

const textarea = (value = 'nội dung cũ', extra = {}) => ({ tagName: 'TEXTAREA', value, ...extra });
const input = (type = 'text', value = 'xin chào', extra = {}) => ({ tagName: 'INPUT', type, value, ...extra });
const editable = (textContent = 'đoạn văn') => ({ tagName: 'DIV', isContentEditable: true, textContent });

// ---------------------------------------------------------------- phân loại ô nhập

test('textarea, text input and contenteditable are all editable', () => {
  assert.deepEqual(classifyEditableElement(textarea()), { editable: true, kind: 'TEXTAREA', valueProperty: 'value' });
  assert.equal(classifyEditableElement(input()).editable, true);
  assert.equal(classifyEditableElement(input()).valueProperty, 'value');
  assert.deepEqual(classifyEditableElement(editable()), { editable: true, kind: 'CONTENTEDITABLE', valueProperty: 'textContent' });
});

test('a plain element is not editable and says why', () => {
  assert.deepEqual(classifyEditableElement({ tagName: 'P' }), { editable: false, kind: 'OTHER', reason: 'NOT_EDITABLE' });
  assert.equal(classifyEditableElement(null).reason, 'NO_TARGET');
  assert.equal(classifyEditableElement({ tagName: 'DIV', isContentEditable: false }).editable, false);
});

// Ghi vào ô mật khẩu là đặt chữ vào nơi trình quản lý mật khẩu và trang web đều đang theo dõi.
test('password and file inputs are never touched', () => {
  for (const type of ['password', 'file', 'hidden', 'submit', 'button', 'image', 'reset']) {
    const verdict = classifyEditableElement(input(type));
    assert.equal(verdict.editable, false, type);
    assert.equal(verdict.reason, 'UNSUPPORTED_INPUT_TYPE', type);
  }
});

test('an exotic input type is refused rather than guessed at', () => {
  for (const type of ['checkbox', 'radio', 'range', 'color', 'date']) {
    assert.equal(classifyEditableElement(input(type)).editable, false, type);
  }
  for (const type of ['text', 'search', 'url', 'email', 'tel']) {
    assert.equal(classifyEditableElement(input(type)).editable, true, type);
  }
});

test('a read only or disabled field is not writable', () => {
  assert.equal(classifyEditableElement(textarea('x', { readOnly: true })).reason, 'READ_ONLY');
  assert.equal(classifyEditableElement(textarea('x', { disabled: true })).reason, 'READ_ONLY');
  assert.equal(classifyEditableElement(input('text', 'x', { readOnly: true })).reason, 'READ_ONLY');
});

// ---------------------------------------------------------------- ảnh chụp

test('a snapshot records the original text and a transient descriptor only', () => {
  const snapshot = buildEditableSnapshot(textarea('bản gốc'), { now: () => 1000 });
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.originalText, 'bản gốc');
  assert.equal(snapshot.descriptor.tagName, 'TEXTAREA');
  assert.equal(snapshot.descriptor.length, 7);
  assert.equal(snapshot.capturedAt, 1000);
  // Selector/node chỉ đúng trong một lần tải trang; giữ lại là tạo ra dữ liệu trông bền vững
  // nhưng đã chết.
  const serialized = JSON.stringify(snapshot);
  assert.ok(!serialized.includes('querySelector'), 'no selector is persisted');
  assert.ok(!serialized.includes('xpath'), 'no xpath is persisted');
});

test('a snapshot of a non editable target fails cleanly', () => {
  assert.equal(buildEditableSnapshot({ tagName: 'P' }).ok, false);
  assert.equal(buildEditableSnapshot(null).reason, 'NO_TARGET');
});

// ---------------------------------------------------------------- thay chữ có canh gác

test('a straightforward replacement is allowed', () => {
  const snapshot = buildEditableSnapshot(textarea('bản gốc'));
  assert.deepEqual(
    validateReplacement({ snapshot, currentText: 'bản gốc', replacement: 'bản mới' }),
    { ok: true },
  );
});

// Đây là hàng rào quan trọng nhất: giữa lúc AI viết xong và lúc người dùng bấm áp dụng,
// trang có thể đã đổi. Ghi đè lúc đó là xóa mất chữ không ai định xóa.
test('a page that changed since the snapshot blocks the write', () => {
  const snapshot = buildEditableSnapshot(textarea('bản gốc'));
  const verdict = validateReplacement({ snapshot, currentText: 'bản gốc và người dùng vừa gõ thêm', replacement: 'bản mới' });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, 'PAGE_CONTENT_CHANGED');
});

// Kể cả một dấu cách: người dùng đã động vào ô này sau khi ta chụp.
test('even a single added space counts as changed', () => {
  const snapshot = buildEditableSnapshot(textarea('bản gốc'));
  assert.equal(validateReplacement({ snapshot, currentText: 'bản gốc ', replacement: 'x' }).code, 'PAGE_CONTENT_CHANGED');
});

test('an empty or unchanged replacement is refused with a distinct reason', () => {
  const snapshot = buildEditableSnapshot(textarea('bản gốc'));
  assert.equal(validateReplacement({ snapshot, currentText: 'bản gốc', replacement: '' }).code, 'EMPTY_REPLACEMENT');
  assert.equal(validateReplacement({ snapshot, currentText: 'bản gốc', replacement: null }).code, 'EMPTY_REPLACEMENT');
  assert.equal(validateReplacement({ snapshot, currentText: 'bản gốc', replacement: 'bản gốc' }).code, 'NO_CHANGE');
});

test('an oversized replacement is refused', () => {
  const snapshot = buildEditableSnapshot(textarea('bản gốc'));
  const verdict = validateReplacement({ snapshot, currentText: 'bản gốc', replacement: 'x'.repeat(MAX_REPLACEMENT_CHARS + 1) });
  assert.equal(verdict.code, 'REPLACEMENT_TOO_LARGE');
  assert.equal(verdict.max, MAX_REPLACEMENT_CHARS);
});

test('replacing with no target at all is refused', () => {
  assert.equal(validateReplacement({ snapshot: null, currentText: '', replacement: 'x' }).code, 'NO_TARGET');
  assert.equal(validateReplacement({ snapshot: { ok: false }, currentText: '', replacement: 'x' }).code, 'NO_TARGET');
});

// ---------------------------------------------------------------- thông điệp & quyền

test('the message handler answers the four contextual actions', () => {
  const source = readFileSync(join(__dirname, '../extension/content/context-editor.js'), 'utf8');
  for (const action of ['context:getSelection', 'context:getEditableTarget', 'context:replaceSelection', 'context:replaceField']) {
    assert.ok(source.includes(action), `${action} must be handled`);
  }
});

// Ghi giá trị mà không phát sự kiện thì React/Vue giữ nguyên state cũ và ghi đè lại ngay.
test('a replacement dispatches input and change so the page framework notices', () => {
  const source = readFileSync(join(__dirname, '../extension/content/context-editor.js'), 'utf8');
  assert.match(source, /dispatchEvent\(new Event\('input'/);
  assert.match(source, /dispatchEvent\(new Event\('change'/);
});

test('the extension asks for activeTab and no blanket host permission', () => {
  const manifest = JSON.parse(readFileSync(join(__dirname, '../extension/manifest.json'), 'utf8'));
  assert.ok(manifest.permissions.includes('activeTab'), 'activeTab is how page access stays per-action');
  for (const host of manifest.host_permissions) {
    assert.ok(!host.includes('<all_urls>'), 'no blanket host permission');
    assert.ok(!/^\*:\/\/\*\/\*$/.test(host), `${host} is too broad`);
  }
  // Các host của nhà cung cấp và loopback vẫn phải còn: đó là phần chạy nền có chủ đích.
  assert.ok(manifest.host_permissions.some((h) => h.includes('chatgpt.com')));
  assert.ok(manifest.host_permissions.some((h) => h.includes('127.0.0.1')));
});

test('the context editor is not declared as a permanent content script', () => {
  const manifest = JSON.parse(readFileSync(join(__dirname, '../extension/manifest.json'), 'utf8'));
  const declared = (manifest.content_scripts || []).flatMap((entry) => entry.js);
  assert.ok(
    !declared.includes('content/context-editor.js'),
    'it is injected per user action through activeTab, not left running on every page',
  );
});

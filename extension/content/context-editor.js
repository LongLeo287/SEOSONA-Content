/* SEOSONA Content — đọc/thay chữ trên trang, tiêm động theo từng lần người dùng yêu cầu. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ContextEditor = api;
  // Chỉ gắn listener khi thật sự chạy trong content script. Trong node (lúc test) thì file
  // này chỉ là một bó hàm thuần.
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage && typeof document !== 'undefined') {
    api.attach();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Nguyên tắc chi phối cả file: KHÔNG BAO GIỜ ghi đè chữ của người dùng một cách âm thầm.
  //
  // Script này được tiêm theo `activeTab` — chỉ tồn tại sau khi người dùng chủ động yêu cầu
  // một hành động trên đúng tab đang xem. Extension không có quyền thường trực trên mọi trang.
  //
  // Và trước mỗi lần thay chữ, nó ĐỌC LẠI ô đó rồi so với bản đã chụp. Giữa lúc AI viết xong
  // và lúc người dùng bấm "Áp dụng", trang có thể đã đổi: người dùng gõ thêm, trang tự lưu
  // nháp, một script khác ghi vào. Ghi đè lúc đó là xóa mất chữ không ai định xóa.

  const MAX_REPLACEMENT_CHARS = 100000;

  // Ô mật khẩu và ô chọn file không bao giờ được đụng tới. Ghi vào ô mật khẩu là đặt chữ vào
  // một nơi trình quản lý mật khẩu và trang web đều đang theo dõi; ô file thì trình duyệt
  // cũng không cho, và cố làm chỉ tạo ra hành vi khó đoán.
  const FORBIDDEN_INPUT_TYPES = ['password', 'file', 'hidden', 'submit', 'button', 'image', 'reset'];
  const TEXTUAL_INPUT_TYPES = ['text', 'search', 'url', 'email', 'tel', 'number', ''];

  /**
   * Phần tử này có sửa được không, và sửa kiểu gì.
   * Nhận một mô tả phần tử (hoặc phần tử thật) nên test được trong node.
   */
  function classifyEditableElement(element) {
    if (!element) return { editable: false, kind: 'NONE', reason: 'NO_TARGET' };
    const tag = String(element.tagName || '').toUpperCase();

    if (tag === 'TEXTAREA') {
      if (element.readOnly || element.disabled) return { editable: false, kind: 'TEXTAREA', reason: 'READ_ONLY' };
      return { editable: true, kind: 'TEXTAREA', valueProperty: 'value' };
    }

    if (tag === 'INPUT') {
      const type = String(element.type || '').toLowerCase();
      if (FORBIDDEN_INPUT_TYPES.includes(type)) {
        return { editable: false, kind: 'INPUT', reason: 'UNSUPPORTED_INPUT_TYPE', inputType: type };
      }
      if (!TEXTUAL_INPUT_TYPES.includes(type)) {
        return { editable: false, kind: 'INPUT', reason: 'UNSUPPORTED_INPUT_TYPE', inputType: type };
      }
      if (element.readOnly || element.disabled) return { editable: false, kind: 'INPUT', reason: 'READ_ONLY' };
      return { editable: true, kind: 'INPUT', valueProperty: 'value', inputType: type };
    }

    if (element.isContentEditable === true) {
      return { editable: true, kind: 'CONTENTEDITABLE', valueProperty: 'textContent' };
    }

    return { editable: false, kind: 'OTHER', reason: 'NOT_EDITABLE' };
  }

  /** Ảnh chụp TẠM của ô đang sửa: đủ để so lại, không phải một bản ghi dự án. */
  function buildEditableSnapshot(element, { now = () => Date.now() } = {}) {
    const classification = classifyEditableElement(element);
    if (!classification.editable) return { ok: false, ...classification };
    const originalText = String(element[classification.valueProperty] ?? '');
    return {
      ok: true,
      kind: classification.kind,
      valueProperty: classification.valueProperty,
      originalText,
      // Selector và node KHÔNG được lưu thành bản ghi dự án: chúng chỉ đúng trong một lần
      // tải trang, và giữ lại sẽ tạo ra dữ liệu trông như bền vững nhưng thật ra đã chết.
      descriptor: {
        tagName: String(element.tagName || '').toUpperCase(),
        inputType: classification.inputType || null,
        length: originalText.length,
      },
      capturedAt: now(),
    };
  }

  /**
   * Kiểm trước khi ghi. Trả về lý do CỤ THỂ — "không thay được" chung chung sẽ khiến người
   * dùng bấm lại và nhận đúng kết quả đó lần nữa.
   */
  function validateReplacement({ snapshot, currentText, replacement }) {
    if (!snapshot || !snapshot.ok) return { ok: false, code: 'NO_TARGET' };
    if (typeof replacement !== 'string' || !replacement.length) return { ok: false, code: 'EMPTY_REPLACEMENT' };
    if (replacement.length > MAX_REPLACEMENT_CHARS) {
      return { ok: false, code: 'REPLACEMENT_TOO_LARGE', length: replacement.length, max: MAX_REPLACEMENT_CHARS };
    }
    // So khớp CHÍNH XÁC, không bỏ qua khoảng trắng: một dấu cách người dùng vừa gõ thêm cũng
    // nghĩa là họ đã động vào ô này sau khi ta chụp.
    if (String(currentText ?? '') !== snapshot.originalText) {
      return { ok: false, code: 'PAGE_CONTENT_CHANGED' };
    }
    if (replacement === snapshot.originalText) return { ok: false, code: 'NO_CHANGE' };
    return { ok: true };
  }

  // ---------------------------------------------------------------- phần cần DOM

  let lastSnapshot = null;
  let lastElement = null;

  function activeEditable() {
    const active = document.activeElement;
    if (classifyEditableElement(active).editable) return active;
    return null;
  }

  function readSelection() {
    const selection = document.getSelection();
    const text = selection ? String(selection) : '';
    return {
      ok: Boolean(text.trim()),
      selectionText: text,
      pageUrl: location.href,
      pageTitle: document.title,
    };
  }

  function applyValue(element, valueProperty, value) {
    element[valueProperty] = value;
    // Trang web hiện đại theo dõi sự kiện, không theo dõi thuộc tính. Không phát input/change
    // thì React/Vue vẫn giữ giá trị cũ trong state và sẽ ghi đè lại ngay sau đó.
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function handleMessage(msg, sender, sendResponse) {
    if (!msg || !msg.action) return undefined;

    if (msg.action === 'context:getSelection') {
      sendResponse(readSelection());
      return undefined;
    }

    if (msg.action === 'context:getEditableTarget') {
      lastElement = activeEditable();
      lastSnapshot = lastElement ? buildEditableSnapshot(lastElement) : { ok: false, code: 'NO_TARGET' };
      sendResponse(lastSnapshot);
      return undefined;
    }

    if (msg.action === 'context:replaceField' || msg.action === 'context:replaceSelection') {
      if (!lastElement || !lastSnapshot || !lastSnapshot.ok) {
        sendResponse({ ok: false, code: 'NO_TARGET' });
        return undefined;
      }
      // ĐỌC LẠI ngay trước khi ghi — đây là chỗ chặn việc xóa mất chữ người dùng vừa gõ.
      const currentText = String(lastElement[lastSnapshot.valueProperty] ?? '');
      const verdict = validateReplacement({ snapshot: lastSnapshot, currentText, replacement: msg.replacement });
      if (!verdict.ok) {
        sendResponse(verdict);
        return undefined;
      }
      applyValue(lastElement, lastSnapshot.valueProperty, msg.replacement);
      // Chụp lại để lần thay tiếp theo so với hiện trạng mới.
      lastSnapshot = buildEditableSnapshot(lastElement);
      sendResponse({ ok: true, replacedChars: msg.replacement.length });
      return undefined;
    }

    return undefined;
  }

  function attach() {
    chrome.runtime.onMessage.addListener(handleMessage);
  }

  return {
    attach,
    handleMessage,
    classifyEditableElement,
    buildEditableSnapshot,
    validateReplacement,
    MAX_REPLACEMENT_CHARS,
    FORBIDDEN_INPUT_TYPES,
  };
});

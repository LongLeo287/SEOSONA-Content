/* SEOSONA Content — ánh xạ hành động ngữ cảnh (thuần, không chạm Chrome). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ContextActions = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Người dùng bôi đen chữ trên một trang bất kỳ rồi chọn một hành động. File này biến thao
  // tác đó thành một payload gửi cho Local Runtime.
  //
  // Điều nó CỐ Ý không gửi đi: HTML của trang, ảnh, cookie, hay bất cứ thứ gì về những tab
  // khác. Chỉ có đoạn chữ người dùng đã chọn, cộng URL và tiêu đề trang để làm xuất xứ.
  // Một hành động "audit đoạn này" không có lý do gì cần biết người dùng còn mở gì.

  const ACTIONS = {
    ADD_SOURCE: { needsSelection: true, needsProject: true, persists: true, runtime: 'SOURCE' },
    AUDIT_SELECTION: { needsSelection: true, needsProject: true, persists: true, runtime: 'AUDIT' },
    FACT_CHECK_SELECTION: { needsSelection: true, needsProject: true, persists: true, runtime: 'AUDIT' },
    REWRITE_SELECTION: { needsSelection: true, needsProject: true, persists: true, runtime: 'EDIT', operation: 'REWRITE' },
    SHORTEN_SELECTION: { needsSelection: true, needsProject: true, persists: true, runtime: 'EDIT', operation: 'SHORTEN' },
    EXPAND_SELECTION: { needsSelection: true, needsProject: true, persists: true, runtime: 'EDIT', operation: 'EXPAND' },
    CLARIFY_SELECTION: { needsSelection: true, needsProject: true, persists: true, runtime: 'EDIT', operation: 'CLARIFY' },
    GRAMMAR_SELECTION: { needsSelection: true, needsProject: true, persists: true, runtime: 'EDIT', operation: 'FIX_TERMINOLOGY' },
    BRAND_VOICE_SELECTION: { needsSelection: true, needsProject: true, persists: true, runtime: 'EDIT', operation: 'PROFESSIONALIZE' },
    REPURPOSE_PAGE: { needsSelection: false, needsProject: true, persists: true, runtime: 'REPURPOSE' },
  };

  // Menu chuột phải hiện có dùng tên cũ. Ánh xạ sang tên chung để giao diện không phải đổi
  // cùng lúc với phần lõi.
  //
  // quick_grammar KHÔNG gộp vào CLARIFY: nhãn trên menu là "Sửa ngữ pháp", và một nút nói
  // "sửa ngữ pháp" mà chạy "viết cho rõ hơn" là nói dối người dùng về việc sắp xảy ra.
  const LEGACY_ACTION_IDS = {
    quick_audit: 'AUDIT_SELECTION',
    quick_rewrite: 'REWRITE_SELECTION',
    quick_shorten: 'SHORTEN_SELECTION',
    quick_expand: 'EXPAND_SELECTION',
    quick_grammar: 'GRAMMAR_SELECTION',
    quick_ab: 'REWRITE_SELECTION',
  };

  // Chỉ trang web thật mới có xuất xứ kiểm chứng được. chrome://, file://, about: … không
  // phải nguồn có thể dẫn lại, và một số trong đó là dữ liệu riêng tư của máy.
  const ALLOWED_SCHEMES = ['http:', 'https:'];

  const MAX_SELECTION_CHARS = 20000;

  function actionError(code, message) {
    const err = new Error(message);
    err.code = code;
    return err;
  }

  function parseUrl(pageUrl) {
    try {
      return new URL(String(pageUrl || ''));
    } catch (_) {
      return null;
    }
  }

  function resolveActionId(action) {
    const id = LEGACY_ACTION_IDS[action] || action;
    if (!ACTIONS[id]) throw actionError('UNKNOWN_ACTION', 'Unknown contextual action: ' + action);
    return id;
  }

  /**
   * @returns payload gửi cho Runtime — chỉ chứa đoạn chữ đã chọn và xuất xứ trang.
   */
  function buildContextActionPayload({ action, selectionText, pageUrl, pageTitle, projectId } = {}) {
    const actionId = resolveActionId(action);
    const spec = ACTIONS[actionId];
    const selection = String(selectionText == null ? '' : selectionText);

    if (spec.needsSelection && !selection.trim()) {
      throw actionError('EMPTY_SELECTION', 'This action needs selected text.');
    }
    if (selection.length > MAX_SELECTION_CHARS) {
      // Cắt bớt rồi chạy tiếp sẽ cho ra kết quả nói về một đoạn khác đoạn người dùng chọn,
      // mà họ không hề biết. Từ chối rõ ràng tốt hơn.
      throw actionError('SELECTION_TOO_LARGE', `Selection is ${selection.length} characters; the limit is ${MAX_SELECTION_CHARS}.`);
    }
    if (spec.needsProject && !projectId) {
      throw actionError('PROJECT_REQUIRED', 'Choose a project before running an action that saves work.');
    }

    const url = parseUrl(pageUrl);
    if (!url || !ALLOWED_SCHEMES.includes(url.protocol)) {
      throw actionError('UNSUPPORTED_PAGE', 'Only http and https pages can be used as a source.');
    }

    return {
      action: actionId,
      runtimeKind: spec.runtime,
      operation: spec.operation || null,
      projectId: projectId || null,
      selectionText: selection,
      // Xuất xứ: đủ để dẫn lại, và không hơn. Không query string đầy đủ nếu nó mang dữ liệu
      // riêng — nhưng giữ nguyên đường dẫn để còn tìm lại được đoạn văn.
      provenance: {
        pageUrl: `${url.origin}${url.pathname}`,
        pageTitle: String(pageTitle || '').slice(0, 300),
        capturedAt: null,
      },
      selectionChars: selection.length,
    };
  }

  return {
    ACTIONS,
    LEGACY_ACTION_IDS,
    MAX_SELECTION_CHARS,
    resolveActionId,
    buildContextActionPayload,
  };
});

// SEOSONA SRT Studio — shared content-script engine
// Mỗi provider file chỉ khai báo selectors + hooks rồi gọi registerProvider(cfg).
// Cơ chế (học từ extension tham khảo):
//   1. snapshot baseline số message trước khi gửi
//   2. chèn text theo 3 tầng: paste event -> execCommand -> DOM trực tiếp
//   3. click nút gửi (fallback: phím Enter)
//   4. poll đến khi có message mới + text ổn định N chu kỳ + không còn indicator "đang sinh"
//   5. gửi kết quả về background qua runtime.sendMessage (không giữ sendResponse
//      để không phụ thuộc vòng đời service worker với job chạy dài)

(() => {
  if (window.__SRT_STUDIO__) return;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function isVisible(el) {
    if (!el) return false;
    return !!(el.offsetParent !== null || el.getClientRects().length);
  }

  function findFirst(selectors, root = document) {
    for (const sel of selectors) {
      try {
        const els = root.querySelectorAll(sel);
        for (const el of els) if (isVisible(el)) return el;
      } catch (_) {}
    }
    return null;
  }

  async function waitFor(fn, { timeout = 15000, interval = 300 } = {}) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try {
        const v = await fn();
        if (v) return v;
      } catch (_) {}
      await sleep(interval);
    }
    return null;
  }

  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Chèn text 3 tầng — ưu tiên paste event vì giữ nguyên state của editor
  // (ProseMirror/Quill), với văn bản dài + tiếng Việt có dấu vẫn an toàn.
  async function insertText(editor, text) {
    editor.focus();
    await sleep(80);

    if (editor.tagName === 'TEXTAREA' || editor.tagName === 'INPUT') {
      setNativeValue(editor, text);
      return true;
    }

    // Tầng 1: ClipboardEvent('paste')
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      editor.dispatchEvent(new ClipboardEvent('paste', {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      }));
      await sleep(250);
      const got = (editor.innerText || '').trim();
      if (got.length >= Math.min(text.length * 0.5, 200)) return true;
    } catch (_) {}

    // Tầng 2: execCommand
    try {
      editor.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, text);
      await sleep(150);
      if ((editor.innerText || '').trim().length >= Math.min(text.length * 0.5, 200)) return true;
    } catch (_) {}

    // Tầng 3: ghi DOM trực tiếp (có thể phá state editor — chỉ là cứu cánh cuối)
    editor.innerHTML = '';
    for (const line of text.split('\n')) {
      const p = document.createElement('p');
      p.textContent = line === '' ? ' ' : line;
      editor.appendChild(p);
    }
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(150);
    return true;
  }

  // Nhận diện lỗi provider (rate limit / content blocked) để fail nhanh với thông báo rõ.
  function detectProviderError(cfg, txt) {
    if (!txt || txt.length > 400) return null; // thông báo lỗi thường ngắn -> tránh false positive
    const low = txt.toLowerCase();
    const pats = cfg.errorPatterns || {};
    for (const p of (pats.rate_limit || [])) if (low.includes(p)) return { error: 'RATE_LIMIT', message: 'AI báo giới hạn/hết lượt: "' + txt.slice(0, 120) + '"' };
    for (const p of (pats.content_blocked || [])) if (low.includes(p)) return { error: 'CONTENT_BLOCKED', message: 'AI từ chối nội dung: "' + txt.slice(0, 120) + '"' };
    for (const p of (pats.network || [])) if (low.includes(p)) return { error: 'NETWORK', message: 'Lỗi mạng phía AI: "' + txt.slice(0, 120) + '"' };
    return null;
  }

  function _install(cfg) {
    let aborted = false;

    const getTurns = () => {
      try {
        const nodes = cfg.getAssistantNodes();
        return Array.from(nodes || []);
      } catch (_) {
        return [];
      }
    };

    async function clickSend(editor) {
      const btn = await waitFor(() => {
        const b = findFirst(cfg.sendButton);
        return b && !b.disabled && b.getAttribute('aria-disabled') !== 'true' ? b : null;
      }, { timeout: 10000, interval: 300 });

      if (btn) {
        btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        btn.click();
        return true;
      }
      // Fallback: Enter
      editor.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true,
      }));
      return false;
    }

    async function submitAndWait({ text, timeout = 600000 }) {
      aborted = false;

      // Chặn sớm: trang yêu cầu đăng nhập / captcha
      if (cfg.isBlocked && cfg.isBlocked()) {
        return { success: false, error: 'PAGE_BLOCKED', message: 'Trang đang yêu cầu đăng nhập hoặc xác minh. Hãy xử lý thủ công rồi chạy lại.' };
      }

      const editor = await waitFor(() => findFirst(cfg.editor), { timeout: 20000 });
      if (!editor) {
        return { success: false, error: 'EDITOR_NOT_FOUND', message: 'Không tìm thấy ô nhập chat. Kiểm tra đã đăng nhập và đang ở trang chat chưa.' };
      }

      const baseline = getTurns().length;

      await insertText(editor, text);
      await sleep(500);
      await clickSend(editor);

      // Chờ message mới xuất hiện. Với provider đếm cả bubble user
      // (countsUserMessages) cần vượt baseline + 1.
      const needed = baseline + (cfg.countsUserMessages ? 2 : 1);
      const appeared = await waitFor(() => getTurns().length >= needed, {
        timeout: 90000,
        interval: 500,
      });
      if (!appeared) {
        return { success: false, error: 'NO_RESPONSE_STARTED', message: 'AI không bắt đầu trả lời (có thể chưa gửi được prompt hoặc bị rate limit).' };
      }

      // Poll ổn định: text không đổi STABLE_CYCLES chu kỳ và không còn "đang sinh"
      const STABLE_CYCLES = cfg.stableCycles || 8;
      const POLL_MS = cfg.pollMs || 700;
      const t0 = Date.now();
      let last = '';
      let stable = 0;

      while (Date.now() - t0 < timeout) {
        if (aborted) {
          try { if (cfg.clickStop) cfg.clickStop(); } catch (_) {}
          return { success: false, error: 'ABORTED', message: 'Đã hủy theo yêu cầu.' };
        }

        const turns = getTurns();
        const el = turns[turns.length - 1];
        let txt = '';
        try {
          txt = cfg.extractText ? cfg.extractText(el) : ((el && el.innerText) || '');
        } catch (_) {}
        txt = (txt || '').trim();

        let generating = false;
        try { generating = cfg.isGenerating ? !!cfg.isGenerating() : false; } catch (_) {}

        if (!generating) {
          const errHit = detectProviderError(cfg, txt);
          if (errHit) return { success: false, ...errHit, text: txt };
        }

        if (txt.length > 0 && txt === last && !generating) {
          stable += 1;
          if (stable >= STABLE_CYCLES) {
            return { success: true, text: txt, elapsedMs: Date.now() - t0 };
          }
        } else {
          stable = 0;
        }
        last = txt;
        await sleep(POLL_MS);
      }

      return { success: false, error: 'TIMEOUT', message: 'Hết thời gian chờ.', text: last };
    }

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || !msg.action) return;

      if (msg.action === 'srt:ping') {
        sendResponse({ ok: true, provider: cfg.name });
        return;
      }
      if (msg.action === 'srt:abort') {
        aborted = true;
        sendResponse({ ok: true });
        return;
      }
      if (msg.action === 'srt:submitAndWait') {
        sendResponse({ accepted: true }); // ack ngay, kết quả gửi qua srt:jobResult
        submitAndWait(msg)
          .then((result) => {
            chrome.runtime.sendMessage({ action: 'srt:jobResult', jobId: msg.jobId, provider: cfg.name, result }).catch(() => {});
          })
          .catch((e) => {
            chrome.runtime.sendMessage({
              action: 'srt:jobResult',
              jobId: msg.jobId,
              provider: cfg.name,
              result: { success: false, error: 'EXCEPTION', message: String((e && e.message) || e) },
            }).catch(() => {});
          });
        return;
      }
    });

    console.log('[SRT Studio] provider registered:', cfg.name);
  }

  function loadOverrides() {
    return new Promise((res) => {
      try {
        chrome.storage.local.get('srtSelectorOverrides', (r) => res((r && r.srtSelectorOverrides) || {}));
      } catch (_) { res({}); }
    });
  }

  // Đăng ký provider theo TÊN: dựng cfg từ selectors-default.js + override của user.
  async function registerProvider(name) {
    const overrides = await loadOverrides();
    const builder = (typeof srtBuildProviderConfig === 'function')
      ? srtBuildProviderConfig
      : (window.srtBuildProviderConfig);
    const s = builder ? builder(name, overrides) : {};

    const cfg = {
      name,
      editor: s.editor || [],
      sendButton: s.sendButton || [],
      countsUserMessages: !!s.countsUserMessages,
      errorPatterns: s.errorPatterns || {},
      stableCycles: 8,
      pollMs: 700,
      getAssistantNodes: () => {
        for (const sel of (s.assistantNode || [])) {
          try { const n = document.querySelectorAll(sel); if (n && n.length) return n; } catch (_) {}
        }
        return [];
      },
      extractText: (el) => {
        if (!el) return '';
        let inner = null;
        if (s.responseInner) { try { inner = el.querySelector(s.responseInner); } catch (_) {} }
        return (inner || el).innerText || '';
      },
      isGenerating: () => {
        if (!s.generating) return false;
        try { return !!document.querySelector(s.generating); } catch (_) { return false; }
      },
      clickStop: () => {
        if (!s.stop) return;
        try { const b = document.querySelector(s.stop); if (b) b.click(); } catch (_) {}
      },
      isBlocked: () => {
        const t = (document.title || '').toLowerCase();
        if ((s.blockedTitle || []).some((x) => t.includes(x))) return true;
        if (s.blockedSelector) { try { if (document.querySelector(s.blockedSelector)) return true; } catch (_) {} }
        return false;
      },
    };
    _install(cfg);
  }

  window.__SRT_STUDIO__ = { sleep, isVisible, findFirst, waitFor, insertText, registerProvider };
})();

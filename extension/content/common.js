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

  // Floating tracker: badge tiến độ hiển thị NGAY trên tab AI khi đang phân tích.
  const Tracker = (() => {
    let host, timerEl, phaseEl, dotEl, interval, t0, onStop;
    function ensure() {
      if (host && document.body.contains(host)) return;
      host = document.createElement('div');
      host.id = '__srt_tracker__';
      host.style.cssText = [
        'position:fixed', 'right:16px', 'bottom:16px', 'z-index:2147483647',
        'display:flex', 'align-items:center', 'gap:8px',
        'padding:8px 12px', 'border-radius:10px',
        'background:#151815', 'border:1px solid rgba(173,255,47,.45)',
        'box-shadow:0 6px 24px -6px rgba(0,0,0,.6)',
        'font:600 12px/1.2 "Segoe UI",system-ui,sans-serif', 'color:#ededed',
        'cursor:default', 'user-select:none',
      ].join(';');
      dotEl = document.createElement('span');
      dotEl.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#adff2f;box-shadow:0 0 6px #adff2f';
      const label = document.createElement('span');
      label.textContent = 'SRT';
      label.style.cssText = 'color:#adff2f;font-weight:800;letter-spacing:.5px';
      phaseEl = document.createElement('span');
      timerEl = document.createElement('span');
      timerEl.style.cssText = 'font-family:Consolas,monospace;color:#9aa1b5';
      const stop = document.createElement('button');
      stop.textContent = '⛔';
      stop.title = 'Dừng';
      stop.style.cssText = 'background:none;border:none;color:#f0545c;cursor:pointer;font-size:13px;padding:0 2px';
      stop.addEventListener('click', () => { try { onStop && onStop(); } catch (_) {} });
      host.append(dotEl, label, phaseEl, timerEl, stop);
      (document.body || document.documentElement).appendChild(host);
    }
    function tick() {
      if (!timerEl) return;
      const s = Math.floor((Date.now() - t0) / 1000);
      timerEl.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    }
    return {
      show(stopFn) {
        onStop = stopFn; ensure();
        t0 = Date.now();
        dotEl.style.background = '#f0a933'; dotEl.style.boxShadow = '0 0 6px #f0a933';
        clearInterval(interval); interval = setInterval(tick, 1000); tick();
      },
      phase(txt) { ensure(); if (phaseEl) phaseEl.textContent = txt; },
      done(ok, ms) {
        ensure();
        clearInterval(interval);
        if (dotEl) { dotEl.style.background = ok ? '#adff2f' : '#f0545c'; dotEl.style.boxShadow = `0 0 6px ${ok ? '#adff2f' : '#f0545c'}`; }
        if (phaseEl) phaseEl.textContent = ok ? `xong (${Math.round((ms || 0) / 1000)}s)` : 'lỗi';
        setTimeout(() => { try { host && host.remove(); host = null; } catch (_) {} }, 4000);
      },
    };
  })();

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
      Tracker.show(() => { aborted = true; });
      Tracker.phase('đang chuẩn bị…');

      // Chặn sớm: trang yêu cầu đăng nhập / captcha
      if (cfg.isBlocked && cfg.isBlocked()) {
        Tracker.done(false);
        return { success: false, error: 'PAGE_BLOCKED', message: 'Trang đang yêu cầu đăng nhập hoặc xác minh. Hãy xử lý thủ công rồi chạy lại.' };
      }

      const editor = await waitFor(() => findFirst(cfg.editor), { timeout: 20000 });
      if (!editor) {
        Tracker.done(false);
        return { success: false, error: 'EDITOR_NOT_FOUND', message: 'Không tìm thấy ô nhập chat. Kiểm tra đã đăng nhập và đang ở trang chat chưa.' };
      }

      const baseline = getTurns().length;

      Tracker.phase('đang gửi prompt…');
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
        Tracker.done(false);
        return { success: false, error: 'NO_RESPONSE_STARTED', message: 'AI không bắt đầu trả lời (có thể chưa gửi được prompt hoặc bị rate limit).' };
      }
      Tracker.phase('AI đang trả lời…');

      // Poll ổn định: text không đổi STABLE_CYCLES chu kỳ và không còn "đang sinh"
      const STABLE_CYCLES = cfg.stableCycles || 8;
      const POLL_MS = cfg.pollMs || 700;
      const t0 = Date.now();
      let last = '';
      let stable = 0;

      while (Date.now() - t0 < timeout) {
        if (aborted) {
          try { if (cfg.clickStop) cfg.clickStop(); } catch (_) {}
          Tracker.done(false);
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
          if (errHit) { Tracker.done(false); return { success: false, ...errHit, text: txt }; }
        }

        if (txt.length > 0 && txt === last && !generating) {
          stable += 1;
          if (stable >= STABLE_CYCLES) {
            const elapsedMs = Date.now() - t0;
            Tracker.done(true, elapsedMs);
            return { success: true, text: txt, elapsedMs, chatUrl: location.href };
          }
        } else {
          stable = 0;
        }
        last = txt;
        await sleep(POLL_MS);
      }

      Tracker.done(false);
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

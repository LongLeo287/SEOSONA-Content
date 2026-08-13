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

  const normWs = (s) => String(s || '').replace(/\s+/g, '');
  function moveCaretEnd(editor) {
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (_) {}
  }
  // Kiểm chèn: so trên chuỗi ĐÃ BỎ MỌI KHOẢNG TRẮNG (ProseMirror nối các <p> không có '\n'
  // nên so nguyên văn sẽ báo sai). Yêu cầu đủ 3 điều kiện: độ dài >=95%, có 20 ký tự ĐẦU,
  // và (nếu prompt dài) có 20 ký tự CUỐI — thiếu kiểm đuôi thì prompt dài bị editor cắt
  // vẫn "pass" và ta gửi đi một prompt thiếu mà không hề biết.
  function verifyInserted(editor, text) {
    const got = normWs(editor.textContent);
    const exp = normWs(text);
    if (!exp.length) return true;
    if (got.length < Math.floor(exp.length * 0.95)) return false;
    if (!got.includes(exp.substring(0, Math.min(20, exp.length)))) return false;
    if (exp.length > 40 && !got.includes(exp.substring(exp.length - 20))) return false;
    return true;
  }
  function clearEditor(editor) {
    try { editor.focus(); document.execCommand('selectAll', false, null); document.execCommand('delete', false, null); } catch (_) {}
  }
  function simulateClick(el) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    try {
      el.dispatchEvent(new PointerEvent('pointerdown', o));
      el.dispatchEvent(new MouseEvent('mousedown', o));
      el.dispatchEvent(new PointerEvent('pointerup', o));
      el.dispatchEvent(new MouseEvent('mouseup', o));
      el.dispatchEvent(new MouseEvent('click', o));
    } catch (_) { try { el.click(); } catch (__) {} }
  }
  function findSendBySvg(scope) {
    const btns = (scope || document).querySelectorAll('button:not([disabled])');
    for (const btn of btns) {
      const svg = btn.querySelector('svg'); if (!svg) continue;
      for (const path of svg.querySelectorAll('path')) {
        const d = path.getAttribute('d') || '';
        if (d.includes('M2.01 21L23 12') || d.includes('M2 21l21-9') || d.includes('m4 4 16 8-16 8') || /M\d+.*L.*12/.test(d)) return btn;
      }
    }
    return null;
  }
  // Đổi model trên giao diện web (best-effort).
  // QUAN TRỌNG: hàm này KHÔNG BAO GIỜ làm hỏng job — đổi được thì tốt, không đổi được thì
  // chạy tiếp bằng model đang chọn sẵn và báo lại để UI cảnh báo. Người dùng thà chạy được
  // bằng model mặc định còn hơn bị chặn vì một cái dropdown.
  // Trả về: 'switched' | 'already' | 'no-support' | 'not-found' | 'no-match'
  async function selectModel(cfg, matchTexts) {
    if (!matchTexts || !matchTexts.length) return 'no-support';
    if (!cfg.modelButton || !cfg.modelButton.length) return 'no-support';
    const wants = matchTexts.map((s) => String(s).toLowerCase());
    const hit = (txt) => {
      const t = normWs(txt).toLowerCase();
      if (!t) return false;
      return wants.some((w) => t === w) || wants.some((w) => t.includes(w));
    };
    const btn = findFirst(cfg.modelButton);
    if (!btn) return 'not-found';
    // Đã đúng model rồi thì đừng mở menu (mở ra rồi đóng lại dễ làm hỏng trạng thái composer)
    if (hit(btn.innerText || btn.textContent)) return 'already';
    simulateClick(btn);
    // Chờ menu hiện
    const items = await waitFor(() => {
      const list = [];
      for (const sel of (cfg.modelOption || [])) {
        try { document.querySelectorAll(sel).forEach((n) => { if (isVisible(n)) list.push(n); }); } catch (_) {}
      }
      return list.length ? list : null;
    }, { timeout: 2500, interval: 120 });
    if (!items) { try { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch (_) {} return 'not-found'; }
    // Khớp CHÍNH XÁC trước, rồi mới khớp CHỨA — tránh "Pro" nuốt nhầm "Pro Lite"
    let target = items.find((n) => wants.some((w) => normWs(n.innerText || '').toLowerCase() === w))
      || items.find((n) => hit(n.innerText || ''));
    if (!target) {
      try { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch (_) {}
      return 'no-match';
    }
    simulateClick(target);
    // Một số menu (Radix) chỉ phản hồi onSelect của React chứ không phải click thường
    const k = Object.keys(target).find((x) => x.startsWith('__reactProps$'));
    if (k && target[k] && typeof target[k].onSelect === 'function') {
      try { target[k].onSelect({ preventDefault() {} }); } catch (_) {}
    }
    await sleep(400);
    try { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch (_) {}
    // XÁC MINH: đọc lại nhãn trên nút — thiếu bước này thì đổi hụt mà vẫn tưởng thành công
    const after = findFirst(cfg.modelButton);
    return (after && hit(after.innerText || after.textContent)) ? 'switched' : 'no-match';
  }

  // Gui: uu tien Enter (editor rong = da gui), roi nut gui, roi form.requestSubmit
  // Mỗi tầng đều XÁC NHẬN đã gửi bằng cách POLL tới khi ô nhập rỗng (thay vì ngủ cố định
  // rồi đoán) — ngủ cố định quá ngắn sẽ rơi xuống tầng sau và GỬI HAI LẦN.
  async function submitPrompt(editor, cfg) {
    const emptied = () => normWs(editor.textContent).length < 3;
    // Poll tối đa `ms`, trả true ngay khi ô nhập đã rỗng
    const verifySubmitted = async (ms = 1500) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        if (emptied()) return true;
        await sleep(200);
      }
      return emptied();
    };
    const enter = () => {
      const o = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
      editor.dispatchEvent(new KeyboardEvent('keydown', o));
      editor.dispatchEvent(new KeyboardEvent('keypress', o));
      editor.dispatchEvent(new KeyboardEvent('keyup', o));
    };
    // SPA có thể render lại giữa lúc chèn và lúc gửi -> mọi thao tác sau đó rơi vào node đã chết
    if (!editor.isConnected) return false;
    editor.focus(); await sleep(80);
    enter();
    if (await verifySubmitted(1500)) return true;
    let btn = findFirst(cfg.sendButton) || findSendBySvg();
    if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
      simulateClick(btn);
      if (await verifySubmitted(1200)) return true;
      const k = Object.keys(btn).find((x) => x.startsWith('__reactProps$'));
      if (k && btn[k] && typeof btn[k].onClick === 'function') {
        try { btn[k].onClick({ preventDefault() {}, stopPropagation() {} }); } catch (_) {}
        if (await verifySubmitted(1000)) return true;
      }
    }
    const form = (btn && btn.closest('form')) || editor.closest('form');
    if (form && typeof form.requestSubmit === 'function') {
      try { form.requestSubmit(btn || undefined); } catch (_) { try { form.submit(); } catch (__) {} }
      if (await verifySubmitted(1000)) return true;
    }
    return emptied();
  }

  // Chèn text 3 tầng — ưu tiên paste event vì giữ nguyên state của editor
  // (ProseMirror/Quill), với văn bản dài + tiếng Việt có dấu vẫn an toàn.
  async function insertText(editor, text, mode) {
    editor.focus();
    await sleep(150);

    if (editor.tagName === 'TEXTAREA' || editor.tagName === 'INPUT') {
      setNativeValue(editor, text);
      return true;
    }

    // Gemini UI moi: dung execCommand + KHONG dispatch 'input' (tranh auto-submit loi)
    if (mode === 'gemini') {
      moveCaretEnd(editor);
      try { document.execCommand('insertText', false, text); } catch (_) {}
      await sleep(220);
      if (!verifyInserted(editor, text)) {
        try { editor.appendChild(document.createTextNode(text)); } catch (_) {}
        await sleep(150);
      }
      return verifyInserted(editor, text);
    }

    clearEditor(editor); await sleep(50); moveCaretEnd(editor);

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

    async function submitAndWait({ text, timeout = 600000, modelMatch = null }) {
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

      // Đổi model TRƯỚC khi chèn prompt: ở một số trang, đổi model làm reset khung soạn tin
      // (mất nội dung/công cụ đã bật) nên phải làm sớm nhất có thể.
      let modelState = 'skip';
      if (modelMatch && modelMatch.length) {
        Tracker.phase('đang chọn model…');
        try { modelState = await selectModel(cfg, modelMatch); } catch (_) { modelState = 'error'; }
      }

      const baseline = getTurns().length;

      Tracker.phase('đang gửi prompt…');
      const inserted = await insertText(editor, text, cfg.insertMode);
      if (!inserted) {
        Tracker.done(false);
        return { success: false, error: 'INSERT_FAILED', message: 'Không chèn được prompt vào ô chat (UI có thể đã đổi). Vào ⚙ Settings cập nhật selector "editor".' };
      }
      await sleep(400);
      const submitted = await submitPrompt(editor, cfg);

      // Chờ message mới xuất hiện. Với provider đếm cả bubble user
      // (countsUserMessages) cần vượt baseline + 1.
      // Nếu submitPrompt đã báo KHÔNG gửi được thì chỉ chờ ngắn (30s) rồi báo lỗi rõ ràng,
      // thay vì treo đủ 90s để cuối cùng vẫn không biết vì sao.
      const needed = baseline + (cfg.countsUserMessages ? 2 : 1);
      const appeared = await waitFor(() => getTurns().length >= needed, {
        timeout: submitted ? 90000 : 30000,
        interval: 500,
      });
      if (!appeared && !submitted) {
        Tracker.done(false);
        return { success: false, error: 'SUBMIT_LOST', retryable: true,
          message: 'Không gửi được prompt (ô nhập vẫn còn chữ sau khi thử Enter/nút gửi/form). Kiểm tra đã đăng nhập, hoặc cập nhật selector "sendButton" trong ⚙ Settings.' };
      }
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
            return { success: true, text: txt, elapsedMs, chatUrl: location.href, modelState };
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

    // Tên message chung `provider:*` là BÍ DANH của đúng các nhánh cũ `srt:*`.
    // Cố ý chỉ đổi tên, không đụng vào engine: chèn prompt 3 tầng, dò streaming, đổi model
    // và cơ chế override selector giữ nguyên từng dòng. Đổi tên và đổi hành vi cùng lúc
    // thì khi hỏng sẽ không biết vì cái nào.
    const ACTION_ALIASES = {
      'provider:ping': 'srt:ping',
      'provider:abort': 'srt:abort',
      'provider:submitAndWait': 'srt:submitAndWait',
    };

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || !msg.action) return;
      const action = ACTION_ALIASES[msg.action] || msg.action;

      if (action === 'srt:ping') {
        sendResponse({ ok: true, provider: cfg.name, providerId: cfg.name + '-web' });
        return;
      }
      if (action === 'srt:abort') {
        aborted = true;
        sendResponse({ ok: true });
        return;
      }
      if (action === 'srt:submitAndWait') {
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

    const stripSpeaker = (t) => String(t || '').replace(/^\s*(gemini|chatgpt|claude|grok)\s*(đã nói|said|ha detto|답변|พูดว่า)\s*[\n:]*/i, '').trim();
    const cfg = {
      name,
      editor: s.editor || [],
      sendButton: s.sendButton || [],
      countsUserMessages: !!s.countsUserMessages,
      errorPatterns: s.errorPatterns || {},
      insertMode: s.insertMode || null,
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
        return stripSpeaker((inner || el).innerText || '');
      },
      // Multi-signal (học từ SEOSONA Flow): còn "đang sinh" nếu indicator generating
      // XUẤT HIỆN, HOẶC nút Stop còn hiển thị → tránh lấy text lúc stream dở.
      isGenerating: () => {
        try {
          if (s.generating && document.querySelector(s.generating)) return true;
          if (s.stop) { const b = document.querySelector(s.stop); if (b && isVisible(b)) return true; }
        } catch (_) {}
        return false;
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

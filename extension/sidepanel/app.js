// SRT Studio — side panel controller
/* global SrtLib, OutputParser, Exporter, PROMPT_TEMPLATES, PromptBuilder, Knowledge */

const state = {
  sessionId: null,    // id phiên hiện tại
  sessionName: '',    // tên phiên
  srtRaw: '',
  srtName: 'source.srt',
  cues: [],
  results: {},        // provider -> { status, text, error, jobId, chatUrl }
  provider: 'chatgpt', // provider đang chọn (single-select kiểu TobyFlow)
  activeProvider: null,
  angles: [],         // [{ title, segments }] — nhiều góc cắt
  activeAngle: 0,
  segmentSource: '',  // provider tạo ra angles
  blockIds: [],       // knowledge blocks đang bật
  platformId: 'none',
  metadata: null,     // { title, description, hashtags, thumbnail, raw }
  repurpose: null,    // { format, name, text } — kết quả tái sử dụng gần nhất
  chapters: null,     // { local:[{startMs,clock,text}], titles:[], description } — chapter + mô tả
  content: { task: 'write', result: '', chatUrl: null }, // nhánh Content (viết/audit/review/seo)
  review: {},         // provider -> { status, text, scores }
  batch: { files: [], running: false, stopFlag: false }, // batch nhiều SRT
  chain: { active: false, steps: [] }, // workflow chain tự động (analyze→cắt→metadata→đánh giá)
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function setStatus(msg) {
  const el = document.getElementById('statusText');
  if (el) el.textContent = msg;
}
// Đặt tên phiên nếu chưa có (dùng tên file SRT); cập nhật nhãn trong dropdown
function setSession(name) {
  if (!state.sessionName && name) state.sessionName = name;
  const sel = document.getElementById('sessionSelect');
  if (sel) { const opt = sel.querySelector(`option[value="${state.sessionId}"]`); if (opt) opt.textContent = state.sessionName || name || 'Phiên'; }
}

// Toast trong panel
function toast(msg, type = 'info', ms = 3500) {
  const wrap = document.getElementById('toastWrap');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => {
    el.classList.add('hide');
    setTimeout(() => el.remove(), 250);
  }, ms);
  while (wrap.children.length > 4) wrap.firstChild.remove();
}

function currentSegments() {
  const a = state.angles[state.activeAngle];
  return a ? a.segments : [];
}
function validSegments() {
  return currentSegments().filter((s) => s.valid);
}

// ---------------------------------------------------------------- stages (stepper 1 luồng dọc)
const STAGES = ['srt', 'run', 'edit', 'review'];
function stageEl(name) { return document.querySelector(`.stage[data-stage="${name}"]`); }

// Khóa bước sau cho tới khi bước trước đủ điều kiện
function isStageLocked(name) {
  if (name === 'run') return state.cues.length === 0;
  if (name === 'edit') return currentSegments().length === 0;
  if (name === 'review') return validSegments().length === 0;
  return false;
}
function updateLocks() {
  STAGES.forEach((n) => { const el = stageEl(n); if (el) el.classList.toggle('locked', isStageLocked(n)); });
}
function openStage(name) {
  STAGES.forEach((n) => { const el = stageEl(n); if (el) el.classList.toggle('open', n === name); });
}
function setStageDone(name, summary, done = true) {
  const st = document.getElementById('st-' + name);
  if (st) st.textContent = summary || '';
  const el = stageEl(name);
  if (el) el.classList.toggle('done', !!done);
}
$$('.stage-head').forEach((h) => {
  h.addEventListener('click', () => {
    const el = h.parentElement;
    const name = el.dataset.stage;
    if (isStageLocked(name)) return;
    openStage(el.classList.contains('open') ? '__none__' : name);
  });
});

// ---------------------------------------------------------------- persist (nhiều phiên)
// Mỗi phiên = 1 project SRT + kết quả AI (kèm link cuộc chat của từng provider).
async function loadSessions() {
  try { const r = await chrome.storage.local.get(['srtSessions', 'srtCurrentId']); return { sessions: r.srtSessions || {}, currentId: r.srtCurrentId || null }; }
  catch (_) { return { sessions: {}, currentId: null }; }
}
function stateToSession() {
  return {
    id: state.sessionId, name: state.sessionName || state.srtName || 'Phiên mới', updatedAt: Date.now(),
    srtRaw: state.srtRaw, srtName: state.srtName,
    results: state.results, angles: state.angles, activeAngle: state.activeAngle,
    segmentSource: state.segmentSource, blockIds: state.blockIds,
    platformId: state.platformId, metadata: state.metadata, repurpose: state.repurpose, chapters: state.chapters,
  };
}
async function saveProject() {
  if (!state.sessionId) state.sessionId = 's_' + Date.now();
  try {
    const { srtSessions = {} } = await chrome.storage.local.get('srtSessions');
    srtSessions[state.sessionId] = stateToSession();
    await chrome.storage.local.set({ srtSessions, srtCurrentId: state.sessionId });
    renderSessionSelect(srtSessions, state.sessionId);
  } catch (_) {}
}

function loadSessionIntoState(sess) {
  Object.assign(state, {
    sessionId: sess.id, sessionName: sess.name || '',
    srtRaw: sess.srtRaw || '', srtName: sess.srtName || 'source.srt',
    results: sess.results || {}, angles: sess.angles || [], activeAngle: sess.activeAngle || 0,
    segmentSource: sess.segmentSource || '', blockIds: sess.blockIds || state.blockIds,
    platformId: sess.platformId || 'none', metadata: sess.metadata || null,
    repurpose: sess.repurpose || null, chapters: sess.chapters || null,
  });
  if (state.srtRaw) { $('#srtText').value = state.srtRaw; parseSrt(false); }
  else { $('#srtText').value = ''; $('#srtInfo').textContent = ''; state.cues = []; }
  syncKnowledgeUI();
  $('#platformSelect').value = state.platformId;
  renderResults(); renderAngles(); renderSegments(); renderMetadata(); renderRepurpose(); renderChapters();
  setStageDone('srt', state.cues.length ? `${state.cues.length} cue` : '', state.cues.length > 0);
  setStageDone('run', currentSegments().length ? `${state.segmentSource} · ${currentSegments().length} đoạn` : '', currentSegments().length > 0);
  setStageDone('edit', '', false); setStageDone('review', '', false);
  updateLocks();
  openStage(currentSegments().length ? 'edit' : (state.cues.length ? 'run' : 'srt'));
  // chọn provider phù hợp phiên: ưu tiên provider có kết quả
  const withResult = Object.keys(state.results).filter((k) => state.results[k] && state.results[k].text);
  setProvider(withResult.length && !withResult.includes(state.provider) ? withResult[0] : state.provider, { load: true });
}

async function restoreProject() {
  try { const { srtLastProvider } = await chrome.storage.local.get('srtLastProvider'); if (srtLastProvider) state.provider = srtLastProvider; } catch (_) {}
  let { sessions, currentId } = await loadSessions();
  // migrate project cũ (một project) -> một phiên
  if (!Object.keys(sessions).length) {
    try {
      const { srtProject } = await chrome.storage.local.get('srtProject');
      if (srtProject && srtProject.srtRaw) {
        const id = 's_' + Date.now();
        sessions[id] = Object.assign({ id, name: srtProject.srtName || 'Phiên', updatedAt: Date.now() }, srtProject);
        currentId = id;
        await chrome.storage.local.set({ srtSessions: sessions, srtCurrentId: id });
        await chrome.storage.local.remove('srtProject');
      }
    } catch (_) {}
  }
  if (currentId && sessions[currentId]) {
    loadSessionIntoState(sessions[currentId]);
  } else {
    state.sessionId = 's_' + Date.now(); state.sessionName = '';
  }
  renderSessionSelect(sessions, state.sessionId);
  setProvider(state.provider, { load: false });
}

function renderSessionSelect(sessions, currentId) {
  const sel = document.getElementById('sessionSelect');
  if (!sel) return;
  const list = Object.values(sessions || {}).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  sel.innerHTML = '';
  if (!list.length) {
    const o = document.createElement('option'); o.value = state.sessionId || ''; o.textContent = 'Phiên mới'; sel.appendChild(o);
    return;
  }
  list.forEach((s) => { const o = document.createElement('option'); o.value = s.id; o.textContent = s.name || s.srtName || 'Phiên'; sel.appendChild(o); });
  if (currentId) sel.value = currentId;
}

async function switchSession(id) {
  const { sessions } = await loadSessions();
  const sess = sessions[id];
  if (!sess) return;
  try { await chrome.storage.local.set({ srtCurrentId: id }); } catch (_) {}
  state.results = {}; state.angles = []; state.activeAngle = 0; state.metadata = null; state.review = {};
  loadSessionIntoState(sess);
  renderSessionSelect(sessions, id);
  showView('studio');
  toast('Đã chuyển phiên: ' + (sess.name || sess.srtName || ''), 'info');
}

async function newSession() {
  state.sessionId = 's_' + Date.now(); state.sessionName = '';
  Object.assign(state, { srtRaw: '', srtName: 'source.srt', cues: [], results: {}, angles: [], activeAngle: 0, segmentSource: '', metadata: null, review: {}, repurpose: null, chapters: null });
  $('#srtText').value = ''; $('#srtInfo').textContent = '';
  renderResults(); renderAngles(); renderSegments(); renderMetadata(); renderRepurpose(); renderChapters();
  STAGES.forEach((n) => setStageDone(n, '', false));
  updateLocks(); openStage('srt');
  setProvider(state.provider, { load: false });
  await saveProject();
  showView('studio');
  toast('Đã tạo phiên mới', 'success');
}

async function renameSession() {
  if (!state.sessionId) return;
  const name = prompt('Tên phiên:', state.sessionName || state.srtName || '');
  if (name == null) return;
  state.sessionName = name.trim();
  await saveProject();
}

async function deleteSession() {
  if (!state.sessionId) return;
  if (!confirm('Xóa phiên hiện tại?')) return;
  try {
    const { srtSessions = {} } = await chrome.storage.local.get('srtSessions');
    delete srtSessions[state.sessionId];
    await chrome.storage.local.set({ srtSessions });
    const rest = Object.values(srtSessions).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    if (rest.length) { await switchSession(rest[0].id); }
    else { await newSession(); }
  } catch (_) {}
}

// ---------------------------------------------------------------- TAB 1: SRT
function parseSrt(save = true) {
  const raw = $('#srtText').value;
  const cues = SrtLib.parse(raw);
  if (!cues.length) { $('#srtInfo').textContent = '⚠ Không parse được cue nào. Kiểm tra định dạng SRT.'; return; }
  state.srtRaw = raw;
  state.cues = cues;
  $('#srtInfo').textContent =
    `✅ ${state.srtName} — ${cues.length} cue · thời lượng nguồn ${SrtLib.msToTime(cues[cues.length - 1].end).slice(0, 8)}` +
    ` · tổng thời gian nói ${(SrtLib.totalDuration(cues) / 1000).toFixed(0)}s`;
  setStatus(`Đã nạp ${cues.length} cue`);
  setSession(state.srtName);
  setStageDone('srt', `${cues.length} cue · ${SrtLib.msToTime(cues[cues.length - 1].end).slice(0, 8)}`);
  updateLocks();
  if (save) { saveProject(); openStage('run'); toast(`Đã nạp ${cues.length} cue`, 'success'); }
}
$('#btnParse').addEventListener('click', () => parseSrt());
// Lưu ý: #dropZone là <label> bọc #srtFile nên click đã tự mở hộp thoại —
// KHÔNG thêm handler click gọi srtFile.click() nữa (sẽ mở 2 hộp thoại).
$('#srtFile').addEventListener('change', (e) => loadFile(e.target.files[0]));
$('#dropZone').addEventListener('dragover', (e) => { e.preventDefault(); $('#dropZone').classList.add('dragover'); });
$('#dropZone').addEventListener('dragleave', () => $('#dropZone').classList.remove('dragover'));
$('#dropZone').addEventListener('drop', (e) => {
  e.preventDefault(); $('#dropZone').classList.remove('dragover'); loadFile(e.dataTransfer.files[0]);
});
function loadFile(file) {
  if (!file) return;
  state.srtName = file.name;
  const reader = new FileReader();
  reader.onload = () => { $('#srtText').value = reader.result; parseSrt(); };
  reader.readAsText(file, 'utf-8');
}

// ---------------------------------------------------------------- TAB 2: knowledge + platform + templates
function initKnowledge() {
  const wrap = $('#knowledgeChecks');
  wrap.innerHTML = '';
  state.blockIds = [];
  for (const [id, blk] of Object.entries(Knowledge.BLOCKS)) {
    if (blk.default) state.blockIds.push(id);
    const lbl = document.createElement('label');
    lbl.className = 'chip';
    lbl.innerHTML = `<input type="checkbox" value="${id}" ${blk.default ? 'checked' : ''}><span>${blk.name}</span>`;
    lbl.querySelector('input').addEventListener('change', () => {
      state.blockIds = $$('#knowledgeChecks input:checked').map((i) => i.value);
      saveProject();
    });
    wrap.appendChild(lbl);
  }
  // combo bar: bật nhanh một bộ block
  const cwrap = $('#knowledgeCombos');
  if (cwrap) {
    cwrap.innerHTML = '';
    for (const [key, combo] of Object.entries(Knowledge.COMBOS || {})) {
      if (!combo.ids || !combo.ids.length) continue;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'combo-pill';
      btn.dataset.combo = key;
      btn.textContent = combo.name;
      btn.title = 'Bật: ' + combo.ids.map((id) => (Knowledge.BLOCKS[id] || {}).name || id).join(', ');
      btn.addEventListener('click', () => applyCombo(key, { additive: false }));
      cwrap.appendChild(btn);
    }
  }

  const sel = $('#platformSelect');
  sel.innerHTML = '';
  for (const [id, p] of Object.entries(Knowledge.PLATFORMS)) {
    const opt = document.createElement('option');
    opt.value = id; opt.textContent = p.name;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => { state.platformId = sel.value; saveProject(); });
}

// mẫu prompt -> combo kiến thức tương ứng (Gắn prompt↔combo)
const TPL_COMBO = { analyze_v2: 'shorts', longform: 'long', highlights: 'quality' };

// bật một combo. additive=false => thay cả bộ; additive=true => cộng thêm vào bộ đang bật
function applyCombo(key, { additive = false } = {}) {
  const combo = (Knowledge.COMBOS || {})[key];
  if (!combo) return;
  const cur = additive ? new Set(state.blockIds) : new Set();
  combo.ids.forEach((id) => cur.add(id));
  state.blockIds = [...cur];
  syncKnowledgeUI();
  saveProject();
}
function syncKnowledgeUI() {
  $$('#knowledgeChecks input').forEach((i) => { i.checked = state.blockIds.includes(i.value); });
  // đánh dấu combo đang khớp (tập block bật ⊇ combo) — cả bar ở Studio và Content
  const active = new Set(state.blockIds);
  $$('.combo-pill').forEach((b) => {
    const combo = (Knowledge.COMBOS || {})[b.dataset.combo];
    const on = combo && combo.ids.length && combo.ids.every((id) => active.has(id));
    b.classList.toggle('active', !!on);
  });
}

function initTemplates() {
  const sel = $('#tplSelect');
  sel.innerHTML = '';
  for (const [key, tpl] of Object.entries(PROMPT_TEMPLATES)) {
    if (tpl.kind !== 'analyze') continue;
    const opt = document.createElement('option');
    opt.value = key; opt.textContent = tpl.name;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => {
    $('#tplBody').value = PROMPT_TEMPLATES[sel.value].body;
    const comboKey = TPL_COMBO[sel.value];
    if (comboKey) { applyCombo(comboKey, { additive: false }); toast('Đã bật combo kiến thức: ' + (Knowledge.COMBOS[comboKey] || {}).name); }
  });
  $('#tplBody').value = PROMPT_TEMPLATES[sel.value].body;
}

// ---------------------------------------------------------------- TAB 2: RUN
// ---------------------------------------------------------------- chọn provider (single-select)
const PROVIDER_LABEL = { chatgpt: 'ChatGPT', gemini: 'Gemini', grok: 'Grok', claude: 'Claude' };
function bgSend(msg) { try { const p = chrome.runtime.sendMessage(msg); if (p && p.catch) p.catch(() => {}); } catch (_) {} }
function openChatFor(provider, url) { if (url) bgSend({ action: 'srt:openChat', provider, url }); }
function setProvider(p, { load = true, userAction = false } = {}) {
  state.provider = p;
  $$('#providerPills .ppill').forEach((b) => b.classList.toggle('active', b.dataset.provider === p));
  markSessionPills();
  const r = state.results[p];
  const hint = $('#providerSessionHint');
  const fresh = $('#freshChat') && $('#freshChat').checked;
  if (r && r.text) {
    if (load) { state.activeProvider = p; renderResults(); }
    if (hint) {
      hint.textContent = r.chatUrl
        ? (fresh ? '● Đã có kết quả cho ' + PROVIDER_LABEL[p] + ' (bật "Hội thoại mới" nên sẽ chạy chat mới)'
                 : '● Nối tiếp cuộc chat cũ của ' + PROVIDER_LABEL[p])
        : '● Đã có kết quả cho ' + PROVIDER_LABEL[p];
    }
    // Tắt "Hội thoại mới" + có link chat + do người dùng bấm pill -> tự mở lại chat cũ
    if (userAction && !fresh && r.chatUrl) {
      openChatFor(p, r.chatUrl);
      toast('Đang mở lại chat cũ trên ' + PROVIDER_LABEL[p] + '…', 'info');
    }
  } else if (hint) {
    hint.textContent = 'Chưa chạy ' + PROVIDER_LABEL[p] + ' trong phiên này.';
  }
  try { chrome.storage.local.set({ srtLastProvider: p }); } catch (_) {}
}
function markSessionPills() {
  $$('#providerPills .ppill').forEach((b) => {
    const r = state.results[b.dataset.provider];
    b.classList.toggle('has-session', !!(r && r.text));
  });
}
$$('#providerPills .ppill').forEach((b) => b.addEventListener('click', () => setProvider(b.dataset.provider, { load: true, userAction: true })));
// Tắt "Hội thoại mới" khi provider hiện tại có chat cũ -> mở lại để nối tiếp
$('#freshChat').addEventListener('change', () => {
  const r = state.results[state.provider];
  const hint = $('#providerSessionHint');
  if (!$('#freshChat').checked && r && r.chatUrl) {
    openChatFor(state.provider, r.chatUrl);
    if (hint) hint.textContent = '● Nối tiếp cuộc chat cũ của ' + PROVIDER_LABEL[state.provider];
    toast('Sẽ nối tiếp cuộc chat cũ trên ' + PROVIDER_LABEL[state.provider], 'info');
  } else {
    setProvider(state.provider, { load: false });
  }
});

function jobRow(provider, status, msg = '') {
  return `<div class="job ${status}" data-provider="${provider}">
    <span class="dot"></span><strong>${provider}</strong>
    <span class="hint">${msg || status}</span></div>`;
}
function updateJobRow(provider, status, msg, scope = document) {
  const el = scope.querySelector(`.job[data-provider="${provider}"]`);
  if (!el) return;
  el.className = 'job ' + status;
  el.querySelector('.hint').textContent = msg || status;
}

$('#btnRun').addEventListener('click', () => runAnalyze());
$('#btnChain').addEventListener('click', () => startChain());

async function runAnalyze() {
  if (!state.cues.length) { alert('Chưa nạp SRT.'); return false; }
  const providers = [state.provider];

  const angleCount = Math.max(1, Math.min(5, +$('#angleCount').value || 1));
  const text = PromptBuilder.buildAnalyze({
    srtRaw: state.srtRaw,
    base: $('#tplBody').value,
    blockIds: state.blockIds,
    platformId: state.platformId,
    angleCount,
  });
  const timeout = (+$('#timeoutMin').value || 10) * 60000;
  const freshChat = $('#freshChat').checked;

  $('#btnRun').disabled = true;
  $('#btnAbort').hidden = false;
  $('#jobStatus').innerHTML = providers.map((p) => jobRow(p, 'preparing', 'đang chuẩn bị…')).join('');

  for (const provider of providers) {
    // Nối tiếp cuộc chat cũ nếu tắt "Hội thoại mới" và provider đã có chatUrl
    const prevChatUrl = (state.results[provider] && state.results[provider].chatUrl) || null;
    const jobId = `analyze_${provider}_${Date.now()}`;
    state.results[provider] = { status: 'running', jobId, chatUrl: prevChatUrl };
    const resp = await chrome.runtime.sendMessage({ action: 'srt:runJob', jobId, provider, text, timeout, freshChat, chatUrl: freshChat ? null : prevChatUrl });
    if (!resp || !resp.ok) {
      state.results[provider] = { status: 'error', error: (resp && resp.error) || 'Không gửi được job' };
      updateJobRow(provider, 'error', state.results[provider].error);
      chainAbort('Gửi phân tích thất bại');
    }
  }
  refreshRunButtons();
  return true;
}

$('#btnAbort').addEventListener('click', async () => {
  for (const [provider, r] of Object.entries(state.results)) {
    if (r.status === 'running' && r.jobId) {
      await chrome.runtime.sendMessage({ action: 'srt:abortJob', jobId: r.jobId });
      state.results[provider].status = 'aborted';
    }
  }
  refreshRunButtons();
});

function refreshRunButtons() {
  const running = Object.values(state.results).some((r) => r.status === 'running' || r.status === 'preparing');
  $('#btnRun').disabled = running;
  $('#btnRun').classList.toggle('running', running);
  $('#btnAbort').hidden = !running;
  if (running) {
    const n = Object.values(state.results).filter((r) => r.status === 'running' || r.status === 'preparing').length;
    setStatus(`⏳ Đang chạy ${n} AI…`);
  } else if (Object.values(state.results).some((r) => r.text)) {
    setStatus('✅ Phân tích xong');
  }
}

// ---------------------------------------------------------------- WORKFLOW CHAIN tự động
// Chạy một mạch: Phân tích → Dựng bảng cắt → SEO metadata → Đánh giá (cùng 1 provider).
// Điều phối bằng cờ state.chain.active + các mốc 'done' trong handle*Update.
function startChain() {
  if (!state.cues.length) { alert('Chưa nạp SRT.'); return; }
  if (state.chain.active) return;
  state.chain = { active: true, steps: ['analyze', 'build', 'metadata', 'evaluate'] };
  setChainUI(true);
  toast('▶▶ Chạy tự động: Phân tích → Cắt → Metadata → Đánh giá', 'info', 4500);
  runAnalyze();
}
function chainAbort(reason) {
  if (!state.chain.active) return;
  state.chain.active = false;
  setChainUI(false);
  toast('⛔ Dừng chạy tự động' + (reason ? ': ' + reason : ''), 'warn', 6000);
}
function chainDone() {
  if (!state.chain.active) return;
  state.chain.active = false;
  setChainUI(false);
  const r = Object.values(state.review).find((x) => x.scores && x.scores.average != null);
  const avg = r ? r.scores.average : null;
  toast('✅ Chạy tự động HOÀN TẤT' + (avg != null ? ` · điểm ${avg}/10` : ''), 'success', 7000);
}
function setChainUI(on) {
  const b = $('#btnChain');
  if (b) { b.disabled = on; b.classList.toggle('running', on); b.textContent = on ? '⏳ Đang chạy tự động…' : '▶▶ Chạy tự động (toàn bộ)'; }
}

// ---------------------------------------------------------------- message hub
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.action !== 'srt:jobUpdate') return;
    const { jobId, provider, status, result } = msg;
    if (!jobId) return;
    if (jobId.startsWith('review_')) return handleReviewUpdate(provider, status, result);
    if (jobId.startsWith('repurpose_')) return handleRepurposeUpdate(status, result);
    if (jobId.startsWith('chapters_')) return handleChaptersUpdate(status, result);
    if (jobId.startsWith('content_')) return handleContentUpdate(status, result);
    if (jobId.startsWith('meta_')) return handleMetaUpdate(status, result);
    if (jobId.startsWith('batch_')) return handleBatchUpdate(jobId, status, result);
    if (jobId.startsWith('analyze_')) return handleAnalyzeUpdate(provider, status, result, jobId);
  });
}

function handleAnalyzeUpdate(provider, status, result, jobId) {
  if (!provider) return;
  if (status === 'running' || status === 'preparing') {
    const runningMsg = (result && result.retrying) ? `↻ ${result.message || 'thử lại…'}` : 'AI đang xử lý…';
    updateJobRow(provider, status, status === 'running' ? runningMsg : 'đang mở tab…');
    return;
  }
  if (status === 'done') {
    state.results[provider] = { status: 'done', text: result.text, jobId, chatUrl: result.chatUrl || null };
    state.activeProvider = provider;
    markSessionPills();
    updateJobRow(provider, 'done', `xong (${Math.round((result.elapsedMs || 0) / 1000)}s, ${result.text.length} ký tự)`);
    toast(`${provider} phân tích xong`, 'success');
    logHistory({ kind: 'analyze', provider, text: result.text, chatUrl: result.chatUrl });
  } else {
    state.results[provider] = { status, error: (result && (result.message || result.error)) || status, text: result && result.text };
    updateJobRow(provider, 'error', state.results[provider].error);
    toast(`${provider}: ${state.results[provider].error}`, 'error', 5000);
  }
  refreshRunButtons();
  renderResults();
  saveProject();
  // workflow chain: phân tích xong → tự dựng bảng → sang metadata
  if (state.chain.active) {
    if (status === 'done') { if (buildTableFromResult({ silent: true })) runMetadata(); else chainAbort('không dựng được bảng cắt'); }
    else chainAbort(state.results[provider] && state.results[provider].error);
  }
}

function renderResults() {
  const done = Object.entries(state.results).filter(([, r]) => r.text);
  $('#resultsCard').hidden = done.length === 0;
  if (!done.length) return;
  const tabs = $('#resultTabs');
  tabs.innerHTML = '';
  if (!state.activeProvider || !state.results[state.activeProvider] || !state.results[state.activeProvider].text) {
    state.activeProvider = done[0][0];
  }
  for (const [provider] of done) {
    const b = document.createElement('button');
    b.textContent = provider;
    b.className = provider === state.activeProvider ? 'sel' : '';
    b.addEventListener('click', () => setProvider(provider));
    tabs.appendChild(b);
  }
  // Nút mở lại đúng cuộc chat AI đã dùng (nếu có link)
  const cur = state.results[state.activeProvider] || {};
  if (cur.chatUrl) {
    const link = document.createElement('button');
    link.textContent = '↗ Mở lại chat trên ' + state.activeProvider;
    link.className = 'chat-link';
    link.addEventListener('click', () => openChatFor(state.activeProvider, cur.chatUrl));
    tabs.appendChild(link);
  }
  $('#rawResponse').textContent = cur.text || '';
}

$('#btnUseResult').addEventListener('click', () => buildTableFromResult());

// Dựng bảng cắt ghép từ kết quả AI. silent=true (dùng trong workflow chain) => không hỏi confirm.
// Trả về true nếu dựng được bảng.
function buildTableFromResult({ silent = false } = {}) {
  const r = state.results[state.activeProvider];
  if (!r || !r.text) return false;
  const angles = OutputParser.parseAngles(r.text, state.cues);
  if (!angles.length) {
    const hasTable = /\|.*\|/.test(r.text);
    const msg = hasTable
      ? 'Có bảng nhưng timecode không khớp SRT gốc (AI có thể đã sửa/bịa timecode, hoặc SRT quá dài nên AI phân tích thiếu). Bạn có thể tải kết quả .md để dùng ngoài.'
      : 'AI không trả về bảng markdown (thường do SRT quá dài, prompt bị cắt cụt). Xem "Kết quả thô", hoặc tải .md để dùng ngoài.';
    if (silent) { toast('Không dựng được bảng cắt — ' + (hasTable ? 'timecode lệch SRT gốc' : 'AI không trả bảng'), 'warn', 5000); }
    else if (confirm(msg + '\n\nTải kết quả AI ra file .md?')) downloadRawResult();
    return false;
  }
  state.angles = angles;
  state.activeAngle = 0;
  state.segmentSource = state.activeProvider;
  state.metadata = null;
  const validCount = angles.reduce((s, a) => s + a.segments.filter((x) => x.valid).length, 0);
  setStageDone('run', `${state.activeProvider} → ${angles.length} kịch bản · ${validCount} đoạn`);
  renderAngles();
  renderSegments();
  renderMetadata();
  updateLocks();
  saveProject();
  openStage('edit');
  toast(`Đã dựng ${angles.length} kịch bản · ${validCount} đoạn`, 'success');
  return true;
}

// Tải nguyên văn kết quả AI ra file .md
function downloadRawResult() {
  const r = state.results[state.activeProvider];
  if (!r || !r.text) { toast('Chưa có kết quả để tải', 'warn'); return; }
  const header = `# Phân tích SRT — ${state.srtName} (${PROVIDER_LABEL[state.activeProvider] || state.activeProvider})\n\n`;
  Exporter.download(baseName() + '.' + state.activeProvider + '.analysis.md', header + r.text, 'text/markdown');
  toast('Đã tải kết quả .md', 'success');
}
$('#btnDownloadRaw').addEventListener('click', downloadRawResult);

// ---------------------------------------------------------------- TAB 3: angles + segments
function renderAngles() {
  const sw = $('#angleSwitch');
  if (state.angles.length <= 1) { sw.hidden = true; sw.innerHTML = ''; return; }
  sw.hidden = false;
  sw.innerHTML = '';
  state.angles.forEach((a, i) => {
    const b = document.createElement('button');
    b.textContent = `${i + 1}. ${a.title}`.slice(0, 40);
    b.className = i === state.activeAngle ? 'sel' : '';
    b.addEventListener('click', () => { state.activeAngle = i; state.metadata = null; renderAngles(); renderSegments(); renderMetadata(); saveProject(); });
    sw.appendChild(b);
  });
}

function segDuration(seg) {
  const byIndex = new Map(state.cues.map((c) => [c.index, c]));
  return seg.cueIndexes.reduce((s, i) => { const c = byIndex.get(i); return s + (c ? c.end - c.start : 0); }, 0);
}

function renderSegments() {
  const list = $('#segmentList');
  list.innerHTML = '';
  const segs = currentSegments();
  if (!segs.length) {
    $('#editSummary').textContent = 'Chưa có bảng cắt ghép. Chạy phân tích ở bước 2 rồi bấm "Dựng bảng cắt ghép".';
    setStageDone('edit', '', false);
    updateLocks();
    return;
  }
  const totalMs = segs.reduce((s, seg) => s + segDuration(seg), 0);
  const mismatch = segs.filter((s) => s.valid && !s.textMatch).length;
  const invalid = segs.filter((s) => !s.valid).length;
  $('#editSummary').textContent =
    `${segs.length} đoạn · tổng ${(totalMs / 1000).toFixed(1)}s · nguồn: ${state.segmentSource}` +
    (mismatch ? ` · ⚠ ${mismatch} đoạn lệch text` : '') +
    (invalid ? ` · ❌ ${invalid} đoạn không khớp timecode` : '');
  setStageDone('edit', `${segs.length} đoạn · ${(totalMs / 1000).toFixed(0)}s`, true);
  updateLocks();

  const byIndex = new Map(state.cues.map((c) => [c.index, c]));
  segs.forEach((seg, i) => {
    const cues = seg.cueIndexes.map((x) => byIndex.get(x)).filter(Boolean);
    const div = document.createElement('div');
    div.className = 'seg' + (!seg.valid ? ' invalid' : (!seg.textMatch ? ' mismatch' : ''));
    const tc = cues.length
      ? `${SrtLib.msToTime(cues[0].start)} → ${SrtLib.msToTime(cues[cues.length - 1].end)}`
      : '(không khớp timecode nào trong SRT gốc)';
    const badge = !seg.valid ? '<span class="badge err">không khớp</span>'
      : (seg.textMatch ? '<span class="badge ok">khớp 100%</span>' : '<span class="badge warn">lệch text</span>');
    const displayText = cues.length ? cues.map((c) => c.text).join(' ') : seg.rawText;
    div.innerHTML = `
      <div class="seg-head">
        <span class="seg-label">${escapeHtml(seg.label || ('Đoạn ' + (i + 1)))}</span>
        ${badge}
        <span class="hint">${(segDuration(seg) / 1000).toFixed(1)}s</span>
        <div class="seg-actions">
          <button data-act="up" title="Đưa lên">↑</button>
          <button data-act="down" title="Đưa xuống">↓</button>
          <button data-act="del" title="Xóa">✕</button>
        </div>
      </div>
      <div class="seg-tc">${tc} · cue #${seg.cueIndexes.join(', #') || '?'}</div>
      <div class="seg-text">${escapeHtml(displayText)}</div>
      ${seg.note ? `<div class="seg-note">${escapeHtml(seg.note)}</div>` : ''}`;
    div.querySelector('[data-act="up"]').addEventListener('click', () => moveSeg(i, -1));
    div.querySelector('[data-act="down"]').addEventListener('click', () => moveSeg(i, 1));
    div.querySelector('[data-act="del"]').addEventListener('click', () => { segs.splice(i, 1); renderSegments(); saveProject(); });
    list.appendChild(div);
  });
}

function moveSeg(i, delta) {
  const segs = currentSegments();
  const j = i + delta;
  if (j < 0 || j >= segs.length) return;
  const [seg] = segs.splice(i, 1);
  segs.splice(j, 0, seg);
  renderSegments();
  saveProject();
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function baseName() {
  const angleTag = state.angles.length > 1 ? '.a' + (state.activeAngle + 1) : '';
  return state.srtName.replace(/\.srt$/i, '') + angleTag;
}
function requireSegments() {
  if (!validSegments().length) { alert('Chưa có đoạn hợp lệ nào để xuất.'); return false; }
  return true;
}
function edlOpts() {
  return { fps: +$('#edlFps').value || 30, clipName: $('#edlClip').value || 'SOURCE.MP4', title: baseName().toUpperCase() };
}

$('#btnExportSrt').addEventListener('click', () => { if (requireSegments()) Exporter.download(baseName() + '.cut.srt', Exporter.buildSplicedSrt(validSegments(), state.cues), 'application/x-subrip'); });
$('#btnExportCsv').addEventListener('click', () => { if (requireSegments()) Exporter.download(baseName() + '.cutlist.csv', Exporter.buildCsv(validSegments(), state.cues), 'text/csv'); });
$('#btnExportEdl').addEventListener('click', () => { if (requireSegments()) Exporter.download(baseName() + '.edl', Exporter.buildEdl(validSegments(), state.cues, edlOpts()), 'text/plain'); });
$('#btnExportFcpxml').addEventListener('click', () => { if (requireSegments()) Exporter.download(baseName() + '.fcpxml', Exporter.buildFcpxml(validSegments(), state.cues, edlOpts()), 'application/xml'); });
$('#btnExportCaptions').addEventListener('click', () => { if (requireSegments()) Exporter.download(baseName() + '.captions.txt', Exporter.buildCaptionsTxt(validSegments(), state.cues), 'text/plain'); });
$('#btnExportMd').addEventListener('click', () => { if (requireSegments()) Exporter.download(baseName() + '.script.md', Exporter.buildMarkdown(validSegments(), state.cues, { provider: state.segmentSource }), 'text/markdown'); });
$('#btnExportJson').addEventListener('click', () => Exporter.download(baseName() + '.project.json', Exporter.buildProjectJson({
  srtName: state.srtName, srtRaw: state.srtRaw, angles: state.angles, activeAngle: state.activeAngle, segmentSource: state.segmentSource, metadata: state.metadata,
}), 'application/json'));

// ---------------------------------------------------------------- TAB 3: SEO metadata
$('#btnMeta').addEventListener('click', () => runMetadata());

async function runMetadata() {
  if (!validSegments().length) { alert('Chưa có bảng cắt ghép.'); return false; }
  // trong workflow chain, dùng đúng provider đang chọn để nhất quán
  const provider = state.chain.active ? state.provider : $('#metaProvider').value;
  const script = Exporter.buildMarkdown(validSegments(), state.cues, { provider: state.segmentSource });
  const text = PROMPT_TEMPLATES.metadata.body.replace('{{SCRIPT}}', script);
  const jobId = `meta_${provider}_${Date.now()}`;
  $('#btnMeta').disabled = true;
  $('#metaStatus').innerHTML = jobRow(provider, 'preparing', 'đang gửi…');
  const resp = await chrome.runtime.sendMessage({ action: 'srt:runJob', jobId, provider, text, timeout: 300000, freshChat: true });
  if (!resp || !resp.ok) { $('#metaStatus').innerHTML = jobRow(provider, 'error', (resp && resp.error) || 'lỗi'); $('#btnMeta').disabled = false; chainAbort('Gửi metadata thất bại'); return false; }
  return true;
}

function handleMetaUpdate(status, result) {
  const row = $('#metaStatus .job');
  if (row) {
    row.className = 'job ' + (status === 'done' ? 'done' : status);
    row.querySelector('.hint').textContent = status === 'done' ? 'xong'
      : status === 'running' ? 'AI đang viết…' : (result && (result.message || result.error)) || status;
  }
  if (status === 'done' || status === 'error') {
    $('#btnMeta').disabled = false;
    if (result && result.text) { state.metadata = OutputParser.parseMetadata(result.text); renderMetadata(); saveProject(); toast('Đã sinh SEO metadata', 'success'); }
    else if (status === 'error') toast('Sinh metadata lỗi', 'error');
    // workflow chain: metadata xong → sang đánh giá
    if (state.chain.active) { if (status === 'done') runReview(); else chainAbort('metadata lỗi'); }
  }
}

function renderMetadata() {
  const view = $('#metaView');
  const m = state.metadata;
  $('#btnExportMeta').hidden = !m;
  if (!m) { view.innerHTML = ''; return; }
  view.innerHTML = `
    <div class="meta-row"><b>Title</b><div>${escapeHtml(m.title || '—')}</div></div>
    <div class="meta-row"><b>Description</b><pre class="meta-pre">${escapeHtml(m.description || '—')}</pre></div>
    <div class="meta-row"><b>Hashtags</b><div>${m.hashtags && m.hashtags.length ? m.hashtags.map((h) => `<span class="tag">${escapeHtml(h)}</span>`).join(' ') : '—'}</div></div>
    <div class="meta-row"><b>Thumbnail</b><div>${escapeHtml(m.thumbnail || '—')}</div></div>`;
}
$('#btnExportMeta').addEventListener('click', () => { if (state.metadata) Exporter.download(baseName() + '.metadata.txt', Exporter.buildMetadataTxt(state.metadata), 'text/plain'); });

// ---------------------------------------------------------------- REPURPOSE (tái sử dụng nội dung)
function initRepurpose() {
  const sel = $('#repurposeFormat');
  if (!sel) return;
  sel.innerHTML = '';
  for (const [key, tpl] of Object.entries(PROMPT_TEMPLATES)) {
    if (tpl.kind !== 'repurpose') continue;
    const opt = document.createElement('option');
    opt.value = key; opt.textContent = tpl.name;
    sel.appendChild(opt);
  }
}
// Transcript thuần (không timecode) từ các cue — nguồn tốt cho repurpose
function plainTranscript() {
  return (state.cues || []).map((c) => (c.text || '').replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}
function repurposeSourceText() {
  const mode = $('#repurposeSource').value;
  if (mode === 'script' && validSegments().length) {
    return Exporter.buildMarkdown(validSegments(), state.cues, { provider: state.segmentSource });
  }
  return plainTranscript();
}

$('#btnRepurpose').addEventListener('click', async () => {
  const source = repurposeSourceText();
  if (!source.trim()) { alert('Chưa có nội dung nguồn (nạp SRT hoặc dựng bảng cắt trước).'); return; }
  const key = $('#repurposeFormat').value;
  const tpl = PROMPT_TEMPLATES[key];
  if (!tpl) return;
  const provider = state.provider;
  const text = tpl.body.replace('{{SOURCE}}', source);
  const jobId = `repurpose_${provider}_${Date.now()}`;
  state.repurpose = { format: key, name: tpl.name, text: '' };
  $('#btnRepurpose').disabled = true;
  $('#btnRepurposeDownload').hidden = true;
  $('#repurposeView').hidden = true;
  $('#repurposeStatus').innerHTML = jobRow(provider, 'preparing', 'đang gửi…');
  const resp = await chrome.runtime.sendMessage({ action: 'srt:runJob', jobId, provider, text, timeout: 300000, freshChat: true });
  if (!resp || !resp.ok) { $('#repurposeStatus').innerHTML = jobRow(provider, 'error', (resp && resp.error) || 'lỗi'); $('#btnRepurpose').disabled = false; }
});

function handleRepurposeUpdate(status, result) {
  const row = $('#repurposeStatus .job');
  if (row) {
    row.className = 'job ' + (status === 'done' ? 'done' : status);
    row.querySelector('.hint').textContent = status === 'done' ? 'xong'
      : status === 'running' ? 'AI đang viết…' : (result && (result.message || result.error)) || status;
  }
  if (status === 'done' || status === 'error') {
    $('#btnRepurpose').disabled = false;
    if (status === 'done' && result && result.text) {
      state.repurpose = { ...(state.repurpose || {}), text: result.text };
      const view = $('#repurposeView');
      view.hidden = false; view.textContent = result.text;
      $('#btnRepurposeDownload').hidden = false;
      saveProject();
      toast('Đã tạo nội dung tái sử dụng', 'success');
    } else if (status === 'error') toast('Tạo nội dung lỗi', 'error');
  }
}

// ---------------------------------------------------------------- CHAPTERS + MÔ TẢ (tách riêng)
$('#btnChapters').addEventListener('click', async () => {
  if (!validSegments().length) { alert('Chưa có bảng cắt ghép.'); return; }
  const minSec = Math.max(10, Math.min(180, +$('#chapMinSec').value || 12));
  const local = Exporter.buildChapters(validSegments(), state.cues, minSec * 1000);
  if (!local.length) { alert('Không dựng được chapter (kịch bản quá ngắn).'); return; }
  const chaptersText = local.map((ch, i) => `Phần ${i + 1} (${ch.clock}): ${ch.text}`).join('\n\n');
  const provider = state.provider;
  const text = PROMPT_TEMPLATES.chapters.body.replace('{{CHAPTERS}}', chaptersText);
  const jobId = `chapters_${provider}_${Date.now()}`;
  state.chapters = { local, titles: [], description: '' };
  $('#btnChapters').disabled = true;
  $('#chaptersView').hidden = true;
  $('#chaptersStatus').innerHTML = jobRow(provider, 'preparing', 'đang gửi…');
  const resp = await chrome.runtime.sendMessage({ action: 'srt:runJob', jobId, provider, text, timeout: 300000, freshChat: true });
  if (!resp || !resp.ok) { $('#chaptersStatus').innerHTML = jobRow(provider, 'error', (resp && resp.error) || 'lỗi'); $('#btnChapters').disabled = false; }
});

function handleChaptersUpdate(status, result) {
  const row = $('#chaptersStatus .job');
  if (row) {
    row.className = 'job ' + (status === 'done' ? 'done' : status);
    row.querySelector('.hint').textContent = status === 'done' ? 'xong'
      : status === 'running' ? 'AI đang đặt tên…' : (result && (result.message || result.error)) || status;
  }
  if (status === 'done' || status === 'error') {
    $('#btnChapters').disabled = false;
    if (status === 'done' && result && result.text) {
      const parsed = OutputParser.parseChapters(result.text);
      state.chapters = { ...(state.chapters || { local: [] }), titles: parsed.titles, description: parsed.description };
      renderChapters();
      saveProject();
      toast('Đã sinh chapter + mô tả', 'success');
    } else if (status === 'error') toast('Sinh chapter lỗi', 'error');
  }
}

function renderChapters() {
  const c = state.chapters;
  const view = $('#chaptersView');
  if (!view) return;
  if (!c || !c.local || !c.local.length) { view.hidden = true; return; }
  view.hidden = false;
  $('#chaptersList').textContent = Exporter.buildChaptersTxt(c.local, c.titles);
  $('#chaptersDesc').textContent = c.description
    ? (c.description + '\n\n' + Exporter.buildChaptersTxt(c.local, c.titles))
    : Exporter.buildChaptersTxt(c.local, c.titles);
}

$('#btnChaptersDl').addEventListener('click', () => {
  const c = state.chapters;
  if (!c || !c.local) return;
  Exporter.download(baseName() + '.chapters.txt', Exporter.buildChaptersTxt(c.local, c.titles), 'text/plain');
  toast('Đã tải chapters.txt', 'success');
});
$('#btnDescDl').addEventListener('click', () => {
  const c = state.chapters;
  if (!c || !c.local) return;
  const body = (c.description ? c.description + '\n\n📌 TIMESTAMPS\n' : '') + Exporter.buildChaptersTxt(c.local, c.titles);
  Exporter.download(baseName() + '.description.txt', body, 'text/plain');
  toast('Đã tải description.txt', 'success');
});

// ---------------------------------------------------------------- NHÁNH CONTENT (viết/audit/review/seo)
function initContent() {
  if (typeof CONTENT_TASKS === 'undefined') return;
  // task chips
  const tasks = $('#contentTasks');
  tasks.innerHTML = '';
  for (const [key, t] of Object.entries(CONTENT_TASKS)) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'task-pill'; b.dataset.task = key; b.textContent = t.name;
    b.addEventListener('click', () => setContentTask(key));
    tasks.appendChild(b);
  }
  // format select
  const fmt = $('#contentFormat');
  fmt.innerHTML = '';
  for (const [key, name] of Object.entries(CONTENT_FORMATS)) {
    const o = document.createElement('option'); o.value = key; o.textContent = name; fmt.appendChild(o);
  }
  // combo bar (dùng chung applyCombo -> state.blockIds)
  const cwrap = $('#contentCombos');
  if (cwrap) {
    cwrap.innerHTML = '';
    for (const [key, combo] of Object.entries(Knowledge.COMBOS || {})) {
      if (!combo.ids || !combo.ids.length) continue;
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'combo-pill'; btn.dataset.combo = key; btn.textContent = combo.name;
      btn.title = 'Bật: ' + combo.ids.map((id) => (Knowledge.BLOCKS[id] || {}).name || id).join(', ');
      btn.addEventListener('click', () => applyCombo(key, { additive: false }));
      cwrap.appendChild(btn);
    }
  }
  $('#contentProvider').value = state.provider;
  $('#contentInput').addEventListener('input', () => { state.content.input = $('#contentInput').value; });
  setContentTask(state.content.task || 'write');
}

function setContentTask(key) {
  const t = CONTENT_TASKS[key]; if (!t) return;
  state.content.task = key;
  $$('#contentTasks .task-pill').forEach((b) => b.classList.toggle('active', b.dataset.task === key));
  $('#contentInputLabel').textContent = t.inputLabel;
  $('#contentInput').placeholder = t.inputLabel;
  $('#contentFormatRow').hidden = !t.needsFormat;
  $('#contentKeywordRow').hidden = !t.needsKeyword;
  $('#contentBrandRow').hidden = !t.needsBrand;
}

$('#btnContentRun').addEventListener('click', async () => {
  const input = ($('#contentInput').value || '').trim();
  if (!input) { alert('Nhập chủ đề/brief hoặc dán nội dung.'); return; }
  const key = state.content.task || 'write';
  const t = CONTENT_TASKS[key]; if (!t) return;
  const provider = $('#contentProvider').value || state.provider;
  const knowledge = Knowledge.buildKnowledgeSection(state.blockIds || []);
  const kw = ($('#contentKeyword').value || '').trim() || '(chưa cung cấp)';
  const fmt = CONTENT_FORMATS[$('#contentFormat').value] || $('#contentFormat').value || '';
  const brandRaw = t.needsBrand ? ($('#contentBrand').value || '').trim() : '';
  const brand = brandRaw ? `\n## BRAND VOICE (BẮT BUỘC tuân theo, ưu tiên hơn chuẩn chung khi có xung đột về giọng)\n${brandRaw}\n` : '';
  const lit = (v) => () => v; // tránh $-pattern trong replacement khi input chứa $&, $1...
  let body = t.body
    .replace('{{INPUT}}', lit(input))
    .replace('{{KEYWORD}}', lit(kw))
    .replace('{{FORMAT}}', lit(fmt))
    .replace('{{BRAND}}', lit(brand));
  const text = knowledge ? (knowledge + '\n' + body) : body;
  const jobId = `content_${provider}_${Date.now()}`;
  state.content.result = ''; state.content.chatUrl = null;
  $('#btnContentRun').disabled = true;
  $('#contentResultCard').hidden = true;
  $('#contentStatus').innerHTML = jobRow(provider, 'preparing', 'đang gửi…');
  const resp = await chrome.runtime.sendMessage({ action: 'srt:runJob', jobId, provider, text, timeout: 300000, freshChat: true });
  if (!resp || !resp.ok) { $('#contentStatus').innerHTML = jobRow(provider, 'error', (resp && resp.error) || 'lỗi'); $('#btnContentRun').disabled = false; }
});

function handleContentUpdate(status, result) {
  const row = $('#contentStatus .job');
  if (row) {
    row.className = 'job ' + (status === 'done' ? 'done' : status);
    row.querySelector('.hint').textContent = status === 'done' ? 'xong'
      : status === 'running' ? 'AI đang xử lý…' : (result && (result.message || result.error)) || status;
  }
  if (status === 'done' || status === 'error') {
    $('#btnContentRun').disabled = false;
    if (status === 'done' && result && result.text) {
      state.content.result = result.text;
      state.content.chatUrl = result.chatUrl || null;
      renderContent();
      saveContent();
      toast('Content xong', 'success');
    } else if (status === 'error') toast('Content lỗi', 'error');
  }
}

function renderContent() {
  const c = state.content || {};
  const card = $('#contentResultCard');
  if (!card) return;
  if (!c.result) { card.hidden = true; $('#contentScoreCard').hidden = true; $('#btnContentApply').hidden = true; return; }
  card.hidden = false;
  $('#contentResult').textContent = c.result;
  const chatBtn = $('#btnContentChat');
  chatBtn.hidden = !c.chatUrl;
  if (c.chatUrl) chatBtn.onclick = () => openChatFor($('#contentProvider').value, c.chatUrl);

  // review -> bảng điểm trực quan
  if (c.task === 'review') renderContentScores(c.result);
  else $('#contentScoreCard').hidden = true;

  // audit -> nút áp "bản đã sửa"
  const corrected = c.task === 'audit' ? extractCorrected(c.result) : '';
  $('#btnContentApply').hidden = !corrected;
  $('#btnContentApply').dataset.corrected = corrected || '';
}

// trích "### 1. BẢN ĐÃ SỬA" tới mục kế tiếp
function extractCorrected(text) {
  const m = /###\s*1\.?\s*B[ẢA]N\s*Đ[ÃA]\s*S[ỬU]A\s*\n([\s\S]*?)(?:\n###\s|\n##\s|$)/i.exec(text || '');
  return m ? m[1].trim() : '';
}

function renderContentScores(text) {
  const box = $('#contentScoreCard');
  const scores = OutputParser.parseScores(text || '');
  if (!scores || !scores.criteria || !scores.criteria.length) { box.hidden = true; return; }
  box.hidden = false;
  const rows = scores.criteria.map((cr) => ({ name: cr.name, avg: cr.score / cr.max * 10, suggest: cr.suggest || cr.comment || '' }));
  const overall = scores.average != null ? scores.average : (rows.reduce((s, x) => s + x.avg, 0) / (rows.length || 1));
  const barColor = (v) => v >= 8 ? 'var(--ok)' : v >= 6 ? 'var(--warn)' : 'var(--err)';
  let html = `<div class="overall">Điểm tổng: <b>${overall.toFixed(1)}/10</b>${scores.verdict ? ' · ' + escapeHtml(scores.verdict) : ''}</div>`;
  for (const row of rows) {
    html += `<div class="score">
      <div class="score-head"><span>${escapeHtml(row.name)}</span><b>${row.avg.toFixed(1)}</b></div>
      <div class="bar"><i style="width:${Math.max(0, Math.min(100, row.avg * 10))}%;background:${barColor(row.avg)}"></i></div>
      ${row.suggest ? `<div class="hint">${escapeHtml(row.suggest)}</div>` : ''}</div>`;
  }
  box.innerHTML = html;
}

$('#btnContentDownload').addEventListener('click', () => {
  const c = state.content || {};
  if (!c.result) { toast('Chưa có kết quả', 'warn'); return; }
  const task = (CONTENT_TASKS[c.task] || {}).name || 'content';
  Exporter.download('content.' + (c.task || 'out') + '.md', `# ${task}\n\n` + c.result, 'text/markdown');
  toast('Đã tải .md', 'success');
});
$('#btnContentCopy').addEventListener('click', async () => {
  const c = state.content || {};
  if (!c.result) return;
  try { await navigator.clipboard.writeText(c.result); toast('Đã copy kết quả', 'success'); }
  catch (_) { toast('Không copy được (thử bôi đen tay)', 'warn'); }
});
// Áp bản đã sửa (audit) -> đưa vào ô nhập để dùng/chỉnh tiếp
$('#btnContentApply').addEventListener('click', () => {
  const corrected = $('#btnContentApply').dataset.corrected || '';
  if (!corrected) return;
  $('#contentInput').value = corrected;
  state.content.input = corrected;
  saveContent();
  $('#contentInput').scrollIntoView({ behavior: 'smooth', block: 'center' });
  toast('Đã đưa bản đã sửa vào ô nhập', 'success');
});

// Quick action từ menu chuột phải (audit/rewrite nhanh trên selection)
async function runQuickAction(action, text) {
  if (typeof QUICK_ACTIONS === 'undefined') return;
  const qa = QUICK_ACTIONS[action]; if (!qa || !text) return;
  showView('content');
  $('#contentProvider').value = state.provider;
  $('#contentInput').value = text;
  state.content = { task: action, result: '', chatUrl: null };
  const provider = $('#contentProvider').value || state.provider;
  const knowledge = Knowledge.buildKnowledgeSection(state.blockIds || []);
  const body = qa.body.replace('{{INPUT}}', () => text);
  const prompt = knowledge ? knowledge + '\n' + body : body;
  const jobId = `content_${provider}_${Date.now()}`;
  $('#btnContentRun').disabled = true;
  $('#contentResultCard').hidden = true;
  $('#contentScoreCard').hidden = true;
  $('#contentStatus').innerHTML = jobRow(provider, 'preparing', `${qa.name}…`);
  const resp = await chrome.runtime.sendMessage({ action: 'srt:runJob', jobId, provider, text: prompt, timeout: 300000, freshChat: true });
  if (!resp || !resp.ok) { $('#contentStatus').innerHTML = jobRow(provider, 'error', (resp && resp.error) || 'lỗi'); $('#btnContentRun').disabled = false; }
  else toast(`${qa.name} → đã gửi cho ${PROVIDER_LABEL[provider] || provider}`, 'info');
}
async function consumeQuickPending() {
  try {
    const { srtQuickPending } = await chrome.storage.local.get('srtQuickPending');
    if (!srtQuickPending || !srtQuickPending.text) return;
    await chrome.storage.local.remove('srtQuickPending');
    runQuickAction(srtQuickPending.action, srtQuickPending.text);
  } catch (_) {}
}
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.srtQuickPending && changes.srtQuickPending.newValue) consumeQuickPending();
  });
}

// Content lưu riêng (độc lập phiên SRT)
async function saveContent() {
  try {
    await chrome.storage.local.set({ srtContentLast: {
      task: state.content.task,
      input: ($('#contentInput') || {}).value || '',
      keyword: ($('#contentKeyword') || {}).value || '',
      format: ($('#contentFormat') || {}).value || '',
      brand: ($('#contentBrand') || {}).value || '',
      result: state.content.result || '', chatUrl: state.content.chatUrl || null,
    } });
  } catch (_) {}
}
async function restoreContent() {
  try {
    const { srtContentLast: c } = await chrome.storage.local.get('srtContentLast');
    if (!c) return;
    state.content = { task: c.task || 'write', result: c.result || '', chatUrl: c.chatUrl || null };
    if ($('#contentInput')) $('#contentInput').value = c.input || '';
    if ($('#contentKeyword')) $('#contentKeyword').value = c.keyword || '';
    if ($('#contentBrand')) $('#contentBrand').value = c.brand || '';
    if (c.format && $('#contentFormat')) $('#contentFormat').value = c.format;
    setContentTask(state.content.task);
    renderContent();
  } catch (_) {}
}

function renderRepurpose() {
  const view = $('#repurposeView'), btn = $('#btnRepurposeDownload');
  if (!view || !btn) return;
  const r = state.repurpose;
  if (r && r.text) {
    view.hidden = false; view.textContent = r.text; btn.hidden = false;
    if (r.format && $('#repurposeFormat')) $('#repurposeFormat').value = r.format;
  } else { view.hidden = true; view.textContent = ''; btn.hidden = true; }
}

$('#btnRepurposeDownload').addEventListener('click', () => {
  const r = state.repurpose;
  if (!r || !r.text) { toast('Chưa có nội dung để tải', 'warn'); return; }
  const slug = (r.format || 'repurpose').replace('repurpose_', '');
  const header = `# ${r.name || 'Repurpose'} — ${state.srtName}\n\n`;
  Exporter.download(baseName() + '.' + slug + '.md', header + r.text, 'text/markdown');
  toast('Đã tải .md', 'success');
});

// ---------------------------------------------------------------- BƯỚC 4: ĐÁNH GIÁ (single provider)
$('#btnReview').addEventListener('click', () => runReview());

async function runReview() {
  if (!validSegments().length) { alert('Chưa có bảng cắt ghép.'); return false; }
  const providers = [state.provider];
  const script = Exporter.buildMarkdown(validSegments(), state.cues, { provider: state.segmentSource });
  const text = PROMPT_TEMPLATES.evaluate.body.replace('{{SCRIPT}}', script);

  state.review = {};
  $('#btnReview').disabled = true;
  $('#reviewScoreCard').hidden = true;
  $('#reviewStatus').innerHTML = providers.map((p) => jobRow(p, 'preparing', 'đang gửi…')).join('');

  for (const provider of providers) {
    const jobId = `review_${provider}_${Date.now()}`;
    state.review[provider] = { status: 'running' };
    const resp = await chrome.runtime.sendMessage({ action: 'srt:runJob', jobId, provider, text, timeout: 600000, freshChat: true });
    if (!resp || !resp.ok) { state.review[provider] = { status: 'error' }; updateJobRow(provider, 'error', (resp && resp.error) || 'lỗi', $('#reviewStatus')); chainAbort('Gửi đánh giá thất bại'); return false; }
  }
  return true;
}

function handleReviewUpdate(provider, status, result) {
  if (!provider) return;
  if (status === 'running' || status === 'preparing') {
    updateJobRow(provider, status, status === 'running' ? 'đang chấm…' : 'đang mở tab…', $('#reviewStatus'));
    return;
  }
  if (status === 'done' && result && result.text) {
    state.review[provider] = { status: 'done', text: result.text, scores: OutputParser.parseScores(result.text) };
    updateJobRow(provider, 'done', `${state.review[provider].scores.average ?? '?'}/10`, $('#reviewStatus'));
  } else {
    state.review[provider] = { status: 'error', text: result && result.text };
    updateJobRow(provider, 'error', (result && (result.message || result.error)) || status, $('#reviewStatus'));
  }
  const pending = Object.values(state.review).some((r) => r.status === 'running' || r.status === 'preparing');
  $('#btnReview').disabled = pending;
  renderReviewScores();
  if (!pending) {
    const any = Object.values(state.review).some((r) => r.scores && r.scores.criteria.length);
    toast(any ? 'Đánh giá xong' : 'Đánh giá không đọc được điểm', any ? 'success' : 'warn');
    if (state.chain.active) chainDone(); // workflow chain: bước cuối xong → hoàn tất
  }
}

function renderReviewScores() {
  const done = Object.entries(state.review).filter(([, r]) => r.scores && r.scores.criteria.length);
  $('#reviewScoreCard').hidden = done.length === 0;
  if (!done.length) return;

  const [provider, r] = done[0];
  const rows = r.scores.criteria.map((c) => ({ name: c.name, avg: c.score / c.max * 10, comment: c.comment || '', suggest: c.suggest || '' }));
  const overall = r.scores.average != null ? r.scores.average : (rows.length ? rows.reduce((s, x) => s + x.avg, 0) / rows.length : 0);
  const barColor = (v) => v >= 8 ? 'var(--ok)' : v >= 6 ? 'var(--warn)' : 'var(--err)';

  let html = `<div class="overall">Điểm tổng: <b>${overall.toFixed(1)}/10</b> · ${PROVIDER_LABEL[provider] || provider}`;
  if (r.scores.verdict) html += ` · ${escapeHtml(r.scores.verdict)}`;
  html += '</div>';
  for (const row of rows) {
    html += `<div class="score">
      <div class="score-head"><span>${escapeHtml(row.name)}</span><b>${row.avg.toFixed(1)}</b></div>
      <div class="bar"><i style="width:${row.avg * 10}%;background:${barColor(row.avg)}"></i></div>
      ${row.suggest ? `<div class="hint">${escapeHtml(row.suggest)}</div>` : ''}</div>`;
  }
  $('#reviewScores').innerHTML = html;
  $('#reviewResult').textContent = r.text;
  setStageDone('review', `${overall.toFixed(1)}/10 · ${PROVIDER_LABEL[provider] || provider}`);
}

// ---------------------------------------------------------------- prompt library + variables
async function plibLoad() { try { const r = await chrome.storage.local.get('srtPrompts'); return r.srtPrompts || []; } catch (_) { return []; } }
async function plibStore(list) { try { await chrome.storage.local.set({ srtPrompts: list }); } catch (_) {} }
function plibVars(body) {
  const set = new Set();
  (String(body).match(/\{\{(\w+)\}\}/g) || []).forEach((m) => set.add(m.slice(2, -2)));
  return [...set];
}
async function openPrompts() {
  $('#promptFill').hidden = true; $('#promptMain').hidden = false;
  renderPromptList(await plibLoad());
}
function renderPromptList(list) {
  const box = $('#promptList');
  if (!list.length) { box.innerHTML = '<p class="hint">Chưa lưu prompt nào.</p>'; return; }
  box.innerHTML = '';
  list.forEach((p) => {
    const vars = plibVars(p.body);
    const row = document.createElement('div');
    row.className = 'plib-row';
    row.innerHTML = `<div class="plib-main"><b>${escapeHtml(p.title)}</b><span class="hint">${p.body.length} ký tự${vars.length ? ' · biến: ' + vars.map(escapeHtml).join(', ') : ''}</span></div>`
      + '<div class="plib-act"><button data-a="use">Dùng</button><button data-a="del">✕</button></div>';
    row.querySelector('[data-a="use"]').addEventListener('click', () => usePrompt(p));
    row.querySelector('[data-a="del"]').addEventListener('click', async () => { const l = (await plibLoad()).filter((x) => x.id !== p.id); await plibStore(l); renderPromptList(l); });
    box.appendChild(row);
  });
}
function usePrompt(p) {
  const vars = plibVars(p.body);
  if (!vars.length) { applyPromptBody(p.body); return; }
  $('#promptFillTitle').textContent = p.title;
  const box = $('#promptVars'); box.innerHTML = '';
  vars.forEach((v) => {
    const div = document.createElement('div'); div.className = 'var-row';
    div.innerHTML = `<label>{{${escapeHtml(v)}}}</label><input type="text" data-var="${escapeHtml(v)}" placeholder="giá trị…">`;
    box.appendChild(div);
  });
  $('#promptFill').dataset.body = p.body;
  $('#promptMain').hidden = true; $('#promptFill').hidden = false;
}
function applyPromptBody(body) {
  $('#tplBody').value = body;
  const det = $('#tplBody').closest('details'); if (det) det.open = true;
  showView('studio');
  openStage('run');
  toast('Đã áp dụng prompt', 'success');
}
$('#promptFillBack').addEventListener('click', () => { $('#promptFill').hidden = true; $('#promptMain').hidden = false; });
$('#promptApply').addEventListener('click', () => {
  let body = $('#promptFill').dataset.body || '';
  $$('#promptVars input').forEach((inp) => { body = body.split('{{' + inp.dataset.var + '}}').join(inp.value); });
  applyPromptBody(body);
});
async function saveCurrentPromptFlow() {
  const body = $('#tplBody').value.trim();
  if (!body) { toast('Prompt đang trống', 'warn'); return; }
  const title = prompt('Tên prompt:', 'Prompt SRT');
  if (!title) return;
  const list = await plibLoad();
  list.unshift({ id: 'p_' + Date.now(), title, body });
  await plibStore(list); renderPromptList(list); toast('Đã lưu prompt', 'success');
}
$('#btnSaveCurrentPrompt').addEventListener('click', saveCurrentPromptFlow);
$('#btnSavePromptQuick').addEventListener('click', saveCurrentPromptFlow);

// Import prompt từ .txt
$('#btnImportPrompt').addEventListener('click', () => $('#importPromptFile').click());
$('#importPromptFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => { $('#tplBody').value = reader.result; toast('Đã nạp prompt từ file', 'success'); };
  reader.readAsText(file, 'utf-8');
  e.target.value = '';
});

// Stepper số góc
function bumpAngle(delta) {
  const el = $('#angleCount');
  el.value = Math.max(1, Math.min(5, (+el.value || 1) + delta));
}
$('#angleMinus').addEventListener('click', () => bumpAngle(-1));
$('#anglePlus').addEventListener('click', () => bumpAngle(1));

// Phiên mới

// ---------------------------------------------------------------- batch nhiều SRT
const batchWaiters = {};
function openBatch() { renderBatch(); }
$('#batchFiles').addEventListener('change', (e) => addBatchFiles(e.target.files));

function addBatchFiles(fileList) {
  Array.from(fileList || []).forEach((file) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = reader.result;
      const cues = SrtLib.parse(raw);
      state.batch.files.push({
        id: 'bf_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
        name: file.name, raw, cues,
        status: cues.length ? 'pending' : 'error',
        error: cues.length ? '' : 'không parse được SRT', segCount: 0, angles: null,
      });
      renderBatch();
    };
    reader.readAsText(file, 'utf-8');
  });
}
function renderBatch() {
  const box = $('#batchList');
  if (!state.batch.files.length) { box.innerHTML = '<p class="hint">Chưa thêm file nào.</p>'; $('#batchZipAll').hidden = true; return; }
  box.innerHTML = '';
  state.batch.files.forEach((f) => {
    const row = document.createElement('div');
    row.className = 'batch-row ' + (['running', 'done', 'error'].includes(f.status) ? f.status : '');
    const stat = f.status === 'done' ? `${f.segCount} đoạn`
      : f.status === 'error' ? (f.error || 'lỗi')
      : f.status === 'running' ? '…đang chạy'
      : `${f.cues.length} cue`;
    const name = document.createElement('span'); name.className = 'batch-name'; name.textContent = f.name;
    const st = document.createElement('span'); st.className = 'batch-stat'; st.textContent = stat;
    row.append(name, st);
    if (f.status === 'done') { const b = document.createElement('button'); b.textContent = '⬇'; b.title = 'Tải SRT ghép'; b.addEventListener('click', () => downloadBatchFile(f)); row.appendChild(b); }
    const del = document.createElement('button'); del.textContent = '✕';
    del.addEventListener('click', () => { if (state.batch.running) return; state.batch.files = state.batch.files.filter((x) => x.id !== f.id); renderBatch(); });
    row.appendChild(del);
    box.appendChild(row);
  });
  $('#batchZipAll').hidden = !state.batch.files.some((f) => f.status === 'done');
}
function downloadBatchFile(f) {
  const angle = f.angles && f.angles[0];
  const segs = angle ? angle.segments.filter((s) => s.valid) : [];
  if (!segs.length) { toast('File này không có đoạn hợp lệ', 'warn'); return; }
  Exporter.download(f.name.replace(/\.srt$/i, '') + '.cut.srt', Exporter.buildSplicedSrt(segs, f.cues), 'application/x-subrip');
}
function handleBatchUpdate(jobId, status, result) {
  const f = state.batch.files.find((x) => x.jobId === jobId);
  if (!f) return;
  if (status === 'running' || status === 'preparing') { f.status = 'running'; renderBatch(); return; }
  if (status === 'done') {
    f.status = 'done'; f.resultText = result.text;
    f.angles = OutputParser.parseAngles(result.text, f.cues);
    f.segCount = f.angles.length ? f.angles[0].segments.filter((s) => s.valid).length : 0;
  } else {
    f.status = 'error'; f.error = (result && (result.message || result.error)) || status;
  }
  renderBatch();
  const w = batchWaiters[jobId]; if (w) { delete batchWaiters[jobId]; w(); }
}
$('#batchRun').addEventListener('click', runBatch);
async function runBatch() {
  if (state.batch.running) return;
  const pending = state.batch.files.filter((f) => f.status === 'pending' || f.status === 'error');
  if (!pending.length) { toast('Không có file nào để chạy', 'warn'); return; }
  state.batch.running = true; state.batch.stopFlag = false;
  $('#batchRun').hidden = true; $('#batchStop').hidden = false;

  const provider = $('#batchProvider').value;
  const blockIds = state.blockIds, platformId = state.platformId;
  const angleCount = Math.max(1, Math.min(5, +$('#angleCount').value || 1));
  const base = $('#tplBody').value;
  const timeout = (+$('#timeoutMin').value || 10) * 60000;

  for (const f of pending) {
    if (state.batch.stopFlag) break;
    f.status = 'running'; f.error = ''; renderBatch();
    const jobId = 'batch_' + f.id; f.jobId = jobId;
    const text = PromptBuilder.buildAnalyze({ srtRaw: f.raw, base, blockIds, platformId, angleCount });
    const done = new Promise((res) => { batchWaiters[jobId] = res; });
    setStatus(`📦 Batch: ${f.name}`);
    const resp = await chrome.runtime.sendMessage({ action: 'srt:runJob', jobId, provider, text, timeout, freshChat: true });
    if (!resp || !resp.ok) { f.status = 'error'; f.error = (resp && resp.error) || 'không gửi được'; renderBatch(); delete batchWaiters[jobId]; continue; }
    await done;
  }
  state.batch.running = false;
  $('#batchRun').hidden = false; $('#batchStop').hidden = true;
  const okCount = state.batch.files.filter((f) => f.status === 'done').length;
  toast(`Batch xong: ${okCount}/${state.batch.files.length} file`, okCount ? 'success' : 'warn', 5000);
}
$('#batchStop').addEventListener('click', async () => {
  state.batch.stopFlag = true;
  const running = state.batch.files.find((f) => f.status === 'running');
  if (running && running.jobId) { try { await chrome.runtime.sendMessage({ action: 'srt:abortJob', jobId: running.jobId }); } catch (_) {} }
});
$('#batchZipAll').addEventListener('click', () => {
  state.batch.files.filter((f) => f.status === 'done').forEach((f, i) => setTimeout(() => downloadBatchFile(f), i * 400));
});
$('#batchClear').addEventListener('click', () => { if (state.batch.running) return; state.batch.files = []; renderBatch(); });

// ---------------------------------------------------------------- run history
async function logHistory({ kind, provider, text, chatUrl }) {
  try {
    const entry = {
      id: 'h_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      ts: Date.now(), kind, provider,
      srtName: state.srtName, cueCount: state.cues.length,
      chars: (text || '').length, srtRaw: state.srtRaw, text, chatUrl: chatUrl || null,
    };
    const { srtHistory = [] } = await chrome.storage.local.get('srtHistory');
    srtHistory.unshift(entry);
    while (srtHistory.length > 20) srtHistory.pop();
    await chrome.storage.local.set({ srtHistory });
  } catch (_) {}
}
async function openHistory() {
  let list = [];
  try { const r = await chrome.storage.local.get('srtHistory'); list = r.srtHistory || []; } catch (_) {}
  renderHistory(list);
}
function renderHistory(list) {
  const box = $('#historyList');
  if (!list.length) { box.innerHTML = '<p class="hint">Chưa có lần chạy nào.</p>'; return; }
  box.innerHTML = '';
  list.forEach((e) => {
    const d = new Date(e.ts);
    const p = (n) => String(n).padStart(2, '0');
    const when = `${p(d.getHours())}:${p(d.getMinutes())} ${d.getDate()}/${d.getMonth() + 1}`;
    const row = document.createElement('div');
    row.className = 'hist-row';
    row.innerHTML = `<div class="hist-main"><b>${escapeHtml(e.provider || '')}</b> · ${escapeHtml(e.srtName || '')} `
      + `<span class="hint">${e.cueCount || 0} cue · ${e.chars || 0} ký tự · ${when}</span></div>`
      + `<div class="hist-act"><button data-a="open">Mở lại</button><button data-a="del">✕</button></div>`;
    row.querySelector('[data-a="open"]').addEventListener('click', () => reopenHistory(e));
    row.querySelector('[data-a="del"]').addEventListener('click', () => delHistory(e.id));
    box.appendChild(row);
  });
}
function reopenHistory(e) {
  if (e.srtRaw) { $('#srtText').value = e.srtRaw; state.srtName = e.srtName || state.srtName; parseSrt(); }
  if (e.text) { state.results[e.provider] = { status: 'done', text: e.text, chatUrl: e.chatUrl || null }; state.activeProvider = e.provider; renderResults(); }
  showView('studio');
  openStage('run');
  toast('Đã mở lại lần chạy', 'success');
}
async function delHistory(id) {
  try {
    const { srtHistory = [] } = await chrome.storage.local.get('srtHistory');
    const next = srtHistory.filter((x) => x.id !== id);
    await chrome.storage.local.set({ srtHistory: next });
    renderHistory(next);
  } catch (_) {}
}
$('#historyClear').addEventListener('click', async () => {
  if (!confirm('Xóa toàn bộ lịch sử?')) return;
  try { await chrome.storage.local.set({ srtHistory: [] }); } catch (_) {}
  renderHistory([]);
});

// ---------------------------------------------------------------- Settings: selector override
const ovState = { overrides: {} };

async function ovLoad() {
  try {
    const { srtSelectorOverrides } = await chrome.storage.local.get('srtSelectorOverrides');
    ovState.overrides = srtSelectorOverrides || {};
  } catch (_) { ovState.overrides = ovState.overrides || {}; }
}
async function ovSaveStore() {
  try { await chrome.storage.local.set({ srtSelectorOverrides: ovState.overrides }); } catch (_) {}
}
function ovEffective(provider, key) {
  const ov = (ovState.overrides[provider] || {})[key];
  if (ov != null) return ov;
  return (SRT_SELECTORS_DEFAULT[provider] || {})[key];
}
function ovToLines(val) {
  if (Array.isArray(val)) return val.join('\n');
  return val == null ? '' : String(val);
}
function ovRender() {
  const p = $('#ovProvider').value;
  const k = $('#ovKey').value;
  $('#ovText').value = ovToLines(ovEffective(p, k));
  const def = (SRT_SELECTORS_DEFAULT[p] || {})[k];
  const overridden = (ovState.overrides[p] || {})[k] != null;
  $('#ovDefaultHint').textContent = (overridden ? '● Đang override. ' : '○ Đang dùng mặc định. ')
    + 'Mặc định: ' + (Array.isArray(def) ? def.join('  |  ') : (def || '(trống)'));
}
async function openSettings() {
  await ovLoad();
  const ps = $('#ovProvider');
  if (!ps.options.length) {
    Object.keys(SRT_SELECTORS_DEFAULT).forEach((p) => { const o = document.createElement('option'); o.value = p; o.textContent = p; ps.appendChild(o); });
    SRT_SELECTOR_KEYS.forEach((k) => { const o = document.createElement('option'); o.value = k; o.textContent = k; $('#ovKey').appendChild(o); });
  }
  ovRender();
  $('#settingsOverlay').hidden = false;
}
$('#hdrSettings').addEventListener('click', openSettings);
$('#settingsClose').addEventListener('click', () => { $('#settingsOverlay').hidden = true; });
$('#settingsOverlay').addEventListener('click', (e) => { if (e.target.id === 'settingsOverlay') $('#settingsOverlay').hidden = true; });
$('#ovProvider').addEventListener('change', ovRender);
$('#ovKey').addEventListener('change', ovRender);

$('#ovSave').addEventListener('click', async () => {
  const p = $('#ovProvider').value, k = $('#ovKey').value;
  const lines = $('#ovText').value.split('\n').map((s) => s.trim()).filter(Boolean);
  ovState.overrides[p] = ovState.overrides[p] || {};
  ovState.overrides[p][k] = SRT_ARRAY_KEYS.indexOf(k) >= 0 ? lines : lines.join(', ');
  await ovSaveStore();
  ovRender();
  setStatus(`Đã lưu override ${p}.${k} — tải lại tab ${p} để áp dụng`);
});
$('#ovReset').addEventListener('click', async () => {
  const p = $('#ovProvider').value, k = $('#ovKey').value;
  if (ovState.overrides[p]) { delete ovState.overrides[p][k]; if (!Object.keys(ovState.overrides[p]).length) delete ovState.overrides[p]; }
  await ovSaveStore();
  ovRender();
});
$('#ovClear').addEventListener('click', async () => {
  if (!confirm('Xóa toàn bộ selector override?')) return;
  ovState.overrides = {};
  await ovSaveStore();
  ovRender();
});

// ---------------------------------------------------------------- section nav (Studio/Prompts/Batch/Lịch sử)
function showView(name) {
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
  $$('#sectionNav button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'prompts') openPrompts();
  else if (name === 'batch') openBatch();
  else if (name === 'history') openHistory();
  else if (name === 'content') { $('#contentProvider').value = state.provider; renderContent(); }
  const c = $('.content'); if (c) c.scrollTop = 0;
}
$$('#sectionNav button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

// ---------------------------------------------------------------- điều khiển phiên
document.getElementById('hdrNewSession').addEventListener('click', newSession);
document.getElementById('sessionRename').addEventListener('click', renameSession);
document.getElementById('sessionDelete').addEventListener('click', deleteSession);
document.getElementById('sessionSelect').addEventListener('change', (e) => switchSession(e.target.value));

// ---------------------------------------------------------------- tooltip styled
(function initTooltips() {
  let tip;
  const ensure = () => { if (!tip) { tip = document.createElement('div'); tip.className = 'tip'; document.body.appendChild(tip); } return tip; };
  function show(el) {
    const t = el.getAttribute('title');
    if (!t) return;
    el.dataset.tipText = t; el.removeAttribute('title'); // chặn tooltip mặc định
    const tp = ensure(); tp.textContent = t;
    tp.style.left = '0px'; tp.style.top = '0px'; tp.classList.add('show');
    const r = el.getBoundingClientRect();
    const tr = tp.getBoundingClientRect();
    let left = Math.max(6, Math.min(r.left + r.width / 2 - tr.width / 2, window.innerWidth - tr.width - 6));
    let top = r.top - tr.height - 8;
    if (top < 4) top = r.bottom + 8;
    tp.style.left = left + 'px'; tp.style.top = top + 'px';
  }
  function hide(el) {
    if (el && el.dataset.tipText) { el.setAttribute('title', el.dataset.tipText); delete el.dataset.tipText; }
    if (tip) tip.classList.remove('show');
  }
  document.addEventListener('mouseover', (e) => { const el = e.target.closest('[title]'); if (el) show(el); });
  document.addEventListener('mouseout', (e) => { const el = e.target.closest('[data-tip-text]') || (e.target.dataset && e.target.dataset.tipText ? e.target : null); if (el && !el.contains(e.relatedTarget)) hide(el); });
  document.addEventListener('click', () => { if (tip) tip.classList.remove('show'); });
})();

// ---------------------------------------------------------------- init
initKnowledge();
initTemplates();
initRepurpose();
initContent();
restoreContent();
consumeQuickPending();
updateLocks();
restoreProject();

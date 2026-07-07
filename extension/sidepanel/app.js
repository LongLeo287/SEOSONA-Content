// SRT Studio — side panel controller
/* global SrtLib, OutputParser, Exporter, PROMPT_TEMPLATES, PromptBuilder, Knowledge */

const state = {
  srtRaw: '',
  srtName: 'source.srt',
  cues: [],
  results: {},        // provider -> { status, text, error, jobId }  (kết quả phân tích)
  activeProvider: null,
  angles: [],         // [{ title, segments }] — nhiều góc cắt
  activeAngle: 0,
  segmentSource: '',  // provider tạo ra angles
  blockIds: [],       // knowledge blocks đang bật
  platformId: 'none',
  metadata: null,     // { title, description, hashtags, thumbnail, raw }
  review: {},         // provider -> { status, text, scores }
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function setStatus(msg) {
  const el = document.getElementById('statusText');
  if (el) el.textContent = msg;
}

function currentSegments() {
  const a = state.angles[state.activeAngle];
  return a ? a.segments : [];
}
function validSegments() {
  return currentSegments().filter((s) => s.valid);
}

// ---------------------------------------------------------------- tabs
$$('#tabs button').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('#tabs button').forEach((b) => b.classList.remove('active'));
    $$('.tab').forEach((t) => t.classList.remove('active'));
    btn.classList.add('active');
    $('#tab-' + btn.dataset.tab).classList.add('active');
  });
});
function gotoTab(name) { $(`#tabs button[data-tab="${name}"]`).click(); }

// ---------------------------------------------------------------- persist
async function saveProject() {
  await chrome.storage.local.set({
    srtProject: {
      srtRaw: state.srtRaw, srtName: state.srtName,
      results: state.results, angles: state.angles, activeAngle: state.activeAngle,
      segmentSource: state.segmentSource, blockIds: state.blockIds,
      platformId: state.platformId, metadata: state.metadata,
      savedAt: Date.now(),
    },
  });
}

async function restoreProject() {
  const { srtProject } = await chrome.storage.local.get('srtProject');
  if (!srtProject) return;
  Object.assign(state, {
    srtRaw: srtProject.srtRaw || '',
    srtName: srtProject.srtName || 'source.srt',
    results: srtProject.results || {},
    angles: srtProject.angles || [],
    activeAngle: srtProject.activeAngle || 0,
    segmentSource: srtProject.segmentSource || '',
    blockIds: srtProject.blockIds || state.blockIds,
    platformId: srtProject.platformId || 'none',
    metadata: srtProject.metadata || null,
  });
  if (state.srtRaw) { $('#srtText').value = state.srtRaw; parseSrt(false); }
  syncKnowledgeUI();
  $('#platformSelect').value = state.platformId;
  renderResults();
  renderAngles();
  renderSegments();
  renderMetadata();
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
  if (save) saveProject();
}
$('#btnParse').addEventListener('click', () => parseSrt());
$('#dropZone').addEventListener('click', () => $('#srtFile').click());
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
  const sel = $('#platformSelect');
  sel.innerHTML = '';
  for (const [id, p] of Object.entries(Knowledge.PLATFORMS)) {
    const opt = document.createElement('option');
    opt.value = id; opt.textContent = p.name;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => { state.platformId = sel.value; saveProject(); });
}
function syncKnowledgeUI() {
  $$('#knowledgeChecks input').forEach((i) => { i.checked = state.blockIds.includes(i.value); });
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
  sel.addEventListener('change', () => { $('#tplBody').value = PROMPT_TEMPLATES[sel.value].body; });
  $('#tplBody').value = PROMPT_TEMPLATES[sel.value].body;
}

// ---------------------------------------------------------------- TAB 2: RUN
function checkedProviders(sel) { return $$(sel + ' input:checked').map((i) => i.value); }

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

$('#btnRun').addEventListener('click', async () => {
  if (!state.cues.length) { alert('Chưa nạp SRT (tab 1).'); return; }
  const providers = checkedProviders('#providerChecks');
  if (!providers.length) { alert('Chọn ít nhất 1 AI.'); return; }

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
    const jobId = `analyze_${provider}_${Date.now()}`;
    state.results[provider] = { status: 'running', jobId };
    const resp = await chrome.runtime.sendMessage({ action: 'srt:runJob', jobId, provider, text, timeout, freshChat });
    if (!resp || !resp.ok) {
      state.results[provider] = { status: 'error', error: (resp && resp.error) || 'Không gửi được job' };
      updateJobRow(provider, 'error', state.results[provider].error);
    }
  }
  refreshRunButtons();
});

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
  $('#btnAbort').hidden = !running;
  if (running) {
    const n = Object.values(state.results).filter((r) => r.status === 'running' || r.status === 'preparing').length;
    setStatus(`⏳ Đang chạy ${n} AI…`);
  } else if (Object.values(state.results).some((r) => r.text)) {
    setStatus('✅ Phân tích xong');
  }
}

// ---------------------------------------------------------------- message hub
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.action !== 'srt:jobUpdate') return;
    const { jobId, provider, status, result } = msg;
    if (!jobId) return;
    if (jobId.startsWith('review_')) return handleReviewUpdate(provider, status, result);
    if (jobId.startsWith('meta_')) return handleMetaUpdate(status, result);
    if (jobId.startsWith('analyze_')) return handleAnalyzeUpdate(provider, status, result, jobId);
  });
}

function handleAnalyzeUpdate(provider, status, result, jobId) {
  if (!provider) return;
  if (status === 'running' || status === 'preparing') {
    updateJobRow(provider, status, status === 'running' ? 'AI đang xử lý…' : 'đang mở tab…');
    return;
  }
  if (status === 'done') {
    state.results[provider] = { status: 'done', text: result.text, jobId };
    updateJobRow(provider, 'done', `xong (${Math.round((result.elapsedMs || 0) / 1000)}s, ${result.text.length} ký tự)`);
  } else {
    state.results[provider] = { status, error: (result && (result.message || result.error)) || status, text: result && result.text };
    updateJobRow(provider, 'error', state.results[provider].error);
  }
  refreshRunButtons();
  renderResults();
  saveProject();
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
    b.addEventListener('click', () => { state.activeProvider = provider; renderResults(); });
    tabs.appendChild(b);
  }
  $('#rawResponse').textContent = state.results[state.activeProvider].text || '';
}

$('#btnUseResult').addEventListener('click', () => {
  const r = state.results[state.activeProvider];
  if (!r || !r.text) return;
  const angles = OutputParser.parseAngles(r.text, state.cues);
  if (!angles.length) {
    alert('Không tìm thấy bảng cắt ghép hợp lệ trong kết quả. Kiểm tra output có đúng định dạng bảng markdown không.');
    return;
  }
  state.angles = angles;
  state.activeAngle = 0;
  state.segmentSource = state.activeProvider;
  state.metadata = null;
  renderAngles();
  renderSegments();
  renderMetadata();
  saveProject();
  gotoTab('edit');
});

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
    $('#editSummary').textContent = 'Chưa có bảng cắt ghép. Chạy phân tích ở tab 2 rồi bấm "Dựng bảng cắt ghép".';
    return;
  }
  const totalMs = segs.reduce((s, seg) => s + segDuration(seg), 0);
  const mismatch = segs.filter((s) => s.valid && !s.textMatch).length;
  const invalid = segs.filter((s) => !s.valid).length;
  $('#editSummary').textContent =
    `${segs.length} đoạn · tổng ${(totalMs / 1000).toFixed(1)}s · nguồn: ${state.segmentSource}` +
    (mismatch ? ` · ⚠ ${mismatch} đoạn lệch text` : '') +
    (invalid ? ` · ❌ ${invalid} đoạn không khớp timecode` : '');

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
$('#btnMeta').addEventListener('click', async () => {
  if (!validSegments().length) { alert('Chưa có bảng cắt ghép.'); return; }
  const provider = $('#metaProvider').value;
  const script = Exporter.buildMarkdown(validSegments(), state.cues, { provider: state.segmentSource });
  const text = PROMPT_TEMPLATES.metadata.body.replace('{{SCRIPT}}', script);
  const jobId = `meta_${provider}_${Date.now()}`;
  $('#btnMeta').disabled = true;
  $('#metaStatus').innerHTML = jobRow(provider, 'preparing', 'đang gửi…');
  const resp = await chrome.runtime.sendMessage({ action: 'srt:runJob', jobId, provider, text, timeout: 300000, freshChat: true });
  if (!resp || !resp.ok) { $('#metaStatus').innerHTML = jobRow(provider, 'error', (resp && resp.error) || 'lỗi'); $('#btnMeta').disabled = false; }
});

function handleMetaUpdate(status, result) {
  const row = $('#metaStatus .job');
  if (row) {
    row.className = 'job ' + (status === 'done' ? 'done' : status);
    row.querySelector('.hint').textContent = status === 'done' ? 'xong'
      : status === 'running' ? 'AI đang viết…' : (result && (result.message || result.error)) || status;
  }
  if (status === 'done' || status === 'error') {
    $('#btnMeta').disabled = false;
    if (result && result.text) { state.metadata = OutputParser.parseMetadata(result.text); renderMetadata(); saveProject(); }
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

// ---------------------------------------------------------------- TAB 4: REVIEW (multi-AI + consensus)
$('#btnReview').addEventListener('click', async () => {
  if (!validSegments().length) { alert('Chưa có bảng cắt ghép (tab 3).'); return; }
  const providers = checkedProviders('#reviewChecks');
  if (!providers.length) { alert('Chọn ít nhất 1 AI.'); return; }
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
    if (!resp || !resp.ok) { state.review[provider] = { status: 'error' }; updateJobRow(provider, 'error', (resp && resp.error) || 'lỗi', $('#reviewStatus')); }
  }
});

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
}

function renderReviewScores() {
  const done = Object.entries(state.review).filter(([, r]) => r.scores && r.scores.criteria.length);
  $('#reviewScoreCard').hidden = done.length === 0;
  if (!done.length) return;

  // gộp theo tiêu chí (consensus trung bình nhiều AI)
  const agg = {};
  for (const [provider, r] of done) {
    for (const c of r.scores.criteria) {
      const key = c.name.toLowerCase().replace(/\s+/g, ' ').trim();
      (agg[key] = agg[key] || { name: c.name, byProv: {} }).byProv[provider] = c.score / c.max * 10;
    }
  }
  const rows = Object.values(agg).map((a) => {
    const vals = Object.values(a.byProv);
    const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
    return { name: a.name, avg, byProv: a.byProv };
  });
  const overall = rows.length ? (rows.reduce((s, r) => s + r.avg, 0) / rows.length) : 0;

  const provList = done.map(([p]) => p);
  const barColor = (v) => v >= 8 ? 'var(--ok)' : v >= 6 ? 'var(--warn)' : 'var(--err)';
  const verdicts = done.map(([p, r]) => r.scores.verdict).filter(Boolean);

  let html = `<div class="overall">Tổng consensus: <b>${overall.toFixed(1)}/10</b> · ${provList.join(', ')}`;
  if (verdicts.length) html += ` · ${escapeHtml(verdicts[0])}`;
  html += '</div>';
  for (const r of rows) {
    const detail = provList.map((p) => r.byProv[p] != null ? `${p}:${r.byProv[p].toFixed(0)}` : '').filter(Boolean).join(' · ');
    html += `<div class="score">
      <div class="score-head"><span>${escapeHtml(r.name)}</span><b>${r.avg.toFixed(1)}</b></div>
      <div class="bar"><i style="width:${r.avg * 10}%;background:${barColor(r.avg)}"></i></div>
      <div class="hint">${escapeHtml(detail)}</div></div>`;
  }
  $('#reviewScores').innerHTML = html;
  $('#reviewResult').textContent = done.map(([p, r]) => `===== ${p} =====\n${r.text}`).join('\n\n');
}

// ---------------------------------------------------------------- init
initKnowledge();
initTemplates();
restoreProject();

// SRT Studio — side panel controller
/* global SrtLib, OutputParser, Exporter, PROMPT_TEMPLATES */

const state = {
  srtRaw: '',
  srtName: 'source.srt',
  cues: [],
  results: {},        // provider -> { status, text, error, jobId }
  activeProvider: null,
  segments: [],       // bảng cắt ghép hiện tại
  segmentSource: '',  // provider tạo ra segments
  reviewJobId: null,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

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
      srtRaw: state.srtRaw,
      srtName: state.srtName,
      results: state.results,
      segments: state.segments,
      segmentSource: state.segmentSource,
      savedAt: Date.now(),
    },
  });
}

async function restoreProject() {
  const { srtProject } = await chrome.storage.local.get('srtProject');
  if (!srtProject) return;
  state.srtRaw = srtProject.srtRaw || '';
  state.srtName = srtProject.srtName || 'source.srt';
  state.results = srtProject.results || {};
  state.segments = srtProject.segments || [];
  state.segmentSource = srtProject.segmentSource || '';
  if (state.srtRaw) {
    $('#srtText').value = state.srtRaw;
    parseSrt(false);
  }
  renderResults();
  renderSegments();
}

// ---------------------------------------------------------------- TAB 1: SRT
function parseSrt(save = true) {
  const raw = $('#srtText').value;
  const cues = SrtLib.parse(raw);
  if (!cues.length) {
    $('#srtInfo').textContent = '⚠ Không parse được cue nào. Kiểm tra định dạng SRT.';
    return;
  }
  state.srtRaw = raw;
  state.cues = cues;
  const dur = cues[cues.length - 1].end;
  $('#srtInfo').textContent =
    `✅ ${state.srtName} — ${cues.length} cue` +
    ` · thời lượng nguồn ${SrtLib.msToTime(dur).slice(0, 8)}` +
    ` · tổng thời gian nói ${(SrtLib.totalDuration(cues) / 1000).toFixed(0)}s`;
  if (save) saveProject();
}

$('#btnParse').addEventListener('click', () => parseSrt());

$('#dropZone').addEventListener('click', () => $('#srtFile').click());
$('#srtFile').addEventListener('change', (e) => loadFile(e.target.files[0]));
$('#dropZone').addEventListener('dragover', (e) => { e.preventDefault(); $('#dropZone').classList.add('dragover'); });
$('#dropZone').addEventListener('dragleave', () => $('#dropZone').classList.remove('dragover'));
$('#dropZone').addEventListener('drop', (e) => {
  e.preventDefault();
  $('#dropZone').classList.remove('dragover');
  loadFile(e.dataTransfer.files[0]);
});

function loadFile(file) {
  if (!file) return;
  state.srtName = file.name;
  const reader = new FileReader();
  reader.onload = () => {
    $('#srtText').value = reader.result;
    parseSrt();
  };
  reader.readAsText(file, 'utf-8');
}

// ---------------------------------------------------------------- TAB 2: RUN
function initTemplates() {
  const sel = $('#tplSelect');
  sel.innerHTML = '';
  for (const [key, tpl] of Object.entries(PROMPT_TEMPLATES)) {
    if (tpl.kind !== 'analyze') continue;
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = tpl.name;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => { $('#tplBody').value = PROMPT_TEMPLATES[sel.value].body; });
  $('#tplBody').value = PROMPT_TEMPLATES[sel.value].body;
}

function checkedProviders() {
  return $$('#providerChecks input:checked').map((i) => i.value);
}

function jobRow(provider, status, msg = '') {
  return `<div class="job ${status}" data-provider="${provider}">
    <span class="dot"></span>
    <strong>${provider}</strong>
    <span class="hint">${msg || status}</span>
  </div>`;
}

$('#btnRun').addEventListener('click', async () => {
  if (!state.cues.length) { alert('Chưa nạp SRT (tab 1).'); return; }
  const providers = checkedProviders();
  if (!providers.length) { alert('Chọn ít nhất 1 AI.'); return; }

  const promptBody = $('#tplBody').value;
  const text = promptBody.replace('{{SRT}}', state.srtRaw);
  const timeout = (+$('#timeoutMin').value || 10) * 60000;
  const freshChat = $('#freshChat').checked;

  $('#btnRun').disabled = true;
  $('#btnAbort').hidden = false;
  $('#jobStatus').innerHTML = providers.map((p) => jobRow(p, 'preparing', 'đang chuẩn bị…')).join('');

  for (const provider of providers) {
    const jobId = `analyze_${provider}_${Date.now()}`;
    state.results[provider] = { status: 'running', jobId };
    const resp = await chrome.runtime.sendMessage({
      action: 'srt:runJob', jobId, provider, text, timeout, freshChat,
    });
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

function updateJobRow(provider, status, msg) {
  const el = document.querySelector(`.job[data-provider="${provider}"]`);
  if (!el) return;
  el.className = 'job ' + status;
  el.querySelector('.hint').textContent = msg || status;
}

function refreshRunButtons() {
  const running = Object.values(state.results).some((r) => r.status === 'running' || r.status === 'preparing');
  $('#btnRun').disabled = running;
  $('#btnAbort').hidden = !running;
}

// nhận kết quả job từ background
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.action !== 'srt:jobUpdate') return;
  const { jobId, provider, status, result } = msg;

  if (jobId && jobId.startsWith('review_')) {
    handleReviewUpdate(status, result);
    return;
  }
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
});

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
  const segments = OutputParser.parse(r.text, state.cues);
  if (!segments.length) {
    alert('Không tìm thấy bảng cắt ghép hợp lệ trong kết quả. Kiểm tra output của AI có đúng định dạng bảng markdown không.');
    return;
  }
  state.segments = segments;
  state.segmentSource = state.activeProvider;
  renderSegments();
  saveProject();
  gotoTab('edit');
});

// ---------------------------------------------------------------- TAB 3: EDIT
function segDuration(seg) {
  const byIndex = new Map(state.cues.map((c) => [c.index, c]));
  return seg.cueIndexes.reduce((s, i) => {
    const c = byIndex.get(i);
    return s + (c ? c.end - c.start : 0);
  }, 0);
}

function renderSegments() {
  const list = $('#segmentList');
  list.innerHTML = '';
  if (!state.segments.length) {
    $('#editSummary').textContent = 'Chưa có bảng cắt ghép. Chạy phân tích ở tab 2 rồi bấm "Dựng bảng cắt ghép".';
    return;
  }
  const totalMs = state.segments.reduce((s, seg) => s + segDuration(seg), 0);
  const mismatch = state.segments.filter((s) => s.valid && !s.textMatch).length;
  const invalid = state.segments.filter((s) => !s.valid).length;
  $('#editSummary').textContent =
    `${state.segments.length} đoạn · tổng ${(totalMs / 1000).toFixed(1)}s` +
    ` · nguồn: ${state.segmentSource}` +
    (mismatch ? ` · ⚠ ${mismatch} đoạn lệch text` : '') +
    (invalid ? ` · ❌ ${invalid} đoạn không khớp timecode` : '');

  const byIndex = new Map(state.cues.map((c) => [c.index, c]));

  state.segments.forEach((seg, i) => {
    const cues = seg.cueIndexes.map((x) => byIndex.get(x)).filter(Boolean);
    const div = document.createElement('div');
    div.className = 'seg' + (!seg.valid ? ' invalid' : (!seg.textMatch ? ' mismatch' : ''));
    const tc = cues.length
      ? `${SrtLib.msToTime(cues[0].start)} → ${SrtLib.msToTime(cues[cues.length - 1].end)}`
      : '(không khớp timecode nào trong SRT gốc)';
    const badge = !seg.valid
      ? '<span class="badge err">không khớp</span>'
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
      ${seg.note ? `<div class="seg-note">${escapeHtml(seg.note)}</div>` : ''}
    `;
    div.querySelector('[data-act="up"]').addEventListener('click', () => moveSeg(i, -1));
    div.querySelector('[data-act="down"]').addEventListener('click', () => moveSeg(i, 1));
    div.querySelector('[data-act="del"]').addEventListener('click', () => { state.segments.splice(i, 1); renderSegments(); saveProject(); });
    list.appendChild(div);
  });
}

function moveSeg(i, delta) {
  const j = i + delta;
  if (j < 0 || j >= state.segments.length) return;
  const [seg] = state.segments.splice(i, 1);
  state.segments.splice(j, 0, seg);
  renderSegments();
  saveProject();
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function validSegments() {
  return state.segments.filter((s) => s.valid);
}

function baseName() {
  return state.srtName.replace(/\.srt$/i, '');
}

$('#btnExportSrt').addEventListener('click', () => {
  if (!requireSegments()) return;
  Exporter.download(baseName() + '.cut.srt', Exporter.buildSplicedSrt(validSegments(), state.cues), 'application/x-subrip');
});
$('#btnExportCsv').addEventListener('click', () => {
  if (!requireSegments()) return;
  Exporter.download(baseName() + '.cutlist.csv', Exporter.buildCsv(validSegments(), state.cues), 'text/csv');
});
$('#btnExportEdl').addEventListener('click', () => {
  if (!requireSegments()) return;
  const fps = +$('#edlFps').value || 30;
  const clipName = $('#edlClip').value || 'SOURCE.MP4';
  Exporter.download(baseName() + '.edl', Exporter.buildEdl(validSegments(), state.cues, { fps, clipName, title: baseName().toUpperCase() }), 'text/plain');
});
$('#btnExportMd').addEventListener('click', () => {
  if (!requireSegments()) return;
  Exporter.download(baseName() + '.script.md', Exporter.buildMarkdown(validSegments(), state.cues, { provider: state.segmentSource }), 'text/markdown');
});
$('#btnExportJson').addEventListener('click', () => {
  Exporter.download(baseName() + '.project.json', Exporter.buildProjectJson({
    srtName: state.srtName, srtRaw: state.srtRaw, segments: state.segments, segmentSource: state.segmentSource,
  }), 'application/json');
});

function requireSegments() {
  if (!validSegments().length) { alert('Chưa có đoạn hợp lệ nào để xuất.'); return false; }
  return true;
}

// ---------------------------------------------------------------- TAB 4: REVIEW
$('#btnReview').addEventListener('click', async () => {
  if (!validSegments().length) { alert('Chưa có bảng cắt ghép (tab 3).'); return; }
  const provider = $('#reviewProvider').value;
  const script = Exporter.buildMarkdown(validSegments(), state.cues, { provider: state.segmentSource });
  const text = PROMPT_TEMPLATES.evaluate.body.replace('{{SCRIPT}}', script);
  const jobId = `review_${provider}_${Date.now()}`;
  state.reviewJobId = jobId;

  $('#btnReview').disabled = true;
  $('#reviewStatus').innerHTML = jobRow(provider, 'preparing', 'đang gửi…');
  $('#reviewResult').textContent = '';

  const resp = await chrome.runtime.sendMessage({
    action: 'srt:runJob', jobId, provider, text, timeout: 600000, freshChat: true,
  });
  if (!resp || !resp.ok) {
    $('#reviewStatus').innerHTML = jobRow(provider, 'error', (resp && resp.error) || 'lỗi');
    $('#btnReview').disabled = false;
  }
});

function handleReviewUpdate(status, result) {
  const row = $('#reviewStatus .job');
  if (row) {
    row.className = 'job ' + (status === 'done' ? 'done' : status);
    row.querySelector('.hint').textContent =
      status === 'done' ? 'xong' :
      status === 'running' ? 'AI đang chấm điểm…' :
      (result && (result.message || result.error)) || status;
  }
  if (status === 'done' || status === 'error') {
    $('#btnReview').disabled = false;
    if (result && result.text) $('#reviewResult').textContent = result.text;
  }
}

// ---------------------------------------------------------------- init
initTemplates();
restoreProject();

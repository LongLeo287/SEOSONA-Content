import { el, card, empty, field, verbatim, notice } from '../dom.mjs';

// Màn transcript: nạp SRT, xem bảng cue, chạy thao tác, đối chiếu nguồn.
//
// Chữ nguyên văn và chữ đã dọn hiển thị TÁCH BẠCH và không bao giờ trộn vào nhau. Trộn lại
// thì người dùng mất khả năng phân biệt điều người nói đã nói với điều hệ thống nghĩ họ nói —
// và đó chính là thứ một bản cắt video phải giữ đúng.

/** Bảng cue — chữ giữ NGUYÊN VĂN, không cắt khoảng trắng, không sửa chính tả. */
export function cueTableModel(cues, { error = null } = {}) {
  if (error) return { state: 'error', code: error.code, message: error.message, rows: [] };
  if (!cues || !cues.length) return { state: 'empty', hint: 'Chưa nạp transcript nào.', rows: [] };
  return {
    state: 'data',
    durationMs: cues[cues.length - 1].endMs,
    rows: cues.map((cue) => ({
      cueId: cue.cueId,
      index: cue.index,
      startMs: cue.startMs,
      endMs: cue.endMs,
      // KHÔNG trim, KHÔNG normalize: đây là trường chính thức.
      rawText: cue.rawText,
      timecode: `${formatMs(cue.startMs)} → ${formatMs(cue.endMs)}`,
    })),
  };
}

export function formatMs(ms) {
  const value = Math.max(0, Math.round(Number(ms) || 0));
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `${pad(Math.floor(value / 3600000))}:${pad(Math.floor((value % 3600000) / 60000))}:${pad(Math.floor((value % 60000) / 1000))},${pad(value % 1000, 3)}`;
}

export async function render({ api, state }) {
  const projectId = state.selectedProjectId;
  if (!projectId) return el('section', {}, [el('h1', { text: 'Transcript' }), empty('Chọn một dự án trước.')]);

  const srtInput = el('textarea', { placeholder: 'Dán nội dung .srt vào đây' });
  const feedback = el('div');
  const cueArea = el('div');

  function showCues(model) {
    if (model.state !== 'data') {
      cueArea.replaceChildren(empty(model.state === 'error' ? `${model.code} — ${model.message}` : model.hint));
      return;
    }
    cueArea.replaceChildren(
      el('p', { class: 'muted', text: `${model.rows.length} cue · tổng ${formatMs(model.durationMs)}` }),
      el('table', {}, [
        el('thead', {}, el('tr', {}, [
          el('th', { text: '#' }), el('th', { text: 'Timecode' }), el('th', { text: 'Lời thoại nguyên văn' }),
        ])),
        // Mỗi ô chữ dựng bằng textContent qua verbatim(): transcript là chữ từ nguồn ngoài,
        // và một lần dùng innerHTML ở đây là một lần cho phép file nguồn viết HTML vào Studio.
        el('tbody', {}, model.rows.map((row) => el('tr', {}, [
          el('td', { text: String(row.index) }),
          el('td', { class: 'verbatim', text: row.timecode }),
          el('td', {}, verbatim(row.rawText)),
        ]))),
      ]),
    );
  }

  const loadButton = el('button', {
    class: 'primary',
    text: 'Nạp transcript',
    onclick: async () => {
      loadButton.disabled = true;
      feedback.replaceChildren(notice('info', 'Đang lưu nguồn…'));
      try {
        const result = await api.addTranscript(projectId, { srt: srtInput.value });
        showCues(cueTableModel(result.cues));
        feedback.replaceChildren(notice('info', `Đã lưu nguồn ${result.sourceId} · sha256 ${result.sha256.slice(0, 12)}…`));
      } catch (error) {
        feedback.replaceChildren(notice('error', `${error.code} — ${error.message}`));
      }
      loadButton.disabled = false;
    },
  });

  return el('section', {}, [
    el('h1', { text: 'Transcript' }),
    el('p', { class: 'muted', text: 'Lời thoại và mốc thời gian hiển thị đúng như trong file, kể cả lỗi chính tả. Chữ đã dọn là một lớp riêng.' }),
    card([field('Nội dung .srt', srtInput), loadButton, feedback]),
    card([cueArea]),
  ]);
}

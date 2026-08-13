// Đọc/ghi SRT trong Runtime.
//
// Bất biến trung tâm: `rawText` và timecode là NGUYÊN VĂN. Không sửa chính tả, không gộp
// dòng, không cắt khoảng trắng, không làm tròn thời gian — kể cả khi biết chắc nguồn sai.
//
// Vì sao khắt khe đến vậy: một bản cắt video được dựng từ những con số này. Lệch 1 mili-giây
// là hình bị hụt; sửa một chữ viết sai là lời thoại không còn khớp với miệng người nói. Và
// kiểu hỏng này không ai phát hiện lúc đọc — chỉ lúc dựng xong mới thấy.
//
// Parser cũ ở extension/lib/srt-parser.js cắt khoảng trắng đầu/cuối mỗi dòng. Với side panel
// thì vô hại, nhưng ở đây đó là một phép CHUẨN HÓA, nên bản này cố ý không làm. Chuẩn hóa vẫn
// tồn tại (normalizeForMatching) nhưng chỉ dùng để ĐỐI CHIẾU, không bao giờ là đầu ra chính thức.

const TIME_RE = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;
const CUE_LINE_RE = /(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})/;

export function timeToMs(value) {
  const m = TIME_RE.exec(String(value ?? ''));
  if (!m) return null;
  // ",5" nghĩa là 500ms chứ không phải 5ms — pad bên phải, không parse thẳng.
  return (+m[1]) * 3600000 + (+m[2]) * 60000 + (+m[3]) * 1000 + Number(m[4].padEnd(3, '0'));
}

export function msToTime(ms) {
  const value = Math.max(0, Math.round(Number(ms) || 0));
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `${pad(Math.floor(value / 3600000))}:${pad(Math.floor((value % 3600000) / 60000))}:${pad(Math.floor((value % 60000) / 1000))},${pad(value % 1000, 3)}`;
}

/** Chỉ dùng để so khớp. KHÔNG bao giờ ghi kết quả của hàm này vào trường nguyên văn. */
export function normalizeForMatching(value) {
  return String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** @returns {Array<{cueId: string, index: number, startMs: number, endMs: number, rawText: string}>} */
export function parseSrt(raw) {
  if (!raw) return [];
  // Chỉ hai phép chuẩn hóa được phép, và cả hai đều không đổi nội dung:
  // bỏ BOM, và quy CRLF về LF để tách khối cho đúng.
  const text = String(raw).replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const cues = [];

  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split('\n');
    // Bỏ dòng trống ở hai đầu khối, nhưng KHÔNG đụng vào các dòng bên trong.
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    if (!lines.length) continue;

    let cursor = /^\d+$/.test(lines[0].trim()) ? 1 : 0;
    const timing = CUE_LINE_RE.exec(lines[cursor] || '');
    if (!timing) continue;

    const startMs = timeToMs(timing[1]);
    const endMs = timeToMs(timing[2]);
    if (startMs === null || endMs === null) continue;

    const index = cues.length + 1;
    cues.push({
      // cueId tất định theo thứ tự trong file: cùng một file luôn cho cùng một bộ id,
      // nên một bản cắt lưu hôm nay vẫn giải được vào ngày mai.
      cueId: `cue_${String(index).padStart(4, '0')}`,
      index,
      startMs,
      endMs,
      rawText: lines.slice(cursor + 1).join('\n'),
    });
  }

  return cues;
}

export function serializeSrt(cues) {
  return `${(cues || [])
    .map((cue, i) => `${i + 1}\n${msToTime(cue.startMs)} --> ${msToTime(cue.endMs)}\n${cue.rawText}`)
    .join('\n\n')}\n`;
}

export function totalDurationMs(cues) {
  return (cues || []).reduce((sum, cue) => sum + (cue.endMs - cue.startMs), 0);
}

/**
 * Cổng đối chiếu cuối cùng trước khi một bản cắt được chấp nhận.
 *
 * Mọi cueId phải giải ngược về transcript, và start/end/rawText phải khớp CHÍNH XÁC.
 * Không có ngưỡng dung sai: một timecode "gần đúng" là một bản cắt lệch khỏi video, và
 * một câu đã được "dọn cho gọn" là lời thoại không còn khớp với người nói.
 *
 * Chọn cue không theo thứ tự thì được — đó là biên tập. Đổi nội dung thì không.
 */
export function validateTranscriptSelection({ cues = [], selections = [] } = {}) {
  const byId = new Map(cues.map((c) => [c.cueId, c]));
  const issues = [];

  for (const [selectionIndex, selection] of selections.entries()) {
    const cueIds = selection?.cueIds || [];
    if (!cueIds.length) {
      issues.push({ code: 'EMPTY_SELECTION', selectionIndex, repairAction: 'HUMAN_REVIEW' });
      continue;
    }

    const resolved = cueIds.map((id) => byId.get(id));
    const missingIndex = resolved.findIndex((cue) => !cue);
    if (missingIndex >= 0) {
      issues.push({ code: 'UNKNOWN_CUE', selectionIndex, cueId: cueIds[missingIndex], repairAction: 'RESTORE_SOURCE_FACT' });
      continue;
    }

    const expectedStart = resolved[0].startMs;
    const expectedEnd = resolved[resolved.length - 1].endMs;
    const expectedText = resolved.map((cue) => cue.rawText).join('\n');

    if (selection.sourceStartMs !== expectedStart) {
      issues.push({ code: 'TRANSCRIPT_SOURCE_MISMATCH', selectionIndex, field: 'sourceStartMs', expected: expectedStart, actual: selection.sourceStartMs, repairAction: 'RESTORE_SOURCE_FACT' });
      continue;
    }
    if (selection.sourceEndMs !== expectedEnd) {
      issues.push({ code: 'TRANSCRIPT_SOURCE_MISMATCH', selectionIndex, field: 'sourceEndMs', expected: expectedEnd, actual: selection.sourceEndMs, repairAction: 'RESTORE_SOURCE_FACT' });
      continue;
    }
    if (selection.rawTranscript !== expectedText) {
      issues.push({ code: 'TRANSCRIPT_SOURCE_MISMATCH', selectionIndex, field: 'rawTranscript', repairAction: 'RESTORE_SOURCE_FACT' });
    }
  }

  return { ok: issues.length === 0, issues };
}

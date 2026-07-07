// SRT Studio — xuất kết quả cắt ghép: SRT ghép, CSV cut-list, EDL (CMX3600), Markdown

const Exporter = (() => {
  // Segments -> danh sách cue nguồn theo thứ tự đã sắp xếp
  function segmentsToCues(segments, sourceCues) {
    const byIndex = new Map(sourceCues.map((c) => [c.index, c]));
    const cues = [];
    for (const seg of segments) {
      for (const idx of seg.cueIndexes) {
        const c = byIndex.get(idx);
        if (c) cues.push({ ...c, segLabel: seg.label });
      }
    }
    return cues;
  }

  // SRT mới: giữ nguyên duration từng cue, timeline chạy liên tục từ 0
  function buildSplicedSrt(segments, sourceCues) {
    const cues = segmentsToCues(segments, sourceCues);
    let t = 0;
    const out = cues.map((c) => {
      const dur = c.end - c.start;
      const cue = { start: t, end: t + dur, text: c.text };
      t += dur;
      return cue;
    });
    return SrtLib.serialize(out);
  }

  function csvEscape(v) {
    v = String(v ?? '');
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }

  function buildCsv(segments, sourceCues) {
    const rows = [['#', 'Segment', 'Cue', 'Source In', 'Source Out', 'Duration (s)', 'Text']];
    let n = 0;
    for (const seg of segments) {
      const byIndex = new Map(sourceCues.map((c) => [c.index, c]));
      for (const idx of seg.cueIndexes) {
        const c = byIndex.get(idx);
        if (!c) continue;
        n += 1;
        rows.push([
          n, seg.label, c.index,
          SrtLib.msToTime(c.start), SrtLib.msToTime(c.end),
          ((c.end - c.start) / 1000).toFixed(2),
          c.text.replace(/\n/g, ' '),
        ]);
      }
    }
    return '﻿' + rows.map((r) => r.map(csvEscape).join(',')).join('\r\n');
  }

  // EDL CMX3600 — import được vào Premiere / Resolve.
  // Mỗi cue nguồn = 1 event, record timeline nối liên tục.
  function buildEdl(segments, sourceCues, { fps = 30, title = 'SRT STUDIO CUT', clipName = 'SOURCE.MP4' } = {}) {
    const cues = segmentsToCues(segments, sourceCues);
    const lines = [`TITLE: ${title}`, 'FCM: NON-DROP FRAME', ''];
    let rec = 0;
    cues.forEach((c, i) => {
      const dur = c.end - c.start;
      const num = String(i + 1).padStart(3, '0');
      lines.push(
        `${num}  AX       AA/V  C        ` +
        `${SrtLib.msToTimecode(c.start, fps)} ${SrtLib.msToTimecode(c.end, fps)} ` +
        `${SrtLib.msToTimecode(rec, fps)} ${SrtLib.msToTimecode(rec + dur, fps)}`
      );
      lines.push(`* FROM CLIP NAME: ${clipName}`);
      lines.push(`* COMMENT: [${c.segLabel || ''}] ${c.text.replace(/\n/g, ' ')}`);
      lines.push('');
      rec += dur;
    });
    return lines.join('\r\n');
  }

  function buildMarkdown(segments, sourceCues, meta = {}) {
    const byIndex = new Map(sourceCues.map((c) => [c.index, c]));
    const lines = ['# Kịch bản cắt ghép' + (meta.provider ? ` (nguồn: ${meta.provider})` : ''), ''];
    const totalMs = segments.reduce((sum, seg) =>
      sum + seg.cueIndexes.reduce((s, idx) => {
        const c = byIndex.get(idx);
        return s + (c ? c.end - c.start : 0);
      }, 0), 0);
    lines.push(`Tổng thời lượng: **${(totalMs / 1000).toFixed(1)}s**`, '');
    lines.push('| Segment | Timecode gốc | Phụ đề | Ghi chú |');
    lines.push('|---|---|---|---|');
    for (const seg of segments) {
      const cues = seg.cueIndexes.map((i) => byIndex.get(i)).filter(Boolean);
      const tc = cues.length
        ? `${SrtLib.msToTime(cues[0].start)} --> ${SrtLib.msToTime(cues[cues.length - 1].end)}`
        : '';
      const text = cues.map((c) => c.text.replace(/\n/g, ' ')).join(' ');
      lines.push(`| ${seg.label} | ${tc} | ${text.replace(/\|/g, '\\|')} | ${(seg.note || '').replace(/\|/g, '\\|')} |`);
    }
    return lines.join('\n');
  }

  function buildProjectJson(state) {
    return JSON.stringify(state, null, 2);
  }

  function download(filename, content, mime = 'text/plain') {
    const blob = new Blob([content], { type: mime + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 3000);
  }

  return { segmentsToCues, buildSplicedSrt, buildCsv, buildEdl, buildMarkdown, buildProjectJson, download };
})();

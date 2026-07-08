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

  function xmlEscape(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  }

  // FCPXML 1.9 — import tốt vào DaVinci Resolve / Final Cut Pro (bổ trợ cho EDL).
  // Thời gian biểu diễn theo frame hữu tỉ "N/FPSs".
  function buildFcpxml(segments, sourceCues, { fps = 30, clipName = 'SOURCE.MP4', title = 'SRT STUDIO CUT' } = {}) {
    const cues = segmentsToCues(segments, sourceCues);
    const f = (ms) => `${Math.round(ms / 1000 * fps)}/${fps}s`;
    const totalMs = cues.reduce((s, c) => s + (c.end - c.start), 0);
    const srcEndMs = sourceCues.length ? sourceCues[sourceCues.length - 1].end : totalMs;
    const assetDur = Math.max(srcEndMs, totalMs) + 1000;

    let offset = 0;
    const clips = cues.map((c, i) => {
      const dur = c.end - c.start;
      const line = `        <asset-clip ref="r2" offset="${f(offset)}" name="${xmlEscape(c.segLabel || ('clip ' + (i + 1)))}" start="${f(c.start)}" duration="${f(dur)}" tcFormat="NDF"/>`;
      offset += dur;
      return line;
    }).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
  <resources>
    <format id="r1" name="FFVideoFormat1080p${fps}" frameDuration="1/${fps}s" width="1080" height="1920"/>
    <asset id="r2" name="${xmlEscape(clipName)}" start="0s" duration="${f(assetDur)}" hasVideo="1" hasAudio="1" format="r1">
      <media-rep kind="original-media" src="file://./${xmlEscape(clipName)}"/>
    </asset>
  </resources>
  <library>
    <event name="SRT Studio">
      <project name="${xmlEscape(title)}">
        <sequence format="r1" duration="${f(totalMs)}" tcStart="0s" tcFormat="NDF">
          <spine>
${clips}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;
  }

  // Caption text cho CapCut / dán tay: mỗi dòng = 1 câu (timeline ghép từ 0).
  function buildCaptionsTxt(segments, sourceCues) {
    return segmentsToCues(segments, sourceCues)
      .map((c) => c.text.replace(/\n/g, ' ').trim())
      .filter(Boolean)
      .join('\n');
  }

  // Đồng hồ MM:SS (hoặc H:MM:SS) cho chapter YouTube (timeline ghép từ 0)
  function clockYt(ms) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    const mm = h ? String(m).padStart(2, '0') : String(m);
    return (h ? h + ':' : '') + mm + ':' + String(ss).padStart(2, '0');
  }

  // Gom cue (theo timeline ghép từ 0) thành các chapter >= minMs giây.
  // Chapter đầu luôn ở 00:00. Trả [{ startMs, clock, text }] — timecode tính CỤC BỘ (đúng 100%),
  // chỉ cần AI đặt TÊN chapter + viết mô tả.
  function buildChapters(segments, sourceCues, minMs = 12000) {
    const cues = segmentsToCues(segments, sourceCues);
    const chapters = []; let t = 0; let cur = null;
    for (const c of cues) {
      if (!cur) cur = { startMs: t, texts: [], dur: 0 };
      const txt = (c.text || '').replace(/\s+/g, ' ').trim();
      if (txt) cur.texts.push(txt);
      const dur = Math.max(0, c.end - c.start);
      cur.dur += dur; t += dur;
      if (cur.dur >= minMs) { chapters.push(cur); cur = null; }
    }
    if (cur) {
      if (chapters.length) { const last = chapters[chapters.length - 1]; last.texts.push(...cur.texts); last.dur += cur.dur; }
      else chapters.push(cur);
    }
    return chapters.map((ch) => ({ startMs: ch.startMs, clock: clockYt(ch.startMs), text: ch.texts.join(' ') }));
  }

  // Ghép chapter (timecode cục bộ) + tiêu đề (AI) -> text dán vào mô tả YouTube
  function buildChaptersTxt(chapters, titles) {
    return chapters.map((ch, i) => `${ch.clock} ${(titles && titles[i]) || ('Phần ' + (i + 1))}`).join('\n');
  }

  // Metadata SEO -> text sẵn để dán lên YouTube/TikTok
  function buildMetadataTxt(meta) {
    if (!meta) return '';
    const parts = [];
    if (meta.title) parts.push('TITLE:\n' + meta.title);
    if (meta.description) parts.push('\nDESCRIPTION:\n' + meta.description);
    if (meta.hashtags && meta.hashtags.length) parts.push('\nHASHTAGS:\n' + meta.hashtags.join(' '));
    if (meta.thumbnail) parts.push('\nTHUMBNAIL PROMPT:\n' + meta.thumbnail);
    return parts.join('\n');
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

  return {
    segmentsToCues, buildSplicedSrt, buildCsv, buildEdl, buildMarkdown,
    buildFcpxml, buildCaptionsTxt, buildMetadataTxt, buildProjectJson, download,
    buildChapters, buildChaptersTxt, clockYt,
  };
})();

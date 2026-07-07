// SRT Studio — SRT parse/serialize + tiện ích timecode
// Dùng chung cho side panel (nạp qua <script>).

const SrtLib = (() => {
  // "00:01:23,456" (chấp nhận cả dấu chấm) -> ms
  function timeToMs(str) {
    const m = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/.exec(str || '');
    if (!m) return null;
    return (+m[1]) * 3600000 + (+m[2]) * 60000 + (+m[3]) * 1000 + +m[4].padEnd(3, '0');
  }

  function msToTime(ms) {
    ms = Math.max(0, Math.round(ms));
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const mm = ms % 1000;
    const p = (n, l = 2) => String(n).padStart(l, '0');
    return `${p(h)}:${p(m)}:${p(s)},${p(mm, 3)}`;
  }

  // ms -> timecode EDL "HH:MM:SS:FF"
  function msToTimecode(ms, fps = 30) {
    ms = Math.max(0, Math.round(ms));
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const f = Math.min(fps - 1, Math.round((ms % 1000) / 1000 * fps));
    const p = (n) => String(n).padStart(2, '0');
    return `${p(h)}:${p(m)}:${p(s)}:${p(f)}`;
  }

  // Parse toàn bộ file SRT -> [{index, start, end, text}]
  function parse(raw) {
    if (!raw) return [];
    const text = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const blocks = text.split(/\n{2,}/);
    const cues = [];
    for (const block of blocks) {
      const lines = block.split('\n').map((l) => l.trim()).filter((l) => l !== '');
      if (!lines.length) continue;
      let i = 0;
      // dòng số thứ tự (tùy chọn)
      if (/^\d+$/.test(lines[0])) i = 1;
      const tm = /(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})/.exec(lines[i] || '');
      if (!tm) continue;
      const start = timeToMs(tm[1]);
      const end = timeToMs(tm[2]);
      const body = lines.slice(i + 1).join('\n');
      cues.push({ index: cues.length + 1, start, end, text: body });
    }
    return cues;
  }

  function serialize(cues) {
    return cues
      .map((c, i) => `${i + 1}\n${msToTime(c.start)} --> ${msToTime(c.end)}\n${c.text}`)
      .join('\n\n') + '\n';
  }

  function totalDuration(cues) {
    return cues.reduce((sum, c) => sum + (c.end - c.start), 0);
  }

  // Chuẩn hóa text để so khớp (bỏ khoảng trắng thừa, lowercase)
  function normalize(s) {
    return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  return { timeToMs, msToTime, msToTimecode, parse, serialize, totalDuration, normalize };
})();

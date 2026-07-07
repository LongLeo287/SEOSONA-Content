// SRT Studio — parse output của AI (bảng markdown theo Master Prompt)
// -> danh sách segment, mỗi segment map về các cue trong SRT gốc + kết quả validate.

const OutputParser = (() => {
  const TIME_RE = /\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}/g; // chỉ dùng cho .match()
  const TIME_ONE = /\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}/;  // dùng cho .test() (không giữ state)

  // Tách các dòng bảng markdown "| a | b | c |"
  function extractTableRows(text) {
    const rows = [];
    for (const line of (text || '').split('\n')) {
      const t = line.trim();
      if (!t.startsWith('|')) continue;
      if (/^\|[\s:|-]+\|$/.test(t)) continue; // dòng phân cách |---|---|
      const cells = t.split('|').map((c) => c.trim());
      // bỏ phần tử rỗng đầu/cuối do split
      if (cells.length && cells[0] === '') cells.shift();
      if (cells.length && cells[cells.length - 1] === '') cells.pop();
      if (cells.length >= 2) rows.push(cells);
    }
    return rows;
  }

  function isHeaderRow(cells) {
    const joined = cells.join(' ').toLowerCase();
    return /segment|timecode|raw subtitle|transcript|phân đoạn|phụ đề/.test(joined)
      && !TIME_ONE.test(cells.join(' '));
  }

  // Tìm cue theo thời gian bắt đầu (dung sai tol ms)
  function findCueByStart(cues, startMs, tol = 200) {
    let best = null;
    let bestDiff = tol + 1;
    for (const c of cues) {
      const d = Math.abs(c.start - startMs);
      if (d < bestDiff) { best = c; bestDiff = d; }
    }
    return best;
  }

  // Các cue nằm trong khoảng [start, end]
  function findCuesInRange(cues, startMs, endMs, tol = 200) {
    return cues.filter((c) => c.start >= startMs - tol && c.end <= endMs + tol);
  }

  function matchByText(cues, rawText) {
    const needle = SrtLib.normalize(rawText);
    if (needle.length < 8) return null;
    for (const c of cues) {
      const hay = SrtLib.normalize(c.text);
      if (hay === needle || hay.includes(needle) || needle.includes(hay)) return c;
    }
    return null;
  }

  // parse(responseText, sourceCues) -> [{label, rawText, note, cues, start, end, valid, textMatch}]
  function parse(responseText, sourceCues) {
    const rows = extractTableRows(responseText);
    const segments = [];

    for (const cells of rows) {
      if (isHeaderRow(cells)) continue;

      const rowText = cells.join(' | ');
      const times = (rowText.match(TIME_RE) || []).map((t) => SrtLib.timeToMs(t));
      // Xác định cột: [label, timecode, rawText, note] — linh hoạt khi AI trả thiếu cột
      let label = cells[0] || '';
      let timeCellIdx = cells.findIndex((c) => TIME_ONE.test(c) || /\d{1,2}:\d{2}:\d{2}/.test(c));
      if (timeCellIdx === -1) timeCellIdx = 1;
      const rawText = cells[timeCellIdx + 1] || '';
      const note = cells.slice(timeCellIdx + 2).join(' — ');

      if (!times.length && !rawText) continue;

      let cues = [];
      if (times.length >= 2) {
        cues = findCuesInRange(sourceCues, times[0], times[times.length - 1]);
        if (!cues.length) {
          const c = findCueByStart(sourceCues, times[0]);
          if (c) cues = [c];
        }
      } else if (times.length === 1) {
        const c = findCueByStart(sourceCues, times[0]);
        if (c) cues = [c];
      }
      if (!cues.length && rawText) {
        const c = matchByText(sourceCues, rawText);
        if (c) cues = [c];
      }
      if (!cues.length && !times.length) continue; // dòng rác

      const srcJoined = cues.map((c) => c.text).join(' ');
      const textMatch = cues.length
        ? SrtLib.normalize(srcJoined) === SrtLib.normalize(rawText)
          || SrtLib.normalize(srcJoined).includes(SrtLib.normalize(rawText))
        : false;

      segments.push({
        id: 'seg_' + Math.random().toString(36).slice(2, 9),
        label,
        rawText,
        note,
        cueIndexes: cues.map((c) => c.index),
        start: cues.length ? cues[0].start : (times[0] ?? null),
        end: cues.length ? cues[cues.length - 1].end : (times[1] ?? null),
        valid: cues.length > 0,
        textMatch,
      });
    }
    return segments;
  }

  return { parse, extractTableRows };
})();

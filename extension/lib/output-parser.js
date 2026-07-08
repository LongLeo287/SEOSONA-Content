// SRT Studio — parse output của AI
//  • parse()        : 1 bảng markdown -> segment map về cue gốc + validate
//  • parseAngles()  : nhiều bảng (multi-angle) -> [{title, segments}]
//  • parseScores()  : bảng chấm điểm đánh giá -> {criteria, average, verdict}
//  • parseMetadata(): khối SEO metadata -> {title, description, hashtags, thumbnail}

const OutputParser = (() => {
  const TIME_RE = /\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}/g; // dùng cho .match()
  const TIME_ONE = /\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}/;  // dùng cho .test()

  function extractTableRows(text) {
    const rows = [];
    for (const line of (text || '').split('\n')) {
      const t = line.trim();
      if (!t.startsWith('|')) continue;
      if (/^\|[\s:|-]+\|$/.test(t)) continue; // dòng phân cách |---|---|
      const cells = t.split('|').map((c) => c.trim());
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

  function findCueByStart(cues, startMs, tol = 200) {
    let best = null;
    let bestDiff = tol + 1;
    for (const c of cues) {
      const d = Math.abs(c.start - startMs);
      if (d < bestDiff) { best = c; bestDiff = d; }
    }
    return best;
  }

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

  function rowToSegment(cells, sourceCues) {
    if (isHeaderRow(cells)) return null;
    const rowText = cells.join(' | ');
    const times = (rowText.match(TIME_RE) || []).map((t) => SrtLib.timeToMs(t));
    const label = cells[0] || '';
    let timeCellIdx = cells.findIndex((c) => TIME_ONE.test(c) || /\d{1,2}:\d{2}:\d{2}/.test(c));
    if (timeCellIdx === -1) timeCellIdx = 1;
    const rawText = cells[timeCellIdx + 1] || '';
    const note = cells.slice(timeCellIdx + 2).join(' — ');

    if (!times.length && !rawText) return null;

    let cues = [];
    if (times.length >= 2) {
      cues = findCuesInRange(sourceCues, times[0], times[times.length - 1]);
      if (!cues.length) { const c = findCueByStart(sourceCues, times[0]); if (c) cues = [c]; }
    } else if (times.length === 1) {
      const c = findCueByStart(sourceCues, times[0]); if (c) cues = [c];
    }
    if (!cues.length && rawText) { const c = matchByText(sourceCues, rawText); if (c) cues = [c]; }
    if (!cues.length && !times.length) return null;

    const srcJoined = cues.map((c) => c.text).join(' ');
    const textMatch = cues.length
      ? SrtLib.normalize(srcJoined) === SrtLib.normalize(rawText)
        || SrtLib.normalize(srcJoined).includes(SrtLib.normalize(rawText))
      : false;

    return {
      id: 'seg_' + Math.random().toString(36).slice(2, 9),
      label, rawText, note,
      cueIndexes: cues.map((c) => c.index),
      start: cues.length ? cues[0].start : (times[0] ?? null),
      end: cues.length ? cues[cues.length - 1].end : (times[1] ?? null),
      valid: cues.length > 0,
      textMatch,
    };
  }

  // 1 bảng -> segments (giữ tương thích cũ)
  function parse(responseText, sourceCues) {
    return extractTableRows(responseText)
      .map((cells) => rowToSegment(cells, sourceCues))
      .filter(Boolean);
  }

  // Tách response thành nhiều "angle" theo heading trước mỗi bảng.
  // Nhận diện heading: dòng markdown ## / ### hoặc dòng chứa Angle/Góc/Phiên bản/Version/Script + số.
  function splitAngleSections(text) {
    const lines = (text || '').split('\n');
    const HEAD = /^(#{1,4}\s+.+|.*\b(angle|góc|phiên bản|phương án|version|script|kịch bản)\b\s*#?\s*\d+.*)$/i;
    const sections = [];
    let cur = { title: '', body: [] };
    for (const line of lines) {
      const t = line.trim();
      const isHead = HEAD.test(t) && !t.startsWith('|');
      if (isHead) {
        if (cur.body.join('').trim()) sections.push(cur);
        cur = { title: t.replace(/^#{1,4}\s+/, '').replace(/\*+/g, '').trim(), body: [] };
      } else {
        cur.body.push(line);
      }
    }
    if (cur.body.join('').trim()) sections.push(cur);
    return sections;
  }

  // Bảng meta không phải kịch bản cắt: "nên loại bỏ", "cần giữ" (long-form) -> bỏ qua
  const SKIP_SECTION = /(nên loại|loại bỏ|đoạn.*loại|cần giữ|giữ nguyên vì|remove|to keep|to remove)/i;

  // parseAngles -> [{title, segments}] (chỉ giữ angle có ≥1 segment hợp lệ)
  function parseAngles(responseText, sourceCues) {
    const sections = splitAngleSections(responseText);
    const angles = [];
    for (const sec of sections) {
      if (SKIP_SECTION.test(sec.title || '')) continue; // bỏ bảng loại-bỏ / giữ-lại
      const segs = parse(sec.body.join('\n'), sourceCues);
      if (segs.length) angles.push({ title: sec.title || `Kịch bản ${angles.length + 1}`, segments: segs });
    }
    // Không tách được angle nào -> coi toàn bộ là 1 angle
    if (!angles.length) {
      const segs = parse(responseText, sourceCues);
      if (segs.length) angles.push({ title: 'Kịch bản', segments: segs });
    }
    return angles;
  }

  // parseScores: bảng "| Tiêu chí | Điểm /10 | Nhận xét | Đề xuất |"
  function parseScores(text) {
    const rows = extractTableRows(text);
    const criteria = [];
    for (const cells of rows) {
      const scoreCell = cells.find((c) => /\d+(\.\d+)?\s*\/\s*\d+|\b(\d|10)\s*\/\s*10\b|^\s*\d+(\.\d+)?\s*$/.test(c));
      const m = scoreCell && /(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+))?/.exec(scoreCell);
      if (!m) continue;
      const name = cells[0];
      if (/tiêu chí|criteria|score|điểm/i.test(name) && !/\d/.test(cells.slice(1).join(''))) continue; // header
      const score = parseFloat(m[1]);
      const max = m[2] ? parseFloat(m[2]) : 10;
      if (isNaN(score)) continue;
      const rest = cells.filter((c) => c !== cells[0] && c !== scoreCell);
      criteria.push({ name, score, max, comment: rest[0] || '', suggest: rest[1] || '' });
    }
    let average = null;
    const avgM = /(?:tổng điểm|trung bình|average|overall)[^\d]*(\d+(?:\.\d+)?)/i.exec(text || '');
    if (avgM) average = parseFloat(avgM[1]);
    else if (criteria.length) average = +(criteria.reduce((s, c) => s + c.score / c.max * 10, 0) / criteria.length).toFixed(1);

    let verdict = '';
    // ưu tiên dòng "Kết luận:/Verdict:" (tránh bắt nhầm "Việc cần sửa" ở header bảng)
    const vM = /(?:kết luận|verdict|kết quả)\s*[*:：\s]*\**\s*(nên đăng[^\n]*|cần sửa[^\n]*|làm lại[^\n]*)/i.exec(text || '')
      || /\*\*\s*(nên đăng|cần sửa|làm lại)\s*\**/i.exec(text || '')
      || /verdict[*:\s]*([^\n]+)/i.exec(text || '')
      || /(nên đăng|cần sửa|làm lại)/i.exec(text || '');
    if (vM) verdict = (vM[1] || vM[0]).replace(/[*:]+/g, ' ').trim();
    return { criteria, average, verdict, raw: text };
  }

  // parseMetadata: khối có nhãn Title/Tiêu đề, Description/Mô tả, Hashtags, Thumbnail
  function parseMetadata(text) {
    const grab = (labels) => {
      const re = new RegExp(`^\\s*(?:[*#>-]*\\s*)?(?:${labels})\\s*[:：]\\s*(.*)$`, 'im');
      const m = re.exec(text || '');
      return m ? m[1].trim().replace(/^\*+|\*+$/g, '') : '';
    };
    // Description có thể nhiều dòng -> lấy khối tới nhãn kế tiếp
    const descBlock = (() => {
      const m = /(?:description|mô tả)\s*[:：]?\s*\n?([\s\S]*?)(?:\n\s*(?:hashtag|thumbnail|tag|tiêu đề|title)\b|$)/i.exec(text || '');
      return m ? m[1].trim() : '';
    })();
    const hashtags = ((text || '').match(/#[\p{L}\p{N}_]+/gu) || []);
    return {
      title: grab('title|tiêu đề|tựa đề'),
      description: descBlock || grab('description|mô tả'),
      hashtags: [...new Set(hashtags)],
      thumbnail: grab('thumbnail|ảnh bìa|hình bìa'),
      raw: text,
    };
  }

  // parseChapters: output CHAPTERS_PROMPT -> { titles: [...], description }
  // Định dạng: ===TITLES===\n1. a\n2. b\n===DESCRIPTION===\n<desc>
  function parseChapters(text) {
    const t = text || '';
    const titlesBlock = (/===\s*TITLES\s*===([\s\S]*?)(?:===\s*DESCRIPTION\s*===|$)/i.exec(t) || [])[1] || '';
    const descBlock = (/===\s*DESCRIPTION\s*===([\s\S]*)$/i.exec(t) || [])[1] || '';
    const titles = titlesBlock.split('\n')
      .map((l) => l.trim())
      .map((l) => {
        const m = /^(?:\d+[.)\]]|[-*])\s*(.+)$/.exec(l);
        return m ? m[1].trim().replace(/^\*+|\*+$/g, '') : '';
      })
      .filter(Boolean);
    // fallback: nếu không có marker, lấy các dòng đánh số bất kỳ làm title
    if (!titles.length) {
      for (const l of t.split('\n')) {
        const m = /^\s*\d+[.)\]]\s*(.+)$/.exec(l);
        if (m) titles.push(m[1].trim());
      }
    }
    return { titles, description: descBlock.trim(), raw: t };
  }

  return { parse, parseAngles, parseScores, parseMetadata, parseChapters, extractTableRows, splitAngleSections };
})();

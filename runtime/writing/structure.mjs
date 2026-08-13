// Lập và kiểm cấu trúc bài — điều khiển hoàn toàn bằng LUẬT CỦA PACK.
//
// Core cố ý không biết gì về heading của bài blog, về mục FAQ của trang sản phẩm hay về
// chương của transcript. Nhét những thứ đó vào đây thì thêm một loại nội dung mới sẽ phải
// sửa Core, và Core dần biến thành nơi chứa luật của mọi loại nội dung từng tồn tại.

/** Dựng dàn bài từ luật của pack. Luật khác thì dàn bài khác — Core không có ý kiến riêng. */
export function planStructure(rules = {}, brief = {}) {
  const levels = rules.headingLevels || [2];
  return (rules.requiredSections || []).map((heading, index) => ({
    heading,
    level: levels[Math.min(index, levels.length - 1)] ?? 2,
    body: '',
    evidenceRefs: [],
    fromBrief: brief.objective ? true : false,
  }));
}

export function validateStructure(sections = [], rules = {}) {
  const issues = [];
  const seen = new Set();
  let previousLevel = null;

  for (const [index, section] of sections.entries()) {
    const heading = String(section?.heading || '').trim();
    const level = Number(section?.level) || 2;

    if (!heading) {
      issues.push({ code: 'MISSING_HEADING', index, repairAction: 'FIX_STRUCTURE' });
    } else if (seen.has(heading.toLowerCase())) {
      // Hai mục cùng tên: người đọc không biết mục nào là mục nào, và mục lục thành vô nghĩa.
      issues.push({ code: 'DUPLICATE_HEADING', index, heading, repairAction: 'FIX_STRUCTURE' });
    } else {
      seen.add(heading.toLowerCase());
    }

    if (!String(section?.body || '').trim()) {
      issues.push({ code: 'EMPTY_SECTION', index, heading, repairAction: 'REWRITE_SECTION' });
    }

    // Nhảy cấp (H2 -> H4) làm hỏng cấu trúc đọc và cấu trúc máy đọc.
    if (previousLevel !== null && level > previousLevel + 1) {
      issues.push({ code: 'HEADING_LEVEL_JUMP', index, heading, from: previousLevel, to: level, repairAction: 'FIX_STRUCTURE' });
    }
    previousLevel = level;
  }

  for (const required of rules.requiredSections || []) {
    if (!sections.some((s) => String(s?.heading || '').trim().toLowerCase() === required.toLowerCase())) {
      issues.push({ code: 'MISSING_REQUIRED_SECTION', heading: required, repairAction: 'FIX_STRUCTURE' });
    }
  }

  return { ok: issues.length === 0, issues };
}

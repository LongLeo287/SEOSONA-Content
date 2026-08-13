import { assertContentIR } from './contracts.mjs';

// Điều chỉnh nội dung cho đúng ràng buộc của NƠI ĐĂNG — và chỉ ở mức văn bản.
//
// Ranh giới quan trọng: file này KHÔNG viết lại nội dung. Nó chuẩn hóa hình thức (khoảng
// trắng thừa, trường thiếu, thứ tự trường), báo chỗ vượt giới hạn, và dừng ở đó. Cắt bớt
// một bài cho vừa giới hạn ký tự là SỬA NỘI DUNG, và mọi phép sửa nội dung phải đi qua
// Editor để các bài kiểm về dữ kiện và mức khẳng định còn hiệu lực.
//
// Nếu chỗ này được phép tự cắt, thì con đường "rút gọn cho vừa Twitter" sẽ lặng lẽ bỏ mất
// đúng cái mệnh đề đang gánh bằng chứng.
//
// Và: không có trường nào ở đây sinh ảnh, đặt lịch hay đăng bài. Đó là sản phẩm khác.

const FORBIDDEN_FIELDS = /^(publish|publishat|schedule|scheduleat|mediaprompt|imageprompt|generateimage|video|thumbnail)$/i;

function issue(code, extra = {}) {
  return { code, severity: 'WARN', ...extra };
}

export function assertTargetSpec(spec) {
  if (!spec || typeof spec !== 'object') throw new TypeError('targetSpec: must be an object.');
  for (const key of Object.keys(spec)) {
    if (FORBIDDEN_FIELDS.test(key.replace(/[_-]/g, ''))) {
      throw new TypeError(`targetSpec: field "${key}" is about publishing or media generation, which is out of scope.`);
    }
  }
  return {
    id: spec.id || null,
    revision: Number.isInteger(spec.revision) ? spec.revision : 0,
    destinationType: spec.destinationType || null,
    surface: spec.surface || null,
    outputFormat: spec.outputFormat || 'text',
    fieldSet: [...(spec.fieldSet || [])],
    lengthRules: structuredClone(spec.lengthRules || {}),
    formatRules: structuredClone(spec.formatRules || {}),
    discoveryRules: structuredClone(spec.discoveryRules || {}),
    linkRules: structuredClone(spec.linkRules || {}),
    ctaRules: structuredClone(spec.ctaRules || {}),
    locale: spec.locale || null,
  };
}

/**
 * @returns {{content: object, issues: Array}}
 * `issues` mang severity: WARN là khuyến nghị, BLOCK là ràng buộc cứng của nơi đăng.
 * Cả hai đều KHÔNG tự sửa nội dung.
 */
export function adaptToTarget({ content, targetSpec } = {}) {
  const base = assertContentIR(content);
  const target = assertTargetSpec(targetSpec);
  const issues = [];
  const fields = { ...base.fields };

  // Chuẩn hóa hình thức: an toàn vì không đổi nghĩa và không đổi con số.
  if (target.formatRules.collapseWhitespace) {
    for (const [key, value] of Object.entries(fields)) {
      if (typeof value === 'string') fields[key] = value.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    }
  }

  for (const field of target.fieldSet) {
    if (!String(fields[field] ?? '').trim()) {
      issues.push(issue('MISSING_TARGET_FIELD', { field, severity: 'BLOCK', repairAction: 'REWRITE_SECTION' }));
    }
  }

  for (const [field, rule] of Object.entries(target.lengthRules)) {
    const value = String(fields[field] ?? '');
    if (!value) continue;
    if (rule.max && value.length > rule.max) {
      // Giới hạn CỨNG: nơi đăng thật sự từ chối. Vẫn không tự cắt — cắt là sửa nội dung.
      const hard = rule.hard !== false;
      issues.push(issue('TARGET_LENGTH_EXCEEDED', {
        field, length: value.length, max: rule.max,
        severity: hard ? 'BLOCK' : 'WARN',
        repairAction: 'REWRITE_SECTION',
        message: hard
          ? `"${field}" is ${value.length} characters and the destination accepts ${rule.max}. Shorten it through an edit.`
          : `"${field}" is longer than the recommended ${rule.max} characters.`,
      }));
    }
    if (rule.min && value.length < rule.min) {
      issues.push(issue('TARGET_LENGTH_TOO_SHORT', { field, length: value.length, min: rule.min, repairAction: 'REWRITE_SECTION' }));
    }
  }

  if (target.linkRules.maxLinks !== undefined) {
    const links = (JSON.stringify(fields).match(/https?:\/\//g) || []).length;
    if (links > target.linkRules.maxLinks) {
      issues.push(issue('TOO_MANY_LINKS', { count: links, max: target.linkRules.maxLinks, severity: 'BLOCK', repairAction: 'REWRITE_SECTION' }));
    }
  }

  if (target.ctaRules.required && !String(fields[target.ctaRules.field || 'cta'] ?? '').trim()) {
    issues.push(issue('MISSING_CTA', { severity: 'BLOCK', repairAction: 'REWRITE_SECTION' }));
  }

  return {
    content: { ...base, fields, targetRef: target.id },
    issues,
    blocked: issues.some((i) => i.severity === 'BLOCK'),
  };
}

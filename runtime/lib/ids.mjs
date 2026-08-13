import { randomUUID } from 'node:crypto';

// ID ổn định, portable, có tiền tố theo loại bản ghi.
// Dạng: <prefix>_<epoch>_<suffix>  — chỉ chữ thường + số + gạch dưới.
//
// `now` và `random` nhận vào được để test tất định. Trong sản xuất dùng
// randomUUID của node:crypto, KHÔNG dựa vào biến toàn cục crypto.
export function makeId(prefix, { now = Date.now, random = randomUUID } = {}) {
  const safePrefix = String(prefix).toLowerCase().replace(/[^a-z0-9]+/g, '');
  const suffix = String(random()).toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!safePrefix || !suffix) throw new Error('ID prefix and random suffix are required.');
  return `${safePrefix}_${Number(now())}_${suffix}`;
}

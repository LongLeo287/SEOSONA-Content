import { assertBriefIR } from './contracts.mjs';

// Dựng brief chung cho mọi pack.
//
// Pack khai nó cần trường nào; hàm này ép đủ trường đó rồi mới đi qua hợp đồng chung.
// Thiếu trường thì BÁO TÊN TRƯỜNG — một brief thiếu "góc tiếp cận" mà vẫn chạy sẽ cho ra
// bài viết chung chung, và đến lúc đọc mới biết thì đã tốn một lượt chạy.

export function requireText(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`brief: "${field}" is required.`);
  }
  return value.trim();
}

export function buildBrief(input, requiredFields = []) {
  const source = input && typeof input === 'object' ? input : {};
  for (const field of requiredFields) requireText(source[field], field);
  return assertBriefIR(source);
}

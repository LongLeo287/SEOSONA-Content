#!/usr/bin/env node
// SEOSONA Content — biên dịch knowledge-src/*.md -> vùng BLOCKS trong extension/lib/knowledge.js
//
// Nguồn kiến thức là các file .md ở knowledge-src/ (kéo/biên tập từ SEOSONA OS).
// Chạy:  node scripts/sync-knowledge.mjs
// Mỗi khi cập nhật kiến thức từ OS: sửa file .md tương ứng rồi chạy lại lệnh này.
//
// Định dạng mỗi file knowledge-src/NN-<slug>.md:
//   ---
//   id: <camelCaseId>
//   name: <tên hiển thị>
//   default: true|false
//   ---
//   <nội dung block (bơm vào prompt phân tích)>

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPT_DIR, '..');
const SRC_DIR = join(ROOT, 'knowledge-src');
const TARGET = join(ROOT, 'extension', 'lib', 'knowledge.js');
const START = '// <<<SYNC:BLOCKS>>>';
const END = '// <<<END:BLOCKS>>>';

function parseBlock(raw, file) {
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/.exec(raw.replace(/^﻿/, ''));
  if (!m) throw new Error(`Thiếu frontmatter trong ${file}`);
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = /^(\w+)\s*:\s*(.*)$/.exec(line.trim());
    if (kv) meta[kv[1]] = kv[2];
  }
  if (!meta.id) throw new Error(`Thiếu 'id' trong ${file}`);
  return { id: meta.id, name: meta.name || meta.id, default: /^true$/i.test(meta.default || ''), text: m[2].trim() };
}

function escTemplate(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

const files = readdirSync(SRC_DIR).filter((f) => f.endsWith('.md')).sort();
if (!files.length) { console.error('Không có file .md nào trong knowledge-src/'); process.exit(1); }

const blocks = files.map((f) => parseBlock(readFileSync(join(SRC_DIR, f), 'utf8'), f));
const ids = new Set();
for (const b of blocks) { if (ids.has(b.id)) throw new Error(`id trùng: ${b.id}`); ids.add(b.id); }

const body = blocks.map((b) =>
  `    ${b.id}: {\n` +
  `      name: ${JSON.stringify(b.name)},\n` +
  `      default: ${b.default},\n` +
  `      text:\n` +
  '`' + escTemplate(b.text) + '`,\n' +
  `    },`
).join('\n');

const generated = `  const BLOCKS = {\n${body}\n  };\n`;

const src = readFileSync(TARGET, 'utf8');
const sIdx = src.indexOf(START);
const eIdx = src.indexOf(END);
if (sIdx < 0 || eIdx < 0) { console.error(`Không tìm thấy marker ${START} / ${END} trong knowledge.js`); process.exit(1); }
const startLineEnd = src.indexOf('\n', sIdx);
const endLineStart = src.lastIndexOf('\n', eIdx) + 1;
const out = src.slice(0, startLineEnd + 1) + generated + src.slice(endLineStart);

writeFileSync(TARGET, out, 'utf8');
console.log(`✔ Đã sinh ${blocks.length} block vào extension/lib/knowledge.js:`);
blocks.forEach((b) => console.log(`   - ${b.id}${b.default ? ' (mặc định bật)' : ''} — ${b.name}`));

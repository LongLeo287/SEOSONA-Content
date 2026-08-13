import { readdir, readFile } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Máy quét ranh giới kiến trúc.
//
// Lõi mới (Runtime + Provider + Writing) phải chạy được mà KHÔNG cần biết Facebook Factory
// tồn tại. Không phải vì code cũ tệ, mà vì hướng phụ thuộc: nếu Runtime bắt đầu import
// facebook-*, thì "thêm một loại nội dung" sẽ kéo theo cả một luồng media, và cái ranh giới
// đã dựng suốt ba kế hoạch trước biến mất trong một dòng import.
//
// Quét MÃ THỰC THI, không quét tài liệu: một dòng chú thích giải thích vì sao ranh giới tồn
// tại là điều nên có, không phải điều cần cấm.

const FORBIDDEN = [
  'facebook-factory',
  'facebook-batch',
  'facebook-orchestrator',
  'facebook-state',
  'facebook-provider-lease',
  '/v1/flow/',
  'visualJob',
  'ASSET_READY',
];

const SCAN_ROOTS = ['runtime'];
const EXTENSIONS = ['.mjs', '.js'];

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

async function walk(dir, files = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, files);
    else if (EXTENSIONS.some((ext) => entry.name.endsWith(ext))) files.push(full);
  }
  return files;
}

export async function auditWritingBoundary({ rootDir } = {}) {
  const base = rootDir || join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const violations = [];

  for (const scanRoot of SCAN_ROOTS) {
    const files = await walk(join(base, scanRoot)).catch(() => []);
    for (const file of files) {
      const executable = stripComments(await readFile(file, 'utf8'));
      for (const term of FORBIDDEN) {
        if (executable.includes(term)) {
          violations.push({ file: relative(base, file), term });
        }
      }
    }
  }

  return { ok: violations.length === 0, violations, scanned: SCAN_ROOTS, forbidden: FORBIDDEN };
}

const isDirectRun = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href;
if (isDirectRun) {
  const result = await auditWritingBoundary();
  if (result.ok) {
    process.stdout.write(`Writing boundary clean — ${result.scanned.join(', ')} reference none of ${result.forbidden.length} legacy identifiers.\n`);
    process.exit(0);
  }
  for (const violation of result.violations) {
    process.stderr.write(`BOUNDARY VIOLATION  ${violation.file}  ->  ${violation.term}\n`);
  }
  process.stderr.write('\nThe writing core must not depend on the legacy Facebook/media workflow.\n');
  process.stderr.write('Move the dependency behind an adapter instead of deleting legacy code to satisfy this check.\n');
  process.exit(1);
}

import { mkdir, writeFile, rename, unlink, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

// Ghi JSON NGUYÊN TỬ: ghi ra file tạm cạnh đích rồi rename.
// rename trong cùng thư mục là thao tác nguyên tử ở mức hệ điều hành, nên người đọc
// không bao giờ thấy file ghi dở. Không dùng cách ghi đè trực tiếp.
// Cờ 'wx' đảm bảo tên tạm chưa tồn tại; lỗi thì dọn file tạm (best-effort).
export async function writeJsonAtomic(file, value) {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await rename(temp, file);
  } catch (err) {
    await unlink(temp).catch(() => {});
    throw err;
  }
}

// Đọc JSON; không tồn tại thì trả null thay vì ném lỗi.
export async function readJsonOrNull(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

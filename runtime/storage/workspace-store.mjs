import { mkdir, readdir, readFile, writeFile, rename, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { assertRecord, RECORD_ID_FIELD, IMMUTABLE_TYPES, RECORD_TYPES } from '../domain/records.mjs';
import { writeJsonAtomic, readJsonOrNull } from '../lib/atomic-json.mjs';

// Bố cục trên đĩa (cố tình phẳng và dễ đọc bằng mắt):
//   <root>/workspaces/<workspaceId>/records/<type>/<id>.json
//   <root>/workspaces/<workspaceId>/blobs/<sha256>.bin
//
// blobRef trả cho bên gọi là URI LOGIC: seosona-local://<workspaceId>/blobs/<sha256>
// KHÔNG bao giờ trả đường dẫn tuyệt đối ra ngoài — spec cấm domain lộ đường dẫn máy.

const SAFE_ID = /^[a-z][a-z0-9_:-]{1,159}$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const BLOB_SCHEME = 'seosona-local://';

function assertSafeId(value, label) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw new TypeError(`Unsafe id for ${label}: ${JSON.stringify(value)}`);
  }
  return value;
}

function err(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

export function createWorkspaceStore({ rootDir }) {
  if (!rootDir) throw new TypeError('createWorkspaceStore requires rootDir.');

  const wsDir = (scopeId) => join(rootDir, 'workspaces', assertSafeId(scopeId, 'scopeId'));

  // `type` KHÔNG kiểm bằng regex id: loại bản ghi là một tập đóng đã khai báo, và nhiều
  // loại viết camelCase (contextSnapshot, sourceBlock…). Kiểm theo danh sách cho phép
  // vừa đúng hơn vừa an toàn hơn — không tên nào ngoài danh sách chạm được vào đường dẫn.
  const assertKnownType = (type) => {
    if (!RECORD_TYPES.includes(type)) throw new TypeError(`Unknown record type: ${type}`);
    return type;
  };
  const typeDir = (scopeId, type) => join(wsDir(scopeId), 'records', assertKnownType(type));
  const recordFile = (scopeId, type, id) => join(typeDir(scopeId, type), `${assertSafeId(id, 'id')}.json`);
  const blobFile = (scopeId, sha256) => join(wsDir(scopeId), 'blobs', `${sha256}.bin`);

  async function put(type, scopeId, record) {
    // Validate TRƯỚC khi chạm đĩa: bản ghi hỏng không được để lại rác.
    const clean = assertRecord(type, record);
    const idField = RECORD_ID_FIELD[type];
    const id = assertSafeId(clean[idField], `${type}.${idField}`);
    const file = recordFile(scopeId, type, id);

    if (IMMUTABLE_TYPES.includes(type)) {
      const existing = await readJsonOrNull(file);
      if (existing) {
        const same = JSON.stringify(existing) === JSON.stringify(clean);
        if (same) return clean; // ghi lại y hệt => không làm gì
        throw err(
          'IMMUTABLE_RECORD_CONFLICT',
          `${type} ${id} already exists with different content; immutable records cannot be rewritten.`,
        );
      }
    }

    await writeJsonAtomic(file, clean);
    return clean;
  }

  async function get(type, scopeId, id) {
    return readJsonOrNull(recordFile(scopeId, type, id));
  }

  async function list(type, scopeId) {
    const dir = typeDir(scopeId, type);
    let names;
    try {
      names = await readdir(dir);
    } catch (e) {
      if (e && e.code === 'ENOENT') return [];
      throw e;
    }
    const out = [];
    for (const name of names.filter((n) => n.endsWith('.json')).sort()) {
      const rec = await readJsonOrNull(join(dir, name));
      if (rec) out.push(rec);
    }
    return out;
  }

  // Blob địa chỉ hóa theo nội dung: cùng byte => cùng tên file => hội tụ, không nhân bản.
  // Ghi qua file tạm rồi rename để không bao giờ lộ blob ghi dở.
  async function putBlob(scopeId, blobId, bytes) {
    assertSafeId(scopeId, 'scopeId');
    assertSafeId(blobId, 'blobId');
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    const sha256 = createHash('sha256').update(buf).digest('hex');
    const file = blobFile(scopeId, sha256);

    const exists = await stat(file).then(() => true).catch(() => false);
    if (!exists) {
      await mkdir(join(wsDir(scopeId), 'blobs'), { recursive: true });
      const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
      try {
        await writeFile(temp, buf, { flag: 'wx' });
        await rename(temp, file);
      } catch (e) {
        await unlink(temp).catch(() => {});
        // Chạy song song có thể đã tạo xong file cùng nội dung — chấp nhận.
        const nowExists = await stat(file).then(() => true).catch(() => false);
        if (!nowExists) throw e;
      }
    }
    return { blobRef: `${BLOB_SCHEME}${scopeId}/blobs/${sha256}`, sha256, size: buf.length };
  }

  async function readBlob(blobRef) {
    if (typeof blobRef !== 'string' || !blobRef.startsWith(BLOB_SCHEME)) {
      throw new TypeError(`Invalid blobRef: ${JSON.stringify(blobRef)}`);
    }
    const rest = blobRef.slice(BLOB_SCHEME.length);
    const m = /^([^/]+)\/blobs\/([^/]+)$/.exec(rest);
    if (!m) throw new TypeError(`Invalid blobRef: ${JSON.stringify(blobRef)}`);
    const [, scopeId, sha256] = m;
    if (!SHA256_HEX.test(sha256)) throw new TypeError(`Invalid blobRef digest: ${JSON.stringify(blobRef)}`);
    return readFile(blobFile(scopeId, sha256));
  }

  return { put, get, list, putBlob, readBlob };
}

import { createHash } from 'node:crypto';
import { makeId } from '../lib/ids.mjs';

// ContextSnapshot — ảnh chụp BỐI CẢNH THỰC THI, đóng băng trước khi job chạy.
//
// Lý do tồn tại: nếu bối cảnh đổi giữa chừng thì không ai tái lập được một lần chạy,
// và không thể nói kết quả đến từ đâu. Spec nhắc "no mid-job silent mutation" ở 4 tab khác nhau.
//
// Hai bảo đảm:
//   1. HASH TẤT ĐỊNH — cùng nội dung thì cùng hash, bất kể thứ tự khóa trong object.
//      (Thứ tự phần tử MẢNG thì có nghĩa, phải giữ nguyên.)
//   2. BẤT BIẾN — lưu qua WorkspaceStore là loại immutable; sửa nội dung mà giữ id
//      sẽ bị từ chối bằng IMMUTABLE_RECORD_CONFLICT. Sửa giữa job ⇒ tạo snapshot MỚI.

// Sắp khóa object theo thứ tự chữ cái, đệ quy. Mảng giữ nguyên thứ tự vì thứ tự là dữ liệu.
export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = canonicalize(value[key]);
      return acc;
    }, {});
  }
  return value;
}

export function hashContext(input) {
  return createHash('sha256').update(JSON.stringify(canonicalize(input)), 'utf8').digest('hex');
}

export async function createContextSnapshot(input, { store, workspaceId, now = () => new Date().toISOString(), idFactory = makeId } = {}) {
  if (!store) throw new TypeError('createContextSnapshot requires a store.');
  if (!workspaceId) throw new TypeError('createContextSnapshot requires a workspaceId.');

  const {
    project = null, brand = null, audience = null,
    sourceRefs = [], evidenceRefs = [],
    jobPack = null, targetPack = null,
    policy = null, providerPolicy = null,
  } = input || {};

  // Chỉ những thứ ẢNH HƯỞNG KẾT QUẢ mới đi vào hash. contextSnapshotId và compiledAt
  // cố ý đứng ngoài — nếu không, hai snapshot nội dung y hệt sẽ ra hash khác nhau
  // và mất luôn khả năng nhận ra chúng giống nhau.
  const pinned = { project, brand, audience, sourceRefs, evidenceRefs, jobPack, targetPack, policy, providerPolicy };
  const hash = hashContext(pinned);

  return store.put('contextSnapshot', workspaceId, {
    contextSnapshotId: idFactory('contextSnapshot'),
    hash,
    compiledAt: now(),
    ...pinned,
  });
}

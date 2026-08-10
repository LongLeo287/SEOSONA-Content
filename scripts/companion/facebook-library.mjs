import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve, relative, join, basename, extname } from 'node:path';

function inside(root, candidate) {
  const rel = relative(root, candidate);
  return rel && !rel.startsWith('..') && !rel.includes(':') && !rel.startsWith('/') && !rel.startsWith('\\');
}

function safeSegment(value, label) {
  const segment = String(value || '');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(segment)) throw new Error(`${label} contains unsupported path characters.`);
  return segment;
}

async function sha256(filePath) {
  const bytes = await readFile(filePath);
  return createHash('sha256').update(bytes).digest('hex');
}

function logicalRef(...segments) {
  return 'content-library://' + segments.map((segment) => String(segment).replace(/\\/g, '/')).join('/');
}

async function writeJsonAtomic(filePath, value) {
  const temporary = filePath + '.tmp-' + randomUUID();
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8');
  try {
    await rename(temporary, filePath);
  } catch (error) {
    if (!['EEXIST', 'EPERM'].includes(error && error.code)) throw error;
    await rm(filePath, { force: true });
    await rename(temporary, filePath);
  }
}

export async function ingestExportedAsset({ downloadsRoot, libraryRoot, exportInfo, batchId, draftId, asset, quality = null, retryCount = 0, promptRevision = 1, brandKitRef = null, flowContractVersion = null }) {
  if (!downloadsRoot || !libraryRoot) throw new Error('Both Flow download root and Content Library root are required.');
  if (!exportInfo || !exportInfo.folder || !exportInfo.file_name) throw new Error('Flow export info requires folder and file_name.');
  if (!asset || !asset.asset_id) throw new Error('Asset id is required.');

  const sourceRoot = resolve(downloadsRoot);
  const source = resolve(sourceRoot, String(exportInfo.folder), String(exportInfo.file_name));
  if (!inside(sourceRoot, source)) throw new Error('Exported asset must stay inside the Flow download root.');

  const targetRoot = resolve(libraryRoot);
  const targetDir = resolve(targetRoot, safeSegment(batchId, 'Batch id'), safeSegment(draftId, 'Draft id'));
  if (!inside(targetRoot, targetDir)) throw new Error('Content Library destination must stay inside the library root.');
  const fileName = basename(String(exportInfo.file_name));
  if (fileName !== String(exportInfo.file_name) || !fileName) throw new Error('Asset file name is invalid.');
  const extension = extname(fileName).toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'].includes(extension)) throw new Error('Exported asset must use a supported image extension.');
  const targetFileName = safeSegment(asset.asset_id, 'Asset id') + extension;

  await mkdir(targetDir, { recursive: true });
  const runtimeFileRef = join(targetDir, targetFileName);
  const fileRef = logicalRef(batchId, draftId, targetFileName);
  await copyFile(source, runtimeFileRef);
  const receipt = {
    contractVersion: '1.0',
    id: `${batchId}/${draftId}/${asset.asset_id}`,
    assetId: asset.asset_id,
    kind: asset.kind || 'image',
    provider: asset.provider || 'flow',
    fileRef,
    sha256: await sha256(runtimeFileRef),
    quality,
    retryCount,
    promptRevision,
    ...(brandKitRef ? { brandKitRef } : {}),
    ...(flowContractVersion ? { flowContractVersion } : {}),
  };
  const runtimeReceiptRef = join(targetDir, `${targetFileName}.receipt.json`);
  const receiptRef = logicalRef(batchId, draftId, `${targetFileName}.receipt.json`);
  await writeJsonAtomic(runtimeReceiptRef, receipt);
  return { fileRef, receiptRef, runtimeFileRef, runtimeReceiptRef, receipt };
}

export async function writeBatchPackage({ libraryRoot, batch, snapshot, draft }) {
  if (!libraryRoot) throw new Error('Content Library root is required.');
  if (!batch || !snapshot || !draft) throw new Error('Batch, context snapshot, and draft are required.');
  const batchId = safeSegment(batch.id, 'Batch id');
  const draftId = safeSegment(draft.id, 'Draft id');
  if (!batch.contextRevision || batch.contextRevision !== snapshot.contextRevision) {
    throw new Error('Batch and context snapshot revisions must match.');
  }
  const root = resolve(libraryRoot);
  const batchDir = resolve(root, batchId);
  const draftDir = resolve(batchDir, draftId);
  if (!inside(root, batchDir) || !inside(root, draftDir)) throw new Error('Content Library package must stay inside the library root.');
  await mkdir(draftDir, { recursive: true });

  const runtimeBatchRef = join(batchDir, 'batch.json');
  const runtimeContextRef = join(batchDir, 'context.snapshot.json');
  const runtimeDraftRef = join(draftDir, 'draft.json');
  await writeJsonAtomic(runtimeBatchRef, batch);
  await writeJsonAtomic(runtimeContextRef, snapshot);
  await writeJsonAtomic(runtimeDraftRef, draft);

  return {
    batchRef: logicalRef(batchId, 'batch.json'),
    contextRef: logicalRef(batchId, 'context.snapshot.json'),
    draftRef: logicalRef(batchId, draftId, 'draft.json'),
    runtimeBatchRef,
    runtimeContextRef,
    runtimeDraftRef,
  };
}

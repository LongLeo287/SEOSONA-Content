import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative, join, basename } from 'node:path';

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

export async function ingestExportedAsset({ downloadsRoot, libraryRoot, exportInfo, batchId, draftId, asset, quality = null, retryCount = 0, promptRevision = 1, brandKitRef = null }) {
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

  await mkdir(targetDir, { recursive: true });
  const fileRef = join(targetDir, fileName);
  await copyFile(source, fileRef);
  const receipt = {
    contractVersion: '1.0',
    id: `${batchId}/${draftId}/${asset.asset_id}`,
    assetId: asset.asset_id,
    kind: asset.kind || 'image',
    provider: asset.provider || 'flow',
    sourceUrl: asset.url || null,
    fileRef,
    sha256: await sha256(fileRef),
    quality,
    retryCount,
    promptRevision,
    ...(brandKitRef ? { brandKitRef } : {}),
  };
  const receiptRef = join(targetDir, `${fileName}.receipt.json`);
  await writeFile(receiptRef, JSON.stringify(receipt, null, 2) + '\n', 'utf8');
  return { fileRef, receiptRef, receipt };
}

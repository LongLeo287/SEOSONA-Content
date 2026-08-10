import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ingestExportedAsset } from '../scripts/companion/facebook-library.mjs';

test('copies a Flow export into the Content Library and writes a provenance receipt', async () => {
  const downloads = await mkdtemp(join(tmpdir(), 'seosona-flow-downloads-'));
  const library = await mkdtemp(join(tmpdir(), 'seosona-content-library-'));
  const source = join(downloads, 'factory', 'post-01.png');
  await (await import('node:fs/promises')).mkdir(join(downloads, 'factory'), { recursive: true });
  await writeFile(source, 'png-bytes');

  const result = await ingestExportedAsset({
    downloadsRoot: downloads,
    libraryRoot: library,
    exportInfo: { folder: 'factory', file_name: 'post-01.png' },
    batchId: 'week-2026-33',
    draftId: 'post-01',
    asset: { asset_id: 'asset-1', kind: 'image', provider: 'flow', url: 'https://provider.example/post-01.png' },
    quality: { judged: true, pass: true, verdict: 'good', action: 'accept', critical: [] },
    retryCount: 1,
    promptRevision: 2,
    brandKitRef: { ref: 'seosona-brand://video/SEOSONA/brand-kit.v1.json', version: '1.0.0', sha256: '4ecb0a7ac2d49c65d96739f2fa31492863c716b477868b130142c482d289a927' },
  });

  assert.match(result.fileRef, /week-2026-33[\\/]post-01[\\/]post-01\.png$/);
  assert.equal(await readFile(result.fileRef, 'utf8'), 'png-bytes');
  const receipt = JSON.parse(await readFile(result.receiptRef, 'utf8'));
  assert.equal(receipt.assetId, 'asset-1');
  assert.equal(receipt.retryCount, 1);
  assert.equal(receipt.promptRevision, 2);
  assert.equal(receipt.brandKitRef.version, '1.0.0');
  assert.match(receipt.brandKitRef.sha256, /^[a-f0-9]{64}$/);
  assert.match(receipt.sha256, /^[a-f0-9]{64}$/);
});

test('rejects a path that escapes the Flow download root', async () => {
  const downloads = await mkdtemp(join(tmpdir(), 'seosona-flow-downloads-'));
  const library = await mkdtemp(join(tmpdir(), 'seosona-content-library-'));
  await assert.rejects(
    ingestExportedAsset({
      downloadsRoot: downloads, libraryRoot: library,
      exportInfo: { folder: '..', file_name: 'escape.png' },
      batchId: 'week-2026-33', draftId: 'post-01', asset: { asset_id: 'asset-1' },
    }),
    /inside the Flow download root/i,
  );
});

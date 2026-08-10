import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { writeBatchPackage } from '../scripts/companion/facebook-library.mjs';

test('writes a portable batch, context snapshot, and draft package', async () => {
  const libraryRoot = await mkdtemp(join(tmpdir(), 'seosona-content-package-'));
  const batch = {
    contractVersion: '2.0', id: 'batch-1', requestedCount: 1, contextRevision: 'ctx-1',
    status: 'completed', drafts: [{ id: 'post-01', status: 'asset_ready' }], history: [],
  };
  const snapshot = { contractVersion: '1.0', contextRevision: 'ctx-1', brand: { id: 'seosona' }, group: { id: 'seo-vn' }, policy: {} };
  const draft = {
    id: 'post-01', status: 'asset_ready',
    package: { idea: 'SEO audit', copy: 'Bài viết', cta: 'Bạn nghĩ sao?', claims: [], creativeBrief: { visualPrompt: 'SEO desk', ratio: '1:1' } },
    receipt: { assetId: 'asset-1', fileRef: 'content-library://batch-1/post-01/post.png' },
  };

  const result = await writeBatchPackage({ libraryRoot, batch, snapshot, draft });
  const batchJson = JSON.parse(await readFile(result.runtimeBatchRef, 'utf8'));
  const contextJson = JSON.parse(await readFile(result.runtimeContextRef, 'utf8'));
  const draftJson = JSON.parse(await readFile(result.runtimeDraftRef, 'utf8'));

  assert.equal(result.batchRef, 'content-library://batch-1/batch.json');
  assert.equal(result.contextRef, 'content-library://batch-1/context.snapshot.json');
  assert.equal(result.draftRef, 'content-library://batch-1/post-01/draft.json');
  assert.equal(batchJson.id, 'batch-1');
  assert.equal(contextJson.contextRevision, 'ctx-1');
  assert.equal(draftJson.package.idea, 'SEO audit');
  assert.doesNotMatch(JSON.stringify({ batchJson, contextJson, draftJson }), new RegExp(libraryRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
});

test('rejects package identifiers that escape the Content Library', async () => {
  const libraryRoot = await mkdtemp(join(tmpdir(), 'seosona-content-package-'));
  await assert.rejects(
    writeBatchPackage({
      libraryRoot,
      batch: { id: '../escape', contextRevision: 'ctx-1', requestedCount: 1, drafts: [] },
      snapshot: { contextRevision: 'ctx-1' },
      draft: { id: 'post-01' },
    }),
    /Batch id contains unsupported path characters/i,
  );
});

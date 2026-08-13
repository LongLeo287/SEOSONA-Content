import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaceStore } from '../runtime/storage/workspace-store.mjs';

async function tempStore() {
  const rootDir = await mkdtemp(join(tmpdir(), 'seosona-store-'));
  return { rootDir, store: createWorkspaceStore({ rootDir }) };
}

test('store creates reads lists and updates mutable records', async () => {
  const { store } = await tempStore();
  const now = '2026-08-13T00:00:00.000Z';
  await store.put('project', 'workspace_1', { projectId: 'project_1', workspaceId: 'workspace_1', name: 'A', status: 'active', createdAt: now });
  assert.equal((await store.get('project', 'workspace_1', 'project_1')).name, 'A');
  assert.deepEqual((await store.list('project', 'workspace_1')).map(x => x.projectId), ['project_1']);
  await store.put('project', 'workspace_1', { projectId: 'project_1', workspaceId: 'workspace_1', name: 'B', status: 'active', createdAt: now });
  assert.equal((await store.get('project', 'workspace_1', 'project_1')).name, 'B');
});

test('store rejects traversal in scope and record ids', async () => {
  const { store } = await tempStore();
  await assert.rejects(() => store.get('project', '../outside', 'project_1'), /Invalid scope id/);
  await assert.rejects(() => store.get('project', 'workspace_1', '../project'), /Invalid record id/);
});

test('immutable records allow idempotent same content but reject different content', async () => {
  const { store } = await tempStore();
  const first = { revisionId: 'revision_1', contentId: 'content_1', operation: 'CREATE', payload: { body: 'A', meta: { b: 2, a: 1 } }, createdAt: 'now' };
  await store.put('revision', 'workspace_1', first);
  await store.put('revision', 'workspace_1', { ...first, payload: { meta: { a: 1, b: 2 }, body: 'A' } });
  await assert.rejects(
    () => store.put('revision', 'workspace_1', { ...first, payload: { body: 'B' } }),
    (error) => error && error.code === 'IMMUTABLE_RECORD_CONFLICT'
  );
});

test('blobs are content addressed and return portable refs only', async () => {
  const { rootDir, store } = await tempStore();
  const value = await store.putBlob('workspace_1', 'source_1', Buffer.from('hello'));
  assert.equal(value.sha256, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  assert.equal(value.size, 5);
  assert.equal(value.blobRef, `seosona-local://workspace_1/blobs/${value.sha256}`);
  assert.equal(value.blobRef.includes(rootDir), false);
  assert.equal((await store.readBlob(value.blobRef)).toString(), 'hello');
  const second = await store.putBlob('workspace_1', 'different_label', Buffer.from('hello'));
  assert.deepEqual(second, value);
});

test('record files are valid JSON and no temp file is exposed by normal reads', async () => {
  const { rootDir, store } = await tempStore();
  const record = { projectId: 'project_1', workspaceId: 'workspace_1', name: 'A', status: 'active', createdAt: 'now' };
  await store.put('project', 'workspace_1', record);
  const raw = await readFile(join(rootDir, 'workspaces', 'workspace_1', 'records', 'project', 'project_1.json'), 'utf8');
  assert.deepEqual(JSON.parse(raw), record);
});

test('concurrent different writes to one immutable id allow exactly one winner', async () => {
  const { store } = await tempStore();
  const base = { revisionId: 'revision_race', contentId: 'content_1', operation: 'CREATE', createdAt: 'now' };
  const results = await Promise.allSettled([
    store.put('revision', 'workspace_1', { ...base, payload: { body: 'A' } }),
    store.put('revision', 'workspace_1', { ...base, payload: { body: 'B' } }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const rejected = results.find((r) => r.status === 'rejected');
  assert.equal(rejected.reason.code, 'IMMUTABLE_RECORD_CONFLICT');
  const stored = await store.get('revision', 'workspace_1', 'revision_race');
  assert.ok(['A', 'B'].includes(stored.payload.body));
});

test('each concurrent same-content blob writer resolves only after its portable ref is readable', async () => {
  const { store } = await tempStore();
  const writes = Array.from({ length: 12 }, (_, index) => store.putBlob('workspace_1', `blob_${index}`, Buffer.from('same-content')).then(async (receipt) => {
    assert.equal((await store.readBlob(receipt.blobRef)).toString(), 'same-content');
    return receipt;
  }));
  const receipts = await Promise.all(writes);
  assert.equal(new Set(receipts.map((r) => r.sha256)).size, 1);
});

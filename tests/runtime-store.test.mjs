import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createWorkspaceStore } from '../runtime/storage/workspace-store.mjs';

const NOW = '2026-08-12T00:00:00.000Z';
const WS = 'workspace_1';

async function withStore(fn) {
  const rootDir = await mkdtemp(join(tmpdir(), 'seosona-store-'));
  try {
    await fn(createWorkspaceStore({ rootDir }), rootDir);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

const project = (over = {}) => ({
  projectId: 'project_1', workspaceId: WS, name: 'A', createdAt: NOW, ...over,
});
const revision = (over = {}) => ({
  revisionId: 'revision_1', contentId: 'content_1', operation: 'CREATE',
  payload: { body: 'Hello' }, createdAt: NOW, ...over,
});

test('put/get/list roundtrip', async () => {
  await withStore(async (store) => {
    await store.put('project', WS, project());
    assert.equal((await store.get('project', WS, 'project_1')).name, 'A');
    await store.put('project', WS, project({ projectId: 'project_2', name: 'B' }));
    const ids = (await store.list('project', WS)).map((x) => x.projectId).sort();
    assert.deepEqual(ids, ['project_1', 'project_2']);
  });
});

test('get returns null for a missing record, list returns [] for a missing type', async () => {
  await withStore(async (store) => {
    assert.equal(await store.get('project', WS, 'project_nope'), null);
    assert.deepEqual(await store.list('project', WS), []);
  });
});

test('records are validated before they touch disk', async () => {
  await withStore(async (store, rootDir) => {
    await assert.rejects(() => store.put('project', WS, { projectId: 'project_1' }), /workspaceId/);
    // nothing must have been written
    await assert.rejects(() => readdir(join(rootDir, 'workspaces', WS, 'records', 'project')));
  });
});

test('path traversal is rejected in both id and scope', async () => {
  await withStore(async (store) => {
    await assert.rejects(() => store.get('project', WS, '../../etc/passwd'), /unsafe id/i);
    await assert.rejects(() => store.get('project', '../escape', 'project_1'), /unsafe id/i);
    await assert.rejects(() => store.put('project', WS, project({ projectId: 'a/b' })), /unsafe id/i);
    await assert.rejects(() => store.get('project', WS, 'UPPERCASE'), /unsafe id/i);
  });
});

test('unknown record type is rejected', async () => {
  await withStore(async (store) => {
    await assert.rejects(() => store.put('nope', WS, { id: 'x' }), /unknown record type/i);
  });
});

test('mutable records may be updated in place', async () => {
  await withStore(async (store) => {
    await store.put('project', WS, project());
    await store.put('project', WS, project({ name: 'Renamed' }));
    assert.equal((await store.get('project', WS, 'project_1')).name, 'Renamed');
  });
});

test('immutable record rewritten with different bytes is rejected', async () => {
  await withStore(async (store) => {
    await store.put('revision', WS, revision());
    await assert.rejects(
      () => store.put('revision', WS, revision({ payload: { body: 'Changed' } })),
      (err) => err.code === 'IMMUTABLE_RECORD_CONFLICT',
    );
    assert.equal((await store.get('revision', WS, 'revision_1')).payload.body, 'Hello');
  });
});

test('immutable record rewritten with identical bytes is idempotent', async () => {
  await withStore(async (store) => {
    await store.put('revision', WS, revision());
    await store.put('revision', WS, revision());
    assert.equal((await store.get('revision', WS, 'revision_1')).payload.body, 'Hello');
  });
});

test('blob is content-addressed and blobRef leaks no absolute path', async () => {
  await withStore(async (store, rootDir) => {
    const bytes = Buffer.from('the source bytes', 'utf8');
    const expected = createHash('sha256').update(bytes).digest('hex');
    const res = await store.putBlob(WS, 'source_1', bytes);
    assert.equal(res.sha256, expected);
    assert.equal(res.size, bytes.length);
    assert.equal(res.blobRef, `seosona-local://${WS}/blobs/${expected}`);
    assert.ok(!res.blobRef.includes(rootDir), 'blobRef must not contain the root path');
    assert.ok(!res.blobRef.includes(':\\') && !res.blobRef.startsWith('/'), 'blobRef must not be an OS path');
  });
});

test('blob roundtrips and identical content converges', async () => {
  await withStore(async (store) => {
    const bytes = Buffer.from('same bytes', 'utf8');
    const a = await store.putBlob(WS, 'source_1', bytes);
    const b = await store.putBlob(WS, 'source_2', bytes);
    assert.equal(a.sha256, b.sha256);
    assert.equal(a.blobRef, b.blobRef);
    assert.deepEqual(await store.readBlob(a.blobRef), bytes);
  });
});

test('readBlob rejects a foreign or malformed ref', async () => {
  await withStore(async (store) => {
    await assert.rejects(() => store.readBlob('file:///etc/passwd'), /blobRef/i);
    await assert.rejects(() => store.readBlob(`seosona-local://${WS}/blobs/../escape`), /blobRef/i);
  });
});

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

// Hồi quy: loại bản ghi viết camelCase (contextSnapshot, sourceBlock…) từng bị kho từ chối
// vì `type` bị kiểm bằng regex chữ-thường-only. Mọi loại đã khai báo phải đi trọn vòng.
test('every declared record type round-trips through the store', async () => {
  const { RECORD_TYPES, RECORD_ID_FIELD } = await import('../runtime/domain/records.mjs');
  const SAMPLE = {
    workspace: { workspaceId: 'workspace_1', name: 'W', createdAt: NOW },
    project: project(),
    brand: { brandId: 'brand_1', workspaceId: WS, name: 'B', createdAt: NOW },
    source: { sourceId: 'source_1', projectId: 'project_1', sha256: 'abc', retrievedAt: NOW },
    sourceBlock: { blockId: 'sourceblock_1', sourceId: 'source_1', locator: { page: 1 } },
    evidence: { evidenceId: 'evidence_1', sourceId: 'source_1', statement: 'X' },
    claim: { claimId: 'claim_1', proposition: 'P', strength: 'ASSOCIATED' },
    content: { contentId: 'content_1', projectId: 'project_1', contentJob: 'article', createdAt: NOW },
    revision: revision(),
    job: { jobId: 'job_1', projectId: 'project_1', contextSnapshotId: 'contextsnapshot_1', status: 'PENDING', createdAt: NOW },
    jobStage: { stageId: 'jobstage_1', jobId: 'job_1', stage: 'WRITE', status: 'PENDING' },
    providerAttempt: { attemptId: 'providerattempt_1', jobId: 'job_1', provider: 'p', startedAt: NOW },
    providerReceipt: { receiptId: 'providerreceipt_1', provider: 'p', at: NOW },
    evaluation: { evaluationId: 'evaluation_1', revisionId: 'revision_1', evaluator: 'fact', verdict: 'PASS' },
    contextSnapshot: { contextSnapshotId: 'contextsnapshot_1', hash: 'abc', compiledAt: NOW },
    providerConfig: { providerConfigId: 'providerconfig_1', provider: 'p' },
    signal: { signalId: 'signal_1', type: 'ACCEPT', at: NOW },
    appliedPageEvent: { eventId: 'appliedpageevent_1', revisionId: 'revision_1', url: 'https://x.test', surface: 'extension', action: 'INSERT', at: NOW },
  };
  await withStore(async (store) => {
    for (const type of RECORD_TYPES) {
      const rec = SAMPLE[type];
      assert.ok(rec, `missing sample for record type "${type}"`);
      await store.put(type, WS, rec);
      const id = rec[RECORD_ID_FIELD[type]];
      assert.ok(await store.get(type, WS, id), `${type} must be readable after write`);
      assert.equal((await store.list(type, WS)).length, 1, `${type} must be listable`);
    }
  });
});

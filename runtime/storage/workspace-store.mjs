import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { canonicalJson, writeJsonAtomic, writeJsonExclusiveAtomic } from '../lib/atomic-json.mjs';

const ID_RE = /^[a-z][a-z0-9_:-]{1,159}$/;
const IMMUTABLE = new Set(['revision', 'sourceBlock', 'providerReceipt', 'contextSnapshot']);
const PRIMARY_KEY = {
  workspace: 'workspaceId', project: 'projectId', brand: 'brandId', source: 'sourceId', sourceBlock: 'blockId', evidence: 'evidenceId',
  claim: 'claimId', content: 'contentId', revision: 'revisionId', job: 'jobId', jobStage: 'stageId', providerAttempt: 'attemptId',
  providerReceipt: 'receiptId', evaluation: 'evaluationId', contextSnapshot: 'contextSnapshotId', providerConfig: 'providerConfigId',
  signal: 'signalId', appliedPageEvent: 'eventId',
};

function assertId(label, value) {
  if (typeof value !== 'string' || !ID_RE.test(value)) throw new Error(`Invalid ${label}: ${value}.`);
  return value;
}

function recordId(type, record) {
  const key = PRIMARY_KEY[type];
  if (!key) throw new Error(`Unknown record type: ${type}.`);
  return assertId('record id', record && record[key]);
}

function workspaceRoot(rootDir, scopeId) {
  return join(rootDir, 'workspaces', assertId('scope id', scopeId));
}

async function readJson(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error && error.code === 'ENOENT') return null; throw error; }
}

async function writeBlobAtomic(file, bytes) {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, bytes, { flag: 'wx' });
    await rename(temp, file);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}

export function createWorkspaceStore({ rootDir }) {
  if (!rootDir) throw new Error('rootDir is required.');
  const root = resolve(rootDir);
  const recovering = new Map();

  function recordFile(type, scopeId, record) {
    const id = recordId(type, record);
    return { id, file: join(workspaceRoot(root, scopeId), 'records', type, `${id}.json`) };
  }

  async function putRecord(type, scopeId, record) {
    const { id, file } = recordFile(type, scopeId, record);
    if (IMMUTABLE.has(type)) {
      const existing = await readJson(file);
      if (existing) {
        if (canonicalJson(existing) === canonicalJson(record)) return structuredClone(existing);
        const error = new Error(`${type} ${id} is immutable.`);
        error.code = 'IMMUTABLE_RECORD_CONFLICT';
        throw error;
      }
      try {
        await writeJsonExclusiveAtomic(file, record);
        return structuredClone(record);
      } catch (error) {
        if (!error || error.code !== 'EEXIST') throw error;
        const winner = await readJson(file);
        if (winner && canonicalJson(winner) === canonicalJson(record)) return structuredClone(winner);
        const conflict = new Error(`${type} ${id} is immutable.`);
        conflict.code = 'IMMUTABLE_RECORD_CONFLICT';
        throw conflict;
      }
    }
    await writeJsonAtomic(file, record);
    return structuredClone(record);
  }

  function validateBatch(entries) {
    if (!Array.isArray(entries) || entries.length < 1) throw new Error('Batch must contain at least one record.');
    let scopeId = null;
    const normalized = entries.map((entry) => {
      if (!entry || typeof entry !== 'object') throw new Error('Batch entries must be objects.');
      const scope = assertId('scope id', entry.scopeId);
      recordId(entry.type, entry.record);
      if (scopeId === null) scopeId = scope;
      if (scope !== scopeId) throw new Error('Batch entries must share one scope id.');
      return { type: entry.type, record: structuredClone(entry.record) };
    });
    return { scopeId, entries: normalized };
  }

  async function commitManifest(manifest) {
    for (const entry of manifest.entries) await putRecord(entry.type, manifest.scopeId, entry.record);
  }

  async function recoverPending(scopeId) {
    assertId('scope id', scopeId);
    if (recovering.has(scopeId)) return recovering.get(scopeId);
    const operation = (async () => {
      const dir = join(workspaceRoot(root, scopeId), 'transactions');
      let names;
      try { names = await readdir(dir); } catch (error) { if (error && error.code === 'ENOENT') return; throw error; }
      for (const name of names.filter((value) => /^tx_[a-zA-Z0-9_-]+\.json$/.test(value)).sort()) {
        const file = join(dir, name);
        const manifest = await readJson(file);
        if (!manifest) continue;
        if (manifest.version !== 1 || manifest.scopeId !== scopeId || !Array.isArray(manifest.entries)) throw new Error(`Invalid transaction journal: ${name}.`);
        validateBatch(manifest.entries.map((entry) => ({ ...entry, scopeId })));
        await commitManifest(manifest);
        await unlink(file);
      }
    })().finally(() => recovering.delete(scopeId));
    recovering.set(scopeId, operation);
    return operation;
  }

  return {
    async put(type, scopeId, record) {
      await recoverPending(scopeId);
      return putRecord(type, scopeId, record);
    },

    async putBatch(entries) {
      const validated = validateBatch(entries);
      await recoverPending(validated.scopeId);
      const manifest = { version: 1, scopeId: validated.scopeId, entries: validated.entries };
      const txFile = join(workspaceRoot(root, validated.scopeId), 'transactions', `tx_${randomUUID().replace(/-/g, '')}.json`);
      await writeJsonAtomic(txFile, manifest);
      await commitManifest(manifest);
      await unlink(txFile);
      return validated.entries.map((entry) => structuredClone(entry.record));
    },

    async get(type, scopeId, id) {
      await recoverPending(scopeId);
      assertId('record id', id);
      if (!PRIMARY_KEY[type]) throw new Error(`Unknown record type: ${type}.`);
      const file = join(workspaceRoot(root, scopeId), 'records', type, `${id}.json`);
      const value = await readJson(file);
      return value ? structuredClone(value) : null;
    },

    async list(type, scopeId) {
      await recoverPending(scopeId);
      if (!PRIMARY_KEY[type]) throw new Error(`Unknown record type: ${type}.`);
      const dir = join(workspaceRoot(root, scopeId), 'records', type);
      let names;
      try { names = await readdir(dir); } catch (error) { if (error && error.code === 'ENOENT') return []; throw error; }
      const values = await Promise.all(names.filter((name) => name.endsWith('.json')).sort().map((name) => readJson(join(dir, name))));
      return values.filter(Boolean);
    },

    async putBlob(scopeId, blobId, bytes) {
      await recoverPending(scopeId);
      assertId('blob id', blobId);
      const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
      const sha256 = createHash('sha256').update(data).digest('hex');
      const file = join(workspaceRoot(root, scopeId), 'blobs', `${sha256}.bin`);
      try {
        await stat(file);
      } catch (error) {
        if (!error || error.code !== 'ENOENT') throw error;
        await writeBlobAtomic(file, data);
      }
      return { blobRef: `seosona-local://${scopeId}/blobs/${sha256}`, sha256, size: data.length };
    },

    async readBlob(blobRef) {
      const match = /^seosona-local:\/\/([a-z][a-z0-9_:-]{1,159})\/blobs\/([a-f0-9]{64})$/.exec(String(blobRef || ''));
      if (!match) throw new Error('Invalid blobRef.');
      await recoverPending(match[1]);
      return readFile(join(workspaceRoot(root, match[1]), 'blobs', `${match[2]}.bin`));
    },
  };
}

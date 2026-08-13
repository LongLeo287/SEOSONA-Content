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

  return {
    async put(type, scopeId, record) {
      const id = recordId(type, record);
      const file = join(workspaceRoot(root, scopeId), 'records', type, `${id}.json`);
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
    },

    async get(type, scopeId, id) {
      assertId('record id', id);
      if (!PRIMARY_KEY[type]) throw new Error(`Unknown record type: ${type}.`);
      const file = join(workspaceRoot(root, scopeId), 'records', type, `${id}.json`);
      const value = await readJson(file);
      return value ? structuredClone(value) : null;
    },

    async list(type, scopeId) {
      if (!PRIMARY_KEY[type]) throw new Error(`Unknown record type: ${type}.`);
      const dir = join(workspaceRoot(root, scopeId), 'records', type);
      let names;
      try { names = await readdir(dir); } catch (error) { if (error && error.code === 'ENOENT') return []; throw error; }
      const values = await Promise.all(names.filter((name) => name.endsWith('.json')).sort().map((name) => readJson(join(dir, name))));
      return values.filter(Boolean);
    },

    async putBlob(scopeId, blobId, bytes) {
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
      return readFile(join(workspaceRoot(root, match[1]), 'blobs', `${match[2]}.bin`));
    },
  };
}

import { link, mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
    return Object.keys(value).sort().reduce((output, key) => {
      output[key] = canonicalize(value[key]);
      return output;
    }, {});
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value), null, 2) + '\n';
}

export async function writeJsonAtomic(file, value) {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, canonicalJson(value), { encoding: 'utf8', flag: 'wx' });
    await rename(temp, file);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}

export async function writeJsonExclusiveAtomic(file, value) {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, canonicalJson(value), { encoding: 'utf8', flag: 'wx' });
    await link(temp, file);
  } finally {
    await unlink(temp).catch(() => {});
  }
}

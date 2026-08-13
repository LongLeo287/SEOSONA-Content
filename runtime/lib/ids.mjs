import { randomUUID } from 'node:crypto';

export function makeId(prefix, { now = Date.now, random = randomUUID } = {}) {
  const safePrefix = String(prefix).toLowerCase().replace(/[^a-z0-9]+/g, '');
  const suffix = String(random()).toLowerCase().replace(/[^a-z0-9]+/g, '');
  const stamp = Number(now());
  if (!safePrefix || !suffix || !Number.isFinite(stamp)) throw new Error('ID prefix, timestamp, and random suffix are required.');
  return `${safePrefix}_${stamp}_${suffix}`;
}

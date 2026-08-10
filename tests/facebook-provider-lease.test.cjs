const test = require('node:test');
const assert = require('node:assert/strict');

const Lease = require('../extension/lib/facebook-provider-lease.js');

test('uses the latest retry lease instead of the first provider start time', () => {
  const job = {
    status: 'running',
    startedAt: 1_000,
    leaseUpdatedAt: 350_000,
    spec: { timeout: 300_000 },
  };
  assert.equal(Lease.isExpired(job, 400_000), false);
});

test('expires a provider job only after its refreshed lease and grace window', () => {
  const job = {
    status: 'running',
    startedAt: 1_000,
    leaseUpdatedAt: 350_000,
    spec: { timeout: 300_000 },
  };
  assert.equal(Lease.isExpired(job, 710_001), true);
  assert.equal(Lease.isExpired({ ...job, status: 'done' }, 999_999), false);
});

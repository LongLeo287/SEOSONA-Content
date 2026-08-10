/* SEOSONA Facebook provider lease - pure MV3-safe stale-job policy. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FacebookProviderLease = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function isExpired(job, now) {
    if (!job || !['preparing', 'running'].includes(job.status)) return false;
    const timeout = Number(job.spec && job.spec.timeout) || 300000;
    const leaseAt = Number(job.leaseUpdatedAt || job.startedAt || 0);
    return !leaseAt || Number(now) - leaseAt > timeout + 60000;
  }

  return { isExpired };
});

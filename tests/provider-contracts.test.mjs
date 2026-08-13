import test from 'node:test';
import assert from 'node:assert/strict';
import { assertProviderTask, assertProviderResult, COST_CLASSES, BROWSER_STATES, TASK_TYPES } from '../runtime/providers/contracts.mjs';

function task(overrides = {}) {
  return {
    taskId: 'task_1', taskType: 'WRITE', contentJob: 'article', requiredCapabilities: ['writing'],
    contextSnapshotId: 'context_1', contextBundle: { brief: 'Write clearly' }, outputContract: { type: 'ArticleIR' },
    privacyPolicy: { denyProviders: [] }, costPolicy: { paidApi: false }, timeoutMs: 300000, providerPreference: 'auto',
    ...overrides,
  };
}

test('provider constants expose only approved V1 values', () => {
  assert.deepEqual([...COST_CLASSES], ['ZERO_INCREMENTAL','FREE_QUOTA','PAID_ALLOWED','PAID_BLOCKED','UNKNOWN_COST']);
  assert.deepEqual([...BROWSER_STATES], ['READY','AUTH_REQUIRED','BUSY','RATE_LIMITED','UI_CHANGED','CONTENT_BLOCKED','TIMEOUT','COMPLETED','UNAVAILABLE']);
  assert.deepEqual([...TASK_TYPES], ['WRITE','EDIT','AUDIT','RESEARCH','EXTRACT','STRUCTURE','REPURPOSE']);
});

test('ProviderTask rejects missing ids, invalid task types and provider-layer leakage', () => {
  assert.throws(() => assertProviderTask(task({ taskId: '' })), /taskId/);
  assert.throws(() => assertProviderTask(task({ taskType: 'VIDEO' })), /taskType/);
  for (const field of ['selector', 'tabId', 'chrome', 'cookie', 'apiKey']) assert.throws(() => assertProviderTask(task({ [field]: 'leak' })), new RegExp(field));
});

test('ProviderTask validates structured neutral task without mutating input', () => {
  const input = task();
  const output = assertProviderTask(input);
  output.contextBundle.brief = 'changed';
  assert.equal(input.contextBundle.brief, 'Write clearly');
  assert.equal(output.taskType, 'WRITE');
});

test('ProviderResult rejects invalid cost class and validates completed/failed results', () => {
  const completed = assertProviderResult({
    status: 'COMPLETED', output: { body: 'done' }, providerId: 'claude-web', modelSession: 'sonnet',
    startedAt: '2026-08-13T05:00:00.000Z', completedAt: '2026-08-13T05:00:01.000Z', costClass: 'ZERO_INCREMENTAL',
    parseStatus: 'VALID', warnings: [], error: null, receipt: { receiptId: 'receipt_1', resultDigest: 'abc' },
  });
  assert.equal(completed.status, 'COMPLETED');
  assert.throws(() => assertProviderResult({ ...completed, costClass: 'FREEISH' }), /costClass/);
  const failed = assertProviderResult({ ...completed, status: 'FAILED', output: null, error: { code: 'TIMEOUT', message: 'Timed out', retryable: true }, parseStatus: 'NOT_PARSED' });
  assert.equal(failed.error.retryable, true);
});

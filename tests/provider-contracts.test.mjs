import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertProviderTask,
  assertProviderResult,
  COST_CLASSES,
  BROWSER_STATES,
  TASK_TYPES,
  PARSE_STATUSES,
  isZeroIncremental,
} from '../runtime/providers/contracts.mjs';

function validTask(overrides = {}) {
  return {
    taskId: 'providertask_1',
    taskType: 'WRITE',
    contentJob: 'article',
    contextSnapshotId: 'contextsnapshot_1',
    contextBundle: { prompt: 'Write about X' },
    ...overrides,
  };
}

function validResult(overrides = {}) {
  return {
    status: 'COMPLETED',
    output: { body: 'text' },
    providerId: 'chatgpt-web',
    startedAt: '2026-08-13T00:00:00.000Z',
    completedAt: '2026-08-13T00:00:10.000Z',
    costClass: 'ZERO_INCREMENTAL',
    ...overrides,
  };
}

// ---------------------------------------------------------------- bảng giá trị hợp lệ

test('cost classes, browser states and task types are the exact declared sets', () => {
  assert.deepEqual([...COST_CLASSES].sort(), [
    'FREE_QUOTA', 'PAID_ALLOWED', 'PAID_BLOCKED', 'UNKNOWN_COST', 'ZERO_INCREMENTAL',
  ]);
  assert.deepEqual([...BROWSER_STATES].sort(), [
    'AUTH_REQUIRED', 'BUSY', 'COMPLETED', 'CONTENT_BLOCKED', 'RATE_LIMITED',
    'READY', 'TIMEOUT', 'UI_CHANGED', 'UNAVAILABLE',
  ]);
  assert.deepEqual([...TASK_TYPES].sort(), [
    'AUDIT', 'EDIT', 'EXTRACT', 'REPURPOSE', 'RESEARCH', 'STRUCTURE', 'WRITE',
  ]);
  assert.ok(PARSE_STATUSES.has('NOT_APPLICABLE'));
});

// Chỉ đúng một hạng mục là "không tốn thêm tiền". UNKNOWN_COST không bao giờ được coi là free.
test('only ZERO_INCREMENTAL counts as free; UNKNOWN_COST never does', () => {
  assert.equal(isZeroIncremental('ZERO_INCREMENTAL'), true);
  for (const c of ['FREE_QUOTA', 'PAID_ALLOWED', 'PAID_BLOCKED', 'UNKNOWN_COST', undefined]) {
    assert.equal(isZeroIncremental(c), false, `${c} must not be reported as zero incremental`);
  }
});

// ---------------------------------------------------------------- ProviderTask

test('provider task requires an id, a snapshot and a context bundle', () => {
  for (const field of ['taskId', 'contentJob', 'contextSnapshotId']) {
    const task = validTask();
    delete task[field];
    assert.throws(() => assertProviderTask(task), /providerTask/, `missing ${field} must be rejected`);
  }
  assert.throws(() => assertProviderTask(validTask({ contextBundle: null })), /contextBundle/);
  assert.throws(() => assertProviderTask(null), /providerTask/);
});

test('provider task rejects an unknown task type', () => {
  assert.throws(() => assertProviderTask(validTask({ taskType: 'SUMMARISE' })), /taskType/);
  assert.throws(() => assertProviderTask(validTask({ taskType: 'write' })), /taskType/);
});

test('provider task rejects an unknown cost policy class', () => {
  assert.throws(
    () => assertProviderTask(validTask({ costPolicy: { paidApi: false, allow: ['CHEAP'] } })),
    /costPolicy/,
  );
  const ok = assertProviderTask(validTask({ costPolicy: { paidApi: true, allow: ['PAID_ALLOWED'] } }));
  assert.equal(ok.costPolicy.paidApi, true);
});

// Đây là hàng rào tầng: Writing Core mô tả VIỆC CẦN LÀM, không mô tả CÁCH bấm vào trang web.
// Selector/tab/cookie/apiKey là chuyện nội bộ của adapter, lọt lên đây là kiến trúc đã rò.
test('provider task rejects browser and secret fields at the contract boundary', () => {
  for (const field of ['selector', 'tabId', 'chrome', 'cookie', 'apiKey']) {
    assert.throws(
      () => assertProviderTask(validTask({ [field]: 'x' })),
      new RegExp(field, 'i'),
      `${field} must not cross the provider contract boundary`,
    );
  }
  // Viết hoa/thường khác nhau vẫn là rò rỉ.
  assert.throws(() => assertProviderTask(validTask({ TabId: 12 })), /tabId/i);
});

test('provider task fills stable defaults instead of leaving fields undefined', () => {
  const task = assertProviderTask(validTask());
  assert.deepEqual(task.requiredCapabilities, []);
  assert.deepEqual(task.warnings, undefined, 'no invented fields');
  assert.equal(task.taskType, 'WRITE');
  assert.equal(task.providerPreference, null, 'no manual lock by default');
  assert.equal(task.costPolicy.paidApi, false, 'paid API is off unless asked for');
  assert.ok(task.timeoutMs > 0);
  assert.deepEqual(task.outputContract, {});
  assert.equal(task.privacyPolicy.allowRemote, true);
});

test('provider task timeout must be a positive finite number', () => {
  for (const bad of [0, -1, Number.NaN, Infinity, '30000']) {
    assert.throws(() => assertProviderTask(validTask({ timeoutMs: bad })), /timeoutMs/);
  }
});

test('provider task validation returns a detached copy', () => {
  const input = validTask();
  const task = assertProviderTask(input);
  task.contextBundle.prompt = 'mutated';
  assert.equal(input.contextBundle.prompt, 'Write about X', 'caller object must not be mutated');
});

// ---------------------------------------------------------------- ProviderResult

test('provider result requires a known status and cost class', () => {
  assert.throws(() => assertProviderResult(validResult({ status: 'DONE' })), /status/);
  assert.throws(() => assertProviderResult(validResult({ costClass: 'CHEAP' })), /costClass/);
  assert.throws(() => assertProviderResult(validResult({ providerId: '' })), /providerId/);
});

// Một kết quả "thành công" mà vẫn kèm lỗi là mâu thuẫn — bắt ngay tại biên, đừng để trôi xuống Gateway.
test('completed results carry no error and failures must carry one', () => {
  assert.throws(
    () => assertProviderResult(validResult({ error: { code: 'TIMEOUT', message: 'x', retryable: true } })),
    /error/,
  );
  assert.throws(() => assertProviderResult(validResult({ status: 'FAILED', error: null })), /error/);
  assert.throws(() => assertProviderResult(validResult({ status: 'BLOCKED', error: null })), /error/);

  const failed = assertProviderResult(validResult({
    status: 'FAILED', output: null, error: { code: 'RATE_LIMITED', message: 'slow down', retryable: true },
  }));
  assert.equal(failed.error.retryable, true);
});

test('provider result error must declare retryable explicitly', () => {
  assert.throws(
    () => assertProviderResult(validResult({ status: 'FAILED', output: null, error: { code: 'X', message: 'm' } })),
    /retryable/,
  );
});

test('provider result timestamps must be ordered', () => {
  assert.throws(
    () => assertProviderResult(validResult({ completedAt: '2026-08-12T23:59:00.000Z' })),
    /completedAt/,
  );
  assert.throws(() => assertProviderResult(validResult({ startedAt: 'yesterday' })), /startedAt/);
});

test('provider result defaults are stable and parse status is validated', () => {
  const result = assertProviderResult(validResult());
  assert.deepEqual(result.warnings, []);
  assert.equal(result.error, null);
  assert.equal(result.modelSession, null);
  assert.equal(result.receipt, null);
  assert.equal(result.parseStatus, 'NOT_APPLICABLE');
  assert.throws(() => assertProviderResult(validResult({ parseStatus: 'FINE' })), /parseStatus/);
});

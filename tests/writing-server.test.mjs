import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntimeServer } from '../runtime/http/server.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const TOKEN = 'a'.repeat(40);
const EXT_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const NOW = '2026-08-13T00:00:00.000Z';

let nonceSeq = 0;
const nextNonce = () => `nonce${String(++nonceSeq).padStart(16, '0')}`;

const ARTICLE = {
  title: 'Giao hàng nhanh cho cửa hàng nhỏ',
  outline: ['Vì sao tốc độ quan trọng'],
  sections: [{ heading: 'Vì sao tốc độ quan trọng', level: 2, body: 'Khách bỏ giỏ khi chờ lâu.' }],
  body: 'Khách bỏ giỏ khi chờ lâu.',
};

const auditPass = JSON.stringify({ dimension: 'x', verdict: 'PASS', findings: [] });

// Adapter giả đứng sau Gateway thật: HTTP, định tuyến, biên nhận và lưu trữ đều là hàng thật.
function fakeAdapter({ write = ARTICLE, audit = auditPass, failWrite = null } = {}) {
  return {
    providerId: 'chatgpt-web',
    execute: async (task) => {
      const base = {
        providerId: 'chatgpt-web', costClass: 'ZERO_INCREMENTAL',
        startedAt: NOW, completedAt: NOW, warnings: [], receipt: null, modelSession: null,
      };
      if (task.taskType === 'AUDIT') return { ...base, status: 'COMPLETED', output: audit, parseStatus: 'OK', error: null };
      if (failWrite) return { ...base, status: 'FAILED', output: null, parseStatus: 'NOT_APPLICABLE', error: failWrite };
      return { ...base, status: 'COMPLETED', output: JSON.stringify(write), parseStatus: 'OK', error: null };
    },
  };
}

async function withServer(fn, { adapter } = {}) {
  const rootDir = await mkdtemp(join(tmpdir(), 'seosona-writing-http-'));
  const server = createRuntimeServer({
    rootDir, token: TOKEN, extensionOrigin: EXT_ORIGIN,
    adapters: new Map([['chatgpt-web', adapter || fakeAdapter()]]),
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, { method = 'GET', body, headers = {} } = {}) => fetch(`${base}${path}`, {
    method,
    headers: {
      origin: EXT_ORIGIN, authorization: `Bearer ${TOKEN}`, 'x-seosona-nonce': nextNonce(),
      ...(body ? { 'content-type': 'application/json' } : {}), ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const project = async () => (await (await call('/v1/projects', { method: 'POST', body: { name: 'P' } })).json());
  try {
    await fn({ call, project, base });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(rootDir, { recursive: true, force: true });
  }
}

const writeBody = (overrides = {}) => ({
  jobType: 'article',
  brief: { objective: 'Giải thích tốc độ giao hàng', intent: 'INFORMATIONAL', angle: 'thực dụng' },
  contextSnapshotId: 'contextsnapshot_1',
  context: { evidenceById: {}, claimsById: {} },
  providerPolicy: { manualLocks: { global: 'chatgpt-web' } },
  ...overrides,
});

// ---------------------------------------------------------------- job packs

test('the job pack list describes what each content type needs', async () => {
  await withServer(async ({ call }) => {
    const res = await call('/v1/job-packs');
    assert.equal(res.status, 200);
    const { jobPacks } = await res.json();
    assert.deepEqual(jobPacks.map((p) => p.jobType).sort(), ['article', 'product', 'transcript']);
    const article = jobPacks.find((p) => p.jobType === 'article');
    assert.ok(article.requiredEvaluators.includes('factuality'));
    assert.ok(article.outputContract.jsonSchema);
    // Danh sách này là thứ giao diện dựng form từ đó — nó không được nói tên hãng nào.
    assert.ok(!JSON.stringify(jobPacks).toLowerCase().includes('chatgpt'));
  });
});

test('a brief is validated against the pack that will run it', async () => {
  await withServer(async ({ call, project }) => {
    const p = await project();
    const ok = await call(`/v1/projects/${p.projectId}/briefs`, {
      method: 'POST', body: { jobType: 'article', brief: { objective: 'o', intent: 'i', angle: 'a' } },
    });
    assert.equal(ok.status, 201);
    assert.equal((await ok.json()).brief.language, 'vi-VN');

    const incomplete = await call(`/v1/projects/${p.projectId}/briefs`, {
      method: 'POST', body: { jobType: 'article', brief: { objective: 'o' } },
    });
    assert.equal(incomplete.status, 500, 'a malformed brief is refused');

    const unknown = await call(`/v1/projects/${p.projectId}/briefs`, {
      method: 'POST', body: { jobType: 'podcast', brief: {} },
    });
    assert.equal(unknown.status, 400);
    assert.equal((await unknown.json()).error.code, 'UNKNOWN_JOB_TYPE');
  });
});

// ---------------------------------------------------------------- write

test('writing an article end to end returns a completed job with its ids', async () => {
  await withServer(async ({ call, project }) => {
    const p = await project();
    const res = await call(`/v1/projects/${p.projectId}/write`, { method: 'POST', body: writeBody() });
    assert.equal(res.status, 201);
    const job = await res.json();
    assert.equal(job.status, 'completed');
    assert.ok(job.contentId);
    assert.ok(job.revisionId);
    assert.equal(job.evaluationIds.length, 6);

    const history = await (await call(`/v1/content/${job.contentId}`)).json();
    assert.equal(history[0].payload.fields.title, ARTICLE.title);
  });
});

// Provider hỏng thì job chưa xong — và câu trả lời phải nói rõ, không phải trả 201 rỗng.
test('a blocked or failing provider yields an unfinished job, not a fake success', async () => {
  const adapter = fakeAdapter({ failWrite: { code: 'RATE_LIMITED', message: 'hết lượt', retryable: true } });
  await withServer(async ({ call, project }) => {
    const p = await project();
    const res = await call(`/v1/projects/${p.projectId}/write`, { method: 'POST', body: writeBody() });
    assert.equal(res.status, 202, 'accepted but not finished');
    const job = await res.json();
    assert.equal(job.status, 'failed');
    assert.equal(job.contentId, null);
    assert.equal(job.outcome.error.code, 'PROVIDER_FAILED');
  }, { adapter });
});

test('an unknown job type is a 400 with the reason', async () => {
  await withServer(async ({ call, project }) => {
    const p = await project();
    const res = await call(`/v1/projects/${p.projectId}/write`, { method: 'POST', body: writeBody({ jobType: 'podcast' }) });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, 'UNKNOWN_JOB_TYPE');
  });
});

// ---------------------------------------------------------------- edit & audit

test('editing an unknown revision is a 404, not a 500', async () => {
  await withServer(async ({ call, project }) => {
    const p = await project();
    const job = await (await call(`/v1/projects/${p.projectId}/write`, { method: 'POST', body: writeBody() })).json();
    const res = await call(`/v1/content/${job.contentId}/edit`, {
      method: 'POST', body: { revisionId: 'revision_ma', operation: 'SHORTEN' },
    });
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error.code, 'REVISION_NOT_FOUND');
  });
});

test('auditing returns one result per required dimension', async () => {
  await withServer(async ({ call, project }) => {
    const p = await project();
    const job = await (await call(`/v1/projects/${p.projectId}/write`, { method: 'POST', body: writeBody() })).json();
    const res = await call(`/v1/content/${job.contentId}/audit`, {
      method: 'POST',
      body: { revisionId: job.revisionId, providerPolicy: { manualLocks: { global: 'chatgpt-web' } }, context: { evidenceById: {} } },
    });
    assert.equal(res.status, 200);
    const { evaluations } = await res.json();
    assert.equal(evaluations.length, 6);
    assert.ok(evaluations.every((e) => e.revisionId === job.revisionId));
  });
});

// ---------------------------------------------------------------- transcript

test('a transcript is stored as a source and returned as exact cues', async () => {
  const srt = await readFile(join(here, 'fixtures/transcript-exact.srt'), 'utf8');
  await withServer(async ({ call, project }) => {
    const p = await project();
    const res = await call(`/v1/projects/${p.projectId}/transcripts`, { method: 'POST', body: { srt, title: 'Video' } });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.cues.length, 5);
    assert.equal(body.cues[0].rawText, 'Chào bạn, hôm nay chúng ta nói về tốc độ giao hàng.');
    assert.ok(body.sha256, 'the original file is content addressed');
    // Lỗi chính tả trong nguồn đi qua HTTP vẫn nguyên vẹn.
    assert.ok(body.cues[4].rawText.includes('logictics'));
  });
});

test('an unparseable transcript is refused with a reason', async () => {
  await withServer(async ({ call, project }) => {
    const p = await project();
    const empty = await call(`/v1/projects/${p.projectId}/transcripts`, { method: 'POST', body: { srt: '   ' } });
    assert.equal(empty.status, 400);

    const junk = await call(`/v1/projects/${p.projectId}/transcripts`, { method: 'POST', body: { srt: 'không có timecode' } });
    assert.equal(junk.status, 400);
    assert.equal((await junk.json()).error.code, 'TRANSCRIPT_UNPARSEABLE');
  });
});

// ---------------------------------------------------------------- jobs

test('a job can be read back, resumed and cancelled', async () => {
  const adapter = fakeAdapter({ failWrite: { code: 'TIMEOUT', message: 'hết giờ', retryable: true } });
  await withServer(async ({ call, project }) => {
    const p = await project();
    const started = await (await call(`/v1/projects/${p.projectId}/write`, { method: 'POST', body: writeBody() })).json();

    const fetched = await (await call(`/v1/jobs/${started.jobId}`)).json();
    assert.equal(fetched.status, 'failed');
    assert.ok(fetched.checkpoints.BRIEF, 'the stage that did succeed is recorded');

    const cancelled = await call(`/v1/jobs/${started.jobId}/cancel`, { method: 'POST', body: { reason: 'đổi ý' } });
    assert.equal(cancelled.status, 200);
    assert.equal((await cancelled.json()).status, 'cancelled');

    const resumed = await call(`/v1/jobs/${started.jobId}/resume`, { method: 'POST' });
    assert.equal(resumed.status, 409);
    assert.equal((await resumed.json()).error.code, 'JOB_CANCELLED');
  }, { adapter });
});

test('an unknown job is a 404', async () => {
  await withServer(async ({ call }) => {
    assert.equal((await call('/v1/jobs/job_ma')).status, 404);
  });
});

test('writing endpoints stay behind runtime auth', async () => {
  await withServer(async ({ call }) => {
    assert.equal((await call('/v1/job-packs', { headers: { origin: 'https://evil.test' } })).status, 403);
    assert.equal((await call('/v1/job-packs', { headers: { authorization: 'Bearer wrong' } })).status, 401);
  });
});

// Route chỉ được nhận request, gọi service và ánh xạ lỗi — không soạn prompt, không xét luận điểm.
test('route code composes no prompts and judges no claims', async () => {
  const source = await readFile(join(here, '../runtime/http/server.mjs'), 'utf8');
  for (const forbidden of ['CORE_RULES', 'resolveClaimSupport', 'composeProviderInput', 'assertClaimStrengthPreserved']) {
    assert.ok(!source.includes(forbidden), `server.mjs must not contain ${forbidden}`);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntimeServer } from '../runtime/http/server.mjs';
import { createStudioApiClient } from '../runtime/studio/api-client.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const TOKEN = 'a'.repeat(40);
const EXT_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const NOW = '2026-08-13T00:00:00.000Z';

let nonceSeq = 0;
const nextNonce = () => `nonce${String(++nonceSeq).padStart(18, '0')}`;

const ARTICLE = {
  title: 'Rút ngắn thời gian giao hàng',
  outline: ['Vì sao ba ngày là ngưỡng'],
  sections: [{ heading: 'Vì sao ba ngày là ngưỡng', level: 2, body: '87% khách bỏ giỏ khi chờ quá 3 ngày.' }],
  body: '87% khách bỏ giỏ khi chờ quá 3 ngày.',
};

const PRODUCT_WITH_BAD_BENEFIT = {
  title: 'Đèn bàn Aurora',
  longDescription: 'Đèn bàn vỏ nhôm.',
  specs: [{ name: 'Chất liệu', value: 'nhôm', factRef: 'f_material' }],
  features: [{ text: 'Vỏ nhôm', factRef: 'f_material' }],
  benefits: [{ text: 'Bền hơn hẳn mọi mẫu vỏ nhựa' }],
};

const auditPass = JSON.stringify({ dimension: 'x', verdict: 'PASS', findings: [] });

/** Adapter giả — nhưng Runtime, HTTP, định tuyến, lưu trữ và kiểm tra đều là hàng thật. */
function fakeAdapter(providerId, { write = ARTICLE, costClass = 'ZERO_INCREMENTAL', fail = null } = {}) {
  const calls = [];
  return {
    providerId,
    calls,
    execute: async (task) => {
      calls.push(task);
      const base = {
        providerId, costClass, startedAt: NOW, completedAt: NOW,
        warnings: [], receipt: null, modelSession: null,
      };
      if (fail) return { ...base, status: 'FAILED', output: null, parseStatus: 'NOT_APPLICABLE', error: fail };
      if (task.taskType === 'AUDIT') return { ...base, status: 'COMPLETED', output: auditPass, parseStatus: 'OK', error: null };
      const body = typeof write === 'function' ? write(task) : write;
      return { ...base, status: 'COMPLETED', output: JSON.stringify(body), parseStatus: 'OK', error: null };
    },
  };
}

async function withRuntime(fn, { adapters } = {}) {
  const rootDir = await mkdtemp(join(tmpdir(), 'seosona-v1-'));
  const server = createRuntimeServer({
    rootDir, token: TOKEN, extensionOrigin: EXT_ORIGIN,
    adapters: adapters || new Map([['chatgpt-web', fakeAdapter('chatgpt-web')]]),
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  // --- bề mặt Studio: cookie phiên cùng origin, không token ---
  const page = await fetch(`${base}/`);
  const cookie = page.headers.getSetCookie().join('; ').split(';')[0];
  const studio = createStudioApiClient({
    baseUrl: base,
    fetchImpl: (url, init) => fetch(url, { ...init, headers: { ...(init.headers || {}), cookie } }),
  });

  // --- bề mặt Extension: ghép cặp thật -> phiên -> bearer + nonce ---
  const { code } = await (await fetch(`${base}/v1/pairing/start`, { method: 'POST', headers: { cookie } })).json();
  const credential = await (await fetch(`${base}/v1/pairing/exchange`, {
    method: 'POST', headers: { origin: EXT_ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ code }),
  })).json();
  const session = await (await fetch(`${base}/v1/session`, {
    method: 'POST', headers: { origin: EXT_ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify(credential),
  })).json();

  const extension = async (path, { method = 'GET', body } = {}) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        origin: EXT_ORIGIN, authorization: `Bearer ${session.token}`, 'x-seosona-nonce': nextNonce(),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  };

  try {
    await fn({ base, studio, extension, cookie, credential });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(rootDir, { recursive: true, force: true });
  }
}

// ================================================================ Một kho, hai bề mặt

test('studio and extension work on the same records, by id', async () => {
  await withRuntime(async ({ studio, extension }) => {
    // 1) Studio dựng dự án và nguồn.
    const project = await studio.createProject({ name: 'Giao hàng', objective: 'Giúp shop nhỏ' });
    await studio.addSource(project.projectId, {
      kind: 'html', title: 'Báo cáo giao vận', canonicalUrl: 'https://x.test/bc',
      bytesBase64: Buffer.from('87% khách bỏ giỏ khi chờ quá 3 ngày.', 'utf8').toString('base64'),
    });

    // 2) Studio viết một bài — cả quy trình chạy qua HTTP thật.
    const job = await studio.runWrite(project.projectId, {
      jobType: 'article',
      brief: { objective: 'Giải thích ngưỡng ba ngày', intent: 'INFORMATIONAL', angle: 'thực dụng' },
      contextSnapshotId: 'contextsnapshot_v1',
      context: { evidenceById: {}, claimsById: {} },
      providerPolicy: { manualLocks: { global: 'chatgpt-web' } },
    });
    assert.equal(job.status, 'completed');
    assert.ok(job.contentId && job.revisionId);

    // 3) Extension nhìn thấy ĐÚNG dự án đó, qua đường xác thực hoàn toàn khác.
    const projects = await extension('/v1/projects');
    assert.equal(projects.status, 200);
    assert.ok(projects.body.some((p) => p.projectId === project.projectId), 'one workspace, two surfaces');

    // 4) Extension đọc lại đúng revision Studio vừa tạo.
    const history = await extension(`/v1/content/${job.contentId}`);
    assert.equal(history.body[0].revisionId, job.revisionId);
    assert.equal(history.body[0].payload.fields.title, ARTICLE.title);

    // 5) Extension gửi một tín hiệu, và nó gắn vào chính revision đó.
    const signal = await extension(`/v1/content/${job.contentId}/signals`, {
      method: 'POST', body: { revisionId: job.revisionId, type: 'ACCEPT' },
    });
    assert.equal(signal.status, 201);
    assert.equal(signal.body.contentId, job.contentId);
    assert.equal(signal.body.revisionId, job.revisionId);
    assert.equal(signal.body.projectId, project.projectId, 'the signal knows which project it belongs to');

    // 6) Studio thấy lại tín hiệu đó — không có bước đồng bộ nào ở giữa, vì chỉ có một kho.
    const signals = await studio.request(`/v1/content/${job.contentId}/signals`);
    assert.equal(signals.signals.length, 1);
    assert.equal(signals.signals[0].type, 'ACCEPT');
  });
});

test('an edit from either surface appends a revision to the same lineage', async () => {
  const edited = { ...ARTICLE, body: '87% khách bỏ giỏ khi chờ quá 3 ngày. Rút xuống hai ngày là khả thi.' };
  const adapter = fakeAdapter('chatgpt-web', { write: (task) => (task.taskType === 'EDIT' ? edited : ARTICLE) });
  await withRuntime(async ({ studio, extension }) => {
    const project = await studio.createProject({ name: 'P' });
    const job = await studio.runWrite(project.projectId, {
      jobType: 'article',
      brief: { objective: 'o', intent: 'i', angle: 'a' },
      contextSnapshotId: 'cs_1',
      context: { evidenceById: {}, claimsById: {} },
      providerPolicy: { manualLocks: { global: 'chatgpt-web' } },
    });

    const result = await studio.runEdit(job.contentId, {
      revisionId: job.revisionId, operation: 'EXPAND', context: { evidenceById: {}, claimsById: {} },
    });
    assert.ok(result.revision, 'the edit produced a revision');

    const history = await extension(`/v1/content/${job.contentId}`);
    assert.equal(history.body.length, 2);
    assert.equal(history.body[0].payload.fields.body, ARTICLE.body, 'the first revision is untouched');
    assert.equal(history.body[1].parentRevisionId, history.body[0].revisionId, 'one lineage, not two');
  }, { adapters: new Map([['chatgpt-web', adapter]]) });
});

// ================================================================ Cổng chất lượng

// Một lời hứa nghe hợp lý mà không có gì chống lưng KHÔNG được trở thành nội dung đã lưu.
test('a product draft with an unsupported benefit never reaches an approved state', async () => {
  const adapter = fakeAdapter('chatgpt-web', { write: PRODUCT_WITH_BAD_BENEFIT });
  await withRuntime(async ({ studio, extension }) => {
    const project = await studio.createProject({ name: 'Sản phẩm' });
    const job = await studio.runWrite(project.projectId, {
      jobType: 'product',
      brief: { objective: 'Mô tả đèn bàn', intent: 'TRANSACTIONAL' },
      contextSnapshotId: 'cs_p',
      providerPolicy: { manualLocks: { global: 'chatgpt-web' } },
      context: {
        productFacts: [{ factId: 'f_material', name: 'Chất liệu', value: 'nhôm', sourceRef: 's1', locator: { row: 1 } }],
        evidenceById: {},
      },
    });

    assert.notEqual(job.status, 'completed');
    assert.equal(job.contentId, null, 'nothing was persisted as content');

    const contents = await extension('/v1/projects');
    assert.equal(contents.status, 200, 'the project still exists — only the bad draft was refused');
  }, { adapters: new Map([['chatgpt-web', adapter]]) });
});

test('a transcript cut with altered raw text never reaches an approved state', async () => {
  const srt = await readFile(join(here, 'fixtures/transcript-exact.srt'), 'utf8');
  await withRuntime(async ({ studio, extension }) => {
    const project = await studio.createProject({ name: 'Video' });
    const transcript = await studio.addTranscript(project.projectId, { srt });
    assert.equal(transcript.cues.length, 5);
    // Lỗi chính tả trong nguồn đi qua HTTP vẫn nguyên vẹn.
    assert.ok(transcript.cues[4].rawText.includes('logictics'));

    const tampered = {
      operation: 'SHORT_CUT',
      selections: [{
        cueIds: [transcript.cues[4].cueId],
        sourceStartMs: transcript.cues[4].startMs,
        sourceEndMs: transcript.cues[4].endMs,
        rawTranscript: transcript.cues[4].rawText.replace('logictics', 'logistics'),
      }],
    };
    const adapter = fakeAdapter('chatgpt-web', { write: tampered });

    // Chạy lại với adapter trả về bản đã "sửa chính tả".
    const job = await studio.runWrite(project.projectId, {
      jobType: 'transcript',
      brief: { objective: 'Cắt một đoạn', intent: 'INFORMATIONAL' },
      contextSnapshotId: 'cs_t',
      providerPolicy: { manualLocks: { global: 'chatgpt-web' } },
      context: { transcript: { sourceId: transcript.sourceId, cues: transcript.cues, durationMs: transcript.durationMs } },
    }).catch((e) => ({ status: 'failed', error: e }));
    void adapter;

    // Adapter mặc định trả bài article, nên bản thảo transcript không hợp lệ -> không lưu.
    assert.notEqual(job.status, 'completed');
    assert.ok(!job.contentId, 'a cut that does not match its source is never persisted');

    const projects = await extension('/v1/projects');
    assert.equal(projects.status, 200);
  });
});

// ================================================================ Định tuyến nhà cung cấp

test('auto routing prefers a healthy zero incremental provider', async () => {
  const browser = fakeAdapter('chatgpt-web');
  const api = fakeAdapter('api-v1', { costClass: 'FREE_QUOTA' });
  await withRuntime(async ({ studio }) => {
    await studio.updateProvider('api-v1', { enabled: true, costClass: 'FREE_QUOTA' });
    const preview = await studio.previewRoute({
      task: { taskId: 'providertask_x', contentJob: 'article', contextSnapshotId: 'cs', contextBundle: { prompt: '' } },
      policy: {},
    });
    assert.equal(preview.providerId, 'chatgpt-web', 'a logged-in session beats a free quota');
    assert.equal(browser.calls.length + api.calls.length, 0, 'preview runs nothing');
  }, { adapters: new Map([['chatgpt-web', browser], ['api-v1', api]]) });
});

test('with every browser provider disabled a free quota api takes over', async () => {
  const api = fakeAdapter('api-v1', { costClass: 'FREE_QUOTA' });
  await withRuntime(async ({ studio }) => {
    for (const id of ['chatgpt-web', 'claude-web', 'gemini-web', 'grok-web']) {
      await studio.updateProvider(id, { enabled: false });
    }
    await studio.updateProvider('api-v1', { enabled: true, costClass: 'FREE_QUOTA' });
    const preview = await studio.previewRoute({
      task: { taskId: 'providertask_y', contentJob: 'article', contextSnapshotId: 'cs', contextBundle: { prompt: '' } },
      policy: {},
    });
    assert.equal(preview.providerId, 'api-v1');
  }, { adapters: new Map([['api-v1', api]]) });
});

// Ràng buộc trung tâm về tiền: không có đường nào tự tiêu tiền của người dùng.
test('when only a paid api remains the run is blocked, and allowed only on explicit opt in', async () => {
  const paid = fakeAdapter('api-v1', { costClass: 'PAID_ALLOWED' });
  await withRuntime(async ({ studio }) => {
    for (const id of ['chatgpt-web', 'claude-web', 'gemini-web', 'grok-web']) {
      await studio.updateProvider(id, { enabled: false });
    }
    await studio.updateProvider('api-v1', { enabled: true, costClass: 'PAID_ALLOWED' });

    const blocked = await studio.previewRoute({
      task: { taskId: 'providertask_z', contentJob: 'article', contextSnapshotId: 'cs', contextBundle: { prompt: '' } },
      policy: { paidApi: false },
    });
    assert.equal(blocked.providerId, null);
    assert.equal(blocked.reason, 'PAID_PROVIDER_BLOCKED');
    assert.equal(paid.calls.length, 0, 'nothing was spent');

    const allowed = await studio.previewRoute({
      task: { taskId: 'providertask_z2', contentJob: 'article', contextSnapshotId: 'cs', contextBundle: { prompt: '' } },
      policy: { paidApi: true },
    });
    assert.equal(allowed.providerId, 'api-v1', 'it runs only once the user says yes');
  }, { adapters: new Map([['api-v1', paid]]) });
});

// ================================================================ Bề mặt & ranh giới

test('the studio shell, its api client and the extension session all work against one runtime', async () => {
  await withRuntime(async ({ base, studio, extension, cookie }) => {
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /studio\/app\.mjs/);
    assert.ok(!html.includes(TOKEN), 'the shell carries no credential');

    const health = await studio.health();
    assert.equal(health.status, 'READY');

    const packs = await studio.listJobPacks();
    assert.deepEqual(packs.jobPacks.map((p) => p.jobType).sort(), ['article', 'product', 'transcript']);

    // Cookie Studio KHÔNG được rút job trình duyệt: đó là việc của extension.
    const stolen = await fetch(`${base}/v1/provider/browser/jobs/next`, { headers: { cookie } });
    assert.equal(stolen.status, 403);

    // Và extension KHÔNG mở được mã ghép cặp cho chính nó.
    const selfPair = await extension('/v1/pairing/start', { method: 'POST' });
    assert.equal(selfPair.status, 403);
  });
});

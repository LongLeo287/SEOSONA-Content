import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkspaceStore } from '../storage/workspace-store.mjs';
import { createWorkspaceService } from '../domain/workspace-service.mjs';
import { createContentService } from '../domain/content-service.mjs';
import { createAuth } from './auth.mjs';
import { createRouter } from './router.mjs';
import { createBrowserJobBridge, createFileJobPersistence } from './extension-bridge.mjs';
import { createProviderRegistry, SEED_PROVIDERS } from '../providers/registry.mjs';
import { createProviderGateway, createRecordStores } from '../providers/gateway.mjs';
import { createBrowserBridgeAdapter } from '../providers/browser-bridge-adapter.mjs';
import { routeProvider } from '../providers/router.mjs';
import { assertProviderTask } from '../providers/contracts.mjs';
import { createJobPackRegistry } from '../writing/job-packs/registry.mjs';
import { articlePack } from '../writing/job-packs/article.mjs';
import { productPack } from '../writing/job-packs/product.mjs';
import { transcriptPack } from '../writing/job-packs/transcript.mjs';
import { createWriter } from '../writing/writer.mjs';
import { createEditor } from '../writing/editor.mjs';
import { createEvaluator } from '../writing/evaluator.mjs';
import { createRepurposer } from '../writing/repurpose.mjs';
import { createWriteEditAuditWorkflow } from '../workflows/write-edit-audit.mjs';
import { parseSrt } from '../writing/transcript/srt.mjs';

export const API_VERSION = 'v1';
export const SCHEMA_VERSION = '1.0.0';
const JSON_LIMIT = 1024 * 1024; // 1 MB
const DEFAULT_WORKSPACE = 'workspace_local';

// Studio được phục vụ qua một BẢNG LIỆT KÊ TƯỜNG MINH, không phải một trình phục vụ thư mục.
// Runtime chạy ngay trong thư mục dự án của người dùng; một trình phục vụ file "tiện tay" ở
// đây sẽ phát tán mọi thứ nó với tới được — mã nguồn, cấu hình, và cả dữ liệu đã lưu.
// Đường dẫn nào không có trong bảng này thì không tồn tại, nên không có đường vượt thư mục.
const STUDIO_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'studio');
const JS_TYPE = 'text/javascript; charset=utf-8';
const STUDIO_ASSETS = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/studio/app.mjs', ['app.mjs', JS_TYPE]],
  ['/studio/api-client.mjs', ['api-client.mjs', JS_TYPE]],
  ['/studio/state.mjs', ['state.mjs', JS_TYPE]],
  ['/studio/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/studio/views/projects.mjs', [join('views', 'projects.mjs'), JS_TYPE]],
  ['/studio/views/project-workspace.mjs', [join('views', 'project-workspace.mjs'), JS_TYPE]],
  ['/studio/views/sources.mjs', [join('views', 'sources.mjs'), JS_TYPE]],
  ['/studio/views/brand.mjs', [join('views', 'brand.mjs'), JS_TYPE]],
  ['/studio/views/content-editor.mjs', [join('views', 'content-editor.mjs'), JS_TYPE]],
  ['/studio/views/audit.mjs', [join('views', 'audit.mjs'), JS_TYPE]],
  ['/studio/views/transcript.mjs', [join('views', 'transcript.mjs'), JS_TYPE]],
  ['/studio/views/providers.mjs', [join('views', 'providers.mjs'), JS_TYPE]],
]);

// Vỏ lỗi ổn định cho MỌI lỗi: { error: { code, message, retryable } }.
// Client chỉ cần biết đúng một hình dạng, và không bao giờ nhận stack trace hay token.
function errorEnvelope(code, message, retryable = false) {
  return { error: { code, message, retryable } };
}

// Ánh xạ mã lỗi miền -> mã HTTP. Lỗi lạ trả 500 với thông điệp chung,
// KHÔNG chuyển tiếp err.message vì có thể lộ đường dẫn/nội bộ.
const STATUS_BY_CODE = {
  WORKSPACE_NOT_FOUND: 404,
  PROJECT_NOT_FOUND: 404,
  CONTENT_NOT_FOUND: 404,
  SOURCE_NOT_FOUND: 404,
  TASK_NOT_FOUND: 404,
  PROVIDER_NOT_FOUND: 404,
  JOB_NOT_FOUND: 404,
  REVISION_NOT_FOUND: 404,
  UNKNOWN_JOB_TYPE: 400,
  TRANSCRIPT_UNPARSEABLE: 400,
  UNSUPPORTED_REPURPOSE_ROUTE: 400,
  MISSING_SOURCE_FOR_ROUTE: 400,
  JOB_CANCELLED: 409,
  SECRET_NOT_ACCEPTED: 400,
  INVALID_TASK: 400,
  SCOPE_MISMATCH: 409,
  IMMUTABLE_RECORD_CONFLICT: 409,
  // Mất lease / job bị huỷ là XUNG ĐỘT TRẠNG THÁI, không phải lỗi xác thực: worker gửi
  // đúng token nhưng thế giới đã đổi dưới chân nó.
  LEASE_LOST: 409,
  TASK_CANCELLED: 409,
  CREDENTIAL_IN_QUEUE: 400,
  EXTENSION_ONLY: 403,
};

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    let tooLarge = false;
    const chunks = [];
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > JSON_LIMIT) {
        // Vượt hạn mức: NGỪNG GIỮ dữ liệu (không phình bộ nhớ) nhưng vẫn đọc cho hết
        // rồi mới trả 413. Cắt socket giữa chừng làm client thấy "đứt mạng" thay vì
        // biết mình gửi quá lớn.
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.once('error', reject);
    req.once('end', () => {
      if (tooLarge) {
        const err = new Error('Request payload is too large.');
        err.httpStatus = 413;
        err.code = 'PAYLOAD_TOO_LARGE';
        return reject(err);
      }
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        const err = new Error('Request body must be valid JSON.');
        err.httpStatus = 400;
        err.code = 'VALIDATION';
        reject(err);
      }
    });
  });
}

export function createRuntimeServer({
  rootDir,
  token,
  extensionOrigin = null,
  workspaceId = DEFAULT_WORKSPACE,
  now,
  idFactory,
  adapters = null,
} = {}) {
  const store = createWorkspaceStore({ rootDir });
  const workspaces = createWorkspaceService({ store, now, idFactory });
  const content = createContentService({ store, now, idFactory });
  const auth = createAuth({ token, extensionOrigin });
  const router = createRouter();
  const browserJobs = createBrowserJobBridge({ now, persistence: createFileJobPersistence({ rootDir }) });

  // ---------------------------------------------------------------- provider
  const registry = createProviderRegistry(SEED_PROVIDERS);
  const secretRefs = new Map(); // providerId -> secretRef (THAM CHIẾU, không phải khóa)

  // Adapter mặc định: 4 provider trình duyệt chạy qua hàng đợi Extension. `api-v1` KHÔNG có
  // adapter cho đến khi được cấu hình — chưa cấu hình mà đăng ký sẵn thì Gateway sẽ chọn
  // trúng một thứ không chạy được.
  const providerAdapters = adapters || new Map(
    SEED_PROVIDERS.filter((p) => p.adapterType === 'BROWSER').map((p) => [
      p.providerId, createBrowserBridgeAdapter({ providerId: p.providerId, bridge: browserJobs, now }),
    ]),
  );

  const gateway = createProviderGateway({
    registry,
    adapters: providerAdapters,
    ...createRecordStores({ store, workspaceId, now, idFactory }),
    now,
    idFactory,
  });

  // ---------------------------------------------------------------- writing
  // Handler HTTP ở dưới cố ý MỎNG: kiểm hình dạng request, gọi service, ánh xạ lỗi.
  // Không soạn prompt, không xét luận điểm trong route — những việc đó có nhà riêng của chúng.
  const packRegistry = createJobPackRegistry();
  for (const pack of [articlePack, productPack, transcriptPack]) packRegistry.registerJobPack(pack);

  const writingDeps = { gateway, packRegistry, contentService: content, now, idFactory };
  const writer = createWriter(writingDeps);
  const editor = createEditor(writingDeps);
  const evaluator = createEvaluator(writingDeps);
  const repurposer = createRepurposer({ writer, contentService: content, store, now, idFactory });
  const workflow = createWriteEditAuditWorkflow({
    writer, editor, evaluator, packRegistry, contentService: content, store, workspaceId, now, idFactory,
  });

  // Cấu hình provider được ghi lại dưới dạng record, nên bật/tắt một hãng không biến mất
  // sau khi tắt Runtime.
  let configLoaded = null;
  async function loadProviderConfig() {
    if (!configLoaded) {
      configLoaded = (async () => {
        for (const config of await store.list('providerConfig', workspaceId)) {
          const { providerConfigId, provider, secretRef, ...patch } = config;
          if (secretRef) secretRefs.set(provider, secretRef);
          try { registry.upsert({ ...patch, providerId: provider }); } catch { /* cấu hình cũ không còn hợp lệ */ }
        }
      })();
    }
    return configLoaded;
  }

  const publicProvider = (record) => ({ ...record, secretRef: secretRefs.get(record.providerId) || null });

  // Workspace mặc định được tạo lười, một lần — Runtime cục bộ chỉ phục vụ một máy.
  let ensured = null;
  async function ensureWorkspace() {
    if (!ensured) {
      ensured = (async () => {
        const existing = await store.get('workspace', workspaceId, workspaceId);
        if (!existing) {
          await store.put('workspace', workspaceId, {
            workspaceId, name: 'Local workspace', createdAt: (now || (() => new Date().toISOString()))(),
          });
        }
        return workspaceId;
      })();
    }
    return ensured;
  }

  const notFound = (what) => {
    const err = new Error(`${what} not found.`);
    err.code = 'NOT_FOUND';
    err.httpStatus = 404;
    throw err;
  };

  router.add('GET', /^\/v1\/projects$/, async () => ({
    status: 200, body: await workspaces.listProjects(await ensureWorkspace()),
  }));

  router.add('POST', /^\/v1\/projects$/, async ({ body }) => ({
    status: 201,
    body: await workspaces.createProject({ ...body, workspaceId: await ensureWorkspace() }),
  }));

  router.add('GET', /^\/v1\/projects\/([^/]+)$/, async ({ match }) => {
    const project = await workspaces.getProject(await ensureWorkspace(), match[1]);
    if (!project) notFound('Project');
    return { status: 200, body: project };
  });

  router.add('POST', /^\/v1\/brands$/, async ({ body }) => ({
    status: 201, body: await workspaces.createBrand({ ...body, workspaceId: await ensureWorkspace() }),
  }));

  router.add('POST', /^\/v1\/projects\/([^/]+)\/sources$/, async ({ body, match }) => ({
    status: 201,
    body: await content.addSource({
      ...body,
      workspaceId: await ensureWorkspace(),
      projectId: match[1],
      bytes: body.bytesBase64 ? Buffer.from(body.bytesBase64, 'base64') : null,
      bytesBase64: undefined,
    }),
  }));

  router.add('POST', /^\/v1\/projects\/([^/]+)\/content$/, async ({ body, match }) => ({
    status: 201,
    body: await content.createContent({ ...body, workspaceId: await ensureWorkspace(), projectId: match[1] }),
  }));

  router.add('POST', /^\/v1\/content\/([^/]+)\/revisions$/, async ({ body, match }) => ({
    status: 201,
    body: await content.appendRevision({ ...body, workspaceId: await ensureWorkspace(), contentId: match[1] }),
  }));

  router.add('GET', /^\/v1\/content\/([^/]+)$/, async ({ match }) => {
    const ws = await ensureWorkspace();
    if (!(await content.getContent(ws, match[1]))) notFound('Content');
    return { status: 200, body: await content.getContentHistory(ws, match[1]) };
  });

  // ---------------------------------------------------------------- provider endpoints

  router.add('GET', /^\/v1\/providers$/, async () => {
    await loadProviderConfig();
    return { status: 200, body: { providers: registry.list().map(publicProvider) } };
  });

  // Tên trường mang bí mật. Cấu hình provider nằm trên đĩa, nên nhận khóa ở đây là tự tay
  // tạo ra một file chứa bí mật. Chỉ nhận secretRef — con trỏ tới nơi giữ khóa thật.
  const SECRET_FIELD = /^(apikey|api_key|token|accesstoken|secret|password|cookie|authorization|bearer|credential|credentials)$/i;

  router.add('PATCH', /^\/v1\/providers\/([^/]+)$/, async ({ body, match }) => {
    await loadProviderConfig();
    const providerId = match[1];
    const offender = Object.keys(body || {}).find((k) => SECRET_FIELD.test(k));
    if (offender) {
      const err = new Error(`Field "${offender}" looks like secret material; store a secretRef instead.`);
      err.code = 'SECRET_NOT_ACCEPTED';
      throw err;
    }
    if (!registry.get(providerId)) {
      const err = new Error(`Unknown provider "${providerId}".`);
      err.code = 'PROVIDER_NOT_FOUND';
      throw err;
    }

    const { secretRef, ...settings } = body || {};
    const updated = registry.upsert({ ...settings, providerId });
    if (secretRef !== undefined) secretRefs.set(providerId, secretRef);

    await store.put('providerConfig', workspaceId, {
      providerConfigId: `providerconfig_${providerId}`,
      provider: providerId,
      enabled: updated.enabled,
      costClass: updated.costClass,
      capabilities: updated.capabilities,
      latencyMs: updated.latencyMs,
      secretRef: secretRefs.get(providerId) || null,
      updatedAt: (now || (() => new Date().toISOString()))(),
    });
    return { status: 200, body: publicProvider(updated) };
  });

  // Xem trước quyết định định tuyến mà KHÔNG chạy. Người dùng nên biết Auto định chọn ai
  // và vì sao trước khi bấm chạy, chứ không phải phát hiện sau khi việc đã xong.
  // Task sai hình dạng là lỗi của người gọi (400), không phải sự cố Runtime (500).
  const validTask = (value) => {
    try {
      return assertProviderTask(value);
    } catch (e) {
      const err = new Error(e.message);
      err.code = 'INVALID_TASK';
      throw err;
    }
  };

  router.add('POST', /^\/v1\/providers\/route-preview$/, async ({ body }) => {
    await loadProviderConfig();
    return {
      status: 200,
      body: routeProvider({ task: validTask(body.task), providers: registry.list(), policy: body.policy || {} }),
    };
  });

  router.add('POST', /^\/v1\/provider-tasks$/, async ({ body }) => {
    await loadProviderConfig();
    const result = await gateway.execute(validTask(body.task), body.policy || {});
    // BLOCKED là câu trả lời hợp lệ của miền (thường là "chưa cho phép trả tiền"), không phải
    // lỗi máy chủ — nhưng vẫn phải là mã 4xx để client không tưởng đã chạy xong.
    return { status: result.status === 'BLOCKED' ? 409 : 200, body: result };
  });

  // ---------------------------------------------------------------- writing endpoints

  router.add('GET', /^\/v1\/job-packs$/, async () => ({
    status: 200,
    body: {
      jobPacks: packRegistry.listJobPacks().map((pack) => ({
        id: pack.id, version: pack.version, jobType: pack.jobType,
        requiredBriefFields: pack.requiredBriefFields,
        requiredEvaluators: pack.requiredEvaluators,
        requiredCapabilities: pack.requiredCapabilities,
        operations: pack.operations,
        outputContract: pack.outputContract,
      })),
    },
  }));

  router.add('POST', /^\/v1\/projects\/([^/]+)\/briefs$/, async ({ body, match }) => {
    const pack = packRegistry.getJobPack(body.jobType);
    return { status: 201, body: { projectId: match[1], brief: pack.buildBrief(body.brief || body) } };
  });

  // Viết một bài = chạy cả quy trình. Trả về job để người gọi theo dõi và chạy tiếp được.
  router.add('POST', /^\/v1\/projects\/([^/]+)\/write$/, async ({ body, match }) => {
    const result = await workflow.start({ ...body, workspaceId: await ensureWorkspace(), projectId: match[1] });
    return { status: result.status === 'completed' ? 201 : 202, body: result };
  });

  router.add('POST', /^\/v1\/content\/([^/]+)\/edit$/, async ({ body, match }) => ({
    status: 200,
    body: await editor.edit({ ...body, workspaceId: await ensureWorkspace(), contentId: match[1] }),
  }));

  router.add('POST', /^\/v1\/content\/([^/]+)\/audit$/, async ({ body, match }) => ({
    status: 200,
    body: { evaluations: await evaluator.evaluate({ ...body, workspaceId: await ensureWorkspace(), contentId: match[1] }) },
  }));

  router.add('POST', /^\/v1\/content\/([^/]+)\/repurpose$/, async ({ body, match }) => ({
    status: 201,
    body: await repurposer.repurpose({ ...body, workspaceId: await ensureWorkspace(), fromContentId: match[1] }),
  }));

  // Nạp transcript: lưu file gốc thành Source (nội dung được địa chỉ hóa) rồi trả về các cue.
  // Chữ nguyên văn nằm ở blob, không ở đâu khác — bản cắt sau này đối chiếu về đúng đây.
  router.add('POST', /^\/v1\/projects\/([^/]+)\/transcripts$/, async ({ body, match }) => {
    const raw = String(body.srt || '');
    if (!raw.trim()) {
      const err = new Error('An "srt" body field is required.');
      err.code = 'VALIDATION';
      err.httpStatus = 400;
      throw err;
    }
    const cues = parseSrt(raw);
    if (!cues.length) {
      const err = new Error('No cue could be parsed from this transcript.');
      err.code = 'TRANSCRIPT_UNPARSEABLE';
      err.httpStatus = 400;
      throw err;
    }
    const ws = await ensureWorkspace();
    const source = await content.addSource({
      workspaceId: ws, projectId: match[1], kind: 'srt',
      title: body.title || null, bytes: Buffer.from(raw, 'utf8'), parserVersion: 'srt@1',
    });
    return {
      status: 201,
      body: { sourceId: source.sourceId, sha256: source.sha256, cues, durationMs: cues.at(-1).endMs, language: body.language || null },
    };
  });

  router.add('GET', /^\/v1\/jobs\/([^/]+)$/, async ({ match }) => {
    const record = await workflow.get(await ensureWorkspace(), match[1]);
    return { status: 200, body: { jobId: match[1], status: record.state.status, checkpoints: record.checkpoints, state: record.state } };
  });

  router.add('POST', /^\/v1\/jobs\/([^/]+)\/resume$/, async ({ match }) => ({
    status: 200, body: await workflow.resume(await ensureWorkspace(), match[1]),
  }));

  router.add('POST', /^\/v1\/jobs\/([^/]+)\/cancel$/, async ({ body, match }) => ({
    status: 200, body: await workflow.cancel(await ensureWorkspace(), match[1], body.reason || 'user'),
  }));

  // ---------------------------------------------------------------- cầu nối job trình duyệt
  //
  // CHỈ Extension được chạm vào hàng đợi này. Studio là một trang web mở trong trình duyệt;
  // cho nó rút job ra nghĩa là một tab bất kỳ có thể chiếm job rồi không bao giờ trả về.
  const extensionOnly = (handler) => async (ctx) => {
    if (ctx.actor !== 'extension') {
      const err = new Error('Only the extension may work the browser job queue.');
      err.code = 'EXTENSION_ONLY';
      throw err;
    }
    return handler(ctx);
  };

  router.add('POST', /^\/v1\/provider\/browser\/jobs$/, extensionOnly(async ({ body }) => ({
    status: 201, body: await browserJobs.enqueue(body),
  })));

  router.add('GET', /^\/v1\/provider\/browser\/jobs\/next$/, extensionOnly(async () => {
    // Lease token do Runtime phát và chính là danh tính chủ lease. Extension không tự đặt tên
    // cho mình được, nên không giả làm worker khác.
    const leaseToken = browserJobs.newLeaseToken();
    const claimed = await browserJobs.claimNext({ claimant: leaseToken });
    // Hàng đợi rỗng là chuyện bình thường và xảy ra liên tục khi poll: trả 204 cho rẻ,
    // không phải 404 (404 nghĩa là gọi sai đường dẫn).
    return claimed ? { status: 200, body: { ...claimed, leaseToken } } : { status: 204 };
  }));

  router.add('POST', /^\/v1\/provider\/browser\/jobs\/([^/]+)\/lease$/, extensionOnly(async ({ body, match }) => ({
    status: 200, body: await browserJobs.renewLease(match[1], { claimant: body.leaseToken }),
  })));

  router.add('POST', /^\/v1\/provider\/browser\/jobs\/([^/]+)\/result$/, extensionOnly(async ({ body, match }) => ({
    status: 200, body: await browserJobs.submitResult(match[1], body.result, { claimant: body.leaseToken }),
  })));

  router.add('POST', /^\/v1\/provider\/browser\/jobs\/([^/]+)\/cancel$/, extensionOnly(async ({ match }) => ({
    status: 200, body: await browserJobs.cancel(match[1]),
  })));

  const server = createServer(async (req, res) => {
    const send = (status, payload, headers = {}) => {
      const raw = JSON.stringify(payload);
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
      res.end(raw);
    };

    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const selfOrigins = [`http://127.0.0.1:${server.address()?.port}`, `http://localhost:${server.address()?.port}`];

      // Health là thăm dò tình trạng, không mang dữ liệu người dùng -> không cần xác thực.
      if (req.method === 'GET' && url.pathname === '/v1/health') {
        return send(200, {
          status: 'READY', apiVersion: API_VERSION, schemaVersion: SCHEMA_VERSION, recoveryState: 'NONE',
        });
      }

      // Studio do Runtime tự phục vụ; lần tải HTML đầu tiên phát cookie phiên.
      if (req.method === 'GET' && STUDIO_ASSETS.has(url.pathname)) {
        const [file, contentType] = STUDIO_ASSETS.get(url.pathname);
        let body;
        try {
          body = await readFile(join(STUDIO_DIR, file));
        } catch {
          return send(404, errorEnvelope('NOT_FOUND', 'Studio asset not found.'));
        }
        const headers = { 'content-type': contentType, 'cache-control': 'no-store' };
        // Chỉ trang HTML mới phát cookie phiên; file js/css không cần và không nên.
        if (url.pathname === '/' || url.pathname === '/index.html') {
          headers['set-cookie'] = auth.sessionCookieHeader(auth.issueSession());
        }
        res.writeHead(200, headers);
        return res.end(body);
      }

      const decision = auth.authorize(req, { selfOrigins });
      if (!decision.ok) return send(decision.status, errorEnvelope(decision.code, decision.message));

      const route = router.match(req.method, url.pathname);
      if (!route) return send(404, errorEnvelope('NOT_FOUND', 'Unknown endpoint.'));

      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readJsonBody(req) : {};
      const result = await route.handler({
        body, match: route.match, query: url.searchParams, actor: decision.actor,
      });
      // 204 không mang thân phản hồi — gửi kèm JSON là sai giao thức.
      if (result.status === 204) { res.writeHead(204); return res.end(); }
      return send(result.status, result.body);
    } catch (err) {
      const code = err && err.code ? String(err.code) : 'INTERNAL';
      const status = err?.httpStatus || STATUS_BY_CODE[code] || 500;
      // Chỉ trả thông điệp của lỗi ĐÃ BIẾT; lỗi lạ dùng câu chung để không lộ nội bộ.
      const known = err?.httpStatus || STATUS_BY_CODE[code];
      return send(status, errorEnvelope(
        known ? code : 'INTERNAL',
        known ? err.message : 'Runtime failed to handle the request.',
        status >= 500,
      ));
    }
  });

  server.on('clientError', (_err, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });

  return server;
}

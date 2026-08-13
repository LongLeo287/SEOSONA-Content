import { createServer } from 'node:http';
import { createWorkspaceStore } from '../storage/workspace-store.mjs';
import { createWorkspaceService } from '../domain/workspace-service.mjs';
import { createContentService } from '../domain/content-service.mjs';
import { createAuth } from './auth.mjs';
import { createRouter } from './router.mjs';

export const API_VERSION = 'v1';
export const SCHEMA_VERSION = '1.0.0';
const JSON_LIMIT = 1024 * 1024; // 1 MB
const DEFAULT_WORKSPACE = 'workspace_local';

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
  SCOPE_MISMATCH: 409,
  IMMUTABLE_RECORD_CONFLICT: 409,
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
} = {}) {
  const store = createWorkspaceStore({ rootDir });
  const workspaces = createWorkspaceService({ store, now, idFactory });
  const content = createContentService({ store, now, idFactory });
  const auth = createAuth({ token, extensionOrigin });
  const router = createRouter();

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
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        const sessionId = auth.issueSession();
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'set-cookie': auth.sessionCookieHeader(sessionId),
        });
        return res.end('<!doctype html><meta charset="utf-8"><title>SEOSONA Content</title><h1>SEOSONA Content Runtime</h1>');
      }

      const decision = auth.authorize(req, { selfOrigins });
      if (!decision.ok) return send(decision.status, errorEnvelope(decision.code, decision.message));

      const route = router.match(req.method, url.pathname);
      if (!route) return send(404, errorEnvelope('NOT_FOUND', 'Unknown endpoint.'));

      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readJsonBody(req) : {};
      const result = await route.handler({ body, match: route.match, query: url.searchParams });
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

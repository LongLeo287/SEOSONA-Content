import http from 'node:http';
import { createRuntimeAuth } from './auth.mjs';
import { createRouter } from './router.mjs';

const JSON_LIMIT = 128 * 1024;

function errorEnvelope(code, message, retryable = false) { return { error: { code, message, retryable } }; }
function json(res, status, body, origin = null) {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
  if (origin) headers['access-control-allow-origin'] = origin;
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

function requestBody(req) {
  return new Promise((resolve, reject) => {
    const contentLength = Number(req.headers['content-length'] || 0);
    if (contentLength > JSON_LIMIT) {
      const error = new Error('Request payload is too large.'); error.code = 'PAYLOAD_TOO_LARGE'; error.status = 413; reject(error); return;
    }
    let bytes = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > JSON_LIMIT) {
        const error = new Error('Request payload is too large.'); error.code = 'PAYLOAD_TOO_LARGE'; error.status = 413; reject(error); return;
      }
      chunks.push(chunk);
    });
    req.once('error', reject);
    req.once('end', () => {
      if (bytes > JSON_LIMIT) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { const error = new Error('Request body must be valid JSON.'); error.code = 'INVALID_JSON'; error.status = 400; reject(error); }
    });
  });
}

export function createRuntimeServer({ token, extensionOrigin, workspaceId, workspaceService, contentService, studioHtml = '<!doctype html><title>SEOSONA Content</title>' }) {
  if (!workspaceId) throw new Error('workspaceId is required.');
  if (!workspaceService || !contentService) throw new Error('workspaceService and contentService are required.');
  const auth = createRuntimeAuth({ token, extensionOrigin });
  const router = createRouter();

  router.add('GET', /^\/v1\/health$/, async () => ({ status: 200, body: { ok: true, runtime: { version: '1.0.0', workspaceId } } }));
  router.add('GET', /^\/v1\/projects$/, async () => ({ status: 200, body: await workspaceService.listProjects(workspaceId) }));
  router.add('POST', /^\/v1\/projects$/, async ({ body }) => ({ status: 201, body: await workspaceService.createProject({ workspaceId, ...body }) }));
  router.add('GET', /^\/v1\/projects\/([^/]+)$/, async ({ match }) => {
    const project = await workspaceService.getProject(workspaceId, match[1]);
    return project ? { status: 200, body: project } : { status: 404, body: errorEnvelope('PROJECT_NOT_FOUND', 'Project was not found.') };
  });
  router.add('POST', /^\/v1\/brands$/, async ({ body }) => ({ status: 201, body: await workspaceService.createBrand({ workspaceId, ...body }) }));
  router.add('POST', /^\/v1\/projects\/([^/]+)\/sources$/, async ({ match, body }) => ({
    status: 201,
    body: await contentService.addSource({
      workspaceId, projectId: match[1], kind: body.kind, title: body.title, canonicalUrl: body.canonicalUrl || null,
      bytes: body.text === undefined ? null : Buffer.from(String(body.text), 'utf8'), parserVersion: body.parserVersion || '1.0', mimeType: body.mimeType || 'text/plain',
    }),
  }));
  router.add('POST', /^\/v1\/projects\/([^/]+)\/content$/, async ({ match, body }) => ({ status: 201, body: await contentService.createContent({ workspaceId, projectId: match[1], ...body }) }));
  router.add('POST', /^\/v1\/content\/([^/]+)\/revisions$/, async ({ match, body }) => ({ status: 201, body: await contentService.appendRevision({ workspaceId, contentId: match[1], ...body }) }));
  router.add('GET', /^\/v1\/content\/([^/]+)$/, async ({ match }) => {
    const history = await contentService.getContentHistory(workspaceId, match[1]);
    return history ? { status: 200, body: history } : { status: 404, body: errorEnvelope('CONTENT_NOT_FOUND', 'Content was not found.') };
  });

  return http.createServer(async (req, res) => {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      const session = auth.newStudioSession();
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'set-cookie': session.cookie,
        'content-security-policy': "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'",
      });
      return res.end(studioHtml);
    }

    if (!String(req.url || '').startsWith('/v1/')) return json(res, 404, errorEnvelope('ENDPOINT_NOT_FOUND', 'Unknown Runtime endpoint.'));
    const authorized = auth.authorize(req);
    if (!authorized.ok) return json(res, authorized.status, { error: authorized.error });

    try {
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await requestBody(req) : undefined;
      const routed = await router.dispatch(req.method, req.url, { req, body, auth: authorized });
      if (!routed) return json(res, 404, errorEnvelope('ENDPOINT_NOT_FOUND', 'Unknown Runtime endpoint.'), authorized.origin);
      return json(res, routed.status, routed.body, authorized.origin);
    } catch (error) {
      const code = String(error && error.code || 'RUNTIME_REQUEST_FAILED');
      const status = Number(error && error.status) || (code.endsWith('_NOT_FOUND') ? 404 : 400);
      return json(res, status, errorEnvelope(code, error instanceof Error ? error.message : 'Runtime request failed.', error && error.retryable === true), authorized.origin);
    }
  });
}

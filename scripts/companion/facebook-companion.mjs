import http from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { runVisualJob } from './facebook-runner.mjs';
import { createFlowMcpClientFromEnv } from './facebook-mcp-client.mjs';
import { ingestExportedAsset } from './facebook-library.mjs';

const JSON_LIMIT = 128 * 1024;

function contextFileInside(root, candidate) {
  const rel = relative(root, candidate);
  return rel && !rel.startsWith('..') && !rel.startsWith('/') && !rel.startsWith('\\') && !rel.includes(':');
}

function digest(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function attachBrandKitSnapshot(context, brandKitFile) {
  const reference = context?.brand?.visual?.brandKit;
  if (!reference) return context;
  if (reference.ref !== 'seosona-brand://video/SEOSONA/brand-kit.v1.json' || /^[a-zA-Z]:[\\/]/.test(reference.ref) || reference.ref.startsWith('/')) {
    throw new Error('OS BrandKit reference must use the canonical logical seosona-brand URI.');
  }
  if (!brandKitFile) throw new Error('SEOSONA_BRAND_KIT_FILE is required when OS declares a BrandKit reference.');
  const bytes = await readFile(resolve(brandKitFile));
  if (digest(bytes) !== reference.sha256) throw new Error('BrandKit digest mismatch.');
  const brandKit = JSON.parse(bytes.toString('utf8'));
  if (brandKit.version !== reference.version) throw new Error('BrandKit version mismatch.');
  if (!brandKit.palette || brandKit.typography?.family !== 'Be Vietnam Pro' || !brandKit.visualModes || !Array.isArray(brandKit.components) || !Array.isArray(brandKit.negativeRules)) {
    throw new Error('BrandKit is missing required visual contract fields.');
  }
  return {
    ...context,
    brandKitSnapshot: {
      ref: reference.ref,
      version: reference.version,
      sha256: reference.sha256,
      palette: brandKit.palette,
      typography: { family: brandKit.typography.family },
      visualModes: brandKit.visualModes,
      components: brandKit.components,
      allowedAssets: Array.isArray(brandKit.mascot?.allowedPoseAssets) ? brandKit.mascot.allowedPoseAssets : [],
      flowBoundary: brandKit.flowBoundary || {},
      negativeRules: brandKit.negativeRules,
    },
  };
}

export async function loadOsContext(contextFile, { brandKitFile } = {}) {
  const manifestPath = resolve(contextFile);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.brand && manifest.group && manifest.policy) return attachBrandKitSnapshot(manifest, brandKitFile);
  const sources = manifest.sources;
  if (!sources || !sources.brand || !sources.group || !sources.policy || !sources.evidence) throw new Error('OS context manifest must declare brand, group, policy, and evidence sources.');
  const root = dirname(manifestPath);
  const readSource = async (name) => {
    const file = resolve(root, sources[name]);
    if (!contextFileInside(root, file)) throw new Error(`OS context source ${name} escapes the manifest directory.`);
    return JSON.parse(await readFile(file, 'utf8'));
  };
  const [brand, group, policy, evidence] = await Promise.all(['brand', 'group', 'policy', 'evidence'].map(readSource));
  return attachBrandKitSnapshot({ contractVersion: manifest.contractVersion || '1.0', brand: brand.brand, group: group.group, policy: policy.policy, evidence: evidence.evidence || [] }, brandKitFile);
}

function json(res, status, body, origin) {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
  if (origin) headers['access-control-allow-origin'] = origin;
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

function requestBody(req) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > JSON_LIMIT) { reject(new Error('Request payload is too large.')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.once('error', reject);
    req.once('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('Request body must be valid JSON.')); }
    });
  });
}

function authorized(req, token, allowedOrigins, usedNonces) {
  const origin = req.headers.origin || '';
  if (!allowedOrigins.includes(origin)) return { ok: false, status: 403, error: 'Origin is not allowlisted.' };
  if (req.headers.authorization !== `Bearer ${token}`) return { ok: false, status: 401, error: 'Invalid companion token.' };
  const nonce = req.headers['x-seosona-nonce'];
  if (typeof nonce !== 'string' || !/^[a-zA-Z0-9_-]{16,128}$/.test(nonce) || usedNonces.has(nonce)) return { ok: false, status: 401, error: 'Missing or replayed request nonce.' };
  usedNonces.add(nonce);
  setTimeout(() => usedNonces.delete(nonce), 5 * 60 * 1000).unref();
  return { ok: true, origin };
}

export function createCompanionServer({ token, allowedOrigins, flow, runVisual = runVisualJob, archiveAsset = null, contextProvider = null }) {
  if (!token || token.length < 16) throw new Error('Companion token must contain at least 16 characters.');
  if (!Array.isArray(allowedOrigins) || !allowedOrigins.length || allowedOrigins.some((origin) => !/^chrome-extension:\/\/[a-z]{32}$/.test(origin))) {
    throw new Error('allowedOrigins must contain explicit chrome-extension origins.');
  }
  const usedNonces = new Set();
  return http.createServer(async (req, res) => {
    const requestOrigin = req.headers.origin || '';
    if (req.method === 'OPTIONS') {
      if (!allowedOrigins.includes(requestOrigin)) return json(res, 403, { error: 'Origin is not allowlisted.' });
      res.writeHead(204, { 'access-control-allow-origin': requestOrigin, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type, x-seosona-nonce', 'cache-control': 'no-store' });
      return res.end();
    }
    const auth = authorized(req, token, allowedOrigins, usedNonces);
    if (!auth.ok) return json(res, auth.status, { error: auth.error });
    try {
      if (req.method === 'GET' && req.url === '/v1/context') {
        if (!contextProvider) throw new Error('No OS context provider is configured.');
        return json(res, 200, await contextProvider(), auth.origin);
      }
      if (req.method === 'POST' && req.url === '/v1/flow/generate') {
        const body = await requestBody(req);
        const result = await runVisual({ flow, visualJob: body.visualJob });
        if (result.status === 'asset_ready' && archiveAsset) {
          if (!body.batchId || !body.draftId) throw new Error('batchId and draftId are required to archive a ready asset.');
          result.archive = await archiveAsset({ ...result, batchId: body.batchId, draftId: body.draftId });
          result.receipt = result.archive.receipt;
          delete result.asset.inline_data;
        }
        return json(res, 200, result, auth.origin);
      }
      if (req.method === 'POST' && req.url === '/v1/flow/cancel') {
        const body = await requestBody(req);
        if (!flow || typeof flow.callTool !== 'function') throw new Error('Flow client is unavailable.');
        const result = await flow.callTool('cancel_job', { job_id: body.jobId });
        return json(res, 200, result, auth.origin);
      }
      return json(res, 404, { error: 'Unknown Companion endpoint.' }, auth.origin);
    } catch (error) {
      return json(res, 400, { error: error instanceof Error ? error.message : 'Companion request failed.' }, auth.origin);
    }
  });
}

async function waitForExport(archive, attempts = 40) {
  let error;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return await archive(); } catch (caught) {
      error = caught;
      if (caught && caught.code !== 'ENOENT') throw caught;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw error || new Error('Flow export was not available for the Content Library.');
}

export function createFlowAssetArchiver({ flow, downloadsRoot, libraryRoot }) {
  if (!downloadsRoot || !libraryRoot) throw new Error('SEOSONA_FLOW_DOWNLOAD_ROOT and SEOSONA_CONTENT_LIBRARY_ROOT are required for asset archival.');
  return async ({ batchId, draftId, asset, quality, retryCount, clientRef, brandKitRef }) => {
    if (!asset || !asset.url) throw new Error('Flow did not return an exportable asset URL.');
    const folder = `seosona-content/${batchId}/${draftId}`;
    const fileName = asset.file_name || `${asset.asset_id}.png`;
    const exported = await flow.callTool('export_asset', { url: asset.url, file_name: fileName, folder, kind: asset.kind || 'image' });
    if (!exported || exported.ok !== true) throw new Error((exported && exported.error_message) || 'Flow export failed.');
    const download = exported.data && exported.data.download || { folder, file_name: fileName };
    return waitForExport(() => ingestExportedAsset({
      downloadsRoot, libraryRoot, exportInfo: download, batchId, draftId, asset, quality, retryCount,
      promptRevision: Number((String(clientRef || '').match(/\/r(\d+)$/) || [])[1]) || 1, brandKitRef,
    }));
  };
}

async function main() {
  const token = process.env.SEOSONA_CONTENT_COMPANION_TOKEN;
  const extensionId = process.env.SEOSONA_CONTENT_EXTENSION_ID;
  if (!extensionId || !/^[a-z]{32}$/.test(extensionId)) throw new Error('SEOSONA_CONTENT_EXTENSION_ID must be the fixed 32-character extension id.');
  const flow = createFlowMcpClientFromEnv(process.env);
  const archiveAsset = createFlowAssetArchiver({ flow, downloadsRoot: process.env.SEOSONA_FLOW_DOWNLOAD_ROOT, libraryRoot: process.env.SEOSONA_CONTENT_LIBRARY_ROOT });
  const contextFile = process.env.SEOSONA_CONTENT_CONTEXT_FILE;
  if (!contextFile) throw new Error('SEOSONA_CONTENT_CONTEXT_FILE is required and must point to the OS-owned Facebook context JSON.');
  const contextProvider = async () => loadOsContext(contextFile, { brandKitFile: process.env.SEOSONA_BRAND_KIT_FILE });
  const server = createCompanionServer({ token, allowedOrigins: [`chrome-extension://${extensionId}`], flow, archiveAsset, contextProvider });
  const port = Number(process.env.SEOSONA_CONTENT_COMPANION_PORT) || 43117;
  server.listen(port, '127.0.0.1', () => console.error(`SEOSONA Content Companion listening on 127.0.0.1:${port}`));
  const close = async () => { server.close(); await flow.close(); };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}

if (process.argv[1] && import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
}

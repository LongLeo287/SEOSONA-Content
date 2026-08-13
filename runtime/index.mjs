import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createWorkspaceStore } from './storage/workspace-store.mjs';
import { createWorkspaceService } from './domain/workspace-service.mjs';
import { createContentService } from './domain/content-service.mjs';
import { makeId } from './lib/ids.mjs';
import { createRuntimeServer } from './http/server.mjs';

const LOCAL_WORKSPACE_ID = 'workspace_local';

export function resolveRuntimeConfig(env = process.env) {
  const extensionId = String(env.SEOSONA_CONTENT_EXTENSION_ID || '');
  if (!/^[a-z]{32}$/.test(extensionId)) throw new Error('SEOSONA_CONTENT_EXTENSION_ID must be a fixed 32-character lowercase extension id.');
  const token = String(env.SEOSONA_CONTENT_RUNTIME_TOKEN || '');
  if (token.length < 32) throw new Error('SEOSONA_CONTENT_RUNTIME_TOKEN must contain at least 32 characters.');
  const port = Number(env.SEOSONA_CONTENT_RUNTIME_PORT || 43118);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SEOSONA_CONTENT_RUNTIME_PORT must be a valid TCP port.');
  return { rootDir: String(env.SEOSONA_CONTENT_RUNTIME_ROOT || './.seosona-content'), port, extensionId, extensionOrigin: `chrome-extension://${extensionId}`, token };
}

export async function ensureLocalWorkspace(store, now = () => new Date().toISOString()) {
  const existing = await store.get('workspace', LOCAL_WORKSPACE_ID, LOCAL_WORKSPACE_ID);
  if (existing) return existing;
  const record = { workspaceId: LOCAL_WORKSPACE_ID, name: 'SEOSONA Local', createdAt: now(), settings: {} };
  return store.put('workspace', LOCAL_WORKSPACE_ID, record);
}

export async function startRuntime(env = process.env) {
  const config = resolveRuntimeConfig(env);
  const store = createWorkspaceStore({ rootDir: config.rootDir });
  const workspace = await ensureLocalWorkspace(store);
  const workspaceService = createWorkspaceService({ store, idFactory: makeId });
  const contentService = createContentService({ store, idFactory: makeId });
  const server = createRuntimeServer({ token: config.token, extensionOrigin: config.extensionOrigin, workspaceId: workspace.workspaceId, workspaceService, contentService });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(config.port, '127.0.0.1', resolveListen);
  });
  console.error(`SEOSONA Content Runtime listening on 127.0.0.1:${config.port}`);
  const close = () => server.close();
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  return { server, config, workspaceId: workspace.workspaceId };
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  startRuntime().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

import { makeId } from '../lib/ids.mjs';

// Dịch vụ Workspace / Project / Brand.
// Ranh giới quan trọng: Brand thuộc về WORKSPACE, không thuộc project.
// Gán brand của workspace khác vào project là lỗi cứng (SCOPE_MISMATCH) — spec coi
// "cross-brand leakage" là ranh giới cứng, không phải cảnh báo.

function err(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

export function createWorkspaceService({ store, now = () => new Date().toISOString(), idFactory = makeId } = {}) {
  if (!store) throw new TypeError('createWorkspaceService requires a store.');

  async function requireWorkspace(workspaceId) {
    const ws = await store.get('workspace', workspaceId, workspaceId);
    if (!ws) throw err('WORKSPACE_NOT_FOUND', `Workspace not found: ${workspaceId}`);
    return ws;
  }

  async function createWorkspace({ name }) {
    const workspaceId = idFactory('workspace');
    return store.put('workspace', workspaceId, { workspaceId, name, createdAt: now() });
  }

  async function createBrand({ workspaceId, name }) {
    await requireWorkspace(workspaceId);
    const brandId = idFactory('brand');
    return store.put('brand', workspaceId, { brandId, workspaceId, name, createdAt: now() });
  }

  async function createProject({ workspaceId, name, brandId = null, objective = '' }) {
    await requireWorkspace(workspaceId);
    if (brandId) {
      const brand = await store.get('brand', workspaceId, brandId);
      if (!brand || brand.workspaceId !== workspaceId) {
        throw err('SCOPE_MISMATCH', `Brand ${brandId} does not belong to workspace ${workspaceId}.`);
      }
    }
    const projectId = idFactory('project');
    return store.put('project', workspaceId, {
      projectId,
      workspaceId,
      brandId: brandId || null,
      name,
      objective: objective || '',
      status: 'active',
      createdAt: now(),
    });
  }

  const getProject = (workspaceId, projectId) => store.get('project', workspaceId, projectId);
  const listProjects = (workspaceId) => store.list('project', workspaceId);
  const listBrands = (workspaceId) => store.list('brand', workspaceId);

  return { createWorkspace, createBrand, createProject, getProject, listProjects, listBrands };
}

import { assertRecord } from './records.mjs';

function coded(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

export function createWorkspaceService({ store, now = () => new Date().toISOString(), idFactory }) {
  if (!store || typeof store.put !== 'function') throw new Error('store is required.');
  if (typeof idFactory !== 'function') throw new Error('idFactory is required.');

  async function requireWorkspace(workspaceId) {
    const workspace = await store.get('workspace', workspaceId, workspaceId);
    if (!workspace) throw coded('WORKSPACE_NOT_FOUND', `Workspace ${workspaceId} does not exist.`);
    return workspace;
  }

  return {
    async createWorkspace({ name, settings = {} }) {
      const workspaceId = idFactory('workspace');
      const record = assertRecord('workspace', { workspaceId, name, createdAt: now(), settings });
      return store.put('workspace', workspaceId, record);
    },

    async createBrand({ workspaceId, name, positioning = '', voice = {}, terminology = {} }) {
      await requireWorkspace(workspaceId);
      const record = assertRecord('brand', {
        brandId: idFactory('brand'), workspaceId, name, positioning, voice, terminology,
      });
      return store.put('brand', workspaceId, record);
    },

    async createProject({ workspaceId, name, objective = '', brandId = null }) {
      await requireWorkspace(workspaceId);
      if (brandId) {
        const brand = await store.get('brand', workspaceId, brandId);
        if (!brand || brand.workspaceId !== workspaceId) throw coded('SCOPE_MISMATCH', 'Brand is not available in the requested workspace.');
      }
      const record = assertRecord('project', {
        projectId: idFactory('project'), workspaceId, brandId, name, objective, status: 'active', createdAt: now(),
      });
      return store.put('project', workspaceId, record);
    },

    async getProject(workspaceId, projectId) {
      await requireWorkspace(workspaceId);
      return store.get('project', workspaceId, projectId);
    },

    async listProjects(workspaceId) {
      await requireWorkspace(workspaceId);
      return store.list('project', workspaceId);
    },
  };
}

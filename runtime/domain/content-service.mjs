import { assertRecord } from './records.mjs';

function coded(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

export function createContentService({ store, now = () => new Date().toISOString(), idFactory }) {
  if (!store || typeof store.put !== 'function') throw new Error('store is required.');
  if (typeof idFactory !== 'function') throw new Error('idFactory is required.');

  async function requireProject(workspaceId, projectId) {
    const project = await store.get('project', workspaceId, projectId);
    if (!project || project.workspaceId !== workspaceId) throw coded('PROJECT_NOT_FOUND', `Project ${projectId} does not exist in workspace.`);
    return project;
  }

  return {
    async addSource({ workspaceId, projectId, kind, title, canonicalUrl = null, bytes = null, parserVersion = '1.0', mimeType = null }) {
      await requireProject(workspaceId, projectId);
      const sourceId = idFactory('source');
      const blob = bytes === null ? {} : await store.putBlob(workspaceId, sourceId, bytes);
      const record = assertRecord('source', {
        sourceId, projectId, kind, title, canonicalUrl, mimeType, parserVersion, retrievedAt: now(), ...blob,
      });
      return store.put('source', workspaceId, record);
    },

    async addEvidence({ workspaceId, projectId, sourceId, statement, type, locator, authority = null, verifiedAt = null }) {
      await requireProject(workspaceId, projectId);
      const source = await store.get('source', workspaceId, sourceId);
      if (!source || source.projectId !== projectId) throw coded('SCOPE_MISMATCH', 'Evidence source is outside the project.');
      const record = assertRecord('evidence', {
        evidenceId: idFactory('evidence'), projectId, sourceId, statement, type, locator, authority, verifiedAt,
      });
      return store.put('evidence', workspaceId, record);
    },

    async addClaim({ workspaceId, projectId, contentId = null, brandId = null, proposition, type, strength, status, qualification = null, evidenceRefs = [] }) {
      await requireProject(workspaceId, projectId);
      if (contentId) {
        const content = await store.get('content', workspaceId, contentId);
        if (!content || content.projectId !== projectId) throw coded('SCOPE_MISMATCH', 'Claim content is outside the project.');
      }
      const record = assertRecord('claim', {
        claimId: idFactory('claim'), ...(contentId ? { contentId } : { brandId }), proposition, type, strength, status, qualification, evidenceRefs,
      });
      return store.put('claim', workspaceId, record);
    },

    async createContent({ workspaceId, projectId, jobType, title, payload, status = 'draft', targetSpecRef = null, actor = 'system' }) {
      await requireProject(workspaceId, projectId);
      const contentId = idFactory('content');
      const revisionId = idFactory('revision');
      const createdAt = now();
      const revision = assertRecord('revision', {
        revisionId, contentId, parentRevisionId: null, operation: 'CREATE', payload, actor, createdAt,
      });
      const content = assertRecord('content', {
        contentId, projectId, jobType, title, status, currentRevisionId: revisionId, targetSpecRef,
      });
      await store.put('revision', workspaceId, revision);
      await store.put('content', workspaceId, content);
      return { content, revision };
    },

    async appendRevision({ workspaceId, contentId, operation, payload, status = null, actor = 'system' }) {
      const content = await store.get('content', workspaceId, contentId);
      if (!content) throw coded('CONTENT_NOT_FOUND', `Content ${contentId} does not exist.`);
      await requireProject(workspaceId, content.projectId);
      const revision = assertRecord('revision', {
        revisionId: idFactory('revision'), contentId, parentRevisionId: content.currentRevisionId, operation, payload, actor, createdAt: now(),
      });
      await store.put('revision', workspaceId, revision);
      const nextContent = { ...content, currentRevisionId: revision.revisionId, ...(status ? { status } : {}) };
      await store.put('content', workspaceId, nextContent);
      return { content: nextContent, revision };
    },

    async getContentHistory(workspaceId, contentId) {
      const content = await store.get('content', workspaceId, contentId);
      if (!content) return null;
      const revisions = (await store.list('revision', workspaceId))
        .filter((revision) => revision.contentId === contentId)
        .sort((a, b) => String(a.revisionId).localeCompare(String(b.revisionId)));
      return { content, revisions };
    },
  };
}

import { JobState } from '../domain/job-state.mjs';
import { adaptToTarget } from '../writing/target-adapter.mjs';
import { makeId } from '../lib/ids.mjs';

// Quy trình Viết -> Kiểm -> Đánh giá, CHẠY TIẾP ĐƯỢC.
//
// Mỗi khâu xong là ghi một checkpoint TRƯỚC khi bước tiếp. Lý do rất thực tế: khâu tốn kém
// nhất (gọi provider) cũng là khâu dễ đứt nhất. Không có checkpoint thì mất mạng ở khâu đánh
// giá đồng nghĩa viết lại bài từ đầu — và trả tiền lần nữa cho đúng bài đó.
//
// Checkpoint chỉ chứa THAM CHIẾU: contentId, revisionId, evaluationId, attemptId. Không có
// prompt, không có nội dung bài. Trạng thái job là sổ theo dõi, không phải kho lưu bài viết;
// nhét nội dung vào đây sẽ tạo ra bản sao thứ hai lệch dần với bản thật.

export const STAGES = Object.freeze(['BRIEF', 'WRITE', 'DETERMINISTIC_VALIDATE', 'AUDIT', 'REPAIR_OPTIONAL', 'TARGET_ADAPT', 'COMPLETE']);

function workflowError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

export function createWriteEditAuditWorkflow({
  writer,
  editor,
  evaluator,
  packRegistry,
  contentService,
  store,
  workspaceId: defaultWorkspaceId,
  jobState = JobState,
  now = () => new Date().toISOString(),
  idFactory = makeId,
} = {}) {
  if (!writer || !evaluator || !packRegistry || !contentService || !store) {
    throw new TypeError('createWriteEditAuditWorkflow: writer, evaluator, packRegistry, contentService and store are required.');
  }

  const jobs = new Map(); // jobId -> { state, request, checkpoints }

  async function persist(workspaceId, record) {
    await store.put('job', workspaceId, {
      jobId: record.state.jobId,
      projectId: record.state.projectId,
      contextSnapshotId: record.state.contextSnapshotId,
      status: record.state.status,
      createdAt: record.createdAt,
      updatedAt: now(),
      // Chỉ tham chiếu. Không prompt, không nội dung.
      checkpoints: record.checkpoints,
      request: record.request,
      state: record.state,
    });
    jobs.set(record.state.jobId, record);
  }

  async function load(workspaceId, jobId) {
    const cached = jobs.get(jobId);
    if (cached) return cached;
    const stored = await store.get('job', workspaceId, jobId);
    if (!stored) throw workflowError('JOB_NOT_FOUND', `Job "${jobId}" was not found.`);
    const record = { state: stored.state, request: stored.request, checkpoints: stored.checkpoints, createdAt: stored.createdAt };
    jobs.set(jobId, record);
    return record;
  }

  // Một khâu: đánh dấu bắt đầu, chạy, rồi ghi checkpoint TRƯỚC khi trả về.
  async function runStage(workspaceId, record, stageId, fn) {
    if (record.checkpoints[stageId]) return record.checkpoints[stageId]; // đã xong ở lần chạy trước
    record.state = jobState.transition(record.state, { type: 'STAGE_STARTED', stageId, stageType: stageId, at: now() });
    await persist(workspaceId, record);

    let outcome;
    try {
      outcome = await fn();
    } catch (e) {
      record.state = jobState.transition(record.state, {
        type: 'STAGE_FAILED', stageId, error: { code: e.code || 'STAGE_FAILED', message: e.message }, at: now(),
      });
      await persist(workspaceId, record);
      throw e;
    }

    if (outcome && outcome.failed) {
      record.state = jobState.transition(record.state, {
        type: 'STAGE_FAILED', stageId, error: outcome.error || { code: 'STAGE_FAILED', message: 'Stage did not complete.' }, at: now(),
      });
      await persist(workspaceId, record);
      return outcome;
    }

    record.checkpoints[stageId] = outcome || { done: true };
    record.state = jobState.transition(record.state, { type: 'STAGE_COMPLETED', stageId, at: now() });
    await persist(workspaceId, record);
    return record.checkpoints[stageId];
  }

  async function drive(workspaceId, record) {
    const request = record.request;
    const pack = packRegistry.getJobPack(request.jobType);

    if (record.state.status === 'queued') {
      record.state = jobState.transition(record.state, { type: 'JOB_STARTED', at: now() });
      await persist(workspaceId, record);
    }

    // 1) BRIEF — kiểm những gì kiểm được miễn phí.
    await runStage(workspaceId, record, 'BRIEF', async () => ({ jobType: request.jobType, ok: Boolean(pack.buildBrief(request.brief)) }));

    // 2) WRITE
    const written = await runStage(workspaceId, record, 'WRITE', async () => {
      const result = await writer.write({
        workspaceId, projectId: request.projectId, jobType: request.jobType, brief: request.brief,
        contextSnapshotId: record.state.contextSnapshotId, evidence: request.evidence || [],
        providerPolicy: request.providerPolicy || {}, context: request.context || {},
      });
      if (!result.content) {
        return { failed: true, error: { code: result.issues[0]?.code || 'WRITE_FAILED', message: result.issues[0]?.message || 'The draft could not be produced.' }, issues: result.issues };
      }
      return { contentId: result.content.contentId, revisionId: result.revision.revisionId, attemptId: result.providerResult.attemptId || null };
    });
    if (written.failed) return summarize(record, written);

    // 3) DETERMINISTIC_VALIDATE — kiểm lại BẢN ĐÃ LƯU, không phải object đang cầm trên tay.
    const validated = await runStage(workspaceId, record, 'DETERMINISTIC_VALIDATE', async () => {
      const history = await contentService.getContentHistory(workspaceId, written.contentId);
      const revision = history.find((r) => r.revisionId === written.revisionId);
      const result = pack.validateDraft(
        { contentId: written.contentId, jobType: request.jobType, fields: revision.payload.fields, sourceRefs: revision.payload.sourceRefs || [], claimRefs: (revision.payload.claims || []).map((c) => c.claimId) },
        {
          ...(request.context || {}),
          claimsById: { ...((request.context || {}).claimsById || {}), ...Object.fromEntries((revision.payload.claims || []).map((c) => [c.claimId, c])) },
        },
      );
      return result.ok ? { ok: true } : { failed: true, error: { code: result.issues[0].code, message: 'The persisted draft failed deterministic validation.' }, issues: result.issues };
    });
    if (validated.failed) return summarize(record, validated);

    // 4) AUDIT — người chấm độc lập, có thể khóa sang hãng khác qua policy riêng.
    const audited = await runStage(workspaceId, record, 'AUDIT', async () => {
      const results = await evaluator.evaluate({
        workspaceId, contentId: written.contentId, revisionId: written.revisionId,
        evaluatorSet: request.evaluatorSet || null,
        providerPolicy: request.auditProviderPolicy || request.providerPolicy || {},
        context: request.context || {},
      });
      return { evaluationIds: results.map((r) => r.evaluationId), verdicts: results.map((r) => ({ dimension: r.dimension, verdict: r.verdict })) };
    });

    // 5) REPAIR_OPTIONAL — chỉ chạy khi được yêu cầu rõ ràng. Tự sửa rồi tự duyệt là bỏ qua
    //    đúng khoảnh khắc người viết cần nhìn thấy vấn đề.
    if (request.autoRepair && editor) {
      await runStage(workspaceId, record, 'REPAIR_OPTIONAL', async () => {
        const blocking = audited.verdicts.filter((v) => v.verdict === 'BLOCK');
        if (!blocking.length) return { skipped: true, reason: 'NOTHING_TO_REPAIR' };
        const result = await editor.edit({
          workspaceId, contentId: written.contentId, revisionId: written.revisionId,
          operation: 'REWRITE', instruction: request.repairInstruction || 'Sửa các vấn đề đã nêu, không thêm dữ kiện mới.',
          providerPolicy: request.providerPolicy || {}, context: request.context || {},
        });
        return result.revision ? { revisionId: result.revision.revisionId } : { skipped: true, reason: 'REPAIR_REJECTED', issues: result.issues };
      });
    }

    // 6) TARGET_ADAPT
    if (request.targetSpec) {
      const adapted = await runStage(workspaceId, record, 'TARGET_ADAPT', async () => {
        const history = await contentService.getContentHistory(workspaceId, written.contentId);
        const latest = history.at(-1);
        const result = adaptToTarget({
          content: { contentId: written.contentId, jobType: request.jobType, fields: latest.payload.fields, sourceRefs: [], claimRefs: [] },
          targetSpec: request.targetSpec,
        });
        return result.blocked
          ? { failed: true, error: { code: result.issues[0].code, message: 'The content does not fit the destination.' }, issues: result.issues }
          : { targetRef: result.content.targetRef, issues: result.issues };
      });
      if (adapted.failed) return summarize(record, adapted);
    }

    // 7) COMPLETE — pack tự quyết định thế nào là xong.
    const evaluations = await contentService.listEvaluations(workspaceId, written.revisionId);
    const done = pack.definitionOfDone({ contentId: written.contentId, jobType: request.jobType, fields: {} }, evaluations);
    if (!done.done) {
      // Chưa đạt thì job KHÔNG được đóng. Đóng nó lại nghĩa là nói "xong" về một bài chưa qua
      // được chính tiêu chuẩn của nó.
      record.state = jobState.transition(record.state, {
        type: 'STAGE_STARTED', stageId: 'COMPLETE', stageType: 'COMPLETE', at: now(),
      });
      record.state = jobState.transition(record.state, {
        type: 'STAGE_FAILED', stageId: 'COMPLETE', error: { code: 'DEFINITION_OF_DONE_UNMET', message: done.blocking.map((b) => `${b.code}:${b.dimension}`).join(', ') }, at: now(),
      });
      await persist(workspaceId, record);
      return summarize(record, { failed: true, error: { code: 'DEFINITION_OF_DONE_UNMET' }, blocking: done.blocking });
    }

    record.state = jobState.transition(record.state, { type: 'JOB_COMPLETED', at: now() });
    await persist(workspaceId, record);
    return summarize(record, { done: true });
  }

  function summarize(record, outcome) {
    return {
      jobId: record.state.jobId,
      status: record.state.status,
      checkpoints: record.checkpoints,
      contentId: record.checkpoints.WRITE?.contentId || null,
      revisionId: record.checkpoints.WRITE?.revisionId || null,
      evaluationIds: record.checkpoints.AUDIT?.evaluationIds || [],
      outcome,
    };
  }

  async function start(request) {
    const workspaceId = request.workspaceId || defaultWorkspaceId;
    const jobId = idFactory('job');
    const record = {
      state: jobState.create({
        jobId, projectId: request.projectId, workflowVersion: '1.0.0',
        contentJob: request.jobType, contextSnapshotId: request.contextSnapshotId, at: now(),
      }),
      request,
      checkpoints: {},
      createdAt: now(),
    };
    await persist(workspaceId, record);
    return drive(workspaceId, record);
  }

  async function resume(workspaceId, jobId) {
    const record = await load(workspaceId, jobId);
    if (record.state.status === 'cancelled') throw workflowError('JOB_CANCELLED', `Job "${jobId}" was cancelled.`);
    if (record.state.status === 'completed') return summarize(record, { done: true, alreadyComplete: true });
    if (record.state.status === 'failed') {
      record.state = jobState.transition(record.state, { type: 'JOB_RESUMED', at: now() });
      await persist(workspaceId, record);
    }
    return drive(workspaceId, record);
  }

  async function cancel(workspaceId, jobId, reason = 'user') {
    const record = await load(workspaceId, jobId);
    record.state = jobState.transition(record.state, { type: 'JOB_CANCELLED', reason, at: now() });
    await persist(workspaceId, record);
    return summarize(record, { cancelled: true, reason });
  }

  return { start, resume, cancel, get: (workspaceId, jobId) => load(workspaceId, jobId), STAGES };
}

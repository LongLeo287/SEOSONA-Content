const TERMINAL = new Set(['completed', 'cancelled']);

function clone(value) { return structuredClone(value); }
function assert(condition, message) { if (!condition) throw new Error(message); }
function stamp(event, at) { return { event, at: at || new Date().toISOString() }; }
function appendHistory(state, event) { state.history.push(stamp(event.type, event.at)); return state; }

export function create({ jobId, projectId, workflowVersion, contentJob, contextSnapshotId, at }) {
  assert(jobId && projectId && workflowVersion && contentJob && contextSnapshotId, 'Job identity, project, workflow, content job and context snapshot are required.');
  return {
    contractVersion: '1.0',
    jobId,
    projectId,
    workflowVersion,
    contentJob,
    contextSnapshotId,
    status: 'queued',
    activeStage: null,
    failedStage: null,
    completedStages: [],
    providerAttempts: [],
    history: [stamp('CREATED', at)],
  };
}

export function transition(current, event) {
  assert(current && event && event.type, 'State and event type are required.');
  assert(!TERMINAL.has(current.status), 'Job is already in a terminal state.');
  const next = clone(current);

  switch (event.type) {
    case 'JOB_STARTED':
      assert(['queued', 'failed'].includes(next.status), 'Job can start only from queued or failed.');
      next.status = 'running';
      next.failedStage = null;
      break;

    case 'STAGE_STARTED': {
      assert(['running', 'failed'].includes(next.status), 'Job cannot start a stage from current state.');
      assert(!next.activeStage, 'Another stage is already active.');
      assert(event.stageId && event.stageType, 'Stage id and type are required.');
      assert(!next.completedStages.some((stage) => stage.stageId === event.stageId), `Stage ${event.stageId} is already completed.`);
      next.status = 'running';
      next.failedStage = null;
      next.activeStage = {
        stageId: event.stageId,
        type: event.stageType,
        attempt: event.attempt || 1,
        checkpointRef: null,
        startedAt: event.at || null,
      };
      break;
    }

    case 'STAGE_CHECKPOINTED':
      assert(next.activeStage, 'Checkpoint requires an active stage.');
      assert(event.checkpointRef, 'checkpointRef is required.');
      next.activeStage.checkpointRef = event.checkpointRef;
      break;

    case 'PROVIDER_ATTEMPT_STARTED':
      assert(next.activeStage, 'Provider attempt requires an active stage.');
      assert(event.attemptId && event.providerId, 'Provider attempt id and provider id are required.');
      assert(!next.providerAttempts.some((attempt) => attempt.attemptId === event.attemptId), 'Provider attempt already exists.');
      next.providerAttempts.push({
        attemptId: event.attemptId,
        stageId: next.activeStage.stageId,
        providerId: event.providerId,
        status: 'running',
        startedAt: event.at || null,
      });
      break;

    case 'PROVIDER_ATTEMPT_COMPLETED': {
      const attempt = next.providerAttempts.find((item) => item.attemptId === event.attemptId);
      assert(attempt, 'Unknown provider attempt.');
      assert(attempt.status === 'running', 'Provider attempt is already finalized.');
      attempt.status = event.status || 'completed';
      attempt.receiptId = event.receiptId || null;
      attempt.completedAt = event.at || null;
      break;
    }

    case 'STAGE_COMPLETED': {
      assert(next.activeStage, 'Stage completion requires an active stage.');
      const completed = { ...next.activeStage, outputRef: event.outputRef || null, completedAt: event.at || null };
      next.completedStages.push(completed);
      next.activeStage = null;
      next.failedStage = null;
      next.status = 'running';
      break;
    }

    case 'STAGE_FAILED':
      assert(next.activeStage, 'Stage failure requires an active stage.');
      next.failedStage = { ...next.activeStage, error: clone(event.error || { code: 'STAGE_FAILED', message: 'Stage failed.' }), failedAt: event.at || null };
      next.activeStage = null;
      next.status = 'failed';
      break;

    case 'JOB_RESUMED':
      assert(next.status === 'failed', 'Only failed jobs can be resumed.');
      next.status = 'running';
      break;

    case 'JOB_CANCELLED':
      next.status = 'cancelled';
      next.activeStage = null;
      next.cancelReason = String(event.reason || 'user');
      break;

    case 'JOB_COMPLETED':
      assert(next.status === 'running', 'Only running jobs can complete.');
      assert(!next.activeStage, 'Cannot complete a job with an active stage.');
      next.status = 'completed';
      next.outputRef = event.outputRef || null;
      break;

    default:
      throw new Error(`Unknown job event: ${event.type}.`);
  }

  return appendHistory(next, event);
}

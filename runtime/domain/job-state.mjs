// Reducer trạng thái Job — THUẦN TÚY, không biết gì về nhà cung cấp hay loại nội dung cụ thể.
//
// Tổng quát hóa từ reducer batch cũ, giữ lại 5 bất biến đã chứng minh giá trị:
//   1. Thuần túy — luôn sao chép, không bao giờ sửa state đầu vào.
//   2. history CHỈ NỐI THÊM — không sự kiện nào xóa được dấu vết.
//   3. Chặn trạng thái cuối — completed/cancelled thì không chuyển tiếp được nữa.
//   4. Mọi chuyển trạng thái đều kiểm TRẠNG THÁI NGUỒN trước (chống lùi bậc).
//   5. Sự kiện lạ bị ném lỗi, không im lặng bỏ qua.
//
// Cố ý KHÔNG mang theo khái niệm của luồng cũ (số bản nháp, khâu dựng ảnh, id nền tảng,
// tiến trình đồng hành). Module này chỉ biết: Job → Stage → Attempt.

const TERMINAL = new Set(['completed', 'cancelled']);
const CONTRACT_VERSION = '1.0';

const clone = (v) => structuredClone(v);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function create({ jobId, projectId, workflowVersion, contentJob, contextSnapshotId, at }) {
  assert(jobId && projectId && workflowVersion && contentJob, 'jobId, projectId, workflowVersion and contentJob are required.');
  // Job bị ghim vào một contextSnapshotId ngay từ lúc tạo: bối cảnh không đổi giữa chừng.
  assert(contextSnapshotId, 'contextSnapshotId is required so the job runs against a frozen context.');
  return {
    contractVersion: CONTRACT_VERSION,
    jobId,
    projectId,
    workflowVersion,
    contentJob,
    contextSnapshotId,
    status: 'queued',
    activeStage: null,
    stages: [],
    attempts: [],
    history: [{ event: 'CREATED', at: at || new Date().toISOString() }],
  };
}

function stageFor(state, stageId) {
  const stage = state.stages.find((s) => s.stageId === stageId);
  assert(stage, `Unknown stage: ${stageId}.`);
  return stage;
}

function transition(current, event) {
  assert(current && event && event.type, 'State and event type are required.');
  assert(!TERMINAL.has(current.status), `Job is already in a terminal state: ${current.status}.`);
  const next = clone(current);
  const at = event.at || new Date().toISOString();

  switch (event.type) {
    case 'JOB_STARTED': {
      assert(next.status === 'queued', 'A job can start only from queued.');
      next.status = 'running';
      break;
    }

    case 'STAGE_STARTED': {
      assert(['queued', 'running', 'failed'].includes(next.status), 'Job cannot start a stage from its current state.');
      assert(event.stageId && event.stageType, 'stageId and stageType are required.');
      next.status = 'running';
      // Chạy lại một stage đã có thì cập nhật tại chỗ — không nhân bản stage.
      const existing = next.stages.find((s) => s.stageId === event.stageId);
      const attempt = event.attempt || 1;
      if (existing) {
        existing.status = 'running';
        existing.attempt = attempt;
        delete existing.error;
      } else {
        next.stages.push({ stageId: event.stageId, type: event.stageType, status: 'running', attempt, checkpointRef: null, startedAt: at });
      }
      next.activeStage = { stageId: event.stageId, type: event.stageType, attempt };
      delete next.error;
      break;
    }

    case 'STAGE_CHECKPOINTED': {
      const stage = stageFor(next, event.stageId);
      assert(stage.status === 'running', 'Only a running stage can be checkpointed.');
      assert(event.checkpointRef, 'checkpointRef is required.');
      stage.checkpointRef = event.checkpointRef;
      break;
    }

    case 'STAGE_COMPLETED': {
      const stage = stageFor(next, event.stageId);
      assert(stage.status === 'running', 'Only a running stage can complete.');
      stage.status = 'completed';
      stage.endedAt = at;
      next.activeStage = null;
      break;
    }

    case 'STAGE_FAILED': {
      const stage = stageFor(next, event.stageId);
      assert(stage.status === 'running', 'Only a running stage can fail.');
      stage.status = 'failed';
      stage.endedAt = at;
      stage.error = clone(event.error || { code: 'UNKNOWN', message: 'Stage failed.' });
      next.status = 'failed';
      next.activeStage = null;
      next.error = clone(stage.error);
      break;
    }

    case 'PROVIDER_ATTEMPT_STARTED': {
      assert(next.activeStage, 'A provider attempt requires a running stage.');
      assert(event.attemptId && event.provider, 'attemptId and provider are required.');
      const stageId = event.stageId || next.activeStage.stageId;
      assert(stageId === next.activeStage.stageId, 'Provider attempt must belong to the active stage.');
      next.attempts.push({ attemptId: event.attemptId, stageId, provider: event.provider, status: 'running', startedAt: at });
      break;
    }

    case 'PROVIDER_ATTEMPT_COMPLETED': {
      const attempt = next.attempts.find((a) => a.attemptId === event.attemptId);
      assert(attempt, `Unknown provider attempt: ${event.attemptId}.`);
      assert(attempt.status === 'running', 'Only a running provider attempt can complete.');
      attempt.status = event.status || 'succeeded';
      attempt.endedAt = at;
      // Biên lai chỉ lưu THAM CHIẾU — nội dung biên lai nằm ở kho, không nhét vào state.
      if (event.receiptId) attempt.receiptId = event.receiptId;
      break;
    }

    case 'JOB_RESUMED': {
      assert(next.status === 'failed', 'Only a failed job can be resumed.');
      next.status = 'running';
      delete next.error;
      break;
    }

    case 'JOB_CANCELLED': {
      next.status = 'cancelled';
      next.cancelReason = String(event.reason || 'user');
      next.activeStage = null;
      // Đóng mọi việc đang mở để không còn stage/attempt treo lơ lửng.
      next.stages.forEach((s) => { if (s.status === 'running') { s.status = 'cancelled'; s.endedAt = at; } });
      next.attempts.forEach((a) => { if (a.status === 'running') { a.status = 'cancelled'; a.endedAt = at; } });
      break;
    }

    case 'JOB_COMPLETED': {
      assert(!next.stages.some((s) => s.status === 'running'), 'A job cannot complete while a stage is still running.');
      next.status = 'completed';
      next.activeStage = null;
      break;
    }

    default:
      throw new Error(`Unknown job event: ${event.type}.`);
  }

  next.history.push({ event: event.type, at });
  return next;
}

export const JobState = { create, transition, TERMINAL_STATES: [...TERMINAL], CONTRACT_VERSION };

import { createHash } from 'node:crypto';
import { assertProviderTask, COST_CLASSES } from './contracts.mjs';

// Adapter API qua HTTP.
//
// Lý do tồn tại của file này không phải "để gọi được API trả tiền", mà là để CHỨNG MINH
// tầng trên trung lập: cùng một ProviderTask, chạy qua trình duyệt hay qua API đều ra
// ProviderResult, và Writing Core không phải sửa một dòng nào.
//
// Vì vậy mọi thứ riêng của nhà cung cấp — endpoint, tên model, hình dạng request/response —
// đều là CẤU HÌNH, và mọi việc dịch qua lại nằm gọn trong file này.
//
// Ba ràng buộc về tiền và bí mật:
//   1. Khóa lấy ở thời điểm chạy qua credentialProvider và không bao giờ được ghi ra đĩa;
//      cấu hình lưu lại chỉ có secretRef.
//   2. Không rõ giá thì là UNKNOWN_COST — không bao giờ tự hạ xuống thành "miễn phí".
//   3. Provider tốn tiền thì KHÔNG chạy nếu task chưa cho phép rõ ràng. Chặn TRƯỚC khi gửi,
//      vì sau khi gửi thì tiền đã mất rồi.

const DEFAULT_TIMEOUT_MS = 120_000;

function providerError(code, message, retryable) {
  return { code, message, retryable };
}

// Ánh xạ mã HTTP -> lỗi có kiểu. `retryable` ở đây nghĩa là "thử ở chỗ khác/lúc khác có thể ăn",
// và Gateway dùng đúng cờ này để chuyển provider.
function httpErrorFor(status, message) {
  if (status === 429) return providerError('RATE_LIMITED', message || 'Provider rate limited the request.', true);
  if (status === 401 || status === 403) return providerError('AUTH_REQUIRED', message || 'Provider rejected the credential.', false);
  if (status >= 500) return providerError('PROVIDER_ERROR', message || `Provider failed with HTTP ${status}.`, true);
  return providerError('INVALID_REQUEST', message || `Provider refused the request (HTTP ${status}).`, false);
}

// Đọc text từ vài hình dạng response phổ biến. Không đoán bừa: không thấy text thì báo
// INVALID_PROVIDER_OUTPUT chứ không trả về chuỗi rỗng như thể đã thành công.
function extractText(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.output_text === 'string' && payload.output_text) return payload.output_text;
  const fromChoices = payload.choices?.[0]?.message?.content;
  if (typeof fromChoices === 'string' && fromChoices) return fromChoices;
  const fromContent = payload.content?.[0]?.text;
  if (typeof fromContent === 'string' && fromContent) return fromContent;
  const fromOutput = payload.output?.[0]?.content?.[0]?.text;
  if (typeof fromOutput === 'string' && fromOutput) return fromOutput;
  return null;
}

function hostOf(endpoint) {
  try { return new URL(endpoint).host; } catch { return null; }
}

export function createApiHttpAdapter({
  providerId,
  endpoint,
  model,
  credentialProvider,
  fetchImpl = globalThis.fetch,
  costResolver = null,
  credentialRef = 'runtime:credential',
  now = () => new Date().toISOString(),
} = {}) {
  if (!providerId || !endpoint || !model) {
    throw new TypeError('createApiHttpAdapter: providerId, endpoint and model are required.');
  }
  if (typeof credentialProvider !== 'function') {
    throw new TypeError('createApiHttpAdapter: credentialProvider must be a function.');
  }

  // Biên nhận: đủ để đối chiếu và chẩn đoán, không đủ để rò rỉ. Prompt chỉ còn digest và
  // độ dài — hai lần chạy so được với nhau mà không phải lưu lại nội dung.
  function receiptFor(task, { outcome, errorCode = null, costClass, startedAt, completedAt, prompt }) {
    return {
      providerId,
      taskId: task.taskId,
      contextSnapshotId: task.contextSnapshotId,
      adapterType: 'API',
      endpointHost: hostOf(endpoint),
      model,
      outcome,
      errorCode,
      costClass,
      startedAt,
      completedAt,
      promptDigest: createHash('sha256').update(String(prompt ?? '')).digest('hex'),
      promptChars: String(prompt ?? '').length,
      credentialRef,
    };
  }

  function resultFor(task, fields) {
    const { prompt, ...rest } = fields;
    return {
      providerId,
      modelSession: { model, providerId },
      warnings: [],
      output: null,
      parseStatus: 'NOT_APPLICABLE',
      error: null,
      ...rest,
      receipt: receiptFor(task, {
        outcome: rest.status,
        errorCode: rest.error?.code ?? null,
        costClass: rest.costClass,
        startedAt: rest.startedAt,
        completedAt: rest.completedAt,
        prompt,
      }),
    };
  }

  async function execute(rawTask) {
    const startedAt = now();
    let task;
    try {
      task = assertProviderTask(rawTask);
    } catch (e) {
      // Task sai hình dạng (kể cả rò rỉ selector/tabId từ tầng trình duyệt) thì dừng ngay:
      // gửi đi một yêu cầu dựng từ dữ liệu không hợp lệ chỉ tạo ra rác tốn tiền.
      return {
        providerId, modelSession: null, warnings: [], output: null, parseStatus: 'NOT_APPLICABLE',
        status: 'FAILED', costClass: 'UNKNOWN_COST', startedAt, completedAt: now(),
        error: providerError('INVALID_TASK', e.message, false), receipt: null,
      };
    }

    const prompt = task.contextBundle?.prompt ?? '';
    const warnings = [];

    let costClass = 'UNKNOWN_COST';
    if (costResolver) {
      const resolved = costResolver({ endpoint, model }, task);
      if (COST_CLASSES.has(resolved)) costClass = resolved;
      // Resolver trả bậy thì hạ về "không rõ", KHÔNG bao giờ hạ về "miễn phí".
      else warnings.push(`costResolver returned an unknown cost class "${resolved}"; treated as UNKNOWN_COST.`);
    }

    const settle = (fields) => resultFor(task, { prompt, startedAt, completedAt: now(), costClass, ...fields, warnings: [...warnings, ...(fields.warnings || [])] });

    // Nội dung được đánh dấu không gửi ra ngoài thì adapter từ xa dừng ở đây.
    if (task.privacyPolicy.allowRemote === false) {
      return settle({ status: 'BLOCKED', error: providerError('REMOTE_NOT_ALLOWED', 'This task forbids remote providers.', false) });
    }

    // Chặn tiền TRƯỚC khi gửi. Sau khi gửi thì đã tính phí, có chặn cũng vô nghĩa.
    if ((costClass === 'PAID_ALLOWED' || costClass === 'PAID_BLOCKED') && task.costPolicy.paidApi !== true) {
      return settle({ status: 'BLOCKED', error: providerError('PAID_PROVIDER_BLOCKED', 'Paid API execution is not allowed for this task.', false) });
    }

    let credential;
    try {
      credential = await credentialProvider();
    } catch (e) {
      credential = null;
      warnings.push(`credentialProvider failed: ${e.message}`);
    }
    if (!credential) {
      return settle({ status: 'FAILED', error: providerError('AUTH_REQUIRED', 'No credential is available for this provider.', false) });
    }

    const controller = new AbortController();
    // Hết giờ thì HUỶ THẬT kết nối. Bỏ mặc nó chạy tiếp vẫn bị tính tiền cho một câu trả lời
    // không ai đọc nữa.
    const timer = setTimeout(() => controller.abort(), task.timeoutMs || DEFAULT_TIMEOUT_MS);
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          input: [{ role: 'user', content: prompt }],
          response_format: task.outputContract?.jsonSchema
            ? { type: 'json_schema', json_schema: task.outputContract.jsonSchema }
            : undefined,
        }),
        signal: controller.signal,
      });
    } catch (e) {
      const aborted = e?.name === 'AbortError' || controller.signal.aborted;
      return settle({
        status: 'FAILED',
        error: aborted
          ? providerError('TIMEOUT', 'The provider did not answer in time.', true)
          : providerError('PROVIDER_UNAVAILABLE', `The provider could not be reached: ${e.message}`, true),
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      return settle({ status: 'FAILED', error: httpErrorFor(response.status, body?.error?.message) });
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      return settle({
        status: 'FAILED', parseStatus: 'INVALID',
        error: providerError('INVALID_PROVIDER_OUTPUT', 'The provider returned a body that is not valid JSON.', true),
      });
    }

    const text = extractText(payload);
    if (text === null) {
      return settle({
        status: 'FAILED', parseStatus: 'INVALID',
        error: providerError('INVALID_PROVIDER_OUTPUT', 'The provider response contained no usable text.', true),
      });
    }

    return settle({ status: 'COMPLETED', output: text, parseStatus: 'OK' });
  }

  return { providerId, adapterType: 'API', execute };
}

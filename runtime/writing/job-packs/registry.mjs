import { EVALUATION_DIMENSIONS } from '../contracts.mjs';

// Sổ đăng ký Content Job Pack.
//
// Pack định nghĩa MỘT LOẠI NỘI DUNG: nó cần gì trong brief, đầu ra hình dạng thế nào, luật
// cấu trúc ra sao, phải qua những bài đánh giá nào, và thế nào là xong.
//
// Điều pack KHÔNG được làm là nói tên nhà cung cấp. Thêm một loại nội dung mới phải là việc
// viết thêm một file ở thư mục này — không phải sửa Provider Gateway, không phải sửa Local
// Runtime, và không phải chọn hãng AI thay người dùng.

const REQUIRED_METHODS = ['buildBrief', 'validateDraft', 'definitionOfDone'];

// Tên trường trỏ tới một hãng cụ thể. Chặn ở đây vì đây là chỗ dễ "tiện tay" nhất:
// pack biết nội dung của mình khó, nên muốn tự chọn model — và thế là Auto Router mất việc.
const VENDOR_FIELDS = /^(providerid|provider|preferredprovider|model|modelsession|endpoint|apikey)$/i;
const VENDOR_NAMES = /(chatgpt|openai|gemini|claude|anthropic|grok|xai|llama|mistral)/i;

function packError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function assertJobPack(pack) {
  if (!pack || typeof pack !== 'object') throw new TypeError('jobPack: must be an object.');
  for (const field of ['id', 'version', 'jobType']) {
    if (typeof pack[field] !== 'string' || !pack[field].trim()) {
      throw new TypeError(`jobPack: "${field}" is required.`);
    }
  }
  for (const method of REQUIRED_METHODS) {
    if (typeof pack[method] !== 'function') throw new TypeError(`jobPack: "${method}" must be a function.`);
  }
  if (!pack.outputContract || typeof pack.outputContract !== 'object') {
    throw new TypeError('jobPack: "outputContract" is required — a pack that cannot describe its output cannot be validated.');
  }
  if (!Array.isArray(pack.requiredEvaluators) || !pack.requiredEvaluators.length) {
    throw new TypeError('jobPack: "requiredEvaluators" must list at least one dimension.');
  }
  for (const dimension of pack.requiredEvaluators) {
    if (!EVALUATION_DIMENSIONS.includes(dimension)) {
      throw new TypeError(`jobPack: unknown evaluator dimension "${dimension}".`);
    }
  }

  for (const key of Object.keys(pack)) {
    if (VENDOR_FIELDS.test(key.replace(/[_-]/g, ''))) {
      throw new TypeError(`jobPack: field "${key}" names a provider; a content type must not pick the vendor.`);
    }
  }
  const capabilities = pack.requiredCapabilities || [];
  if (!Array.isArray(capabilities) || capabilities.some((c) => typeof c !== 'string')) {
    throw new TypeError('jobPack: "requiredCapabilities" must be an array of strings.');
  }
  // Khai năng lực cần có thì được ('long-context', 'structured-output'); gọi tên hãng thì không.
  for (const capability of capabilities) {
    if (VENDOR_NAMES.test(capability)) {
      throw new TypeError(`jobPack: capability "${capability}" names a vendor; declare the capability, not the model.`);
    }
  }

  return {
    id: pack.id,
    version: pack.version,
    jobType: pack.jobType,
    requiredBriefFields: [...(pack.requiredBriefFields || [])],
    outputContract: structuredClone(pack.outputContract),
    structureRules: structuredClone(pack.structureRules || {}),
    requiredEvaluators: [...pack.requiredEvaluators],
    requiredCapabilities: [...capabilities],
    rules: [...(pack.rules || [])],
    // Trường có nguồn sự thật: Editor cần biết cái gì KHÔNG được sửa. Bỏ sót nó ở đây thì
    // thao tác sửa văn chung sẽ lặng lẽ ghi đè lên thông số sản phẩm hay lời thoại gốc.
    immutableFields: [...(pack.immutableFields || [])],
    // Pack nhiều thao tác (như transcript) khai danh sách thao tác của nó.
    operations: pack.operations ? [...pack.operations] : null,
    buildBrief: pack.buildBrief.bind(pack),
    validateDraft: pack.validateDraft.bind(pack),
    definitionOfDone: pack.definitionOfDone.bind(pack),
  };
}

export function createJobPackRegistry() {
  const byJobType = new Map();
  const byId = new Map();

  function registerJobPack(pack) {
    const validated = assertJobPack(pack);
    const existing = byId.get(validated.id);
    if (existing) {
      // Đăng ký trùng mà im lặng ghi đè thì một pack có thể bị thay lúc chạy mà không ai biết.
      // Nâng phiên bản là hành động có chủ ý; trùng y hệt là lỗi lập trình.
      if (existing.version === validated.version) {
        throw packError('DUPLICATE_JOB_PACK', `Job pack "${validated.id}" v${validated.version} is already registered.`);
      }
      if (existing.jobType !== validated.jobType) {
        throw packError('DUPLICATE_JOB_PACK', `Job pack id "${validated.id}" is already used by job type "${existing.jobType}".`);
      }
      byJobType.delete(existing.jobType);
    }
    byId.set(validated.id, validated);
    byJobType.set(validated.jobType, validated);
    return validated;
  }

  function getJobPack(jobType) {
    const pack = byJobType.get(jobType);
    // Trả về undefined ở đây sẽ biến một lỗi cấu hình thành một lỗi null-pointer ở tận đâu đó.
    if (!pack) throw packError('UNKNOWN_JOB_TYPE', `No job pack is registered for job type "${jobType}".`);
    return pack;
  }

  return {
    registerJobPack,
    getJobPack,
    listJobPacks: () => [...byJobType.values()],
    hasJobPack: (jobType) => byJobType.has(jobType),
  };
}

// Sổ dùng chung cho Runtime. Test dựng sổ riêng để không giẫm lên nhau.
export const jobPackRegistry = createJobPackRegistry();
export const registerJobPack = (pack) => jobPackRegistry.registerJobPack(pack);
export const getJobPack = (jobType) => jobPackRegistry.getJobPack(jobType);
export const listJobPacks = () => jobPackRegistry.listJobPacks();

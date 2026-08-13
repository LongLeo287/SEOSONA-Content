// Auto Router: chọn provider nào chạy một ProviderTask.
//
// Thứ tự so sánh là TỪ ĐIỂN, không phải điểm tổng có trọng số:
//
//   1. chất lượng quan sát được (cao hơn thắng)
//   2. chi phí (không phát sinh thêm > hạn mức miễn phí > trả tiền đã được cho phép)
//   3. độ ổn định (ít timeout/rate-limit/parse hỏng/retry hơn)
//   4. tốc độ
//
// Vì sao không cộng điểm có trọng số: cộng điểm cho phép "rẻ + nhanh" bù đắp cho "viết tệ".
// Đó chính là thứ người dùng không muốn. Rẻ chỉ được tính đến KHI chất lượng đã ngang nhau.
//
// Chất lượng được CHIA DẢI trước khi so. Chênh 0.02 điểm là nhiễu đo đạc, không phải bằng
// chứng hãng này viết tốt hơn hãng kia; để nhiễu đó lật ngược lựa chọn thì router sẽ nhảy
// hãng liên tục mà người dùng không hiểu vì sao.

export const QUALITY_BAND_WIDTH = 0.1;

// Provider CHƯA CÓ quan sát nào cho việc này rơi vào dải trung tính.
// Đây là một hằng số CHÍNH SÁCH được khai báo rõ, không phải một phép đo:
//   - đặt thấp thì provider mới không bao giờ được chạy, nên không bao giờ được đo -> chết cứng;
//   - đặt cao thì một hãng chưa ai kiểm chứng lại thắng hãng đã chứng minh là tốt.
// Ở giữa: hãng đã chứng minh TỐT thì thắng hãng chưa biết; hãng đã đo thấy KÉM thì thua.
export const NEUTRAL_QUALITY_BAND = Math.round(0.6 / QUALITY_BAND_WIDTH);

const STABILITY_BAND_WIDTH = 0.1;
const NEUTRAL_STABILITY = 0.25; // chưa đo sức khỏe -> phạt vừa phải, không thưởng cũng không loại

const LOCK_SCOPES = ['run', 'stage', 'workflow', 'project', 'global'];

const COST_RANK = { ZERO_INCREMENTAL: 0, FREE_QUOTA: 1, PAID_ALLOWED: 2 };

function qualityBand(provider, task) {
  const summary = provider.qualityByJob?.[task.contentJob];
  const score = summary && typeof summary.score === 'number' ? summary.score : null;
  if (score === null) return NEUTRAL_QUALITY_BAND;
  return Math.round(score / QUALITY_BAND_WIDTH);
}

// Điểm phạt ổn định: chỉ trộn những chỉ số ĐÃ ĐO. Chưa đo gì thì dùng mức trung tính,
// chứ không coi là hoàn hảo.
function stabilityPenalty(health = {}) {
  const penalties = [];
  for (const field of ['timeoutRate', 'rateLimitRate', 'parseFailureRate', 'retryRate']) {
    if (typeof health[field] === 'number') penalties.push(health[field]);
  }
  if (typeof health.selectorHealth === 'number') penalties.push(1 - health.selectorHealth);
  const base = penalties.length
    ? penalties.reduce((a, b) => a + b, 0) / penalties.length
    : NEUTRAL_STABILITY;
  return health.availability === 'DEGRADED' ? Math.min(1, base + 0.5) : base;
}

function ineligible(providerId, reason) {
  return { providerId, eligible: false, reason, sortKey: null };
}

// Loại ứng viên TRƯỚC khi sắp xếp. Mỗi lần loại đều kèm lý do để route-preview giải thích được.
function screen(provider, task, policy) {
  const denied = new Set(policy.denyProviders || []);
  const excluded = new Set(policy.excluded || []);

  if (provider.enabled === false) return ineligible(provider.providerId, 'DISABLED');
  if (denied.has(provider.providerId)) return ineligible(provider.providerId, 'DENIED');
  if (excluded.has(provider.providerId)) return ineligible(provider.providerId, 'EXCLUDED_THIS_RUN');

  const capabilities = new Set(provider.capabilities || []);
  const missing = (task.requiredCapabilities || []).filter((c) => !capabilities.has(c));
  if (missing.length) return ineligible(provider.providerId, 'MISSING_CAPABILITY');

  if (provider.authStatus === 'AUTH_REQUIRED' || provider.health?.auth === 'AUTH_REQUIRED') {
    return ineligible(provider.providerId, 'AUTH_REQUIRED');
  }
  if (provider.health?.availability === 'DOWN') return ineligible(provider.providerId, 'UNAVAILABLE');

  // Chi phí: chặn ở đây chứ không phải ở khâu sắp xếp, để không bao giờ có đường nào
  // lỡ tay chạy một provider tốn tiền mà người dùng chưa đồng ý.
  if (provider.costClass === 'PAID_BLOCKED') return ineligible(provider.providerId, 'PAID_BLOCKED');
  if (provider.costClass === 'UNKNOWN_COST') return ineligible(provider.providerId, 'UNKNOWN_COST');
  if (provider.costClass === 'PAID_ALLOWED' && policy.paidApi !== true) {
    return ineligible(provider.providerId, 'PAID_NOT_ALLOWED');
  }
  if (!(provider.costClass in COST_RANK)) return ineligible(provider.providerId, 'UNKNOWN_COST');

  const health = policy.minHealth || {};
  if (typeof health.maxTimeoutRate === 'number' && typeof provider.health?.timeoutRate === 'number'
    && provider.health.timeoutRate > health.maxTimeoutRate) {
    return ineligible(provider.providerId, 'BELOW_MIN_HEALTH');
  }
  if (typeof health.minSelectorHealth === 'number' && typeof provider.health?.selectorHealth === 'number'
    && provider.health.selectorHealth < health.minSelectorHealth) {
    return ineligible(provider.providerId, 'BELOW_MIN_HEALTH');
  }

  return {
    providerId: provider.providerId,
    eligible: true,
    reason: 'ELIGIBLE',
    sortKey: [
      -qualityBand(provider, task),
      COST_RANK[provider.costClass],
      Math.round(stabilityPenalty(provider.health) / STABILITY_BAND_WIDTH),
      Number.isFinite(provider.latencyMs) ? provider.latencyMs : Number.POSITIVE_INFINITY,
    ],
  };
}

function compareKeys(a, b) {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

function resolveLock(task, policy) {
  const locks = policy.manualLocks || {};
  for (const scope of LOCK_SCOPES) {
    if (locks[scope]) return { providerId: locks[scope], scope };
  }
  // Preference trên task tương đương khóa cấp run, nhưng nhường khóa policy cùng cấp.
  if (task.providerPreference) return { providerId: task.providerPreference, scope: 'run' };
  return null;
}

/**
 * @returns {{providerId: string|null, reason: string, considered: Array, lockScope?: string}}
 * providerId là null khi không chọn được ai; `reason` nói rõ vì sao để bên gọi báo lại
 * cho người dùng thay vì âm thầm làm việc khác.
 */
export function routeProvider({ task, providers = [], policy = {} } = {}) {
  if (!task || typeof task !== 'object') throw new TypeError('routeProvider: task is required.');
  const byId = new Map(providers.map((p) => [p.providerId, p]));

  // 1) Khóa tay thắng tất cả. Kể cả provider chất lượng thấp hơn, chậm hơn, hay chưa rõ giá:
  //    người dùng đã chọn có ý thức. Nhưng khóa vào một provider không dùng được thì DỪNG,
  //    không tự đổi sang hãng khác.
  const lock = resolveLock(task, policy);
  if (lock) {
    const target = byId.get(lock.providerId);
    const usable = target && target.enabled !== false && target.health?.availability !== 'DOWN';
    return usable
      ? { providerId: target.providerId, reason: 'MANUAL_LOCK', lockScope: lock.scope, considered: [
        { providerId: target.providerId, eligible: true, reason: 'MANUAL_LOCK', sortKey: null },
      ] }
      : { providerId: null, reason: 'MANUAL_LOCK_UNAVAILABLE', lockScope: lock.scope, considered: [
        ineligible(lock.providerId, target ? 'DISABLED' : 'PROVIDER_NOT_FOUND'),
      ] };
  }

  // 2) Auto: lọc rồi sắp xếp theo khóa từ điển.
  const considered = providers.map((p) => screen(p, task, policy));
  const eligible = considered.filter((c) => c.eligible);

  if (!eligible.length) {
    // Phân biệt "không có ai" với "chỉ còn hãng tốn tiền mà chưa được phép" — hai việc này
    // cần hai câu trả lời khác nhau cho người dùng.
    //
    // Provider đã thử và hỏng trong chính lượt chạy này (EXCLUDED_THIS_RUN) không được tính:
    // nếu tính, một lần trình duyệt hỏng sẽ che mất thông tin "thứ duy nhất còn lại là hãng
    // tốn tiền" — đúng cái người dùng cần biết để quyết định.
    const remaining = considered.filter((c) => c.reason !== 'EXCLUDED_THIS_RUN');
    const paidReasons = ['PAID_NOT_ALLOWED', 'PAID_BLOCKED', 'UNKNOWN_COST'];
    const paidOnly = remaining.length && remaining.every((c) => paidReasons.includes(c.reason));
    return {
      providerId: null,
      reason: paidOnly ? 'PAID_PROVIDER_BLOCKED' : 'NO_ELIGIBLE_PROVIDER',
      considered,
    };
  }

  // Sắp xếp ổn định: khi mọi khóa bằng nhau, giữ nguyên thứ tự đăng ký để kết quả tất định.
  const winner = eligible
    .map((c, index) => ({ c, index }))
    .sort((a, b) => compareKeys(a.c.sortKey, b.c.sortKey) || a.index - b.index)[0].c;

  return { providerId: winner.providerId, reason: 'AUTO_ROUTED', considered };
}

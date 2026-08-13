// SEOSONA Content — DANH MỤC MODEL theo từng nhà cung cấp
//
// NGUYÊN TẮC: chỉ hiện ô chọn model cho nhà nào extension THẬT SỰ bấm đổi được trên giao diện web.
// Bày một lựa chọn không có tác dụng còn tệ hơn không bày — người dùng tưởng đã đổi model
// trong khi thực tế vẫn chạy model cũ.
//
// `match` = danh sách chuỗi để dò trong menu model của trang (không phân biệt hoa thường,
// thử khớp CHÍNH XÁC trước rồi mới khớp CHỨA). Nhiều chuỗi để chịu được giao diện đa ngôn ngữ
// và việc nhà cung cấp đổi nhãn.
// `tier`: 'quality' = model mạnh (viết, audit, phân tích dài) · 'fast' = model nhanh (việc ngắn).
// Tên model thay đổi rất thường xuyên — sửa danh sách này khi nhà cung cấp đổi lineup.

const MODEL_CATALOG = {
  chatgpt: {
    // ChatGPT: pill chọn model nằm ngay trong khung soạn tin
    models: [
      { value: 'auto',     name: 'Auto (tự chọn theo tác vụ)', tier: 'auto' },
      { value: 'thinking', name: 'Thinking — suy luận sâu',    tier: 'quality', match: ['thinking', 'suy luận', 'reasoning'] },
      { value: 'instant',  name: 'Instant — nhanh',            tier: 'fast',    match: ['instant', 'tức thì', 'nhanh'] },
    ],
  },
  gemini: {
    models: [
      { value: 'auto',    name: 'Auto (tự chọn theo tác vụ)', tier: 'auto' },
      { value: 'pro',     name: 'Pro — chất lượng cao',       tier: 'quality', match: ['pro'] },
      { value: 'thinking', name: 'Thinking — suy luận sâu',   tier: 'quality', match: ['thinking', 'suy luận'] },
      { value: 'flash',   name: 'Flash — nhanh',              tier: 'fast',    match: ['flash', 'nhanh'] },
    ],
  },
  claude: {
    models: [
      { value: 'auto',   name: 'Auto (tự chọn theo tác vụ)', tier: 'auto' },
      { value: 'opus',   name: 'Opus — mạnh nhất',           tier: 'quality', match: ['opus'] },
      { value: 'sonnet', name: 'Sonnet — cân bằng',          tier: 'fast',    match: ['sonnet'] },
    ],
  },
  // Grok: chưa có cơ chế đổi model đáng tin trên giao diện chat → CỐ Ý không bày ô chọn.
};

// Tác vụ nào cần model mạnh. Auto sẽ chọn 'quality' cho nhóm này, 'fast' cho phần còn lại.
const HEAVY_TASKS = new Set([
  'analyze', 'longform', 'review', 'evaluate', 'flow',
  'write', 'audit', 'seo', 'abtest',
  'brief', 'clusters', 'gap', 'keyword_data',
  'repurpose', 'chapters',
]);

// Chấp nhận cả tên chung ('chatgpt-web') lẫn tên trang cũ ('chatgpt'). Danh mục model
// gắn với TRANG WEB nào đang được lái, nên hai tên gọi phải quy về cùng một mục.
const pageOf = (provider) => String(provider || '').replace(/-web$/, '');

const ModelPicker = {
  // Danh sách model của một nhà (rỗng = nhà đó không hỗ trợ đổi model)
  list(provider) {
    const p = MODEL_CATALOG[pageOf(provider)];
    return (p && p.models) ? p.models : [];
  },
  supports(provider) { return this.list(provider).length > 0; },

  // Giải 'auto' thành model cụ thể theo tác vụ. Trả null nếu không đổi được/không cần đổi.
  resolve(provider, chosen, taskKey) {
    const models = this.list(provider);
    if (!models.length) return null;
    if (chosen && chosen !== 'auto') return models.find((m) => m.value === chosen) || null;
    const want = HEAVY_TASKS.has(String(taskKey || '')) ? 'quality' : 'fast';
    return models.find((m) => m.tier === want) || models.find((m) => m.tier === 'quality') || null;
  },

  // Chuỗi cần dò trong menu model của trang
  matchTexts(provider, chosen, taskKey) {
    const m = this.resolve(provider, chosen, taskKey);
    return (m && m.match) ? m.match : null;
  },
};

if (typeof module !== 'undefined' && module.exports) module.exports = { MODEL_CATALOG, ModelPicker, HEAVY_TASKS };

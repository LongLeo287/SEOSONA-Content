import { el, card, empty, table, notice } from '../dom.mjs';

// Màn nhà cung cấp: hiện đúng những gì QUAN SÁT ĐƯỢC, và nói rõ khi nào thì tốn tiền.

const COST_LABELS = {
  ZERO_INCREMENTAL: { text: 'Không phát sinh thêm', badge: 'cost-free' },
  FREE_QUOTA: { text: 'Hạn mức miễn phí', badge: 'cost-free' },
  PAID_ALLOWED: { text: 'Trả phí — đã cho phép', badge: 'cost-paid' },
  PAID_BLOCKED: { text: 'Trả phí — đang chặn', badge: 'cost-paid' },
  UNKNOWN_COST: { text: 'Chưa rõ chi phí', badge: 'cost-paid' },
};

/** Mô hình hiển thị THUẦN. */
export function providerListModel(providers, { error = null } = {}) {
  if (error) return { state: 'error', code: error.code, message: error.message, rows: [] };
  if (!providers || !providers.length) return { state: 'empty', hint: 'Chưa cấu hình nhà cung cấp nào.', rows: [] };

  return {
    state: 'data',
    rows: providers.map((p) => {
      const jobs = Object.entries(p.qualityByJob || {});
      return {
        providerId: p.providerId,
        adapterType: p.adapterType,
        enabled: p.enabled,
        costClass: p.costClass,
        costLabel: COST_LABELS[p.costClass]?.text || p.costClass,
        costBadge: COST_LABELS[p.costClass]?.badge || '',
        // "Trả phí" và "chưa rõ giá" đều phải cảnh báo. Chưa rõ giá KHÔNG được hiển thị như
        // miễn phí, vì người dùng sẽ đọc sự im lặng đó thành "không tốn gì".
        warnsAboutCost: ['PAID_ALLOWED', 'PAID_BLOCKED', 'UNKNOWN_COST'].includes(p.costClass),
        blocked: p.costClass === 'PAID_BLOCKED',
        availability: p.health?.availability || 'UNKNOWN',
        auth: p.health?.auth || 'UNKNOWN',
        // Chưa đo thì nói "chưa đo", không hiện một con số nào cả.
        quality: jobs.length
          ? jobs.map(([job, summary]) => `${job}: ${summary?.score === null || summary?.score === undefined ? 'chưa đủ dữ liệu' : summary.score.toFixed(2)} (${summary?.observations ?? 0} lần)`).join(' · ')
          : 'chưa đo',
        secretRef: p.secretRef || null,
      };
    }),
  };
}

/** Kết quả xem trước tuyến — hiện cả những ứng viên bị loại và VÌ SAO. */
export function routePreviewModel(preview) {
  if (!preview) return { state: 'empty' };
  return {
    state: 'data',
    providerId: preview.providerId,
    reason: preview.reason,
    // Không chọn được ai cũng là một câu trả lời có ích, miễn là nói rõ lý do.
    selected: Boolean(preview.providerId),
    considered: (preview.considered || []).map((c) => ({
      providerId: c.providerId,
      eligible: c.eligible,
      reason: c.reason,
    })),
  };
}

export async function render({ api }) {
  let model;
  try {
    const { providers } = await api.listProviders();
    model = providerListModel(providers);
  } catch (error) {
    model = providerListModel(null, { error });
  }

  const feedback = el('div');
  const previewArea = el('div');

  async function toggle(providerId, enabled) {
    try {
      await api.updateProvider(providerId, { enabled });
      location.reload();
    } catch (error) {
      feedback.replaceChildren(notice('error', `${error.code} — ${error.message}`));
    }
  }

  const paidToggle = el('input', { type: 'checkbox' });
  const previewButton = el('button', {
    text: 'Xem trước Auto sẽ chọn ai',
    onclick: async () => {
      try {
        const preview = routePreviewModel(await api.previewRoute({
          task: {
            taskId: `providertask_preview_${Date.now()}`,
            contentJob: 'article',
            contextSnapshotId: 'contextsnapshot_preview',
            contextBundle: { prompt: '' },
          },
          policy: { paidApi: paidToggle.checked },
        }));
        previewArea.replaceChildren(
          notice(preview.selected ? 'info' : 'error',
            preview.selected ? `Auto sẽ chọn: ${preview.providerId} (${preview.reason})` : `Không chọn được ai — ${preview.reason}`),
          table(['Ứng viên', 'Dùng được', 'Lý do'], preview.considered.map((c) => [c.providerId, c.eligible ? 'có' : 'không', c.reason])),
        );
      } catch (error) {
        previewArea.replaceChildren(notice('error', `${error.code} — ${error.message}`));
      }
    },
  });

  const list = model.state === 'data'
    ? table(
      ['Nhà cung cấp', 'Kiểu', 'Chi phí', 'Tình trạng', 'Đăng nhập', 'Chất lượng đã đo', ''],
      model.rows.map((row) => [
        row.providerId,
        row.adapterType,
        el('span', { class: `badge ${row.costBadge}`, text: row.costLabel }),
        row.availability,
        row.auth,
        row.quality,
        el('button', {
          text: row.enabled ? 'Tắt' : 'Bật',
          onclick: () => toggle(row.providerId, !row.enabled),
        }),
      ]),
    )
    : empty(model.state === 'error' ? `${model.code} — ${model.message}` : model.hint);

  return el('section', {}, [
    el('h1', { text: 'Nhà cung cấp' }),
    model.state === 'data' && model.rows.some((r) => r.blocked)
      ? notice('info', 'Có nhà cung cấp trả phí đang bị chặn. Auto sẽ không tự chạy chúng.')
      : null,
    card([list, feedback]),
    card([
      el('h2', { text: 'Xem trước tuyến' }),
      // Bật trả phí là một hành động RIÊNG và nói thẳng hậu quả. Mặc định luôn là tắt.
      el('label', {}, [paidToggle, el('span', { text: ' Cho phép dùng API trả phí trong lần xem trước này (có thể phát sinh chi phí thật khi chạy)' })]),
      previewButton,
      previewArea,
    ]),
  ]);
}

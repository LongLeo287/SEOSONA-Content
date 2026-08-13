import { el, card, empty, table, notice } from '../dom.mjs';

// Màn đánh giá: hiện vấn đề, KHÔNG tự sửa.
//
// Nút "sửa hộ" ở đây sẽ bỏ qua đúng khoảnh khắc người viết cần nhìn thấy vấn đề — và cái
// người dùng mất là hiểu biết về bài của chính mình, không chỉ một lần bấm.

const SEVERITY_ORDER = { BLOCK: 0, REVIEW: 1, WARN: 2, PASS: 3 };

/** Gom kết quả theo mức nghiêm trọng: nặng nhất lên trước. */
export function auditFindingsModel(evaluations, { error = null } = {}) {
  if (error) return { state: 'error', code: error.code, message: error.message, groups: [] };
  if (!evaluations || !evaluations.length) {
    return { state: 'empty', hint: 'Chưa chấm bản nào.', groups: [], blocking: false };
  }

  const groups = [...evaluations]
    .sort((a, b) => (SEVERITY_ORDER[a.verdict] ?? 9) - (SEVERITY_ORDER[b.verdict] ?? 9))
    .map((evaluation) => ({
      dimension: evaluation.dimension,
      verdict: evaluation.verdict,
      evaluatorId: evaluation.evaluatorId || evaluation.evaluator || 'không rõ',
      // Chưa chấm điểm thì để trống, không hiện 0 — 0 sẽ bị đọc thành "đã chấm và rất tệ".
      score: typeof evaluation.score === 'number' ? evaluation.score : null,
      findings: (evaluation.findings || []).map((f) => ({
        code: f.code,
        message: f.message,
        repairAction: f.repairAction || null,
        evidenceRefs: f.evidenceRefs || [],
      })),
    }));

  return {
    state: 'data',
    groups,
    blocking: groups.some((g) => g.verdict === 'BLOCK'),
    needsHuman: groups.some((g) => g.verdict === 'REVIEW'),
  };
}

export async function render({ api, state }) {
  const contentId = state.selectedContentId;
  if (!contentId) return el('section', {}, [el('h1', { text: 'Đánh giá' }), empty('Chọn một nội dung trước.')]);

  const feedback = el('div');
  const results = el('div');

  async function runAudit() {
    feedback.replaceChildren(notice('info', 'Đang chấm… bản thảo sẽ được gửi tới nhà cung cấp đánh giá.'));
    try {
      const history = await api.getContentHistory(contentId);
      const latest = history[history.length - 1];
      const { evaluations } = await api.runAudit(contentId, {
        revisionId: latest.revisionId, context: { evidenceById: {}, claimsById: {} },
      });
      show(auditFindingsModel(evaluations));
      feedback.replaceChildren();
    } catch (error) {
      show(auditFindingsModel(null, { error }));
      feedback.replaceChildren();
    }
  }

  function show(model) {
    if (model.state !== 'data') {
      results.replaceChildren(empty(model.state === 'error' ? `${model.code} — ${model.message}` : model.hint));
      return;
    }
    results.replaceChildren(
      model.blocking ? notice('error', 'Có trục bị CHẶN. Bài chưa thể coi là xong.') : null,
      model.needsHuman ? notice('info', 'Có trục cần người xem lại.') : null,
      ...model.groups.map((group) => card([
        el('h2', {}, [
          `${group.dimension} `,
          el('span', { class: `badge ${group.verdict.toLowerCase()}`, text: group.verdict }),
          el('span', { class: 'muted', text: ` · ${group.evaluatorId}${group.score === null ? '' : ` · ${group.score}`}` }),
        ]),
        group.findings.length
          ? table(['Mã', 'Vấn đề', 'Cách sửa đề nghị', 'Bằng chứng'], group.findings.map((f) => [
            f.code, f.message, f.repairAction || '—', f.evidenceRefs.join(', ') || '—',
          ]))
          : el('p', { class: 'muted', text: 'Không có vấn đề nào ở trục này.' }),
      ])),
    );
  }

  const runButton = el('button', { class: 'primary', text: 'Chạy đánh giá', onclick: runAudit });

  return el('section', {}, [
    el('h1', { text: 'Đánh giá' }),
    // Nói rõ: đây là màn CHẨN ĐOÁN. Muốn sửa thì sang màn Nội dung và chạy Edit — một hành
    // động riêng, do người dùng quyết định.
    el('p', { class: 'muted', text: 'Đánh giá chỉ chỉ ra vấn đề. Muốn sửa, sang màn Nội dung và chạy Edit.' }),
    card([runButton, feedback]),
    results,
  ]);
}

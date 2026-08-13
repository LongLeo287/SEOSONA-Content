import { el, card, field, empty } from '../dom.mjs';

// Thương hiệu: giọng viết, từ ngữ, và những điều KHÔNG được nói.
//
// V1 cố ý chỉ có ô nhập chữ. Không màu, không logo, không kho ảnh — đó là công cụ thiết kế,
// không phải thứ giúp một câu văn đúng hơn.

const LIST_FIELDS = ['voice', 'do', 'dont', 'audienceVocabulary', 'approvedExamples', 'rejectedExamples', 'negativeRules'];

const linesToList = (value) => String(value || '').split('\n').map((s) => s.trim()).filter(Boolean);

/** Mô hình form THUẦN. */
export function brandFormModel(brand) {
  const source = brand || {};
  return {
    state: brand ? 'data' : 'empty',
    brandId: source.brandId || null,
    revision: Number.isInteger(source.revision) ? source.revision : 0,
    name: source.name || '',
    identity: source.identity || '',
    products: source.products || '',
    fields: Object.fromEntries(LIST_FIELDS.map((key) => [key, [...(source[key] || [])]])),
    // Có sửa là revision phải tăng: một bài chạy hôm qua với giọng khác hôm nay là hai lần
    // chạy khác nhau, và biên nhận phải nói được điều đó.
    nextRevision: (Number.isInteger(source.revision) ? source.revision : 0) + 1,
  };
}

export async function render({ api, state, navigate }) {
  const projectId = state.selectedProjectId;
  if (!projectId) return el('section', {}, [el('h1', { text: 'Thương hiệu' }), empty('Chọn một dự án trước.')]);

  let project = null;
  let error = null;
  try {
    project = await api.getProject(projectId);
  } catch (e) {
    error = e;
  }
  const model = brandFormModel(project?.brand);

  const nameInput = el('input', { type: 'text', value: model.name, placeholder: 'Tên thương hiệu' });
  const inputs = Object.fromEntries(LIST_FIELDS.map((key) => [
    key, el('textarea', { placeholder: 'Mỗi dòng một mục' }),
  ]));
  for (const key of LIST_FIELDS) inputs[key].value = model.fields[key].join('\n');

  const feedback = el('p', { class: 'muted', text: model.brandId ? `Bản ${model.revision}` : 'Chưa có thương hiệu cho dự án này.' });

  const saveButton = el('button', {
    class: 'primary',
    text: 'Lưu thương hiệu',
    onclick: async () => {
      saveButton.disabled = true;
      feedback.textContent = 'Đang lưu…';
      try {
        await api.createBrand({
          brandId: model.brandId || undefined,
          projectId,
          name: nameInput.value.trim() || 'Thương hiệu',
          revision: model.nextRevision,
          ...Object.fromEntries(LIST_FIELDS.map((key) => [key, linesToList(inputs[key].value)])),
        });
        navigate(location.hash);
      } catch (e) {
        feedback.textContent = `${e.code} — ${e.message}`;
        saveButton.disabled = false;
      }
    },
  });

  const labels = {
    voice: 'Giọng viết', do: 'NÊN', dont: 'KHÔNG', audienceVocabulary: 'Từ ngữ người đọc dùng',
    approvedExamples: 'Ví dụ đạt', rejectedExamples: 'Ví dụ không đạt', negativeRules: 'Điều tuyệt đối tránh',
  };

  return el('section', {}, [
    el('h1', { text: 'Thương hiệu' }),
    error ? empty(`${error.code} — ${error.message}`) : null,
    card([
      field('Tên', nameInput),
      ...LIST_FIELDS.map((key) => field(labels[key], inputs[key])),
      saveButton,
      feedback,
    ]),
  ]);
}

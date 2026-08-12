// SEOSONA Content — REPURPOSE (tái sử dụng nội dung có sẵn)
// KHÔNG còn định nghĩa lại luật từng định dạng ở đây — mọi định dạng lấy từ OUTPUT_FORMATS
// (lib/output-formats.js) để sửa một chỗ là mọi nơi cùng tốt lên.
// Vai trò riêng của Repurpose: nguồn là NỘI DUNG ĐÃ CÓ (kịch bản SRT / bài viết), không phải chủ đề trống.

const REPURPOSE_COMMON = `## NGUYÊN TẮC (tái sử dụng nội dung)
- Bám sát nội dung nguồn: mọi luận điểm, ví dụ, con số PHẢI có trong nguồn. Thiếu dữ kiện thì để trống, KHÔNG bịa.
- Giọng tự nhiên như người thật: câu dài–ngắn xen kẽ, có góc nhìn riêng; KHÔNG sáo rỗng, KHÔNG mở bài vòng vo.
- Giữ nguyên thuật ngữ/từ khóa quan trọng của nguồn.
- Trả về MARKDOWN sạch, sẵn sàng đăng.`;

// Dựng REPURPOSE_PROMPTS từ danh mục chung. Giữ nguyên hình dạng {name, body}
// để templates.js (PROMPT_TEMPLATES['repurpose_*']) và app.js không phải đổi.
const REPURPOSE_PROMPTS = (() => {
  const FORMATS = (typeof OUTPUT_FORMATS !== 'undefined') ? OUTPUT_FORMATS : {};
  // Chỉ mở các định dạng có ý nghĩa khi tái chế từ nội dung có sẵn
  const IDS = ['blog', 'thread', 'linkedin', 'facebook', 'carousel', 'email', 'takeaways'];
  const out = {};
  for (const id of IDS) {
    const f = FORMATS[id];
    if (!f) continue;
    out[id] = {
      name: f.name,
      body:
`Bạn là biên tập viên nội dung đa ngành. Biến NỘI DUNG NGUỒN dưới đây thành định dạng được yêu cầu.

${REPURPOSE_COMMON}

## ĐỊNH DẠNG CẦN TẠO
${f.spec}

===== NỘI DUNG NGUỒN =====
{{SOURCE}}`,
    };
  }
  return out;
})();

if (typeof module !== 'undefined' && module.exports) module.exports = { REPURPOSE_PROMPTS, REPURPOSE_COMMON };

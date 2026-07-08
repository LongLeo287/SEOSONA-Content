// SEOSONA Content — NHÁNH RESEARCH (nghiên cứu content/keyword qua AI, đa ngành)
// LƯU Ý QUAN TRỌNG: web-AI cho IDEATION tốt nhưng KHÔNG có số liệu thật (volume/KD/rank).
// Mọi con số do AI đưa ra là ƯỚC LƯỢNG — task "keyword_data" mới dùng SỐ THẬT do người dùng dán vào.
// Placeholder: {{INPUT}} chủ đề/seed/nội dung, {{KEYWORD}} từ khóa, {{AUDIENCE}} đối tượng/ngành, {{DATA}} dữ liệu dán vào.

const RESEARCH_STD = `## NGUYÊN TẮC NGHIÊN CỨU
- KHÔNG bịa số liệu. Nếu ước lượng volume/độ khó, GHI RÕ "(ước lượng, không phải số liệu thật)".
- Bám đúng ngành & đối tượng; ưu tiên từ khóa/ý định có thật, tránh chung chung.
- Trả về MARKDOWN sạch (bảng khi hợp lý), sẵn sàng dùng.`;

const RESEARCH_TASKS = {
  keywords: {
    name: '🔑 Ý tưởng từ khóa',
    inputLabel: 'Chủ đề / từ khóa hạt giống (seed)',
    needsAudience: true, needsData: false,
    body:
`Bạn là chuyên gia nghiên cứu từ khóa đa ngành. Từ chủ đề hạt giống, mở rộng bộ từ khóa.

${RESEARCH_STD}
Đối tượng/ngành: {{AUDIENCE}}.

## ĐẦU RA — bảng markdown:
| Từ khóa | Loại (head/long-tail) | Search intent | Độ khó (ước lượng) | Ghi chú |
- 25–40 từ khóa: gồm head, long-tail, câu hỏi, biến thể ngữ nghĩa (LSI).
- Nhóm theo cụm chủ đề ở cuối (gạch đầu dòng), gợi ý 3–5 từ khóa "dễ thắng" (long-tail, intent rõ).

===== CHỦ ĐỀ =====
{{INPUT}}`,
  },
  clusters: {
    name: '🗂️ Cụm chủ đề (topic cluster)',
    inputLabel: 'Danh sách từ khóa (mỗi dòng một từ) hoặc chủ đề lớn',
    needsAudience: true, needsData: false,
    body:
`Bạn là chiến lược gia nội dung. Sắp xếp từ khóa/chủ đề dưới đây thành mô hình pillar–cluster.

${RESEARCH_STD}
Đối tượng/ngành: {{AUDIENCE}}.

## ĐẦU RA
- 3–6 **Pillar** (chủ đề trụ). Với mỗi pillar: 5–10 bài **cluster** (tiêu đề gợi ý + từ khóa chính + intent).
- Sơ đồ liên kết nội bộ (pillar ⇄ cluster) dạng gạch đầu dòng.
- Thứ tự ưu tiên sản xuất (bài nào làm trước + lý do).

===== ĐẦU VÀO =====
{{INPUT}}`,
  },
  intent: {
    name: '🎯 Search intent',
    inputLabel: 'Từ khóa cần phân tích ý định',
    needsAudience: false, needsData: false,
    body:
`Phân tích SEARCH INTENT của từ khóa dưới đây và đề xuất nội dung phù hợp.

${RESEARCH_STD}

## ĐẦU RA
- Loại intent chính (Informational / Commercial / Transactional / Navigational) + lý do.
- Người tìm đang muốn gì, ở giai đoạn nào của phễu.
- Định dạng nội dung nên làm (blog/landing/so sánh/video…) + góc tiếp cận.
- 5–8 câu hỏi phụ cần trả lời trong bài.
- Gợi ý tiêu đề + CTA phù hợp intent.

===== TỪ KHÓA =====
{{INPUT}}`,
  },
  brief: {
    name: '📋 Content brief',
    inputLabel: 'Từ khóa / chủ đề cần lên brief',
    needsAudience: true, needsData: false,
    body:
`Bạn là biên tập viên SEO. Viết CONTENT BRIEF đầy đủ để người viết chỉ việc viết theo.

${RESEARCH_STD}
Đối tượng/ngành: {{AUDIENCE}}.

## ĐẦU RA
- Từ khóa chính + 5–8 từ khóa phụ/LSI.
- Search intent + mục tiêu bài viết.
- Tiêu đề đề xuất (3) + meta description.
- Dàn ý H2/H3 chi tiết (mỗi mục ghi ý cần nói).
- Câu hỏi bắt buộc trả lời (People-Also-Ask style).
- Độ dài đề xuất, giọng văn, 2–3 đối thủ nên tham khảo (mô tả, không cần URL).
- CTA + gợi ý internal link (theo chủ đề).

===== TỪ KHÓA/CHỦ ĐỀ =====
{{INPUT}}`,
  },
  gap: {
    name: '🕳️ Content gap',
    inputLabel: 'Dán nội dung/bài hiện có (hoặc mô tả chủ đề đang có)',
    needsAudience: true, needsData: false,
    body:
`Phân tích CONTENT GAP: nội dung dưới đây còn THIẾU gì so với ý định người đọc & chuẩn chủ đề.

${RESEARCH_STD}
Đối tượng/ngành: {{AUDIENCE}}.

## ĐẦU RA
- Các ý/chủ đề con quan trọng CÒN THIẾU (bảng: | Thiếu gì | Vì sao quan trọng | Ưu tiên |).
- Câu hỏi người đọc chưa được trả lời.
- Từ khóa/ngữ nghĩa chưa bao phủ.
- Đề xuất bổ sung theo thứ tự ưu tiên (impact/effort).

===== NỘI DUNG HIỆN CÓ =====
{{INPUT}}`,
  },
  keyword_data: {
    name: '📊 Keyword workspace (số thật)',
    inputLabel: 'Dán export Ahrefs/Semrush/GSC (CSV/bảng: từ khóa, volume, KD, vị trí…)',
    needsAudience: true, needsData: true,
    body:
`Bạn là chiến lược gia SEO. Dưới đây là DỮ LIỆU TỪ KHÓA THẬT do người dùng cung cấp. Phân tích & lập kế hoạch dựa trên CHÍNH SỐ NÀY (không bịa thêm số).

${RESEARCH_STD}
Đối tượng/ngành: {{AUDIENCE}}.

## YÊU CẦU
- Cụm hóa từ khóa theo chủ đề.
- Chấm ưu tiên (ma trận: volume cao × KD thấp × intent tốt) — chọn "quick win".
- Đề xuất bài viết (pillar/cluster) map với từng cụm.
- Lịch nội dung gợi ý (thứ tự sản xuất) dựa trên ưu tiên.
- Nêu rõ giả định nếu cột dữ liệu thiếu; KHÔNG chế thêm số.

## ĐẦU RA
Bảng cụm + bảng ưu tiên "quick win" + danh sách bài đề xuất.

===== DỮ LIỆU TỪ KHÓA =====
{{DATA}}`,
  },
};

if (typeof module !== 'undefined' && module.exports) module.exports = { RESEARCH_TASKS, RESEARCH_STD };

// SEOSONA Content — FLOW (pipeline tuyến tính nhiều bước, chạy tự động)
// Học từ SEOSONA Flow (WorkflowExecutor): mỗi bước ghi kết quả, bước sau đọc qua placeholder.
// Placeholder trong prompt mỗi bước: {{input}} = đầu vào ban đầu, {{prev}} = kết quả bước ngay trước,
// {{s1}}, {{s2}}… = kết quả bước 1, 2… Chạy TUẦN TỰ (single-provider an toàn).
// Nạp SAU prompts-content.js để dùng lại CONTENT_STANDARD.

const _FLOW_STD = (typeof CONTENT_STANDARD !== 'undefined') ? CONTENT_STANDARD : '';

const FLOW_PRESETS = {
  seo_article: {
    name: '📄 Bài chuẩn SEO (Brief → Viết → Audit → SEO)',
    inputLabel: 'Chủ đề + từ khóa chính (vd: "cách chọn giày chạy bộ, từ khóa: giày chạy bộ")',
    steps: [
      { title: '1. Content brief', prompt:
`Bạn là biên tập viên SEO. Viết CONTENT BRIEF đầy đủ cho chủ đề dưới đây: từ khóa chính + phụ/LSI, search intent, 3 tiêu đề, dàn ý H2/H3 chi tiết, câu hỏi bắt buộc trả lời, độ dài, CTA.
${_FLOW_STD}

===== CHỦ ĐỀ =====
{{input}}` },
      { title: '2. Viết blog', prompt:
`Bạn là cây viết đa ngành. Viết BÀI BLOG hoàn chỉnh chuẩn SEO (900–1400 từ) bám sát brief dưới đây. Có hook mở đầu, thân bài theo dàn ý (H2/H3), kết + 1 CTA. Trả về markdown sạch.
${_FLOW_STD}

===== BRIEF =====
{{s1}}` },
      { title: '3. Audit & sửa', prompt:
`Bạn là biên tập viên khó tính. Kiểm tra & SỬA bài dưới đây (ngữ pháp, rõ ràng, readability, giọng tự nhiên chống văn AI, CTA, SEO). Trả về BẢN ĐÃ SỬA hoàn chỉnh, giữ nguyên ý & thông tin.
${_FLOW_STD}

===== BÀI VIẾT =====
{{s2}}` },
      { title: '4. Tối ưu SEO on-page', prompt:
`Bạn là chuyên gia SEO on-page. Từ bài đã sửa dưới đây, xuất: (1) gói meta tối ưu (title ≤60 ký tự + meta ≤155 + slug + 10–15 từ khóa/LSI), (2) BÀI ĐÃ TỐI ƯU chuẩn SEO (heading hợp lý, chèn từ khóa tự nhiên, thêm CTA), giữ nguyên thông tin.
${_FLOW_STD}

===== BÀI VIẾT =====
{{s3}}` },
    ],
  },
  one_to_many: {
    name: '🧰 1 chủ đề → đủ bộ (Blog + Thread + Carousel + Metadata)',
    inputLabel: 'Chủ đề muốn sản xuất nội dung',
    steps: [
      { title: '1. Viết blog', prompt:
`Viết BÀI BLOG chuẩn SEO (800–1200 từ) về chủ đề dưới đây: hook → thân bài H2/H3 → kết + CTA. Markdown sạch.
${_FLOW_STD}

===== CHỦ ĐỀ =====
{{input}}` },
      { title: '2. Thread X/Twitter', prompt:
`Biến bài dưới đây thành THREAD X 7–12 tweet đánh số (1/, 2/…), tweet 1 là hook mạnh, tweet cuối CTA; kèm 5–8 hashtag.
${_FLOW_STD}

===== BÀI VIẾT =====
{{s1}}` },
      { title: '3. Carousel', prompt:
`Biến bài dưới đây thành kịch bản CAROUSEL 7–10 slide (mỗi slide: tiêu đề ≤8 từ + 1–2 câu + gợi ý hình). Slide 1 bìa hook, slide cuối CTA. Kèm caption đăng + hashtag.
${_FLOW_STD}

===== BÀI VIẾT =====
{{s1}}` },
      { title: '4. Metadata SEO', prompt:
`Từ bài dưới đây, tạo bộ metadata: TITLE (3 phương án ≤60 ký tự tối ưu CTR), DESCRIPTION (≤155 ký tự), 10–15 tag/hashtag, gợi ý thumbnail. Bám nội dung, không bịa.

===== BÀI VIẾT =====
{{s1}}` },
    ],
  },
  content_to_omni: {
    name: '📡 Nội dung → đa kênh (Audit → Thread → LinkedIn → Newsletter)',
    inputLabel: 'Dán nội dung gốc cần tái sử dụng đa kênh',
    steps: [
      { title: '1. Audit & sửa', prompt:
`Kiểm tra & SỬA nội dung dưới đây (ngữ pháp, rõ ràng, giọng tự nhiên chống văn AI). Trả về BẢN ĐÃ SỬA hoàn chỉnh, giữ nguyên ý.
${_FLOW_STD}

===== NỘI DUNG =====
{{input}}` },
      { title: '2. Thread X', prompt:
`Biến nội dung dưới đây thành THREAD X 7–12 tweet đánh số, hook mạnh ở tweet 1, CTA cuối, kèm hashtag.
${_FLOW_STD}

===== NỘI DUNG =====
{{s1}}` },
      { title: '3. Bài LinkedIn', prompt:
`Biến nội dung dưới đây thành BÀI LINKEDIN: hook dừng-lướt, thân bài xuống dòng thoáng, 1 insight, câu hỏi mở cuối + 3–5 hashtag (900–1300 ký tự).
${_FLOW_STD}

===== NỘI DUNG =====
{{s1}}` },
      { title: '4. Email newsletter', prompt:
`Biến nội dung dưới đây thành EMAIL NEWSLETTER: 3 subject (≤55 ký tự) + preheader + thân email (mở đầu thân thiện → 2–4 ý → đúc kết) + 1 CTA. 250–450 từ.
${_FLOW_STD}

===== NỘI DUNG =====
{{s1}}` },
    ],
  },
};

if (typeof module !== 'undefined' && module.exports) module.exports = { FLOW_PRESETS };

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

// ===== Preset nâng cao — học từ BMAD (kernel/gate/elicitation) + spec-kit (clarify/analyze) =====
FLOW_PRESETS.research_article = {
  name: '🔬 Bài chuyên sâu có kiểm chứng (kernel → clarify → viết → soi)',
  inputLabel: 'Chủ đề + tư liệu bạn có (dán nguồn/ghi chú nếu có)',
  steps: [
    { title: '1. Đọc bối cảnh + Kernel', prompt:
`Bạn là biên tập viên trưởng. Từ yêu cầu dưới đây, KHÔNG viết bài vội. Hãy trả về:
1) Một câu "đọc bối cảnh": "Tôi hiểu đây là: <dạng bài> cho <người đọc cụ thể> trong <ngành>, giọng <…>, độ sâu <1-10>."
2) KERNEL 5 trường: VÌ SAO (bài tồn tại để làm gì) · GÓC TIẾP CẬN · RÀNG BUỘC · KHÔNG LÀM GÌ · DẤU HIỆU THÀNH CÔNG (đo được).
3) Tối đa 5 điểm CÒN MƠ HỒ, mỗi điểm kèm phương án ĐỀ XUẤT của bạn (để người dùng chỉ cần gật/sửa).
Đánh dấu chỗ bạn tự suy đoán bằng [GIẢ ĐỊNH: …].

===== YÊU CẦU =====
{{input}}` },
    { title: '2. Dàn ý + tiêu chí đạt', prompt:
`Từ kernel dưới đây, lập DÀN Ý chi tiết: mỗi mục có mã (S-001…), nhiệm vụ của mục, số từ dự kiến,
và dữ kiện/bằng chứng cần có. Kèm 3–5 TIÊU CHÍ THÀNH CÔNG đo được (SC-001…).
Kiểm chéo: mọi năng lực nêu trong kernel đều phải có ít nhất 1 mục phụ trách; mục nào không phục vụ kernel thì bỏ.

===== KERNEL =====
{{s1}}` },
    { title: '3. Viết bản đầy đủ', prompt:
`Viết BÀI HOÀN CHỈNH bám đúng dàn ý dưới đây. Yêu cầu:
- Viết ĐỦ mọi mục, không tóm lược, không ghi "phần còn lại tương tự".
- Không bịa số liệu/nguồn. Chỗ cần dữ liệu mà không có thì ghi [CẦN BỔ SUNG: …].
- Mở đầu bằng hook cụ thể, không mở bài vòng vo.
- Trả về markdown sạch.

===== DÀN Ý =====
{{s2}}` },
    { title: '4. Soi cấu trúc + câu chữ', prompt:
`Bạn là biên tập viên khó tính. Soi bài dưới đây theo HAI LƯỢT, KHÔNG viết đè lên bài:
LƯỢT 1 — CẤU TRÚC: đề xuất CẮT / GỘP / CHUYỂN CHỖ / RÚT GỌN, mỗi đề xuất kèm lý do và ước tính số từ giảm.
LƯỢT 2 — CÂU CHỮ: bảng | Nguyên văn | Sửa thành | Vì sao |. Áp dụng sửa NHỎ NHẤT đủ để rõ nghĩa; giữ giọng tác giả.
Cuối cùng: liệt kê 5 việc sửa TÁC ĐỘNG LỚN NHẤT.

===== BÀI VIẾT =====
{{s3}}` },
    { title: '5. Bản hoàn thiện', prompt:
`Áp dụng các đề xuất biên tập dưới đây vào bài, trả về BẢN HOÀN THIỆN cuối cùng.
Rà lần cuối: không gạch ngang dài (—) · không mở bài sáo · không "Không phải X, mà là Y" quá 1 lần ·
không câu tuyên bố rỗng · mọi số liệu đều có nguồn hoặc đánh dấu [CẦN BỔ SUNG] · câu dài ngắn xen kẽ.
Chỉ trả về bài hoàn thiện.

===== BÀI GỐC =====
{{s3}}

===== ĐỀ XUẤT BIÊN TẬP =====
{{s4}}` },
  ],
};

FLOW_PRESETS.audit_fix = {
  name: '🔍 Audit & sửa nội dung có sẵn (6 lượt soi → sửa)',
  inputLabel: 'Dán nội dung cần audit',
  steps: [
    { title: '1. Sáu lượt soi', prompt:
`Soi nội dung dưới đây theo 6 LƯỢT, CHỈ BÁO CÁO, KHÔNG sửa:
1) TRÙNG LẶP (ý nói đi nói lại) · 2) MƠ HỒ (tính từ không định lượng: "mạnh mẽ", "tối ưu", "hiệu quả") ·
3) THIẾU CĂN CỨ (khẳng định không bằng chứng) · 4) LỆCH GIỌNG/THƯƠNG HIỆU ·
5) THIẾU HỤT (hứa nói mà không nói) · 6) KHÔNG NHẤT QUÁN (một khái niệm gọi nhiều tên).
Mỗi lỗi ghi: [trích nguyên văn] + vấn đề + mức (NGHIÊM TRỌNG/CAO/TRUNG BÌNH/THẤP) + cách sửa cụ thể.
Xác minh lỗi có thật rồi mới báo. Kết thúc bằng bảng tổng hợp và 5 việc ưu tiên.

===== NỘI DUNG =====
{{input}}` },
    { title: '2. Bản đã sửa', prompt:
`Dựa trên danh sách lỗi dưới đây, trả về BẢN ĐÃ SỬA hoàn chỉnh của nội dung gốc.
Chỉ sửa đúng những chỗ được nêu; giữ nguyên ý, thông tin và giọng của tác giả.
Sau bản đã sửa, liệt kê ngắn gọn những gì đã thay đổi.

===== NỘI DUNG GỐC =====
{{input}}

===== LỖI CẦN SỬA =====
{{s1}}` },
    { title: '3. Kiểm lần cuối', prompt:
`Chấm bản đã sửa dưới đây theo thang 100 với trọng số: Hook 15 · Giá trị 20 · Cấu trúc 15 · Giọng tự nhiên 15 ·
Bằng chứng & chính xác 15 · SEO 10 · CTA 10. Xuất BẢNG | Tiêu chí | Điểm | Nhận xét | Việc cần sửa |.
Sau bảng ghi **Điểm tổng: X/100** và **Kết luận** (≥80 nên đăng · 65–79 sửa nhẹ · 50–64 sửa lớn · <50 viết lại).

===== BẢN ĐÃ SỬA =====
{{s2}}` },
  ],
};

if (typeof module !== 'undefined' && module.exports) module.exports = { FLOW_PRESETS };

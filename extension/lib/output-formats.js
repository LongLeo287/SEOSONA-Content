// SEOSONA Content — DANH MỤC ĐỊNH DẠNG ĐẦU RA (một nguồn sự thật duy nhất)
// Trước đây blog/thread/LinkedIn/email được định nghĩa RIÊNG ở 3 nơi (Content, Repurpose, Flow)
// nên sửa chất lượng một chỗ thì hai chỗ kia vẫn cũ. Giờ mọi nơi đọc từ đây.
// Mỗi định dạng: name (hiển thị) + spec (luật đầu ra chi tiết, bơm thẳng vào prompt).
// File này phải được nạp TRƯỚC prompts-content.js và prompts-repurpose.js.

const OUTPUT_FORMATS = {
  blog: {
    name: '📝 Bài blog / website (chuẩn SEO)',
    spec:
`Dạng: BÀI BLOG chuẩn SEO, 900–1400 từ.
- Mở đầu có hook cụ thể (không mở bài vòng vo), nêu ngay vấn đề của người đọc.
- Thân bài chia H2/H3 rõ ràng; đoạn 2–4 câu; dùng gạch đầu dòng khi liệt kê.
- Kết bài + MỘT CTA gắn lợi ích.
- Kèm ở đầu: 3 phương án tiêu đề (≤60 ký tự) + meta description (≤155 ký tự) + 5–8 từ khóa gợi ý.`,
  },
  thread: {
    name: '🧵 Thread X / Twitter',
    spec:
`Dạng: THREAD X 7–12 tweet, đánh số (1/, 2/…).
- Tweet 1 = hook mạnh (tò mò hoặc tuyên bố táo bạo), ≤280 ký tự, gợi lý do đọc tiếp.
- Mỗi tweet MỘT ý, ngắt dòng thoáng, ≤280 ký tự.
- Tweet cuối = đúc kết + 1 CTA.
- Sau thread: 5–8 hashtag phù hợp.`,
  },
  linkedin: {
    name: '💼 Bài LinkedIn',
    spec:
`Dạng: BÀI LINKEDIN 900–1300 ký tự.
- Dòng đầu = hook dừng-lướt (1–2 câu, tò mò hoặc ngược dòng).
- Thân bài xuống dòng thoáng, mỗi ý 1–2 câu; gạch đầu dòng khi liệt kê.
- Nêu rõ MỘT bài học/insight rút ra.
- Kết = câu hỏi mở để tăng bình luận + CTA nhẹ. 3–5 hashtag cuối bài.`,
  },
  facebook: {
    name: '📘 Bài Facebook',
    spec:
`Dạng: BÀI FACEBOOK, dưới 500 ký tự là tối ưu.
- Câu đầu chặn lướt; văn nói tự nhiên, gần gũi.
- Xuống dòng thoáng, emoji vừa phải (không spam).
- Link để riêng một dòng. Kết bằng câu hỏi thật (bỏ nếu chỉ là câu mồi tương tác rỗng).`,
  },
  email: {
    name: '✉️ Email / newsletter',
    spec:
`Dạng: EMAIL NEWSLETTER 250–450 từ.
- 3 phương án tiêu đề email (≤55 ký tự, rõ hơn là "kêu"), + preheader (≤90 ký tự, KHÔNG lặp lại tiêu đề).
- Thân: chào mở đầu thân thiện → bối cảnh/câu chuyện ngắn → 2–4 ý chính (gạch đầu dòng) → đúc kết.
- MỘT CTA duy nhất. Giọng trò chuyện 1-1, đoạn ngắn dễ đọc trên điện thoại.`,
  },
  carousel: {
    name: '🎠 Carousel (IG / LinkedIn)',
    spec:
`Dạng: KỊCH BẢN CAROUSEL 7–10 slide. Mỗi slide một khối:
### Slide N
- Tiêu đề slide (≤8 từ, đọc được ở cỡ nhỏ)
- Nội dung (1–2 câu ngắn hoặc 2–3 gạch đầu dòng)
- Gợi ý hình/biểu tượng
Slide 1 = bìa (hook + lợi ích). Slide cuối = tóm tắt + CTA.
Kèm caption đăng bài (2–4 câu) + 5–8 hashtag.`,
  },
  script: {
    name: '🎬 Kịch bản video ngắn',
    spec:
`Dạng: KỊCH BẢN VIDEO NGẮN 30–60 giây.
- HOOK 3 giây đầu: chặn lướt, không chào hỏi.
- Thân: 1 ý giá trị duy nhất, nói thẳng, câu ngắn.
- CTA cuối: MỘT hành động.
- Trình bày theo dòng thoại, kèm gợi ý hình ảnh trong ngoặc.`,
  },
  ad: {
    name: '📣 Ad copy (quảng cáo)',
    spec:
`Dạng: AD COPY — trả về 3 biến thể: (a) ngắn gọn, (b) đầy đủ hơn, (c) CTA mạnh.
Mỗi biến thể: hook → lợi ích cụ thể (có số nếu nguồn có) → gỡ rủi ro → CTA.
Ghi rõ góc tiếp cận của từng biến thể. Không hứa suông, không bịa số liệu.`,
  },
  outline: {
    name: '🗂️ Dàn ý chi tiết',
    spec:
`Dạng: DÀN Ý CHI TIẾT.
- Cấu trúc H2/H3, mỗi mục ghi rõ Ý CẦN NÓI (không viết thành bài).
- Kèm số từ dự kiến từng mục và dữ kiện/bằng chứng cần có.
- Cuối: danh sách câu hỏi bắt buộc trả lời trong bài.`,
  },
  takeaways: {
    name: '💡 Tóm tắt / key takeaways',
    spec:
`Dạng: TÓM TẮT.
1. TL;DR 2–3 câu.
2. 5–8 takeaway, mỗi ý một gạch đầu dòng, cụ thể (có số liệu nếu nguồn có).
3. 3 câu trích đáng nhớ, bám sát nguyên văn nguồn.
4. 3 gợi ý tiêu đề ngắn để tái đăng.`,
  },
};

// Nhãn ngắn để đổ vào <select> (giữ tương thích với code cũ đọc CONTENT_FORMATS)
const OUTPUT_FORMAT_LABELS = Object.fromEntries(
  Object.entries(OUTPUT_FORMATS).map(([k, v]) => [k, v.name])
);

if (typeof module !== 'undefined' && module.exports) module.exports = { OUTPUT_FORMATS, OUTPUT_FORMAT_LABELS };

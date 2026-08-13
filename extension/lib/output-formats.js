// SEOSONA Content — DANH MỤC ĐỊNH DẠNG ĐẦU RA (một nguồn sự thật duy nhất)
// Mọi nơi (Content / Repurpose / Flow) đọc từ đây, không định nghĩa lại luật định dạng.
//
// TÁCH BẠCH HAI LOẠI QUY TẮC (theo 21_TARGET_RULE_MATRIX + 22_SOURCE_REGISTRY của spec):
//   - `spec`   = KHUYẾN NGHỊ BIÊN TẬP. Do ta chủ động chọn, luôn đúng, không cần nguồn ngoài.
//   - `limits` = GIỚI HẠN NỀN TẢNG (số ký tự, số dòng...). Đây là DỮ KIỆN BÊN NGOÀI có thể đổi
//                bất cứ lúc nào. Mỗi mục phải mang `status`:
//                  VERIFIED  — đã đối chiếu tài liệu chính thức, kèm `sourceRef` + `verifiedAt`
//                  UNVERIFIED— con số tham khảo, CHƯA đối chiếu nguồn chính thức
//                Quy tắc: KHÔNG khẳng định giới hạn "hiện hành" khi chưa xác minh.
//                Thiếu/cũ/mâu thuẫn nguồn ⇒ nói rõ là chưa xác minh, KHÔNG bịa ra con số hiện hành.
// Ghi chú: hiện TẤT CẢ đều UNVERIFIED — chưa nối Source Registry. Prompt sẽ nói rõ điều đó
// thay vì trình bày như luật cứng.

const OUTPUT_FORMATS = {
  blog: {
    name: '📝 Bài blog / website (chuẩn SEO)',
    spec:
`Dạng: BÀI BLOG chuẩn SEO.
- Mở đầu có hook cụ thể (không mở bài vòng vo), nêu ngay vấn đề của người đọc.
- Thân bài chia H2/H3 rõ ràng; đoạn ngắn 2–4 câu; dùng gạch đầu dòng khi liệt kê.
- Kết bài + MỘT CTA gắn lợi ích.
- Kèm ở đầu: 3 phương án tiêu đề + meta description + 5–8 từ khóa gợi ý.`,
    limits: [
      { field: 'độ dài bài', value: '900–1400 từ', status: 'UNVERIFIED', note: 'khuyến nghị theo kinh nghiệm, không phải luật của nền tảng' },
      { field: 'tiêu đề', value: '≤ 60 ký tự', status: 'UNVERIFIED', note: 'độ dài hiển thị trên kết quả tìm kiếm thay đổi theo thời gian' },
      { field: 'meta description', value: '≤ 155 ký tự', status: 'UNVERIFIED', note: 'ngưỡng cắt của công cụ tìm kiếm có thể đã đổi' },
    ],
  },
  thread: {
    name: '🧵 Thread X / Twitter',
    spec:
`Dạng: THREAD X, đánh số (1/, 2/…).
- Tweet 1 = hook mạnh (tò mò hoặc tuyên bố táo bạo), gợi lý do đọc tiếp.
- Mỗi tweet MỘT ý, ngắt dòng thoáng.
- Tweet cuối = đúc kết + 1 CTA. Sau thread: 5–8 hashtag phù hợp.`,
    limits: [
      { field: 'số tweet', value: '7–12', status: 'UNVERIFIED', note: 'khuyến nghị biên tập' },
      { field: 'độ dài mỗi tweet', value: '≈ 280 ký tự', status: 'UNVERIFIED', note: 'giới hạn nền tảng — KHÁC NHAU theo loại tài khoản, cần kiểm tra lại' },
    ],
  },
  linkedin: {
    name: '💼 Bài LinkedIn',
    spec:
`Dạng: BÀI LINKEDIN.
- Dòng đầu = hook dừng-lướt (1–2 câu, tò mò hoặc ngược dòng).
- Thân bài xuống dòng thoáng, mỗi ý 1–2 câu.
- Nêu rõ MỘT bài học/insight. Kết = câu hỏi mở + CTA nhẹ, 3–5 hashtag cuối bài.`,
    limits: [
      { field: 'độ dài bài', value: '≈ 900–1300 ký tự', status: 'UNVERIFIED', note: 'khuyến nghị để không bị thu gọn; ngưỡng thật do nền tảng quyết định' },
    ],
  },
  facebook: {
    name: '📘 Bài Facebook',
    spec:
`Dạng: BÀI FACEBOOK.
- Câu đầu chặn lướt; văn nói tự nhiên, gần gũi.
- Xuống dòng thoáng, emoji vừa phải (không spam).
- Link để riêng một dòng. Kết bằng câu hỏi thật (bỏ nếu chỉ là câu mồi tương tác rỗng).`,
    limits: [
      { field: 'độ dài tối ưu', value: '< 500 ký tự', status: 'UNVERIFIED', note: 'khuyến nghị biên tập, không phải giới hạn cứng' },
    ],
  },
  email: {
    name: '✉️ Email / newsletter',
    spec:
`Dạng: EMAIL NEWSLETTER.
- 3 phương án tiêu đề email (rõ hơn là "kêu") + preheader (KHÔNG lặp lại tiêu đề).
- Thân: chào mở đầu thân thiện → bối cảnh/câu chuyện ngắn → 2–4 ý chính → đúc kết.
- MỘT CTA duy nhất. Giọng trò chuyện 1-1, đoạn ngắn dễ đọc trên điện thoại.`,
    limits: [
      { field: 'độ dài thân email', value: '250–450 từ', status: 'UNVERIFIED', note: 'khuyến nghị biên tập' },
      { field: 'tiêu đề email', value: '≤ 55 ký tự', status: 'UNVERIFIED', note: 'độ dài hiển thị khác nhau theo ứng dụng mail — cần kiểm chứng' },
      { field: 'preheader', value: '≤ 90 ký tự', status: 'UNVERIFIED', note: 'như trên' },
    ],
  },
  carousel: {
    name: '🎠 Carousel (IG / LinkedIn)',
    spec:
`Dạng: KỊCH BẢN CAROUSEL. Mỗi slide một khối:
### Slide N
- Tiêu đề slide (ngắn, đọc được ở cỡ nhỏ)
- Nội dung (1–2 câu ngắn hoặc 2–3 gạch đầu dòng)
- Gợi ý hình/biểu tượng
Slide 1 = bìa (hook + lợi ích). Slide cuối = tóm tắt + CTA.
Kèm caption đăng bài (2–4 câu) + 5–8 hashtag.`,
    limits: [
      { field: 'số slide', value: '7–10', status: 'UNVERIFIED', note: 'khuyến nghị; số slide tối đa do nền tảng quy định, cần kiểm tra' },
    ],
  },
  script: {
    name: '🎬 Kịch bản video ngắn',
    spec:
`Dạng: KỊCH BẢN VIDEO NGẮN.
- HOOK 3 giây đầu: chặn lướt, không chào hỏi.
- Thân: 1 ý giá trị duy nhất, nói thẳng, câu ngắn.
- CTA cuối: MỘT hành động.
- Trình bày theo dòng thoại, kèm gợi ý hình ảnh trong ngoặc.`,
    limits: [
      { field: 'thời lượng', value: '30–60 giây', status: 'UNVERIFIED', note: 'khuyến nghị; giới hạn thật tùy nền tảng đăng' },
    ],
  },
  ad: {
    name: '📣 Ad copy (quảng cáo)',
    spec:
`Dạng: AD COPY — trả về 3 biến thể: (a) ngắn gọn, (b) đầy đủ hơn, (c) CTA mạnh.
Mỗi biến thể: hook → lợi ích cụ thể (có số nếu nguồn có) → gỡ rủi ro → CTA.
Ghi rõ góc tiếp cận của từng biến thể. Không hứa suông, không bịa số liệu.
LƯU Ý: quảng cáo chịu chính sách riêng của nền tảng — tránh tuyên bố bị hạn chế
(sức khỏe, tài chính, cam kết kết quả). Nếu không chắc, ghi rõ là cần rà chính sách.`,
    limits: [],
  },
  outline: {
    name: '🗂️ Dàn ý chi tiết',
    spec:
`Dạng: DÀN Ý CHI TIẾT.
- Cấu trúc H2/H3, mỗi mục ghi rõ Ý CẦN NÓI (không viết thành bài).
- Kèm số từ dự kiến từng mục và dữ kiện/bằng chứng cần có.
- Cuối: danh sách câu hỏi bắt buộc trả lời trong bài.`,
    limits: [],
  },
  takeaways: {
    name: '💡 Tóm tắt / key takeaways',
    spec:
`Dạng: TÓM TẮT.
1. TL;DR 2–3 câu.
2. 5–8 takeaway, mỗi ý một gạch đầu dòng, cụ thể (có số liệu nếu nguồn có).
3. 3 câu trích đáng nhớ, bám sát nguyên văn nguồn.
4. 3 gợi ý tiêu đề ngắn để tái đăng.`,
    limits: [],
  },
};

// Nhãn ngắn cho <select> (giữ tương thích code cũ đọc CONTENT_FORMATS)
const OUTPUT_FORMAT_LABELS = Object.fromEntries(
  Object.entries(OUTPUT_FORMATS).map(([k, v]) => [k, v.name])
);

// Dựng phần "định dạng" để bơm vào prompt: khuyến nghị biên tập + giới hạn KÈM TRẠNG THÁI.
// Cố ý nói rõ con số nào chưa xác minh, để AI không trình bày chúng như luật cứng của nền tảng.
function outputFormatPrompt(id) {
  const f = OUTPUT_FORMATS[id];
  if (!f) return '';
  let out = f.name + '\n' + f.spec;
  const lim = f.limits || [];
  if (lim.length) {
    const unverified = lim.some((l) => l.status !== 'VERIFIED');
    out += '\n\n## Giới hạn tham khảo\n';
    out += lim.map((l) => `- ${l.field}: ${l.value}${l.status === 'VERIFIED' ? '' : '  [CHƯA XÁC MINH]'}${l.note ? ' — ' + l.note : ''}`).join('\n');
    if (unverified) {
      out += '\n\nCÁC SỐ ĐÁNH DẤU [CHƯA XÁC MINH] là mức tham khảo, KHÔNG phải giới hạn chính thức'
        + ' hiện hành của nền tảng. Hãy bám sát chúng như khuyến nghị, nhưng KHÔNG khẳng định với'
        + ' người đọc rằng "nền tảng giới hạn X ký tự". Nếu người dùng cần con số chính xác, nói rõ'
        + ' là cần kiểm tra tài liệu chính thức của nền tảng.';
    }
  }
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { OUTPUT_FORMATS, OUTPUT_FORMAT_LABELS, outputFormatPrompt };
}

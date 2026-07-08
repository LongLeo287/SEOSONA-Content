// SEOSONA Content — REPURPOSE (tái sử dụng nội dung)
// Biến nội dung 1 video/SRT thành nhiều định dạng: blog, thread, LinkedIn, carousel, newsletter...
// Mỗi prompt có {{SOURCE}} = nội dung nguồn (transcript SRT hoặc kịch bản đã cắt).
// Nguyên tắc chung: GIỮ ĐÚNG dữ kiện nguồn, KHÔNG bịa số liệu; giọng tự nhiên như người thật (chống văn AI).

const REPURPOSE_COMMON = `## NGUYÊN TẮC (SEOSONA)
- Bám sát nội dung nguồn: mọi luận điểm, ví dụ, con số PHẢI có trong nguồn. Thiếu dữ kiện thì để trống, KHÔNG bịa.
- Giọng tự nhiên như người thật: câu dài–ngắn xen kẽ, có góc nhìn riêng; KHÔNG sáo rỗng, KHÔNG "trong thế giới ngày nay…", KHÔNG lạm dụng tính từ đại ngôn.
- Tiếng Việt, xưng hô gần gũi nhưng chuyên nghiệp. Giữ nguyên thuật ngữ/từ khóa quan trọng.
- Trả về MARKDOWN sạch, sẵn sàng đăng.`;

const REPURPOSE_PROMPTS = {
  blog: {
    name: '📝 Bài blog chuẩn SEO',
    body:
`Bạn là biên tập viên nội dung SEOSONA. Từ nội dung nguồn, viết MỘT bài blog hoàn chỉnh chuẩn SEO (900–1400 từ).

${REPURPOSE_COMMON}

## ĐẦU RA
1. **Đề xuất tiêu đề** (3 phương án, có từ khóa chính, ≤ 65 ký tự).
2. **Meta description** (≤ 155 ký tự, có từ khóa).
3. **Dàn ý** (H2/H3) trước khi vào bài.
4. **Bài viết đầy đủ** theo dàn ý: mở bài có hook, thân bài chia H2/H3, có gạch đầu dòng khi hợp lý, kết bài + 1 CTA.
5. **Từ khóa gợi ý** (5–10) và 3 gợi ý internal link (mô tả chủ đề, không cần URL).

===== NỘI DUNG NGUỒN =====
{{SOURCE}}`,
  },
  thread: {
    name: '🧵 Thread X/Twitter',
    body:
`Bạn là người viết thread giỏi. Biến nội dung nguồn thành MỘT thread X (Twitter) 7–12 tweet.

${REPURPOSE_COMMON}

## ĐẦU RA
- Tweet 1 = hook mạnh (curiosity-gap hoặc tuyên bố táo bạo, ≤ 280 ký tự), gợi lý do đọc tiếp.
- Mỗi tweet 1 ý, đánh số (1/, 2/ …), ngắt dòng thoáng, mỗi tweet ≤ 280 ký tự.
- Tweet cuối = đúc kết + 1 CTA (follow/lưu/chia sẻ).
- Sau thread, liệt kê 5–8 hashtag phù hợp.`,
  },
  linkedin: {
    name: '💼 Bài LinkedIn',
    body:
`Bạn là chuyên gia content LinkedIn. Viết MỘT bài đăng LinkedIn từ nội dung nguồn.

${REPURPOSE_COMMON}

## ĐẦU RA
- Dòng đầu = hook dừng-lướt (1–2 câu, tạo tò mò/ngược dòng).
- Thân bài xuống dòng thoáng (mỗi ý 1–2 câu), có thể dùng gạch đầu dòng cho danh sách.
- 1 bài học/insight rút ra rõ ràng.
- Kết = 1 câu hỏi mở để tăng comment + CTA nhẹ.
- 3–5 hashtag ở cuối. Độ dài 900–1300 ký tự.`,
  },
  carousel: {
    name: '🎠 Carousel (IG/LinkedIn)',
    body:
`Bạn là designer content. Biến nội dung nguồn thành kịch bản CAROUSEL 7–10 slide.

${REPURPOSE_COMMON}

## ĐẦU RA — mỗi slide một khối:
### Slide N
- **Tiêu đề slide** (≤ 8 từ, đọc được ở cỡ nhỏ)
- **Nội dung** (1–2 câu ngắn hoặc 2–3 gạch đầu dòng)
- **Gợi ý hình/biểu tượng** (mô tả ngắn)

Slide 1 = bìa (hook + lợi ích). Slide cuối = tóm tắt + CTA (follow/lưu). Kèm caption đăng bài (2–4 câu) + 5–8 hashtag ở cuối.`,
  },
  newsletter: {
    name: '✉️ Email newsletter',
    body:
`Bạn là người viết newsletter. Biến nội dung nguồn thành MỘT email newsletter.

${REPURPOSE_COMMON}

## ĐẦU RA
- **Subject line** (3 phương án, ≤ 55 ký tự, tăng open-rate, không spam).
- **Preheader** (≤ 90 ký tự).
- **Thân email**: chào mở đầu thân thiện → 1 câu chuyện/ngữ cảnh ngắn → 2–4 ý chính (có gạch đầu dòng) → đúc kết.
- **CTA** rõ ràng (một hành động).
- Giọng trò chuyện 1-1, đoạn ngắn dễ đọc trên mobile. Độ dài 250–450 từ.`,
  },
  takeaways: {
    name: '💡 Key takeaways / tóm tắt',
    body:
`Tóm tắt nội dung nguồn thành các điểm mấu chốt, dùng để mô tả video / ghi chú / repost nhanh.

${REPURPOSE_COMMON}

## ĐẦU RA
1. **TL;DR** (2–3 câu).
2. **5–8 takeaway** (mỗi cái 1 gạch đầu dòng, cụ thể, có số liệu nếu nguồn có).
3. **3 quote đáng nhớ** trích/gần sát nguyên văn từ nguồn.
4. **Gợi ý 3 tiêu đề ngắn** để tái đăng.`,
  },
};

if (typeof module !== 'undefined' && module.exports) module.exports = { REPURPOSE_PROMPTS };

# SOP — Quy trình chuẩn dùng SEOSONA SRT Studio

Tài liệu này mô tả quy trình vận hành từ đầu đến cuối để biến một file `.srt` (phụ đề video dài) thành kịch bản short-form đã cắt ghép, kèm SEO metadata và đánh giá chất lượng.

---

## 0. Chuẩn bị (làm một lần)

1. Cài extension: `chrome://extensions` → bật **Developer mode** → **Load unpacked** → chọn thư mục `extension/`.
2. **Đăng nhập sẵn** các web AI muốn dùng trong cùng cửa sổ Chrome:
   - ChatGPT — https://chatgpt.com
   - Gemini — https://gemini.google.com
   - Grok — https://grok.com
   - Claude — https://claude.ai
3. Mở side panel: bấm icon extension trên thanh công cụ.

> Extension **không dùng API trả phí** — nó tự động hóa chính tài khoản web bạn đang đăng nhập. Muốn dùng AI nào thì phải đăng nhập AI đó trước.

---

## 1. Quy trình chính (1 file SRT)

Giao diện là **một luồng dọc 4 bước** (stepper), mỗi bước xong tự mở bước sau.

### Bước 1 — Nạp SRT
- Kéo thả file `.srt` vào ô, hoặc dán nội dung → **⚡ Nạp SRT**.
- Kiểm tra dòng thông tin: số cue, thời lượng nguồn, tổng thời gian nói.

### Bước 2 — Phân tích
1. **Mẫu prompt**: mặc định là *Master Prompt v2* (cắt–đảo–ghép). Có thể mở "Xem/sửa prompt gốc" để chỉnh.
2. **🧠 Kiến thức SEOSONA**: bật các block muốn bơm vào prompt — Hook formulas, Cấu trúc 5 phần, Copywriting (PAS/QUEST/SCAR/AIDA), Brand voice VN, Ưu tiên từ khóa SEO.
3. **🎯 Nền tảng**: chọn YouTube Shorts / TikTok / Reels / YouTube dài → tự set độ dài mục tiêu + tỉ lệ.
4. **🎭 Số góc cắt**: 1 = một kịch bản; 2–5 = sinh nhiều góc tiếp cận khác nhau từ cùng một file.
5. **Chạy trên AI**: tick một hay nhiều AI (chạy song song để so sánh).
6. **🚀 Gửi phân tích**. Extension tự mở tab AI, gõ prompt, chờ trả lời. Trên tab AI có **badge tiến độ** (pha + đồng hồ + nút Stop). Khi xong sẽ có **toast** và **thông báo hệ thống** (kể cả khi bạn đang ở tab khác).
7. Xem "Kết quả thô", chọn AI ưng ý → **✂ Dựng bảng cắt ghép**.

### Bước 3 — Cắt ghép & Xuất
- Bảng segment được **đối chiếu tự động** với SRT gốc: `khớp 100%` / `lệch text` / `không khớp timecode`.
- Nếu có nhiều góc: chuyển qua lại bằng thanh angle ở đầu.
- Sắp xếp ↑↓, xóa đoạn thừa.
- **Xuất file**: `.cut.srt` (SRT ghép), `.cutlist.csv`, `.edl`, `.fcpxml`, `.captions.txt` (CapCut), `.script.md`, `.metadata.txt`, `.project.json`.
- **🔎 SEO metadata**: chọn AI → **Sinh metadata** → title/description/hashtag/thumbnail → xuất `.txt`.

### Bước 4 — Đánh giá
- Tick một hay nhiều AI → **★ Gửi đánh giá** → điểm Hook/Flow/Retention/CTA dạng thanh + **consensus** trung bình nhiều AI + verdict.

---

## 2. Thư viện prompt + biến (📚)

- **Lưu prompt tái dùng**: soạn prompt ở bước Phân tích → mở 📚 → **Lưu prompt đang soạn**.
- **Biến động**: dùng cú pháp `{{ten_bien}}` trong prompt (vd `{{chu_de}}`, `{{nen_tang}}`). Khi bấm **Dùng**, extension hiện ô điền giá trị, thay hết rồi áp vào prompt.
- Ví dụ: `Tập trung vào chủ đề {{chu_de}} cho nền tảng {{nen_tang}}`.

---

## 3. Batch nhiều file SRT (📦)

Dùng khi có nhiều file cần xử lý cùng một cấu hình.

1. Cấu hình sẵn ở bước Phân tích (prompt + kiến thức + nền tảng + số góc) — batch dùng lại đúng cấu hình này.
2. Mở 📦 → **Thêm file .srt** (chọn nhiều) → chọn **provider**.
3. **▶ Chạy batch**: xử lý **tuần tự** từng file (tránh loạn tab). Mỗi file xong tự dựng bảng.
4. Bấm **⬇** ở mỗi dòng để tải SRT ghép của file đó, hoặc **Tải tất cả SRT ghép**.
5. **⛔ Dừng** để ngắt giữa chừng.

> Batch tận dụng cơ chế **auto-retry** (thử lại 2 lần khi lỗi tạm thời) nên bền hơn khi chạy nhiều file.

---

## 4. Khi một AI đổi giao diện làm hỏng tự động hóa (⚙)

Đây là sự cố phổ biến nhất. Cách xử lý **không cần cập nhật extension**:

1. Mở tab AI bị lỗi, bật **DevTools** (F12) → dùng công cụ chọn phần tử để lấy CSS selector mới (vd nút gửi, ô nhập).
2. Trong side panel, mở **⚙ Settings**.
3. Chọn **Provider** + **Thành phần** (editor / sendButton / assistantNode / generating / stop / responseInner / blockedSelector).
4. Dán selector mới (mỗi dòng một cái — hệ thống thử lần lượt tới khi trúng) → **Lưu override**.
5. **Tải lại tab AI** để áp dụng.

Muốn quay lại mặc định: **Về mặc định** (một key) hoặc **Xóa hết** (tất cả).

---

## 5. Lịch sử & khôi phục (🕘)

- Mỗi lần phân tích xong được ghi vào **🕘 Lịch sử** (20 lần gần nhất).
- **Mở lại**: nạp lại SRT + kết quả AI của lần đó vào project hiện tại để dựng bảng/so sánh.
- **↺ Làm mới project**: xóa project hiện tại, bắt đầu lại.

---

## 6. Xử lý sự cố nhanh

| Triệu chứng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| "Không tìm thấy ô nhập chat" | Chưa đăng nhập, hoặc AI đổi UI | Đăng nhập lại; nếu vẫn lỗi → override `editor` trong ⚙ |
| "AI không bắt đầu trả lời" | Nút gửi đổi selector, hoặc bị rate limit | Override `sendButton`; đợi rồi chạy lại (auto-retry đã thử 2 lần) |
| "Trang đang yêu cầu đăng nhập/xác minh" | Cloudflare/captcha | Xử lý thủ công trên tab AI rồi chạy lại |
| Lấy text lúc đang stream dở | Rất hiếm — cơ chế chờ ổn định 8 chu kỳ | Chạy lại; nếu lặp lại, tăng Timeout |
| Bảng cắt ghép trống | Output AI không đúng định dạng bảng markdown | Xem "Kết quả thô", nhắc AI trả đúng bảng, hoặc đổi AI |
| Không parse được SRT | Sai định dạng timecode | Kiểm tra dạng `HH:MM:SS,mmm --> HH:MM:SS,mmm` |

---

## 7. Nguyên tắc dữ liệu (quan trọng)

- Text hiển thị và **xuất file luôn lấy từ SRT gốc**, không lấy từ AI — chống AI bịa/sửa chữ.
- Mỗi segment AI chọn đều được đối chiếu lại **timecode + nguyên văn** với SRT gốc trước khi dùng.
- Toàn bộ chạy **cục bộ**, không gửi dữ liệu ra server nào của extension (chỉ tương tác với tab web AI bạn đã đăng nhập).

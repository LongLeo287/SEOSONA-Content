# SEOSONA SRT Studio

Chrome extension (Manifest V3) **phân tích – đánh giá – cắt ghép nội dung từ file SRT** để làm video short-form (Shorts/TikTok/Reels).

Extension đóng vai trò **trung gian điều khiển**: không gọi API trả phí, mà tự động hóa trực tiếp các web AI bạn đang đăng nhập sẵn — **ChatGPT, Gemini, Grok, Claude** — để phân tích SRT theo Master Prompt, rồi nhận kết quả về, validate và xuất file dựng.

## Luồng làm việc

```
┌──────────────┐   1. nạp SRT    ┌─────────────────────┐
│  Side Panel  │ ──────────────▶ │  Master Prompt v2    │
│  (điều khiển)│                 │  + nội dung SRT      │
└──────┬───────┘                 └─────────┬───────────┘
       │ 2. srt:runJob                     │
       ▼                                   ▼
┌──────────────┐  tabs.sendMessage  ┌──────────────────────┐
│  Background  │ ─────────────────▶ │ Content script       │
│  (relay+queue│                    │ chatgpt/gemini/      │
│   +tab mgr)  │ ◀───────────────── │ grok/claude          │
└──────┬───────┘   srt:jobResult    │ • chèn prompt (paste │
       │ 3. broadcast + storage     │   → execCommand)     │
       ▼                            │ • click gửi          │
┌──────────────┐                    │ • poll đến khi text  │
│  Side Panel  │                    │   ổn định 8 chu kỳ   │
│ 4. parse bảng│                    │ • trích innerText    │
│    markdown  │                    └──────────────────────┘
│ 5. validate với SRT gốc (timecode + text 100%)          │
│ 6. sắp xếp / xóa đoạn → xuất SRT ghép, CSV, EDL, MD     │
│ 7. (tùy chọn) gửi kịch bản cho AI khác chấm điểm        │
└──────────────┘
```

## Cài đặt

1. Mở `chrome://extensions`, bật **Developer mode**.
2. **Load unpacked** → chọn thư mục [`extension/`](extension).
3. Đăng nhập sẵn các trang AI muốn dùng (chatgpt.com, gemini.google.com, grok.com, claude.ai).
4. Bấm icon extension để mở side panel.

## Sử dụng

| Bước | Tab | Việc làm |
|---|---|---|
| 1 | **SRT** | Kéo thả file `.srt` hoặc dán nội dung → **Nạp SRT** |
| 2 | **Phân tích** | Bật **Knowledge Pack**, chọn **nền tảng** + **số góc cắt**, chọn **AI** muốn chạy → **Gửi phân tích** |
| 3 | **Cắt ghép** | Bảng segment dựng từ output AI, **validate tự động** với SRT gốc: `khớp 100%` / `lệch text` / `không khớp timecode`. Chuyển giữa các **angle**, sắp xếp ↑↓, xóa đoạn, xuất file, **sinh SEO metadata** |
| 4 | **Đánh giá** | Gửi kịch bản cho **AI** chấm điểm Hook / Flow / Retention / CTA → **điểm số** trực quan |

### 🧠 Content Intelligence

Extension bơm kiến thức content thật vào prompt thay vì để AI tự đoán. Toàn bộ kiến thức **đóng gói sẵn trong extension** (không phụ thuộc dịch vụ hay dự án ngoài). Các block bật/tắt trong tab Phân tích:

- **Hook formulas** — 5 mẫu (Stat / Claim / Question / Story / Counter-intuitive)
- **Cấu trúc 5 phần** — Hook → Intro → Value → Retention Hook → CTA
- **Công thức copywriting** — PAS / QUEST / SCAR / AIDA
- **Brand voice SEOSONA (VN)** — DO/DON'T, xưng hô, chống giọng AI
- **Platform presets** — YouTube Shorts / TikTok / Reels / YouTube dài (tự set độ dài + tỉ lệ + kiểu hook)
- **Multi-angle** — 1 SRT → tối đa 5 góc cắt khác nhau trong một lần chạy

> Kiến thức nằm gọn trong `extension/lib/knowledge.js` — muốn thêm/sửa hook, công thức, brand voice hay platform preset thì sửa trực tiếp file này. Extension là repo độc lập, cài và chạy không cần bất kỳ thành phần nào bên ngoài.

### Xuất file (tab Cắt ghép)

- **`.cut.srt`** — SRT mới đã ghép, timeline chạy liên tục từ 0 (đúng duration từng cue gốc)
- **`.cutlist.csv`** — bảng cắt cho editor (source in/out, duration, text)
- **`.edl`** — CMX3600, import vào **Premiere / DaVinci Resolve** (chọn FPS + tên clip nguồn)
- **`.fcpxml`** — FCPXML 1.9, import vào **DaVinci Resolve / Final Cut Pro**
- **`.captions.txt`** — caption từng dòng cho **CapCut** / dán tay
- **`.script.md`** — kịch bản dạng bảng markdown
- **`.metadata.txt`** — title / description / hashtag / thumbnail prompt (sinh bằng AI)
- **`.project.json`** — lưu toàn bộ project (nhiều angle + metadata)

File xuất tự thêm hậu tố angle (`.a1`, `.a2`…) khi có nhiều góc cắt.

## Kiến trúc code

```
extension/
├── manifest.json          # MV3: side panel + content scripts 4 provider
├── background.js          # relay job, quản lý tab provider, storage.session
├── content/
│   ├── common.js          # engine chung: chèn text 3 tầng, poll ổn định, đăng ký provider
│   ├── chatgpt.js         # selectors + hooks cho chatgpt.com
│   ├── gemini.js          # gemini.google.com
│   ├── grok.js            # grok.com
│   └── claude.js          # claude.ai
├── lib/
│   ├── srt-parser.js      # parse/serialize SRT, timecode utils
│   ├── knowledge.js       # Knowledge Pack: hook/formula/brand-voice/platform (từ SEOSONA OS)
│   ├── templates.js       # Master Prompt v2 + PromptBuilder (ghép knowledge+platform+angle) + prompt đánh giá/metadata
│   ├── output-parser.js   # parse bảng markdown → segment; multi-angle; điểm số; metadata
│   └── exporter.js        # SRT ghép / CSV / EDL / FCPXML / captions / metadata / Markdown / JSON
└── sidepanel/             # UI điều khiển (index.html, app.js, styles.css)
```

### Cơ chế chống hỏng (học từ extension automation thực chiến)

- **Chèn text 3 tầng**: `ClipboardEvent('paste')` (giữ state ProseMirror/Quill) → `execCommand('insertText')` → ghi DOM trực tiếp.
- **Phát hiện AI trả lời xong**: đếm message mới so với baseline trước khi gửi, rồi poll đến khi text **ổn định 8 chu kỳ** (~5.6s) và không còn nút Stop/indicator streaming — tránh lấy text lúc đang stream dở.
- **Job chạy dài không chết theo service worker**: content script ack ngay rồi trả kết quả bằng message `srt:jobResult` riêng (không giữ `sendResponse` mở), kết quả lưu `storage.session` nên đóng/mở side panel không mất.
- **Tab phải active khi chạy**: Chrome throttle timer của tab nền → background tự activate tab provider trước khi gửi.
- **Guardrail dữ liệu**: mọi segment AI trả về đều được đối chiếu lại timecode + nguyên văn với SRT gốc; text hiển thị/xuất file luôn lấy **từ SRT gốc**, không lấy từ AI (chống AI bịa/sửa chữ).

### Độ bền & trải nghiệm (đúc kết từ extension automation thực chiến)

- **Chống vỡ UI — selector config**: selector 4 provider nằm ở [lib/selectors-default.js](extension/lib/selectors-default.js) dạng data, mỗi vai trò có **nhiều fallback**. Khi một AI đổi giao diện làm hỏng, mở **⚙ Settings trong side panel** → dán selector mới → tải lại tab AI. **Không cần sửa code / rebuild**. Override lưu ở `chrome.storage.local.srtSelectorOverrides`.
- **Fail nhanh có lý do**: nhận diện text lỗi của provider (rate limit, content policy) để trả lỗi rõ thay vì chờ timeout.
- **Auto-retry**: lỗi tạm thời (timeout / không phản hồi / lỗi mạng) tự thử lại tối đa 2 lần với backoff 3s/6s; lỗi đăng nhập / content-blocked / hủy thì không.
- **Floating tracker**: badge tiến độ hiện ngay trên tab AI khi đang phân tích (pha + đồng hồ + nút Stop).
- **Phản hồi**: toast trong panel ở các mốc; **thông báo hệ thống** khi job xong lúc bạn đang ở tab khác.
- **Nhật ký chạy** (🕘): 20 lần gần nhất, mở lại để nạp SRT + kết quả.

## Bảo trì selector

Khi một provider hỏng: mở **⚙ Settings** trong side panel, chọn provider + thành phần, dán selector mới (mỗi dòng một cái), Lưu, rồi tải lại tab AI. Lấy selector mới bằng DevTools trên trang AI. Bản mặc định nằm ở `extension/lib/selectors-default.js`.

## Roadmap

- [x] Content Intelligence: bơm hook/formula/brand-voice vào prompt (đóng gói sẵn)
- [x] Platform presets + multi-angle (1 SRT → N shorts)
- [x] Chấm điểm AI: Hook/Flow/Retention/CTA (điểm số trực quan)
- [x] Sinh SEO metadata (title/description/hashtag/thumbnail)
- [x] Xuất FCPXML + caption CapCut (bên cạnh EDL)
- [x] Chống vỡ UI: selector config + override trong Settings
- [x] Floating tracker trên tab AI + toast + thông báo hệ thống
- [x] Auto-retry backoff cho lỗi tạm thời
- [x] Nhật ký lịch sử chạy (mở lại được)
- [x] Thư viện prompt tái dùng + biến `{{...}}` (📚)
- [x] Batch nhiều file SRT chạy hàng loạt (📦, dùng queue + retry)
- [ ] Trình quản lý Knowledge Pack ngay trong UI
- [ ] Đính kèm SRT dạng file upload; chia SRT dài chạy tuần tự
- [ ] Chạy song song nhiều AI + tổng hợp consensus (hiện tại: chạy 1 AI mỗi lần)

## Tài liệu

- [docs/SOP.md](docs/SOP.md) — quy trình chuẩn dùng extension từ đầu đến cuối (nạp SRT → phân tích → cắt ghép → đánh giá, batch, thư viện prompt, override selector, xử lý sự cố).

## Prompt gốc

Xem [docs/prompts/Short-Form_SRT_Master_Prompt_v2.md](docs/prompts/Short-Form_SRT_Master_Prompt_v2.md). Bản nhúng trong `lib/templates.js` có bổ sung phần **OUTPUT FORMAT bắt buộc dạng bảng markdown** để máy parse được ổn định.

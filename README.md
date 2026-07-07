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
| 2 | **Phân tích** | Bật **Knowledge Pack**, chọn **nền tảng** + **số góc cắt**, tick AI muốn chạy (song song nhiều AI để so sánh) → **Gửi phân tích** |
| 3 | **Cắt ghép** | Bảng segment dựng từ output AI, **validate tự động** với SRT gốc: `khớp 100%` / `lệch text` / `không khớp timecode`. Chuyển giữa các **angle**, sắp xếp ↑↓, xóa đoạn, xuất file, **sinh SEO metadata** |
| 4 | **Đánh giá** | Gửi kịch bản cho **nhiều AI** chấm điểm Hook / Flow / Retention / CTA → **điểm số + consensus** trực quan |

### 🧠 Content Intelligence (từ SEOSONA OS)

Extension bơm kiến thức thật vào prompt thay vì để AI tự đoán. Các block bật/tắt trong tab Phân tích, trích từ `SEOSONA OS/2_KNOWLEDGE`:

- **Hook formulas** — 5 mẫu (Stat / Claim / Question / Story / Counter-intuitive)
- **Cấu trúc 5 phần** — Hook → Intro → Value → Retention Hook → CTA
- **Công thức copywriting** — PAS / QUEST / SCAR / AIDA
- **Brand voice SEOSONA (VN)** — DO/DON'T, xưng hô, chống giọng AI
- **Platform presets** — YouTube Shorts / TikTok / Reels / YouTube dài (tự set độ dài + tỉ lệ + kiểu hook)
- **Multi-angle** — 1 SRT → tối đa 5 góc cắt khác nhau trong một lần chạy

> Kiến thức đóng gói tĩnh trong `extension/lib/knowledge.js` (extension chạy sandbox không đọc trực tiếp ổ đĩa). Muốn đồng bộ động với `~/.seosona` thì làm script build kéo snippet — xem Roadmap.

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

## Bảo trì selector

UI các trang AI đổi thường xuyên. Khi một provider hỏng, chỉ cần sửa mảng selector trong file `extension/content/<provider>.js` (mỗi selector có nhiều fallback, thử theo thứ tự). Mở DevTools trên trang AI để lấy selector mới.

## Roadmap

- [x] Content Intelligence: bơm hook/formula/brand-voice từ SEOSONA OS vào prompt
- [x] Platform presets + multi-angle (1 SRT → N shorts)
- [x] Chấm điểm chéo nhiều AI + tổng hợp consensus (điểm số trực quan)
- [x] Sinh SEO metadata (title/description/hashtag/thumbnail)
- [x] Xuất FCPXML + caption CapCut (bên cạnh EDL)
- [ ] Đồng bộ động Knowledge Pack từ `~/.seosona` (script build kéo snippet)
- [ ] Đính kèm SRT dạng file upload (hiện nhúng vào prompt — SRT rất dài có thể chạm giới hạn input)
- [ ] Chia SRT dài thành nhiều phần, chạy tuần tự
- [ ] Queue nhiều file SRT chạy hàng loạt
- [ ] Ghi output ngược vào SEOSONA OS theo chuẩn đặt tên

## Prompt gốc

Xem [docs/prompts/Short-Form_SRT_Master_Prompt_v2.md](docs/prompts/Short-Form_SRT_Master_Prompt_v2.md). Bản nhúng trong `lib/templates.js` có bổ sung phần **OUTPUT FORMAT bắt buộc dạng bảng markdown** để máy parse được ổn định.

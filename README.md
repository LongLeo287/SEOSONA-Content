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

## Local Runtime (dữ liệu gốc nằm ở máy bạn)

Bên cạnh extension, repo có **Local Runtime** — tiến trình Node chạy trên `127.0.0.1`, giữ dữ liệu
gốc dưới dạng file thường trên đĩa. Extension và Studio chỉ là **client** của nó.

```bash
SEOSONA_CONTENT_RUNTIME_TOKEN=<chuỗi ít nhất 32 ký tự> npm run runtime:start
```

- Ảnh chụp nguồn và revision **bất biến**: nguồn đổi thì sinh bản mới, không đè bản cũ.
- Ghi **atomic** (file tạm → rename), blob đánh địa chỉ bằng SHA-256.
- Không đồng bộ đám mây, không đăng bài, không chứa API key.

Chi tiết ranh giới, API và cách kiểm thử: [runtime/README.md](runtime/README.md).

### Provider Gateway — chọn AI nào chạy việc gì

Runtime đối xử với "ChatGPT trên trình duyệt" và "một API HTTP" y hệt nhau: cùng nhận `ProviderTask`,
cùng trả `ProviderResult`. Auto chọn theo **thứ tự từ điển**: chất lượng quan sát được → chi phí →
độ ổn định → tốc độ. Chọn tay thì Auto phải nhường.

- **Không có đường nào tự tiêu tiền.** Provider trả phí chỉ chạy khi được cho phép rõ ràng, và
  trình duyệt hỏng **không** tự biến thành một lần gọi API tính tiền.
- **Không hãng nào được gắn điểm sẵn** — chỉ số chưa đo là `null`, không phải `0`.
- **Bí mật chỉ lưu tham chiếu**; biên nhận giữ digest của prompt, không giữ prompt.
- SEOSONA **không đọc cookie** của các trang AI — chỉ lái phiên bạn đã đăng nhập sẵn.

Chi tiết: [runtime/providers/README.md](runtime/providers/README.md).

### Writing Core — ba loại nội dung V1

Quy trình chuẩn: **Brief → Viết → Kiểm tất định → Đánh giá độc lập → (Sửa) → Theo nơi đăng → Xong**,
chạy tiếp được sau khi đứt giữa chừng. Cùng một quy trình chạy cả ba loại; chỉ **Job Pack** khác nhau.

| Pack | Nguồn sự thật | Ràng buộc riêng |
|---|---|---|
| **Blog/Article** | Bằng chứng có nguồn | Dàn bài khớp bài viết; trích dẫn phải trỏ về bằng chứng có thật; SEO chỉ bắt buộc khi nơi đăng đòi |
| **Product** | `ProductFact` từ catalog | Thông số sao **đúng nguyên văn** (không quy đổi đơn vị); lợi ích phải có bằng chứng riêng; giá/khuyến mãi/tồn kho không có trong nguồn thì **chặn** |
| **Transcript/SRT** | Lời thoại + mốc thời gian gốc | Chọn bằng `cueId`, không dùng timecode tự do; `rawTranscript` đúng từng chữ (kể cả lỗi chính tả); trích dẫn nguyên văn trừ khi đánh dấu diễn giải |

Bốn điều được ép bằng luật, không phải bằng lời nhắc trong prompt:

- **Văn bản nguồn là dữ liệu, không phải mệnh lệnh.** Câu "bỏ qua hướng dẫn phía trên" nằm trong
  một trang nguồn không bao giờ chạm được vào phần luật.
- **Sửa văn không được nâng mức khẳng định.** "Có thể giúp" thành "bảo đảm" mà không có bằng
  chứng mới thì bị chặn.
- **Người viết và người chấm tách rời**, chạy được trên hai hãng khác nhau — cùng một model là
  cùng một điểm mù.
- **Thiếu chỗ dựa không bao giờ được vá bằng bằng chứng bịa ra.** Cách sửa hợp lệ chỉ có ba:
  tìm bằng chứng thật, hạ giọng, hoặc bỏ câu đó.

```bash
npm run writing:verify
```

Thêm một loại nội dung mới = thêm một file trong `runtime/writing/job-packs/`. Không đụng tới
Provider Gateway, không đụng tới Local Runtime.

Còn thiếu: Studio và side panel chưa gọi vào tầng này (Plan D).

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

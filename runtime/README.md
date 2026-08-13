# SEOSONA Content — Local Runtime

Runtime là **nơi giữ dữ liệu thật** của SEOSONA Content. Nó chạy trên máy bạn, chỉ lắng nghe
`127.0.0.1`, không gọi ra ngoài và không cần tài khoản nào.

## Ranh giới (đọc cái này trước)

```text
Canonical state is local.
Studio and Extension are clients.
Raw source snapshots and revisions are immutable.
Secrets are references only and are implemented in the Provider plan.
No cloud sync or publishing is part of Runtime V1.
```

Diễn giải:

- **Trạng thái gốc nằm ở máy bạn.** Không có bản sao trên server nào là "bản đúng hơn".
- **Studio và Extension chỉ là client.** Chúng hiển thị và gửi lệnh; chúng không tự giữ sự thật.
  Đóng side panel, gỡ extension, dữ liệu vẫn còn nguyên trong thư mục Runtime.
- **Ảnh chụp nguồn và revision là bất biến.** Trang nguồn đổi nội dung thì sinh `sourceId` mới,
  không đè lên ảnh chụp cũ. Sửa bài thì nối revision mới, không ghi đè bài cũ. Ghi đè một
  revision đã tồn tại bị từ chối bằng `IMMUTABLE_RECORD_CONFLICT`.
- **Bí mật chỉ lưu dạng tham chiếu.** Runtime V1 không chứa API key. Việc quản lý khóa và gọi
  provider thuộc kế hoạch Provider, chưa có trong bản này.
- **Không đồng bộ đám mây, không đăng bài.** Runtime V1 không đẩy dữ liệu đi đâu cả.

Một điều nữa cần nói thẳng: **Runtime V1 chưa chạy AI.** Nó chưa mở trình duyệt, chưa gọi API
provider nào. Nó là lớp dữ liệu và trạng thái job; phần thực thi provider nằm ở kế hoạch kế tiếp.

## Cấu trúc dữ liệu trên đĩa

```
<root>/
└── workspaces/<workspaceId>/
    ├── records/<type>/<id>.json     # 18 loại record, mỗi record một file JSON
    └── blobs/<sha256>.bin           # byte thô của nguồn, đặt tên theo nội dung
```

- Mọi lần ghi đều **atomic**: viết file tạm rồi `rename`. Mất điện giữa chừng không để lại
  file JSON hỏng.
- Blob **content-addressed** bằng SHA-256, tham chiếu qua `seosona-local://<ws>/blobs/<sha256>`.
  Hai nguồn giống hệt nhau chỉ tốn một blob.
- Thư mục này chỉ là file thường: sao lưu bằng cách copy, kiểm tra bằng mắt được.

## Chạy

```bash
SEOSONA_CONTENT_RUNTIME_TOKEN=<chuỗi ít nhất 32 ký tự> npm run runtime:start
```

| Biến môi trường | Mặc định | Ý nghĩa |
|---|---|---|
| `SEOSONA_CONTENT_RUNTIME_TOKEN` | *(bắt buộc)* | Token bearer cho Extension. Dưới 32 ký tự thì Runtime **từ chối khởi động**. |
| `SEOSONA_CONTENT_RUNTIME_ROOT` | `./.seosona-content` | Thư mục dữ liệu. |
| `SEOSONA_CONTENT_RUNTIME_PORT` | `43118` | Cổng, luôn bind `127.0.0.1`. |
| `SEOSONA_CONTENT_EXTENSION_ID` | *(trống)* | Không đặt thì cầu nối Extension **tắt hẳn**, chứ không nới lỏng kiểm tra origin. |

Kiểm tra sống:

```bash
curl http://127.0.0.1:43118/v1/health
```

## Vì sao localhost vẫn phải xác thực

"Chạy trên máy mình" không có nghĩa là an toàn: mọi tiến trình khác trên máy và mọi trang web
đang mở đều gọi được `127.0.0.1`. Nên mỗi request đi qua ba lớp:

1. **Origin** khớp chính xác — không wildcard, không so khớp gần đúng.
2. **Token** so sánh bằng `timingSafeEqual` — không rò rỉ độ dài khớp qua thời gian phản hồi.
3. **Nonce dùng một lần** — request bị bắt lại không phát lại được.

Studio do chính Runtime phục vụ nên dùng cookie phiên `HttpOnly; SameSite=Strict` thay cho token.
Riêng `GET /v1/health` không cần xác thực vì không mang dữ liệu người dùng.

## API v1

Mọi lỗi trả về đúng một hình dạng: `{ "error": { "code", "message", "retryable" } }`.
Lỗi không lường trước trả `INTERNAL` với thông điệp chung — không lộ stack trace hay đường dẫn.

| Method | Path | Việc |
|---|---|---|
| `GET` | `/v1/health` | Tình trạng + `apiVersion` + `schemaVersion` (không cần auth) |
| `GET` | `/v1/projects` | Liệt kê project |
| `POST` | `/v1/projects` | Tạo project |
| `GET` | `/v1/projects/:id` | Lấy một project |
| `POST` | `/v1/brands` | Tạo brand |
| `POST` | `/v1/projects/:id/sources` | Thêm nguồn (byte thô qua `bytesBase64`) |
| `POST` | `/v1/projects/:id/content` | Tạo content (kèm revision `CREATE` đầu tiên) |
| `POST` | `/v1/content/:id/revisions` | Nối revision mới |
| `GET` | `/v1/content/:id` | Lịch sử revision theo thứ tự |

## Kiểm thử

```bash
npm run runtime:verify
```

Bài quan trọng nhất là **nghiệm thu khởi động lại** trong `tests/runtime-domain.test.mjs`: dựng
project → brand → nguồn có byte thô → content → revision thứ hai → claim → evidence → context
snapshot, rồi **vứt toàn bộ đối tượng trong bộ nhớ** và mở kho mới trên cùng thư mục. Bài này
kiểm tra ID, byte nguồn, chuỗi revision và hash snapshot còn nguyên sau khi khởi động lại — nếu
dữ liệu chỉ sống trong RAM thì nó vỡ ngay.

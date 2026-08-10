# SEOSONA Facebook Group Content Factory V2 — Thiết kế tích hợp

**Ngày:** 2026-08-10
**Trạng thái:** Đã được người dùng phê duyệt
**Phạm vi:** Tạo tự động gói nội dung Facebook Group; không đăng Facebook, không OAuth, không lập lịch.

## 1. Mục tiêu

Từ một lần khởi tạo trong SEOSONA Content, hệ thống tự động tạo đúng số bài người dùng yêu cầu, mặc định theo policy của SEOSONA OS. Mỗi bài hoàn thành phải có nội dung tiếng Việt, claim map, evidence refs, creative brief, ảnh do SEOSONA Flow tạo, kết quả kiểm chất lượng và provenance receipt trong Content Library.

Số lượng không khóa cứng ở 5. OS công bố `defaultBatchSize`, `minBatchSize` và `maxBatchSize`; Content kiểm tra `requestedCount` theo policy trước khi chạy.

## 2. Ranh giới sở hữu

- **SEOSONA OS:** nguồn versioned duy nhất cho brand profile, group profile, content policy, evidence packet và BrandKit reference.
- **SEOSONA Content:** control plane cho idea, copy, claim/evidence gate, brand/copy QA, batch state và final draft packages.
- **Content background:** điều phối event-driven và lưu trạng thái. Sidepanel chỉ khởi tạo, quan sát, hủy và tiếp tục.
- **Content Companion:** loopback bridge có origin allowlist, bearer token và nonce; xác minh context/BrandKit; gọi Flow MCP; lưu Content Library.
- **SEOSONA Flow:** pixel worker. Content chỉ dùng MCP chính thức, không gọi executor WebSocket đặc quyền và không sao chép mã nội bộ Flow.
- **SEOSONA Video:** chủ sở hữu BrandKit canonical và asset manifest.
- **Facebook:** ngoài runtime V2. Không lưu hoặc yêu cầu Facebook credential.

## 3. Luồng dữ liệu

1. Người dùng chọn hoặc nhập `requestedCount`, có thể để trống để dùng `defaultBatchSize`.
2. Content gọi Companion lấy context OS đã resolve và BrandKit snapshot đã xác minh.
3. Content đóng băng context snapshot và tạo `contextRevision` bất biến.
4. Content gọi provider tạo đúng `requestedCount` ý tưởng khác nhau. Khi evidence trống, ý tưởng chỉ được định hướng giáo dục/kinh nghiệm, không tạo factual claim chưa có nguồn.
5. Mỗi ý tưởng trở thành một `DraftJob` với `client_ref = batchId/postId/r1`.
6. Content viết DraftPackage tiếng Việt, sau đó chạy claim/evidence, brand, cấu trúc và copy QA. Draft không đạt bị chặn trước khi gọi Flow.
7. Companion bắt tay Flow theo thứ tự: `health` → kiểm `contract_version` → `list_capabilities` → `get_provider_status`.
8. Companion gọi `gen_image` với capability hợp lệ, `client_ref` và `quality_gate`.
9. Ảnh đạt được export và lưu vào Content Library. Ảnh `judged:false` chuyển `asset_needs_review`. Ảnh đã chấm và fail chỉ được sửa prompt/tạo lại tối đa policy retry limit; mỗi lần dùng revision mới.
10. Content Library lưu batch manifest, context snapshot, từng DraftPackage, asset và receipt. Chrome storage chỉ giữ state nhỏ và logical refs, không giữ binary.

## 4. State machine

Batch dùng trạng thái: `queued`, `ideas_running`, `drafts_running`, `visuals_running`, `completed`, `needs_review`, `failed`, `cancelled`.

Draft dùng trạng thái: `idea_queued`, `copy_running`, `copy_blocked`, `visual_queued`, `visual_running`, `asset_ready`, `asset_needs_review`, `failed`, `cancelled`.

Mọi transition phải hợp lệ, được lưu kèm thời điểm và lý do. State được ghi sau mỗi bước để mở lại giao diện có thể tiếp tục từ draft chưa hoàn thành. `asset_ready`, `cancelled` và `copy_blocked` không tự quay lui.

## 5. Hợp đồng Flow

Content pin contract major/minor được hỗ trợ và từ chối chạy generation khi handshake không tương thích. Flow response phải là `FlowResult` có `ok`, `tool`, `status`; lỗi giữ nguyên `error_code` và `error_message`.

Content áp dụng cách xử lý:

- `PROVIDER_NOT_LOGGED_IN`, `PROVIDER_TAB_NOT_READY`: dừng, yêu cầu người dùng mở/đăng nhập provider.
- `WRONG_PROJECT`: dừng và hiển thị project cần mở; không tự đổi project trong V2.
- `DAILY_QUOTA_EXCEEDED`: dừng batch, không retry.
- `EXTENSION_BUSY`: retry có backoff hữu hạn theo policy.
- `VALIDATION_ERROR`: nạp lại capabilities một lần, sửa model/ratio nếu có lựa chọn tương thích; nếu không có thì dừng.
- `GEN_FAILED` và lỗi không biết: giữ evidence lỗi, không blind-retry.

`idempotent_hit` được chấp nhận như kết quả bình thường. Backfill quality cho cache hit không được tạo ảnh lại.

## 6. Content Library và provenance

Mỗi batch có thư mục logical `<batchId>/` gồm:

- `batch.json`: BatchJob, state và history.
- `context.snapshot.json`: context bất biến và `contextRevision`.
- `<draftId>/draft.json`: DraftPackage, QA và claim map.
- `<draftId>/<asset>`: asset đã archive.
- `<draftId>/<asset>.receipt.json`: Flow asset id, provider, logical file ref, SHA-256, prompt revision, quality, retry count, BrandKit ref và Flow contract version.

Receipt dùng đường dẫn tương đối hoặc URI `content-library://`; đường dẫn máy cục bộ chỉ tồn tại ở runtime response và không được ghi vào durable contract.

## 7. Bảo mật

- Companion chỉ bind `127.0.0.1`.
- Origin phải là extension ID cụ thể; token tối thiểu 16 ký tự; nonce dùng một lần và hết hạn.
- Không ghi token, cookie, absolute machine path hoặc binary ảnh vào Git/OS/Chrome local storage.
- Mọi file source/export phải vượt kiểm tra chống path traversal.
- Request body có giới hạn; lỗi trả mã ổn định và không lộ secret.

## 8. Kiểm thử và acceptance

- Unit: policy số lượng động, idea count, state transition, resume, duplicate prevention, error taxonomy và portable receipt.
- Contract: Content client bắt tay Flow `1.1.x`, đọc capabilities, giữ `FlowResult`, quality backfill và idempotency.
- Integration: fake Flow MCP + fake provider chạy batch nhiều kích thước; một draft thiếu evidence bị chặn mà các draft khác vẫn tiếp tục.
- End-to-end giả lập: hoàn thành batch với đúng N draft packages và N assets/receipts hoặc trạng thái review xác định.
- Live acceptance: Flow extension connected, provider ready, một batch nhỏ hoàn thành và asset đọc lại được từ Content Library. Nếu môi trường đăng nhập không sẵn sàng, kết quả phải ghi rõ cổng live chưa đạt; không được suy diễn từ fixture.

## 9. Audit và Git

Sau triển khai, tạo audit report và issue registry P0/P1/P2 cho kiến trúc, security, contract, permissions, provenance, automation, resume và test coverage. P0/P1 trong phạm vi phải được sửa trước push; issue phụ thuộc đăng nhập/provider được ghi là external acceptance gate.

Flow worktree hiện có thay đổi người dùng chưa commit. Nó là nguồn tham chiếu chỉ đọc. Chỉ các thay đổi Flow tối thiểu, độc lập và được kiểm thử mới được đưa vào commit riêng; không gom UI/workflow changes ngoài phạm vi. Push không force; remote divergence phải fetch, phân tích và tích hợp an toàn trước khi đẩy.

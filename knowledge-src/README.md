# knowledge-src — Nguồn Knowledge Pack (nạp từ SEOSONA OS)

Mỗi file `.md` ở đây là **một knowledge block** được bơm vào prompt phân tích (bật/tắt ở bước Phân tích của extension). Nội dung biên tập/kéo từ **SEOSONA OS** (`2_KNOWLEDGE`).

## Cách hoạt động

```
SEOSONA OS (2_KNOWLEDGE)  →  knowledge-src/*.md  →  [sync]  →  extension/lib/knowledge.js  →  extension (self-contained)
        nguồn                  bản curate           script         bản đóng gói (chạy)
```

- **Dev-time**: nguồn kiến thức là SEOSONA OS; ta curate vào các file `.md` ở đây.
- **Runtime**: extension mang theo `knowledge.js` đã sinh — chạy độc lập, không cần OS.

## Định dạng file

```markdown
---
id: camelCaseId          # khóa dùng trong code + lưu bật/tắt
name: Tên hiển thị        # nhãn chip ở tab Phân tích
default: true|false       # có bật sẵn không
---
## TIÊU ĐỀ BLOCK
- hướng dẫn CHỌN/GIỮ/ưu tiên cue cụ thể…
```

Thứ tự block theo tên file (`01-`, `02-`…). Block nên là **hướng dẫn chọn cue** ngắn gọn (≤ ~1100 ký tự), không phải bài luận.

## Cập nhật

1. Sửa/thêm file `.md` (kéo nội dung mới từ SEOSONA OS).
2. Chạy: `node scripts/sync-knowledge.mjs`
3. Script tự sinh lại vùng `BLOCKS` trong `extension/lib/knowledge.js` (giữa marker `<<<SYNC:BLOCKS>>>` … `<<<END:BLOCKS>>>` — **đừng sửa tay vùng đó**).

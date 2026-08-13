# Tích hợp cục bộ (tùy chọn, của từng máy)

## Tóm tắt

**SEOSONA Content chạy đầy đủ mà không cần bất kỳ tích hợp nào trong tài liệu này.** Runtime,
Provider Gateway, Writing Core và Studio đều không phụ thuộc vào chúng. Nếu bạn clone repo về
và chạy `npm test` rồi `npm run runtime:start`, mọi thứ hoạt động.

## `.mcp.json` không còn nằm trong repo

File này từng được theo dõi trong git và chứa đường dẫn kiểu:

```
C:/Users/<tên>/.seosona/1_CORE/scripts/mcp_knowledge_server.py
```

Đó là đường dẫn trên **một máy cụ thể**. Ai clone repo về cũng nhận đúng dòng đó, trỏ tới một
thư mục không tồn tại trên máy họ — và cấu hình hỏng kiểu này thường im lặng: công cụ báo "không
tìm thấy", người dùng tưởng sản phẩm hỏng.

Nay `.mcp.json` nằm trong `.gitignore`. Muốn dùng thì tự tạo bản của mình:

```json
{
  "mcpServers": {
    "ten-server-cua-ban": {
      "command": "python",
      "args": ["<đường dẫn trên MÁY BẠN>"],
      "description": "Mô tả ngắn"
    }
  }
}
```

## Vì sao sản phẩm không được phụ thuộc vào nó

Một kho tri thức riêng có thể rất hữu ích cho người dựng ra nó, nhưng nó là **dữ liệu của một
người**. Nếu Writing Core cần nó mới chạy được thì:

- người dùng khác không chạy được, và không hiểu vì sao;
- bài viết sinh ra sẽ dựa trên một nguồn không có trong `sourceRefs`, nên không truy vết được —
  đúng thứ mà toàn bộ tầng bằng chứng được dựng ra để ngăn.

Nên tích hợp loại này chỉ có thể **thêm nguồn vào Runtime một cách tường minh** (qua endpoint
Source), chứ không được trở thành một kênh ngầm đưa dữ kiện vào bài.

## Kiểm tra tính portable

```bash
node --test tests/migration-contract.test.mjs
```

Có một bài kiểm quét cấu hình đã commit và **thất bại** nếu tìm thấy đường dẫn dính máy
(`C:/Users/…`, `/Users/<tên>/`, `/home/<tên>/`). Nó chạy trong `npm run v1:verify`.

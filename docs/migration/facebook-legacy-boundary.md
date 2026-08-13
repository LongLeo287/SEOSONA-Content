# Ranh giới với luồng Facebook / media cũ

## Vì sao có tài liệu này

Trong repo đang tồn tại **hai thế hệ code**. Chúng chạy song song có chủ đích, và ranh giới
giữa chúng được máy kiểm chứ không chỉ ghi trên giấy:

```bash
npm run architecture:boundary
```

Máy quét đọc mã thực thi trong `runtime/` và **thất bại** nếu tìm thấy tham chiếu tới
`facebook-factory`, `facebook-batch`, `facebook-orchestrator`, `facebook-state`,
`facebook-provider-lease`, `/v1/flow/`, `visualJob`, hay `ASSET_READY`. Chú thích được bỏ qua:
một dòng giải thích vì sao ranh giới tồn tại là điều nên có.

Vấn đề không phải code cũ tệ. Vấn đề là **hướng phụ thuộc**. Nếu Runtime bắt đầu import
`facebook-*`, thì "thêm một loại nội dung" sẽ kéo theo cả một luồng dựng ảnh, và ranh giới đã
dựng suốt ba kế hoạch trước biến mất trong đúng một dòng import.

## Cái gì thuộc về đâu

| Thế hệ | File | Vai trò hiện tại |
|---|---|---|
| **Lõi mới** | `runtime/**` | Nguồn dữ liệu gốc: Project, Source, Content, Revision, Evaluation, Signal |
| **Lõi mới** | `runtime/providers/**` | Chọn và chạy nhà cung cấp AI |
| **Lõi mới** | `runtime/writing/**` | Writing Core + Job Packs |
| **Lõi mới** | `runtime/studio/**` | Studio cục bộ |
| **Tương thích** | `extension/lib/facebook-factory.js` | Chỉ để luồng Facebook cũ còn chạy |
| **Tương thích** | `extension/lib/facebook-batch.js` | nt |
| **Tương thích** | `extension/lib/facebook-state.js` | nt |
| **Tương thích** | `extension/lib/facebook-orchestrator.js` | nt |
| **Tương thích** | `extension/lib/facebook-provider-lease.js` | nt |
| **Tương thích** | `scripts/companion/facebook-*.mjs` | Tiến trình đồng hành riêng |
| **Tương thích** | phần SRT cũ trong `extension/sidepanel/app.js` | Tab **SRT** vẫn dùng được |

Code tương thích vẫn được **giữ nguyên và vẫn chạy**. Nó nằm sau nhóm message `facebook:*`
trong `extension/background.js` và không bị lõi mới gọi tới.

## Điều KHÔNG được làm để máy quét xanh

**Đừng xóa code cũ chỉ để qua bài kiểm.** Người dùng đang dùng nó. Nếu một lúc nào đó lõi mới
thật sự cần một thứ mà code cũ đang giữ, cách đúng là **bọc nó sau một adapter** — giống cách
`browser-bridge-adapter.mjs` bọc việc lái tab AI — chứ không phải kéo code cũ vào `runtime/`.

## Khi nào Social trở thành Job Pack thật

Một ngày nào đó nội dung mạng xã hội sẽ là một Job Pack như `article`, `product`, `transcript`.
Khi đó nó phải:

- dùng **hợp đồng Provider chung** (`ProviderTask` → `ProviderResult`), không có đường riêng;
- dùng **Local Runtime** làm nơi lưu, không giữ kho trạng thái riêng;
- khai **năng lực cần có**, không gọi tên nhà cung cấp;
- kiểm dữ kiện bằng **luật tất định** như ba pack hiện có.

Nói cách khác: Social đi **vào** kiến trúc mới. Code Facebook hiện tại **không** được thăng cấp
thành lõi. Phần sinh ảnh và đăng bài của luồng cũ nằm ngoài phạm vi V1 của sản phẩm viết
(`runtime/writing/target-adapter.mjs` từ chối thẳng mọi trường về đăng bài hay sinh ảnh).

## Trạng thái hiện tại

Máy quét đang **xanh**: `runtime/` không tham chiếu định danh cũ nào. Nó chạy trong
`npm run v1:verify`, nên một lần vô ý kéo phụ thuộc vào sẽ hỏng ngay ở cổng phát hành.

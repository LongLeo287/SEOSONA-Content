# Provider Gateway

Chỗ này trả lời đúng một câu hỏi: **chạy việc này bằng AI nào, và ai chịu trách nhiệm cho kết quả đó.**

Tầng trên (Writing Core) mô tả VIỆC CẦN LÀM. Tầng dưới (adapter) biết CÁCH làm. Gateway đứng giữa,
chọn provider, chạy, ghi lại, và chuyển hãng khi cần.

## Trạng thái hiện tại

Cần nói rõ để khỏi hiểu nhầm: **tầng provider đã chạy được, nhưng Writing Core chưa gọi vào nó.**
Bạn có thể chạy một ProviderTask qua `POST /v1/provider-tasks`; phần biến một bài viết thành các
ProviderTask thuộc kế hoạch Writing Core, chưa có trong bản này.

## Bốn thứ tự ưu tiên, theo đúng thứ tự đó

```text
1. chất lượng quan sát được
2. chi phí        (không phát sinh thêm > hạn mức miễn phí > trả tiền đã được cho phép)
3. độ ổn định     (ít timeout / rate-limit / parse hỏng / retry)
4. tốc độ
```

Đây là so sánh **từ điển**, không phải điểm tổng có trọng số. Cộng điểm cho phép "rẻ + nhanh" bù
cho "viết tệ" — đúng thứ không ai muốn. Rẻ chỉ được tính đến khi chất lượng đã ngang nhau.

Chất lượng so theo **dải**. Chênh 0.02 điểm là nhiễu đo đạc, không phải bằng chứng hãng này viết
tốt hơn hãng kia; để nhiễu quyết định thì router sẽ nhảy hãng liên tục mà người dùng không hiểu vì sao.

**Khóa tay thắng tất cả.** Chọn thẳng một hãng thì Auto phải nhường — kể cả hãng đó chậm hơn, điểm
thấp hơn hay chưa rõ giá. Nhưng khóa vào một hãng không dùng được thì **dừng lại và báo**
(`MANUAL_LOCK_UNAVAILABLE`), chứ không lặng lẽ chạy sang hãng khác.

## Tiền

| Hạng | Nghĩa | Auto có tự chạy không |
|---|---|---|
| `ZERO_INCREMENTAL` | Phiên đăng nhập sẵn có (ChatGPT/Gemini/Claude/Grok trên trình duyệt) | Có |
| `FREE_QUOTA` | Có hạn mức miễn phí | Có |
| `PAID_ALLOWED` | Trả tiền, người dùng đã đồng ý rõ ràng | Chỉ khi `paidApi: true` |
| `PAID_BLOCKED` | Trả tiền, đang chặn | Không |
| `UNKNOWN_COST` | Không biết giá | Không — và **không bao giờ** được coi là miễn phí |

Ba chỗ chặn tiền, độc lập với nhau, vì đây là loại lỗi không sửa lại được sau khi xảy ra:

1. **Router** loại provider tốn tiền khỏi danh sách ứng viên trước khi sắp xếp.
2. **Gateway** khi chỉ còn hãng tốn tiền thì dừng với `PAID_PROVIDER_BLOCKED`, kèm lỗi thật của lần cuối.
3. **Adapter API** tự chặn lần nữa trước khi gửi request — chặn sau khi gửi là vô nghĩa, tiền đã mất rồi.

Hệ quả quan trọng nhất: **trình duyệt hỏng không tự biến thành một lần gọi API tính tiền.** Đó là
cách viết dễ nhất và cũng là cách nhanh nhất để người dùng nhận hóa đơn họ chưa từng đồng ý.

## Chất lượng đến từ đâu

Không hãng nào được gắn điểm sẵn. `qualityByJob` bắt đầu rỗng, và mọi chỉ số sức khỏe chưa đo đều
là `null` — không phải `0`. Số 0 nghĩa là "đã đo và không có lỗi"; `null` nghĩa là "chưa đo". Để số
0 tưởng tượng lọt vào router là ta đang thay người dùng chọn hãng dựa trên dữ liệu không có thật.

Provider chưa có quan sát nào rơi vào **dải trung tính** — một hằng số chính sách được khai báo rõ,
không phải phép đo. Đặt thấp thì hãng mới không bao giờ được chạy nên không bao giờ được đo (chết
cứng); đặt cao thì hãng chưa ai kiểm chứng lại thắng hãng đã chứng minh là tốt.

Gateway **không có ý kiến về chất lượng bài viết**. Gọi được API hay bấm được nút gửi chỉ chứng minh
đường truyền chạy; nó chỉ cập nhật sức khỏe. Điểm chất lượng đến từ đánh giá và phản hồi người dùng.

## Hai adapter, một hợp đồng

```text
ProviderTask ─┬─→ browser-bridge-adapter ─→ hàng đợi ─→ Extension ─→ tab AI ─┐
              └─→ api-http-adapter ────────────────────→ HTTP endpoint ──────┴─→ ProviderResult
```

Adapter trình duyệt không biết gì về DOM (chuyện đó nằm trong Extension); adapter API không biết gì
về loại nội dung. Có test chạy **cùng một ProviderTask** qua cả hai đường và đối chiếu hình dạng
kết quả — đó là bằng chứng tầng trên trung lập, không phải lời hứa.

Hàng rào tầng được ép chứ không chỉ ghi trong tài liệu: một ProviderTask mang theo `selector`,
`tabId`, `chrome`, `cookie` hay `apiKey` bị **từ chối thẳng**.

## Bí mật

- `ProviderConfig` chỉ lưu **`secretRef`**, không bao giờ lưu khóa. `PATCH /v1/providers/:id` từ chối
  mọi trường trông giống bí mật.
- Khóa được lấy ở **thời điểm chạy** qua `credentialProvider` và không bao giờ ghi xuống đĩa.
- Biên nhận giữ **digest + độ dài** của prompt thay cho prompt, **host** thay cho URL đầy đủ, và
  `credentialRef` thay cho khóa. Nó đi qua bộ lọc hai lần — adapter dọn một lần, Gateway dọn lần nữa —
  vì một adapter viết ẩu không được phép làm rò rỉ khóa vào kho lưu trữ.
- SEOSONA **không đọc và không sao chép cookie** của các trang AI. Extension lái phiên đăng nhập
  người dùng đã có; nó không cần và không được cầm thông tin đăng nhập đó.

## Endpoint

| Method | Path | Việc |
|---|---|---|
| `GET` | `/v1/providers` | Cấu hình + sức khỏe + chất lượng quan sát được |
| `PATCH` | `/v1/providers/:providerId` | Bật/tắt, hạng chi phí, `secretRef` — không nhận khóa thật |
| `POST` | `/v1/providers/route-preview` | Auto **định** chọn ai và vì sao, **không chạy** |
| `POST` | `/v1/provider-tasks` | Chạy thật qua Gateway |

`route-preview` tồn tại vì người dùng nên biết Auto định chọn ai **trước** khi bấm chạy, chứ không
phải phát hiện sau khi việc đã xong. `considered` liệt kê từng ứng viên kèm lý do bị loại.

Cấu hình provider được ghi thành record, nên bật/tắt một hãng không mất sau khi tắt Runtime.

## Cầu nối trình duyệt

Runtime không mở được trang AI; Extension mở được. Runtime xếp job, Extension nhận, làm, trả kết quả.

Hai chỗ khó hơn vẻ ngoài:

- **Chrome tắt service worker bất cứ lúc nào.** Nên mỗi job giao kèm **lease** có hạn: worker còn
  sống thì gia hạn, chết thì lease hết hạn và job quay lại hàng đợi. Không có nó, job treo vĩnh viễn
  và người dùng ngồi đợi một việc không còn ai làm.
- **Mạng đứt lúc trả kết quả.** Extension sẽ gửi lại, nên nộp kết quả là **bất biến theo taskId**:
  lần nộp thứ hai nhận lại đúng kết quả lần đầu, không ghi đè.

Hàng đợi này nằm trên đĩa nên **từ chối mọi trường trông giống thông tin đăng nhập**, quét cả các
object lồng nhau. Endpoint hàng đợi **chỉ dành cho Extension**: Studio là một trang web, cho nó rút
job nghĩa là một tab bất kỳ có thể chiếm việc rồi không bao giờ trả về.

## Kiểm thử

```bash
npm run providers:verify
```

Những bài đáng đọc trước:

- `tests/provider-server.test.mjs` — nghiệm thu trung lập: cùng một ProviderTask chạy qua cả trình
  duyệt lẫn API, và task không bị adapter nào sửa.
- `tests/provider-router.test.mjs` — toàn bộ chính sách chọn hãng, gồm cả các ca về tiền.
- `tests/provider-gateway.test.mjs` — dự phòng giữ nguyên bối cảnh, và không có đường nào tự tiêu tiền.

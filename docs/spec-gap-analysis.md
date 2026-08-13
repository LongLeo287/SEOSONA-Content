# Đối chiếu: Writing Intelligence OS (spec) ↔ SEOSONA Content (hiện trạng)

**Nguồn spec:** Google Sheet *"SEOSONA CONTENT — WRITING INTELLIGENCE OS"*, 44 tab (`00_README` → `43_CHANGE_CONTROL`), phiên bản VNext / 2026-08-13.
**Đối tượng đối chiếu:** extension trong repo này.
**Ngày lập:** 2026-08-13.

> Tài liệu này là **ảnh chụp tại một thời điểm**. Spec có thể đã đổi; kiểm lại sheet trước khi dựa vào đây để ra quyết định lớn.

---

## 1. Spec nói gì (tóm tắt điều hành)

**Sản phẩm:** hệ thống viết content **local-first**, luồng `Research → Brief → Write → Edit → Audit → Optimize → Repurpose → Learn`.

**Ranh giới (spec cắt rất dứt khoát):**
- Làm: viết content.
- KHÔNG làm: sinh video/ảnh, publishing đầy đủ, CRM, CMS hosting, quản lý tài khoản quảng cáo.
- **SRT bị hạ cấp** thành *một* Content Job (Transcript Intelligence) — không còn là bản sắc sản phẩm.
- **Social/platform** chỉ còn là *Target Adaptation layer*.

**Hai bề mặt ngang hàng:** Local Web Studio + Browser Extension. Cả hai **không được giữ dữ liệu gốc** — canonical state nằm ở Local Content Runtime.

**4 nguyên tắc lõi:**
1. Local-first — project, Brand Brain, sources, drafts, revisions, evidence, audit, receipts nằm trên máy người dùng.
2. Provider-neutral — Browser Automation + API + Local Model qua cùng một Provider Gateway.
3. **Auto Router xếp hạng từ điển**: chất lượng → chi phí tăng thêm = 0 → ổn định → tốc độ. Khóa provider thủ công **luôn thắng**.
4. **Writer ≠ Auditor** — self-score của bộ sinh không được coi là QA.

**Thứ tự ưu tiên luật (áp mỗi lần biên dịch context):**
```
luật pháp cứng > nền tảng cứng > bằng chứng > brand cứng > job > khuyến nghị target > heuristic văn phong
```
Kèm ghi chú: *"Never let heuristic override hard evidence."*

**Quy mô:** 40 task (`IP-001`→`IP-903`), 10 phase + 1 cổng nền tảng. Phase 7–8 là **hai ứng dụng mới** (Local Runtime, Web Studio).

---

## 2. Đã khớp — không cần làm lại

| Spec yêu cầu | Hiện trạng trong repo |
|---|---|
| Core Writing Pack: `factCheck, claimStrength, editingRules, concision, deslop, copy formulas` | **Đủ 6/6** trong `knowledge-src/` (tổng 26 block) |
| Giữ selector đa fallback + override người dùng | `lib/selectors-default.js` + ⚙ Settings |
| 4 browser provider = `ZERO_INCREMENTAL` | Đã điều khiển ChatGPT/Gemini/Grok/Claude |
| Transcript exactness — BLOCK khi lệch nguồn | Đã validate segment với SRT gốc (timecode + nguyên văn) |
| Repurpose giữ nguồn gốc | Có, đã gộp về một danh mục định dạng |
| Selector drift nằm trong biên adapter | Override runtime không cần rebuild |

---

## 3. Thiếu — xếp theo mức chặn

### Chặn nền tảng (mọi thứ khác phụ thuộc)

| Thiếu | Hệ quả hiện tại |
|---|---|
| **Local Runtime** (kho canonical + API loopback có xác thực) | Extension **đang là** nguồn sự thật — spec cấm điều này |
| **Revision bất biến + lineage** | Đang ghi đè state; spec yêu cầu *"Never overwrite lineage"* |
| **IR contracts** | ✅ **Đã làm** — `lib/ir-contracts.js` (IP-101), 18 IR có version |
| **ContextSnapshot + hash** | Chưa đóng băng context ⇒ không tái lập được một lần chạy |

### Chặn chất lượng nội dung

| Thiếu | Hệ quả |
|---|---|
| **Evidence/Claim engine** (`SourceArtifact → Locator → EvidenceIR → Claim`) | Hiện chỉ *dặn* AI đừng bịa bằng prompt, không có cơ chế kiểm |
| **Evaluation độc lập** gắn revision bất biến | Tác vụ "Chấm điểm" vẫn để cùng một AI tự chấm |
| **Brand Brain** (17 vùng, tách bộ nhớ fact/style/negative) | Chỉ có một ô brand voice tự do |
| **Target Spec Registry + Source Registry** | Số giới hạn nền tảng chưa có nguồn — xem mục 5 |

### Chặn vận hành

| Thiếu | Ghi chú |
|---|---|
| **Provider Gateway** + `ProviderTask/Result/Receipt` | Content script đang gọi thẳng |
| **Auto Router** theo chất lượng/chi phí **quan sát được** | Bộ chọn model hiện tại chỉ suy theo độ nặng tác vụ — chưa phải router |
| **Cost class + PAID_BLOCKED** | Chưa có khái niệm chi phí |
| Lease / idempotency key | Chưa chống trùng job |
| Golden fixtures, backup/export, Web Studio | Chưa có |

---

## 4. Sai sót phát hiện trong chính spec

1. **Tab `11_POLICY_LEGAL_RIGHTS` có hai dòng thứ tự ưu tiên mâu thuẫn:**
   - `law > platform hard > evidence > brand hard > job > recommendation` ← bản đầy đủ, nên coi là chuẩn
   - `Law > platform hard > brand hard > campaign > recommendation` ← thiếu *evidence* và *job*, thêm *campaign*
   Dòng 15–19 của tab trông như khối lặp chưa gộp, cột V1 để trống.
2. Tab ingestion: dòng "Connector sources (Drive/Dropbox, OAuth scope)" bỏ trống cột V1 — chưa xác định phạm vi.
3. `api-v1` cố ý chưa chọn nhà cung cấp ("chosen during implementation") — chấp nhận được, nhưng cần chốt trước khi làm IP-303.

---

## 5. Điểm va chạm giữa spec và code hiện tại

Spec quy định (`21_TARGET_RULE_MATRIX`, `22_SOURCE_REGISTRY`):

> *"Registry schema is complete; actual current platform rules are populated only when needed and verified."*
> *"Missing/stale/conflicting source → UNKNOWN/REVIEW rather than fabricated current rule."*

Quét toàn bộ 44 tab: **không có một giới hạn ký tự cụ thể nào** — hoàn toàn cố ý.

Trước đây `lib/output-formats.js` ghi cứng các con số ("thread ≤280 ký tự", "meta 150–160 ký tự") **như thể là luật nền tảng hiện hành**, trong khi không có nguồn nào được kiểm chứng.

**Đã sửa:** tách `spec` (khuyến nghị biên tập — luôn đúng, do ta chọn) khỏi `limits[]` (dữ kiện bên ngoài, mỗi mục mang `status: VERIFIED | UNVERIFIED` + `note`). Hàm `outputFormatPrompt(id)` render kèm dấu `[CHƯA XÁC MINH]` và dặn AI **không khẳng định** với người đọc rằng nền tảng giới hạn X ký tự.

Hiện **toàn bộ đều `UNVERIFIED`** vì chưa nối Source Registry. Muốn chuyển sang `VERIFIED` thì cần: `sourceRef` + `verifiedAt` + `staleAfter` từ tài liệu chính thức của nền tảng.

---

## 6. Việc tiếp theo, theo đúng thứ tự phụ thuộc của spec

| Thứ tự | Task | Vì sao trước |
|---|---|---|
| 1 | `IP-001` Chốt baseline hành vi hiện tại | Spec bắt buộc: *"Freeze baseline"* trước khi di trú |
| 2 | ~~`IP-101` IR contracts~~ | ✅ Xong — `lib/ir-contracts.js` |
| 3 | `IP-102` IR chuyên biệt (`ArticleIR`, `ProductContentIR`, `TranscriptIR`) | Đã khai báo hình dạng; còn thiếu bộ dựng/parse thật |
| 4 | `IP-201` Kho workspace cục bộ | Nền của mọi thứ sau đó |
| 5 | `IP-203` Workflow state có thể resume | Tổng quát hóa Flow hiện tại |
| 6 | `IP-301` Provider Registry vận hành | Trước khi làm Auto Router |

**Nguyên tắc di trú (spec ghi rõ):**
```
Freeze baseline → extract primitive → compat adapter → switch callers → remove legacy after green
```
Không đập đi xây lại. `18_REPO_MIGRATION` liệt kê đích danh từng file hiện có đi về đâu.

---

## 7. Đánh giá thẳng

Spec mô tả một hệ **lớn hơn extension hiện tại nhiều lần**. Extension trong thiết kế đó chỉ là **một trong hai bề mặt**, và là bề mặt *không* giữ dữ liệu gốc — tức là phần lõi (Local Runtime) **chưa tồn tại**.

Điều đó không có nghĩa công sức hiện tại bỏ đi: spec chỉ đích danh những thứ **phải giữ** — knowledge blocks, selector resilience, browser automation, guardrail SRT. Phần cần đổi là **kiến trúc xung quanh** chúng, không phải bản thân chúng.

Rủi ro lớn nhất nếu làm sai thứ tự: dựng Web Studio hoặc Auto Router **trước** khi có Local Runtime và IR contracts — sẽ phải viết lại.

# Đối chiếu US HU-44 v1.1 với code TU-45 / TU-46 đã làm

- **Ngày:** 2026-11-26
- **Tài liệu nguồn:** `21GAM_Luong_Thanh_toan_US_TN_v1_1.docx.pdf` (HU-44 v1.1, Hưng, 26/11/2026, 17 trang, 16 US)
- **Code đối chiếu:** nhánh `develop` + thay đổi TU-45/TU-46 chưa commit
- **Kết luận một dòng:** code đang chạy theo bản **22/11**; tài liệu v1.1 **thay 6 quyết định nền**, trong đó **3 điểm là thay đổi cấu trúc dữ liệu**, không phải sửa nhãn.
- **Cập nhật 26/11 (sau khi đọc tài liệu):** đã sửa xong **mọi phần không bị chặn** — xem §8 ở cuối.

> Tài liệu này ghi rõ ở trang 1: *"TU-45, TU-46 đang ở cột Chờ duyệt — code đã làm theo bản 22/11 nên cần sửa"*. Nên phần dưới không phải danh sách lỗi, mà là khoảng cách giữa hai bản quyết định.

---

## 1. Ba thay đổi CẤU TRÚC — không sửa được bằng cách đổi nhãn

### 1.1. V12 — một Phiên có NHIỀU bill 🔴

| | |
|---|---|
| **Tài liệu** | TN-02 · VM-08 · TN-13-K3/K4: khách gọi thêm sau khi đã Xuất hóa đơn → **bill cũ giữ nguyên, món mới vào BILL MỚI của cùng Phiên**; Phiên về *Đang phục vụ*. Phiên chỉ đóng khi **bill cuối đã thu VÀ không còn món nào chưa lên bill**. |
| **Code hiện tại** | Ngược lại ở ba chỗ cùng lúc. |

Ba chỗ phải sửa:

1. **`uq_bills_one_open_per_visit`** (`0048`) — cột sinh + UNIQUE ép *một Phiên một bill đang mở*. V12 cho phép bill 1 *Chưa thu* và bill 2 vừa xuất cùng tồn tại → **ràng buộc này phải bỏ**. Cần migration mới (không sửa `0048`, checksum đã khoá).
2. **`lockOrderableVisit`** (`order.repository.ts`) — tôi thêm `409 VISIT_BILL_CLOSED` chặn gọi thêm khi có bill `AWAITING_PAYMENT`. V12 nói **phải cho gọi thêm**. Bỏ chặn, và Phiên quay về *Đang phục vụ*.
3. **`readAggregatedLines`** (`bill.repository.ts:137`) — câu SQL lấy **mọi** dòng món của Phiên có `net_quantity > 0`, **không lọc dòng đã lên bill trước**. Với V12, bill 2 sẽ **lặp lại toàn bộ món của bill 1** → thu tiền hai lần của khách. Đây là lỗi tiền thật, không phải lỗi hiển thị.

**Cần thêm:** một cách đánh dấu dòng đơn đã thuộc bill nào. `bill_lines.source_order_line_id` hiện chỉ lưu `MIN(id)` của nhóm đã gộp nên **không đủ** để trừ ra — phép gộp theo `(biến thể, ghi chú, giá)` làm mất quan hệ 1-1. Hai hướng:
- **(a)** bảng `bill_line_sources(bill_line_id, order_line_id, quantity)` — chính xác tới từng dòng đơn và từng số lượng, cũng là nền cho tách bill sau này (TN-11 nói *"dữ liệu một Phiên nhiều bill làm sẵn từ Sprint 5"*).
- **(b)** cột `billed_quantity` trên `sales_order_lines` — rẻ hơn nhưng phá tính bất biến của bảng đơn (`0036` ghi rõ bảng đó không có endpoint nào UPDATE).

→ **Đề xuất (a).** Nó không phá bất biến nào và trả lời được câu "món này nằm trên bill nào".

### 1.2. Ai được "Xuất hóa đơn" 🔴

| | |
|---|---|
| **Tài liệu** | TN-02 · VM-01 · VM-02: **Phục vụ, Bartender và Thu ngân** đều bấm *Xuất hóa đơn* (= chốt bill). Phục vụ/Bartender **chỉ đưa hóa đơn**, không chọn phương thức, không thu tiền. O16 ghi rõ: *"Tú cần mã quyền `xuat_hoa_don` cho 2 vai"*. |
| **Code hiện tại** | `POST /bills` yêu cầu `payment.collect` → chỉ OWNER/ADMIN/CASHIER. Phục vụ bị **403**. |

Tôi chọn PA-C hôm nay vì phân quyền 15/11 và vì mockup để ngỏ. Tài liệu v1.1 **đã chốt**, và nó chốt đúng một nửa mỗi phương án: *Phục vụ chốt bill* (như PA-B) nhưng *không thu tiền* (như PA-A).

**Phải làm:** permission mới `bill.issue` (hoặc `xuat_hoa_don` theo tên O16) cấp cho `WAITER`, `BAR`, `CASHIER`, `OWNER`, `ADMIN`; đổi guard của `POST /bills` sang permission đó. `payment.collect` **giữ nguyên** cho `/payments` — phần này code đã đúng (TN-02-K8 và TN-07-K7 đã có test canh).

### 1.3. TN-14 — Huỷ bill đã thu, nay là MUST của Sprint 5 🔴

| | |
|---|---|
| **Tài liệu** | TN-14 · trạng thái **"Sprint 5 · làm ngay"**. Lễ tân / Admin Edit / SuperAdmin **huỷ thẳng**; Thu ngân **gửi yêu cầu + lý do** → Admin Edit **duyệt real-time**. Lý do **bắt buộc**. Huỷ xong: bill → *Chưa thu*, Phiên → *Chờ thanh toán*, bàn xanh lại, **lượt khách −1**, nhật ký đủ (ai yêu cầu, ai duyệt, bill nào, lý do, lúc nào, thiết bị nào). |
| **Code hiện tại** | `POST /bills/:id/void` trả **501 `BILL_VOID_NOT_AVAILABLE`** với `status: "IN_DEVELOPMENT"`, có test canh để nó không đổi gì. |

Tôi để 501 vì "chờ HU-43". **HU-43 không họp** (trang 3, nguồn #2: *"HU-43 không họp — comment Hưng trên thẻ 26/11"*), và HU-44 trả lời thay. Đây là một US hoàn chỉnh chưa viết dòng nào: cần bảng yêu cầu huỷ, luồng duyệt, thông báo real-time, và nghiệp vụ **lượt khách −1** (`table_turns` hiện không có đường đi lùi).

---

## 2. Bốn điểm lệch vừa — sửa được trong ngày

### 2.1. QR phải sinh lúc XUẤT HÓA ĐƠN, không phải lúc chọn phương thức 🟠

TN-02-K4: *"Phục vụ bấm Xuất hóa đơn → … QR Techcombank có đúng 3.044.000đ, nội dung = mã bill"*. Cả điểm của luồng mới là **khách cầm tờ hóa đơn có QR ra quầy**.

Code hiện tại sinh QR trong `capturePayment` khi Thu ngân chọn `BANK_TRANSFER` — tức là khách phải đứng ở quầy mới thấy QR. Phải chuyển việc sinh chuỗi sang lúc chốt bill và lưu trên `bills`, rồi giao dịch chuyển khoản tham chiếu lại.

Kéo theo: **thiếu cấu hình tài khoản thì không xuất được hóa đơn**, không chỉ là không chọn được QR. Cần quyết định — đề xuất: vẫn xuất hóa đơn, phần QR để trống kèm dòng "chưa cấu hình tài khoản nhận tiền", vì chặn xuất hóa đơn sẽ chặn cả luồng tiền mặt.

### 2.2. Đổi sang Tiền mặt khi đang có QR chờ → bỏ sót một dòng `PENDING` 🟠

TN-08-K6: *"Đang ở khối Chờ nhận tiền → Thu ngân đổi sang Tiền mặt → Đổi được; bill và số tiền giữ nguyên"*.

Code **cho đổi được** (đúng), nhưng dòng `bill_payments` của QR nằm lại ở `PENDING` **vĩnh viễn**. Nó không gây thu hai lần (`uq_bill_payments_settled` chặn), nhưng nó làm bẩn đối soát và chặn lần tạo QR sau trên cùng bill (`uq_bill_payments_pending`). Phải `CANCELLED` nó trong cùng transaction khi thu bằng phương thức khác.

### 2.3. Nút "Kiểm tra" ở Màn 6 🟠

VM-12 và O5: *"Sprint 5 chưa nối ngân hàng → ẩn hoặc khoá 'Đang phát triển'"*. Tôi đã dựng nó **chạy thật** (gọi `GET /bills/:id/payments/:id`). Nó không tự đóng bill nên không sai nghiệp vụ, nhưng tài liệu muốn ẩn/khoá. Cần Hưng chốt (O5 hạn T5 26/11 — **đã quá hạn**).

### 2.4. Màn hình Thu ngân không chặn vai khác ở phía UI 🟠

TN-07-K7: *"Tài khoản Phục vụ hoặc Bartender → Mở hóa đơn đã xuất → Không có nút Tiền mặt, Chuyển khoản, Đã nhận tiền"*.

API đã chặn đúng (403, có test). Nhưng route `/thanh-toan` **không có guard** — nó nằm ở gốc router, ngoài `Root()` (chỗ redirect WAITER về `/phucvu`). Một tài khoản Phục vụ gõ thẳng URL sẽ **thấy** các nút rồi mới nhận 403. Cần guard theo `payment.collect` cho phần thu tiền.

---

## 3. Lệch nhãn — rẻ nhưng là tiêu chí nghiệm thu của HU-48

| Chỗ | Code hiện tại | Tài liệu |
|---|---|---|
| Nút chốt bill | "Chốt bill & thu tiền" | **"Xuất hóa đơn"** (VM-05) |
| Màn 3 | "Bản in 80mm", "In tạm tính" | Hóa đơn **theo mẫu quán** (chờ ảnh mẫu, O2) |
| Khối nhận tiền | "[Chờ quán cung cấp]" / cấu hình chung | Ghi **"Techcombank"** (VM-11) |
| Màn 1 | bàn, số đơn, số món, giờ ngồi, mã bill | thêm **"Phục vụ phụ trách"** và nhãn **"Đã đưa hóa đơn · tên người xuất · giờ"**, nhóm **"Cần thu"** (TN-01-K6) |
| Danh sách "Đang phát triển" | có "Thanh toán nhiều phương thức" | VM-09: bỏ **"Thẻ"**; quán chỉ có 3 hình thức |
| Chi tiết Phiên | một bill | VM-08: **danh sách các bill** (Chưa thu / Đã thu) |

---

## 4. Những gì ĐÃ KHỚP — không phải sửa

Phần lớn lõi tính tiền và chống trùng đi đúng bản v1.1:

| US | Tiêu chí | Trạng thái |
|---|---|---|
| TN-03-K2 | 209.600 → VAT 20.960 → 230.560 → **231.000** | ✅ chính là bộ test `T2` trong `bill-total.test.ts` |
| TN-03-K1 / TN-06-K5 | 2.767.000 → VAT 276.700 → 3.043.700 → **3.044.000** | ✅ công thức đúng (nên **thêm** bộ số này vào test) |
| TN-06-K2 | đã chẵn nghìn thì không cộng thêm | ✅ bộ `T3` |
| TN-06-K4 | bill lưu **cả số trước và sau làm tròn** | ✅ `pre_round_total_vnd` + `rounding_adjustment_vnd` |
| TN-03-K3 / TN-02-K2 | dòng đã huỷ không vào tổng, không chịu VAT | ✅ `net_quantity > 0` |
| TN-02-K3 / VM-04 | **xem tạm tính KHÔNG đổi trạng thái Phiên** | ✅ `GET /bills/preview` read-only |
| TN-02-K3 / VM-03 | tạm tính **không có QR** | ✅ preview không mang QR |
| TN-02-K5 | đổi giá menu sau khi xuất → bill giữ nguyên | ✅ có test MySQL (cả đổi tên món) |
| TN-07-K1/K2 | tiền thối 69.000đ; thiếu 31.000đ thì khoá nút | ✅ `cash-model.test.ts`, đúng từng con số |
| TN-07-K5 | bấm hai lần → **1 giao dịch** | ✅ 4 đường chống trùng, có test đồng thời |
| TN-07-K6 | máy khác đã thu → báo ai thu lúc nào, chỉ còn *Về danh sách* | ✅ `BILL_ALREADY_PAID` mang `paidBy`/`paidAt` |
| TN-07-K3 | mỗi bill một hình thức | ✅ `uq_bill_payments_settled` |
| TN-08-K1 | QR đúng số tiền, nội dung = mã bill, nút Chép | ✅ (sai **thời điểm** sinh — xem 2.1) |
| TN-08-K3 | chưa tick thì nút khoá, không ghi nhận | ✅ `TRANSFER_NOT_OBSERVED` |
| TN-08-K5 | giao dịch có số tiền, mã bill, nội dung QR, người xác nhận, thời điểm, cờ xác nhận tay | ✅ đủ 6 trường |
| TN-09-K4 | mất mạng: QR khoá kèm lý do, **tiền mặt vẫn dùng được** | ✅ có test |
| TN-09-K5 | lỗi kết nối: "CHƯA được ghi nhận", giữ số, thử lại chỉ 1 giao dịch | ✅ |
| TN-10-K0 | Ghi nợ khoá, **API trả "Đang phát triển"** | ✅ chặn ở 3 lớp (API, repo, CHECK) |
| TN-12-K1/K3 | cụm ghép một bill; cụm tính **1 lượt** | ✅ có test MySQL |
| TN-12-K2 | thanh toán xong bàn trống **nhưng vẫn là một cụm** | ✅ cụm LAYOUT giữ nguyên, có test |
| TN-13-K1/K2 | bàn tự về trống; lượt +1 | ✅ (**nhưng** điều kiện "bill cuối" chưa đúng — xem 1.1) |
| TN-16-K1 | lưu đủ dữ liệu cho hoá đơn điện tử | ✅ có mã bill, thời điểm, từng dòng món, đơn giá, thuế suất, tiền thuế, tổng trước/sau làm tròn, phương thức |
| TN-04-K0 / TN-05-K0 / TN-11-K0 | Giảm giá, voucher, tách bill: hiện nhưng khoá "Đang phát triển" | ✅ `notAvailable[]` |
| TN-03-K4 | không có tiền phí phục vụ/phụ thu; nếu hiện thì ghi "Đang phát triển" và 0đ | ✅ |

Và một điểm tài liệu lo thừa: **O16 nói "Bartender chưa có vai trong RBAC"** — vai `BAR` đã có từ migration `0041`. Chỉ thiếu *permission* xuất hóa đơn, không thiếu vai.

---

## 5. Chưa làm, tài liệu yêu cầu

| US | Việc | Ghi chú |
|---|---|---|
| **TN-14** | Huỷ bill đã thu + luồng duyệt | MUST Sprint 5. Xem 1.3 |
| **TN-15** | Báo cáo doanh thu cuối ca | "Chặn một phần". Tách theo hình thức / Thu ngân / **người xuất hóa đơn**, và tách riêng khoản "xác nhận tay". Dữ liệu đã đủ trong `bill_payments` (`ix_bill_payments_shift`, `ix_bill_payments_collector`) nhưng **chưa có endpoint và màn hình** |
| **TN-01** | Nhãn "Đã đưa hóa đơn · người xuất · giờ", nhóm "Cần thu", cột Phục vụ phụ trách | Xem mục 3 |
| **R1 / O9** | **Thử QR Techcombank bằng 2–3 app ngân hàng thật** | Hạn T6 27/11, giao **Hưng + Tú**. Test đơn vị chỉ chứng minh chuỗi đúng chuẩn EMVCo, **không** chứng minh app ngân hàng đọc được |

---

## 6. Câu hỏi còn mở ảnh hưởng trực tiếp tới code của Tú

Tài liệu liệt kê 16 vấn đề mở (mục 6). Bốn câu chặn việc code:

| Mã | Câu hỏi | Ai chốt | Vì sao chặn |
|---|---|---|---|
| **O16** | Mã quyền `xuat_hoa_don` cho Phục vụ + Bartender | Hưng → anh Luân, CN 29/11 | Không có thì không sửa được 1.2 — và đây là thay đổi phân quyền, không tự đặt |
| **O4** | Ảnh chụp màn hình chuyển khoản lưu ở đâu (đính kèm vào bill hay chỉ trên điện thoại) | Hưng, **hạn T5 26/11 — đã quá hạn** | Quyết định TU-46 có làm chỗ tải ảnh hay không. Hiện **chưa làm** |
| **O5** | Nút "Kiểm tra": ẩn hay khoá | Hưng, **hạn T5 26/11 — đã quá hạn** | Xem 2.3 |
| **O6** | Huỷ bill đã thu khi bàn đã đón tốp mới thì Phiên cũ mở lại ở đâu | Hưng, T6 27/11 | Chặn TN-14; không có câu trả lời thì hai Phiên chồng trên một bàn |

Thêm hai câu tôi phát sinh khi đối chiếu, chưa có trong bảng của tài liệu:

- **Q-A · Thiếu cấu hình tài khoản Techcombank thì có xuất hóa đơn được không?** QR nay nằm trên hóa đơn (2.1), nên "không cấu hình = không xuất hóa đơn" sẽ chặn cả luồng tiền mặt. *Đề xuất: vẫn xuất, phần QR để trống kèm lý do.*
- **Q-B · Phiên có 2 bill chưa thu thì Thu ngân thu từng bill hay thu một lần?** TN-13-K3 nói Phiên chưa đóng khi mới thu bill 1, tức là **thu từng bill**. Cần xác nhận Màn 1 hiện mỗi bill một dòng hay mỗi Phiên một dòng (TN-01-K3 nói mỗi Phiên một dòng, nhưng đó là trước V12).

---

## 7. Đề xuất thứ tự làm

Giả định nhận được O16 (mã quyền) và O5:

| # | Việc | Ước lượng | Chặn bởi |
|---|---|---|---|
| 1 | Migration: bỏ `uq_bills_one_open_per_visit`, thêm `bill_line_sources` | 1,0h | — |
| 2 | Lọc dòng đã lên bill khỏi `readAggregatedLines`; bỏ chặn gọi thêm | 1,5h | #1 |
| 3 | Phiên đóng khi **bill cuối** đã thu và **hết món chưa lên bill** | 1,0h | #2 |
| 4 | Permission `bill.issue` + đổi guard `POST /bills` | 0,5h | **O16** |
| 5 | Sinh QR lúc xuất hóa đơn, lưu trên `bills` | 1,0h | **Q-A** |
| 6 | Huỷ dòng `PENDING` khi đổi phương thức | 0,5h | — |
| 7 | Guard UI `/thanh-toan` + đổi nhãn (mục 3) | 1,0h | — |
| 8 | Test lại toàn bộ + thêm bộ số 2.767.000đ | 1,0h | #1–#7 |
| | **Cộng (chưa tính TN-14, TN-15)** | **~7,5h** | |
| 9 | TN-14 huỷ bill + luồng duyệt | ~6h | **O6** |
| 10 | TN-15 báo cáo ca | ~3h | O13 |

**Phần code đã làm không bỏ đi.** Lõi tính tiền, chống thu hai lần, VietQR, đóng Phiên, nhả bàn, lượt khách và quyền thu tiền đều đúng bản v1.1 — khoảng 70% công việc giữ nguyên. Phần phải viết lại là mô hình *một Phiên nhiều bill* và phần phân quyền xuất hóa đơn.


---

## 8. Đã sửa (26/11) — phần không bị chặn

Làm theo thứ tự ở §7, bỏ qua hai việc chờ câu trả lời.

| # | Việc | Nơi |
|---|---|---|
| 1 | **Bỏ `uq_bills_one_open_per_visit`**, thêm `bill_line_sources`, thêm cột QR lên `bills` | `0050_bills_v12_multiple_per_visit.sql` |
| 2 | **Lọc món đã lên bill** — `readBillableOrderLines` trừ ra phần đã góp vào bill chưa huỷ; phép gộp tách thành hàm thuần | `bill-grouping.ts`, `bill.repository.ts` |
| 3 | **Bỏ chặn gọi thêm** sau khi xuất hoá đơn | `order.repository.ts` |
| 4 | **Phiên chỉ đóng khi bill cuối đã thu VÀ hết món chưa lên hoá đơn** | `payment.repository.ts` |
| 5 | **Trạng thái "Chờ thanh toán" hẹp lại**: có bill chưa thu *và* không còn món chưa lên hoá đơn (TN-13-K4) | `waiter-visit-phase.repository.ts` |
| 6 | **QR sinh lúc Xuất hoá đơn**, lưu trên `bills`; giao dịch chép lại chuỗi đã dùng | `bill.repository.ts`, `qr-config.ts` |
| 7 | **Huỷ dòng `PENDING` khi đổi phương thức** (TN-08-K6) | `payment.repository.ts` |
| 8 | **Guard UI**: Phục vụ/Bartender không thấy nút thu tiền (TN-07-K7) | `bill-session-detail.tsx` |
| 9 | **Đổi nhãn** "Chốt bill & thu tiền" → **"Xuất hóa đơn"**; bản in phân biệt hoá đơn với tạm tính | frontend + e2e |
| 10 | **Bộ số của tài liệu** 2.767.000đ → 3.044.000đ (TN-03-K1, TN-06-K5) | `bill-total.test.ts` |

**Kiểm chứng:** toàn bộ test API xanh (1256 pass, 13 skip), 1437 test web xanh, `e2e:tu45` đạt 6 viewport,
và luồng V12 chạy thật trên API + MySQL: hoá đơn 1 (924.000đ, có QR) → gọi thêm (201) → hoá đơn 2
**chỉ 1 dòng, 308.000đ** → thu hoá đơn 1 (`settlement: null`, Phiên chưa đóng) → thu hoá đơn 2
(bàn về Trống, **đúng 1 lượt khách**).

### Quyết định tôi tự chốt, cần Hưng xác nhận

**Q-A đã làm theo đề xuất:** thiếu cấu hình tài khoản Techcombank thì **vẫn xuất hoá đơn**, phần QR
để trống, và `bill.paymentMethods` đánh dấu Chuyển khoản không dùng được kèm lý do. Chặn xuất hoá đơn
sẽ chặn luôn luồng tiền mặt — thứ chạy được mà không cần ngân hàng nào.

### Chưa làm — vẫn chờ

| Việc | Chờ |
|---|---|
| Permission `xuat_hoa_don` cho Phục vụ + Bartender (§1.2) | **O16** |
| TN-14 huỷ bill đã thu + luồng duyệt (§1.3) | **O6** |
| TN-15 báo cáo doanh thu cuối ca (§5) | O13 |
| Nút "Kiểm tra" ẩn hay khoá (§2.3) | **O5** (quá hạn) |
| Chỗ tải ảnh chụp chuyển khoản | **O4** (quá hạn) |
| Thử QR Techcombank bằng app ngân hàng thật | **R1/O9** — việc cầm máy, không phải việc code |
| Nhãn Màn 1 "Đã đưa hóa đơn · người xuất · giờ", nhóm "Cần thu" | cần O16 trước (tên người xuất mới có nghĩa khi Phục vụ xuất được) |

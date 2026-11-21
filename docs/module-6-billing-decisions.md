# Module 6 — decision table trước khi triển khai bill

Ngày lập: 2026-11-21. Trạng thái: **chờ xác nhận nghiệp vụ tài chính**.

## Bằng chứng đã có trong repository

- `sales_order_lines.unit_price_vnd`, tên món, đơn vị và `line_total_vnd` là
  snapshot lúc gửi đơn. Bill phải đọc snapshot này, không đọc giá menu hiện tại.
- Tiền đang dùng số nguyên VND (`BIGINT UNSIGNED`); không dùng floating point.
- Repository hiện chỉ có `visits.paid_marked_at`, chưa có bill/payment module.
- Tài liệu cũ ghi rõ VAT, phí, phụ thu và bill thuộc module sau; không có quyết
  định nào về công thức, inclusive/exclusive hoặc stacking.
- Yêu cầu Module 6 đã khóa bước cuối:
  `roundedTotal = ceil(preRoundTotal / 1000) * 1000`; phần chênh phải lưu riêng.

## Decision table tài chính

| Chủ đề | Bằng chứng hiện có | Trạng thái | Các lựa chọn cần PO xác nhận | Cách lưu trung tính đề xuất |
|---|---|---|---|---|
| Thứ tự subtotal, service fee, surcharge, VAT, discount, voucher | Không có thứ tự trong repo | **OPEN** | Chọn thứ tự cụ thể giữa 5 loại charge. `ITEM_SUBTOTAL` luôn là nguồn đầu và `FINAL_ROUNDING` luôn là bước cuối theo yêu cầu | Mỗi policy có danh sách `billing_policy_steps` với `sequence_no`; bill chép từng bước vào charge ledger |
| VAT inclusive hay exclusive | Không có | **OPEN** | `INCLUSIVE`, `EXCLUSIVE`, hay cho phép cấu hình theo venue/policy | `vat_mode` bắt buộc trên policy version; không có default ngầm |
| Nền tính service fee | Không có | **OPEN** | Gross item subtotal; item net sau discount/voucher; hoặc chỉ nhóm món đủ điều kiện | `basis_code` + điều kiện eligibility được snapshot vào charge line |
| Nền tính surcharge | Không có | **OPEN** | Cùng nền với service fee, nền riêng, số tiền cố định, theo khách, hoặc theo món | Step có `calculation_method`, `basis_code`, rate/fixed amount và eligibility |
| Nền tính VAT | Không có | **OPEN** | Chỉ món; món + service fee; món + mọi surcharge; trước hay sau discount/voucher | VAT step tham chiếu rõ các step/bucket được tính thuế; không suy từ thứ tự UI |
| Discount và voucher cộng dồn | Không có | **OPEN** | Cho phép cả hai; loại trừ nhau; nhiều discount/voucher; hay chọn lợi ích cao nhất | `stacking_group`, `exclusive`, `priority`, `max_applications`; mọi lần áp dụng thành một ledger line riêng |
| Discount/voucher tuần tự hay cùng nền | Không có | **OPEN** | Mỗi khoản tính trên số dư sau khoản trước, hoặc tất cả tính trên cùng base | `basis_mode = ORIGINAL_BASE | RUNNING_BALANCE`, snapshot trên từng charge line |
| Phạm vi discount/voucher | Không có | **OPEN** | Toàn bill, category, item/variant, order, hoặc quantity được chọn | Eligibility snapshot chứa source line/quantity được hưởng; không đọc lại rule mutable |
| Cap/floor của discount | Không có | **OPEN** | Có/không max discount, min spend, không cho tổng âm | Step lưu cap/minimum/floor; engine từ chối policy thiếu trường bắt buộc |
| Tách bill — nguồn món | Yêu cầu không nhân đôi/bỏ sót quantity | **CONFIRMED một phần** | Cần xác nhận có cho tách một dòng theo quantity hay chỉ chuyển cả dòng | `bill_line_allocations` tham chiếu `(order_line_id, allocated_quantity)`; tổng allocation của mọi active split phải đúng net quantity |
| Tách bill — charge cấp Phiên | Không có | **OPEN** | Phân bổ theo gross item, net item, chia đều, gán một bill, hoặc nhập tay có kiểm tra conservation | Mỗi charge có allocation method và các `bill_charge_allocations`; tổng phần chia phải bằng charge gốc |
| Phần dư khi phân bổ | Không có | **OPEN** | Bill có residual lớn nhất; bill đầu/cuối theo id ổn định; hoặc Thu ngân chọn | `remainder_rule` bắt buộc, deterministic và snapshot |
| Làm tròn khi tách bill | Chỉ biết làm tròn là bước cuối | **OPEN, rất quan trọng** | Làm tròn riêng từng split bill, hay làm tròn một lần ở visit total rồi phân bổ | Policy khai `rounding_scope = PER_BILL | VISIT_THEN_ALLOCATE`; từng bill vẫn lưu `pre_round_total`, `rounding_adjustment`, `rounded_total` |

## Decision table lifecycle

| Chủ đề | Trạng thái đề xuất | Điểm cần xác nhận |
|---|---|---|
| Visit state | `SERVING → AWAITING_PAYMENT → PAID`; reopen chỉ `AWAITING_PAYMENT → SERVING` | Đã được yêu cầu, không còn OPEN |
| Tạo prebill | Lock visit, order và order lines; tạo bill + ledger + chuyển visit sang `AWAITING_PAYMENT` trong một transaction | Đã được yêu cầu |
| Order đồng thời | Sau khi visit bị lock/chuyển state, order mới phải thất bại; order đang tạo và prebill serialize trên cùng visit row | Đã được yêu cầu |
| Pending cancellation của Module 5 | **OPEN** | Prebill phải bị chặn cho tới khi duyệt/từ chối, hay tạm tính theo net quantity hiện tại? |
| Reopen | Giữ bill revision bất biến, đánh dấu `VOIDED/SUPERSEDED`, rồi cho gọi thêm món; lần prebill sau tạo revision mới | Cần xác nhận có cho tái sử dụng cùng bill record hay bắt buộc revision mới; đề xuất revision mới để audit được |
| Một visit/một bill mặc định | Một active unsplit bill; khi split thì có một bill group và nhiều child bills | Đã được yêu cầu |
| PAID | Bill active phải có tổng allocation bảo toàn và total đã chốt | Phương thức thanh toán thuộc module nào chưa được nêu; Module 6 chỉ nên chuẩn bị trạng thái, không giả lập payment |

## Schema trung tính đề xuất sau khi có quyết định

1. `billing_policy_versions`: policy immutable theo organization/venue, thời gian
   hiệu lực, `vat_mode`, `rounding_scope`, `remainder_rule`, version.
2. `billing_policy_steps`: thứ tự charge và toàn bộ basis/method/rate/fixed
   amount/stacking/eligibility. Không hard-code thứ tự tài chính trong code.
3. `bills`: visit, bill group/split index, status, revision, policy version,
   config snapshot JSON, subtotal, pre-round total, rounding adjustment,
   rounded total, version và idempotency key.
4. `bill_line_allocations`: source order line snapshot + quantity được đưa vào
   bill. Đây là nguồn kiểm tra conservation cho split bill.
5. `bill_charge_lines`: append-only calculation ledger theo sequence, loại
   charge, signed amount, basis amount, rate/fixed snapshot và explanation.
6. `bill_charge_allocations`: phân bổ charge cấp visit vào từng split bill và
   lưu deterministic remainder.
7. Audit/event history cho create prebill, split, reopen, supersede và paid.

Venue chưa có một policy version hoàn chỉnh sẽ nhận
`409 BILLING_POLICY_NOT_CONFIGURED`; hệ thống không âm thầm dùng công thức mặc
định. Ledger giữ đủ dữ liệu để Module 8 render một bản in và QR mà không phải
đọc lại menu hay cấu hình đã thay đổi.

## Các xác nhận bắt buộc trước migration/code

1. Thứ tự chính xác của service fee, surcharge, VAT, discount và voucher.
2. VAT inclusive/exclusive và VAT tính trên những bucket nào.
3. Basis của service fee/surcharge và rule eligibility.
4. Discount/voucher stacking, priority, cap/minimum và scope.
5. Split charge allocation, deterministic remainder và rounding scope.
6. Pending cancellation có chặn prebill không.
7. Reopen tạo bill revision mới hay sửa bill cũ.


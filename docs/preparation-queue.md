# Module 4 — hàng đợi chế biến Bar/Bếp

`preparation_tickets` là nguồn dữ liệu chuẩn của hàng đợi. Mỗi lần gửi đơn tạo
tối đa một ticket `BAR` và một ticket `KITCHEN`; mỗi ticket chỉ đọc các
`sales_order_lines` có `preparation_station` trùng với ticket.

## State machine và đồng thời

Luồng duy nhất là `SUBMITTED → ACCEPTED → PREPARING → READY → COLLECTED`. API transition
yêu cầu `expectedVersion`; version sai trả `409 PREPARATION_VERSION_CONFLICT`.
Không có endpoint quay lùi, bỏ bước hay sửa ticket `COLLECTED`. `READY` còn nằm
trong queue cho tới khi nhân viên xác nhận đã nhận món bằng `COLLECTED`. Mỗi bước ghi người
thực hiện/thời gian, tăng version, thêm `preparation_ticket_events`, và thêm một
audit `PREPARATION_TICKET_TRANSITIONED` trong cùng transaction.

Snapshot dùng `GET /api/v1/preparation/:station/tickets`, chỉ trả tối đa 200
ticket đang hoạt động (`SUBMITTED` đến `READY`). Lịch sử `COLLECTED` dùng
`GET /api/v1/preparation/:station/history?limit=&beforeTicketId=`; server chặn
limit tối đa 100. Ticket và lines được đọc theo hai batch query, không query
lines từng ticket. Organization và venue
lấy từ session, station lấy từ URL đã validate, rồi middleware kiểm đúng quyền
`preparation.bar.*` hoặc `preparation.kitchen.*`. Vai `BAR` không có quyền Bếp
và vai `KITCHEN` không có quyền Bar. Việc ẩn nút ở web chỉ là UX; gọi API trực
tiếp vẫn bị server trả 403.

Mỗi ticket trả `orderedByDisplayName`, là tên hiển thị của nhân viên đã gửi
đơn; không trả username. Từ reservation liên kết trực tiếp với chính visit của
đơn, snapshot chỉ chiếu ba cờ vận hành không định danh: VIP, sinh nhật và chỉ
định. Walk-in hoặc visit không có reservation nhận cả ba cờ `false`. Response
không mang tên khách, số điện thoại, ghi chú booking hay lịch sử khách hàng.

Yêu cầu hủy `PENDING` được chiếu trên đúng từng line dưới dạng
`pendingCancellation { cancellationId, quantity }`; không trả lý do hủy ở
contract preparation. Một line đang chờ duyệt không khóa ticket và không đổi
trạng thái các line khác. Batch line query vẫn trả đúng một dòng cho mỗi dòng
món; unique open-cancellation của database và invariant trong repository chặn
việc nhân đôi line.

Mã bàn không được lưu trên order/ticket. Snapshot join allocation `USAGE` đang
mở của `visit_id`, nên đổi bàn sau khi gửi sẽ hiện mã bàn mới. Khi ticket thành
`READY`, một `preparation_ready_events` giữ đúng `visit_id` và
`ordered_by_user_id`, không định tuyến theo bàn. Event có hai audience bền vững:
`ORDERED_BY_USER` và `CASHIER_ROLE`. Không chọn cứng một user Thu ngân;
`preparation_ready_acknowledgements` ghi user/membership thực tế đã nhận và
chống trùng theo idempotency key.

Realtime dùng kênh SSE hiện có và chỉ phát `{venueId, changeSeq}`. Callback SSE
được đăng ký trong middleware idempotency và chỉ chạy sau khi transaction commit;
rollback xóa callback nên không phát event. Client nhận
cursor rồi tải lại snapshot có phân quyền; event không chứa món, ghi chú hay
dữ liệu của station khác.

## Điểm cắm máy in

Tạo order và ticket đồng thời tạo đúng một dòng `preparation_print_outbox` với
unique `(ticket_id, event_type)`. Retry cập nhật chính dòng đó và được bảo vệ
bằng idempotency key, nên không tạo thêm order, ticket hoặc print job. Mỗi retry
logic ghi actor/timestamp vào `preparation_print_retry_events` và audit chung.

Snapshot chỉ trả `printing.enabled=true` khi `preparation_print_capabilities`
có `is_enabled`, `adapter_name` và heartbeat worker trong hai phút gần nhất.
Nếu thiếu, UI không render nút in lại và API trả
`503 PRINT_NOT_CONFIGURED`; không có hành vi in giả.

Interface nhà cung cấp nằm tại
`api/src/modules/preparation/print-adapter.ts` (`PreparationPrintAdapter`). Một
Worker/adapter do nhà cung cấp triển khai sẽ heartbeat capability, claim outbox,
dựng `PreparationPrintPayload`, gọi `deliver`,
rồi đánh dấu `DELIVERED`/`FAILED`. `deduplicationKey` phải truyền qua adapter
nếu nhà cung cấp hỗ trợ chống trùng. Chưa có worker/provider cụ thể vì giao
thức, kết nối và nhà cung cấp chưa được chốt; hàng đợi điện tử không phụ thuộc
vào máy in.

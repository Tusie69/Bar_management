# Module 4 — hàng đợi chế biến Bar/Bếp

`preparation_tickets` là nguồn dữ liệu chuẩn của hàng đợi. Mỗi lần gửi đơn tạo
tối đa một ticket `BAR` và một ticket `KITCHEN`; mỗi ticket chỉ đọc các
`sales_order_lines` có `preparation_station` trùng với ticket.

## State machine và đồng thời

Luồng đi tới là `SUBMITTED → ACCEPTED → PREPARING → READY → COLLECTED`. API transition
yêu cầu `expectedVersion`; version sai trả `409 PREPARATION_VERSION_CONFLICT`.
Không có endpoint bỏ bước hay sửa ticket `COLLECTED`. `READY` còn nằm
trong queue cho tới khi nhân viên xác nhận đã nhận món bằng `COLLECTED`. Mỗi bước ghi người
thực hiện/thời gian, tăng version, thêm `preparation_ticket_events`, và thêm một
audit `PREPARATION_TICKET_TRANSITIONED` trong cùng transaction.

## Lùi một bước

`POST /api/v1/preparation/:station/tickets/:ticketId/revert` lùi phiếu đúng một
bước: `ACCEPTED → SUBMITTED` và `PREPARING → ACCEPTED`. Quầy thật có lúc phải
lùi — bấm nhầm "Tiếp nhận", hoặc một bàn VIP chen vào nên phiếu đang cầm phải
trả về hàng chờ cho người khác.

`READY` thì KHÔNG lùi được (`409 PREPARATION_REVERT_NOT_ALLOWED`). Lúc phiếu
thành `READY`, máy chủ đã ghi `preparation_ready_events` và đẩy thông báo "món
xong" tới Phục vụ và Thu ngân; có thể đã có người đi lấy món. Rút lại một thông
báo đã tới tay người khác không phải việc một cú kéo trên màn hình quầy quyết
định — món phải làm lại thì đi đường xin hủy / ghi hao, nơi có người duyệt.

Endpoint dùng chung quyền `preparation.bar.transition` / `preparation.kitchen.transition`,
cũng yêu cầu `expectedVersion` và idempotency key như bước đi tới. Mốc thời gian
của bước bị lùi bị XOÁ (`accepted_at`, `started_at`) vì nó sẽ được ghi lại ở lần
đi tới sau; lịch sử đầy đủ vẫn nằm trong `preparation_ticket_events`, nơi mỗi
dòng mang `from_status → to_status`, người thực hiện và một cột `reason` TÙY
CHỌN (migration 0047). Audit riêng là `PREPARATION_TICKET_REVERTED`, nên lọc ra
được các lần sửa tay mà không lẫn với bước đi tới.

Tiến độ từng món (`preparation_line_progress`) không bị xoá khi lùi: số phần đã
pha là một việc đã xảy ra thật, không phải hệ quả của trạng thái phiếu.

Trên web, cả hai chiều đều kéo thả được giữa các cột, một bước mỗi lần. Luật
nằm ở hàm thuần `planPreparationDrop` (`web/src/features/preparation/preparation-drag.ts`),
dùng chung cho cú kéo và nút bấm, nên hai đường không bao giờ nói khác nhau.
Cú kéo bắt đầu từ một tay nắm riêng trên thẻ chứ không phải cả thẻ: thẻ có nút
cộng trừ tiến độ, và biến cả thẻ thành vùng kéo thì mỗi lần vuốt để cuộn lại
thành một lần đổi trạng thái. Dùng Pointer Events chứ không phải HTML5
drag-and-drop, vì màn hình quầy là máy tính bảng.

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

Mỗi line mang `menuItemVariantId` và `unitCode` từ chính snapshot
`sales_order_lines`, để client có định danh món ổn định mà không phải suy từ
tên hiển thị. Yêu cầu hủy `PENDING` được chiếu trên đúng từng line dưới dạng
`pendingCancellation { cancellationId, quantity, groupId }`; `groupId` là
`null` với yêu cầu lẻ và là mã nhóm với yêu cầu hủy cả đơn. Contract
preparation không trả lý do hủy. Một line đang chờ duyệt không khóa ticket và
không đổi trạng thái các line khác. Batch line query vẫn trả đúng một dòng cho
mỗi dòng món; unique open-cancellation của database và invariant trong
repository chặn việc nhân đôi line.

Web dùng `groupId` để phân biệt yêu cầu hủy riêng với yêu cầu "Hủy đơn?" và
chỉ mô tả phần BAR/Bếp đang có trong chính ticket. Màn một station không suy ra
trạng thái station còn lại hoặc toàn order. Cảnh báo này không vô hiệu hóa nút
transition; backend vẫn là nơi quyết định hành vi và xung đột phiên bản.

Mỗi line còn trả `doneQuantity` và `progressVersion`. Bar/Bếp cập nhật tiến độ
qua `POST /preparation/:station/tickets/:ticketId/lines/:lineNo/progress` với
`doneQuantity`, `expectedVersion` và `idempotencyKey`. Tiến độ chỉ sửa được khi
phiếu ở `ACCEPTED` hoặc `PREPARING`, không được vượt `quantity`, có audit
append-only và phát cùng floor-change SSE để các thiết bị nhìn thấy nhau.

Việc tick đủ không tự chuyển trạng thái phiếu. Khi báo READY mà còn dòng chưa
đủ, UI chỉ cảnh báo mềm và vẫn cho người vận hành quyết định. Nếu một yêu cầu
hủy được duyệt sau khi đã làm một phần, server tính lại tại thời điểm duyệt:
`wasteQuantity = min(quantity xin hủy, doneQuantity hiện tại)`. Phần đã làm là
hao hụt, phần chưa làm hủy bình thường; tiến độ còn lại được giảm tương ứng.

Âm báo phiếu mới mặc định tắt, do người dùng bật theo thiết bị. Snapshot đầu
tiên không phát âm, high-water trong session ngăn phát lại và Web Locks cùng
marker localStorage bảo đảm chỉ một tab phát cho cùng venue/station.

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

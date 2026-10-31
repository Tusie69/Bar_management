# Hợp đồng API 21GAM

Base URL môi trường phát triển: `http://localhost:3000/api/v1`.

## Quy ước phản hồi

- JSON dùng UTF-8.
- Lỗi nghiệp vụ trả về `error.code` ổn định và `error.message` bằng tiếng Việt.
- API dành cho Lễ tân không được trả số điện thoại đầy đủ.
- Mở số điện thoại booking yêu cầu đồng thời `booking.phone.reveal` và `customer.phone.reveal`; policy hiện tại chỉ
  cấp cả hai quyền cho `OWNER_ADMIN`. Lễ tân chỉ nhận dữ liệu đã che và không được tạo liên kết `tel:` từ số đã lưu.
- Ngày nghiệp vụ chạy từ 17:00 đến 05:00 hôm sau và sẽ dùng trường `businessDate` theo định dạng `YYYY-MM-DD`.
- Giờ nhận booking mới hoặc giờ booking được đổi chỉ trong 19:00–01:00 giờ Việt Nam, tính cả hai mốc. Backend
  chấp nhận mọi phút trong cửa sổ này; UI dùng cấu hình hiện hữu 13 mốc cách nhau 30 phút. Quy tắc này không áp dụng
  cho Walk-in. Khi sửa booking lịch sử có giờ ngoài cửa sổ, API cho phép giữ nguyên timestamp để sửa trường khác,
  nhưng sẽ từ chối nếu client đổi giờ sang một giá trị ngoài cửa sổ.

## Health

| Phương thức | Đường dẫn | Mô tả | Thành công |
| --- | --- | --- | --- |
| GET | `/health` | Kiểm tra API đang hoạt động | `200 { "ok": true }` |

## API đã triển khai

| Phương thức | Đường dẫn | Mô tả |
| --- | --- | --- |
| GET | `/tables?date=YYYY-MM-DD` | Danh sách bàn và trạng thái theo ngày nghiệp vụ |
| PATCH | `/tables/:id/status` | Chuyển trạng thái bàn theo state machine và optimistic locking |
| GET | `/waitlist?date=YYYY-MM-DD` | Danh sách chờ của venue theo FIFO (`queuedAt`, sau đó `id`) |
| POST | `/waitlist` | Thêm khách walk-in vào danh sách chờ |
| POST | `/waitlist/:id/seat` | Chuyển khách chờ thành booking và giữ một hoặc nhiều bàn |
| GET | `/bookings?date=YYYY-MM-DD` | Danh sách booking, gồm classification thủ công |
| POST | `/bookings` | Tạo booking |
| PUT | `/bookings/:id` | Sửa booking với optimistic locking |
| GET | `/bookings/export?date=YYYY-MM-DD` | Xuất text Zalo và thống kê theo ngày nghiệp vụ |

## Waitlist trên Floor Layout

Tất cả endpoint yêu cầu session cookie hợp lệ. Endpoint đọc yêu cầu quyền `customer.view_masked`. Hai endpoint ghi yêu cầu CSRF token; tạo entry yêu cầu `waitlist.create`, còn gán bàn yêu cầu đồng thời `waitlist.accept_offer`, `reservation.create` và `table.assign`.

### `GET /waitlist?date=YYYY-MM-DD`

Phản hồi `{ businessDate, entries }`. Mỗi entry gồm `id`, `kind`, `guestName`, `phoneLast3`, `partySize`, `businessDate`, `queuedAt`, `status`, `contactChannel`, `reservationId`, `visitId`, `note`, `version`. API không trả số điện thoại đầy đủ. Kết quả được sắp tăng dần theo `queued_at`, sau đó `id`; frontend không tự tạo timestamp để đổi thứ tự.

### `POST /waitlist`

```json
{
  "guestName": "Tên khách",
  "phoneNumber": "0900000000",
  "partySize": 4,
  "businessDate": "2030-10-24",
  "contactChannel": "IN_PERSON",
  "note": "Ghi chú không chứa số điện thoại"
}
```

`phoneNumber` và `note` là tùy chọn. Số điện thoại được chuẩn hóa, mã hóa AES-GCM và đối chiếu trùng bằng HMAC theo cùng chính sách Customer/Booking; plaintext không được ghi audit. Entry mới là `WALK_IN/WAITING`, `queued_at` lấy từ MySQL server. Số khách hợp lệ từ 1 đến 500. Lỗi liên quan gồm `INVALID_GUEST_NAME`, `INVALID_PHONE_NUMBER`, `INVALID_PARTY_SIZE`, `WAITLIST_DUPLICATE`, `PHONE_KEYS_UNAVAILABLE`.

### `POST /waitlist/:id/seat`

```json
{ "version": 1, "tableIds": [123] }
```

Trong một transaction, backend khóa entry và bàn, kiểm tra version, trạng thái `WAITING`, tổng capacity, cùng khu, cùng loại bàn, khu được phép booking, bàn ACTIVE, bàn sơ cua và allocation conflict; sau đó tạo đúng một reservation `BOOKED` với `customer_classification = UNCLASSIFIED`, một `table_holds` loại `RESERVATION`, một allocation `HOLD` cho mỗi bàn, và một `table_groups` dùng chung khi chọn nhiều bàn. Cuối cùng backend chuyển entry thành `ADVANCE_RESERVATION/HOLD_ACTIVE` và ghi audit `WAITLIST_ASSIGNED_TO_RESERVATION`. Không tạo active visit; Floor State vì vậy hiển thị các bàn `RESERVED` với cùng group/highlight. Mọi ghi thay đổi được rollback nếu một bước thất bại.

Response: `{ entry, reservationId }`. Các lỗi chính: `VERSION_CONFLICT`, `WAITLIST_NOT_SEATABLE`, `INSUFFICIENT_TABLE_CAPACITY`, `TABLE_ALREADY_OCCUPIED`, `SPARE_TABLE_NOT_BOOKABLE`, `WAITLIST_BOOKING_SOURCE_MISSING`.

## Booking classification

Payload tạo/sửa booking nhận `classification`: `RETURNING`, `NEW` hoặc `UNCLASSIFIED`. Trường không hợp lệ trả
`INVALID_BOOKING_CLASSIFICATION`. Nếu client cũ bỏ qua trường này, create dùng `UNCLASSIFIED` còn update giữ nguyên
giá trị hiện tại. Response list/detail luôn trả một trong ba giá trị; database `NULL` cũ được ánh xạ thành
`UNCLASSIFIED`. Classification thuộc booking, không thuộc customer profile.

## API booking

| Phương thức | Đường dẫn | Mô tả |
| --- | --- | --- |
| GET | `/bookings?date=YYYY-MM-DD` | Danh sách booking theo ngày nghiệp vụ |
| POST | `/bookings` | Tạo booking |
| PUT | `/bookings/:id` | Sửa booking hoặc đổi bàn |
| POST | `/bookings/:id/cancel` | Hủy booking thủ công |
| GET | `/bookings/search?q=` | Tìm theo tên hoặc ba số cuối điện thoại |
| GET | `/bookings/export?date=YYYY-MM-DD` | Plain text tổng hợp booking theo ngày để người dùng xem trước và tự sao chép |

### `GET /bookings/export?date=YYYY-MM-DD`

Yêu cầu session hợp lệ và quyền `customer.view_masked`. Response là `text/plain; charset=utf-8`, lấy booking,
allocation, bàn `OUT_OF_SERVICE` và bộ đếm waitlist trong cùng một MySQL transaction read snapshot. Query và formatter
không đọc/xuất số điện thoại, `phoneLast3`, ciphertext, HMAC hay customer ID. Thống kê trước/sau cộng `party_size`
theo `expected_at` với cutoff 21:30 giờ Việt Nam (`>=` thuộc nhóm sau); O/N đếm booking theo classification và báo
riêng số `UNCLASSIFIED`. Endpoint chỉ trả text; không gửi sang Zalo.


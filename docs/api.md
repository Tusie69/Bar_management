# Hợp đồng API v1

Base URL khi phát triển: `http://localhost:3000/api/v1`

Tất cả request/response dùng JSON và thời gian theo ISO 8601 có múi giờ, ví dụ `2026-10-25T21:00:00+07:00`. Tên trường API dùng `camelCase` và không phụ thuộc trực tiếp vào tên cột MySQL.

## Quy ước lỗi

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Ngày kinh doanh phải có định dạng YYYY-MM-DD.",
    "details": { "field": "date" }
  }
}
```

| HTTP | Ý nghĩa |
|---|---|
| 400 | Dữ liệu sai hoặc chuyển trạng thái sai luồng |
| 404 | Không tìm thấy tài nguyên |
| 409 | Booking trùng bàn và khung giờ |
| 500 | Lỗi máy chủ không dự kiến |

## Endpoint đã triển khai

### `GET /health`

Kiểm tra API đang hoạt động.

```json
{ "ok": true }
```

### `GET /tables?date=YYYY-MM-DD`

Trả danh sách bàn và trạng thái trong ngày kinh doanh. Tham số `date` là bắt buộc.

```json
{
  "date": "2026-10-25",
  "tables": [
    {
      "id": 1,
      "code": "B1",
      "name": "Bàn B1",
      "zone": "Khu bàn",
      "capacity": 4,
      "position": { "x": 80, "y": 80 },
      "isBackup": false,
      "status": "AVAILABLE"
    }
  ]
}
```

Trạng thái: `AVAILABLE`, `RESERVED`, `OCCUPIED`, `DISABLED`, `BACKUP_INACTIVE`.

### `PATCH /tables/:id/status`

Cập nhật trạng thái vận hành của bàn trong một ngày. Máy chủ khóa bản ghi và kiểm tra bảng chuyển trạng thái trước khi ghi.

```json
{
  "date": "2026-10-25",
  "status": "OCCUPIED"
}
```

```json
{
  "id": 1,
  "date": "2026-10-25",
  "previousStatus": "AVAILABLE",
  "status": "OCCUPIED"
}
```

> Khi module booking hoàn thiện, trạng thái `RESERVED` phải được suy ra từ booking tại khung giờ đang xem. Endpoint này chủ yếu dành cho các trạng thái vận hành như đang sử dụng, tạm khóa và kích hoạt bàn sơ cua.

## Endpoint đã thống nhất, chưa triển khai trong ba ngày đầu

### `GET /bookings?date=YYYY-MM-DD`

Danh sách booking theo ngày kinh doanh.

### `POST /bookings`

```json
{
  "customer": { "name": "Nguyễn Văn An", "phone": "0901234567" },
  "startAt": "2026-10-25T21:00:00+07:00",
  "endAt": "2026-10-26T00:00:00+07:00",
  "guestCount": 6,
  "source": "HOTLINE",
  "note": "Sinh nhật",
  "tableIds": [4, 5]
}
```

Trả `201` cùng booking đã tạo. Nếu một bàn có booking chưa hủy thỏa điều kiện `startA < endB AND startB < endA`, trả `409 TABLE_TIME_CONFLICT`.

### `PUT /bookings/:id`

Thay thế dữ liệu có thể chỉnh sửa của booking. Việc kiểm tra xung đột bỏ qua chính booking đang sửa và phải chạy trong transaction.

### `POST /bookings/:id/cancel`

```json
{ "reason": "Khách đổi kế hoạch" }
```

Không xóa dữ liệu. Booking chuyển sang `CANCELLED` và lưu thời điểm/lý do hủy.

### `GET /bookings/search?q=`

- `q` gồm đúng ba chữ số: tìm theo ba số cuối điện thoại đã chuẩn hóa.
- Các giá trị khác: tìm không phân biệt hoa thường theo tên khách.
- Có thể trả nhiều kết quả; giao diện phải cho Lễ tân chọn đúng booking.

## Trạng thái booking dự kiến

`PENDING`, `CONFIRMED`, `ARRIVED`, `SEATED`, `COMPLETED`, `CANCELLED`, `NO_SHOW`.

## Điểm nghiệp vụ chưa chốt

1. Giờ kết thúc ngày kinh doanh khi quán hoạt động qua 0 giờ.
2. Thời lượng giữ bàn mặc định hoặc việc bắt buộc nhập `endAt`.
3. Ngưỡng khách đến trễ và thời gian quán tiếp tục giữ bàn.
4. Danh sách bàn, tọa độ và sức chứa thật.
5. Bảng chuyển trạng thái cuối cùng do BA/PO duyệt.

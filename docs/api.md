# Hợp đồng API 21GAM

Base URL môi trường phát triển: `http://localhost:3000/api/v1`.

## Quy ước phản hồi

- JSON dùng UTF-8.
- Lỗi nghiệp vụ trả về `error.code` ổn định và `error.message` bằng tiếng Việt.
- API dành cho Lễ tân không được trả số điện thoại đầy đủ.
- Ngày nghiệp vụ chạy từ 17:00 đến 05:00 hôm sau và sẽ dùng trường `businessDate` theo định dạng `YYYY-MM-DD`.

## Health

| Phương thức | Đường dẫn | Mô tả | Thành công |
| --- | --- | --- | --- |
| GET | `/health` | Kiểm tra API đang hoạt động | `200 { "ok": true }` |

## API đã triển khai

| Phương thức | Đường dẫn | Mô tả |
| --- | --- | --- |
| GET | `/tables?date=YYYY-MM-DD` | Danh sách bàn và trạng thái theo ngày nghiệp vụ |
| PATCH | `/tables/:id/status` | Chuyển trạng thái bàn theo state machine và optimistic locking |

## API dự kiến tiếp theo

Các endpoint dưới đây là hợp đồng đang nghiên cứu, chưa triển khai cho tới khi schema CSDL được duyệt.

| Phương thức | Đường dẫn | Mô tả |
| --- | --- | --- |
| GET | `/bookings?date=YYYY-MM-DD` | Danh sách booking theo ngày nghiệp vụ |
| POST | `/bookings` | Tạo booking |
| PUT | `/bookings/:id` | Sửa booking hoặc đổi bàn |
| POST | `/bookings/:id/cancel` | Hủy booking thủ công |
| GET | `/bookings/search?q=` | Tìm theo tên hoặc ba số cuối điện thoại |


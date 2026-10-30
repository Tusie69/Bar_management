# US-07 / TU-04 — Xuất text booking cho Zalo

## Luồng sử dụng

Trong trang Booking, chọn ngày nghiệp vụ rồi bấm **Xuất text Zalo**. Hộp thoại tải bản xem trước trực tiếp từ
`GET /api/v1/bookings/export`, tự cập nhật mỗi 15 giây khi đang mở và có nút **Cập nhật** thủ công. Nút **Sao chép**
gọi Clipboard API và chỉ báo thành công sau khi trình duyệt hoàn tất ghi clipboard. Website không mở hoặc gửi tin qua Zalo.

## Format đã xác nhận

- Tiêu đề lấy `businessDate`, không lấy ngày local của thiết bị.
- Khu cố định theo thứ tự A, B, C, Bar; thứ tự bàn theo US-07. Mã bàn ngoài danh mục mẫu vẫn được xuất ở khu
  backend cung cấp, không bị loại bỏ.
- `BC (Bàn Chờ +n)` đếm entry `WAITING`, `CONTACTING`, `OFFERED` của đúng venue/ngày nghiệp vụ từ TU-03.
- `BÀN OUT` lấy bàn có status `OUT_OF_SERVICE`; `BÀN HUỶ` lấy reservation `CANCELLED`. Hai nhóm không bị trộn.
- Booking active là `BOOKED` hoặc `CHECKED_IN`. Tổng booking/khách đặt loại booking hủy và no-show.
- `Tổng khách đã đến` là tổng `party_size` của booking `CHECKED_IN`.
- `Khách vào trước 21:30` và `Khách vào sau 21:30` cộng `party_size` theo `expected_at`. Cutoff là 21:30
  `Asia/Ho_Chi_Minh` của business date; đúng 21:30 và các booking sau nửa đêm thuộc nhóm sau.
- O/N đếm theo booking, không theo allocation: `RETURNING` vào O, `NEW` vào N, còn `UNCLASSIFIED` được báo riêng.
  Booking nhiều bàn chỉ được đếm một lần.
- Formatter dùng allowlist. Không truy vấn hoặc xuất SĐT, ba số cuối, ciphertext, HMAC, ghi chú hay customer ID.

## Emoji

| Emoji | Ý nghĩa | Nguồn hiện tại |
| --- | --- | --- |
| ⭐️ | Bàn sếp | Formatter hỗ trợ; backend chưa có metadata chính thức nên production không tự gắn |
| 🔥 | Khách quen | `reservations.customer_classification = RETURNING` do lễ tân chọn thủ công |
| 📌 | Chỉ định | Formatter hỗ trợ; backend chưa có metadata chính thức nên production không tự gắn |
| 🎂 | Sinh nhật | Formatter hỗ trợ; backend chưa có metadata chính thức nên production không tự gắn |
| ✅ | Đã tới | `reservations.status = CHECKED_IN` |
| 1️⃣ / 2️⃣ | Lượt 1 / 2 | Formatter hỗ trợ; backend chưa có metadata chính thức nên production không tự gắn |

Không suy diễn emoji từ tên khách, ghi chú, số lần booking hoặc nhân viên tạo.

## Phân loại khách

Lễ tân chọn `RETURNING`, `NEW` hoặc `UNCLASSIFIED` trên form tạo/sửa booking. Không suy diễn từ SĐT, customer ID,
lịch sử hoặc tên. Migration `0004_reservation_customer_classification.sql` để `NULL` hợp lệ cho dữ liệu cũ; API đọc
`NULL` như `UNCLASSIFIED`. Booking tạo từ waitlist luôn bắt đầu ở `UNCLASSIFIED`. Classification thuộc reservation và
không sửa customer profile.

Migration được chạy đúng một lần qua `schema_migrations` và không backfill dữ liệu cũ. Khi rollout, ưu tiên
forward-fix vì code cũ có thể bỏ qua cột nullable. Chỉ được drop constraint/cột nếu chưa có booking nào ghi
classification; sau khi đã có dữ liệu O/N thì không rollback bằng cách drop cột vì sẽ mất dữ liệu nghiệp vụ.

## Giới hạn nguồn mẫu

Repository không có “Phụ lục file 03” hoặc mẫu anh Luân ngày 21/10. Vì vậy chưa thể chứng minh output khớp mẫu gốc.
Mốc `9h30` là **21:30**; nguồn là `expected_at`; boundary `>= 21:30` thuộc nhóm sau. Số 0 chỉ được xuất sau khi query
database thành công và không có booking thuộc nhóm tương ứng.

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
- Formatter dùng allowlist. Không truy vấn hoặc xuất SĐT, ba số cuối, ciphertext, HMAC, ghi chú hay customer ID.

## Emoji

| Emoji | Ý nghĩa | Nguồn hiện tại |
| --- | --- | --- |
| ⭐️ | Bàn sếp | Formatter hỗ trợ; backend chưa có metadata chính thức nên production không tự gắn |
| 🔥 | Khách quen | Formatter hỗ trợ; backend chưa có classification chính thức nên production không tự gắn |
| 📌 | Chỉ định | Formatter hỗ trợ; backend chưa có metadata chính thức nên production không tự gắn |
| 🎂 | Sinh nhật | Formatter hỗ trợ; backend chưa có metadata chính thức nên production không tự gắn |
| ✅ | Đã tới | `reservations.status = CHECKED_IN` |
| 1️⃣ / 2️⃣ | Lượt 1 / 2 | Formatter hỗ trợ; backend chưa có metadata chính thức nên production không tự gắn |

Không suy diễn emoji từ tên khách, ghi chú, số lần booking hoặc nhân viên tạo.

## Quy tắc còn mở

Repository không có “Phụ lục file 03” hoặc mẫu anh Luân ngày 21/10. Vì vậy chưa thể chứng minh output khớp mẫu gốc.
Mốc `9h30` đã được xác nhận là **21:30**. Các dòng trước/sau 21:30 vẫn hiển thị **Chưa xác nhận nghiệp vụ** cho tới khi Product Owner xác nhận nguồn
timestamp và xử lý ranh giới. Các dòng khách quen O / khách mới N cũng hiển thị trạng thái này cho tới khi backend có
classification chính thức. Không dùng số 0 giả cho các chỉ số chưa đủ dữ liệu.

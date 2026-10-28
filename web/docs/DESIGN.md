# Hướng thiết kế: "Monochrome Service"

## Bối cảnh sử dụng

Lễ tân đứng ở cửa với iPad ngang, quán tối, nhạc to, khách đang chờ. Mỗi thao tác phải đọc được trong 1 giây và chạm trúng ở lần đầu. Chủ quán xem báo cáo trên laptop ban ngày. Vì vậy thiết kế ưu tiên: **trạng thái bàn rõ ràng trong ánh sáng yếu**, ít màu trang trí, vùng chạm lớn, và mọi thao tác nguy hiểm (nhả bàn, hủy booking, xem SĐT) đều có xác nhận.

## Ba hướng đã cân nhắc

| Tiêu chí (trọng số)              | A. Refined Hospitality                                    | B. Contemporary Operations                       | C. Boutique Nightlife                             |
| -------------------------------- | --------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------- |
| Tinh thần                        | Nền ngà, serif hiển thị, thẻ mềm, giống trang khách sạn   | Trung tính, dày thông tin, lưới vận hành rõ ràng | Nền đen sâu, điểm nhấn neon, glow, đậm chất bar   |
| Đọc trong quán tối (25%)         | Kém: nền sáng chói, serif nhỏ khó đọc                     | Tốt nếu có bản tối                               | Tốt về nền, nhưng neon gây mỏi mắt                |
| Phân biệt trạng thái bàn (25%)   | Trung bình: màu ấm lẫn với trạng thái                     | Tốt: màu chỉ dành cho trạng thái                 | Kém: neon trang trí tranh chấp với màu trạng thái |
| Tốc độ thao tác lễ tân (20%)     | Trung bình: nhiều khoảng trắng, ít thông tin mỗi màn hình | Tốt                                              | Trung bình                                        |
| Truy cập (tương phản, CVD) (15%) | Trung bình                                                | Tốt                                              | Kém: glow và tương phản màu-trên-màu              |
| Hợp thương hiệu quán bar (15%)   | Trung bình: hợp nhà hàng hơn bar                          | Trung bình: dễ thành SaaS chung chung            | Tốt                                               |
| **Điểm**                         | **2.6 / 5**                                               | **4.3 / 5**                                      | **3.0 / 5**                                       |

**Chọn B làm nền, mượn một nét của C.** Lấy cấu trúc vận hành, mật độ thông tin và kỷ luật màu của B; mượn từ C đúng một thứ: **giao diện tối là mặc định** cho quầy, gọi là "Service". Giao diện sáng "Daylight" dành cho văn phòng. Không dùng neon, glow hay gradient trang trí.

Tham khảo hình ảnh: SevenRooms (sơ đồ bàn chiếm trung tâm + panel chi tiết bên phải, trạng thái bằng màu và nhãn). Tham khảo luồng: OpenTable và Eat App (ngày giờ → số khách → khả dụng → chọn bàn → thông tin → xác nhận; walk-in 2 chạm).

## Khóa tham chiếu

- **Giữ:** chrome đơn sắc (mực + giấy), màu chỉ cho trạng thái; sơ đồ bàn là trung tâm; chữ số và mã bàn dùng font mono có chữ số đều; vùng chạm tối thiểu 44 px; bề mặt phẳng, viền mảnh, bóng chỉ cho lớp nổi.
- **Từ chối:** màu thương hiệu tràn lan, gradient trang trí, serif hiển thị, chữ đổi phong cách giữa tiêu đề, nền kem/ô-liu, "card grid" chung chung.
- **Dấu ấn nhớ được:** 12 **ký hiệu ghép** (nơ, sao, thoi, tròn, tam giác, vuông, tim, lục giác, chữ thập, trăng, giọt, tia). Một nhóm bàn ghép mang cùng ký hiệu ở mọi nơi: sơ đồ, danh sách, timeline, panel. Trên sơ đồ có "sợi chỉ" nối các bàn cùng nhóm.

## Token

Định nghĩa trong `src/index.css` bằng OKLCH, mỗi token có bản cho hai giao diện.

| Nhóm                    | Token                                                                                                                | Vai trò                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Bề mặt                  | `--background`, `--surface-1..3`, `--floor*`                                                                         | Nền trang, thẻ, lớp nổi, nền sơ đồ                                                            |
| Chữ                     | `--foreground`, `--text-muted`, `--text-subtle`                                                                      | Ba bậc chữ, tất cả đạt ≥ 4.5:1 trên nền tương ứng                                             |
| Hành động               | `--primary` = mực (sáng) / giấy (tối)                                                                                | Nút chính luôn là khối mực/giấy, không có màu thương hiệu                                     |
| Trạng thái              | `--st-reserved` (xanh dương), `--st-late` (hổ phách), `--st-noshow` (đỏ), `--st-seated` (xanh lục), `--st-oos` (xám) | **Chỉ** cho trạng thái bàn/booking. Luôn đi kèm biểu tượng + nhãn chữ, không dùng màu đơn độc |
| Chữ trên nền trạng thái | `--st-*-ink`, `--st-*-tint`                                                                                          | Chữ nhỏ trên nền nhạt trạng thái vẫn đạt 4.5:1 ở cả hai giao diện                             |

Chữ: toàn bộ dùng **Be Vietnam Pro** (dấu tiếng Việt chuẩn, đóng gói cục bộ qua `@fontsource`, không gọi Google Fonts). Ba bậc: tiêu đề lớn 700-800, chữ to vừa (tên khách, tiêu đề khối, mã bàn) SemiBold 600, chữ thường và chữ nhỏ Regular 400. Be Vietnam Pro không có chữ số đều (tnum), nên con số đổi liên tục (đồng hồ, đếm ngược) được đặt trong ô có bề rộng tối thiểu để không xô lệch bố cục.

Kích thước: nút mặc định cao 44 px (`h-11`), nút lớn 48 px; bo góc 10 px; khoảng cách theo bậc 4 px.

## Trạng thái bàn trên sơ đồ

| Trạng thái        | Màu          | Dấu hiệu phụ (không phụ thuộc màu)                 |
| ----------------- | ------------ | -------------------------------------------------- |
| Trống             | Viền mực     | Sức chứa "N chỗ"                                   |
| Đã giữ chỗ        | Xanh dương   | Giờ đến                                            |
| Trễ               | Hổ phách     | `+NN'` số phút trễ                                 |
| Không đến         | Đỏ           | `+NN'`, chỉ cho xác nhận sau 30'                   |
| Đang ngồi         | Xanh lục đặc | Số khách · thời gian ngồi                          |
| Giữ cho khách chờ | Viền nét đứt | "giữ NN'" đếm ngược hạn giữ, "quá NN'" khi quá hạn |
| Ngưng phục vụ     | Xám          | Nền gạch chéo, chữ "ngưng"                         |
| Bàn sơ cua        | Viền nét đứt | Chữ "sơ cua"                                       |

## Nguyên tắc tương tác

- Nút không đủ quyền **vẫn hiện**, bị khóa, có biểu tượng khóa và tooltip "Cần quyền: ...". Không có nút giả.
- Thao tác có hậu quả (nhả bàn, hủy, đánh dấu không đến, xem SĐT) luôn qua hộp thoại xác nhận, ghi lý do khi cần.
- Thông báo thành công luôn ghi "Bản mô phỏng: chỉ cập nhật dữ liệu trên máy này, chưa gửi máy chủ."
- Xung đột (máy khác vừa thay đổi) hiện hộp thoại riêng với lựa chọn rõ: tải lại, chọn bàn khác. Không ghi đè im lặng.
- Hoàn tác có ở mọi thao tác ghi; nếu dữ liệu đã bị máy khác sửa thì báo rõ vì sao không hoàn tác được.
- Tôn trọng `prefers-reduced-motion`.

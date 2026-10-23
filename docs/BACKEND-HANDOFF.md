# Bàn giao cho backend (Express + MySQL)

Tài liệu này dành cho người làm API. Frontend chỉ phụ thuộc interface `GamApi` trong `src/services/contracts.ts`; bản mock trong `src/services/mock` là đặc tả chạy được của từng hành vi. Không có thay đổi schema hay migration nào trong prototype này: các kiểu trong `src/domain/schema.ts` phản ánh bản DDL nháp 26 bảng (thư mục `database/`), không thêm cột.

## Quy ước chung

- **Idempotency:** mọi request ghi gửi header `Idempotency-Key` (một UUID cho mỗi ý định người dùng, giữ nguyên khi tự động thử lại). Lưu ở `idempotency_keys`.
- **Khóa lạc quan:** request sửa gửi `version` của bản ghi; lệch thì trả `409 VERSION_CONFLICT`.
- **Lỗi:** `{ status, code, message, details }`. `message` bằng tiếng Việt, hiển thị thẳng cho người dùng.

| Mã                       | HTTP | Khi nào                                                      | Frontend xử lý                                     |
| ------------------------ | ---- | ------------------------------------------------------------ | -------------------------------------------------- |
| `VALIDATION_FAILED`      | 422  | Dữ liệu không hợp lệ (thiếu tên và SĐT, ghi chú chứa SĐT...) | Toast lỗi, giữ nguyên form                         |
| `PERMISSION_DENIED`      | 403  | Vai trò không có quyền                                       | Toast lỗi                                          |
| `NOT_FOUND`              | 404  |                                                              | Toast lỗi                                          |
| `VERSION_CONFLICT`       | 409  | Bản ghi đã bị sửa từ máy khác                                | Hộp thoại xung đột, tải lại dữ liệu                |
| `TABLE_CONFLICT`         | 409  | Bàn đã có claim chồng thời gian (`details.tableIds`)         | Hộp thoại xung đột, gợi ý chọn bàn khác            |
| `ENTRY_ALREADY_CLAIMED`  | 409  | Mục chờ đang được nhân viên khác xử lý (lease còn hạn)       | Toast + hiện người đang xử lý                      |
| `NO_SYMBOL_AVAILABLE`    | 409  | Hết ký hiệu ghép (`group_symbol_count`)                      | Toast lỗi                                          |
| `OVERRIDE_REQUIRED`      | 409  | Cần Chủ quán duyệt (bàn sơ cua, thiếu chỗ, khu chờ...)       | Hộp thoại nhập lý do, gửi lại với `overrideReason` |
| `INVALID_STATE`          | 422  | Sai trạng thái (check-in booking đã hủy...)                  | Toast lỗi                                          |
| `UNDO_CONFLICT_MODIFIED` | 409  | Không hoàn tác được vì dữ liệu liên quan đã bị sửa sau đó    | Hộp thoại giải thích                               |
| `NOT_UNDOABLE`           | 422  | Thao tác không hỗ trợ hoàn tác                               | Toast                                              |
| `IDEMPOTENCY_KEY_REUSED` | 422  | Cùng key, khác nội dung                                      | Toast                                              |

## Endpoint

Danh sách đầy đủ ở `REST_ENDPOINTS` trong `src/services/contracts.ts`. Đường dẫn ghi `db08` / `db09` lấy theo tài liệu database; các dòng ghi `PROPOSED` là đề xuất, cần thống nhất trước khi làm:

- `GET /api/venues/:venueId/catalog`: khu, bàn (kèm `pos_x`, `pos_y`, `width`, `height`), cấu hình ghép, nguồn booking, cấu hình quán.
- `GET /api/venues/:venueId/availability?at=ISO&party=N`: khả dụng theo **ngày giờ khách muốn**, tính từ `reservations` + `table_holds`, không suy từ trạng thái bàn hiện tại.
- `GET /api/venues/:venueId/shift-overview?date=`: KPI ca.
- `GET /api/venues/:venueId/reservations?date=&q=`: `q` tìm tên không dấu (`name_search`) hoặc 3 số cuối (`phone_last3`).
- `GET /api/venues/:venueId/allocations?date=&table=`: lịch sử phân bàn cho timeline và panel bàn.

## Ánh xạ 26 bảng

| Bảng                                                                                   | Dùng ở đâu trên giao diện                                                                                                                                    |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `organizations`, `venues`                                                              | Cấu hình quán (Cài đặt): giờ ngày kinh doanh, ngưỡng trễ/không đến, hạn giữ chờ, lease claim, chính sách giữ bàn, số ký hiệu ghép. `change_seq` cho đồng bộ. |
| `users`, `memberships`, `roles`, `permissions`, `role_permissions`, `membership_roles` | Phiên đăng nhập, ma trận quyền (`src/domain/access.ts` chép từ db08), nút bị khóa kèm lý do                                                                  |
| `auth_sessions`                                                                        | Không dùng trong mock; backend giữ phiên bằng cookie `credentials: "include"`                                                                                |
| `floors`, `zones`, `dining_tables`                                                     | Sơ đồ bàn. Tọa độ hiện lấy từ `src/domain/venue-layout.ts` (bảng tọa độ 589 × 754); khi có dữ liệu thật thì đọc từ `pos_x/pos_y/width/height`                |
| `table_combinations`, `table_combination_members`                                      | Cấu hình ghép sẵn B1, B2, A6 dài (đang chờ xác nhận)                                                                                                         |
| `customers`                                                                            | Tên, `name_search`, `phone_last3`. **Không bao giờ trả số đầy đủ trong danh sách hay chi tiết**                                                              |
| `booking_sources`                                                                      | Nguồn booking: Hotline, Fanpage, Zalo, Cổ đông, Nhân viên...                                                                                                 |
| `reservations`                                                                         | Đặt bàn: tạo, sửa, hủy (có lý do), không đến (sau ngưỡng), check-in                                                                                          |
| `visits`                                                                               | Lượt ghé: walk-in mở thẳng, check-in tạo visit, kết thúc (nhả bàn), đã thanh toán. Báo cáo "lượt ghé" và "tổng khách" chỉ đếm từ bảng này                    |
| `waitlist_entries`, `waitlist_table_preferences`, `waitlist_contact_attempts`          | Danh sách chờ hai loại, bàn mong muốn, lần liên hệ, claim có lease                                                                                           |
| `table_holds`                                                                          | Giữ bàn cho booking (`RESERVATION`) và cho khách chờ (`WAITLIST_OFFER`) kèm hạn, gia hạn, nhả                                                                |
| `table_groups`                                                                         | Nhóm ghép với `symbol_no` duy nhất trong các nhóm chưa giải tán                                                                                              |
| `table_allocations`                                                                    | Append-only: mỗi lần ngồi, đổi, ghép, tách là một dòng mới. Timeline "Lịch bàn", lịch sử bàn, "lượt sử dụng bàn" trong báo cáo                               |
| `operation_log`                                                                        | Nhật ký thao tác, hoàn tác / làm lại bằng thao tác bù, "Hoạt động gần đây"                                                                                   |
| `idempotency_keys`                                                                     | Header `Idempotency-Key` trên mọi request ghi                                                                                                                |

## Số điện thoại

- Lễ tân chỉ nhận `phoneLast3`. Số đầy đủ chỉ có qua `POST /api/customers/:id/phone:reveal` (Chủ quán, bắt buộc lý do, ghi `operation_log`, trả `Cache-Control: no-store`).
- Frontend không đưa số đầy đủ vào cache truy vấn: kết quả reveal chỉ nằm trong state của đúng ô hiển thị, mất khi bấm "Ẩn" hoặc rời màn hình.
- Mock giới hạn 30 lần xem mỗi giờ cho một người dùng (`429`); backend nên áp giới hạn tương tự.
- Ghi chú bị chặn nếu chứa chuỗi 8 chữ số trở lên (`noteHasPhoneNumber` trong `src/lib/text.ts`); backend nên kiểm tra lại cùng quy tắc.

## Đồng bộ thời gian thực và hoàn tác

- Mock phát sự kiện thay đổi; bản HTTP thay bằng polling `GET /changes?since=SEQ` (db09). Mỗi sự kiện làm mới các query liên quan.
- Hoàn tác: `POST /api/operations/:id/undo` thực hiện thao tác bù, kiểm tra các bản ghi bị ảnh hưởng chưa bị sửa sau thao tác gốc (so `version`), nếu đã sửa thì trả `UNDO_CONFLICT_MODIFIED`.
- Job hệ thống chỉ **gắn cảnh báo** trễ/không đến (không tăng `version`, không hủy, không nhả bàn).

## Các điểm cần backend xác nhận

1. Danh sách endpoint `PROPOSED`.
2. Hình dạng `FloorState` và `AvailabilityResult` (`src/domain/models.ts`): trả sẵn trạng thái suy ra hay để frontend tự suy.
3. Đồng bộ: polling `changes` hay SSE.
4. Cột vị trí bàn đã có trong `dining_tables` chưa, hay giữ bố cục ở frontend.

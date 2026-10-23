# Thiết kế cơ sở dữ liệu prototype 21GAM

> Trạng thái: đây là schema prototype Sprint 0 đã có trước khi nhận tài liệu “Danh mục bảng & Hướng dẫn cài đặt MySQL 9.7.2”. Nó chưa phải schema GAM-APP Database v1.2 gồm 26 bảng. Không triển khai schema này lên database dev chính thức.

## Nguyên tắc

Database mục tiêu dùng MySQL 9.7.2 LTS và InnoDB. Docker chỉ là một cách chạy MySQL; API kết nối bằng các biến `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`. Không dùng XAMPP/MariaDB cho schema chính thức vì khác engine và hành vi constraint/collation.

Ngày nghiệp vụ khác ngày dương lịch: ca bắt đầu 17:00 và kết thúc 05:00 hôm sau. Mọi booking và trạng thái bàn đều mang `business_date`.

## Hai trục trạng thái

`bookings.status` mô tả hành trình của khách:

```text
PENDING_ASSIGNMENT → RESERVED → CONTACTED → LATE → NO_SHOW
                                      ↘ SEATED → COMPLETED
Mọi trạng thái phù hợp có thể chuyển sang CANCELLED bằng thao tác thủ công.
```

`table_daily_states.state` chỉ mô tả tài nguyên bàn:

```text
AVAILABLE → RESERVED → IN_USE → AVAILABLE
AVAILABLE → IN_USE → AVAILABLE
```

`is_backup` là cờ Bàn sơ cua. Cờ này chỉ được bật khi bàn đang `AVAILABLE`.

## Các nhóm bảng

- Tài khoản: `roles`, `users`.
- Sơ đồ: `areas`, `tables`, `table_combinations`, `table_combination_members`.
- Khách và booking: `customers`, `bookings`, `booking_tables`.
- Trạng thái theo ca: `table_daily_states`, `booking_status_history`, `table_state_history`.
- Nghiệp vụ mở rộng đã yêu cầu: `waiting_list_entries`, `action_logs`, `business_settings`.

## Vì sao không lưu trạng thái ngay trong `tables`

Một bàn có trạng thái khác nhau theo từng ngày nghiệp vụ. Nếu lưu `status` trực tiếp trong `tables`, khi chuyển ngày sẽ mất lịch sử hoặc phải reset toàn bộ bàn. Khóa chính `(business_date, table_id)` của `table_daily_states` giải quyết việc này và cho phép xem trước booking của ngày tương lai.

## Ghép bàn

Một booking liên kết nhiều bàn thông qua `booking_tables`. Các tổ hợp thường dùng như `A6 + A7` và `B11 + B12` được lưu riêng để giao diện gợi ý, nhưng booking vẫn tham chiếu từng bàn vật lý. Cách này giúp kiểm tra xung đột chính xác và không cần tạo mã bàn giả cho mỗi tổ hợp.

## Bảo mật số điện thoại

Database tách `phone_encrypted` và `phone_last3`. Lễ tân chỉ tìm/xem ba số cuối; API Admin mới được giải mã số đầy đủ. Khóa mã hóa không được lưu trong database hoặc commit vào Git.

## Undo và Redo

`action_logs` lưu thiết bị, người thao tác, dữ liệu trước/sau và thời điểm hoàn tác. Điều này đáp ứng quy tắc mỗi thiết bị chỉ hoàn tác thao tác gần nhất do chính thiết bị đó tạo.

## Chạy migration

```powershell
pnpm --filter @21gam/api db:migrate
```

Migration được chạy theo thứ tự tên file và ghi nhận trong bảng `schema_migrations`. Không sửa migration đã chạy; thay đổi schema bằng migration mới.


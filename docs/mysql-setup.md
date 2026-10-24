# Đối chiếu hướng dẫn MySQL 9.7.2

Ngày đối chiếu: 23/10/2026.

## Kết luận

MySQL 9.7 là dòng LTS và image chính thức `mysql:9.7.2` tồn tại. Dự án khóa đúng 9.7.2 để đồng nhất với máy Nam, dù Oracle đã phát hành bản vá 9.7.4 ngày 20/10/2026.

Docker không bắt buộc theo tài liệu. Compose là cách cô lập môi trường dev; cấu hình bảo mật tương đương cài Windows: host chỉ publish `127.0.0.1:3306`, X Protocol tắt và root chỉ tồn tại tại `localhost`.

## Ma trận tuân thủ

| Yêu cầu | Trạng thái | Bằng chứng / vị trí |
| --- | --- | --- |
| MySQL 9.7.2 | Đạt, đã xác minh image | `compose.yaml` |
| Chỉ nghe từ máy local | Đạt | Port Docker bind `127.0.0.1` |
| Tắt X Protocol | Đạt | `--mysqlx=OFF`; không có listener 33060 |
| utf8mb4 / utf8mb4_0900_ai_ci | Đạt | Tham số `mysqld` đã qua `--validate-config` |
| SQL mode nghiêm ngặt | Đạt | Tham số `mysqld` đã qua `--validate-config` |
| REPEATABLE READ mặc định | Đạt | Đã đọc system variable trên instance tạm |
| ROW binlog | Đạt | Đã đọc system variable trên instance tạm |
| Native FK bật | Đạt | `@@innodb_native_foreign_keys = 1` |
| Không có `root@'%'` | Đạt cho datadir mới | `MYSQL_ROOT_HOST=localhost` đã kiểm chứng |
| mysql2 UTC, utf8mb4, BIGINT string | Đạt | `api/src/database/pool.ts` |
| Transaction ghi READ COMMITTED | Đạt cho repository hiện có | `api/src/modules/tables/table.repository.ts` |
| dbmate 2.36.0 | Đạt | `.tools/dbmate.exe`, checksum khớp tài liệu; file được Git ignore |
| Tách `gam_migrator` / `gam_app` | Chưa hoàn tất | Dev tạm dùng user `gam21`; production phải tách tài khoản migration và API |
| Migration schema v1.2 / 26 bảng | Đạt | `api/database/migrations/0001_initial_schema.sql` |
| Seed demo có guard | Đạt | `api/database/seeds/demo.sql`; đã kiểm chứng dựng lại database trắng |

## Sai khác phát hiện trong hướng dẫn

Trên MySQL 9.7.2 chính thức, `SELECT @@mysqlx` trả lỗi `Unknown system variable 'mysqlx'`. Việc tắt X Protocol phải kiểm tra bằng cấu hình khởi động và xác nhận không có listener cổng 33060.

Trong container, `bind-address=0.0.0.0` là cần thiết để Docker port forwarding hoạt động. Giới hạn truy cập được thực thi ở host bằng mapping `127.0.0.1:3306:3306`; vì vậy máy khác vẫn không truy cập được.

## File còn thiếu để triển khai production

Cần nhận nguyên bản các file sau, không dựng lại từ bảng mô tả:

- `verification/fk_lint.sql`.
- Hai bộ test database được nhắc trong tài liệu.
- Quyền theo từng bảng cho `gam_app` (doc 08 §8).

Khi có đủ file và xác nhận triển khai database dev, quy trình là:

```powershell
Copy-Item .env.dbmate.example .env
.\.tools\dbmate.exe migrate --strict
.\.tools\dbmate.exe dump -- --set-gtid-purged=OFF
```

Không chạy các lệnh này bằng tài khoản ứng dụng và không lưu mật khẩu thật vào Git.

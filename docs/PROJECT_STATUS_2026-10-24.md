# BÁO CÁO TỔNG HỢP DỰ ÁN 21GAM

> Ngày chốt trạng thái: 24/10/2026\
> Người tiếp nhận: Tường Duy Minh Tú\
> Nhánh triển khai hiện tại: `main`

## 1. Tóm tắt điều hành

21GAM là phần mềm quản lý vận hành nội bộ quán bar. Phạm vi ưu tiên hiện tại là **Module Lễ tân - Đặt bàn**, không phải website giới thiệu và chưa phải hệ thống bán hàng hoàn chỉnh.

Đến ngày 24/10/2026, dự án đã được dựng lại trên nền tảng mới, kết nối với schema MySQL chính thức GAM-APP v1.2, nhập dữ liệu demo, hiển thị sơ đồ bàn từ database và chạy được luồng booking cơ bản từ giao diện đến API và database.

Trạng thái tổng quát:

- Nền tảng kỹ thuật, Docker MySQL, migration và seed: **đã hoạt động**.
- Sơ đồ bàn và danh sách booking lấy dữ liệu thật từ API/database: **đã hoạt động**.
- Luồng tạo booking, gán bàn, check-in, hủy, no-show và tạo walk-in: **đã hoạt động ở mức MVP**.
- Bàn sơ cua A10, C4, C5: **là cấu hình cố định trong database**.
- Các chức năng vận hành đầy đủ cho một ca thật như sửa booking, tìm khách, trả bàn, xuất text và đồng bộ nhiều máy: **chưa hoàn thiện**.
- Các module Thu ngân, Order, Kho, Báo cáo và tích hợp thuế: **chưa triển khai**.

## 2. Mục tiêu và phạm vi nghiệp vụ

### Mục tiêu gần nhất

Xây dựng công cụ cho Lễ tân để:

- Nhận booking từ hotline, Fanpage, nhân viên hoặc cổ đông.
- Xem sơ đồ bàn theo ngày nghiệp vụ.
- Tạo và cập nhật booking.
- Tra cứu khách theo tên hoặc ba số cuối số điện thoại.
- Gán một hoặc nhiều bàn cho booking.
- Xử lý khách đến, khách đến trễ, no-show, hủy và khách walk-in.
- Đổi bàn, ghép bàn và giải phóng bàn khi khách kết thúc lượt.
- Xuất danh sách booking dạng text để gửi Zalo/Facebook.

### Quy ước ngày nghiệp vụ

Một ngày làm việc của quán bắt đầu lúc 17:00 và kết thúc lúc 05:00 sáng hôm sau. Booking, lượt khách và phân bổ bàn phải được gắn với `business_date`, không chỉ dựa vào ngày dương lịch.

### Phạm vi tương lai

- Phục vụ/Bartender: mở bàn và ghi nhận order.
- Thu ngân: tính tiền và xuất hóa đơn từ sơ đồ bàn.
- Kho: quản lý nhập/xuất, định lượng và nhà cung cấp.
- Chủ đầu tư/Quản lý: xem sơ đồ và báo cáo tổng quan.
- Tích hợp IPOS, hóa đơn điện tử và quy trình thuế.
- Trình chỉnh sửa sơ đồ bàn bằng kéo thả.

## 3. Kiến trúc hiện tại

```text
Trình duyệt của Lễ tân
        |
        | HTTP/JSON
        v
React 19 + Vite 8 (cổng 5173)
        |
        v
Express 5 + Node.js 24 (cổng 3000)
        |
        v
MySQL 9.7.2 trong Docker (cổng 3306, chỉ bind localhost)
```

Thành phần chính:

| Thành phần | Công nghệ | Vai trò |
| --- | --- | --- |
| Web | React, TypeScript, Vite | Giao diện sơ đồ bàn và thao tác booking |
| API | Node.js, Express, TypeScript | Kiểm tra nghiệp vụ và truy cập dữ liệu |
| Database | MySQL 9.7.2, InnoDB | Lưu cấu hình bàn, khách, booking, lượt khách và nhật ký |
| Môi trường dev | Docker Compose | Chạy MySQL nhất quán giữa các máy phát triển |
| Monorepo | pnpm workspace | Quản lý Web và API trong cùng repository |

Docker chỉ là cách đóng gói tiến trình MySQL ở môi trường phát triển. Web và API không phụ thuộc vào việc MySQL phải chạy bằng Docker; khi triển khai nhiều máy, API có thể kết nối đến một máy chủ MySQL dùng chung qua các biến môi trường.

## 4. Database hiện tại

### Nguồn schema chính thức

- Migration gốc: `api/database/migrations/0001_initial_schema.sql`.
- Phiên bản nghiệp vụ: GAM-APP v1.2.
- Schema gồm 26 bảng nghiệp vụ; bảng `schema_migrations` do trình chạy migration tạo thêm để ghi nhận lịch sử.
- Database phát triển đang dùng: `gam21_platform_dev`.
- Database cũ `gam21_dev` được giữ lại làm phương án đối chiếu, không còn là nguồn dữ liệu của ứng dụng hiện tại.

Các nhóm dữ liệu chính:

- Tổ chức và địa điểm: `organizations`, `venues`, `floors`, `zones`.
- Người dùng và phân quyền: `users`, `memberships`, `roles`, `permissions`.
- Sơ đồ: `dining_tables`, `table_combinations`, `table_combination_members`.
- Khách và booking: `customers`, `booking_sources`, `reservations`, `visits`.
- Chờ và liên hệ: `waitlist_entries`, `waitlist_table_preferences`, `waitlist_contact_attempts`.
- Giữ/gán bàn: `table_holds`, `table_groups`, `table_allocations`.
- An toàn vận hành: `operation_log`, `idempotency_keys`.

### Dữ liệu seed hiện có

Seed demo chứa:

- 44 vị trí bàn/ghế; 43 vị trí đang hoạt động vì BAR21 ở trạng thái ngừng phục vụ.
- 3 bàn sơ cua cố định: A10, C4 và C5.
- 20 hồ sơ khách demo.
- 32 booking mẫu, trong đó có dữ liệu cho ngày nghiệp vụ 24/10/2026.
- 39 lượt khách và 10 bản ghi danh sách chờ.

Seed chỉ dành cho database `_dev` hoặc `_test`, có guard chống chạy lặp. Không chạy seed trên database thật có dữ liệu vận hành.

### Cách trạng thái bàn hoạt động

Trạng thái hiển thị của bàn không được sửa trực tiếp và không được hardcode ở frontend. API suy ra trạng thái từ `table_allocations`:

```text
Không có allocation đang mở  -> AVAILABLE
Có allocation loại HOLD      -> RESERVED
Có allocation loại USAGE     -> IN_USE
```

Luồng booking hiện tại:

```text
Tạo reservation
    -> gán bàn và tạo HOLD
    -> khách check-in
    -> đóng HOLD, tạo visit và USAGE
    -> kết thúc visit
    -> đóng USAGE, bàn trở lại AVAILABLE
```

Bước **kết thúc visit/giải phóng bàn** chưa có endpoint và giao diện hoàn chỉnh, nên đây là một hạng mục ưu tiên cao.

### Bàn sơ cua cố định

`is_spare` là thuộc tính cấu hình của `dining_tables`, không phải trạng thái thay đổi theo ngày. API từ chối việc bật/tắt bàn sơ cua qua thao tác trạng thái hằng ngày. Cách này phù hợp với yêu cầu A10, C4 và C5 luôn là bàn sơ cua cố định.

## 5. Những việc đã hoàn thành

### Nền tảng và repository

- Xóa nền dự án cũ và dựng lại cấu trúc Web/API/Database.
- Thiết lập Node.js 24, pnpm workspace, React, Vite, Express và TypeScript.
- Cấu hình lint, typecheck, test và build.
- Đưa mã nguồn hiện tại lên nhánh `main` của GitHub.

### MySQL, migration và seed

- Cấu hình MySQL 9.7.2 bằng Docker Compose với volume lưu dữ liệu bền vững.
- Chạy migration GAM-APP v1.2 thành công.
- Nhập seed `demo.sql` có kiểm tra an toàn và chống chạy lặp.
- Kiểm tra khả năng dựng lại database sạch bằng migration + seed.
- Giữ bản sao database cũ và dump dự phòng trước khi chuyển đổi.
- Chuyển bàn sơ cua sang cấu hình cố định trong database.

### API booking

Các endpoint đã có:

| Phương thức | Endpoint | Trạng thái |
| --- | --- | --- |
| GET | `/api/v1/health` | Hoạt động |
| GET | `/api/v1/tables?date=YYYY-MM-DD` | Hoạt động |
| GET | `/api/v1/bookings?date=YYYY-MM-DD` | Hoạt động |
| POST | `/api/v1/bookings` | Hoạt động |
| POST | `/api/v1/bookings/:id/assign` | Hoạt động, nhận nhiều `tableIds` |
| POST | `/api/v1/bookings/:id/check-in` | Hoạt động |
| POST | `/api/v1/bookings/:id/cancel` | Hoạt động |
| POST | `/api/v1/bookings/:id/no-show` | Hoạt động |
| POST | `/api/v1/bookings/walk-ins` | Hoạt động |
| PATCH | `/api/v1/tables/:id/status` | Cố ý chặn sửa trực tiếp; trạng thái được suy ra từ allocation |

API sử dụng transaction và version để giảm nguy cơ hai thao tác đồng thời ghi đè lên nhau trong các luồng đã triển khai.

### Giao diện

- Chuyển giao diện sang dashboard mới theo ảnh tham chiếu.
- Sơ đồ bàn lấy vị trí, loại bàn, trạng thái và cờ sơ cua từ API.
- Danh sách booking lấy dữ liệu seed thật từ MySQL.
- Hỗ trợ chọn booking, chọn bàn, gán bàn, check-in, hủy và no-show.
- Hỗ trợ tạo booking và tạo khách walk-in trên bàn đang trống.
- Có giao diện tối/sáng và bố cục đáp ứng theo kích thước màn hình.
- Không còn dùng mảng booking/trạng thái bàn hardcode để giả lập luồng chính.

### Kiểm tra đã thực hiện

- Luồng tạo booking -> gán A0 -> check-in -> bàn chuyển IN_USE đã được chạy xuyên suốt Web/API/Database.
- Dữ liệu test của lần kiểm tra đã được dọn, số liệu seed trở về trạng thái ban đầu.
- `typecheck`, `lint`, `test` và `build` đã vượt qua tại mốc triển khai gần nhất.
- MySQL hiện `healthy`; API health đang phản hồi bình thường tại thời điểm lập báo cáo.

## 6. Những việc còn thiếu và mức độ ưu tiên

### P0 - Cần có trước khi dùng cho một ca vận hành thật

1. **Kết thúc lượt khách và trả bàn**\
   Đóng visit/USAGE, ghi thời điểm rời bàn và trả bàn về AVAILABLE. Nếu thiếu chức năng này, bàn đã check-in sẽ bị giữ ở IN_USE.

2. **Sửa booking**\
   Sửa tên, giờ đến, số khách, nguồn, ghi chú và bàn được gán; phải giữ version để tránh ghi đè dữ liệu từ máy khác.

3. **Tìm khách/booking**\
   Tìm theo tên và ba số cuối điện thoại như yêu cầu nghiệp vụ.

4. **Đổi bàn và gán nhiều bàn trên UI**\
   API đã nhận nhiều bàn nhưng giao diện chưa hoàn tất quy trình chọn nhiều bàn, đổi bàn và kiểm tra xung đột dễ hiểu.

5. **Xuất danh sách booking dạng text**\
   Xuất đúng mẫu khu A/B/C/Quầy bar, thống kê tổng bàn, tổng khách, khách quen/mới và các ký hiệu vận hành.

6. **Xác thực và phân quyền tối thiểu**\
   Seed có tài khoản kỹ thuật nhưng đăng nhập thật chưa được bật. Không nên đưa hệ thống ra mạng nội bộ rộng hoặc Internet khi chưa có đăng nhập.

7. **Kiểm thử tích hợp với MySQL thật**\
   Bổ sung test tự động cho xung đột bàn, thao tác đồng thời, check-in, hủy và trả bàn; test hiện tại chưa bao phủ đầy đủ luồng database.

### P1 - Hoàn thiện vận hành nhiều máy

- Đồng bộ thay đổi gần thời gian thực bằng polling có version/change sequence hoặc WebSocket.
- Dùng `idempotency_keys` để chống bấm lặp/tạo booking trùng khi mạng chập chờn.
- Ghi đầy đủ `operation_log`, hỗ trợ undo/redo theo người dùng và thiết bị.
- Hoàn thiện danh sách chờ và thao tác liên hệ khách.
- Xử lý đến sớm, đến muộn tự động và cảnh báo no-show.
- Hoàn thiện ghép/tách bàn, nhóm bàn và chuyển khách giữa các bàn.
- Mã hóa số điện thoại, lưu chỉ mục `phone_last3` phục vụ tìm kiếm và che dữ liệu trên UI.
- Tách tài khoản chạy migration khỏi tài khoản API; giới hạn quyền theo nguyên tắc tối thiểu.
- Thiết lập backup tự động, kiểm tra restore, log tập trung và giám sát lỗi.

### P2 - Các module tiếp theo

- Order cho Phục vụ/Bartender và tích hợp IPOS.
- Thu ngân, thanh toán, hóa đơn và đối soát.
- Kho, nguyên liệu, định lượng, nhập hàng và nhà cung cấp.
- Dashboard chỉ xem cho Chủ đầu tư/Quản lý.
- Báo cáo doanh thu, công suất bàn, nguồn khách và tỷ lệ no-show.
- Tích hợp hóa đơn điện tử/cơ quan thuế sau khi quy trình pháp lý được xác nhận.
- Trình dựng sơ đồ bàn kéo thả; trước đó tiếp tục dùng layout cố định đã duyệt.

## 7. Rủi ro và điểm chặn hiện tại

| Điểm chặn | Ảnh hưởng | Hướng xử lý |
| --- | --- | --- |
| Chưa có trả bàn/kết thúc visit | Bàn IN_USE không tự giải phóng | Ưu tiên endpoint và nút kết thúc lượt |
| Chưa có đăng nhập thật | Không xác định đúng người thao tác, rủi ro truy cập trái phép | Bật auth session và RBAC trước triển khai thật |
| Chưa đồng bộ nhiều máy | Hai lễ tân có thể nhìn trạng thái cũ | Polling/change sequence trước, WebSocket sau |
| Chưa có tìm kiếm và số điện thoại thật | Không đáp ứng luồng đón khách nhanh | Mã hóa số điện thoại + chỉ mục ba số cuối |
| Chưa có idempotency đầy đủ | Bấm lặp hoặc retry có thể tạo dữ liệu trùng | Bắt buộc idempotency key cho lệnh ghi |
| Tài khoản DB dev còn có quyền DDL | Nếu lộ tài khoản có thể thay đổi schema | Tách migrator và runtime account ở staging/production |
| Chưa có quy trình deploy/backup production | Khó khôi phục khi lỗi máy chủ | Dựng staging, backup và diễn tập restore |

## 8. Lộ trình đề xuất gần nhất

### Giai đoạn 1 - Đóng luồng booking vận hành

- Làm endpoint và UI kết thúc lượt/trả bàn.
- Làm sửa booking, tìm khách và xuất text.
- Hoàn thiện gán nhiều bàn, đổi/ghép bàn.
- Bổ sung test tích hợp và xử lý xung đột.

**Điều kiện hoàn thành:** Lễ tân có thể xử lý trọn vòng đời một booking mà không sửa database thủ công.

### Giai đoạn 2 - Sẵn sàng chạy thử nhiều máy trong quán

- Bật đăng nhập, RBAC và nhật ký thao tác.
- Bổ sung đồng bộ nhiều máy, idempotency và cảnh báo dữ liệu cũ.
- Mã hóa dữ liệu khách và hoàn thiện tìm kiếm ba số cuối.
- Triển khai một API server và một MySQL server dùng chung trong mạng nội bộ hoặc hạ tầng cloud/VPS riêng.
- Thiết lập backup, phục hồi và giám sát.

**Điều kiện hoàn thành:** Nhiều thiết bị cùng dùng một nguồn dữ liệu mà không ghi đè hoặc tạo booking trùng.

### Giai đoạn 3 - Mở rộng vận hành

- Hoàn thiện waitlist, báo cáo và dashboard quản lý.
- Tiếp tục lần lượt với Order, Thu ngân và Kho.
- Chỉ tích hợp IPOS/thuế sau khi có tài liệu API và yêu cầu pháp lý chính thức.

## 9. Cách chạy môi trường hiện tại

Yêu cầu: Node.js 24, pnpm 11 và Docker Desktop.

```powershell
Copy-Item .env.example .env
Copy-Item api/.env.example api/.env
Copy-Item web/.env.example web/.env
docker compose up -d mysql
pnpm install
pnpm --filter @21gam/api db:migrate
pnpm --filter @21gam/api db:seed
pnpm dev
```

Lưu ý:

- Chỉ chạy `db:seed` lần đầu trên database dev/test trống.
- Web: `http://localhost:5173`.
- API health: `http://localhost:3000/api/v1/health`.
- MySQL dev hiện chỉ lắng nghe ở `127.0.0.1:3306`, vì vậy máy khác không kết nối trực tiếp được. Khi triển khai nhiều máy, các máy trạm nên gọi chung một API; chỉ API truy cập MySQL.
- Không mở cổng MySQL trực tiếp ra Internet.

## 10. Tiêu chí để gọi là bản booking hoàn chỉnh

Bản booking chỉ nên được xem là hoàn chỉnh khi đạt đủ:

- Tạo, sửa, hủy, no-show và check-in booking.
- Gán, đổi, ghép và giải phóng bàn.
- Walk-in có hoặc không có thông tin khách.
- Tìm theo tên và ba số cuối số điện thoại.
- Xuất text đúng mẫu vận hành.
- Xử lý được hai máy cùng thao tác mà không ghi đè dữ liệu.
- Có đăng nhập, phân quyền và nhật ký thao tác.
- Có backup, restore và test các luồng quan trọng.
- Không cần sửa SQL thủ công trong một ca làm việc bình thường.

## 11. Kết luận

Dự án đã vượt qua giai đoạn dựng nền và đã có một MVP booking chạy xuyên suốt với database chính thức. Tuy nhiên, đây chưa phải bản sẵn sàng vận hành thật toàn diện. Trọng tâm tiếp theo không phải làm thêm giao diện trang trí, mà là đóng kín vòng đời booking, bảo đảm đồng bộ nhiều máy, bảo mật dữ liệu khách và thiết lập khả năng phục hồi hệ thống.

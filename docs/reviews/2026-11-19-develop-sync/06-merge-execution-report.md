# 06 — Báo cáo thực hiện merge

> Ngày thực hiện: 19/11/2026, Asia/Saigon  
> Nhánh đích: `feature/TU-38-turn-statistics-api`  
> Nguồn merge: `origin/develop@1ccf73c`  
> Không push remote trong quá trình thực hiện.

## 1. Điểm khôi phục

- Commit checkpoint toàn bộ working tree: `cec3c12` — `chore: checkpoint local work before develop merge`.
- Nhánh backup: `codex/backup-pre-develop-merge-20261119`.
- Commit TU-38 mới xuất hiện trước merge và được bảo vệ: `ceb6aa7` — seed tài khoản OWNER cho E2E.
- Working tree đã sạch trước khi chạy merge.

## 2. Kết quả merge

Git tự ghép phần lớn 171 file từ develop và báo 9 conflict nội dung:

1. `web/src/features/admin/admin-shell.tsx`
2. `web/src/features/floor/floor-canvas.tsx`
3. `web/src/features/floor/floor-timeline.tsx`
4. `web/src/features/floor/shift-panel.tsx`
5. `web/src/features/floor/status-legend.tsx`
6. `web/src/features/floor/table-icons.tsx`
7. `web/src/features/floor/turn-badge.tsx`
8. `web/src/features/mobile/mobile-app.tsx`
9. `web/src/features/turns/turn-ledger-page.tsx`

Toàn bộ marker conflict đã được loại bỏ và các file đã được format lại bằng Prettier.

## 3. Quyết định xử lý conflict

| File | Phần giữ từ local | Phần nhận từ develop |
|---|---|---|
| `admin-shell.tsx` | `useBusinessShift`, nhãn ca và business date theo cấu hình venue | Shell/header/drawer, motion và responsive layout mới |
| `floor-canvas.tsx` | Cách ẩn/co danh sách khách bar trên điện thoại và callback chọn bàn | Read-only floor map, ẩn tên khách theo quyền và visual geometry mới |
| `floor-timeline.tsx` | Số giờ, nhãn giờ và mốc bắt đầu/kết thúc lấy từ ca cấu hình | Border, typography và token giao diện mới |
| `shift-panel.tsx` | `fmtBusinessShift(shift)`, không hardcode `17:00 → 05:00` | Typography và card layout mới |
| `status-legend.tsx` | Nội dung chú giải nghiệp vụ đầy đủ | Refactor thành component dùng chung, biến thể Admin/mobile, focus restore và motion prewarm |
| `table-icons.tsx` | Kích thước HTML compact `3.5/8.5px` | Geometry constants, step/radius/stroke động và SVG alignment mới |
| `turn-badge.tsx` | Typography HTML compact `9px` | Badge chỉ từ lượt 2, pill nhiều chữ số và geometry constants mới |
| `mobile-app.tsx` | `useBusinessShift`, cutoff và business date động | Motion prewarm, overlay lifecycle và layout mobile mới |
| `turn-ledger-page.tsx` | Nhãn ca động truyền vào biểu đồ ngày | Root reveal ref và wrapper `data-turns-reveal` mới |

## 4. Rà soát auto-merge

- `web/package.json` giữ script `e2e:mobile` local và nhận `@gsap/react`, `gsap`, font từ develop.
- Các màn Shell, Floor, Reservations, Waitlist, Overview và Settings vẫn gọi `useBusinessShift`/`shiftHour` theo TU-38.
- `shift-overview-selectors.ts` vẫn giữ hàm tính business date nhận `BusinessShift`, mặc dù develop đã rút gọn lớn file này.
- Không còn chuỗi `17:00 → 05:00` dùng làm giá trị production trong các file conflict; các giá trị còn lại nằm ở placeholder, comment hoặc test fixture.
- `TurnsDailyChart` vẫn bắt buộc nhận `shiftLabel`; trang Sổ lượt truyền nhãn ca từ venue configuration.

## 5. Kết quả xác minh

| Kiểm tra | Kết quả |
|---|---|
| Frontend TypeScript `tsc -b --noEmit` | Đạt |
| Backend TypeScript `tsc -p tsconfig.json --noEmit` | Đạt |
| 10 suite trọng yếu sau conflict | 189/189 test đạt |
| Toàn bộ frontend unit test | 76 file, 993/993 test đạt |
| Frontend lint | Không lỗi; còn 18 warning React/Fast Refresh hiện hữu |
| Prettier trên 9 file conflict | Đạt |
| Frontend production build | Đạt, 3.158 module transformed |

## 6. Cảnh báo không chặn merge

- Môi trường đang chạy Node `25.8.0`, trong khi workspace cảnh báo mong muốn Node `>=24 <25`; typecheck, test và build vẫn đạt.
- Vite cảnh báo `waitlist-page.tsx` vừa được import động vừa import tĩnh; đây không phải lỗi build.
- Chưa chạy E2E trình duyệt cần server/database thật trong bước merge này.
- Chưa push nhánh hoặc merge commit lên remote.

## 7. Kết luận

Kết quả merge giữ lại data contract và logic ca vận hành TU-38, đồng thời nhận design foundation, GSAP motion, UI Admin/Lễ tân và test mới từ develop. Các kiểm tra tĩnh, unit test và production build đều đạt; E2E môi trường thật là bước xác minh tiếp theo nếu cần trước khi push.

# GAM Dashboard v2 → 21gam-platform

Chép đè thư mục này lên `GAM-APP/21gam-platform/` (cùng cấu trúc đường dẫn), rồi:

```bash
npm install            # đổi font Be Vietnam Pro -> Roboto (@fontsource/roboto)
npm run check          # typecheck + lint + format + test
npm run dev
```

## File thay đổi

- `package.json` — thay `@fontsource/be-vietnam-pro` bằng `@fontsource/roboto`
- `public/21gam-logo.png` — logo thanh bên (mới)
- `src/index.css` — token v2: primary xanh, radius 2px, 3 tầng chữ `--tx-*`, ink pha oklab, text-sm = 13px, tabular-nums
- `src/app/nav.ts` — menu v2 (Điều phối, Đặt bàn, Chờ, Khách, Báo cáo, Cài đặt)
- `src/app/shell.tsx` — header v2 (tài khoản + "Theo dõi đơn đặt bàn" bên trái; chuông cảnh báo, danh tính bên phải), thanh bên 64px
- `src/state/ui.ts` — thêm `view: "list" | "timeline" | "map"`
- `src/features/floor/floor-toolbar.tsx` — tab Danh sách/Thời gian/Sơ đồ, chọn ngày, Walk-in, Tạo đặt bàn
- `src/features/floor/floor-page.tsx` — bố cục 3 cột v2
- `src/features/floor/booking-list.tsx` (mới) — danh sách booking bên trái + bảng ở chế độ Danh sách
- `src/features/floor/floor-timeline.tsx` (mới) — chế độ Thời gian
- `src/features/floor/shift-panel.tsx` (mới) — cột phải: KPI ca + danh sách chờ
- `src/features/floor/quick-form.tsx` (mới) — form v2 ngay trong cột phải: tab Đặt bàn / Walk-in, SĐT + tên, ngày (7 ngày), giờ 15', số khách, nguồn đặt, **chọn bàn bằng cách chạm sơ đồ** (sơ đồ chuyển sang khả dụng theo giờ của đơn), gợi ý bàn vừa chỗ, dòng sức chứa, mốc cảnh báo muộn / không đến, kiểm tra lỗi. Lưu: Đặt bàn → `createReservation`; Walk-in có bàn → `seatWalkIn`; Walk-in chưa có bàn → danh sách chờ.
- `src/state/ui.ts` — thêm `draft` (`setDraft`, `toggleDraftTable`, `switchDraft`); `openBooking` / `openWalkIn` tạo draft, nên mọi nút cũ (toolbar, chi tiết bàn "Đặt trước", bảng khả dụng) đều mở form inline khi đang ở Điều phối.
- `src/app/shell.tsx` — Sheet đặt bàn / Walk-in cũ chỉ còn dùng ở các trang khác (Đặt bàn, Tổng quan).
- `e2e/flows.mjs` — cập nhật theo form mới (đã sửa sẵn, chép đè là xong) + thêm 1 flow chọn bàn trên sơ đồ.

## Có thể xoá

- `src/features/floor/service-panel.tsx` — không còn được import.

## Còn thiếu ở API

- `WalkInInput` chưa có `phone` / `note`, nên form Walk-in chưa có hai ô này (đánh dấu `shortcut:` trong `quick-form.tsx`).

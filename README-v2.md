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

## Có thể xoá
- `src/features/floor/service-panel.tsx` — không còn được import.

## Sửa e2e/flows.mjs (2 chỗ)
Toolbar mới không còn toggle "Live / Khả dụng", và header có nút "Theo dõi đơn đặt bàn" nên `name: "Đặt bàn"` khớp nhầm.

1. Flow `validation: booking needs name or phone…`:
```diff
-  await page.getByRole("button", { name: "Đặt bàn" }).first().click()
+  await page.getByRole("button", { name: "Tạo đặt bàn" }).click()
```
2. Flow `availability tomorrow…`:
```diff
-  if ((await page.getByRole("radio", { name: "Khả dụng" }).getAttribute("aria-checked")) !== "true")
-    throw new Error("stepping the date should switch to Khả dụng")
+  await page.getByRole("status").filter({ hasText: "Xem trước" }).waitFor()
```

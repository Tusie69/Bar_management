# 02 — Phân tích commit mới trên develop

## 1. Danh tính commit

| Thuộc tính | Giá trị |
|---|---|
| Commit | `1ccf73ca4e7be5661097236fa0added989b95471` |
| Parent | `46f071d6fd7cc63ac8517f264b48e06e1afb5704` |
| Tác giả | Doirangmuoi |
| Thời gian | 19/11/2026 16:36:01 +07:00 |
| Tiêu đề | `feat(ui): redesign Admin và Lễ tân theo Apple design + GSAP (#15)` |
| Quy mô | 171 file, +20.952/−5.629 dòng |

Đây là squash commit của PR #15. Phạm vi rộng hơn một thay đổi theme: commit thay design foundation, motion/lifecycle overlay, nhiều màn Admin/Lễ tân, state quick form và toàn bộ lớp kiểm thử liên quan.

## 2. Thay đổi nền tảng thiết kế và dependency

### `web/package.json`, `pnpm-lock.yaml`, `web/vite.config.ts`

- Thêm `@gsap/react@2.1.2` và `gsap@3.15.1`.
- Giữ `@fontsource/be-vietnam-pro`, chuyển về vị trí chuẩn trong dependency list.
- Lockfile tăng 22 dòng để khóa dependency mới.
- Vite tách GSAP thành chunk riêng, tránh trộn vào vendor chunk chung.

### `web/src/styles/tokens.css` và `web/src/index.css`

- Thêm 329 dòng design token dùng chung.
- Định nghĩa typography scale, spacing, responsive gutter, radius 6–20px, z-index và shadow.
- Thêm duration/easing cho press, hover, section, dialog, sheet và exit.
- Có fallback/reduced-motion, reduced-transparency và high-contrast.
- `index.css` import token mới, đổi hệ radius cũ 2px sang scale mới và mở rộng màu/border/scrim.
- Dark-mode selector loại trừ phạm vi Admin để Admin giữ light-only theme.

Tác động: gần như mọi primitive UI và màn hình bị ảnh hưởng về kích thước, bo góc, focus ring, shadow và animation.

## 3. Hạ tầng motion và overlay

Bốn file mới trong `web/src/lib/` tạo một lớp motion dùng chung:

| File | Vai trò |
|---|---|
| `motion.ts` | Token/easing, presence state, lazy-load controller, fallback khi controller chưa tải. |
| `motion-controller.tsx` | React controller điều khiển enter/exit của dialog và sheet. |
| `motion-matchmedia.ts` | GSAP timeline, `matchMedia`, reduced-motion và cleanup. |
| `motion.test.ts` | 541 dòng test cho lifecycle, media preference và timeline. |

Điểm đáng chú ý:

- Overlay được giữ mounted trong exit animation thay vì biến mất ngay.
- Controller được lazy-load và có prewarm khi người dùng thể hiện intent.
- Nếu tải chậm quá 250ms, UI hiển thị fallback để tránh flash 1→0→1.
- Khi đổi `prefers-reduced-motion` lúc overlay đang mở, timeline được đưa về endpoint ổn định thay vì chạy lại.
- Dialog và sheet có timeline riêng; sheet hỗ trợ bốn hướng.

## 4. Primitive UI dùng chung

31 file trong `web/src/components/` được chỉnh. Nhóm thay đổi lớn nhất gồm:

- `alert-dialog.tsx`, `dialog.tsx`, `sheet.tsx`: tích hợp presence/motion lifecycle mới.
- `button.tsx`, `input.tsx`, `select.tsx`, `checkbox.tsx`, `switch.tsx`, `radio-group.tsx`: chuẩn hóa touch target, focus, radius và state.
- `popover.tsx`, `dropdown-menu.tsx`, `tooltip.tsx`: áp dụng surface animation và token mới.
- `card.tsx`, `table.tsx`, `tabs.tsx`, `badge.tsx`, `skeleton.tsx`: chuyển visual style sang foundation mới.
- `dialogs.tsx`, `booking-pickers.tsx`, `common.tsx`: điều chỉnh wrapper/markup dùng chung nên có tác động xuyên nhiều màn hình.

Vì đây là component nền, xung đột logic có thể không xuất hiện ở Git nhưng vẫn tạo regression hình ảnh hoặc focus ở các màn local.

## 5. Admin

13 file Admin thay đổi, tập trung vào shell, account management và audit:

- `admin-shell.tsx`: thay sidebar/header/drawer, breakpoint và interaction; đây là file xung đột trực tiếp với TU-38.
- `admin-theme.css`: +243/−177, viết lại đáng kể token và layout Admin.
- `admin-motion.ts`: rút logic motion cũ và kết nối hạ tầng mới; test cũ `admin-motion.test.ts` bị xóa.
- `accounts-page.tsx`: +425/−211, redesign danh sách, permission panel và trạng thái thao tác.
- `accounts-password-dialog.tsx`: +134/−66, đổi flow/dialog reset password; thêm test 524 dòng.
- `audit-page.tsx`: +144/−83, đổi filter, row và layout; thêm test 105 dòng.
- Thêm test cho account page và auth pages.

## 6. Sơ đồ bàn và Lễ tân desktop

30 file `features/floor` thay đổi. Các điểm lớn:

- `floor-canvas.tsx`: +332/−115; thay render sơ đồ, visual state, group/frame và interaction.
- `floor-canvas.test.ts`: +1.124/−23; coverage tăng mạnh cho các quy tắc mới.
- `floor-visual-rules.ts`: +548/−119; viết lại lớn quy tắc hiển thị/trạng thái bàn.
- `status-legend.tsx`: +375/−196; redesign chú giải và controls.
- `bar-guest-list.tsx`: +108/−72; điều chỉnh danh sách khách bar, nhãn ghế và layout/action.
- `bar-guest-rows.ts`: thêm xử lý/format nhãn ghế bar và test tương ứng.
- `bottom-panel-snapshot.ts`: file mới để giữ snapshot dữ liệu ổn định cho panel dưới.
- `quick-form-focus.ts`: file mới quản lý focus khi mở/chuyển form.
- `quick-form.tsx`, `floor-page.tsx`, `floor-toolbar.tsx`, `shift-panel.tsx`, `table-detail.tsx`: đều thay đổi và đồng thời chồng với code TU-38 đã commit.
- `turn-badge.tsx`, `table-icons.tsx`, `status-legend.tsx`, `floor-canvas.tsx`, `bar-guest-list.tsx`: đồng thời chồng với thay đổi chưa commit ở local.

## 7. Lễ tân mobile

21 file mobile thay đổi:

- Thêm flow hủy booking gồm `cancel-booking-dialog.tsx`, `cancel-booking.ts` và test.
- `domain/enums.ts` thêm `BookingCancelReason`, tái sử dụng label hiện có và loại `NO_SHOW_CONFIRMED`.
- Thêm `overlay-focus.ts` và test lifecycle 844 dòng để quản lý focus/restore focus.
- Thêm `quick-form-presence.ts` để giữ form qua exit animation và chuyển loại form.
- `state/ui.ts` giữ party size khi chuyển Đặt bàn ↔ Walk-in trong cùng phiên, nhưng reset sau khi đóng.
- `map.tsx`, `mobile-app.tsx`, `overlays.tsx`, `form.tsx`, `mobile.css` đều được viết lại đáng kể.
- `note-phone-privacy.ts` thêm quy tắc riêng tư cho ghi chú/số điện thoại.

`mobile-app.tsx` là một trong năm xung đột merge chắc chắn với phần TU-38 đã commit.

## 8. Tổng quan ca và Sổ lượt

### Shift Overview

- 13 file thay đổi.
- `shift-overview-selectors.ts` giảm 232 dòng và chỉ thêm 1 dòng: nhiều kiểu/hàm tính toán cũ bị loại khỏi file này.
- `shift-overview.css` +328/−225, thay đổi lớn visual/layout.
- Thêm helper/test reveal.
- Page, KPI, occupancy, floor và alerts được chỉnh theo layout mới.
- Selector và page đang chồng với logic ca vận hành TU-38 nên cần review theo hành vi, không chỉ giải quyết cú pháp.

### Turns

- 10 file thay đổi.
- `turns.css` +725/−297, redesign lớn toàn màn Sổ lượt.
- `turns-history-table.tsx`, customer history cards và ledger page thay markup/interaction đáng kể.
- Thêm helper/test reveal.
- `turn-ledger-page.tsx` là xung đột chắc chắn với TU-38.

## 9. Auth, booking, reservations và các màn còn lại

- Sáu file Auth được redesign; thêm test tổng hợp 114 dòng.
- Shell ứng dụng đổi menu/thông báo và markup.
- Booking call/history, reservation sheet/detail/list, waitlist và settings được chỉnh theo primitive/theme mới.
- Các màn overview, reports, guests nhận thay đổi nhỏ hơn nhưng vẫn có khả năng chịu tác động từ component dùng chung.

## 10. E2E và test fixture

- 20 file E2E được thêm/sửa.
- Các suite mới lớn nhất: Admin floor map 1.311 dòng, motion lifecycle 1.090 dòng, quick-form switch 384 dòng và visual redesign 402 dòng.
- `sprint2-booking-http.mjs` thay +779/−531, cho thấy selector/flow HTTP booking bị chỉnh sâu.
- `api/test/support/phase2b-e2e-fixture.ts` thay +235/−79 để cấp dữ liệu phù hợp cho flow mới; production API không bị commit develop này sửa.

## 11. Tài liệu và phạm vi không đổi

- `docs/frontend.md` bị rút 46 dòng và thêm 11 dòng để cập nhật hướng dẫn.
- Không có migration/database production mới trên develop commit này.
- Không có thay đổi production backend ngoài frontend-facing test fixture.
- Danh sách đủ từng file, trạng thái và số dòng nằm trong [04-full-develop-file-inventory.md](04-full-develop-file-inventory.md).

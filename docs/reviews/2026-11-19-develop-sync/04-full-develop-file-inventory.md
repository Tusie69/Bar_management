# Phụ lục A — Kiểm kê đầy đủ commit mới trên develop

> Nguồn: `git diff origin/develop^..origin/develop`  
> Commit: `1ccf73ca4e7be5661097236fa0added989b95471`  
> Tổng: 171 file · 31 thêm · 139 sửa · 1 xóa · +20.952/−5.629 dòng.

Quy ước: `A` = thêm, `M` = sửa, `D` = xóa. Mô tả là kết quả đọc diff và phân loại theo module; số dòng được lấy trực tiếp từ Git.

| Trạng thái | File | + | − | Thay đổi/ý nghĩa |
|---|---|---:|---:|---|
| M | `api/test/support/phase2b-e2e-fixture.ts` | 235 | 79 | Mở rộng fixture E2E Phase 2B để phục vụ dữ liệu và luồng UI mới; không đổi production API. |
| M | `docs/frontend.md` | 11 | 46 | Rút gọn/cập nhật hướng dẫn frontend theo kiến trúc và giao diện mới. |
| M | `pnpm-lock.yaml` | 22 | 0 | Khóa dependency mới cho GSAP và font. |
| M | `web/e2e/a11y.mjs` | 53 | 30 | Điều chỉnh E2E, selector hoặc flow để khớp giao diện/hành vi mới. |
| A | `web/e2e/admin-floor-map.mjs` | 1311 | 0 | E2E mới cho sơ đồ bàn chỉ đọc trong Admin. |
| M | `web/e2e/auth.mjs` | 27 | 22 | Điều chỉnh E2E, selector hoặc flow để khớp giao diện/hành vi mới. |
| M | `web/e2e/c1-table-group-mobile.mjs` | 17 | 10 | Điều chỉnh E2E, selector hoặc flow để khớp giao diện/hành vi mới. |
| M | `web/e2e/c2-table-turn-mobile.mjs` | 63 | 25 | Điều chỉnh E2E, selector hoặc flow để khớp giao diện/hành vi mới. |
| M | `web/e2e/flows.mjs` | 31 | 47 | Điều chỉnh E2E, selector hoặc flow để khớp giao diện/hành vi mới. |
| M | `web/e2e/late-confirm.mjs` | 24 | 22 | Điều chỉnh E2E, selector hoặc flow để khớp giao diện/hành vi mới. |
| M | `web/e2e/milestone-a.mjs` | 67 | 53 | Điều chỉnh E2E, selector hoặc flow để khớp giao diện/hành vi mới. |
| M | `web/e2e/na11-http.mjs` | 117 | 82 | Điều chỉnh E2E, selector hoặc flow để khớp giao diện/hành vi mới. |
| M | `web/e2e/p1-merge.mjs` | 34 | 21 | Điều chỉnh E2E, selector hoặc flow để khớp giao diện/hành vi mới. |
| A | `web/e2e/p1-motion-lifecycle.mjs` | 1090 | 0 | E2E mới cho lifecycle motion, overlay và reduced-motion. |
| M | `web/e2e/p4-batch2.mjs` | 84 | 36 | Điều chỉnh E2E, selector hoặc flow để khớp giao diện/hành vi mới. |
| A | `web/e2e/p4-quick-form-switch.mjs` | 384 | 0 | E2E mới cho chuyển đổi Đặt bàn ↔ Walk-in. |
| M | `web/e2e/phase2b-booking.mjs` | 120 | 58 | Điều chỉnh E2E, selector hoặc flow để khớp giao diện/hành vi mới. |
| M | `web/e2e/reception-ui-refinement.mjs` | 747 | 59 | Điều chỉnh E2E, selector hoặc flow để khớp giao diện/hành vi mới. |
| A | `web/e2e/redesign-compare.mjs` | 93 | 0 | Kịch bản so sánh giao diện redesign. |
| A | `web/e2e/redesign-motion.mjs` | 287 | 0 | Kịch bản xác minh motion của redesign. |
| A | `web/e2e/redesign-visual.mjs` | 402 | 0 | Kịch bản visual regression cho redesign. |
| M | `web/e2e/security-acceptance.mjs` | 60 | 24 | Điều chỉnh E2E, selector hoặc flow để khớp giao diện/hành vi mới. |
| M | `web/e2e/sprint2-booking-http.mjs` | 779 | 531 | Điều chỉnh E2E, selector hoặc flow để khớp giao diện/hành vi mới. |
| M | `web/package.json` | 4 | 2 | Thêm `@gsap/react`, `gsap`; chuẩn hóa vị trí `@fontsource/be-vietnam-pro`. |
| M | `web/src/app/shell-alerts-bell.test.ts` | 2 | 2 | Cập nhật/bổ sung kiểm thử cho hành vi và markup mới của module tương ứng. |
| M | `web/src/app/shell.tsx` | 89 | 44 | Điều chỉnh application shell/menu/thông báo theo redesign. |
| M | `web/src/components/bar-chart.tsx` | 12 | 10 | Điều chỉnh component dùng chung theo visual token, layout hoặc interaction mới. |
| M | `web/src/components/booking-pickers.tsx` | 31 | 35 | Điều chỉnh component dùng chung theo visual token, layout hoặc interaction mới. |
| M | `web/src/components/common.tsx` | 22 | 8 | Điều chỉnh component dùng chung theo visual token, layout hoặc interaction mới. |
| M | `web/src/components/dialogs.tsx` | 53 | 16 | Điều chỉnh component dùng chung theo visual token, layout hoặc interaction mới. |
| M | `web/src/components/reveal-phone.tsx` | 2 | 2 | Điều chỉnh component dùng chung theo visual token, layout hoặc interaction mới. |
| M | `web/src/components/status.tsx` | 3 | 7 | Điều chỉnh component dùng chung theo visual token, layout hoặc interaction mới. |
| M | `web/src/components/ui/alert-dialog.tsx` | 93 | 13 | Chuẩn hóa primitive UI theo token mới, touch target, trạng thái và motion/accessibility. |
| M | `web/src/components/ui/badge.tsx` | 7 | 7 | Chuẩn hóa primitive UI theo token mới, touch target, trạng thái và motion/accessibility. |
| M | `web/src/components/ui/button.tsx` | 25 | 14 | Chuẩn hóa primitive UI theo token mới, touch target, trạng thái và motion/accessibility. |
| M | `web/src/components/ui/card.tsx` | 15 | 6 | Chuẩn hóa primitive UI theo token mới, touch target, trạng thái và motion/accessibility. |
| M | `web/src/components/ui/checkbox.tsx` | 10 | 4 | Chuẩn hóa primitive UI theo token mới, touch target, trạng thái và motion/accessibility. |
| M | `web/src/components/ui/dialog.tsx` | 94 | 14 | Chuẩn hóa primitive UI theo token mới, touch target, trạng thái và motion/accessibility. |
| M | `web/src/components/ui/dropdown-menu.tsx` | 21 | 14 | Chuẩn hóa primitive UI theo token mới, touch target, trạng thái và motion/accessibility. |
| M | `web/src/components/ui/field.tsx` | 1 | 1 | Chuẩn hóa primitive UI theo token mới, touch target, trạng thái và motion/accessibility. |
| M | `web/src/components/ui/input-group.tsx` | 3 | 3 | Chuẩn hóa primitive UI theo token mới, touch target, trạng thái và motion/accessibility. |
| M | `web/src/components/ui/input.tsx` | 6 | 3 | Chuẩn hóa primitive UI theo token mới, touch target, trạng thái và motion/accessibility. |
| M | `web/src/components/ui/label.tsx` | 2 | 2 | Chuẩn hóa primitive UI theo token mới, touch target, trạng thái và motion/accessibility. |
| M | `web/src/components/ui/popover.tsx` | 11 | 5 | Chuẩn hóa primitive UI theo token mới, touch target, trạng thái và motion/accessibility. |
| M | `web/src/components/ui/radio-group.tsx` | 10 | 4 | Chuẩn hóa primitive UI theo token mới, touch target, trạng thái và motion/accessibility. |
| M | `web/src/components/ui/select.tsx` | 19 | 11 | Chuẩn hóa primitive UI theo token mới, touch target, trạng thái và motion/accessibility. |
| M | `web/src/components/ui/sheet.tsx` | 98 | 19 | Chuẩn hóa primitive UI theo token mới, touch target, trạng thái và motion/accessibility. |
| M | `web/src/components/ui/sidebar.tsx` | 2 | 8 | Chuẩn hóa primitive UI theo token mới, touch target, trạng thái và motion/accessibility. |
| M | `web/src/components/ui/skeleton.tsx` | 7 | 1 | Chuẩn hóa primitive UI theo token mới, touch target, trạng thái và motion/accessibility. |
| M | `web/src/components/ui/sonner.tsx` | 16 | 7 | Chuẩn hóa primitive UI theo token mới, touch target, trạng thái và motion/accessibility. |
| M | `web/src/components/ui/switch.tsx` | 11 | 3 | Chuẩn hóa primitive UI theo token mới, touch target, trạng thái và motion/accessibility. |
| M | `web/src/components/ui/table.tsx` | 13 | 7 | Chuẩn hóa primitive UI theo token mới, touch target, trạng thái và motion/accessibility. |
| M | `web/src/components/ui/tabs.tsx` | 13 | 8 | Chuẩn hóa primitive UI theo token mới, touch target, trạng thái và motion/accessibility. |
| M | `web/src/components/ui/textarea.tsx` | 6 | 1 | Chuẩn hóa primitive UI theo token mới, touch target, trạng thái và motion/accessibility. |
| M | `web/src/components/ui/toggle-group.tsx` | 12 | 6 | Chuẩn hóa primitive UI theo token mới, touch target, trạng thái và motion/accessibility. |
| M | `web/src/components/ui/toggle.tsx` | 18 | 7 | Chuẩn hóa primitive UI theo token mới, touch target, trạng thái và motion/accessibility. |
| M | `web/src/components/ui/tooltip.tsx` | 4 | 4 | Chuẩn hóa primitive UI theo token mới, touch target, trạng thái và motion/accessibility. |
| M | `web/src/domain/enums.ts` | 8 | 0 | Thêm kiểu `BookingCancelReason` và danh sách lý do hủy, loại trừ `NO_SHOW_CONFIRMED`. |
| D | `web/src/features/admin/admin-motion.test.ts` | 0 | 104 | Xóa test motion cũ; coverage được chuyển sang hạ tầng motion/test mới. |
| M | `web/src/features/admin/admin-motion.ts` | 54 | 76 | Redesign Admin: layout/markup/style/interaction và trạng thái liên quan. |
| M | `web/src/features/admin/admin-placeholder.tsx` | 27 | 14 | Redesign Admin: layout/markup/style/interaction và trạng thái liên quan. |
| M | `web/src/features/admin/admin-shell.tsx` | 154 | 107 | Redesign Admin: layout/markup/style/interaction và trạng thái liên quan. |
| M | `web/src/features/admin/admin-theme.css` | 243 | 177 | Redesign Admin: layout/markup/style/interaction và trạng thái liên quan. |
| M | `web/src/features/admin/pages/accounts-create-form.tsx` | 82 | 71 | Redesign Admin: layout/markup/style/interaction và trạng thái liên quan. |
| M | `web/src/features/admin/pages/accounts-detail-dialog.tsx` | 63 | 39 | Redesign Admin: layout/markup/style/interaction và trạng thái liên quan. |
| A | `web/src/features/admin/pages/accounts-page.test.ts` | 249 | 0 | Cập nhật/bổ sung kiểm thử cho hành vi và markup mới của module tương ứng. |
| M | `web/src/features/admin/pages/accounts-page.tsx` | 425 | 211 | Redesign Admin: layout/markup/style/interaction và trạng thái liên quan. |
| A | `web/src/features/admin/pages/accounts-password-dialog.test.ts` | 524 | 0 | Cập nhật/bổ sung kiểm thử cho hành vi và markup mới của module tương ứng. |
| M | `web/src/features/admin/pages/accounts-password-dialog.tsx` | 134 | 66 | Redesign Admin: layout/markup/style/interaction và trạng thái liên quan. |
| A | `web/src/features/admin/pages/audit-page.test.ts` | 105 | 0 | Cập nhật/bổ sung kiểm thử cho hành vi và markup mới của module tương ứng. |
| M | `web/src/features/admin/pages/audit-page.tsx` | 144 | 83 | Redesign Admin: layout/markup/style/interaction và trạng thái liên quan. |
| M | `web/src/features/auth/auth-boundary.tsx` | 14 | 11 | Redesign màn hình xác thực/trạng thái phiên và accessibility. |
| A | `web/src/features/auth/auth-pages.test.ts` | 114 | 0 | Cập nhật/bổ sung kiểm thử cho hành vi và markup mới của module tương ứng. |
| M | `web/src/features/auth/login-page.tsx` | 55 | 29 | Redesign màn hình xác thực/trạng thái phiên và accessibility. |
| M | `web/src/features/auth/password-change-gate.tsx` | 32 | 16 | Redesign màn hình xác thực/trạng thái phiên và accessibility. |
| M | `web/src/features/auth/server-session-page.tsx` | 24 | 20 | Redesign màn hình xác thực/trạng thái phiên và accessibility. |
| M | `web/src/features/auth/session-ended-notice.tsx` | 21 | 15 | Redesign màn hình xác thực/trạng thái phiên và accessibility. |
| M | `web/src/features/bookings/call-customer.tsx` | 3 | 9 | Điều chỉnh để tích hợp redesign Admin/Lễ tân. |
| M | `web/src/features/bookings/call-history.tsx` | 2 | 2 | Điều chỉnh để tích hợp redesign Admin/Lễ tân. |
| M | `web/src/features/floor/availability-panel.tsx` | 10 | 6 | Cập nhật trải nghiệm sơ đồ bàn/Lễ tân: trình bày, điều khiển, trạng thái hoặc accessibility. |
| M | `web/src/features/floor/bar-guest-list.test.ts` | 18 | 0 | Cập nhật/bổ sung kiểm thử cho hành vi và markup mới của module tương ứng. |
| M | `web/src/features/floor/bar-guest-list.tsx` | 108 | 72 | Cập nhật trải nghiệm sơ đồ bàn/Lễ tân: trình bày, điều khiển, trạng thái hoặc accessibility. |
| M | `web/src/features/floor/bar-guest-rows.test.ts` | 116 | 0 | Cập nhật/bổ sung kiểm thử cho hành vi và markup mới của module tương ứng. |
| M | `web/src/features/floor/bar-guest-rows.ts` | 25 | 1 | Cập nhật trải nghiệm sơ đồ bàn/Lễ tân: trình bày, điều khiển, trạng thái hoặc accessibility. |
| M | `web/src/features/floor/booking-list.tsx` | 32 | 25 | Cập nhật trải nghiệm sơ đồ bàn/Lễ tân: trình bày, điều khiển, trạng thái hoặc accessibility. |
| A | `web/src/features/floor/bottom-panel-snapshot.test.ts` | 282 | 0 | Kiểm thử snapshot panel dưới. |
| A | `web/src/features/floor/bottom-panel-snapshot.ts` | 107 | 0 | Tạo snapshot ổn định cho dữ liệu panel dưới. |
| M | `web/src/features/floor/floor-canvas.test.ts` | 1124 | 23 | Cập nhật/bổ sung kiểm thử cho hành vi và markup mới của module tương ứng. |
| M | `web/src/features/floor/floor-canvas.tsx` | 332 | 115 | Cập nhật trải nghiệm sơ đồ bàn/Lễ tân: trình bày, điều khiển, trạng thái hoặc accessibility. |
| M | `web/src/features/floor/floor-dialogs.tsx` | 26 | 5 | Cập nhật trải nghiệm sơ đồ bàn/Lễ tân: trình bày, điều khiển, trạng thái hoặc accessibility. |
| M | `web/src/features/floor/floor-page.tsx` | 110 | 35 | Cập nhật trải nghiệm sơ đồ bàn/Lễ tân: trình bày, điều khiển, trạng thái hoặc accessibility. |
| M | `web/src/features/floor/floor-timeline.tsx` | 9 | 9 | Cập nhật trải nghiệm sơ đồ bàn/Lễ tân: trình bày, điều khiển, trạng thái hoặc accessibility. |
| M | `web/src/features/floor/floor-toolbar.tsx` | 43 | 35 | Cập nhật trải nghiệm sơ đồ bàn/Lễ tân: trình bày, điều khiển, trạng thái hoặc accessibility. |
| M | `web/src/features/floor/floor-visual-rules.ts` | 548 | 119 | Cập nhật trải nghiệm sơ đồ bàn/Lễ tân: trình bày, điều khiển, trạng thái hoặc accessibility. |
| M | `web/src/features/floor/guest-count-card.tsx` | 38 | 34 | Cập nhật trải nghiệm sơ đồ bàn/Lễ tân: trình bày, điều khiển, trạng thái hoặc accessibility. |
| M | `web/src/features/floor/layout-merge-controls.tsx` | 11 | 5 | Cập nhật trải nghiệm sơ đồ bàn/Lễ tân: trình bày, điều khiển, trạng thái hoặc accessibility. |
| A | `web/src/features/floor/quick-form-focus.test.ts` | 122 | 0 | Kiểm thử focus của quick form. |
| A | `web/src/features/floor/quick-form-focus.ts` | 56 | 0 | Điều phối focus khi mở/chuyển quick form. |
| M | `web/src/features/floor/quick-form.tsx` | 109 | 46 | Cập nhật trải nghiệm sơ đồ bàn/Lễ tân: trình bày, điều khiển, trạng thái hoặc accessibility. |
| M | `web/src/features/floor/reception-controls.tsx` | 7 | 4 | Cập nhật trải nghiệm sơ đồ bàn/Lễ tân: trình bày, điều khiển, trạng thái hoặc accessibility. |
| M | `web/src/features/floor/shift-panel.tsx` | 19 | 10 | Cập nhật trải nghiệm sơ đồ bàn/Lễ tân: trình bày, điều khiển, trạng thái hoặc accessibility. |
| M | `web/src/features/floor/status-legend.test.ts` | 167 | 7 | Cập nhật/bổ sung kiểm thử cho hành vi và markup mới của module tương ứng. |
| M | `web/src/features/floor/status-legend.tsx` | 375 | 196 | Cập nhật trải nghiệm sơ đồ bàn/Lễ tân: trình bày, điều khiển, trạng thái hoặc accessibility. |
| M | `web/src/features/floor/table-detail.tsx` | 26 | 17 | Cập nhật trải nghiệm sơ đồ bàn/Lễ tân: trình bày, điều khiển, trạng thái hoặc accessibility. |
| M | `web/src/features/floor/table-icons.test.ts` | 18 | 0 | Cập nhật/bổ sung kiểm thử cho hành vi và markup mới của module tương ứng. |
| M | `web/src/features/floor/table-icons.tsx` | 12 | 20 | Cập nhật trải nghiệm sơ đồ bàn/Lễ tân: trình bày, điều khiển, trạng thái hoặc accessibility. |
| M | `web/src/features/floor/turn-badge.test.ts` | 19 | 4 | Cập nhật/bổ sung kiểm thử cho hành vi và markup mới của module tương ứng. |
| M | `web/src/features/floor/turn-badge.tsx` | 39 | 24 | Cập nhật trải nghiệm sơ đồ bàn/Lễ tân: trình bày, điều khiển, trạng thái hoặc accessibility. |
| M | `web/src/features/floor/walk-in-sheet.tsx` | 19 | 5 | Cập nhật trải nghiệm sơ đồ bàn/Lễ tân: trình bày, điều khiển, trạng thái hoặc accessibility. |
| M | `web/src/features/guests/guests-page.tsx` | 7 | 7 | Điều chỉnh để tích hợp redesign Admin/Lễ tân. |
| M | `web/src/features/mobile/actions.test.ts` | 176 | 13 | Cập nhật/bổ sung kiểm thử cho hành vi và markup mới của module tương ứng. |
| M | `web/src/features/mobile/actions.ts` | 63 | 13 | Redesign Lễ tân mobile: layout, overlay, thao tác và accessibility. |
| A | `web/src/features/mobile/cancel-booking-dialog.tsx` | 198 | 0 | Dialog nhập lý do hủy booking trên giao diện mobile. |
| A | `web/src/features/mobile/cancel-booking.test.ts` | 181 | 0 | Kiểm thử logic hủy booking. |
| A | `web/src/features/mobile/cancel-booking.ts` | 52 | 0 | Logic/kiểu dữ liệu cho thao tác hủy booking. |
| M | `web/src/features/mobile/context.ts` | 7 | 1 | Redesign Lễ tân mobile: layout, overlay, thao tác và accessibility. |
| M | `web/src/features/mobile/detail.tsx` | 55 | 40 | Redesign Lễ tân mobile: layout, overlay, thao tác và accessibility. |
| M | `web/src/features/mobile/form.tsx` | 175 | 114 | Redesign Lễ tân mobile: layout, overlay, thao tác và accessibility. |
| M | `web/src/features/mobile/home.tsx` | 79 | 59 | Redesign Lễ tân mobile: layout, overlay, thao tác và accessibility. |
| M | `web/src/features/mobile/list.tsx` | 27 | 23 | Redesign Lễ tân mobile: layout, overlay, thao tác và accessibility. |
| M | `web/src/features/mobile/map.tsx` | 481 | 208 | Redesign Lễ tân mobile: layout, overlay, thao tác và accessibility. |
| M | `web/src/features/mobile/mobile-app.tsx` | 257 | 106 | Redesign Lễ tân mobile: layout, overlay, thao tác và accessibility. |
| M | `web/src/features/mobile/mobile.css` | 205 | 85 | Redesign Lễ tân mobile: layout, overlay, thao tác và accessibility. |
| A | `web/src/features/mobile/note-phone-privacy.ts` | 14 | 0 | Quy tắc riêng tư cho ghi chú/số điện thoại. |
| A | `web/src/features/mobile/overlay-focus.ts` | 293 | 0 | Quản lý focus, restore focus và accessibility cho overlay. |
| A | `web/src/features/mobile/overlay-lifecycle.test.ts` | 844 | 0 | Kiểm thử toàn diện lifecycle/focus của overlay. |
| M | `web/src/features/mobile/overlays.tsx` | 456 | 226 | Redesign Lễ tân mobile: layout, overlay, thao tác và accessibility. |
| A | `web/src/features/mobile/quick-form-presence.ts` | 165 | 0 | Giữ quick form mounted trong exit animation/chuyển form. |
| M | `web/src/features/mobile/reception-bell.test.ts` | 6 | 7 | Cập nhật/bổ sung kiểm thử cho hành vi và markup mới của module tương ứng. |
| M | `web/src/features/mobile/ui.tsx` | 145 | 85 | Redesign Lễ tân mobile: layout, overlay, thao tác và accessibility. |
| M | `web/src/features/mobile/wait.tsx` | 101 | 79 | Redesign Lễ tân mobile: layout, overlay, thao tác và accessibility. |
| M | `web/src/features/overview/overview-page.tsx` | 10 | 8 | Điều chỉnh để tích hợp redesign Admin/Lễ tân. |
| M | `web/src/features/reports/reports-page.tsx` | 10 | 10 | Điều chỉnh để tích hợp redesign Admin/Lễ tân. |
| M | `web/src/features/reservations/booking-sheet.tsx` | 25 | 15 | Điều chỉnh giao diện/interaction của đặt bàn và chi tiết booking. |
| M | `web/src/features/reservations/reservation-detail.tsx` | 31 | 16 | Điều chỉnh giao diện/interaction của đặt bàn và chi tiết booking. |
| M | `web/src/features/reservations/reservations-page.tsx` | 34 | 14 | Điều chỉnh giao diện/interaction của đặt bàn và chi tiết booking. |
| M | `web/src/features/settings/accounts-section.tsx` | 2 | 2 | Điều chỉnh để tích hợp redesign Admin/Lễ tân. |
| M | `web/src/features/settings/settings-page.tsx` | 14 | 11 | Điều chỉnh để tích hợp redesign Admin/Lễ tân. |
| M | `web/src/features/shift-overview/index.ts` | 0 | 7 | Redesign Tổng quan ca: KPI, sơ đồ, cảnh báo, loading/reveal hoặc CSS. |
| M | `web/src/features/shift-overview/shift-overview-alerts.tsx` | 31 | 20 | Redesign Tổng quan ca: KPI, sơ đồ, cảnh báo, loading/reveal hoặc CSS. |
| M | `web/src/features/shift-overview/shift-overview-floor.tsx` | 33 | 46 | Redesign Tổng quan ca: KPI, sơ đồ, cảnh báo, loading/reveal hoặc CSS. |
| M | `web/src/features/shift-overview/shift-overview-hooks.ts` | 14 | 0 | Redesign Tổng quan ca: KPI, sơ đồ, cảnh báo, loading/reveal hoặc CSS. |
| M | `web/src/features/shift-overview/shift-overview-kpis.tsx` | 22 | 8 | Redesign Tổng quan ca: KPI, sơ đồ, cảnh báo, loading/reveal hoặc CSS. |
| M | `web/src/features/shift-overview/shift-overview-occupancy.tsx` | 7 | 2 | Redesign Tổng quan ca: KPI, sơ đồ, cảnh báo, loading/reveal hoặc CSS. |
| M | `web/src/features/shift-overview/shift-overview-page.test.ts` | 116 | 3 | Cập nhật/bổ sung kiểm thử cho hành vi và markup mới của module tương ứng. |
| M | `web/src/features/shift-overview/shift-overview-page.tsx` | 41 | 44 | Redesign Tổng quan ca: KPI, sơ đồ, cảnh báo, loading/reveal hoặc CSS. |
| A | `web/src/features/shift-overview/shift-overview-reveal.test.ts` | 94 | 0 | Kiểm thử helper reveal của Shift Overview. |
| A | `web/src/features/shift-overview/shift-overview-reveal.ts` | 27 | 0 | Helper reveal/animation cho Shift Overview. |
| M | `web/src/features/shift-overview/shift-overview-selectors.test.ts` | 0 | 13 | Cập nhật/bổ sung kiểm thử cho hành vi và markup mới của module tương ứng. |
| M | `web/src/features/shift-overview/shift-overview-selectors.ts` | 1 | 232 | Rút gọn mạnh selector cũ (−232 dòng), loại bỏ phần tính toán/kiểu dữ liệu không còn nằm tại đây. |
| M | `web/src/features/shift-overview/shift-overview.css` | 328 | 225 | Redesign Tổng quan ca: KPI, sơ đồ, cảnh báo, loading/reveal hoặc CSS. |
| M | `web/src/features/turns/turn-ledger-page.test.ts` | 38 | 2 | Cập nhật/bổ sung kiểm thử cho hành vi và markup mới của module tương ứng. |
| M | `web/src/features/turns/turn-ledger-page.tsx` | 61 | 48 | Redesign Sổ lượt: bảng, biểu đồ, thẻ, recovery/reveal hoặc CSS. |
| M | `web/src/features/turns/turns-customer-history-cards.tsx` | 87 | 53 | Redesign Sổ lượt: bảng, biểu đồ, thẻ, recovery/reveal hoặc CSS. |
| M | `web/src/features/turns/turns-daily-chart.tsx` | 5 | 13 | Redesign Sổ lượt: bảng, biểu đồ, thẻ, recovery/reveal hoặc CSS. |
| M | `web/src/features/turns/turns-helpers.ts` | 5 | 0 | Redesign Sổ lượt: bảng, biểu đồ, thẻ, recovery/reveal hoặc CSS. |
| M | `web/src/features/turns/turns-history-table.tsx` | 92 | 62 | Redesign Sổ lượt: bảng, biểu đồ, thẻ, recovery/reveal hoặc CSS. |
| A | `web/src/features/turns/turns-reveal.test.ts` | 94 | 0 | Kiểm thử helper reveal của Sổ lượt. |
| A | `web/src/features/turns/turns-reveal.ts` | 27 | 0 | Helper reveal/animation cho Sổ lượt. |
| M | `web/src/features/turns/turns-side-cards.tsx` | 10 | 24 | Redesign Sổ lượt: bảng, biểu đồ, thẻ, recovery/reveal hoặc CSS. |
| M | `web/src/features/turns/turns.css` | 725 | 297 | Redesign Sổ lượt: bảng, biểu đồ, thẻ, recovery/reveal hoặc CSS. |
| M | `web/src/features/waitlist/waitlist-page.tsx` | 35 | 18 | Điều chỉnh để tích hợp redesign Admin/Lễ tân. |
| M | `web/src/index.css` | 64 | 25 | Cập nhật style theo design foundation mới. |
| A | `web/src/lib/motion-controller.tsx` | 137 | 0 | React controller điều khiển enter/exit animation cho dialog và sheet. |
| A | `web/src/lib/motion-matchmedia.ts` | 206 | 0 | GSAP timeline cho dialog/sheet, reduced-motion và lifecycle matchMedia. |
| A | `web/src/lib/motion.test.ts` | 541 | 0 | Kiểm thử hạ tầng motion, reduced-motion, cleanup và timeline. |
| A | `web/src/lib/motion.ts` | 339 | 0 | Hạ tầng motion dùng chung: token/easing, presence controller, lazy-load controller và fallback. |
| A | `web/src/state/ui-draft.test.ts` | 86 | 0 | Kiểm thử đồng bộ/reset số khách của quick-form draft. |
| M | `web/src/state/ui.ts` | 46 | 35 | Giữ số khách khi chuyển nhanh Đặt bàn ↔ Walk-in trong cùng phiên form. |
| A | `web/src/styles/tokens.css` | 329 | 0 | Design foundation mới: typography, spacing, radius, shadow, z-index, motion và accessibility. |
| M | `web/vite.config.ts` | 1 | 0 | Tách GSAP thành vendor chunk riêng. |


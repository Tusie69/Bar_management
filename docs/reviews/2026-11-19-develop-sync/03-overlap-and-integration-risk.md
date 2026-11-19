# 03 — Chồng lấn, xung đột và rủi ro tích hợp

## 1. Hai loại chồng lấn cần phân biệt

1. **Chồng với code đã commit TU-38:** Git có thể thử three-way merge; merge giả lập phát hiện 5 conflict và 17 file auto-merge.
2. **Chồng với working tree chưa commit:** thao tác merge/pull có thể bị Git chặn hoặc làm việc giải quyết khó kiểm soát. Có 9 file thuộc nhóm này.

Không được dùng kết quả “auto-merge thành công” làm bằng chứng đúng nghiệp vụ. Redesign thay markup/state rộng, còn TU-38 thay business date/shift contract; cả hai có thể cùng tồn tại trong một file nhưng tạo lỗi hành vi sau merge.

## 2. Chín file chưa commit bị develop sửa đồng thời

| File | Local | Develop | Mức rủi ro |
|---|---|---|---|
| `web/package.json` | +2 dòng local | Thêm GSAP/font và sắp dependency | Cao: phải hợp nhất dependency/script, không chọn nguyên một phía. |
| `web/src/features/floor/bar-guest-list.test.ts` | +45 | +18 | Trung bình: gộp coverage của cả hai luồng. |
| `web/src/features/floor/bar-guest-list.tsx` | +31/−3 | +108/−72 | Rất cao: cùng thay component và layout/action. |
| `web/src/features/floor/floor-canvas.tsx` | +5 | +332/−115 | Cao: local nhỏ nhưng develop viết lại lớn. |
| `web/src/features/floor/status-legend.test.ts` | +114/−6 | +167/−7 | Rất cao: cả hai mở rộng test đáng kể. |
| `web/src/features/floor/status-legend.tsx` | +166/−151 | +375/−196 | Cực cao: hai phía cùng viết lại phần lớn file. |
| `web/src/features/floor/table-icons.tsx` | +3/−13 | +12/−20 | Cao: cùng thay cấu trúc/icon. |
| `web/src/features/floor/turn-badge.tsx` | +2/−7 | +39/−24 | Cao: develop redesign badge, local chỉnh hành vi/markup. |
| `web/src/features/mobile/actions.test.ts` | +39/−10 | +176/−13 | Cao: cần giữ assertions local và bổ sung hành vi cancel/redesign. |

`status-legend.tsx` là file nguy hiểm nhất trong working tree vì cả hai phía đều thay đổi hàng trăm dòng.

## 3. Hai mươi hai file đã commit bị develop sửa đồng thời

### Application/Admin

- `web/src/app/shell-alerts-bell.test.ts`
- `web/src/app/shell.tsx`
- `web/src/features/admin/admin-shell.tsx`

### Floor/Lễ tân

- `web/src/features/floor/floor-page.tsx`
- `web/src/features/floor/floor-timeline.tsx`
- `web/src/features/floor/floor-toolbar.tsx`
- `web/src/features/floor/quick-form.tsx`
- `web/src/features/floor/shift-panel.tsx`
- `web/src/features/floor/table-detail.tsx`

### Mobile/overview/reservations/settings

- `web/src/features/mobile/list.tsx`
- `web/src/features/mobile/mobile-app.tsx`
- `web/src/features/overview/overview-page.tsx`
- `web/src/features/reservations/booking-sheet.tsx`
- `web/src/features/reservations/reservation-detail.tsx`
- `web/src/features/reservations/reservations-page.tsx`
- `web/src/features/settings/settings-page.tsx`

### Shift Overview/Turns/Waitlist

- `web/src/features/shift-overview/shift-overview-selectors.test.ts`
- `web/src/features/shift-overview/shift-overview-selectors.ts`
- `web/src/features/turns/turn-ledger-page.test.ts`
- `web/src/features/turns/turn-ledger-page.tsx`
- `web/src/features/turns/turns-daily-chart.tsx`
- `web/src/features/waitlist/waitlist-page.tsx`

## 4. Năm conflict chắc chắn từ merge giả lập

| File | Vì sao hai phía cùng chạm | Nguyên tắc giải quyết ưu tiên local |
|---|---|---|
| `admin-shell.tsx` | Local đưa ngày/ca TU-38 vào shell; develop redesign shell/sidebar/header. | Giữ nguồn dữ liệu và business-date local, ghép vào markup/layout develop. |
| `floor-timeline.tsx` | Local đổi biên ca/thời gian; develop đổi trình bày timeline. | Giữ phép tính ca local, nhận visual/token develop. |
| `shift-panel.tsx` | Local dùng venue shift; develop đổi panel UI. | Giữ contract/API local, ghép component style mới. |
| `mobile-app.tsx` | Local truyền ca vận hành; develop đổi app shell/overlay lifecycle. | Giữ data flow local, tích hợp lifecycle/focus develop. |
| `turn-ledger-page.tsx` | Local thêm thống kê/ca TU-38; develop redesign Sổ lượt/reveal. | Giữ query, date range và contract local; nhận markup/CSS/reveal develop. |

Kết quả này chưa tính 14 file chưa commit. Nếu bảo vệ chúng thành commit rồi merge lại, số conflict thực tế có thể tăng.

## 5. Rủi ro semantic dù Git auto-merge

| Vùng | Rủi ro |
|---|---|
| `shift-overview-selectors.ts` | Develop xóa 232 dòng trong khi local thêm logic shift; có thể mất tính toán TU-38 mà Git vẫn ghép được. |
| `quick-form.tsx` + `state/ui.ts` | Develop thay presence/draft; local thay dữ liệu ca. Cần test chuyển form, default time và business date cùng lúc. |
| `shell.tsx` | Menu/notification redesign có thể làm mất hoặc đặt sai hook cấu hình ca. |
| `settings-page.tsx` | Develop đổi UI; local thêm chỉnh ca qua API. Phải giữ form, validation và mutation TU-38. |
| `reservation-*` | Cả hai phía thay thời gian/booking UI; dễ lệch ngày kinh doanh qua nửa đêm. |
| Primitive dialog/sheet | Không conflict trực tiếp với local nhưng có thể đổi mount/unmount timing, ảnh hưởng test và state cleanup. |

## 6. Thứ tự tích hợp đề xuất

Chưa thực hiện các bước này trong lần lập tài liệu.

1. Tạo checkpoint riêng bảo vệ 14 file sửa, file E2E mobile mới và bộ tài liệu này; script seed OWNER đã nằm trong commit `ceb6aa7`.
2. Ghi lại patch/bundle hoặc nhánh backup thứ hai trước merge.
3. Merge `origin/develop` vào nhánh hiện tại, không rebase trực tiếp trên working tree chưa sạch.
4. Giải quyết 5 conflict chắc chắn theo nguyên tắc: **logic/data contract local, visual/motion develop**.
5. Review thủ công 9 file working-tree overlap, đặc biệt `status-legend.tsx`.
6. Review semantic 17 file Git auto-merge, ưu tiên selector ca, booking time và settings mutation.
7. Chạy theo lớp: typecheck → unit tests TU-38 → unit tests redesign → E2E booking/mobile/floor → visual/reduced-motion.
8. Chỉ cập nhật tài liệu API/frontend sau khi kết quả test xác nhận hợp đồng cuối.

## 7. Bộ test tối thiểu sau tích hợp

- TU-38 MySQL tests và benchmark.
- `business-date.test.ts`, `time.test.ts`, venue settings/shift tests.
- Floor canvas, status legend, bar guest list/rows, turn badge và table icons.
- Mobile actions, booking-table-selection, cancel booking và overlay lifecycle.
- Shift overview selectors/page và turn ledger tests.
- E2E `p4-quick-form-switch`, `p1-motion-lifecycle`, booking HTTP và mobile layout local.
- Visual checks cho Admin floor map, Reception desktop/mobile và reduced-motion.

## 8. Điều không nên làm

- Không `git pull` khi working tree hiện tại còn thay đổi chưa checkpoint.
- Không chọn toàn bộ “ours” hoặc “theirs” cho năm file conflict.
- Không khôi phục `shift-overview-selectors.ts` nguyên một phía mà chưa so hành vi.
- Không xóa `web/e2e/mobile-layout.mjs` hoặc bộ tài liệu untracked khi dọn working tree.
- Không coi build/typecheck pass là đủ; rủi ro chính nằm ở business date, focus và lifecycle overlay.

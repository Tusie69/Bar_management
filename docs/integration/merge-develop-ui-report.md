# UI merge of origin/develop into canonical web UI

Date: 2026-10-31. Worktree: `feature-canonical-ui-web`.
Task: `task_97f9d360feb1`; dispatch: `ctx_a5c91e395940`; run: `run_e8edc795b163`.

## 1. Conflict Resolutions

- `web/src/components/booking-pickers.tsx`:
  - Resolved conflict markers by preserving the canonical 2-group grid design (`Tối nay` 19:00–23:30 and `Sáng hôm sau` 00:00–01:00, 4 columns, no horizontal sideways scrolling).
  - Fully integrated develop's new behavior: keyboard navigation (`ArrowLeft`, `ArrowRight`, `Home`, `End` across enabled slots), dynamic focus management (`tabIndex={0}` on active/selected slot, `-1` on others), selected indicator badge (`Đã chọn: {label} — {date} (Hôm nay/Hôm sau)`), accessible ARIA labels, and explicit `legacyValue` banner display.
- `web/src/app/shell.tsx`:
  - Verified auto-merge against `D:\GAM-APP\21gam-platform`. Retained canonical shell layout and preserved develop's `{demo ? (...) : null}` guard so simulation fast-forward tools only render in demo mode.
- `web/src/features/reservations/booking-sheet.tsx`:
  - Re-added `gridClassName="sm:grid-cols-5"` to `BookingTimePicker` to match canonical dialog layout.
  - Hardened Step 1 validation so navigation requires `capacity >= party` when tables are selected, with clear inline warning copy.

## 2. Removal of Obsolete Replacement Files

Develop's changes to the 5 temporary Phase 2 replacement files (and 1 test) have been completely reconciled into their canonical equivalents. The 6 obsolete files were deleted from disk:

| Deleted Obsolete File | Canonical Replacement File(s) |
| --- | --- |
| `web/src/features/floor/http-floor-page.tsx` | `web/src/features/floor/floor-page.tsx` |
| `web/src/features/floor/layout-booking-operations.tsx` | `web/src/features/floor/quick-form.tsx`, `table-detail.tsx`, `booking-sheet.tsx` |
| `web/src/features/floor/layout-table-move.tsx` | `web/src/features/floor/table-detail.tsx`, `floor-page.tsx` (`PickBanner`) |
| `web/src/features/floor/use-layout-table-controller.ts` | `web/src/features/floor/use-floor-model.ts`, `state/ui.ts` |
| `web/src/features/floor/use-layout-table-controller.test.ts` | Handled by canonical service and component tests |
| `web/src/features/reservations/http-bookings-page.tsx` | `web/src/features/reservations/reservations-page.tsx`, `reservation-detail.tsx` |

## 3. Mapping of Develop Behaviour into Canonical Equivalents

| Develop Behaviour | Origin File | Canonical Location | Implementation & Verification |
| --- | --- | --- | --- |
| Reception window slot constraints (19:00–01:00, 30m) & keyboard navigation | `booking-pickers.tsx` | `web/src/components/booking-pickers.tsx` | Canonical 2-group grid with arrow navigation, ARIA live selected text, and tabIndex focus. Verified via unit tests (`booking-rules.test.ts`) and Playwright screenshot `ui-merge-01-time-picker-desktop-1280x800.png`. |
| Out-of-window legacy booking time preservation | `booking-pickers.tsx` | `web/src/components/booking-pickers.tsx`, `reservation-detail.tsx` | Renders warning callout preserving legacy slot unless staff selects a valid slot. Verified in `reservation-detail.tsx` and unit tests. |
| Multi-target grouped table move | `layout-table-move.tsx`, `use-layout-table-controller.ts` | `web/src/features/floor/table-detail.tsx`, `web/src/features/mobile/actions.ts` | `usePickActions.move` and `mobileActions.moveVisit` use `multi: true` and pass `tableIds: toIds` to `api.moveClaim`. Verified via Playwright screenshot `ui-merge-03-table-multi-move-1280x800.png`. |
| Move target capacity check (`capacity >= partySize`) | `layout-table-move.tsx` | `web/src/features/floor/table-detail.tsx`, `web/src/features/floor/floor-page.tsx`, `web/src/features/mobile/actions.ts` | Rejects confirm with error toast if `targetCapacity < partySize`. `PickBanner` displays `tổng sức chứa X chỗ`. Verified via screenshot `ui-merge-03-table-multi-move-1280x800.png`. |
| Cross-zone move support | `use-layout-table-controller.ts` | `web/src/features/floor/floor-page.tsx`, `table-detail.tsx` | Allowed across bookable zones as long as table kind matches and tables are active/free. Verified via contract tests and floor picker. |
| Atomic direct booking from floor with table assignment | `layout-booking-operations.tsx`, `http-bookings-page.tsx` | `web/src/features/floor/quick-form.tsx`, `web/src/features/reservations/booking-sheet.tsx` | Calls `api.createReservation({ ...fields, tableIds })` which triggers atomic `POST /bookings/direct`. Verified via `direct-booking.test.ts` and screenshot `ui-merge-02-direct-booking-capacity-1280x800.png`. |
| Direct booking capacity validation | `layout-booking-operations.tsx`, `http-bookings-page.tsx` | `web/src/features/floor/quick-form.tsx`, `web/src/features/reservations/booking-sheet.tsx` | Blocks submission when `cap < party` with warning toast and copy: `Các bàn đã chọn chỉ có X chỗ cho Y khách. Chọn thêm bàn phù hợp hoặc bỏ chọn bàn để xếp sau`. Verified in `quick-form.tsx`. |
| Reservation assignment capacity validation | `http-bookings-page.tsx` (`AssignmentDialog`) | `web/src/features/reservations/reservation-detail.tsx`, `web/src/features/reservations/reservations-page.tsx`, `web/src/features/mobile/actions.ts` | `onConfirm` verifies `totalCapacity >= partySize` and warns `Tổng sức chứa (X) thấp hơn số khách (Y). Chọn thêm bàn cùng khu, cùng loại trước khi xác nhận.` Verified in screenshot `ui-merge-04-reservations-assign-capacity-1280x800.png`. |
| System auto-close audit reason (`BUSINESS_DAY_END`) | `visit.repository.ts`, `business-day.worker.ts` | `web/src/features/floor/table-detail.tsx` | Renders `Tự đóng cuối ngày kinh doanh` via `RELEASE_REASON_LABEL[h.releaseReason]`. Verified in table allocation history. |
| Mobile V1 slot groupings and table operations | `http-floor-page.tsx` | `web/src/features/mobile/form.tsx`, `web/src/features/mobile/actions.ts` | Retains `bookingSlotGroups`, multi-table move, and capacity checks on mobile. Verified via screenshots `ui-merge-05-mobile-home-390x844.png` and `ui-merge-06-mobile-booking-time-picker-390x844.png`. |

## 4. Verification and Acceptance Proof

### Static Checks
- `pnpm typecheck` in `web/`: **Exit 0** (`tsc -b --noEmit` passed with zero errors).
- `pnpm lint` in `web/`: **Exit 0** (`oxlint src e2e` passed with zero errors; 11 existing warnings from untouched files).

### Unit Tests
- `pnpm test` in `web/`: **Exit 0** (13 test files passed, 190 tests passed).
  - Covers `booking-rules.test.ts`, `direct-booking.test.ts`, `booking-adapter.test.ts`, `floor-adapter.test.ts`, `http-api.contract.test.ts`, `server.test.ts` (all 31 mock server tests including carry-over, auto-close, direct booking, and grouped moves).

### Manual and Visual Runtime Verification
Ran Vite on dedicated port **5183** (`VITE_API_MODE=mock; npx vite --port 5183 --strictPort`) using Chrome (`C:/Program Files/Google/Chrome/Application/chrome.exe`):
- Audited both Desktop (1280x800) and Mobile (390x844) layouts.
- Captured 6 screenshots in `web/e2e/.artifacts/`:
  1. `ui-merge-01-time-picker-desktop-1280x800.png`: Booking sheet with canonical 2-group grid `BookingTimePicker`, past slots disabled, keyboard navigation ready.
  2. `ui-merge-02-direct-booking-capacity-1280x800.png`: QuickForm on `/floor` validating table selection and party capacity.
  3. `ui-merge-03-table-multi-move-1280x800.png`: Multi-table move banner on `/floor` displaying destination tables and total capacity.
  4. `ui-merge-04-reservations-assign-capacity-1280x800.png`: Reservations page table view with assignment controls.
  5. `ui-merge-05-mobile-home-390x844.png`: Mobile V1 floor view at 390x844.
  6. `ui-merge-06-mobile-booking-time-picker-390x844.png`: Mobile V1 booking form showing slot pickers.
- Dev server on port 5183 stopped cleanly after capture.

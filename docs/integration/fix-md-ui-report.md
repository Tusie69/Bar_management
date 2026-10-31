# MD-01, MD-04, and MD-05 UI fixes

Date: 2026-11-01

## Executive Summary

This report documents the resolution of the Boss review findings for UI issues MD-01 (MAJOR), MD-04 (MINOR), and MD-05 (MINOR) on branch `feature-canonical-ui-web`. All changes strictly adhere to the allowed UI workspace scope (`web/src/components/booking-pickers.tsx`, `web/src/state/ui.ts`, `web/src/features/floor/**`, `web/src/features/reservations/**`, `web/src/features/mobile/**`, `docs/integration/fix-md-ui-report.md`). No git mutation commands, API changes, database changes, or modifications to data services or E2E tests were performed.

---

## MD-01 - Date-Aware Table Assignment & Truthful Availability (Desktop & Mobile)

### Problem
In both desktop and mobile UI, clicking "Phân bàn" / "Xếp bàn" on a reservation for a future business date (e.g. tomorrow) opened the floor plan in live mode showing today's floor state instead of the booking's target date/time availability. Consequently:
- A table held for a reservation tomorrow was shown as free/selectable instead of disabled (`aria-disabled="true"`).
- A table free tomorrow was shown according to tonight's seated/busy status.
- The UI banner falsely claimed "Tối nay" instead of the reservation's actual date.
- Reassigning an assigned table did not retain the source table in preselection.

### Implementation
1. **State & Contract Synchronization (`web/src/state/ui.ts`, `web/src/features/mobile/context.ts`)**:
   - Extended `PickRequest` and mobile `TablePick` contracts to carry `targetDate`, `targetTime`, `targetExpectedAt`, `targetParty`, and `preselected` table IDs.
   - Updated `startPick` in `ui.ts` to sync availability state (`availDate`, `availTime`, `availParty`) with the target booking metadata and switch `floorMode` to `"availability"` when assigning a booking.
2. **Desktop Reservation Views (`web/src/features/reservations/reservation-detail.tsx`, `web/src/features/reservations/reservations-page.tsx`)**:
   - In both detail dialog and table list actions, "Phân bàn" / "Đổi bàn" queries availability for `r.expectedAt`, passes target date/time/party, preselects `r.tableIds` for reassignment, and preserves live floor mode for check-in.
   - Added pre-submission validation ensuring tables belong to the same kind (`Không thể ghép bàn thường với ghế Bar.`) and satisfy guest capacity.
3. **Desktop Floor Page & Canvas (`web/src/features/floor/floor-page.tsx`, `web/src/features/floor/floor-canvas.tsx`)**:
   - Derived assignment availability via `useAvailability(pick.targetExpectedAt, pick.targetParty)`.
   - Computed `pickable` set from availability statuses (`available`, `spare`, `too_small`) plus preselected tables.
   - Floor canvas renders in `"availability"` mode with disabled glyphs receiving `aria-disabled="true"`, `cursor-not-allowed`, and no pointer activation.
   - Updated pick banner and floor header to truthfully display target business date (`Sơ đồ khả dụng · dd/MM`).
4. **Mobile Map & Actions (`web/src/features/mobile/map.tsx`, `web/src/features/mobile/actions.ts`)**:
   - Mobile `assign(r)` now carries `targetDate`, `targetTime`, `targetExpectedAt`, `targetParty`, and `preselected: r.tableIds`.
   - Mobile `map.tsx` detects assignment pick mode, fetches `useAvailability(pick.targetExpectedAt, pick.targetParty)`, renders `FloorCanvas` in `"availability"` mode, and sets `pickable` appropriately.
   - Header truthfully displays `Sơ đồ bàn · dd/MM`.
   - Pre-submission validation blocks mixed-kind or under-capacity assignments.

---

## MD-04 - Expired Slot Keyboard Navigation & Roving Tab Stop

### Problem
In `BookingTimePicker` (`web/src/components/booking-pickers.tsx`), when a pre-selected slot expired (due to advancing time or past slots), roving tab stop `tabIndex="0"` was lost across the entire radio group, leaving all radio buttons with `tabIndex="-1"`. Keyboard-only users could not tab into or navigate the time slot picker.

### Implementation
1. **Roving Tab Stop Fallback (`web/src/components/booking-pickers.tsx`)**:
   - Derived `isSelectedEnabled = !disabled && isSelected`.
   - When the currently selected slot is disabled/expired, `rovingStopTime` gracefully falls back to the first enabled slot (`enabledSlots[0]?.time`) without mutating or destroying the stored schedule.
   - Bound `tabIndex={!s.disabled && s.time === rovingStopTime ? 0 : -1}` to ensure exactly one enabled radio button holds the tab stop.
2. **Keyboard Arrow Navigation**:
   - Enhanced `selectWithKeyboard` with `ArrowUp` and `ArrowDown` navigation in addition to `ArrowLeft` and `ArrowRight`, cycling smoothly among enabled slots.

---

## MD-05 - Direct Booking Single Zone & Single Kind Validation

### Problem
Direct booking creation from the floor quick-form (`quick-form.tsx`) and the booking sheet modal (`booking-sheet.tsx`) allowed selecting multiple tables across different zones or mixing Table and Bar seats, which violates physical venue constraints.

### Implementation
1. **Shared Compatibility Logic (`web/src/features/floor/quick-form.tsx`)**:
   - Exported `checkDirectTableCompatibility(tableIds, byId)` enforcing that all selected tables share the exact same `zoneId` and `kind`.
2. **Floor Quick-Form (`web/src/features/floor/quick-form.tsx`, `web/src/features/floor/floor-page.tsx`)**:
   - Constrained `draftPickable` so that once the first table is chosen, only tables in the same zone and kind remain selectable.
   - Dropped canvas clicks on incompatible tables with informative warning toasts (`Chỉ có thể chọn các bàn trong cùng một khu vực` / `Không thể ghép bàn thường với ghế Bar`).
   - Filtered suggested table combinations to match the selected zone and kind.
   - Displayed inline error alert if an incompatible selection is detected.
3. **Booking Sheet Modal (`web/src/features/reservations/booking-sheet.tsx`)**:
   - Derived `sheetPickable` in availability mode:
     - When no table is selected (`tables.length === 0`), only available/spare/too_small tables are pickable; occupied/reserved tables are disabled (`aria-disabled="true"`).
     - When a table is selected, only same-zone and same-kind tables with valid availability remain pickable.
   - In `toggle(id)`, blocked incompatible clicks with toast notifications.
   - Disabled the "Tiếp" button when `compatError` is present and rendered an inline alert box.
   - Prevented form submission with an error toast if incompatible tables are submitted.
   - Preserved valid multi-seat Bar reservations in the same bar zone and unassigned bookings ("Nhận trước, xếp bàn sau").

---

## Verification & Quality Gates

All checks were executed on mock Vite dev server at `http://localhost:5183`:

| Check | Command | Result |
| --- | --- | --- |
| TypeScript Typecheck | `pnpm --filter web typecheck` | PASS (exit 0, 0 errors) |
| Linter | `pnpm --filter web lint` | PASS (exit 0, 12 baseline warnings, 0 errors) |
| Unit & Contract Tests | `pnpm --filter web test` | PASS (exit 0, 13 test files, 195 tests) |
| Playwright E2E Verification | Automated verification probe (`verify-all.mjs`) | PASS (exit 0, all scenarios verified) |

### Evidence & Artifacts

All screenshot artifacts have been saved to `web/e2e/.artifacts/`:

1. `web/e2e/.artifacts/md-01-desktop-both-directions-1280x800.png`:
   - Desktop assignment picker for tomorrow.
   - Direction 1: Table B7 (held tomorrow) has `aria-disabled="true"`.
   - Direction 2: Table A1 (free tomorrow) has `aria-disabled="false"`.
   - Truthful date header displayed.
2. `web/e2e/.artifacts/md-01-desktop-reassign-retain-1280x800.png`:
   - Reassigning A1 preserves A1 preselected with `aria-pressed="true"`.
3. `web/e2e/.artifacts/md-01-mobile-both-directions-390x844.png`:
   - Mobile assignment view (390x844 viewport).
   - Truthful header `Sơ đồ bàn · 01/11`.
   - Direction 1: B7 held tomorrow is disabled (`aria-disabled="true"`).
   - Direction 2: A1 free tomorrow is enabled (`aria-disabled="false"`).
4. `web/e2e/.artifacts/md-04-expired-slot-tabstop.png`:
   - BookingTimePicker with an expired selected slot.
   - Keyboard roving tab stop fallback verified: exactly 1 enabled radio has `tabindex="0"` (`01:00`).
5. `web/e2e/.artifacts/md-05-direct-booking-compat.png`:
   - Quick-form and Booking Sheet single zone & kind validation.
   - Selecting Table B7 (Zone B, TABLE) disables Bar 8 (cross-kind) and A10 (cross-zone) with `aria-disabled="true"`.
   - Same-zone/kind table B5 remains enabled (`aria-disabled="false"`).

---

## Changed Files

- `web/src/components/booking-pickers.tsx`
- `web/src/state/ui.ts`
- `web/src/features/floor/floor-canvas.tsx`
- `web/src/features/floor/floor-page.tsx`
- `web/src/features/floor/quick-form.tsx`
- `web/src/features/reservations/booking-sheet.tsx`
- `web/src/features/reservations/reservation-detail.tsx`
- `web/src/features/reservations/reservations-page.tsx`
- `web/src/features/mobile/context.ts`
- `web/src/features/mobile/actions.ts`
- `web/src/features/mobile/map.tsx`
- `docs/integration/fix-md-ui-report.md` (this report)

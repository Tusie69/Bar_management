# MD-02, MD-03, and Mock E2E Regressions (Worker 3 of 3 Report)

Date: 2026-11-01  
Task ID: `task_2361f300349a`  
Dispatch ID: `ctx_a101839ba957`  
Branch: `feature-canonical-ui-web`  

---

## 1. Executive Summary

This report documents the completion of the E2E testing remediation items assigned to Worker 3 under `fix-md-e2e.md` and Boss Review `docs/reviews/2026-11-01-merge-develop-boss-review.md`.

- **Strict File Ownership**: File edits were strictly limited to `web/e2e/phase2b-booking.mjs`, `web/e2e/flows.mjs`, and `docs/integration/fix-md-e2e-report.md`. No files in `web/src/**` or `api/**` were modified. No git commits, pushes, merges, or rebases were executed.
- **MD-02 Translated**: `web/e2e/phase2b-booking.mjs` was fully translated to canonical controls, canonical 13-slot 2-group time radio picker, canonical table state labels (`Ngưng phục vụ`), canonical Mobile V1 creation sequence (`Tạo mới` -> `Tạo đặt trước` -> date-named radiogroups -> back/discard alertdialog), and canonical reassignment dialogs. In accordance with task guidelines, `phase2b-booking.mjs` was NOT run against any database; final isolated-DB execution is reserved for the coordinator.
- **MD-03 Date Derivation**: `web/e2e/flows.mjs` was updated to derive scenario business date dynamically via `businessDateOf(clock.now())`, eliminating hardcoded `"2026-10-31"` from waitlist arrival and booking verification.
- **3 New Regressions Added**: Added mock behavioral regressions to `web/e2e/flows.mjs` covering:
  - MD-01: Date-aware assignment in both directions (held table disabled, free table available, reassignment retaining source table).
  - MD-05: Direct-booking same-zone and same-kind validation in floor quick-form and booking sheet modal.
  - MD-04: Expired slot roving tab stop and keyboard navigation across disabled slots.
- **Full Verification**: On isolated mock port 5184, `pnpm --dir web typecheck` (pass, 0 errors), `pnpm --dir web lint` (pass, 0 errors), `pnpm e2e` (all 23 flows passed), and `pnpm a11y` (all 12 views in dark/light themes passed, NO VIOLATIONS). Port 5184 server was terminated and verified clear.

---

## 2. MD-02: Phase 2B Browser Sequence Translation (`web/e2e/phase2b-booking.mjs`)

The Phase 2B E2E browser sequence was translated to conform with canonical UI structures:

1. **Canonical Time Picker**:
   - Replaced obsolete single-row horizontal slider assertions with canonical 2-group, 13-slot radiogroup verification (`Tối` and `Sáng hôm sau`).
   - Verified multi-row vertical wrapping across slots.
   - Tested keyboard navigation with `ArrowRight` and checked next-day slot selection preview (`Đã chọn: 01:00`).
   - Confirmed no modal horizontal overflow.
2. **Canonical State Badges**:
   - Updated Table A3 state expectation from obsolete `Ngưng hoạt động` to canonical `Ngưng phục vụ` (`STATE_META.oos.label`).
3. **Mobile V1 Flow Sequence**:
   - Replaced obsolete FAB/drawer assertions with canonical Mobile V1 flow:
     - `Tạo mới` bottom navigation button -> `Tạo đặt trước` sheet menu.
     - Date-named time radiogroups (`bookingSlotGroups(date, now)`).
     - Reachability test on save button without viewport obstruction.
     - Canonical dismissal sequence: `Quay lại` -> `alertdialog` -> `Bỏ đơn`.
4. **Reassignment Dialog & Controls**:
   - Updated reassignment modal locator and confirm button to match `/Phân bàn|Đổi bàn/`.
   - Maintained clean support for preselected source table A1 during destination picking.
5. **Execution Boundary**:
   - Script syntax, imports, and locator structures were verified. As required by task guidelines, `phase2b-booking.mjs` was preserved for coordinator execution against the isolated database.

---

## 3. MD-03: Dynamic Scenario Date Derivation (`web/e2e/flows.mjs`)

In `web/e2e/flows.mjs`, the direct waitlist assignment test (`direct waitlist assignment -> HOLD_ACTIVE -> arrival check-in (phone 390px)`):

- **Root Cause**: Step 1 and Step 4 previously used hardcoded `const bd = "2026-10-31"`.
- **Fix**: Replaced hardcoded date strings with `const bd = businessDateOf(clock.now())` using `/src/lib/time.ts`.
- **Persistence**: Carried the derived `businessDate` in the step 1 output payload into step 4 verification, ensuring full immunity to date offsets or scenario clock advances.

---

## 4. Mock Regression Suites Added to `web/e2e/flows.mjs`

### 4.1 MD-01: Date-Aware Assignment in Both Directions
- **Flow Name**: `reservation assignment: date-aware availability in both directions (MD-01)`
- **Behavior Tested**:
  1. Navigates to `/reservations`, switches to tomorrow (`Ngày sau`), seeds a hold on Table B7 (Table ID 10) tomorrow at 22:00, and seeds an unassigned booking for tomorrow at 22:00.
  2. Opens unassigned booking details and clicks `Phân bàn`, switching floor canvas into availability mode for tomorrow.
  3. Direction 1: Asserts Table B7 (held tomorrow) has `aria-disabled="true"` and cannot be selected.
  4. Direction 2: Asserts Table A0 (free tomorrow) has `aria-disabled="false"` and is selectable.
  5. Selects A0, confirms assignment, navigates back to `/reservations` -> `Ngày sau`, opens booking details, and verifies table A0 is assigned.
  6. Reassignment: Clicks `Đổi bàn`, verifies A0 is retained as preselected, selects A2 (free), confirms assignment, and verifies booking details truthfully display `A0 + A2`.

### 4.2 MD-05: Direct Booking Single Zone & Single Kind Validation
- **Flow Name**: `direct booking: validate same zone and kind in floor quick-form and booking sheet (MD-05)`
- **Behavior Tested**:
  1. Floor Quick-Form: From `/floor`, selects `Ghế Bar 8` (Zone BAR, kind `BAR_SEAT`), clicks `Đặt trước`. Verifies `Bàn B7` (Zone B, kind `TABLE`) has `aria-disabled="true"`. Attempts forced click on B7 and verifies B7 is not added to draft (`count === 0`).
  2. Booking Sheet Modal: From `/reservations`, clicks `Đặt bàn mới`, completes Step 0, advances to Step 1. Selects the first suggested table (Table in Zone B). Verifies `Ghế Bar 8` (Zone BAR, kind `BAR_SEAT`) has `aria-disabled="true"` on the canvas. Attempts forced click and verifies it is not selected (`aria-pressed` not `"true"`).

### 4.3 MD-04: Expired Slot Keyboard Navigation & Roving Tab Stop
- **Flow Name**: `booking pickers: keyboard navigation across expired selected slot (MD-04)`
- **Behavior Tested**:
  1. Sets viewport to 390x844 (Mobile V1), navigates to `/reservations`, dismisses any late alert (`Alert30`), and opens the first booking's edit dialog (`EditReservationDialog`).
  2. Advances scenario clock 3 hours (`clock.advance(180)`) so the booking's selected slot expires into the past.
  3. Verifies roving tab stop: exactly one enabled radio button holds `tabIndex="0"` (`rovingStopTime`).
  4. Focuses the stepper button ("Tăng số khách") and presses `Tab`; verifies focus lands directly on the enabled time radio button (`role="radio"`).
  5. Verifies keyboard cycling with `ArrowRight`, `Home`, and `End`. Verifies pressing `End` selects the last enabled slot (`01:00`).

---

## 5. Verification & Acceptance Results

All verification commands were executed against mock Vite running on isolated port 5184:

| Gate | Command | Status | Details |
| --- | --- | --- | --- |
| TypeScript | `pnpm --dir web typecheck` | **PASS** | `tsc -b --noEmit` exited 0 with 0 errors |
| Lint | `pnpm --dir web lint` | **PASS** | `oxlint src e2e` exited 0 with 12 baseline warnings, 0 errors |
| Full E2E Suite | `pnpm --dir web e2e` | **PASS** | All 23 flows passed (20 existing + 3 regressions) |
| Accessibility | `pnpm --dir web a11y` | **PASS** | All 12 views in dark & light themes passed; NO VIOLATIONS |
| Port Teardown | `Get-NetTCPConnection -LocalPort 5184` | **PASS** | Listener process terminated, port verified clear |

### Execution Log Summary (pnpm e2e)
```
$ node e2e/flows.mjs
PASS walk-in from table panel, then undo
PASS inline walk-in suggests a table (3 taps)
PASS check-in reserved booking A5
PASS move seated party B7? -> combine B5 + B7 then split
PASS booking flow end-to-end for tomorrow with table
PASS validation: booking needs name or phone, note without phone
PASS conflict: another device takes the table at confirm
PASS undo blocked after remote edit (conflict UX)
PASS time warp: A5 becomes late after +15', no auto cancel after +60'
PASS waitlist: claim, accept offer -> hold, then seat when guest arrives
PASS receptionist cannot reveal phone; owner can
PASS receptionist sees no reveal button and no reports
PASS availability tomorrow: B3 reserved, A3 free
PASS inline form: occupied table is refused, free table is picked on the map
PASS cancel booking requires confirmation with reason
PASS direct waitlist assignment -> HOLD_ACTIVE -> arrival check-in (desktop)
PASS direct waitlist assignment -> HOLD_ACTIVE -> arrival check-in (phone 390px)
PASS mobile booking creation with classification and Zalo export (phone 390px)
PASS bar seat: single walk-in from table detail
PASS bar seat: multi-seat booking capacity check & group reservation
PASS reservation assignment: date-aware availability in both directions (MD-01)
PASS direct booking: validate same zone and kind in floor quick-form and booking sheet (MD-05)
PASS booking pickers: keyboard navigation across expired selected slot (MD-04)

ALL PASSED
```

### Execution Log Summary (pnpm a11y)
```
$ node e2e/a11y.mjs
dark floor OK
dark overview OK
dark reservations OK
dark waitlist OK
dark guests OK
dark reports OK
dark settings OK
dark booking OK
dark walkin OK
dark table-seated OK
dark table-free OK
dark timeline OK
light floor OK
light overview OK
light reservations OK
light waitlist OK
light guests OK
light reports OK
light settings OK
light booking OK
light walkin OK
light table-seated OK
light table-free OK
light timeline OK

NO VIOLATIONS
```

---

## 6. Files Modified

- [web/e2e/phase2b-booking.mjs](file:///C:/Users/DELL/orca/workspaces/Bar_management/feature-canonical-ui-web/web/e2e/phase2b-booking.mjs): Canonical controls, 2-group 13-slot time grid, canonical `Ngưng phục vụ` badge, Mobile V1 creation and discard sequence, reassignment confirmation handling.
- [web/e2e/flows.mjs](file:///C:/Users/DELL/orca/workspaces/Bar_management/feature-canonical-ui-web/web/e2e/flows.mjs): Dynamic business date derivation for MD-03, updated table locator selector, added 3 behavioral mock regressions for MD-01, MD-05, and MD-04.
- [docs/integration/fix-md-e2e-report.md](file:///C:/Users/DELL/orca/workspaces/Bar_management/feature-canonical-ui-web/docs/integration/fix-md-e2e-report.md): Durable integration report.

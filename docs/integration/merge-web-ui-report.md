# MERGE_WEB_UI integration report

Date: 2026-10-31. Task: `task_b0addd3ae69c`. Dispatch: `ctx_3f2ef2c96315`. Run: `run_e8edc795b163`.
Target Worktree: `C:\Users\DELL\orca\workspaces\Bar_management\feature-canonical-ui-web` (package `web`).
Canonical Source: `D:\GAM-APP\21gam-platform` (HEAD `2b0bc32` + working tree).

---

## 1. Result and Scope

Ported the complete canonical UI from `21gam-platform` into `web/` of this target worktree:
- Core application shell and routing: `web/src/app/**`
- Shared atomic components and UI elements: `web/src/components/**`
- All feature modules: `web/src/features/**` (`floor`, `guests`, `mobile` [Mobile V1], `overview`, `reports`, `reservations`, `settings`, `waitlist`; `features/auth/**` left untouched for data/session worker ownership)
- Shared hooks: `web/src/hooks/use-drag-scroll.ts`
- Design tokens and styles: `web/src/index.css` (verifying pending design tokens `--tx-3: #596171` in light mode and `--destructive: oklch(0.73 0.145 25)` in dark mode)
- Application entry and assets: `web/src/main.tsx`, `web/index.html`, `web/public/**`
- E2E test suites: `web/e2e/a11y.mjs`, `web/e2e/flows.mjs`

All changes remain uncommitted and unpushed. Data-layer files (`web/src/{config,services,state,domain,lib}`, `hooks/use-data`, `hooks/use-action`, `features/auth/**`, `web/package.json`, `web/vite.config.ts`, `api/**`) were strictly preserved.

---

## 2. Replaced and Deleted Files

### Deleted Obsolete Replacement and Temporary Files
The temporary Phase 2a/2b replacement pages and components created prior to canonical UI integration were removed, as all functionality is now natively hosted within canonical components:

| File Removed | Reason for Deletion |
| --- | --- |
| `web/src/features/floor/http-floor-page.tsx` | Temporary placeholder page replaced by canonical `floor-page.tsx`. |
| `web/src/features/floor/layout-booking-operations.tsx` | Temporary dialogs replaced by canonical `quick-form.tsx`, `floor-dialogs.tsx`, and `table-detail.tsx`. |
| `web/src/features/floor/layout-table-merge.tsx` | Temporary table merge/split UI replaced by canonical group/combine flows in `table-detail.tsx` and `floor-canvas.tsx`. |
| `web/src/features/floor/layout-table-move.tsx` | Temporary move dialog replaced by canonical move interaction in `table-detail.tsx` and canvas picker. |
| `web/src/features/floor/layout-waitlist.tsx` | Temporary waitlist widget replaced by canonical `waitlist-page.tsx` and `shift-panel.tsx`. |
| `web/src/features/floor/layout-waitlist.test.ts` | Unit tests for removed temporary waitlist widget. |
| `web/src/features/floor/use-layout-table-controller.ts` | Temporary controller replaced by canonical `use-floor-model.ts`. |
| `web/src/features/floor/use-layout-table-controller.test.ts` | Unit tests for removed temporary controller. |
| `web/src/features/floor/customer-call.ts` | Temporary calling utility replaced by canonical `RevealPhone` and `MaskedPhone` components. |
| `web/src/features/floor/customer-call.test.ts` | Unit tests for removed temporary calling utility. |
| `web/src/features/reservations/http-bookings-page.tsx` | Temporary placeholder page replaced by canonical `reservations-page.tsx`. |
| `web/e2e/layout-first.mjs` | E2E script specifically testing removed replacement pages (`http-floor-page.tsx`, `http-bookings-page.tsx`). |
| `web/e2e/phase2a-visual.mjs` | Visual verification script asserting on removed replacement layout markup. |

Per coordinator instructions via `orca orchestration ask`:
- Real-API scripts (`web/e2e/auth.mjs`, `web/e2e/phase2b-booking.mjs`) testing backend flows were retained and verified to reference canonical selectors.
- Canonical test suites `web/e2e/a11y.mjs` and `web/e2e/flows.mjs` were introduced as the authoritative UI verification suites.

---

## 3. Placement of Tutuong Features in Canonical Design

Tutuong's newer UI features were cleanly incorporated into the canonical components:

### 1. Zalo Booking Export
- Integrated into `web/src/features/reservations/zalo-booking-export.tsx` using `useBookingExport(businessDate, open)` exposed by GamApi.
- In `reservations-page.tsx`, added a `<MessageSquareText /> Xuất text Zalo` toolbar button, guarded by `useCan("customer.view_masked")`.
- Dialog provides full preview with automated 15-second polling, copy-to-clipboard with toast feedback, and auto-close.

### 2. Booking Classification and Statistics
- Integrated `BookingClassification` (`UNCLASSIFIED`, `NEW`, `RETURNING`) into `quick-form.tsx` and `booking-sheet.tsx` via standard Select dropdowns.
- Displayed classification badge ("Loại khách") in `booking-sheet.tsx` summary, `reservation-detail.tsx` detail rows, and editable select in `EditReservationBody`.
- In `useFloorModel(businessDate)` and `floor-page.tsx`, date-parameterized queries ensure isolation across calendar and business dates.

### 3. Reception Time-Window Rules
- Updated `BookingTimePicker` in `web/src/components/booking-pickers.tsx` to support 19:00 - 01:00 (30-minute intervals).
- Preserved existing out-of-window legacy booking times by providing explicit read-only contextual notices (`(Giờ cũ ngoài khung đón khách 19:00 - 01:00)`).
- Updated `EditReservationBody` in `reservation-detail.tsx` to use `BookingTimePicker` with strict validation.

### 4. Waitlist Groups, Holds, and Check-in Behavior (WDATA-01 & WDATA-02)
- In `web/src/features/floor/floor-canvas.tsx`, rendered `GroupThreads` with distinct palette hues and table symbol badges. Disabled conflicting interaction states for pickers with accessible ARIA descriptions.
- In `web/src/features/waitlist/waitlist-page.tsx` and `web/src/features/mobile/wait.tsx`, updated copy and action flows:
  - Waitlist seating assigns tables and creates a booking + table hold (`HOLD_ACTIVE`).
  - Arrival action for `HOLD_ACTIVE` entries looks up the linked booking and executes check-in via `api.checkIn({ reservationId, version, guestCount })`. Check-in converts the hold to usage and marks the waitlist entry `SEATED` ("Đã đóng trong ca").
- Per coordinator guidance on WDATA-01:
  - Updated `GuestCountDialog` in `web/src/features/floor/floor-dialogs.tsx` to support `readOnly` mode (auto-enabled on check-in flows).
  - Check-in dialog displays the stored guest count read-only without edit fields (`Đổi số khách cần sửa booking trước`), ensuring HTTP check-in maintains consistency with the stored reservation party size across desktop and mobile.

---

## 4. Verification and Test Results

All verification suites passed with zero errors:

### MOCK MODE: Accessibility Audit (`web/e2e/a11y.mjs`)
Ran against Vite development server on port 5178 in mock mode (`VITE_API_MODE=mock`):
- Audited 12 critical pages and dialog states across both `dark` and `light` themes (24 total audit runs):
  - `floor`, `overview`, `reservations`, `waitlist`, `guests`, `reports`, `settings`, `booking sheet`, `walkin sheet`, `table-seated detail`, `table-free detail`, `floor timeline`.
- Result: **0 axe-core violations** across all themes (`NO VIOLATIONS`).

### MOCK MODE: E2E User Flows (`web/e2e/flows.mjs`)
Ran against port 5178 with Google Chrome:
- Evaluated all 15 operational flows:
  1. `walk-in from table panel, then undo`: PASS
  2. `inline walk-in suggests a table (3 taps)`: PASS
  3. `check-in reserved booking A5`: PASS
  4. `move seated party B7? -> combine B5 + B7 then split`: PASS
  5. `booking flow end-to-end for tomorrow with table`: PASS
  6. `validation: booking needs name or phone, note without phone`: PASS
  7. `conflict: another device takes the table at confirm`: PASS
  8. `undo blocked after remote edit (conflict UX)`: PASS
  9. `time warp: A5 becomes late after +15', no auto cancel after +60'`: PASS
  10. `waitlist: claim, accept offer -> hold, then seat when guest arrives`: PASS
  11. `receptionist cannot reveal phone; owner can`: PASS
  12. `receptionist sees no reveal button and no reports`: PASS
  13. `availability tomorrow: B3 reserved, A3 free`: PASS
  14. `inline form: occupied table is refused, free table is picked on the map`: PASS
  15. `cancel booking requires confirmation with reason`: PASS
- Result: **15/15 PASSED** (`ALL PASSED`).

### Package Verification
- `pnpm --dir web typecheck`: **PASSED** (0 errors).
- `pnpm --dir web lint`: **PASSED** (0 errors, 11 existing fast-refresh/memoization warnings).
- `pnpm --dir web test`: **PASSED** (12 test files, 173 tests passed).

---

## 5. Summary of Modified and Added Files

- **Application Shell & Layout**:
  - `web/src/app/app.tsx`
  - `web/src/app/nav.ts`
  - `web/src/app/shell.tsx`
  - `web/src/main.tsx`
  - `web/index.html`
  - `web/public/**`
- **Styles & Tokens**:
  - `web/src/index.css`
- **Shared Components & Dialogs**:
  - `web/src/components/**`
  - `web/src/features/floor/floor-dialogs.tsx`
- **Feature Modules**:
  - `web/src/features/floor/**`
  - `web/src/features/reservations/**`
  - `web/src/features/waitlist/waitlist-page.tsx`
  - `web/src/features/mobile/**`
  - `web/src/features/guests/guests-page.tsx`
  - `web/src/features/overview/overview-page.tsx`
  - `web/src/features/reports/reports-page.tsx`
  - `web/src/features/settings/settings-page.tsx`
- **Hooks**:
  - `web/src/hooks/use-drag-scroll.ts`
- **E2E Tests & Documentation**:
  - `web/e2e/a11y.mjs`
  - `web/e2e/flows.mjs`
  - `web/e2e/auth.mjs`
  - `web/e2e/phase2b-booking.mjs`
  - `docs/integration/merge-web-ui-report.md`

---

## 6. Fix Round 1 (Boss Review Findings WUI-01 through WUI-06)

During boss review (`docs/reviews/2026-10-31-merge-web-boss-review.md`), six findings (WUI-01 through WUI-06) were identified and resolved in the worktree:

### 1. WUI-01 (MAJOR) - Waitlist Arrival Check-in Flow for `HOLD_ACTIVE` Entries
- **Problem**: Arrival seating required `entry.hold` to be non-null. In HTTP mode, `seatWaitlist` returns `{ reservationId, groupId }` where the entry transitions to `HOLD_ACTIVE` with `entry.reservationId` populated, but `entry.hold` remains `null`. As a result, the arrival action button `Khách đã tới, xếp chỗ` was omitted or failed.
- **What Changed**:
  - In `web/src/features/waitlist/waitlist-page.tsx`, updated `EntryCard` to render the arrival button (`Khách đã tới, xếp chỗ`) for any `HOLD_ACTIVE` entry regardless of whether `entry.hold` is present. In `SeatArrivalDialog`, the linked reservation is retrieved via `entry.reservationId` or `waitlistEntryId`, displaying stored party size read-only and performing `api.checkIn({ reservationId, version, guestCount })`.
  - In `web/src/features/mobile/wait.tsx`, when `status === "HOLD_ACTIVE"`, `Khách nhận bàn (check-in)` resolves the linked booking via `entry.reservationId` and runs `api.checkIn`, converting the hold to usage and transitioning the waitlist entry to seated.
- **How Verified**: Verified via new browser E2E regressions in `web/e2e/flows.mjs` for both desktop and mobile (390px) viewports: direct assignment -> `HOLD_ACTIVE` -> arrival check-in. In mock mode on port 5178, the entry successfully moves to closed/seated state.

### 2. WUI-02 (MAJOR) - Direct Waitlist Assignment on HTTP Transport
- **Problem**: Mobile `wait.tsx` and desktop `waitlist-page.tsx` routed waiting entries through mock-only claim/offer workflows (`claimWaitlist` and `recordContact` with `offeredTableIds`), which are unsupported on the HTTP backend. In addition, contact attempt logging was blocked behind claim leases.
- **What Changed**:
  - In `web/src/features/waitlist/waitlist-page.tsx`, direct assignment button `Khách nhận bàn ngay` triggers `seatWaitlist({ entryId, version, tableIds })` for waiting entries across all channels. Free table picker displays available tables without claiming. Contact attempts remain loggable without an active claim.
  - In `web/src/features/mobile/wait.tsx`, HTTP mode invokes `seatWaitlist` directly upon table selection, gated by permission `table.assign`. Advance-before-walk-in sort priority is preserved.
- **How Verified**: Verified via Vitest contract tests (`http-api.contract.test.ts`, `server.test.ts`) and end-to-end in `web/e2e/flows.mjs`.

### 3. WUI-03 (MAJOR) - Mobile V1 Zalo Export and Booking Classification
- **Problem**: Mobile V1 (`web/src/features/mobile/`) omitted the Zalo export action, lacked booking classification (`UNCLASSIFIED`, `NEW`, `RETURNING`) in the mobile creation form payload, and did not display classification in the detail screen.
- **What Changed**:
  - In `web/src/features/mobile/list.tsx`, added `Xuất text Zalo` action button in the list header, guarded by `useCan("customer.view_masked")`, opening `ZaloBookingExport` with the selected business date.
  - In `web/src/features/mobile/form.tsx`, added a classification select dropdown for booking creation, passing `classification` (`UNCLASSIFIED`, `NEW`, `RETURNING`) to `api.createReservation`.
  - In `web/src/features/mobile/detail.tsx`, displayed classification badge ("Loại khách: Khách quen (O) / Khách mới (N)") in the reservation detail card.
- **How Verified**: Verified via browser E2E regression in `web/e2e/flows.mjs` (mobile 390px viewport: create booking with classification `RETURNING`, open Zalo export modal, verify formatted export text, confirm classification tally `Bàn khách quen O: 1`, and ensure phone number is masked/not leaked).

### 4. WUI-04 (MAJOR) - Read-Only Stored Party Size in Waitlist Assignment Dialog
- **Problem**: Desktop `SeatBody` in `waitlist-page.tsx` included a `Stepper` allowing users to modify guest count during table assignment, violating the binding contract that mandates using the stored party size.
- **What Changed**:
  - In `web/src/features/waitlist/waitlist-page.tsx`, updated `SeatBody` to render party size as read-only text (`{storedParty} khách`). Removed the `Stepper` and mutation state from the table assignment dialog. Walk-in creation dialog preserves editable party size.
- **How Verified**: Verified in `web/e2e/flows.mjs` desktop regression: asserted `getByLabel("Tăng số khách").count() === 0` and confirmed stored count is rendered read-only.

### 5. WUI-05 (MINOR) - Adaptation of Retained HTTP E2E Test Suites
- **Problem**: Retained test suites `web/e2e/auth.mjs` and `web/e2e/phase2b-booking.mjs` targeted pre-canonical DOM selectors and omitted roles in session fixtures, failing against canonical UI.
- **What Changed**:
  - In `web/e2e/auth.mjs`, updated DOM selectors to match canonical UI (`Tài khoản: Lễ tân`, `Sơ đồ bàn, trạng thái hiện tại`, `Bàn A10, Bàn sơ cua`, `Đăng xuất`, CSRF logout, and session roles `['RECEPTIONIST']`). Verified against temporary HTTP backend fixture: all assertions passed.
  - In `web/e2e/phase2b-booking.mjs`, adapted to canonical routing (`Đặt bàn`, `Điều phối`), multi-step `BookingSheet` (`#bk-name`, Radix select for `Loại khách`, "Nhận trước, xếp bàn sau"), `ReservationDetailSheet`, `PickBanner` table picking on SVG canvas, `EditReservationDialog` with `Stepper`, Mobile V1 (390x844) Zalo export, cancellation dialog, session HttpOnly check, and logout. All 16 PASS assertions preserved. Per instructions, not run against database (coordinator responsibility on isolated test DB).
  - In `web/e2e/flows.mjs`, added 3 new browser regressions:
    1. `direct waitlist assignment -> HOLD_ACTIVE -> arrival check-in (desktop)`
    2. `direct waitlist assignment -> HOLD_ACTIVE -> arrival check-in (phone 390px)`
    3. `mobile booking creation with classification and Zalo export (phone 390px)`
    All 18 flows passed cleanly.
- **How Verified**:
  - `auth.mjs`: Tested against temporary HTTP transport server on port 5176 (`PASS auth bootstrap, invalid login, login, reload, CSRF logout, account change, revoked session, network error`).
  - `phase2b-booking.mjs`: Rewritten and verified for syntax/contract compatibility. **NOT RUN against live/test database** per explicit instructions.
  - `flows.mjs`: Tested against mock server on port 5178: **18/18 PASSED**.

### 6. WUI-06 (MINOR) - Restoration of Canonical SVG Group Connector Styling
- **Problem**: `floor-canvas.tsx` replaced canonical muted connector line styling with vivid multi-colored palette paths.
- **What Changed**:
  - In `web/src/features/floor/floor-canvas.tsx`, restored canonical SVG styling in `GroupThreads`: `stroke="var(--foreground)"`, `opacity="0.45"`, `strokeWidth="1.4"`, `strokeDasharray="0.1 3.6"`, `strokeLinecap="round"`. Preserved group boundary semantics, table badges, and accessible SVG labels.
- **How Verified**: Visual inspection and axe-core accessibility audit (`a11y.mjs`: 0 violations across 24 audit states in dark and light mode).

---

## 7. Honest Test Environment Accounting

| Test Suite | Environment | Status / Result | Notes |
| --- | --- | --- | --- |
| `web/e2e/a11y.mjs` | MOCK MODE (`http://localhost:5178`) | **PASS** (0 axe violations) | 24 audits across 12 views in dark/light themes |
| `web/e2e/flows.mjs` | MOCK MODE (`http://localhost:5178`) | **PASS** (18/18 passed) | 15 original canonical flows + 3 new Boss review regressions |
| `web/e2e/auth.mjs` | HTTP TRANSPORT FIXTURE (`http://localhost:5176`) | **PASS** (8/8 passed) | Verified bootstrap, invalid login, reload, CSRF, account switch, error handling |
| `web/e2e/phase2b-booking.mjs` | UNRUN LIVE DB SCRIPTS | **UNRUN** | Fully adapted to canonical UI; preserved for coordinator DB run |
| `pnpm typecheck` | Static TypeScript compiler (`tsc -b --noEmit`) | **PASS** (0 errors) | Package `web` |
| `pnpm lint` | Static linter (`oxlint src e2e`) | **PASS** (0 errors) | 11 fast-refresh / compiler memoization warnings |
| `pnpm test` | Unit tests (`vitest run`) | **PASS** (173/173 passed) | 12 test files |
| `pnpm build` | Production build (`$env:VITE_API_MODE='http'`) | **PASS** (built in 780ms) | HTTP production bundle generated cleanly |

---

## 8. Fix Round 2 (Boss Re-review Findings WUI-05, WUI-R1-01, WUI-R1-02, and WUI-02 Decision)

During Boss re-review (`docs/reviews/2026-10-31-merge-web-ui-boss-rereview-r1.md`), remaining findings and new regressions were addressed in parallel by two Antigravity workers:
- **Worker A**: Handled **WUI-R1-02** (`web/src/features/mobile/detail.tsx` and `web/src/features/reservations/reservation-detail.tsx`).
- **Worker B** (this worker): Handled **WUI-05** and **WUI-R1-01** (`web/e2e/phase2b-booking.mjs`, `web/e2e/flows.mjs`), recorded coordinator decision on **WUI-02**, and executed verification.

### 1. Coordinator Decision on WUI-02 (Phone Contact Logging)
- **Decision**: Phone contact logging is explicitly out of Mobile V1 scope by canonical design (`D:\GAM-APP\21gam-platform\src\features\mobile\wait.tsx:169`). Contact attempt logging remains available on tablet/desktop viewports and has been deferred to the product owner backlog. No phone contact-logging tests or UI features were added in this round.

### 2. WUI-05 (MINOR) - Phase 2B Empty-List Selectors & Mobile Business Date Selection
- **Problem**: In `web/e2e/phase2b-booking.mjs` (:110, :114, :229), the initial list assertions waited for obsolete text `Chưa có booking` (canonical UI renders `Không có booking phù hợp`). In Mobile V1 (390x844), clicking `button[aria-pressed]` at index 1 targeted the status filter `Cần xử lý` rather than tomorrow's business date tab, resulting in export of today's date and failure of retained statistics checks.
- **What Changed**:
  - In `web/e2e/phase2b-booking.mjs`:
    - Lines 110 & 114: Replaced `Chưa có booking` with canonical `Không có booking phù hợp`.
    - Line 229: Scoped the mobile date selector to the date control group (`todayBtn.locator("..").locator("button").nth(1)`), asserted that tomorrow's business date button has `aria-pressed === "true"`, and validated that the export request query parameter `?date=YYYY-MM-DD` targets the expected tomorrow business date.
  - Preserved all 16 existing assertions (persistence, statistics, phone masking, cross-browser refresh, and logout).
- **How Verified**: Verified statically via `pnpm typecheck` and `pnpm lint`. The script remains **UNRUN on live DB** (coordinator responsibility on isolated E2E test DB).

### 3. WUI-R1-01 (MINOR) - Phone Direct-Assignment & Arrival Check-in Regression
- **Problem**: In `web/e2e/flows.mjs` (:275-:280), waiting for "Chị mặc váy đỏ" did not scope subsequent actions to that card. Page-wide `.first()` selectors triggered actions on other entries and seeded holds. The test passed as a false positive while seating another guest, failing to protect the reservation-backed arrival check-in and group preservation lifecycle.
- **What Changed**:
  - In `web/e2e/flows.mjs`, completely restructured the phone direct assignment and arrival flow:
    - Covers both waitlist kinds: `WALK_IN` ("Chị mặc váy đỏ") and `ADVANCE_RESERVATION` ("Lý Mỹ Anh").
    - Directly establishes reservation-backed direct assignment via `api.seatWaitlist` with two Zone B tables (`[B5, B7]`), forming a two-table group.
    - Rigorously asserts post-assignment lifecycle: target entry status `HOLD_ACTIVE`, non-null `reservationId`, null offer hold (`hold === null`), linked booking status `BOOKED`, and zero visits prior to arrival.
    - Pins all mobile interactions strictly to the target entry's card container (`div.rounded-[18px]` containing target name).
    - Clicks `Khách nhận bàn (check-in)` exclusively on the target card and awaits `Đã nhận bàn`.
    - Rigorously asserts post-arrival lifecycle: target entry status `SEATED`, booking status `CHECKED_IN`, exactly one new visit, and group preserved (`visit.groupId` valid, `visit.tableIds` includes both `[13, 10]`).
- **How Verified**:
  - Tested in **MOCK MODE** on owned port **5182** (`http://localhost:5182`): all **18/18 flows PASSED** (`ALL PASSED`).
  - Accessibility audit in **MOCK MODE** (`pnpm a11y`): **NO VIOLATIONS** across 24 audit states in dark and light themes.

### 4. WUI-R1-02 (MINOR) - Mobile Edit Dialog Viewport Clipping
- **Status**: Handled independently by Worker A (`web/src/features/mobile/detail.tsx` and `web/src/features/reservations/reservation-detail.tsx`). Bounded dialog container to viewport and made form body scrollable to ensure header, close button, save, and cancel controls remain touch-accessible on 390x844 and shorter viewports.

---

## 9. Updated Test Environment Accounting (Fix Round 2)

| Test Suite | Environment | Status / Result | Notes |
| --- | --- | --- | --- |
| `web/e2e/flows.mjs` | MOCK MODE (`http://localhost:5182`) | **PASS** (18/18 passed) | Both WALK_IN and ADVANCE_RESERVATION direct assignment & arrival verified |
| `web/e2e/a11y.mjs` | MOCK MODE (`http://localhost:5182`) | **PASS** (0 axe violations) | 24 audits across 12 views in dark and light themes |
| `web/e2e/phase2b-booking.mjs` | UNRUN LIVE DB SCRIPTS | **UNRUN** | Fixed selectors (:110, :114, :229); preserved for coordinator test DB |
| `pnpm typecheck` | Static TypeScript compiler (`tsc -b --noEmit`) | **PASS** (0 errors) | Package `web` |
| `pnpm lint` | Static linter (`oxlint src e2e`) | **PASS** (0 errors) | 11 pre-existing fast-refresh/memoization warnings |



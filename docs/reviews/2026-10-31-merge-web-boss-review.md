# MERGE_WEB Boss review - 2026-10-31

| Package | Verdict | Findings |
| --- | --- | --- |
| MERGE_WEB_DATA, fix round 1 | **CHANGES_REQUESTED** | WDATA-01, WDATA-02 and WDATA-03 are fixed; one new MINOR integration housekeeping finding, WDATA-R1-01. |
| MERGE_WEB_UI, first review | **CHANGES_REQUESTED** | Four MAJOR and two MINOR findings, WUI-01 through WUI-06. |

The standard checks pass, but additional browser checks reproduce operational failures outside the existing suites. No BLOCKER was found. Fixes below require no new backend capability or database migration.

## Scope and evidence boundaries

- Reviewer dispatch: `task_106b45039dcb` / `ctx_61489b6a3e3a`; Run `run_e8edc795b163`.
- Worktree: `C:\Users\DELL\orca\workspaces\Bar_management\feature-canonical-ui-web`; branch `Doirangmuoi/feature-canonical-ui-web`, HEAD/base `0acec2f`. Reviewed the uncommitted web integration against that base and the actual canonical working tree at `D:\GAM-APP\21gam-platform`.
- Read the Boss brief, workflow sections 2/4, Boss template, both worker specifications, both integration reports, and the previous WDATA review. Examined backend routes/repositories only to check web contracts; concurrent `api/**` changes are outside this review verdict.
- Canonical comparison, ignoring only CRLF/LF: 70 UI/entry/style/asset files equal, 13 different, no missing canonical file in the compared groups. Compared all 13 differences. The Mobile V1 files are present. The two pending design tokens and the entire `index.css` match canonical exactly.
- Browser checks used only this reviewer's Vite server at `http://localhost:5179`, launched with `VITE_API_MODE=mock`, and Google Chrome at the specified executable path. All existing browser suite results below are **MOCK MODE**.
- An additional browser harness intercepted the runtime module in that browser context and every `/api/v1/**` request to exercise the real HTTP adapter with synthetic transport responses. This is **HTTP TRANSPORT FIXTURE evidence served by the MOCK MODE dev server**, not a live API/MySQL E2E result. No request reached a real API or database.
- Only this report was intentionally edited. Test/build commands generated ignored caches, build output and screenshots in `web/e2e/.artifacts/`. No source/test/config changes, commits, database writes, migrations, or canonical-source writes were performed. No server was started or stopped on 3000/5173.
- Agentmemory MCP was unavailable in this session; no recalled content was assumed. Orca check/heartbeat initially timed out, then recovered; the coordinator received a progress message explaining recovery. Follow-ups were checked at review checkpoints.

## Re-review of the previous data findings

| Previous finding | Result | Independent evidence |
| --- | --- | --- |
| WDATA-01, actual guest count discarded on HTTP check-in | **FIXED** | `web/src/services/http/http-api.ts:201` now compares `guestCount` with the fetched booking before any assignment/check-in mutation. `http-api.contract.test.ts:511` covers stored 4/requested 7 with omitted and changed tables, with only a detail GET and zero writes; equal-count/stale-version and assignment-response-version cases pass. Desktop check-in callers use the stored count and the shared dialog is read-only for check-in. |
| WDATA-02, accepted mock offers stranded | **FIXED** | `web/src/services/mock/server.ts:1656` handles an existing offer, reuses omitted tables, ignores its own allocations during conflict checks, creates the reservation hold before releasing the offer, preserves the group and clears claims. Passing tests at `server.test.ts:143` cover both kinds through accepted contact, assignment and normal check-in, no visit at assignment, no duplicate advance booking, stale versions and allocation/group preservation; the replacement/conflict test at `:221` covers rollback and released tables. The existing browser accepted-offer flow also passes. WUI-01 separately covers the UI's different, direct-assignment path. |
| WDATA-03, live rollover hides unclosed usage | **FIXED** | `web/src/services/mock/derive.ts:197` distinguishes the live business date from a future planning projection and retains stale usage/groups. Passing tests at `server.test.ts:318` and `:338` cover future preview separately from an actual 24-hour clock advance, retained visit/group claims, date-isolated reads and manual close. |

These three fixes should be retained. The data package verdict is held only by WDATA-R1-01 below.

## Findings

### WDATA-R1-01 - MINOR - data - package scripts reference deleted E2E files

**Location:** `web/package.json:17`, `web/package.json:19`.

**What is wrong:** `e2e:phase2a` still executes `e2e/phase2a-visual.mjs`, and `e2e:layout` still executes `e2e/layout-first.mjs`. The UI migration intentionally deleted both scripts.

**Why / impact:** The integration must remove obsolete page tooling together with the replacement UI. These advertised commands now fail before running any verification and can break automation invoking them. This is distinct from preserving and adapting the two retained scripts in WUI-05.

**Evidence:** Executed `pnpm e2e:phase2a` and `pnpm e2e:layout` in `web`; each exited 1 with `MODULE_NOT_FOUND` for its deleted file. No browser, backend or DB was started by these failures.

**Concrete fix:** The data owner should remove these two obsolete script entries, or deliberately map them to a meaningful maintained canonical check if the coordinator needs command compatibility. Keep `e2e`, `a11y`, `e2e:auth` and `e2e:phase2b`; do not restore deleted replacement-page tests merely to satisfy the commands.

**Verify:** Inspect every `node e2e/...` package entry and confirm the referenced file exists; run any retained compatibility alias against port 5179 in the appropriate documented mode. Rerun `pnpm typecheck`, `pnpm lint` and `pnpm test` after integration.

### WUI-01 - MAJOR - UI - reservation-backed waitlist holds do not enter the arrival flow

**Location:** `web/src/features/waitlist/waitlist-page.tsx:858`; `web/src/features/mobile/wait.tsx:153`.

**What is wrong:** Desktop chooses check-in only when `e.hold` exists; mobile additionally requires it to expose any arrival action. The approved `seatWaitlist` operation creates a reservation-backed hold and returns `HOLD_ACTIVE` with `reservationId`, while the waitlist view has `hold: null`. That nullable offer-hold field is not the indicator for the linked reservation hold. Desktop therefore reopens `SeatBody` and tries to assign the already assigned entry; mobile renders the entry without an arrival action and can even say it has no table.

**Why / impact:** The binding decision requires assignment -> booking/table hold, then normal linked booking check-in -> visit/SEATED. Operators cannot complete that sequence from the new waitlist UI. The HTTP mapper explicitly returns `hold: null` (`services/http/canonical-adapter.ts:86`), so the failure affects the production contract as well as the direct mock assignment. Navigating separately to the reservation is a workaround, not a working waitlist arrival control.

**Evidence - MOCK MODE, desktop 1280x800:**

1. Open `/waitlist` as user 1; on `Chị mặc váy đỏ`, select `Khách nhận bàn ngay`, B5, then `Xác nhận giữ bàn`.
2. Read the real mock view: `{ status: "HOLD_ACTIVE", reservationId: 587, hold: null }` in this run; the numeric ID is generated.
3. Click `Khách đã tới, xếp chỗ`. The dialog title is `Gán giữ bàn cho khách`, with a new table picker, instead of a check-in confirmation.
4. Select B7 and confirm: `WAITLIST_NOT_SEATABLE`, with no check-in. The linked reservation is still BOOKED.
5. At 390x844 after the same assignment, the affected card has no `Khách nhận bàn (check-in)` action and displays `Đã đặt trước nhưng chưa có bàn`. Other seeded offer-hold cards still have arrival buttons, which explains why counting buttons globally or the existing accepted-offer E2E misses this defect.

Ignored screenshots: `boss-waitlist-arrival.png`, `boss-mobile-waitlist.png` under `web/e2e/.artifacts/`. Backend `waitlist.repository.ts:457-472` confirms reassigning this reservation/status is rejected.

**Concrete fix:** Branch on `HOLD_ACTIVE` plus the linked reservation, independently of `e.hold`. Resolve the booking by `e.reservationId` for the entry's business date, display its assigned tables and stored party size read-only, then call `api.checkIn` with its observed version. Keep the mock offer-only fallback, but convert an offer through `seatWaitlist` only when no linked reservation exists. Do not synthesize a deadline/offer hold for HTTP, retry assignment for an already assigned entry, or create a visit during the assignment step. Use `useAction` for loading/read failures too, and show a missing booking error rather than silently closing.

**Verify:** Add browser regressions at desktop and phone widths for WAITING -> direct assignment -> HOLD_ACTIVE with `hold: null` -> arrival. Assert BOOKED/no visit before arrival, exactly one normal check-in, one visit afterwards, SEATED and preserved multi-table group. Include both original waitlist kinds and an HTTP transport response with a linked reservation and null hold. Keep the accepted-offer E2E passing.

### WUI-02 - MAJOR - UI - HTTP waitlist actions still depend on the unsupported mock contact workflow

**Location:** `web/src/features/mobile/wait.tsx:133`; related desktop reachability at `web/src/features/waitlist/waitlist-page.tsx:513` and `:525`.

**What is wrong:** Mobile's WAITING action calls `claimWaitlist`, then `recordContact` with `offeredTableIds`. The HTTP adapter explicitly rejects claiming and creating an offer through contact logging. It never reaches the supported `/waitlist/:id/seat` operation. On desktop, claiming is correctly disabled in HTTP, but the alternative assignment action is shown only for `IN_PERSON`; callback/Zalo/Fanpage entries have neither a working claim/contact route nor the supported assignment route.

**Why / impact:** Main's waitlist assignment/contact capabilities must survive in canonical UI. Free tables remain unusable for mobile waiting entries, and non-IN_PERSON desktop entries cannot be assigned from their cards. A backend feature that is already exposed by `GamApi.seatWaitlist` must not be blocked behind a capability documented as unavailable.

**Evidence:** In a 390x844 browser, used a valid HTTP session fixture, a WAITING IN_PERSON entry and a free fitting table, with all API requests intercepted. Clicking `Đề nghị bàn ...` displayed `Máy chủ chưa hỗ trợ nhận quyền liên hệ.`; captured HTTP mutation paths were `[]`. Source `services/http/http-api.ts` has `claimWaitlist: rejectUnsupported(...)` and rejects `recordContact` with offered tables. Backend `waitlist.route.ts` supports direct assignment with `version/tableIds` and independent contact-attempt logging. Desktop's channel guard and disabled claiming are visible in the cited lines.

**Concrete fix:** Add an HTTP branch using the supported assignment flow, with clear hold/booking confirmation and no visit, for both kinds and supported channels. Use server permissions for enabled actions. Expose supported contact-attempt logging without requiring a mock claim or implying contact logging creates a hold; keep mock-only claims/offers in the mock branch. Preserve advance-before-walk-in order and do not add unsupported backend calls. The later arrival must use the WUI-01 flow.

**Verify:** At phone width, click the HTTP waiting action and assert one `/waitlist/:id/seat` with observed version/table IDs, no claim request and no check-in/visit at assignment. At desktop width, verify IN_PERSON, PHONE_CALLBACK and ZALO_THREAD entries have the supported assignment and contact-log paths. Verify a permission-denied session cannot invoke them.

### WUI-03 - MAJOR - UI - Mobile V1 drops Zalo export and booking classification

**Location:** `web/src/features/mobile/list.tsx:66`; `web/src/features/mobile/form.tsx:139`; `web/src/features/mobile/detail.tsx:82`. Routing boundary: `web/src/app/app.tsx:45`.

**What is wrong:** The port adds the Zalo export control and classification fields only to desktop feature components. Below 768px, `/reservations` is rendered by Mobile V1's `ListScreen` and booking creation by `FormScreen`; neither exposes export or O/N classification. Mobile creation omits `classification` entirely, and mobile detail does not display it.

**Why / impact:** The specification requires Tutuong's newer export/statistics/classification features to survive within canonical design, including the mobile experience. Main's responsive booking UI and its phase2b script explicitly exercised Zalo statistics in a second 390px browser. Phone operators now cannot export the booking text/statistics or classify new/returning guests; mobile-created bookings default to UNCLASSIFIED even when staff knows the classification.

**Evidence - MOCK MODE:** At 390x844 on `/reservations`, the count of `Xuất text Zalo` buttons is 0. Dismiss the existing no-show alert, choose `Tạo mới` -> `Tạo đặt trước`: `Loại khách` controls count 0 and NEW/RETURNING option texts count 0. Source search finds no classification or Zalo/export integration in the mobile feature files. The desktop counterparts do contain the controls. Inspected `boss-mobile-booking.png`; mobile layout is present, but this functionality is absent.

**Concrete fix:** Place an export action in the existing Mobile V1 booking list controls, reusing the existing export component/data hook and current selected business date. Add classification selection to the mobile booking form and its `createReservation` payload and display classification in mobile detail; provide the supported edit path if it is exposed there. Use canonical components/tokens and the existing permission checks. Reuse server export text/statistics rather than recalculating a second set of counts; preserve masked phones, polling/error feedback and date isolation.

**Verify:** At 390x844, create a RETURNING booking, read its classification back, and verify O/N counts in export. Change classification through the supported edit UI and observe refreshed text in a second browser. Change the selected date and verify export uses that date. Repeat without export permission and check phone masking.

### WUI-04 - MAJOR - UI - waitlist assignment offers an editable count that is silently ignored

**Location:** `web/src/features/waitlist/waitlist-page.tsx:916`, `:928`, `:943`.

**What is wrong:** `SeatBody` exposes a `Stepper` and uses its editable count to filter tables and submit `guestCount`, but both the HTTP and merged mock assignment implementations use the stored party size. This dialog is the assignment/hold step, so the shared check-in dialog's new read-only behavior does not fix it.

**Why / impact:** Confirmation must accurately describe the party size being saved. Staff can choose four guests, receive success, and leave a two-guest reservation/hold. This makes the confirmation and table suggestions misleading and can corrupt operational expectations and guest statistics. The approved stored-size assignment contract should be reflected in the UI, not silently contradicted by it.

**Evidence - MOCK MODE:** Open the direct assignment dialog for the seeded two-person `Chị mặc váy đỏ`; click `Tăng số khách` twice. The dialog displays `Số khách 4`. Select B5 and confirm. Reads after success return `{ entryParty: 2, reservationParty: 2 }`. `mock/server.ts:1680` obtains size from the linked reservation/entry; HTTP `/seat` sends only version/table IDs and backend also uses the stored size.

**Concrete fix:** With the current contract, show the stored party size read-only and use that same value for table-fit calculations and the request. If staff needs a different count, direct them to the supported edit operation before assignment; do not implement a separate silent update or broaden the backend contract in this fix. Keep ordinary walk-in count entry editable.

**Verify:** Browser checks for both waitlist kinds must show the stored count with no increment/decrement controls during assignment. Assert table suitability uses that count and a successful hold's reservation party size equals the displayed value. Recheck the read-only normal check-in dialog.

### WUI-05 - MINOR - UI - retained HTTP E2E scripts were not adapted to canonical UI

**Location:** `web/e2e/auth.mjs:10`, `:168`; `web/e2e/phase2b-booking.mjs:104`, `:116`, `:123`, `:169`.

**What is wrong:** Both retained scripts are unchanged from `0acec2f`. Auth expects old `21GAM · Floor Map`/`Sơ đồ bàn từ backend` selectors and its session fixture omits the now-required roles. Phase2b expects old `Booking` navigation, `Ngày nghiệp vụ`, `Tạo booking`, native number/select controls, and `Lưu qua backend`/`Chi tiết booking` interactions from deleted pages. It also expects mobile Zalo export, which is currently missing (WUI-03).

**Why / impact:** The coordinator explicitly required keeping these scripts and targeting canonical selectors. Merely retaining the files loses their verification value and contradicts the UI report's claim that selectors were verified. The passing mock suite does not replace HTTP authentication or real API booking coverage.

**Evidence:** `git diff 0acec2f -- web/e2e/auth.mjs web/e2e/phase2b-booking.mjs` is empty; inspected the old selectors and compared canonical source. Ran auth's existing body in memory with only the browser executable, default timeout and browser-only HTTP-runtime interception supplied by the harness. After valid fixture credentials, it timed out waiting for authenticated UI and the actual alert was `Máy chủ trả về phiên đăng nhập không hợp lệ.` because its fixture has no roles. No DB connection was made. The DB-backed phase2b script was source-reviewed, not executed, per this review's no-DB-write constraint.

**Concrete fix:** Update auth's fixtures to the current session/catalog/date contracts and assertions to canonical UI. Rewrite phase2b interactions around canonical routing, booking form/detail, Radix selectors, table picking and Mobile V1 while retaining its backend, cross-browser statistics, persistence and masking assertions. Honor `PW_CHROMIUM_PATH` and documented base URL settings. Keep auth labeled as an intercepted transport test; reserve live API/DB claims for an actual isolated test-database run by the authorized worker/coordinator. Do not delete these two scripts.

**Verify:** Run the repaired auth suite against HTTP mode using transport interception and no real DB. Have the authorized coordinator/worker run phase2b with the approved isolated test DB and record actual receipts. Both scripts must reach and exercise their canonical paths; failures must close browsers/child servers. Keep the existing MOCK MODE flows/a11y passing.

### WUI-06 - MINOR - UI - group connectors change the canonical visual design

**Location:** `web/src/features/floor/floor-canvas.tsx:465`, `:482`.

**What is wrong:** `GroupThreads` replaces the canonical monochrome dotted connectors with a hardcoded six-color palette, twice the opacity and a thicker line. This changes every group, including existing seated groups, rather than only adapting data for newer waitlist grouping.

**Why / impact:** The canonical working tree is the design authority and the UI task prohibits redesign without a decision. Group identity can already be shown through canonical symbols/connectors; preserving newer grouping semantics does not require a new visual palette. Hardcoded colors also bypass the canonical theme tokens.

**Evidence:** Direct `git diff --no-index` against the actual canonical `src/features/floor/floor-canvas.tsx`: canonical `stroke="var(--foreground)"`, opacity `0.45`, width `1.4`, dash array `0.1 3.6`; target palette stroke, opacity `0.9`, width `2.2`, dash array `0.1 3.2`. No palette decision appears in the binding brief. The CSS and the two pending owner tokens themselves match exactly.

**Concrete fix:** Restore canonical connector stroke/opacity/width/dash styling while retaining correct group IDs, table membership and useful accessible group descriptions. If a different palette is desired, present a concrete design change to the coordinator for owner review; it is not needed to preserve grouping functionality.

**Verify:** Source comparison must show canonical connector styling, and screenshots of grouped reservations/visits in dark and light modes should preserve canonical connectors and distinct group symbols. Multi-table assignment/check-in/group tests must continue to pass.

## Commands and results

Commands ran in `web` unless noted. All test results were independently rerun during this review.

| Command/check | Result |
| --- | --- |
| `pnpm typecheck` | PASS, exit 0. |
| `pnpm lint` | PASS, exit 0; 11 existing UI warnings: fast-refresh exports in booking-pickers/booking-list/quick-form/mobile-ui; memoization in floor-page; effect/state dependencies in mobile-app/mobile-list/mobile-form. No data warnings. |
| `pnpm test` | PASS, 12 files / 173 tests. |
| `VITE_API_MODE=http; pnpm build` without a configured base URL | Expected configuration refusal: `Production build yêu cầu VITE_API_BASE_URL`. |
| `VITE_API_MODE=http; VITE_API_BASE_URL=/api/v1; pnpm build` | PASS, TypeScript + Vite production build, 3063 modules. |
| `VITE_API_MODE=mock; VITE_API_BASE_URL=/api/v1; pnpm exec vite build --mode staging` | Expected refusal, exit 1: requires HTTP production mode. |
| Production bundle inspection | No mock-named chunk and no `MockGamApi`/`WAITLIST_ASSIGNED_TO_RESERVATION` implementation markers. The shared clock's reset method name remains; that name alone is not mock data/API inclusion. |
| Own server: `VITE_API_MODE=mock; npx vite --port 5179 --strictPort` | Started only on 5179; stopped at review completion. |
| `E2E_BASE_URL=http://localhost:5179; PW_CHROMIUM_PATH=...; pnpm e2e` | **MOCK MODE PASS, 15/15 flows**. Covers accepted offer, masking/reveal permissions, late/no-show without auto-cancel, booking/walk-in, conflict/undo and selected-day availability. Does not cover direct-assignment arrival. |
| Same environment, `pnpm a11y` | **MOCK MODE PASS, 24 audited views, zero axe violations**, 12 desktop page/dialog states in both themes. This is not a mobile accessibility audit. |
| Additional desktop/phone browser checks | Reproduced WUI-01, WUI-03 and WUI-04 with real mock modules; HTTP transport fixtures reproduced WUI-02 and auth fixture failure in WUI-05. No real backend request or DB write. |
| `pnpm e2e:phase2a`; `pnpm e2e:layout` | FAIL, each exit 1 / missing deleted file, WDATA-R1-01. |
| Canonical UI source/assets comparison | 70 equal, 13 different, zero missing in compared groups; both pending tokens exact. No claim of a full rendered pixel-diff baseline: screenshots were inspected, source compared, but canonical was not launched on another port. |
| `git diff --check 0acec2f -- web` from repo root | PASS, exit 0 (existing Git LF/CRLF notices only). |
| Live API/MySQL E2E | NOT RUN: no-DB-write review boundary. |

## Fix instructions for the worker

### UI owner

1. **WUI-01 / MAJOR:** Treat a linked reservation-backed HOLD_ACTIVE entry independently of the optional offer-hold object. Desktop and mobile must resolve its booking, show its stored count/tables and check it in with the observed version. Preserve the mock offer-only conversion fallback. Add direct-assignment -> arrival browser coverage for both kinds and null-hold HTTP responses, asserting no visit until check-in.
2. **WUI-02 / MAJOR:** Route HTTP waiting entries to supported reservation-hold assignment, with server permission checks, without claim/offered-table contact calls. Make supported assignment/contact logging reachable for non-IN_PERSON desktop entries too. Retain mock contact/offer behavior and advance-first ordering.
3. **WUI-03 / MAJOR:** Carry export/statistics and classification into Mobile V1's actual list/form/detail paths using canonical components, the shared data layer, selected business date and permissions. Cover 390px creation and cross-browser O/N export refresh with masked phones.
4. **WUI-04 / MAJOR:** Remove the editable count from waitlist assignment under the frozen stored-count contract. Render and filter with the stored size; direct count changes through a supported edit path first. Keep ordinary walk-in entry editable.
5. **WUI-05 / MINOR:** Repair both retained HTTP scripts' contracts and canonical selectors without deleting their assertions. Fix auth roles/date/catalog fixtures; adapt phase2b to canonical desktop/mobile, Radix and floor picker interactions. Obtain real isolated-DB execution evidence from the authorized coordinator/worker, separately from mock/transport tests.
6. **WUI-06 / MINOR:** Restore canonical group connector styling; retain group semantics/symbols and accessibility. No new palette is necessary for this integration.
7. Rerun typecheck/lint/test/HTTP production build, MOCK MODE flows and a11y, and the new desktop/mobile regressions. Update the UI report to describe actual evidence and remaining limitations. Do not change the pending owner tokens, backend, data contracts, canonical source or database.

### Data owner

1. **WDATA-R1-01 / MINOR:** Remove the `e2e:phase2a` and `e2e:layout` package entries targeting deleted files, or map them to explicitly maintained canonical checks if compatibility is required. Keep the two retained HTTP E2E commands and the canonical mock/a11y commands.
2. Preserve all three WDATA fixes and their passing regression tests. Coordinate script/config needs for WUI-05 through the coordinator; do not edit UI-owned files or broaden backend contracts.

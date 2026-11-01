# Merge develop Boss review - 2026-11-01

Verdict: **CHANGES_REQUESTED**

One MAJOR and six MINOR findings remain. The required API/web gates, mock flows and accessibility suites pass, but they do not cover the incorrect date used for reservation assignment, incomplete Phase 2B translation, or the additional negative cases below. No backend implementation change is requested.

## Scope and evidence boundaries

- Reviewer task `task_1ffc96e9b3be`, dispatch `ctx_0a1688fffbfa`, session `orca_session_id:a80c0f46-b073-49ab-b128-c63a1cb0b882`.
- Reviewed HEAD `37077a817e5389d0015f4311c98666050d594cde` on `Doirangmuoi/feature-canonical-ui-web`, both `git diff 56b71a1 37077a8` and `git diff origin/develop 37077a8`, develop's changes to the deleted replacement pages, the prescribed worker specifications/reports, and the unreviewed UI round-2 implementation in `178a2ea`. `origin/develop` is `9c31041` in this review.
- Read the Boss workflow/template and task instructions. Agentmemory recall succeeded; returned historical review/command fragments were context, not additional decisions. No `.codegraph/` or additional repository AGENTS.md was found. Used the Orca CLI skill. No sub-agents were launched.
- Browser verification used only the reviewer's mock Vite server at **5179** and installed Chrome. Additional Playwright probes ran from stdin, with changes confined to browser memory. One probe shifted browser time forward by a day. They did not access an API/database. Measurements and traces are reproduced below; temporary screenshots were visually inspected outside the repository.
- API integration tests used the explicitly permitted `gam21_platform_it_test`, with MySQL default host `127.0.0.1` and port **3306**, as configured by `api/src/config/env.ts`. The suite's fixture setup/cleanup is the only database mutation performed. No migration command, dev DB access, live Phase 2B run, commit, merge, push or server on 3000/5173 was performed.
- Only this review report was intentionally edited. Existing untracked root `e2e/` was present at entry and left untouched. Standard commands generated ignored build/cache/E2E artifacts. The owned 5179 process was stopped and absence of its listener verified.

## Findings

### MD-01 - MAJOR - web-ui - reservation assignment uses today's floor for another business date

**Locations:** `web/src/features/reservations/reservation-detail.tsx:94`, `:97`; `web/src/features/reservations/reservations-page.tsx:294`; `web/src/features/floor/floor-page.tsx:118`; corresponding mobile path `web/src/features/mobile/actions.ts:21`, `web/src/features/mobile/map.tsx:47`.

**Problem and impact:** Both desktop entry points force Live mode, and the pickable set comes from `model.freeIds` for today. The booking's date is only printed in the hint. Mobile assignment also uses the live model without carrying the booking date into its map. Consequently staff see today's occupied/free tables when assigning tomorrow's booking. Develop's deleted assignment UI queried tables for `booking.businessDate`; that behavior has not been carried into the canonical equivalent. Server conflict checking protects data, but cannot make this picker display the correct availability.

**Evidence:** In an independent 1280x800 mock browser, created a hold on B7 for `2026-11-01 22:00`, then an unassigned three-person booking for the same date/time. `api.getAvailability` returned B7 `reserved`, with `claimStartsAt=2026-11-01T15:00:00.000Z`. Opening the target's `Phân bàn` showed `Bàn B7, Chưa đặt`, `aria-disabled=false`; UI state was Live with `availDate=2026-10-31`. The wrong table could be selected and the assignment did not complete. The inverse was also reproduced: A3 was available in the next-day preview but disabled as today's occupied table in this picker, while direct `api.assignTables` for the target date succeeded. These are mock browser observations; the production source uses the same picker and the API's same-date assignment conflict rules are independently covered by the passing MySQL suite.

**Concrete fix:** Carry business date, arrival instant and the booking's existing table IDs through desktop/mobile assignment requests. Fetch and render the selected booking context; derive eligibility from that context and allow the booking's own retained tables when reassigning. Keep visit movement/check-in on their appropriate live/business-date rules and keep current carry-over occupancy visible until actually released. Do not globally discard earlier allocations or change API allocation semantics to make this picker pass. Show the selected date truthfully, and keep capacity, kind, version and conflict validation.

**Verify:** At 1280x800 and 390x844, cover both directions: table free today but held tomorrow must be unavailable to tomorrow's booking; a table available in the requested-date response must not be rejected using today's response. Include initial assignment, reassignment retaining a source table, both entry points, and a conflict arriving between selection and confirmation. A synthetic HTTP browser run must show date-scoped reads and correct mutation IDs/observed version; retain the live carry-over tests. The coordinator can then verify on the isolated E2E database.

### MD-02 - MINOR - e2e - Phase 2B still assumes controls/layout that canonical UI does not render

**Locations:** `web/e2e/phase2b-booking.mjs:138`, `:142`, `:210`, `:279`, `:282`, `:292`, `:328`.

**Problem and impact:** The merge reintroduced horizontal-picker assumptions, and other retained interactions still do not match canonical UI. The live suite cannot reach its persistence, cross-context and mutation assertions. Passing `pnpm e2e` does not execute this file.

**Evidence:**

- Desktop probe found **0** radiogroups named `Giờ khách dự kiến đến`. Actual time groups were `Tối 31/10` with 10 radios and `Sáng hôm sau, 01/11` with 3. Thus line 140's count is 0, not 13. Even fixing the locator leaves the one-row assertion and horizontal-wheel assertions incompatible with the approved two-grid design.
- At 390x844, the round-2 date selector correctly selected tomorrow and returned `aria-pressed=true`. The next newly added `getByRole('button', {name:'Đặt bàn mới'})` timed out: Mobile V1 uses `Tạo mới` and its create sheet. Its separate FormScreen has date-named grids, not the named horizontal radiogroup; dismissal uses the canonical back/leave flow rather than the script's assumed desktop Escape behavior.
- The A3 disabled-state selector still says `Ngưng hoạt động`; actual canonical `STATE_META.oos.label` is `Ngưng phục vụ`.
- A future-booking reassignment probe observed `pickSelection=[]` immediately after `Đổi bàn`. Lines 328-330 click A1, A2 and A4, so they select three destination tables rather than removing an initially selected A1. The following expected `A2 + A4` cannot follow from that selection. This must be adjusted to the final picker behavior after MD-01.

**Concrete fix:** Translate the entire browser sequence, not only the first failing locator. Scope all 13 time slots across the canonical groups, assert their grid arrangement/no overflow, keyboard selection and next-day preview, and remove the obsolete horizontal-row/wheel requirements. Open/close the mobile form through its real controls; retain a meaningful touch/scroll/reachability check. Use actual disabled labels and select the intended complete reassignment destination. Preserve polling, classification, masking, persistence, O/N statistics, reload, cancellation and cleanup assertions. Do not redesign the UI to satisfy the old test.

**Verify:** Replay the full browser portion against intercepted HTTP responses without invoking the file's DB setup/startup/cleanup code. Check request dates and payloads, not just text. Then the coordinator runs the full file on its approved isolated E2E DB and records every advertised result. This review deliberately did not run Phase 2B against any database.

### MD-03 - MINOR - e2e - the repaired phone regression expires after one business date

**Location:** `web/e2e/flows.mjs:286`, `:346`.

**Problem and impact:** Both setup and verification hardcode `2026-10-31`, while `SimClock.resetToScenario()` and seed data use the current business date. The repaired test passes today because the review ran before the 05:00 cutoff; subsequent business dates fail before exercising mobile arrival. This creates a predictable acceptance-suite failure.

**Evidence:** Ran the exact retained phone flow body in memory with browser Date shifted forward 24 hours. Actual scenario business date became `2026-11-01`; result was `page.evaluate: Error: Target waitlist entry Chị mặc váy đỏ not found`. The unchanged full suite passed on the current `2026-10-31` scenario. The new card scoping, both waitlist kinds, reservation-backed null-offer-hold assertions and group/arrival assertions otherwise correct the former false positive.

**Concrete fix:** Derive one date from `businessDateOf(clock.now())` or the loaded floor, capture it with the target entry IDs, and pass the same date to subsequent reservation/waitlist/visit reads. Keep all target identity and lifecycle assertions. Avoid changing wall time globally or pinning production seed data to a review date.

**Verify:** Run this exact flow for at least two consecutive business dates and around the venue cutoff. Both kinds must prove target HOLD_ACTIVE, non-null reservation ID, null offer hold, BOOKED before arrival, then one linked visit, target SEATED and preserved group. The full mock suite must remain green.

### MD-04 - MINOR - web-ui - an expired selected slot removes keyboard access to all remaining times

**Location:** `web/src/components/booking-pickers.tsx:224`.

**Problem and impact:** The fallback tab stop is granted only when `value` is not any booking slot. When a valid selected slot becomes past, its button is disabled while every remaining enabled slot has `tabIndex=-1`. Keyboard users cannot enter the picker to choose a later time. The merge's new roving-tab behavior introduces this relative to the canonical grid.

**Evidence:** At 390x844, opened the seeded 22:00 booking's edit dialog at scenario 21:30. Initially `22:00` was the enabled tab stop. Advanced only the in-memory clock by 31 minutes: checked 22:00 became disabled; enabled slots were 22:30, 23:00, 23:30, 00:00, 00:30 and 01:00; enabled tab-stop count became **0**. Focusing `Tăng số khách` and pressing Tab jumped directly to `ed-source`, skipping every time slot. Ordinary ArrowRight/Home/End on a future-date picker passed, including the 01:00 next-calendar-date preview.

**Concrete fix:** Choose the roving tab stop from an enabled selected slot; if none exists, use the first enabled slot regardless of whether the old value is syntactically a slot. Preserve unchanged legacy/past booking values and require an explicit selection to change the schedule. Do not silently replace the stored time.

**Verify:** With a stored valid-but-past slot, an invalid/legacy slot, a future slot, and a slot expiring while the dialog is open, Tab must reach an enabled time whenever one exists; arrows/Home/End must update selection and focus. When all times are past, keep the explanatory state. Repeat desktop/mobile edit and existing a11y checks.

### MD-05 - MINOR - web-ui - direct-booking selection omits develop's compatible-table validation

**Locations:** `web/src/features/floor/quick-form.tsx:45`, `:119`, `:143`; `web/src/features/floor/floor-page.tsx:135`; `web/src/features/reservations/booking-sheet.tsx:137`, `:144`.

**Problem and impact:** The canonical create pickers validate each table's availability and aggregate capacity, but do not require one zone and one table kind. Develop's direct-booking selection enforced both, and `/bookings/direct` still rejects invalid sets. A user can complete the canonical form with a selection that cannot succeed against HTTP, even though the ported mock scenario reports success.

**Evidence:** In the normal 1280x800 UI, opened Ghế Bar 8, chose `Đặt trước`, then tapped B7 on the availability canvas. Draft became `{date:'2026-10-31', time:'22:00', party:4, tableIds:[108,10]}`. Filling a name and saving succeeded in mock; both labels became `Đang đặt, Boss invalid direct, 4 khách, nhóm 8`. These tables are BAR_SEAT/zone 4 and TABLE/zone 2. The real path uses `lockAndValidateAssignableTables`, whose zone/kind checks at `api/src/modules/tables/table-group.repository.ts:75` reject that combination. Source comparison also finds no set-level compatibility check in the multi-step booking sheet.

**Concrete fix:** Constrain additional direct-booking tables to the chosen zone/kind and revalidate the complete selection before proceeding/submitting, including after date/party changes or prefills. Keep canonical canvas/form layout, the capacity warning, selecting multiple compatible Bar seats, and the option to receive an unassigned booking. Apply these restrictions to creation, not the intentionally supported cross-zone reassignment/visit-move paths.

**Verify:** Through the actual floor form and booking sheet, mixed kind and cross-zone direct sets must be unavailable or produce an actionable inline error before a mutation. Same-zone/same-kind multi-seat bookings must send one atomic direct request; unassigned creation must still send ordinary `/bookings`. Keep cross-zone move/reassignment positive coverage.

### MD-06 - MINOR - web-data - mock booking validation still accepts sets rejected by the merged API

**Locations:** `web/src/services/mock/server.ts:754`, `:809`, `:882`, `:891`.

**Problem and impact:** `createReservation` and `assignTables` rely on `assertClaimable`, which does not check set-level table kind or direct-create zone consistency. Thus the mock does not expose the hardening it is supposed to mirror and green UI/E2E results can mask HTTP-only failures. Fixing only the UI leaves direct adapter regressions undetected.

**Evidence:** Separate browser-memory API probes accepted a future direct booking with mixed TABLE/BAR_SEAT IDs `[1,101]` and another with TABLE IDs `[2,10]` in different zones. Both created reservations, whereas the real direct endpoint uses the same-zone/same-kind validator. The normal UI reproduction in MD-05 confirms the gap is reachable without calling private methods. `assignTables` likewise lacks the API's same-kind check. Its capacity/spare override logic also must not be reused to bypass rules the matching HTTP booking/move endpoints enforce strictly.

**Concrete fix:** Add operation-specific mock validation matching the actual endpoints: direct create requires same zone and kind; reassignment and visit moves allow cross-zone but require same kind; enforce the corresponding strict capacity/spare rules. Reject atomically with the matching conflict semantics and leave no reservation, hold, group, allocation or successful operation behind. Preserve unrelated, approved mock walk-in override demonstrations rather than globally changing `assertClaimable` behavior.

**Verify:** Add meaningful mock boundary/rollback cases for mixed kinds, cross-zone direct create, insufficient capacity and spares, plus valid same-zone multi-seat create and valid cross-zone reassignment/movement. Compare with the existing MySQL assignment cases; then run web tests, mock flows and a11y. No dev database is needed.

### MD-07 - MINOR - web-data - cleanup stopped before removing the replacement-only service surface

**Locations:** `web/src/services/index.ts:10`, `:20`, `:44`; `web/src/services/http/direct-booking.ts:6`; `web/src/services/http/waitlist-api.ts:1`; `web/src/services/http/booking-api.ts:81`, `:103`, `:111`; `web/src/services/http/booking-adapter.ts:82`, `:232`.

**Problem and impact:** The replacement pages are gone, but service exports, duplicate instances and their orphan selection/adapter code remain. The data-worker specification explicitly required removal once no importers remained; its report accurately deferred cleanup while the UI worker still had those files. Final integration never completed that dependency. Tests of obsolete selection code do not establish that the canonical picker uses its validation, as MD-05 demonstrates.

**Evidence:** Repository-wide `rg` for these symbols found no canonical UI consumers. `bookingApi`, `visitApi` and `waitlistApi` occur only in the barrel. `HttpWaitlistApi`, its entry types and `activeWaitlistEntries` are used only within that obsolete file/barrel. `directBookingSelection` is imported only by its tests/barrel. `assignmentTables`, `assign(current,...)`, `cancel(current,...)` and `mapAssignmentTable` have only old helper-test callers. `createHttpApi` creates and uses its own `HttpBookingApi`/`HttpVisitApi` and directly implements waitlist transport.

**Exact deletion list and concrete fix:**

1. In `services/index.ts`, remove the three legacy singleton exports and their HttpBookingApi/HttpVisitApi/HttpWaitlistApi imports; remove the replacement-only public reexports at lines 44-47. Keep `api`, `demo`, `authApi`, `httpClient`, clock and canonical contracts.
2. Delete `services/http/waitlist-api.ts` in full, after removing its barrel references.
3. Remove `directBookingSelection` and its AssignmentTable/TableView imports from `services/http/direct-booking.ts`. Keep `createAndAssignDirectBooking`, which the live canonical adapter still calls. Remove only the two obsolete selection cases and their table factory/type imports from `direct-booking.test.ts`; keep atomic-request/failure coverage.
4. Remove `HttpBookingApi.assignmentTables`, the unused `assign(current,...)` and `cancel(current,...)` convenience wrappers and their now-unused imports. Keep `assignVersion`, `cancelVersion`, all other methods used by `createHttpApi`, and the classes themselves.
5. Remove `AssignmentTableState`, `BackendAssignmentTablePayload`, `AssignmentTable` and `mapAssignmentTable` from `booking-adapter.ts`. Remove its orphan mapping test/import. In `booking-api.test.ts`, retarget cancellation/assignment checks to `cancelVersion`/`assignVersion`, remove the obsolete assignment-table GET assertion, and preserve the mutation URL/body/version coverage. Keep the internal HttpBooking/BookingWriteFields/BookingClassification definitions used by the real adapter; removing their barrel reexports is sufficient.

**Verify:** Search for each deleted symbol and the deleted page names; no production orphan or broken import should remain. Run typecheck, lint, web unit tests and HTTP build. Canonical HTTP contract tests must still prove direct create, cancellation, assignment, check-in and waitlist transport. Do not delete adapters merely because their old public singleton is unused.

## Migration 0007 and backend reconciliation

**Technical assessment: acceptable; no API code finding.** The original `ck_table_groups_dissolve` in 0001 requires a staff actor whenever a group is dissolved. The merged worker correctly uses SYSTEM/null actor for automatic end-of-day cleanup. Without 0007 that update would violate the existing constraint. Adding a nullable reason with the narrow `BUSINESS_DAY_END` exception is consistent with 0006's visit/allocation actor exceptions, leaves existing rows valid, retains chronological validity, and keeps manual dissolution attributable to a staff user. Existing migration files were not rewritten. A new migration is justified if automatic group cleanup is retained; attributing it to a fabricated staff account would be worse.

The cleanup uses the same transaction as visit closure, releases only active USAGE allocations, and dissolves only groups with no remaining active allocations. It preserves CHECKED_IN reservations and already terminal SEATED waitlist rows. Candidate version/cutoff checks, idempotency and venue/organization predicates remain. The passing `business-day.mysql.test.ts` exercises the HTTP advance-waitlist hold/check-in/carry-over path, exact cutoff, group removal and terminal history; a forced audit failure proves rollback of visits, allocations, groups, waitlist history, venue sequence and logs. Existing assignment tests also cover direct atomic creation, duplicate allocation races and direct-create audit rollback. The mock mirrors auto-close, disabled-worker carry-over and non-undoable SYSTEM behavior.

This technical assessment does **not** authorize applying 0007 to dev. The worker report records application only to the two test databases. Before any owner-approved rollout, the coordinator should provide a matching pre-migration backup and rollback plan. Once system-dissolved rows with null staff actors exist, restoring the old CHECK cannot preserve those rows unchanged; rollback should restore a compatible pre-migration snapshot or use a deliberately reviewed forward correction, not invent actor IDs. No rollback/migration was attempted in this review.

## UI round 2 and canonical preservation

| Item | Result |
| --- | --- |
| WUI-05 empty lists/date controls | The two empty-state strings now match canonical UI. The scoped mobile tomorrow selector selected the correct button in the browser. Overall Phase 2B remains incomplete due to MD-02. |
| WUI-R1-01 phone target scoping | Both kinds now use the intended target, reservation-backed HOLD_ACTIVE/null offer hold, normal arrival and group assertions. The retained current-date case passed; MD-03 fixes its date dependence. |
| WUI-R1-02 responsive edit dialog | Fixed in the sampled layouts. At 390x844 the dialog was `x=16,y=16,width=358,height=812,bottom=828`; title `y=41`, close `y=29`, scrollable body `clientHeight=580,scrollHeight=811`. At 390x600 the dialog and footer remained on screen, with save/cancel bottom at most 564. Dark/light samples passed. |
| Caption suspected to clip | Not reproduced: `mốc 30 phút hiện có` wrapped onto two lines at 390px. Caption right edge was 349 inside the body; body `scrollWidth=clientWidth=356`. The screenshot showed the full caption. No new clipping finding. |
| WUI-02 remaining mobile contact logging | Agree with the coordinator's rejection from this integration scope. Canonical `21gam-platform/src/features/mobile/wait.tsx:169` explicitly directs CONTACTING/OFFERED contact logging to tablet/desktop in V1. Keep it in the owner backlog; do not add a new phone workflow during this merge. Supported assignment/arrival and desktop contact logging remain required. |

Source comparison with `D:\GAM-APP\21gam-platform` found `shell.tsx` differs only by the justified demo guard around simulation controls. The booking sheet retains canonical layout, including `sm:grid-cols-5`; differences add approved classification and stricter capacity handling. Floor-page layout remains canonical; changes add the capacity summary. The shared picker retains the two canonical grids and adds useful selected-date preview/keyboard behavior, with MD-04 to repair. Desktop and mobile screenshots were inspected; this was not a separately rendered full-app pixel-diff of the canonical tree.

A targeted mock browser moved a two-person visit from B5 to **A0 + B7**, across zones, and both destination labels showed the same group and visit. Existing passing flows preserve hold-first waitlist arrival, warning-only late/no-show behavior, stored check-in counts, masking/reveal role differences, conflicts, undo and the new Bar walk-in/multi-seat scenarios. API tests retain owner-only configuration, audit/security, hold flow and carry-over guarantees. No regression was established in those backend/security areas.

All deleted replacement page/controller/test paths remain absent, including `http-floor-page.tsx`, `layout-booking-operations.tsx`, `layout-table-move.tsx`, `use-layout-table-controller.ts` and its test, `http-bookings-page.tsx`, `layout-waitlist.tsx`, `layout-table-merge.tsx`, and `web/e2e/layout-first.mjs`. MD-07 concerns the remaining data-layer surface, not restoration of these pages.

## Commands and independent results

| Command/check | Result |
| --- | --- |
| `api/`: `pnpm typecheck` | PASS, exit 0. |
| `api/`: `pnpm lint` | PASS, exit 0. |
| `api/`: `DB_NAME=gam21_platform_it_test RUN_MYSQL_INTEGRATION=1 npx vitest run` | PASS, 23 files, 257 tests, 57.24s, exit 0. Port 3306; never 3307. |
| `web/`: `pnpm typecheck` | PASS, exit 0. |
| `web/`: `pnpm lint` | PASS, exit 0, 11 warnings in UI files. No lint errors. |
| `web/`: `pnpm test` | PASS, 13 files, 190 tests, 30.17s, exit 0. Final merged tree has fewer tests than the data worker's intermediate tree because replacement-page tests were deleted. |
| `web/`: `VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 pnpm build` | PASS, production build completed, exit 0. |
| Own mock Vite `npx vite --port 5179 --strictPort` | Started successfully; stopped after verification; no remaining listener. |
| `E2E_BASE_URL=http://localhost:5179 PW_CHROMIUM_PATH=C:/Program Files/Google/Chrome/Application/chrome.exe pnpm e2e` | PASS, all 20 flows. |
| Same environment, `pnpm a11y` | PASS, 12 views in each of dark/light themes, `NO VIOLATIONS`. |
| In-memory Playwright probes | Confirmed MD-01 through MD-06 observations, corrected date selector, responsive edit layout, ordinary keyboard/next-day preview, and cross-zone grouped movement. No live Phase 2B claim. |
| `git diff --check 56b71a1 37077a8` | Two trailing-whitespace notices at `docs/integration/merge-develop-e2e-report.md:3` and `:4`, which are Markdown hard-break spaces; not promoted to a finding. |
| Orca follow-up checks | Successful checks returned count 0. Some heartbeat/check calls temporarily timed out; later checks/heartbeats succeeded. |

## Fix instructions for the worker

Assign one worker to each owner area below. File sets are disjoint; the coordinator should put these explicit scopes in the next prompts. The UI worker owns the small UI-state metadata changes needed for date-aware picking, including `state/ui.ts`, so the data worker must leave that file alone in this fix round.

1. **web-ui - MD-01 first, then MD-04 and MD-05.** Own `web/src/components/booking-pickers.tsx`, `web/src/state/ui.ts`, and the necessary files under `web/src/features/{floor,reservations,mobile}/` (including mobile context/map and picker callers). Carry selected reservation date/time and retained IDs through assignment; render eligibility from that context, preserving live carry-over and cross-zone reassignment/movement. Repair the enabled roving tab stop without changing stored schedules. Validate same-zone/same-kind direct creation in both canonical forms while preserving multi-seat Bar and unassigned creation. Keep all styling local and canonical. Do not touch services, API, E2E files or this report. Supply a separate UI fix report.
2. **web-data - MD-06 and MD-07.** Own only `web/src/services/index.ts`, `web/src/services/mock/server.ts` and its test, `web/src/services/http/{waitlist-api.ts,direct-booking.ts,direct-booking.test.ts,booking-api.ts,booking-api.test.ts,booking-adapter.ts,booking-adapter.test.ts}`. Mirror operation-specific API validation/atomic rejection and execute the exact dead-code deletion list, retaining real canonical adapters and mutation contract coverage. Do not change `state/ui.ts`, UI files, E2E or API. Supply a separate data fix report.
3. **e2e - MD-02 and MD-03.** Own `web/e2e/phase2b-booking.mjs`, `web/e2e/flows.mjs` and a separate E2E fix report. Translate the entire Phase 2B browser sequence to canonical controls, grids and final assignment selection. Derive/carry the scenario date for both phone setup and verification. After UI/data integration, add or run behavioral regressions for the date-aware assignment, invalid direct sets and expiring keyboard selection. Preserve all existing lifecycle/security assertions and distinguish mock, HTTP transport fixture and live-DB evidence. Do not run Phase 2B against any database; the coordinator owns that final isolated-DB execution.
4. **api - None.** Keep 0006/0007 and the reconciled worker unchanged unless new evidence requires a separate review. Owner authorization, backup and rollback planning remain prerequisites for any later dev migration.

Rerun the prescribed API/web gates, HTTP build, all mock flows and both-theme a11y after integration. The coordinator should independently confirm MD-01 and perform the approved isolated-DB Phase 2B run after the script is repaired. No push, merge, dev migration or deployment is authorized by this review.

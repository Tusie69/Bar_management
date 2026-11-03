# MERGE_WEB_DATA integration report

Date: 2026-10-31. Task: `task_04e306eb0257`. Dispatch: `ctx_6e1a14dcce41`.

## Result and scope

Ported the canonical working-tree data layer from `D:\GAM-APP\21gam-platform\src` into this worktree's `web/src`: config, services, state, domain, lib, data/action hooks and auth. The canonical HTTP adapter now implements the actual REST paths instead of the former proposed-endpoint adapter. Retained Tutuong's newer business rules and adapters where canonical lacked them. Changes are uncommitted and unpushed; no backend, UI-owned files or database were modified by this worker.

Copied canonical Vite production guards and local-env ignores. Added the canonical mobile font dependency `@fontsource/be-vietnam-pro`, updated the root pnpm lockfile, and switched the package check script to pnpm. Existing TypeScript and Vitest config already matched canonical and needed no changes. Existing non-data hooks are unchanged; the coordinator confirmed the UI worker will copy `use-drag-scroll.ts`.

## Tutuong features preserved through GamApi

| Feature | Mapping and behavior |
| --- | --- |
| Waitlist groups | `seatWaitlist` posts the observed version and complete table ID set to `/waitlist/:id/seat`, returns required `reservationId` and nullable `groupId`, and reports assignment rather than seating. Both waitlist kinds result in a BOOKED reservation hold; an advance entry reuses its reservation. Normal booking check-in creates the visit later. Floor projection retains server group identity and symbols. Mock uses the same hold flow and retains group identity at check-in. |
| Zalo text export | New `api.exportDailyBookingText(businessDate)` delegates to `HttpBookingApi.exportDailyText` and returns the backend plain-text response verbatim. New `useBookingExport(date, enabled)` uses a date-specific key, disables retries and refreshes every 15 seconds while enabled. It only reads text; clipboard and sending remain UI responsibilities. |
| Statistics and classification | Retained validated `RETURNING`, `NEW`, `UNCLASSIFIED` classifications in HTTP payloads, canonical `ReservationView`, create/update inputs, full PUT preservation and mock rows. Backend export remains authoritative for the 21:30 arrival split, guest totals and O/N/unclassified counts. Mock export reuses a local copy of the backend's pure privacy-allowlisted US-07 formatter with mock rows. No new statistics endpoint or invented HTTP totals were added. |
| Reception window | Retained 19:00-01:00 inclusive rules, 30-minute UI slots, 24-hour labels and next-calendar-day handling. Mock enforces the window for create/time changes while leaving unchanged legacy schedules editable. The reception-window helper now also rejects invalid hours/minutes. HTTP writes retain backend validation and +07:00 timestamps. |
| Business-date isolation | `getFloorState(at, selectedDate?)` and `useFloorState(selectedDate?)` preserve selection. Booking, waitlist and table reads reject mismatched response dates with `BUSINESS_DATE_RESPONSE_MISMATCH`. Date-based queries no longer display another date's placeholder data. Mock floor selection, groups and reservation searches stay within the selected date. |
| Waitlist contact data | `addWaitlist` accepts an optional business date and phone for walk-ins, while advance entries derive their date and identity from the linked reservation. Masked phone suffixes are mapped on reads; raw phone is not exported. |

The coordinator confirmed the hold/group semantics and the parallel backend worker's advance-waitlist, contact-attempt and cancel endpoints. These paths were also inspected in the target backend working tree.

## GamApi method status

All listed domain methods remain implemented by the development mock. HTTP unsupported methods explicitly reject with `501 NOT_SUPPORTED_BY_BACKEND` and never fall back to mock data.

| Method(s) | HTTP status and source |
| --- | --- |
| `setSession`, `listDemoUsers` | Local adapter session metadata only; server session determines venue scope. |
| `subscribe` | No-op unsubscribe; polling drives HTTP updates, with no invented event feed. |
| `getCatalog` | `/tables/catalog` and `/bookings/sources`; shared 60-second cache, scoped to client/session revision and invalidated on configuration writes including failed responses. |
| `getFloorState` | `/tables?date=` plus selected-day bookings and catalog. |
| `getAvailability` | Derived from the requested day's real floor/bookings/catalog; no inferred visit duration. |
| `getShiftOverview` | Derived from current floor/bookings/waitlist; unavailable historical totals stay null. |
| `listReservations` | `/bookings?date=` or `/bookings/search?date=&q=`; classification and requested-date validation. |
| `exportDailyBookingText` | `/bookings/export?date=`; backend plain text including statistics. |
| `listWaitlist` | `/waitlist?date=`; preserves server order and linked reservation timing. |
| `createReservation` | `/bookings`, then optional `/bookings/:id/assign`; preserves the created booking and returns an explicit partial-success error if assignment fails. |
| `updateReservation` | Detail GET followed by full PUT with the caller's observed version, including classification. |
| `assignTables`, `cancelReservation`, `markNoShow` | Actual `/bookings/:id/assign`, `/cancel`, `/no-show` routes. |
| `checkIn` | Optional table assignment, then `/bookings/:id/check-in`; keeps observed versions and the assignment response version. |
| `seatWalkIn` | `/bookings/walk-ins`. |
| `moveClaim`, `combineTables` | Visit move/merge or reservation assign/merge routes; retain other tables and observed versions. |
| `endVisit` | `/visits/:id/close` with manual close reason. |
| `setTableStatus` | `/tables/:id/configuration`; reason required for service-status changes. |
| `addWaitlist` | `/waitlist`; advance identity comes from reservation detail. Preferences beyond ANY explicitly reject as unsupported. |
| `seatWaitlist` | `/waitlist/:id/seat`; creates/reuses reservation hold and group, returns their IDs. The retained canonical `guestCount` input is not sent because backend uses the stored party size. |
| `recordContact`, `cancelWaitlist` | `/waitlist/:id/contact-attempts`, `/cancel`; contact does not claim, offer or hold tables. |
| `revealPhone` | Owner-authorized booking `/phone:reveal`; unsupported for a waitlist entry without a linked reservation. |
| `listVisits`, `searchCustomers`, `getCustomer`, `listOperations`, `listAllocations`, `getReport` | Explicit 501; no matching read capability in the frozen backend contract. |
| `splitGroup`, `markPaid`, `claimWaitlist`, `releaseClaim`, `setHoldDeadline`, `releaseHold` | Explicit 501. |
| `updateCustomerNotes`, `undo`, `redo`, `updateVenueConfig`, `setZoneFlags` | Explicit 501. |

## Validation

- `pnpm test`: PASS, 15 files and 183 tests. Includes canonical auth/session, HTTP cache/security/error contracts, classification create/update/read, plain-text export, requested-date mismatch handling, both waitlist kinds, hold-to-check-in group identity, masked phones, reception-window rollback and unchanged core mock tests.
- `pnpm lint`: PASS, exit 0. Seven existing warnings are in UI-owned files: `components/booking-pickers.tsx:29,33,39`, `features/floor/quick-form.tsx:44`, `features/floor/booking-list.tsx:45,123`, `features/floor/floor-page.tsx:109`. No data-layer lint warnings.
- `VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 pnpm exec vite build`: PASS. No mock chunk was emitted. This bundle smoke check bypasses TypeScript; it is not a substitute for the full package build.
- `VITE_API_MODE=mock pnpm exec vite build --mode staging`: correctly rejected by the production guard; alternate Vite modes cannot bypass it.
- `git diff --check -- web pnpm-lock.yaml`: PASS.
- Scoped Prettier check over all owned source directories, hooks, Vite config and package manifest: PASS. Local `.env` and `.env.production` files are ignored.
- `pnpm typecheck`: data-layer clean; blocked by the UI-owned errors listed below. Full `pnpm build` must be rerun after the UI port.

No live API/MySQL E2E or pixel comparison was run by this data-layer worker. Mock/transport tests do not demonstrate database integration.

## UI handoff and remaining integration

1. Replace the old HTTP-only pages with canonical pages and route all retained features through `api`/the canonical hooks. Legacy `bookingApi`, `visitApi`, `waitlistApi`, their types and helper exports remain because old pages still import them at handoff; do not delete them until those callers are removed. The HTTP adapters are also reused internally by GamApi.
2. Wire the Zalo dialog to `useBookingExport(businessDate, open)` or `api.exportDailyBookingText`; retain permission checks, clipboard errors and date isolation. The old dialog currently calls `bookingApi` directly.
3. Retain classification controls in create/edit forms and read `ReservationView.classification`; the data layer supports the complete path.
4. Pass the selected business date into `useFloorState`. Waitlist assignment returns a reservation hold, so show it as waiting/held and check in its reservation separately. Do not label successful assignment as already seated. The backend uses stored party size for this operation.
5. Copy canonical `hooks/use-drag-scroll.ts` as agreed with the coordinator. Required font dependency is already installed and locked.
6. Resolve the current UI-only TypeScript errors, recorded before the UI port lands:
   - `web/src/features/floor/use-layout-table-controller.test.ts:14`: fixture lacks canonical `seating` field.
   - `web/src/features/floor/use-layout-table-controller.test.ts:33`: fixture makes `staleFromPreviousDay` optional.
   - `web/src/features/overview/overview-page.tsx:140`: chart receives nullable unavailable counts; canonical UI handles unavailable data.
   - `web/src/features/waitlist/waitlist-page.tsx:374`: nullable preference mode used as an index.
   - `web/src/features/waitlist/waitlist-page.tsx:430,434,435,436,437`: nullable unavailable contact attempts must be handled explicitly.
7. Rerun full typecheck/build and coordinated mock plus live-backend E2E after both other workers finish. Preserve server-authoritative permissions and canonical nullable fields rather than manufacturing missing HTTP data.

Mock export metadata flags absent from its seed are explicitly documented in code; future metadata controls need matching seed fields. The copied mock-only formatter should be updated if backend export formatting changes. No additional infrastructure, endpoints, abstractions or UI redesign were introduced.

## Fix round 1

Date: 2026-10-31. Task: `task_f3122bf05916`. Dispatch: `ctx_d5b87db48402`.
Applied the complete fix instructions in `docs/reviews/2026-10-31-merge-web-data-boss-review.md`.
The results below supersede the earlier validation snapshot and its outstanding TypeScript/build items.

| Finding | Result |
| --- | --- |
| WDATA-01 / MAJOR | Fixed. HTTP `checkIn` compares `guestCount` with the detail response's `partySize` immediately after its GET, before catalog reads, assignment or check-in writes. A changed count explicitly rejects with `501 NOT_SUPPORTED_BY_BACKEND` and a message explaining that the stored count must be used. Equal counts retain the caller's observed version; changed-table assignment still supplies its returned version to check-in. The backend contract is unchanged. |
| WDATA-02 / MAJOR | Fixed. Mock `seatWaitlist` accepts an existing accepted-offer hold, reuses its tables when `tableIds` is omitted, and ignores only that offer's allocations during conflict validation. It creates the reservation hold and releases the old offer/all of its allocations in the same transaction, preserving the group ID for a multi-table party. A replacement single table dissolves the obsolete group. Advance entries reuse their booking, contact claim metadata is cleared, and assignment creates no visit. Later normal check-in preserves the group and changes the entry to `SEATED`. |
| WDATA-03 / MINOR | Fixed. Mock floor derivation now receives the actual live business date independently of the requested projection timestamp. Only the current live date includes earlier active USAGE allocations and their group members; it exposes the original visit claim and sets `staleFromPreviousDay` from the allocation date. Future previews and historical selected-day projections remain isolated, as do reservation and waitlist reads. Availability planning was not changed. Manual close releases the carry-over occupancy and its group. |

### Regression evidence

Before the implementation changes, the new HTTP transport regression reproduced success for the mismatching count, both accepted-offer mock regressions reproduced `WAITLIST_NOT_SEATABLE`, and the clock-rollover regression reproduced a free table without its visit claim.

- HTTP transport tests cover stored count 4 / actual count 7 both with omitted tables and changed tables, assert the detail GET is the only request and there are zero mutation requests, and cover equal-count check-in with a stale observed version. Existing assignment-version and unchanged-table version tests also pass.
- Public mock API tests cover WALK_IN and ADVANCE_RESERVATION through claim, accepted contact, reservation-hold assignment and normal check-in. They cover both omitted offer tables and an explicit unchanged set, preserved group identity, no visit before check-in, no duplicate advance reservation, stale-version rejection, cleared contact claims and one active allocation per table. Another test verifies a conflicting replacement leaves the offer, reservations and allocations intact, then verifies a successful single-table replacement frees the removed table without leaked allocations or a group.
- The rollover test actually advances `clock` by 24 hours, checks both tables remain seated/stale with their original visit and group IDs, checks date-isolated booking/waitlist reads and historical projection, then manually closes via the returned visit claim and verifies free tables. A separate future-date preview test leaves the live clock unchanged and verifies neither occupancy nor its group appears on the future date. Existing availability and selected-date isolation coverage remains passing.

### Updated validation

All commands ran in `web` after the fixes:

| Command | Result |
| --- | --- |
| `pnpm typecheck` | PASS, exit 0, no TypeScript errors. |
| `pnpm lint` | PASS, exit 0, no data-layer warnings. The 11 UI-owned warnings match the Boss review: `components/booking-pickers.tsx:29,33,39`, `features/floor/quick-form.tsx:44`, `features/floor/booking-list.tsx:45,123`, `features/floor/floor-page.tsx:110`, `features/mobile/ui.tsx:15`, `features/mobile/list.tsx:274`, `features/mobile/mobile-app.tsx:79`, `features/mobile/form.tsx:116`. |
| `pnpm test` | PASS, 12 files / 173 tests, exit 0. |
| `$env:VITE_API_MODE='http'; $env:VITE_API_BASE_URL='/api/v1'; pnpm build` | PASS, exit 0, full TypeScript + production Vite build, 3063 modules. |
| Scoped `pnpm exec prettier --check` | PASS for all five changed source/test files. |
| Scoped `git diff --check` from the repository root | PASS, exit 0. Git emitted only its existing LF-to-CRLF notices. |

### UI handoff

The coordinator was sent the following contract and limitation through Orca status messages:

- HTTP check-in supports the stored reservation count only. Display that count or explain the limitation in the confirmation dialog; do not present an editable actual count as saved in HTTP mode. The adapter now explicitly rejects a different value before writing. Mock check-in continues to support its existing actual-count behavior.
- `GamApi.seatWaitlist(input)` returns `MutationResult & { reservationId: number; groupId: number | null }`. Mock accepted offers may omit `tableIds` to reuse the offer, while the existing HTTP payload remains unchanged. After assignment, `listWaitlist(businessDate)` exposes the linked `reservationId`, `status: "HOLD_ACTIVE"`, and `kind: "ADVANCE_RESERVATION"`; there is no visit yet. Read the booking through `listReservations({ businessDate })` to obtain its observed version, then call `checkIn({ reservationId, version, guestCount })` when the guest arrives. Only that later operation changes the entry to `SEATED`.

Changed only the HTTP adapter/transport tests, mock server/floor derivation/tests, and this report. No UI/backend file, migration, database, canonical source repository or secrets were changed; no commit or push was made. Live browser/pixel/accessibility and API/MySQL E2E were not run in this data-only fix round; the UI owner/coordinator still owns the confirmation-dialog verification and combined E2E.

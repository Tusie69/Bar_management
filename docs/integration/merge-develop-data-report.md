# Develop merge - canonical data integration

Date: 2026-10-31. Worker: task_f419eec5b7a5, dispatch ctx_97a8a9dc8f52.

## Changes

- Resolved the on-disk conflicts in `web/src/hooks/use-data.ts`, `web/src/services/clock.ts`, `web/src/services/http/direct-booking.ts`, and `web/src/services/index.ts`. The index remains unmerged until the coordinator stages the files, as required.
- Kept develop's empty-date waitlist polling guard (`3291adc`), previous-data behavior, and the canonical HTTP retry policy.
- Kept real time as the HTTP clock default and the mock scenario as the mock default. `SimClock(boolean)` remains available for explicit clock-mode tests. Removed the duplicate runtime-config import.
- Canonical `GamApi.createReservation` now sends nonempty `tableIds` through the atomic `POST /bookings/direct` endpoint. Empty or omitted `tableIds` still uses `POST /bookings`. Removed the obsolete partial-success result and `BOOKING_CREATED_UNASSIGNED` branch; an atomic failure propagates without fallback create or retry.
- Reviewed develop's booking payload and API changes. `HttpBookingApi.createAndAssign`, validated/deduplicated direct table IDs, classification, phone handling, venue-offset serialization, business-date checks, and existing update/check-in endpoints remain available through the canonical adapter. HTTP check-in still uses the stored party size.
- Kept develop's zero-minute past-time grace and its reception-window/timezone tests. Restored `bookingSlotGroups`, which is still imported by the canonical mobile form, without restoring the deleted replacement design.
- Extended the existing `MoveInput` as a compatible union. `moveClaim({ claim, tableIds })` replaces the full destination set; `moveClaim({ claim, fromTableId, toTableId })` continues to replace one table. HTTP uses the existing visit move or booking assign endpoint. Mock moves validate the supplied version, capacity, availability, and table kind, and create, retain, or dissolve group identity as needed.
- Mock system ticks now close open visits at the venue's next-day business cutoff, release only their active USAGE allocations, dissolve groups with no remaining active allocations, and emit a non-undoable SYSTEM operation with action `VISIT_AUTO_CLOSED_BUSINESS_DAY` and reason `BUSINESS_DAY_END`. Visit and allocation versions advance transactionally. Closed timestamps use the sweep time, matching the backend worker. `new MockGamApi({ businessDayWorkerEnabled: false })` models a disabled worker; the default is enabled, matching the backend default.
- Added `BUSINESS_DAY_END` to canonical visit-end and allocation-release reason types and supplied readable allocation/audit labels. Checked-in reservations and seated waitlist history are retained. Reservation holds and warning-only behavior are unchanged.

## WDATA-03 reconciliation

Develop's automatic visit close supersedes the earlier expectation that an open visit always remains occupied until manual close. The backend worker's reconciled implementation on disk releases usage and dissolves unused groups while preserving the checked-in reservation and seated waitlist entry; the mock follows those same state transitions.

The existing live carry-over derivation is retained as a fallback for data not yet reconciled by a worker. Future planning previews and selected-date reservation/waitlist reads remain isolated. Regression coverage distinguishes future preview, unreconciled carry-over, immediately before cutoff, exact cutoff, repeated sweeps, historical allocation queries, group release, stale versions, manual close, and non-undoable automatic close.

The coordinator answered Orca question `msg_fd5cb7a50775`: mirror the backend's SYSTEM/USAGE/visit semantics, dissolve groups only when the backend worker adds that behavior, and preserve carry-over while the feature-flagged worker is disabled or has not run. The backend worker now includes unused-group dissolution on disk, so the mock matches it. Status `msg_f91ffd6b8bcf` reports that evidence and the disabled-worker simulation option.

## UI contract messages

Status `msg_e4b6a503dc90` reports atomic reservation creation, classification, zero-minute grace, retained mobile slot grouping, empty-date polling, and the new close reason. Status `msg_edc64a11014a` reports the full-destination `MoveInput` variant for canonical desktop/mobile move selection. Both were accepted by Orca for the coordinator to forward.

No new `GamApi` method is necessary. UI callers should use:

```ts
api.createReservation({ ...fields, tableIds: selectedIds })
api.moveClaim({ claim: { visitId, version }, tableIds: destinationIds })
api.moveClaim({ claim: { reservationId, version }, tableIds: destinationIds })
```

## Validation

- `pnpm typecheck` in `web/`: blocked by UI-owned `src/components/booking-pickers.tsx` conflicts. Diagnostics: `222:16` TS1005, `223:1` TS1185, `285:1` through `285:7` TS1382, `310:1` TS1005, and `311:1` TS1005.
- Independent TypeScript check of all owned services, domain, hooks, lib, state, and config files: passed. The temporary extending tsconfig was removed after the check.
- `pnpm lint` in `web/`: blocked by UI-owned `src/components/booking-pickers.tsx:223:1` and E2E-owned `e2e/phase2b-booking.mjs:115:3` parse errors. Eight existing UI warnings remain outside this worker's ownership.
- `pnpm exec oxlint src/services src/domain src/hooks/use-data.ts src/hooks/use-action.ts src/lib src/state src/config`: passed without diagnostics.
- Prettier check of every worker-modified source file: passed.
- Targeted HTTP contract/mock regressions: 96 tests passed across two files after grouped-move integration.
- Final full `pnpm test`: 205 tests passed across 14 files, including the disabled-worker refinement (23:57 local run).
- No servers, database changes, staging, commits, pushes, merges, or rebases were performed by this worker.

## Remaining integration work

- UI/E2E owners must resolve the listed external conflict markers before global typecheck/lint can pass. The coordinator stages the four resolved data conflict files.
- Replacement pages are still present on disk and still import the legacy `bookingApi`, `visitApi`, `waitlistApi`, and `directBookingSelection` exports. These remain until the UI owner removes the importers; they were not deleted while active imports remained. The coordinator was notified of this cleanup dependency.
- The canonical UI must consume the reported full-destination move variant to retain develop's grouped-move selection behavior. This is outside data-worker ownership.

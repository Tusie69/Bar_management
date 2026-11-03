# MERGE_WEB_DATA Boss review - 2026-10-31

Verdict: **CHANGES_REQUESTED**

Three findings: two MAJOR and one MINOR. The current web quality gates pass, but the passing suites do not cover the reproduced failures below.

## Review scope and provenance

- Review dispatch: `task_927859e7f594` / `ctx_5433e54f0349`.
- Worker reviewed: `task_04e306eb0257` / `ctx_6e1a14dcce41`; report `docs/integration/merge-web-data-report.md`.
- Worktree: `C:\Users\DELL\orca\workspaces\Bar_management\feature-canonical-ui-web`; HEAD and base `0acec2f52f5a911f2b5fb817927c9e0727a2d0ae`. Changes are uncommitted and shared with concurrent backend/UI work.
- Read the Boss brief, `D:\GAM-APP\docs\workflow\orca-boss-review-workflow.md`, Boss template, and MERGE_WEB_DATA specification before review.
- Compared the owned config/services/state/domain/lib/auth/hooks/package paths against both `git diff 0acec2f` and the actual working files in `D:\GAM-APP\21gam-platform\src`. Also examined main's newer web changes in `bd145f8..0acec2f`.
- Read backend routes/repositories only to establish the adapter contract, migration preservation, tenant scope and security guards. This is not a second full backend review. UI callers were inspected only where they exercise the data contract.
- No source, tests, configuration, migrations or other documentation changed by this reviewer. No commit, database connection/write, migration, seed, or listening application server was started. The reproduction harness used Vite middleware mode without a listening HTTP port; it changed only process memory. Builds generated ignored build/cache output.

## Findings

### WDATA-01 - MAJOR - HTTP check-in silently discards the actual guest count

**Location:** `web/src/services/http/http-api.ts:201` (especially lines 203-215); contract `web/src/services/contracts.ts:116`.

**What is wrong:** `checkIn` accepts `guestCount`, fetches the booking, optionally assigns tables, and returns success without reading or validating that count. The backend endpoint accepts only the version and inserts the visit using the stored reservation `party_size`. A caller confirming seven actual guests for a four-person reservation receives success while the visit records four.

**Why / impact:** The canonical UI asks for the actual count and passes it through this contract (`web/src/features/reservations/reservation-detail.tsx:110` and the shared `GuestCountDialog`). Silently ignoring supported-looking input violates truthful adapter behavior and can make occupancy/guest totals wrong. This gap also exists in the canonical source adapter; copying it faithfully does not make the newly activated HTTP path correct. This is distinct from the explicitly documented waitlist assignment rule that uses stored party size.

**Evidence:** Executed an in-memory HTTP transport reproduction through the real `createHttpApi` and `HttpClient`, with a valid booking fixture whose `partySize` is 4, then called:

```ts
await api.checkIn({ reservationId: 11, version: 3, guestCount: 7 })
```

The real adapter returned `Đã check-in.`. Captured requests were exactly:

```json
[
  { "method": "GET", "path": "/api/v1/bookings/11" },
  { "method": "POST", "path": "/api/v1/bookings/11/check-in", "body": { "version": 3 } }
]
```

The local backend confirms the consequence: `api/src/modules/bookings/booking.route.ts:234` forwards only ID/version, and `booking.repository.ts:982` inserts `reservation.party_size` at line 992. No database write was used for this reproduction.

**Concrete fix:** In `createHttpApi.checkIn`, validate the requested actual count against the fetched booking before any assignment/check-in POST. With the frozen backend contract, reject a differing count explicitly, preferably with the existing unsupported-capability error, rather than claiming it was saved. Keep the caller's observed version and the assignment-response version behavior. Add a UI handoff instruction to display the stored count or explain the limitation in HTTP mode; the data worker must not edit UI-owned files. Supporting a separate actual count atomically on the backend would require a coordinated contract change and is not required for the minimal fix.

**Verification:** Add a transport test in `web/src/services/http/http-api.contract.test.ts`: stored count 4/requested count 7 must produce an explicit error and no mutation requests, including when new table IDs were supplied. Equal counts must still check in; stale versions must remain unchanged in the payload. Run `pnpm test` and `pnpm typecheck` in `web` and have the UI owner check the confirmation dialog against HTTP mode.

### WDATA-02 - MAJOR - Accepted mock waitlist offers can no longer progress to the reservation hold flow

**Location:** `web/src/services/mock/server.ts:1656` (allowed statuses and the subsequent hold creation); related producer `recordContact` at lines 1584-1628.

**What is wrong:** The retained mock contact flow still creates a `WAITLIST_OFFER` hold and sets `HOLD_ACTIVE` when an offer is accepted. The rewritten `seatWaitlist` accepts only `WAITING` for walk-ins and `WAITING`/`CONTACTING`/`OFFERED` for advance entries. It rejects the `HOLD_ACTIVE` state that the mock itself produces. For an accepted walk-in offer there is also no reservation ID through which normal check-in could continue.

**Why / impact:** The specification requires the development mock to remain working and the canonical capabilities to be retained. The new hold-based assignment must also account for existing mock offer holds. The old implementation explicitly handled `activeHoldForEntry`, used its tables, and converted that hold. Removing that path strands both newly accepted offers and existing seeded offer holds. This is a regression in the changed `seatWaitlist`, not merely a missing backend feature.

**Evidence:** Executed this full sequence against the real `MockGamApi` as the receptionist, using the free seeded B5 table:

1. `addWaitlist` for a walk-in, party size 2, ANY preference.
2. Read its version, `claimWaitlist`, read its new version.
3. `recordContact` with `channel: IN_PERSON`, `outcome: ACCEPTED`, and `offeredTableIds: [B5]`.
4. Read its new version and call `seatWaitlist` with the same table.

Observed:

```json
{
  "entryStatus": "HOLD_ACTIVE",
  "reservationId": null,
  "heldTables": [13],
  "assignmentFailure": { "status": 409, "code": "WAITLIST_NOT_SEATABLE" }
}
```

The new tests cover direct WAITING assignment, not this retained contact/acceptance path.

**Concrete fix:** Complete the mock transition from an accepted offer to a reservation-backed hold. Handle an existing `activeHoldForEntry`, reuse its tables when no replacement set is supplied, and convert/replace its hold allocations within the same mock transaction while preserving group identity and avoiding self-conflict or leaked allocations. Return the reservation/group IDs and leave the reservation BOOKED with no visit until normal check-in. Clear any contact claim metadata as the backend assignment flow does. Merely allowing `HOLD_ACTIVE` is insufficient: the current `assertClaimable` would then conflict with the entry's own existing hold. Keep current HTTP backend payloads unchanged.

**Verification:** Add mock regressions for WALK_IN and ADVANCE_RESERVATION through claim -> accepted contact -> reservation-hold assignment -> normal check-in. Assert no visit at assignment, no duplicate reservation for advance entries, no duplicate active allocations, preserved group ID for a multi-table offer, and SEATED only after later check-in. Retain stale-version rejection and direct WAITING assignment coverage, then run `pnpm test` in `web`.

### WDATA-03 - MINOR - The mock live floor hides occupancy after the business day rolls over

**Location:** `web/src/services/mock/derive.ts:200`, `:209`, and `:300`; existing test `web/src/services/mock/server.test.ts:186` checks only selected-day projection.

**What is wrong:** The merged mock floor explicitly disables stale allocations, always leaves `staleFromPreviousDay` false, and drops prior-day group members. After the clock actually advances to the next business day, a table with an unclosed visit is displayed as free. The mock mutation validator still includes stale usage and rejects assigning that same table.

**Why / impact:** Carry-over occupancy is a review acceptance item. The canonical source includes prior-day unclosed USAGE and marks it stale; this merge retained main's exact-date mock projection without reconciling it with the canonical live behavior. The production HTTP mapper handles carry-over, so the mock now presents a contradictory workflow and cannot validate the required stale-occupancy UI. This is a missing reconciliation of pre-existing main behavior, not a new production double-booking vulnerability.

**Evidence:** With the real mock, seated a two-person walk-in at B5, advanced `clock` by 24 hours, requested the now-current business date, and attempted a new walk-in at B5. Observed:

```json
{
  "table": { "tableId": 13, "state": "free", "claim": null, "staleFromPreviousDay": false },
  "assignmentFailure": { "status": 409, "code": "TABLE_CONFLICT" }
}
```

The rejection states that B5 still has guests. The canonical `floorState` comparison also shows the omitted stale allocation/group handling.

**Concrete fix:** Distinguish a live snapshot after actual business-date rollover from a future-date planning projection. Include unclosed earlier USAGE allocations and their group members in the live/current-day floor, keep the real visit claim, and set `staleFromPreviousDay` from its allocation/business date. Preserve isolation of reservations, waitlist rows and historical selected-day queries. Do not indiscriminately add today's occupancy to every future planning date or change the separate availability-planning policy.

**Verification:** Add a mock test that actually advances `clock` to the next day while leaving a visit open, then asserts seated + stale, a usable visit ID for manual close, and retained multi-table group membership. After manual close the table must become free. Keep a separate future-date preview test without advancing the live clock and retain the existing selected-date isolation tests. Run `pnpm test` in `web`.

## Verified behavior and security boundaries

- Canonical config/state/auth/lib and core transport hardening were copied; deviations inspected in adapters/domain/hooks implement classification, export, main date isolation and the approved waitlist hold result. No missing canonical file was found in the owned source groups.
- `GamApi` exposes server text export verbatim, retains validated classification in read/create/update, and sends walk-in waitlist date/phone only on create. Booking/floor/waitlist reads reject a mismatched business date; date-keyed reservation and waitlist queries avoid the old cross-date placeholders.
- HTTP waitlist assignment posts version/table IDs and returns reservation/group IDs. The target backend creates or reuses a BOOKED reservation hold for both kinds; later normal booking check-in creates the visit. The adapter preserves the backend's advance-before-walk-in queue order. The HTTP mapper preserves floor group identity and carry-over flags/allocation date.
- Contact-attempt and cancel methods target the actual routes with versions and their typed outcomes/reasons. Unsupported HTTP capabilities fail explicitly without falling back to mock. Contact logging does not silently create offers/holds in HTTP mode.
- HTTP authorization uses server permissions. Auth payload validation requires organization/venue IDs and role codes; presentation-role selection is deterministic. Server-side table configuration requires `venue.configure`, and service-status writes require a reason and version. Tenant filters and waitlist ordering were inspected in the actual target queries.
- `HttpClient` holds CSRF in memory, sends cookie credentials, and has explicit unauthorized/CSRF failure handling. The persisted session presentation object contains user ID/theme, not a CSRF/session token. AuthBoundary clears query/history state outside an authenticated HTTP session.
- `web/vite.config.ts` does not spread `loadEnv` into a client `define` object or widen `envPrefix`. Production build rejects mock even under `--mode staging`; the successful HTTP bundle has no mock-named chunk or the checked mock implementation markers. Local `.env` and `.env.production` are ignored. A limited added-line scan found no obvious private-key/API-key literal; this was not a credential inventory or external secret scan.
- `git diff 0acec2f -- api/database/migrations api/src/database/migrate.ts` is empty: no new/renumbered migration and main's line-ending checksum hardening remains unchanged. The demo seed diff only accepts 28 or 29 permissions; existing migration 0002 adds `booking.phone.reveal` to the initial 28 permissions, explaining 29, while empty-database/four-role guards remain. Migration 0004 only adds the classification column/constraint. No seed was run by this reviewer.
- Read `api/scripts/init-local-secrets.mjs` and `verify-phone-e2e.mjs`: initializer output is status-only with atomic replacement and ambiguity/encoding checks; phone verification requires the exact e2e database before importing application configuration and verifies the connected DB before writes, with fixed redacted failure output. Neither tool was executed by this review.
- Worker reports say migrations were applied only to `gam21_platform_it_test` and `gam21_platform_e2e_test` and dev was untouched. The code/migration diff supports the intended scope, but filesystem review cannot independently prove past database activity. No database history or dev database state is claimed as independently verified here.

## Commands run and results

All pnpm commands below ran in `web`.

| Command/check | Result |
| --- | --- |
| `pnpm test` | PASS, 12 files / 166 tests, exit 0, 13.30 seconds. Current UI work removed three legacy UI test files since the data worker's earlier 15-file / 183-test report. |
| `pnpm lint` | PASS, exit 0; 11 UI-owned warnings listed separately below. No data-layer warnings. |
| `pnpm typecheck` | PASS, exit 0; no UI-owned or data-owned TypeScript errors in the reviewed tree. |
| `$env:VITE_API_MODE='http'; $env:VITE_API_BASE_URL='/api/v1'; pnpm build` | PASS, full TypeScript + production Vite build, 3063 modules. |
| `$env:VITE_API_MODE='mock'; $env:VITE_API_BASE_URL='/api/v1'; pnpm exec vite build --mode staging` | Expected refusal, exit 1: production build requires HTTP mode. |
| `git diff --check 0acec2f -- <owned paths>` | PASS, exit 0. |
| Canonical file hashes plus targeted `git diff --no-index` comparisons | Inspected all differing owned source files; no missing canonical file in the compared groups. |
| Three process-only Vite middleware harness scenarios | Reproduced WDATA-01/02/03 using the real web modules; no HTTP listener or DB connection. |
| Built JS inspection | Zero mock-named JS chunks; zero matches for checked mock implementation markers. |
| `git check-ignore web/.env web/.env.production` | Both ignored. |
| Migration/main hardening diff and guarded-tool source reads | No migration/migrate.ts change; bounded seed guard change; guards inspected, no DB execution. |

### UI-owned checks, separate from data findings

Typecheck errors: **none** in this snapshot. Lint warnings only:

- `web/src/components/booking-pickers.tsx:29`, `:33`, `:39` - fast-refresh exports.
- `web/src/features/floor/quick-form.tsx:44` - fast-refresh export.
- `web/src/features/floor/booking-list.tsx:45`, `:123` - fast-refresh exports.
- `web/src/features/floor/floor-page.tsx:110` - memoization dependencies.
- `web/src/features/mobile/ui.tsx:15` - fast-refresh export.
- `web/src/features/mobile/list.tsx:274` - effect dependencies.
- `web/src/features/mobile/mobile-app.tsx:79` - state update in effect.
- `web/src/features/mobile/form.tsx:116` - unstable memo dependency.

UI E2E, live API/MySQL E2E, pixel comparison and accessibility scans were not run in this data-only review. Their absence is not evidence that those paths pass. Memory recall returned only related observation metadata; optional expansion failed with HTTP 400, so no memory content was used as evidence.

## Fix instructions for the worker

1. **WDATA-01 / MAJOR:** Guard actual guest count in `createHttpApi.checkIn` before all mutation requests. With the frozen backend, explicitly reject an unsupported changed count, retain version behavior, add mismatching/equal-count tests, and document the HTTP UI limitation for the UI owner. Do not silently update the reservation or extend the backend contract.
2. **WDATA-02 / MAJOR:** Restore the accepted-offer path in mock `seatWaitlist` by transitioning the existing offer hold/allocations into the approved reservation hold flow. Preserve group identity, clear contact claims, return reservation/group IDs, create no visit until later normal check-in, and test both kinds through contact acceptance and subsequent check-in. Do not merely broaden the status list without handling self-owned hold conflicts.
3. **WDATA-03 / MINOR:** Reconcile mock current-day rollover with canonical carry-over occupancy while retaining future planning and selected-date isolation. Test actual clock rollover, group retention, manual close, and future preview separately.
4. Rerun `pnpm test`, `pnpm lint`, `pnpm typecheck`, and the HTTP production `pnpm build` in `web`; report updated results and coordinate UI-only changes through the coordinator. No migration, dev DB write, secret rotation, source-repo write or commit is needed for these fixes.

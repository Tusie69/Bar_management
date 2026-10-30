# Backend integration report

Date: 2026-10-30 (Asia/Bangkok). Branch: `integration/canonical-ui-api`. Scope: contract v1 B1-B7, with coordinator clarifications recorded below. Changes are uncommitted.

## Outcome

Implemented the two waitlist endpoints, actor-scoped table-status rejection, explicit organization filters on booking/floor reads, owner-only phone reveal, isolated throwaway phone test configuration, comprehensive HTTP security/concurrency tests and current API documentation. Final checks: typecheck and lint pass; **145/145 tests in 17 files pass** against `gam21_platform_it_test`.

No `.env`, migration, seed, frontend, contract, branch or commit was modified by this worker. No SQL, tests or fixtures were run against `gam21_platform_dev`. Existing user changes to `api/database/seeds/demo.sql`, `db/migrations/.gitkeep` and untracked `db/migrations/0004_admin_portal_rbac.sql` were left untouched. No new DDL or schema migration was introduced; existing suite tests retain their pre-existing temporary audit-constraint checks on the integration database.

## Contract items and endpoint changes

| Item | Result |
| --- | --- |
| B1 | Added `POST /waitlist/:id/cancel`, permission `waitlist.cancel`, CSRF, validated schema reason and optional 300-character note. Locks the scoped entry, checks version, rejects all terminal statuses, clears claims, releases active waitlist holds/allocations and unused groups, increments versions and commits `WAITLIST_CANCELLED` with authenticated actor/session and reason. Audit failure rolls everything back, including hold release. |
| B2 | Added `POST /waitlist/:id/contact-attempts`, permission `waitlist.record_contact`, CSRF, schema-backed channel/outcome values and optional 300-character note. Reuses `waitlist_contact_attempts`; entry lock serializes numbering and stale-version checks. Records server timestamps and actor, increments entry version, writes `WAITLIST_CONTACT_RECORDED` atomically. Outcome recording does not change status or create an offer, hold or visit. No DDL needed. |
| B3 | `PATCH /tables/:id/status` now passes the actor; lookup requires organization + venue + table ID. Cross-venue returns 404 and stale supplied version returns 409. Valid scoped calls retain 409 `TABLE_STATE_DERIVED`; see approved clarification below. |
| B4 | All protected business routes tested for unauthenticated 401, missing-permission 403 and mutation CSRF 403. Cross-venue tests exercise booking detail/update/assign/merge/cancel/no-show/check-in/reveal, waitlist cancel/contact/seat, table status/configuration and visit close/move/merge; scoped list/search/export/catalog/floor reads exclude foreign fixtures. Wrong-organization repository reads are explicitly tested. Receptionist list/detail/search/export/floor/waitlist responses exclude stored phone plaintext and cryptographic fields. |
| B5 | Added three independent HTTP races for assign-vs-assign and three for assign-vs-walk-in on the same table/date. Exactly one succeeds and the loser is 409 in every race; database assertions prove one live allocation and one winning visit/hold. |
| B6 | Baseline reproduced: 119 passed, 3 failed with `PHONE_KEYS_UNAVAILABLE`. Vitest setup now injects randomly generated throwaway encryption and HMAC keys before application imports, an explicit test reveal policy, and disabled no-show worker. It refuses `RUN_MYSQL_INTEGRATION=1` unless `DB_NAME=gam21_platform_it_test`. All original phone tests now pass with owner success and receptionist denial. |
| B7 | Rewrote `docs/api.md` with the actual routes, permissions, body/response shapes, phone semantics, errors, business-date rules, status-route limitation, unavailable capabilities and test commands. |

Phone reveal now requires **both** `booking.phone.reveal` and `customer.phone.reveal`, as explicitly directed by the coordinator (BD-07). Under existing seeded roles, only OWNER_ADMIN satisfies both. Receptionist reveal returns 403 before rate-limit/audit/disclosure; owner success remains rate-limited, redacted-audited and `no-store`. A denied receptionist reveal writes no successful disclosure record. No grant or migration was edited.

## Route-by-route security review

All routes use the global trusted-origin gate for unsafe methods. Every business mutation uses session authentication, CSRF and its permission before validation/repository access. Actor organization/venue come from the session; IDs from request bodies cannot replace them.

| Route | Required permission | Scope / phone review |
| --- | --- | --- |
| `GET /health` | Public | Process liveness only; no business data |
| `POST /auth/login` | Public, trusted origin | Active user/membership plus venue-scoped or organization-wide role; HttpOnly cookie, no raw session token in JSON |
| `GET /auth/me` | Session | Current actor and refreshed permissions; no customer data |
| `POST /auth/logout` | Session + CSRF | Revokes authenticated session |
| `GET /tables/catalog` | `customer.view_masked` | Organization + venue catalog, no phones |
| `GET /tables` | `customer.view_masked` | Explicit organization + venue filter; date-specific allocations, only `phoneLast3` in active visit |
| `PATCH /tables/:id/status` | `table.assign` | Scoped table/version lookup, then derived-state rejection |
| `PATCH /tables/:id/configuration` | `venue.configure` | Scoped locked table; actor-audited configuration change |
| `GET /bookings` | `customer.view_masked` | Explicit organization + venue/date filter; only last 3 phone digits |
| `GET /bookings/sources` | `customer.view_masked` | Organization-level active sources are intentional, no customer phones |
| `GET /bookings/search` | `customer.view_masked` | Organization + venue/date; name or exactly last 3 digits, masked result |
| `GET /bookings/export` | `customer.view_masked` | Organization + venue/date SQL, formatted masked phone only |
| `GET /bookings/:id` | `customer.view_masked` | Explicit organization + venue/ID; masked booking DTO |
| `POST /bookings` | `reservation.create` | Actor organization/venue insert and organization source validation; masked response |
| `PUT /bookings/:id` | `reservation.update` | Organization + venue locked reservation/version; masked response |
| `POST /bookings/:id/assign` | `table.assign` | Scoped locked reservation, venue table/allocation locks; masked response |
| `POST /bookings/:id/merge` | `visit.combine` | Scoped locked reservation, scoped group/table validation; masked response |
| `POST /bookings/:id/cancel` | `reservation.cancel` | Scoped locked reservation; releases its holds; masked response |
| `POST /bookings/:id/no-show` | `reservation.mark_no_show` | Scoped locked reservation; explicit action only; masked response |
| `POST /bookings/:id/check-in` | `visit.checkin` | Scoped locked reservation and existing hold; masked response |
| `POST /bookings/:id/phone:reveal` | Both phone-reveal permissions | Scoped reservation/customer lookup; only owner gets full phone, audited/no-store |
| `POST /bookings/walk-ins` | `visit.walkin` | Authenticated venue tables; actor organization/venue insert; current business date; visit ID only |
| `POST /visits/:id/close` | `visit.end` | Scoped locked visit; permission rechecked inside transaction; no phone |
| `POST /visits/:id/move` | `visit.move` | Scoped locked visit and target tables; no phone |
| `POST /visits/:id/merge` | `visit.combine` | Scoped locked visit and tables/groups; no phone |
| `GET /waitlist` | `customer.view_masked` | Organization + venue/date; no phone field |
| `POST /waitlist` | `waitlist.create` | Actor organization/venue insert; no phone field |
| `POST /waitlist/:id/seat` | `waitlist.accept_offer` + `visit.walkin` | Scoped entry/table locks; actor-audited transaction; no phone |
| `POST /waitlist/:id/cancel` | `waitlist.cancel` | Scoped entry lock/version; actor-audited transaction; no phone |
| `POST /waitlist/:id/contact-attempts` | `waitlist.record_contact` | Scoped entry lock/version and contact attempt; actor-audited transaction; no phone |

Some pre-existing internal queries use venue ID after a scoped parent lock rather than repeating organization ID. Venue IDs are globally unique primary keys, belong to an organization via foreign keys, and authenticated venue selection is checked against the actor's organization. The reviewed HTTP paths cannot choose an inconsistent actor. Explicit organization predicates were additionally added to externally used booking list/detail and floor list reads.

## Verification output

Working directory for all commands: `D:/GAM-APP/Bar_management/api`.

Baseline command:

```powershell
$env:DB_NAME='gam21_platform_it_test'
$env:RUN_MYSQL_INTEGRATION='1'
npx vitest run --no-file-parallelism
```

Baseline output:

```text
Test Files  1 failed | 14 passed (15)
Tests       3 failed | 119 passed (122)
Failures    booking-phone.mysql.test.ts, PHONE_KEYS_UNAVAILABLE
Duration    22.38s
```

Final commands and outputs (exit code 0 each):

```text
> pnpm typecheck
$ tsc -p tsconfig.json --noEmit

> pnpm lint
$ eslint src test

> $env:DB_NAME='gam21_platform_it_test'; $env:RUN_MYSQL_INTEGRATION='1'; npx vitest run --no-file-parallelism
Test Files  17 passed (17)
Tests       145 passed (145)
Start at    01:35:43
Duration    29.52s

> git diff --check
(no output)
```

There are 23 new test cases beyond the 122-case baseline: 17 waitlist/security cases and 6 allocation concurrency cases. Existing phone tests were strengthened rather than removed. New rollback tests force audit failure through a duplicate sequence on the existing unique key; they introduce no DDL. Explicit Express/Router public type annotations resolve TypeScript declaration portability errors (TS2883) without changing runtime behavior.

## Files changed by this worker

- `api/src/app.ts`
- `api/src/auth/auth.route.ts`
- `api/src/routes/health.route.ts`
- `api/src/modules/bookings/booking.repository.ts`
- `api/src/modules/bookings/booking.route.ts`
- `api/src/modules/tables/table.repository.ts`
- `api/src/modules/tables/table.route.ts`
- `api/src/modules/visits/visit.route.ts`
- `api/src/modules/waitlist/waitlist.repository.ts`
- `api/src/modules/waitlist/waitlist.route.ts`
- `api/test/booking-phone.mysql.test.ts`
- `api/test/waitlist-security.mysql.test.ts` (new)
- `api/test/allocation-concurrency.mysql.test.ts` (new)
- `api/test/support/integration-fixture.ts` (new)
- `api/test/support/test-environment.ts` (new)
- `api/vitest.config.ts`
- `docs/api.md`
- `docs/integration/backend-integration-report.md` (this report)

## Approved interpretations and remaining limits

- **B3 approved clarification:** the existing `updateTableState` was an unconditional rejection, not an unscoped write. The coordinator approved passing the actor, checking scope and version, then preserving `TABLE_STATE_DERIVED`. No new ACTIVE/OUT_OF_SERVICE transitions are approved in v1. Since this route performs no mutation, no mutation audit event is fabricated. Actor auditing remains in the real configuration/allocation mutations.
- **B1/B2 approved clarification:** cancellation explicitly releases waitlist holds/allocations in the same transaction; contact outcomes only record history and do not drive offer/status transitions.
- **BLOCKED, database grant cleanup:** migration 0002 grants `booking.phone.reveal` to RECEPTIONIST, contrary to BD-07. Code now safely requires the owner-only `customer.phone.reveal` permission as well. Revoking the historical grant requires a new, separately owner-approved migration; none was applied or edited here.
- **MISSING, intentionally outside v1:** customer search/profile/notes, operation-log listing, undo/redo, reports, venue configuration, zone flags, hold deadline/release, group split, waitlist claim/release-claim and standalone visits/allocations list endpoints. No DDL proposal is needed for B2 because the current schema supports it.
- **BLOCKED, existing payment limitation:** AFTER_PAYMENT close remains unavailable until a trusted payment verifier exists. No fixed seating duration, automatic warning cancellation or automatic hold release was introduced.
- No browser visual QA was performed because this worker owns backend-only files. E2E-equivalent API checks use real Express routes, authenticated cookie sessions and the real MySQL integration database.


## Wave 2 - contract v1.1, 2026-10-30

This section supersedes the v1 limitations above for receptionist phone grant cleanup, advance waitlist creation/seating, and manual table service status.

### Implemented

- B8: new `api/database/migrations/0004_revoke_receptionist_phone_reveal.sql` removes only RECEPTIONIST's `booking.phone.reveal` grant. Applied successfully using `DB_NAME=gam21_platform_it_test` and then `DB_NAME=gam21_platform_e2e_test` with `npx tsx src/database/migrate.ts`; 0001-0003 were skipped as already applied. Existing dual permission checks remain. A real grant assertion confirms only OWNER_ADMIN holds `booking.phone.reveal` and `venue.configure`.
- B9: POST /waitlist accepts ADVANCE_RESERVATION with reservationId, businessDate, contactChannel and optional note. Guest data comes from the scoped BOOKED reservation; duplicate active entries, date mismatches and existing holds/allocations return 409. Reservation row locks serialize duplicate creation. GET includes reservationExpectedAt and orders by priority_class, queued_at and id, preserving advance priority even across statuses.
- Advance seating reuses transaction-scoped booking assignment and check-in operations. The reservation, hold/allocation conversion, single RESERVATION visit, SEATED entry, actor audit and sequence changes commit or roll back together. Cancellation/no-show closes open entries with RESERVATION_CANCELLED in the booking transaction. Direct booking check-in also closes an existing entry with SEATED_OTHERWISE so seated guests do not remain queued. Rescheduled reservation dates are revalidated at waitlist seating. No offer/hold automation was added.
- B10: owner-only PATCH /tables/:id/configuration accepts optional status ACTIVE/OUT_OF_SERVICE and/or isSpare with version and required reason. It rejects any unreleased table allocation and unchanged configuration with 409, persists before/after status and spare flag plus actor/session/reason in operation_log, and increments version. Existing catalog/floor projections report OUT_OF_SERVICE and existing assignment/walk-in/seat checks reject those tables.

### Files changed by this wave

- `api/database/migrations/0004_revoke_receptionist_phone_reveal.sql` (new).
- `api/src/modules/bookings/booking.repository.ts`.
- `api/src/modules/waitlist/waitlist.repository.ts` and `waitlist.route.ts`.
- `api/src/modules/tables/table.repository.ts` and `table.route.ts`.
- `api/test/wave2.mysql.test.ts` (new).
- `docs/api.md` and this report.

### Verification

- Reproduced all three missing capabilities first with real authenticated Express/MySQL HTTP integration tests: initial Wave 2 run failed 10/10 as expected.
- `pnpm typecheck`: PASS.
- `pnpm lint`: PASS, no backend warnings/errors.
- `DB_NAME=gam21_platform_it_test RUN_MYSQL_INTEGRATION=1 npx vitest run`: PASS, 159/159 tests across 18 files (baseline 145 plus 14 Wave 2 cases), about 29 seconds; file parallelism remains disabled.
- New cases cover RBAC grants/session permissions, advance shape/scope/date/hold guards, priority, duplicate 409 and concurrent duplicate submissions, atomic seat/visit timing, booking cancel/no-show closure, direct booking check-in closure, seat/cancel audit-failure rollback, owner status toggle with reason/audit/version, receptionist 403, active hold/visit 409, and inactive-table rejection by assignment, walk-in and both waitlist kinds.
- Frontend services/domain validation: typecheck PASS, lint PASS with 11 existing UI-owned warnings, test PASS 113/113 across 11 files; see the canonical frontend report's Wave 2 section.

### UI handoff and boundaries

Re-enable the advance waitlist form in HTTP mode, selecting a BOOKED reservation for the displayed day with no table; pass kind/reservationId/channel with ANY and no persisted preferences. Display advance and walk-in lanes separately and show reservationExpectedAt. Re-enable ACTIVE/OUT_OF_SERVICE toggles only for venue.configure, collect a nonblank reason and pass the observed table version; surface 409 and refetch. Receptionists must have no phone reveal control. Preferences, offers, hold automation and the other v1 unsupported capabilities remain unavailable.

Only the two named test databases received migration 0004. The developer database, seeds, .env files, db/migrations, Bar_management/web, running port-3000 API, contracts and frontend UI files were not modified by this wave. No commits or pushes were made; pre-existing wave-1 changes and untracked user work were preserved. Authenticated browser/visual QA belongs to the subsequent UI/E2E wave; this worker validated real HTTP routes against the isolated integration database.

## E2E fixes - 2026-10-30

- Auth: POST /auth/login and GET /auth/me now include `user.roles: string[]`, queried fresh from active membership_roles for the authenticated organization, membership, user and current venue (including organization-wide grants). Codes are distinct and sorted; revoked and other-venue grants are excluded. Permissions remain the authority for operations.
- Floor: GET /tables?date includes every unreleased allocation whose business_date is on or before the requested date. Earlier HOLD allocations stay RESERVED and earlier USAGE allocations stay IN_USE. TableView now exposes `staleFromPreviousDay` and `allocationBusinessDate` (the oldest matching unreleased date, YYYY-MM-DD or null). The MySQL aggregate is normalized numerically so a returned string `0` is not treated as true. Earlier undissolved groups with at least two unreleased members also remain visible.
- No deadlines, planning windows or date changes trigger release/cancellation. GET remains read-only; only released_at clears an allocation from this projection. Future allocations remain excluded from earlier requested dates, and same-day allocations are not stale.
- Reproduced defects first through authenticated Express HTTP routes and real MySQL on gam21_platform_it_test: missing role arrays, prior holds/visits incorrectly AVAILABLE, and missing prior groups. Final regressions cover login/me role scope and revocation, holds past their planning window without writes, visits whose started_at differs from the allocation date, prior groups, same-day/future dates and explicit release.
- Final backend verification: `pnpm typecheck` PASS; `pnpm lint` PASS; `DB_NAME=gam21_platform_it_test RUN_MYSQL_INTEGRATION=1 npx vitest run` PASS, 165/165 tests across 19 files (159 baseline plus six new cases).
- Frontend services/state now validate the role array and select OWNER_ADMIN > CUSTOMER_CARE > CASHIER > RECEPTIONIST deterministically for presentation, preserving permission-based authorization. Floor/availability adapters retain prior-day occupancy and warnings. Final frontend verification: `npm run typecheck` PASS; `npm run lint` PASS with 11 existing UI-owned warnings and none in changed services/state; `npm run test` PASS 126/126 across 12 files. A concurrent UI-owned unused PendingTag import briefly blocked typecheck; after escalation it was removed externally, and the final rerun passed without this worker editing UI.
- UI handoff: shell.tsx must use the mapped `user.role`, never nonexistent `principal.role`. In the currently observed shell, replace its generic HTTP subtitle with the one-line expression `const subtitle = api.mode === "http" ? ROLE_LABEL[user.role] : ROLE_LABEL[user.role] + " · " + user.deviceLabel`. No UI file was edited by this worker.
- No migrations, seeds, environment changes, dev database access, API/Vite lifecycle changes or commits were made. The running port-3000 API was not restarted and browser/pixel revalidation of these source changes remains with the coordinator. Existing uncommitted work was retained.

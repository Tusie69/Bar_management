# MERGE_BE report

Date: 2026-10-31. Task `task_8f432ee4ea6d`, dispatch `ctx_83282fae9499`.

## Result

Ported the missing backend capabilities into the target worktree, reconciled advance waitlist seating with main's reservation-hold/table-group flow, and retained Tutuong's classification, reception-window, Zalo export and allocation rules. Final acceptance: typecheck and lint pass; **20 test files / 230 tests pass**, with MySQL integration enabled on `gam21_platform_it_test`. The independent HTTP/DB phone verification also passes on `gam21_platform_e2e_test`.

No commit, staging, push, new migration, development-database access, environment-file edit or frontend edit was performed. Other workers' concurrent `web/**` and root lockfile changes are outside this report's ownership.

## Inputs and comparison

- Target: `C:\Users\DELL\orca\workspaces\Bar_management\feature-canonical-ui-web`, branch `Doirangmuoi/feature-canonical-ui-web`.
- Base: `origin/main`, `0acec2f52f5a911f2b5fb817927c9e0727a2d0ae`.
- Read-only source: `D:\GAM-APP\Bar_management`, branch `integration/canonical-ui-api`, HEAD `a92519be94e1cae636031dbc97960bc574ec620e`, including its uncommitted finalization scripts, tests and documents.
- Compared `git diff origin/main integration/canonical-ui-api -- api docs/api.md`, then inspected the source worktree's uncommitted finalization diff separately. Read integration contracts v1/v1.1, backend reports and finalization Boss re-review for business/security context.
- Agentmemory recall was available. Its relevant expanded observations contained historical command snippets, so contracts and current source were used for the actual decisions.
- No `.codegraph/` exists in the target root; ordinary Git/file inspection was used.

## Capability reconciliation

| Capability / difference | Main had | Result | Decision / implementation |
| --- | --- | --- | --- |
| `POST /waitlist/:id/contact-attempts` | No route or repository mutation | Ported | Schema channel/outcome validation, serialized attempt numbering under the entry lock, version increment, actor audit and rollback on audit failure. Outcomes do not create offers/holds/visits or change status. |
| `POST /waitlist/:id/cancel` | No route or repository mutation | Ported | All non-terminal statuses; schema reasons; optimistic locking; claim cleanup; release the entry's WAITLIST_OFFER holds/allocations; dissolve unused groups; closure metadata and atomic audit. Cancelling a booking-linked entry does not cancel its independent reservation/RESERVATION hold. |
| Advance waitlist creation | WALK_IN creation only | Adapted | Add discriminated kind/reservationId input, scoped BOOKED reservation lock, same-date/no-active-hold validation, one non-terminal entry per reservation, reservation-derived name/party size and reservationExpectedAt response. Guest/party/phone fields cannot be supplied for advance entries. |
| Advance priority | FIFO only | Ported | Order by existing generated `priority_class`, then queued_at/id, so advance entries precede walk-ins. FIFO within each class stays server-driven. |
| Waitlist seating / groups | WALK_IN becomes BOOKED reservation + HOLD_ACTIVE, with same-zone/type, bookable-zone, spare/status/capacity checks and a group for multiple tables | Adapted | Preserve that flow; advance entries reuse their BOOKED reservation, bump its version, create grouped reservation holds, and become HOLD_ACTIVE. No visit is created at this step. Locks use reservation-before-entry ordering. CONTACTING claims are cleared on the transition. |
| Booking-linked waitlist lifecycle | Booking close/check-in did not close linked entries | Ported / adapted | Cancel/no-show closes open entries as RESERVATION_CANCELLED atomically. Normal later booking check-in creates the visit and marks open entries SEATED, clears claims and audits WAITLIST_SEATED with SEATED_OTHERWISE. Existing group IDs survive hold-to-usage conversion. |
| Waitlist encrypted phones, customer identity, duplicate detection and creation audit | Yes, newer main code | Main retained | Keep optional WALK_IN phoneNumber encryption, phoneLast3 response, phone-in-note rejection and WAITLIST_ADDED audit. Integration's older phone-less implementation was not substituted. |
| Owner table OUT_OF_SERVICE / ACTIVE | Configuration only accepted isSpare | Ported | Optional status alongside isSpare; reason/version required; no unreleased allocation on any date; status response; TABLE_CONFIGURATION_UPDATED audit includes old/new status and spare flag. Current grants prove venue.configure remains OWNER_ADMIN-only. |
| Table status compatibility endpoint scoping | Returned TABLE_STATE_DERIVED without checking the actor's table scope | Ported | Pass authenticated actor; return scoped 404 and stale-version 409 before rejecting derived-state writes. Rejected writes create no audit or allocation. |
| Previous-day floor occupancy | Requested-date allocations/groups only | Ported | GET /tables includes unreleased allocations/groups on or before the requested date, returns staleFromPreviousDay and allocationBusinessDate, excludes future allocations and performs no release. Added explicit organization predicates in allocation aggregation/group joins. |
| Auth role codes | Permissions but no role codes in login/me user | Ported | user.roles resolves active, unrevoked membership roles for the current organization/venue; covered for login, me and revoked/out-of-venue grants. |
| Organization / venue scope for booking lists/detail/search/export, waitlist and floor catalog | Already present in main, largely matching source | Main retained / strengthened | Preserve actor-derived filters and cross-venue rejection. Add explicit organization equality on the waitlist reservation join and floor allocation/group joins. Imported security tests exercise 401, 403, CSRF and foreign entities. |
| Owner-only phone reveal / redacted responses | Main already had both permission checks and revoke migration 0005 | Main retained | Keep code and numbering. Add throwaway test keys before application imports, HTTP ciphertext/masking/owner-reveal tests and independent guarded phone verification. |
| Classification, statistics, Zalo export and reception time window | Newer main behavior, absent/older in integration | Main retained | Keep classification types/column/update semantics, snapshot export/statistics with no phone fields, 19:00-01:00 reception window and historical unchanged-time editing. Keep their existing tests. |
| Allocation/business-date isolation and table-group validation | Newer main behavior | Main retained | Preserve same-date reservation/waitlist assignment conflict rules, global live-usage checks, group validation and main lifecycle/concurrency tests. Floor carry-over visibility does not rewrite these allocation rules. |
| Local secret initializer and finalization tests | Missing | Ported | secrets:init, conservative dotenv/encoding/duplicate checks, atomic replacement and 37 initializer tests; never invoked on a repository environment file. |
| Standalone phone E2E tooling | Missing | Ported | verify-phone-e2e.mjs requires exactly gam21_platform_e2e_test before app imports, creates an isolated synthetic tenant with throwaway credentials/keys and prints only fixed assertions/IDs. |
| Security setup / RBAC backlog / event blocking proposal | Missing | Ported / adapted | Documents added; backlog uses main's 0001-0005 lineage and no longer proposes a conflicting 0005. No admin/event feature or schema was implemented. API document now covers the actual combined backend. |
| Demo seed permission-count guard | Accepted 28 permissions only; migrated baseline contains 29 | Adapted | Accept 28 or 29, preserving the empty-database and four-role guards. Source's speculative 31-permission allowance was dropped because admin RBAC is deferred. No seed was executed. |
| Source db:seed:accounts / seed-dev-accounts.ts | Missing | Dropped | Optional source script embeds a shared password and resets existing demo users by upsert. Account provisioning/credential rotation is outside this merge and its retained source-review risk; do not add a new fixed-credential path. Existing auth:bootstrap remains available. |
| Old 0004 revoke, missing classification migration on source, strict checksum runner | Main already has classification 0004, revoke 0005 and CRLF-tolerant checksum verification | Main retained; obsolete source differences dropped | No migration copy/rename, no 0004 revoke, no checksum regression. All migration files and migrate.ts remain identical to main. |
| Older source E2E fixture deletions / weaker audits and catalog | Main fixture cleans waitlist rows, has additional real tables/OTHER source and denied-phone audit checks | Main retained | Do not replace main's phase2b fixture or remove its waitlist cleanup/denied-reveal assertions. Keep current catalog/group helpers and existing seed protections. |

## Coordinator decision

The only blocking business conflict was waitlist seating: source/contract v1.1 immediately checked in advance guests, while newer main held tables for later check-in. Coordinator replied through Orca ask:

> Preserve main hold flow for both kinds. Seating an ADVANCE_RESERVATION entry goes through the same hold/table-group flow as WALK_IN on main (no visit is created at seating); the later normal check-in creates the visit and marks the entry SEATED. Keep advance-over-walk-in priority (owner decision D3).

This decision supersedes the immediate-check-in detail of contract v1.1 for this merge. Tests cover WAITING, CONTACTING and OFFERED advance entries through grouped HOLD allocations, no visit or extra reservation at assignment, stale booking version rejection, later normal check-in, group preservation, claim cleanup and linked-entry audit.

## Database changes actually executed

Ran from this target's `api/` directory, with DB_NAME explicitly set for each invocation:

| Database | Already applied / skipped | Applied by this task |
| --- | --- | --- |
| gam21_platform_it_test | 0001_initial_schema.sql, 0002_booking_phone_calling.sql, 0003_table_adjacency.sql | **0004_reservation_customer_classification.sql**, **0005_revoke_receptionist_phone_reveal.sql** |
| gam21_platform_e2e_test | 0001_initial_schema.sql, 0002_booking_phone_calling.sql, 0003_table_adjacency.sql | **0004_reservation_customer_classification.sql**, **0005_revoke_receptionist_phone_reveal.sql** |

Both commands were `npx tsx src/database/migrate.ts`, using the unchanged main migration set. No new migration was necessary or created. Integration fixtures mutate only gam21_platform_it_test and refuse any other DB; phone verification writes only its synthetic tenant in gam21_platform_e2e_test. A read-only aggregate on e2e confirmed 4 roles, 29 permissions and 59 grants after migration.

### Analysis only: what main migrations would do to dev

Based on the supplied history that dev contains the old `0004_revoke_receptionist_phone_reveal.sql`:

1. Main's runner checks actual filenames, not numeric prefixes. It verifies/skips 0001-0003, accepting only LF/CRLF-equivalent checksum representations.
2. The old 0004 revoke history row does not satisfy `0004_reservation_customer_classification.sql`. If not already applied under that exact filename, main would run the ALTER adding nullable customer_classification with its allowed-values constraint.
3. It would then run/record `0005_revoke_receptionist_phone_reveal.sql`. The DELETE has no additional grant effect when the receptionist grant was already removed by the old 0004, but records the current filename.
4. The runner does not delete/rename the orphan old 0004 history row or reconcile a partially applied DDL automatically. Existing history/checksums and any manually added classification column need review before an owner-approved dev migration; no claim about current dev schema was verified here.

**No connection, SQL, migration, seed or fixture targeted gam21_platform_dev.**

## Verification

| Command (from api/, unless stated) | Result |
| --- | --- |
| pnpm typecheck | PASS, exit 0 |
| pnpm lint | PASS, exit 0 |
| DB_NAME=gam21_platform_it_test RUN_MYSQL_INTEGRATION=1 npx vitest run | **PASS, 20 files, 230 tests, 58.41 seconds**, exit 0 |
| Focused wave2 + allocation concurrency suite | PASS, 24 tests, 10.83 seconds |
| Focused waitlist security + initializer + auth + booking phone suite | PASS, 72 tests, 18.54 seconds |
| DB_NAME=gam21_platform_e2e_test npx tsx scripts/verify-phone-e2e.mjs | PASS, ciphertextStored=true, maskedListAndSearch=true, receptionistReveal=403, ownerReveal=200, noStore=true, auditWithoutPlaintext=true |
| node --check scripts/init-local-secrets.mjs; node --check scripts/verify-phone-e2e.mjs | PASS |
| git diff --check -- api docs (repo root) | PASS |
| Compare protected main behavior/migrations | No diff in migrations, migrate.ts, business-date.ts, booking-export.ts, table-group.repository.ts or booking-lifecycle.mysql.test.ts |

Final full-suite output:

```text
Test Files  20 passed (20)
     Tests  230 passed (230)
  Duration  58.41s
```

Before porting missing waitlist behavior, HTTP tests reproduced 404 on cancel/contact routes and 400 on advance creation (24 failures in the focused imported suites). During adaptation, tests exposed and fixed CONTACTING claim cleanup at HOLD_ACTIVE transition. Existing main WAITLIST_ADDED auditing was retained, and imported audit-failure tests were adjusted to collide with the next sequence rather than their old creation-without-audit assumption. An earlier full run also hit two 10-second setup-hook timeouts in the race suite; the focused race rerun and final full suite passed without retries or raised timeouts. Environmental recurrence of those setup delays has not been ruled out.

## Limits and follow-up

- Browser/pixel E2E and frontend checks belong to the other workers/coordinator; none were performed here.
- No credential rotation, deployment-key decryptability verification, dev migration or seed execution. Secret initialization was tested only in OS-temporary fixtures. The standalone phone verifier retains its synthetic test tenant/booking in e2e and uses throwaway keys; it is evidence for new synthetic data, not retained ciphertext recovery.
- Existing deferred admin RBAC, event blocking, owner credential/seed decisions and the security guide's Windows ACL/key-retention limitations remain deferred. No extra application layer, dependency, migration or account provisioning feature was introduced.
- Ready for the assigned Boss review and coordinator validation; commit/push remain coordinator-owned.

## Fix round 1

Worker task `task_73bb0df83c8e`, dispatch `ctx_02e4abdb5139`, responding to `docs/reviews/2026-10-31-merge-be-boss-review.md`. This section records the round-1 changes separately from the earlier port and its historical test results.

| Finding | Change | Regression coverage |
| --- | --- | --- |
| BE-01 | `mutationInput` trims notes and reuses `containsPhoneNumber` and the creation route's 422 `PHONE_IN_NOTE_FORBIDDEN` response before either mutation repository call. API notes now document this policy. | `rejects phone notes on %s before any domain or audit changes` sends contiguous, spaced, dotted and dashed synthetic numbers through authenticated cancellation/contact HTTP routes. It checks no repository connection is requested and full snapshots of entries, attempts, holds, allocations, audits and venue versions/sequences remain unchanged. Existing valid-note cases are retained. |
| BE-02 | `closeBooking` captures and locks open linked entries before its bulk update, then inserts a `WAITLIST_CANCELLED` audit for each affected entry in the same transaction. Each event records the reservation ID, before/after status and versions, reason `RESERVATION_CANCELLED`, authenticated actor/membership/session and a distinct venue sequence. Reservation auditing and hold/group release remain. | `audits linked %s cancellation from %s and leaves terminal/unrelated entries untouched` covers cancel/no-show from CONTACTING and HOLD_ACTIVE, all three linked terminal statuses, an unrelated reservation entry, claim clearing, grouped-hold release and reservation audit retention. `rolls back %s booking, claims, grouped holds and sequences when the linked entry audit fails` forces the new audit insert to collide and compares complete domain/audit/venue snapshots for both routes. |
| BE-03 | Creation auditing derives `kind` and `<KIND>_WAITING` reason from `input.kind ?? 'WALK_IN'` and includes `reservationId` only for advance entries. Existing walk-in audit shape stays intact. | `creates advance entries from reservations, prioritizes them over older walk-ins and rejects duplicates` now verifies both creation audit payloads, actor/session identity, reservation linkage and absence of both synthetic names and full phones. The WALK_IN request omits `kind`, exercising the default. |
| BE-04 | Fixture reset and cleanup expose opt-in monotonic timing (`MEASURE_INTEGRATION_FIXTURE=1`) and bounded-latency warnings, with elapsed time on fixture errors. Round-1b live measurements below justify retaining the default 10-second hook budget at all four callers. Exact DB guard, serial file execution and assertions remain; no retry or blanket timeout was introduced. | `integration-fixture.test.ts` rejects seven incorrect database names, including development/e2e names, case changes and whitespace, before SQL for both cleanup and reset. Two consecutive full live-DB runs now pass. |
| BE-05 | The event proposal points to this existing merge report's capability comparison and deferred-feature limits for service-status/carry-over evidence. The proposal remains not implemented and awaiting PO. | Every relative Markdown reference in the proposal resolves to an existing target. |

### Previous dispatch outcome and validation (historical)

**The previous dispatch ended blocked; round-1b completes acceptance below.** At that checkpoint, BE-01, BE-02, BE-03 and BE-05 had implementation changes and regression assertions, but their live MySQL tests had not executed successfully. BE-04 timing instrumentation and DB-name guard coverage were implemented; successful fixture timing and two consecutive full MySQL passes remained outstanding. No arbitrary timeout increase was made without measurements.

- `pnpm typecheck`: PASS, exit 0.
- `pnpm lint`: PASS, exit 0.
- `DB_NAME=gam21_platform_it_test npx vitest run` without the integration opt-in: PASS, 12 files / 110 tests; 9 files / 133 MySQL tests skipped. This is not a live-DB acceptance result.
- Focused MySQL execution could not enter test bodies: `ECONNREFUSED 127.0.0.1:3306`. This worktree has no `api/.env`; the read-only source's dotenv configuration targets the same unavailable listener. The existing MySQL listener on 3307 rejects the source/default credentials, before any fixture SQL. The coordinator has been asked for the approved test connection; no connection targeted development and no migration/seed was run.
- Fixture measurements from failed connections are not setup-latency evidence. No final timing or two consecutive full integration passes is claimed at this checkpoint.
- Coordinator question `msg_3bf5a85b7952` remained unanswered after its first 600000ms wait and was resumed using the same message ID; blocker escalations were sent through Orca. Several additional status/heartbeat calls hit runtime timeouts. Completion is reported as `failed`, because the live acceptance and BE-04 cannot be honestly marked complete.
- `git diff --check` for owned paths and proposal relative-link resolution: PASS.

No commit, push, frontend edit, migration, migration-runner edit or seed edit was performed in this fix round.

### Round-1b completion

Worker task `task_e4cb9cc6cb65`, dispatch `ctx_c98edf88213e`, continues the round above after MySQL recovery. All database test commands explicitly targeted `127.0.0.1:3306` and `gam21_platform_it_test`; port 3307 and the development database were not used.

**Four failures: fixture root cause and correction.** An unchanged HTTP reproduction of the four cancel/no-show cases from CONTACTING/HOLD_ACTIVE failed at `expect(after.table_groups).toHaveLength(1)` in `wave2.mysql.test.ts:232`. All preceding assertions, including waitlist/reservation audit identity, actor/session, reason, versions and payload, already passed. `bookingWithLinkedEntries` used `assignBookingTables` with two tables; that API creates independent hold allocations, with no table group. The fixture incorrectly assumed that selecting multiple tables automatically grouped them.

The fixture now calls the actual `seatWaitlistEntry` flow, which creates a grouped reservation hold and advances the reservation to version 2 as expected by the existing closure requests. Added setup assertions prove the returned group exists, is active and owns exactly the two expected live allocations before exercising cancellation or audit failure. The existing claim/status/version setup, all terminal/unrelated-entry comparisons, one waitlist audit plus one reservation audit, hold/allocation release, group dissolution and complete rollback snapshots remain. No production repository change or weakened assertion was needed. The focused four closure cases plus two audit-failure rollback cases pass, 6/6.

**BE-04 live fixture measurements.** Both full runs used `MEASURE_INTEGRATION_FIXTURE=1`; `--disableConsoleIntercept --no-color` exposes timing output without changing test selection or timeouts. Measurements use the existing monotonic `performance.now()` instrumentation. Each reset includes its initial cleanup and all fixture population; cleanup samples include those nested cleanups and the four suite teardown calls.

| Run | Operation | Successful samples | Min | Median | P95 (nearest rank) | Max |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | resetFixture | 52 | 103 ms | 150 ms | 220 ms | 263 ms |
| 1 | clearFixture | 56 | 50 ms | 78 ms | 122 ms | 137 ms |
| 2 | resetFixture | 52 | 118 ms | 146 ms | 288 ms | 341 ms |
| 2 | clearFixture | 56 | 54 ms | 78 ms | 166 ms | 191 ms |

The default 10,000 ms setup/cleanup hook budget is retained at all four shared-fixture callers: the largest observed successful reset is below 3.5% of that budget, and there were no duration warnings, SQL errors or hook timeouts. No competing Vitest/test-server process was present in the Windows process check before the gates; the coordinator was also asked to avoid concurrent runs against this destructive shared test database. Files remain serialized by the existing `fileParallelism: false`, and this worker ran the full gates sequentially with no source changes between them. These observations do not establish the cause of the earlier environmental stalls; they provide current live timing and two clean gates without increasing timeouts or adding retries. The seven expected `completed=false` zero-millisecond reset logs per run come from deliberate wrong-database guard tests and are excluded from successful timing samples.

**WDATA-R1-01.** Removed only `e2e:phase2a` and `e2e:layout` from `web/package.json`, since their target files were deleted. `e2e`, `a11y`, `e2e:auth` and `e2e:phase2b` remain. Other workers' existing package edits are preserved; no other web file was edited by this worker.

Validation from this worktree:

| Command | Result |
| --- | --- |
| api/: pnpm typecheck | PASS, exit 0 |
| api/: pnpm lint | PASS, exit 0 |
| api/: DB_NAME=gam21_platform_it_test DB_PORT=3306 RUN_MYSQL_INTEGRATION=1 MEASURE_INTEGRATION_FIXTURE=1 npx vitest run --disableConsoleIntercept --no-color (run 1) | PASS, 21 files / 243 tests, 61.15 s, exit 0 |
| Same full command, immediately following run 1 with unchanged source (run 2) | PASS, 21 files / 243 tests, 67.31 s, exit 0 |
| web/: pnpm typecheck | PASS, exit 0 |
| git diff --check for this worker's three edited files | PASS |

Full-run summaries:

```text
Run 1
 Test Files  21 passed (21)
      Tests  243 passed (243)
   Start at  18:39:57
   Duration  61.15s (tests 90%, import 9%)

Run 2
 Test Files  21 passed (21)
      Tests  243 passed (243)
   Start at  18:41:07
   Duration  67.31s (tests 91%, import 8%)
```

Round-1b acceptance is complete. No commit, push, migration, migration-runner/seed edit, environment-file edit or server on ports 3000/5173 was performed.

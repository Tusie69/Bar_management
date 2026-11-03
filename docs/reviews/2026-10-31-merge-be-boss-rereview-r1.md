# MERGE_BE Boss re-review, fix round 1 - 2026-10-31

Verdict: **APPROVE**

Reviewer task `task_7af9d40e620e`, dispatch `ctx_68dab6e2fdad`, Orca run `run_e8edc795b163`. Reviewed worktree `C:\Users\DELL\orca\workspaces\Bar_management\feature-canonical-ui-web`, branch `Doirangmuoi/feature-canonical-ui-web`. HEAD and `origin/main` both resolve to `0acec2f52f5a911f2b5fb817927c9e0727a2d0ae`; the package is uncommitted, including untracked integration tests and documents.

Read the assigned re-review prompt, workflow sections 2/4, Boss template, original merge task, both round-1 fix specifications, previous Boss review, current implementation/tests/API documentation and the worker report's Fix round 1 section. Agentmemory recall returned historical command fragments; current source and the supplied specifications establish the conclusions. Neither `.codegraph/` nor `graphify-out/graph.json` exists in this worktree. Used the `orca-cli` skill for coordinator communication; no sub-agents were launched.

## Findings and disposition

**No new or remaining findings.** All six requested items are fixed in the examined implementation and documentation.

| Item | Status | Independent evidence |
| --- | --- | --- |
| BE-01, MAJOR | **FIXED** | `api/src/modules/waitlist/waitlist.route.ts:90` trims mutation notes and applies the existing `containsPhoneNumber` rule with 422 `PHONE_IN_NOTE_FORBIDDEN` before either repository call. `api/test/waitlist-security.mysql.test.ts:188` exercises authenticated cancel/contact requests with contiguous, spaced, dotted and dashed phones; asserts zero repository connections and unchanged entries, attempts, holds, allocations, audits and venue sequence/version snapshots. These cases passed in both full live-DB runs. `docs/api.md:146` documents the same policy for all three note inputs. |
| BE-02, MAJOR | **FIXED** | `api/src/modules/bookings/booking.repository.ts:878` locks and captures scoped, linked non-terminal entries before updating them. The loop at `:912` records one WAITLIST_CANCELLED event per captured entry, preserving identity, before/after status/version, linked reservation, RESERVATION_CANCELLED reason and actor/membership/session, followed by the existing reservation audit. The existing transaction releases holds, dissolves unused groups and rolls back on audit errors. Four successful closure cases at `api/test/wave2.mysql.test.ts:212` and two forced-audit-failure cases at `:244` passed twice, retaining terminal/unrelated-row comparisons, claim cleanup, group/hold/allocation release and complete rollback snapshots. See the independent direct-assignment checks below. |
| BE-03, MINOR | **FIXED** | `api/src/modules/waitlist/waitlist.repository.ts:236` derives creation audit kind/reason from `input.kind ?? 'WALK_IN'`, and includes reservationId for advance entries. The live HTTP case at `api/test/wave2.mysql.test.ts:37` verifies both kinds, the omitted-kind walk-in default, actor/session identity, advance linkage and absence of guest names/full phones from the audit. Passed twice. |
| BE-04, MINOR | **FIXED** | Two independent consecutive full MySQL runs passed, with 21 files and 243 tests each, no retries, hook timeout, duration warning or raised timeout. Successful reset maxima were 1,438 ms and 206 ms, comfortably within the retained 10,000 ms default hook budget. Timing is measured with `performance.now()` at `api/test/support/integration-fixture.ts:35`; a 9,000 ms warning remains available. `:24` retains exact DB-name equality, `api/test/support/test-environment.ts:5` checks the target before application imports, and all seven wrong-name cleanup/reset tests passed. `api/vitest.config.ts:9` retains serial file execution. Measurements and limits are below. |
| BE-05, NIT | **FIXED** | `docs/design/event-blocking-proposal.md:37` now links to the existing merge report and accurately identifies the implemented service-status/carry-over evidence. Every relative Markdown target in the proposal resolves. `:3` still states not implemented and awaiting PO; no event feature was introduced. |
| WDATA-R1-01 | **FIXED** | `web/package.json:15` retains e2e, e2e:auth, e2e:phase2b and a11y; e2e:phase2a and e2e:layout are absent. Their deleted targets are no longer referenced by these scripts. Independent `pnpm typecheck` in web passed. Other pre-existing package changes belong to the concurrent frontend package and were not attributed to this backend fix. |

## BE-02 round-1b fixture correction and direct assignment

The fixture correction is justified. `assignBookingTables` at `api/src/modules/bookings/booking.repository.ts:634` creates a reservation hold and separate table allocations without creating a table group or setting group_id. Selecting two tables therefore does not imply one group exists. The original group-count assertion tested a false fixture assumption, after the audit assertions had already succeeded.

The revised helper at `api/test/wave2.mysql.test.ts:157` calls the real `seatWaitlistEntry` at `:183`, which creates a grouped reservation hold under the approved waitlist flow. Setup assertions establish a live group and exactly the expected two unreleased allocations. The four closure tests still assert the waitlist event and reservation event, their versions and actor/session data, unchanged SEATED/DECLINED/CANCELLED and unrelated entries, CONTACTING claim removal, released holds/allocations and dissolved group. Both audit-failure tests collide with the next venue sequence at the first new waitlist audit; all reservation/entry/hold/allocation/group/audit/venue snapshots must remain equal after failure. These assertions have not been removed or weakened. The test's CONTACTING state with an existing hold is synthetic setup for claim cleanup; it is not presented as a normal seating transition.

To check that moving to the grouped fixture did not hide a direct-assignment defect, independently invoked the actual `closeBooking` in an in-memory SQL-capture probe using `node --import tsx --input-type=module` from api. Replaced all pool connection/query entry points before invocation; the post-commit booking read was stopped by a sentinel. The probe varied CANCELLED/NO_SHOW, CONTACTING/HOLD_ACTIVE, zero/one/two synthetic open entries, and forced waitlist audit failure, always using two allocations with null group_id. It asserted scoped non-terminal capture/update SQL, actor/version/reservation audit payloads, per-entry audit counts, independent reservation audit, hold-release statements, commit/rollback/release calls and the absence of group-update statements.

```text
PASS 20 ungrouped closeBooking SQL-capture cases: cancel/no-show, CONTACTING/HOLD_ACTIVE,
zero/one/multiple linked entries, actor/version audit payload, rollback invocation,
independent reservation audit and hold release; zero database connections
```

This probe verifies executed application control flow and SQL arguments; it does not independently prove MySQL rollback or the validity of multiple simultaneously open synthetic entries. The live grouped tests prove actual database rollback, while main's unchanged `booking-lifecycle.mysql.test.ts:282` cancel/no-show cases prove release for real directly assigned holds. Both full runs include those cases. Inspection and these complementary checks found no hidden direct-assignment defect: the linked-entry audit loop does not depend on a group existing.

## Independent commands and results

All live tests explicitly targeted `gam21_platform_it_test` on `127.0.0.1:3306`; Docker reported `21gam-mysql` healthy with that published port. No command used port 3307. Full gates were sequential, with no application source/config/test edits between them. A combined SHA-256 digest covering API files, API docs, design docs, the worker report and web/package.json was unchanged across the final checks: `3871155F1B65DCD455E0EBEE1A5C7C24B6EDE26C79E32E60AA676D2ECF7D58BC`.

| Command | Result |
| --- | --- |
| api/: `pnpm typecheck` | PASS, exit 0 |
| api/: `pnpm lint` | PASS, exit 0 |
| api/: full live-DB command below, run 1 | PASS, 21 files / 243 tests, Vitest 77.51 s; process wall time 79.04 s; exit 0 |
| api/: identical full command, next run | PASS, 21 files / 243 tests, Vitest 56.96 s; process wall time 58.28 s; exit 0 |
| api/: in-memory closeBooking probe described above | PASS, 20 cases, zero database connections |
| web/: `pnpm typecheck` | PASS, exit 0 |
| `git diff --check -- api docs/api.md docs/design docs/integration/merge-be-report.md web/package.json` | PASS; only Git's existing LF/CRLF advisory for web/package.json |
| Protected-file comparison against 0acec2f, listed below | PASS, no differences |
| Proposal relative-link resolution and web script inspection | PASS |

Full command, executed twice from api in separate sequential processes:

```powershell
$env:DB_NAME='gam21_platform_it_test'
$env:DB_HOST='127.0.0.1'
$env:DB_PORT='3306'
$env:RUN_MYSQL_INTEGRATION='1'
$env:MEASURE_INTEGRATION_FIXTURE='1'
npx vitest run --disableConsoleIntercept --no-color
```

The two CLI flags expose fixture timings and remove color; neither changes test selection, retries or timeout configuration. Output was captured in process memory to calculate timing statistics; no extra repository logs or test/probe files were created.

```text
Run 1: Start at 19:25:41; Test Files 21 passed (21); Tests 243 passed (243); Duration 77.51s
Run 2: Start at 19:27:11; Test Files 21 passed (21); Tests 243 passed (243); Duration 56.96s
```

Fixture durations from these independent runs, in milliseconds; P95 uses nearest rank:

| Run | Operation | Successful samples | Minimum | P95 | Maximum |
| --- | --- | --- | --- | --- | --- |
| 1 | resetFixture | 52 | 124 | 787 | 1,438 |
| 1 | clearFixture | 56 | 52 | 360 | 813 |
| 2 | resetFixture | 52 | 100 | 192 | 206 |
| 2 | clearFixture | 56 | 45 | 106 | 131 |

Each reset includes cleanup and fixture population. Cleanup samples include nested cleanups and suite teardown. Each run also printed exactly seven zero-millisecond completed=false reset records from deliberate wrong-DB guard tests; these expected rejections are excluded from successful timing statistics. No still-running warning, SQL error or hook timeout occurred. The largest reset was 14.38% of the unchanged default hook budget, so increasing that budget is unnecessary on the observed live setup. No retry or blanket timeout was added. The historical source of the earlier stalls remains unproven; two fresh clean gates and measured headroom establish current acceptance, not a guarantee against future infrastructure stalls.

## Main behavior and scope preservation

The following comparison returned exit 0 with no differences:

```text
git diff --exit-code 0acec2f -- api/database/migrations api/src/database/migrate.ts
  api/src/database/seed.ts api/src/modules/bookings/business-date.ts
  api/src/modules/bookings/booking-export.ts api/src/modules/bookings/booking-timing.ts
  api/src/modules/tables/table-group.repository.ts api/test/booking-lifecycle.mysql.test.ts
```

The command was executed as one command line. Existing main lifecycle/group/date/classification/statistics/export/reception-window cases ran in both full suites. The reviewed booking diff adds scoped linked-entry closure/audits and retains reservation auditing and existing hold/group behavior. The approved seating semantics remain reservation holds first, followed by normal later check-in and visit creation. No regression was found in the examined main behavior.

`api/database/seeds/demo.sql` already differs from main by accepting 28 or 29 permissions. This is the original merge's documented seed-guard adaptation, present and described in the previous Boss review; it is not a new round-1 seed change. It was inspected, not executed or edited. Migrations, the migration runner and seed runner remain identical to main. There is no new migration in this package.

This review wrote only this report. It made no source/test/config/environment edits, commit, staging, push, migration/seed execution, development-DB connection or server start/stop on 3000/5173. Approved MySQL suites necessarily mutated only their integration-test fixtures. Concurrent web/src and web/e2e changes were excluded, apart from inspecting the specifically assigned package scripts and running web typecheck. No browser/pixel review or standalone writing e2e verifier run is claimed.

Current source, the earlier review and stable hashes support the examined fix scope; they cannot independently prove every historical action taken by another worker or that worker's lack of access to development. No such historical guarantee is inferred. Early Orca check/heartbeat attempts timed out; later checks returned an empty inbox and a heartbeat receipt succeeded.

## Fix instructions for the worker

None. All requested fixes pass this re-review; no further worker changes are required before the coordinator's final acceptance.

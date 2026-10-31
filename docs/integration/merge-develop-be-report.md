# Backend merge of origin/develop

Date: 2026-10-31. Worktree: `feature-canonical-ui-web`.
Task: `task_e6dbd96b17a6`; dispatch: `ctx_89d2038e2f67`.

## Conflict resolutions

- `api/src/modules/tables/table.repository.ts`: retained the organization/venue-scoped `business_date <= requested date` projection, including stale allocations and active visit identity. This includes develop's previous-day open visits and preserves the approved earlier HOLD projection and future-date exclusion. Floor GET remains read-only.
- `api/src/modules/waitlist/waitlist.repository.ts`: combined `dissolveUnusedGroups` from the feature branch with develop's renamed `lockAndValidateAssignableTables`. Both WALK_IN and ADVANCE_RESERVATION keep the approved hold-first flow, followed by normal booking check-in. Cancellation, contact recording and linked reservation audit behavior remain intact.
- No conflict markers remain under `api/`. The index still records the two conflict paths until the coordinator stages them, as required. No staging, commit, merge, rebase, checkout, reset, stash, push or generated changelog edits were performed.

## Semantic review and reconciliation

Reviewed develop changes in booking repository/routes, table-group repository, visit repository, business-day worker, environment configuration, server startup/shutdown, assignment tests, worker schedule tests and the browser E2E fixture.

- Kept atomic `POST /bookings/direct`, including reservation/hold/group/allocation auditing, capacity checks, one-zone/same-kind validation and rollback. Direct creation still creates no visit.
- Kept same-kind cross-zone booking reassignment and visit movement without adjacency requirements, persisted groups for multi-table targets, and cross-date USAGE conflict checks when moving visits. Explicit merge remains same-zone. Stored reservation party size continues to drive HTTP check-in.
- Kept owner-only table configuration, carry-over occupancy, contact-attempt records, waitlist cancellation/auditing and linked booking cancellation/no-show closure semantics. Existing tests cover these features.
- Auto-close is authoritative after its transaction commits: at business cutoff it closes visits, releases USAGE allocations and clears floor occupancy. Carry-over remains the projection of actual unreleased allocations before that sweep or while the worker is disabled. Old holds remain reserved because this worker closes visits only.
- A checked-in linked waitlist entry is already SEATED, with closure metadata and WAITLIST_SEATED auditing. Auto-close preserves the entire terminal entry and CHECKED_IN reservation rather than cancelling or seating it again. No business-rule conflict required a coordinator decision.
- Found and reproduced a missing group cleanup through HTTP: an advance entry was seated into grouped holds, checked in, projected as carry-over and auto-closed, but its group still had `dissolved_at = NULL`. Added system dissolution for empty groups in the same transaction and included affected group IDs in the visit audit payload. Audit failure rolls back allocations, visit, groups, waitlist history and venue sequence together.
- The original group CHECK required a staff user on every dissolution. Added migration 0007 so system dissolution has an explicit `BUSINESS_DAY_END` reason and null user, while manual dissolution retains its original actor constraint. Existing migration files were not rewritten.
- Both environment examples already contain `BUSINESS_DAY_WORKER_ENABLED=true` and interval 30000 from develop; startup and shutdown wire the worker correctly. `NO_SHOW_WORKER_ENABLED` remains false by default. No application servers were started.

## Migrations applied

Commands ran from `api/` with `DB_HOST=127.0.0.1`, `DB_PORT=3306` and the explicit test database name before invoking `npx tsx src/database/migrate.ts`.

| Database | Already applied | Applied during this task |
| --- | --- | --- |
| `gam21_platform_it_test` | 0001 through 0005 | `0006_auto_close_visits_at_business_day_end.sql`, `0007_auto_dissolve_business_day_groups.sql` |
| `gam21_platform_e2e_test` | 0001 through 0005 | `0006_auto_close_visits_at_business_day_end.sql`, `0007_auto_dissolve_business_day_groups.sql` |

Both migration runs completed successfully. Database access used port 3306, never 3307. `gam21_platform_dev` was not accessed. 0006 was applied first, then 0007 after reproducing the group cleanup constraint failure.

## Verification

Initial `pnpm typecheck` reproduced TS1185 conflict-marker failures. After resolving the conflicts, the preexisting floor/assignment checks passed: 2 files, 27 tests. The new HTTP auto-close regression initially failed on the undissolved group, then reproduced the original group CHECK failure when system cleanup was added. With migration 0007, both new tests passed, including audit-failure rollback.

Final static checks:

```text
pnpm typecheck
$ tsc -p tsconfig.json --noEmit
exit 0

pnpm lint
$ eslint src test
exit 0

git diff --check -- api docs/api.md
exit 0 (only Git line-ending notices)
```

Full acceptance command (both runs):

```powershell
$env:DB_HOST='127.0.0.1'
$env:DB_PORT='3306'
$env:DB_NAME='gam21_platform_it_test'
$env:RUN_MYSQL_INTEGRATION='1'
npx vitest run
```

Run 1:

```text
Test Files  23 passed (23)
Tests       257 passed (257)
Start at    23:44:34
Duration    64.57s
exit 0
```

Run 2:

```text
Test Files  23 passed (23)
Tests       257 passed (257)
Start at    23:46:44
Duration    50.96s
exit 0
```

Both full runs completed with zero failures. The only change between runs was an explicit string conversion in the new test's audit assertion to satisfy ESLint's unsafe-return rule; the second run used that final code.

## Handoff

`docs/api.md` documents the direct route, cross-zone movement/reassignment rules, auto-close scheduling, migration requirements, carry-over precedence and terminal waitlist preservation. Worker edits are confined to the assigned API paths, this report and `docs/api.md`; the coordinator owns staging and final integration.

Orca temporarily returned runtime timeouts/unavailable errors during work; a later inbox check and status message succeeded. No coordinator follow-ups were pending at the last checkpoint. Agent Memory was queried before work; retrieved session fragments were treated as context, and no memory data or memory repository was changed.

# BA-020 — Undo/Redo recovery and verification

Date: 2026-11-07  
Repository: `Tusie69/Bar_management`  
Target baseline: `origin/develop` at `30fb2cb81b7a58d1f62f3e0c74c96ce018a82ed9`

## Recovery evidence

- Original local `develop` was already at the target baseline, but BA-020 was uncommitted.
- The uncommitted work contained seven tracked modifications and two untracked source files. It contained no migration.
- Local environment files were identified but excluded from every commit and report.
- Immutable recovery branch: `codex/backup-ba020-recovery-20261107` at `550cfa47d6a4c4f72901c183c80847a90bcdf77f`.
- Independent verified bundle: `C:\Users\TuNgu\BA020-recovery-backups\20261107-550cfa4\ba020-recovery.bundle`.
- Bundle SHA-256: `F2158F6F2C8EACD87860ECDA80ACD920DCEFE4893AFDA743C80064519C926CA1`.
- Clean integration commit from the protected snapshot: `ca292e6`.
- Verification/test commit: `6c19f3e`.
- Final branch: `codex/ba020-recovery-verified-20261107`.

No reset, clean, force checkout, rebase, force push, direct pull, or production/development database migration was used.

## Approved implementation scope

The server marks only the four operations with explicit, safely reconstructable table state as undoable:

1. `RESERVATION_TABLES_REASSIGNED`
2. `RESERVATION_TABLES_MERGED`
3. `VISIT_TABLES_MOVED`
4. `VISIT_TABLES_MERGED`

Cancellation and other operations remain non-undoable. No expiry window or multi-step retention policy was invented.

## Design and safety invariants

- The server-side `auth_session_id`, created by authenticated session handling, is the device/session ownership key.
- Only the latest operation for the same organization, venue, and authenticated session is eligible.
- Undo and redo are compensating transactions. Existing audit and allocation history is released/extended, never deleted.
- Every compensation records `compensates_operation_id`, actor, membership, session, entity versions, `change_seq`, and redacted table changes.
- Entity versions and the complete active table set must still match the target operation.
- Old tables are locked and checked for active allocations before compensation. Actor or allocation conflicts fail closed with no partial mutation.
- Undo/redo routes keep Auth, RBAC, CSRF, and the BA-002 shared idempotency transaction.
- A new same-session operation removes the old redo candidate naturally because it becomes the latest session operation.
- The HTTP UI reads server state; browser-local mock stacks are not the authority in HTTP mode. Keyboard shortcuts ignore editable form controls so draft input is not destroyed.

## Baseline preservation

- BA-002: undo/redo uses `idempotent(...)` plus `idempotencyTransaction(response)`; replay returns the committed response.
- BA-003/BA-004/BA-023: full MySQL and Sprint 2 HTTP scenarios passed.
- BA-005: no baseline lock/concurrency code was replaced. Focused race/stress/deadlock suite passed 16/16.
- Existing Auth/RBAC/CSRF, phone encryption/masking, append-only audit, and `change_seq` behavior remain intact.
- No BA-020 migration was needed because the baseline schema already includes `auth_session_id`, `is_undoable`, and `compensates_operation_id`.

## Tests added

`api/test/ba020-undo-redo.mysql.test.ts` verifies:

- booking reassignment undo/redo;
- booking merge undo/redo;
- visit move undo/redo;
- visit merge undo/redo;
- append-only compensation chains;
- same-user/different-session rejection;
- actor/allocation conflict rollback;
- redo invalidation after a new operation;
- unauthenticated, CSRF, and RBAC rejection;
- idempotent HTTP replay without duplicate compensation.

The Web HTTP contract test now verifies `GET /operations/undo-state`, `POST /operations/undo`, and `POST /operations/redo`.

## Verification receipts

| Gate | Result |
|---|---|
| Typecheck | PASS |
| Lint | PASS; existing Web warnings only, no errors |
| Production HTTP build (`VITE_API_MODE=http`, same-origin `/api/v1`) | PASS |
| API unit without MySQL opt-in | PASS — 18 files, 207 tests; integration suites skipped by guard |
| Web unit | PASS — 23 files, 341 tests |
| BA-020 focused MySQL | PASS — 5/5 |
| Full MySQL | PASS — 33 files, 443 tests; 13 policy/environment skips |
| BA-005 focused concurrency | PASS — 16/16 |
| Phase 2B HTTP E2E | PASS — 17 checks; cleanup `0` |
| NA-11 HTTP E2E | PASS — 11 check groups; cleanup `0` |
| Sprint 2 HTTP E2E | PASS — BA-023, BA-004, AT1–AT13; cleanup `0` |

All database-writing verification targeted only `gam21_platform_it_test`.

## Remaining risks / NEED_PO

- `NEED_PO`: number of distinct historical undo levels is not specified. The implementation exposes only the current session tip and its redo compensation; it does not invent an arbitrary stack depth.
- `NEED_PO`: no time-based expiry is enforced because no approved expiry value exists.
- `NEED_PO`: cancellation and operations outside the four listed actions require explicit restoration semantics before they can be made undoable.
- Verification ran with Node `25.8.0`; the repository declares `>=24 <25`. All gates passed, but CI should repeat on the declared Node 24 runtime.

## Verdict

`BA020_RECOVERED_AND_VERIFIED`

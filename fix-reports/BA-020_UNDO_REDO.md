# BA-020 — Undo/Redo (US-10)

Date: 2026-11-07

Repository: `Tusie69/Bar_management`

Target branch: `develop`

## 1. Git baseline

- Baseline: `origin/develop` at `30fb2cb81b7a58d1f62f3e0c74c96ce018a82ed9`.
- BA-020 existed as uncommitted work and was first protected on the immutable
  snapshot branch `codex/backup-ba020-recovery-20261107` at `550cfa4`, with an
  independent bundle at `C:\Users\TuNgu\BA020-recovery-backups\20261107-550cfa4\`
  (SHA-256 `F2158F6F2C8EACD87860ECDA80ACD920DCEFE4893AFDA743C80064519C926CA1`).
- Clean integration commit `ca292e6`, verification commit `6c19f3e`,
  formatting `99b4e4f`, mobile parity and scenario coverage `d56425b`.
- No reset, clean, force checkout, rebase, force push, history rewrite, branch
  or worktree deletion, and no migration against a dev or production database.
- BA-002, BA-003, BA-004, BA-005 and BA-023 reports and code are all present and
  unmodified by BA-020.

## 2. US-10 / PO traceability

US-10 (Use Case / User Story Lễ tân v2.0, source Anh Luân 19/10 MUST, 21/10 S4)
states three approved rules and four acceptance criteria:

| US-10 rule / criterion | Where it is satisfied |
|---|---|
| Undo returns the operation to its starting point | Compensating operation restores the recorded `previousTableIds` |
| Undo result syncs to the system and every device | Venue `change_seq` is advanced inside the same transaction; clients refetch |
| Each device undoes only its own latest operation | `auth_session_id` ownership plus latest-row check |
| K1 undo merge 10+12 to split | `RESERVATION_TABLES_MERGED`, `VISIT_TABLES_MERGED` |
| K2 undo transfer B3 to B5, back to B3 and B5 free | `RESERVATION_TABLES_REASSIGNED`, `VISIT_TABLES_MOVED` |
| K3 device B cannot undo device A operation | `NOT_LATEST_DEVICE_OPERATION` |
| K4 redo after undo of a merge | Redo compensation of the `UNDO_*` row |
| US-08 sync applies to undo as well | `change_seq` advance drives the existing projection polling |

## 3. Approved scope

Only the four operations whose before/after table state is explicitly recorded
and safely reconstructable are undoable:

| Operation | Approved | Reversible | Required data | Risk |
|---|---|---|---|---|
| Booking table reassign (`RESERVATION_TABLES_REASSIGNED`) | Yes (K2) | Yes | previous/new table ids, reservation version | High |
| Booking table merge (`RESERVATION_TABLES_MERGED`) | Yes (K1) | Yes | previous/new table ids, group snapshot | High |
| Visit table move (`VISIT_TABLES_MOVED`) | Yes (K2) | Yes | previous/new table ids, visit version | High |
| Visit table merge (`VISIT_TABLES_MERGED`) | Yes (K1) | Yes | previous/new table ids, group snapshot | High |
| Booking create / update | NEED_PO | Not attempted | — | — |
| Booking cancel | NEED_PO | Not attempted | — | High |
| Waitlist seat, check-in, visit close | NEED_PO | Not attempted | — | High |
| Phone call | NEED_PO | Irreversible | — | High |

Everything outside the four actions fails closed with `NOT_UNDOABLE`. Nothing
outside them is presented in the UI as undoable.

## 4. Unresolved decisions (NEED_PO)

- **N5, undo depth.** US-10 records "Số bước hoàn tác: [?]". Only the session
  current tip and its redo are exposed; no arbitrary stack depth was invented.
- **N5, multi-device undo.** Listed as still open in the summary table. The
  implementation applies the one approved rule: own device, own latest step.
- **Time window.** No approved expiry value exists, so no expiry is enforced.
- **Cancel / check-in / waitlist / visit close.** These need explicit
  restoration semantics (what happens to a HOLD given away, to a Visit with
  later activity) before they can be made undoable.

## 5. Design

Compensation, never rollback or history edit. A successful undo is a new
forward mutation with its own audit row; the original rows are never altered or
deleted, so `operation_log` stays append-only.

- **Eligibility.** The single latest `operation_log` row for this organization,
  venue and `auth_session_id`, `actor_kind = 'USER'`, `is_undoable = 1`, not yet
  compensated, and whose base action is one of the four approved actions. A row
  whose action starts with `UNDO_` offers redo instead of undo.
- **Ownership.** The server-side `auth_session_id` is the device key. It is read
  from the authenticated session, never from the request body or localStorage.
- **Concurrency.** `SELECT ... FOR UPDATE` on the operation row, then the
  entity, then its allocations, then the venue row, matching the BA-005 lock
  order. Entity `version` must still equal `entity_version_after`, and the
  complete active table set must still equal the operation `newTableIds`.
- **Invariants re-checked at compensation time.** Target tables are locked and
  validated for kind, adjacency and capacity, and must have no other active
  allocation on that business date; otherwise `UNDO_CONFLICT_MODIFIED`. Undo is
  never a blind reverse call of the original endpoint.
- **Atomicity.** Release, re-allocate, group dissolve/create, entity version
  bump, `change_seq` advance and the audit insert all run in one transaction.
- **Idempotency.** Routes reuse BA-002 `idempotent()` and the shared
  `idempotencyTransaction(response)`, so a retried key replays the committed
  response instead of compensating twice.
- **Redo invalidation.** A new operation in the same session becomes the latest
  row, so the previous `UNDO_*` row stops being a redo candidate naturally.

## 6. API contracts

| Endpoint | Auth | Permission | CSRF | Body | Result |
|---|---|---|---|---|---|
| `GET /api/v1/operations/undo-state` | required | `operation.undo` | n/a | — | `{ undo, redo }`, each `null` or `{ operationId, action, summary }` |
| `POST /api/v1/operations/undo` | required | `operation.undo` | required | `{ operationId }` | `{ operationId, changeSeq, summary, undoable }` |
| `POST /api/v1/operations/redo` | required | `operation.undo` | required | `{ operationId }` | same shape |

Errors: `NOT_LATEST_DEVICE_OPERATION`, `NOT_UNDOABLE`, `UNDO_CONFLICT_MODIFIED`,
`UNDO_SESSION_REQUIRED`, `REDO_REQUIRED`, `UNDO_REQUIRED`,
`INSUFFICIENT_TABLE_CAPACITY`, `INVALID_OPERATION_ID`. No PII in any payload.

## 7. Database and migration impact

No migration. The baseline schema already carries `operation_log.auth_session_id`,
`is_undoable` and `compensates_operation_id`, and the `operation.undo` permission
already exists. Confirmed directly against `gam21_platform_it_test`: every
migration through `0014` reported "đã chạy" with nothing pending.

## 8. Files changed

| File | Change |
|---|---|
| `api/src/modules/operations/operation.repository.ts` | new: eligibility, compensation, audit, `change_seq` |
| `api/src/modules/operations/operation.route.ts` | new: three routes with auth, RBAC, CSRF, idempotency |
| `api/src/app.ts` | mount `operationRouter` |
| `api/src/modules/bookings/booking.repository.ts` | record previous/new table ids and session on table operations |
| `api/src/modules/visits/visit.repository.ts` | same for visit move and merge |
| `web/src/features/operations/use-undo-redo.ts` | new: shared client controller and shortcuts |
| `web/src/features/operations/editable-target.ts` | new: draft-preserving shortcut guard |
| `web/src/app/shell.tsx` | Desktop top bar uses the shared controller |
| `web/src/features/mobile/{ui,map,home}.tsx` | Undo/Redo on Mobile V1, floor map included |
| `web/src/services/{contracts.ts,http/http-api.ts,mock/server.ts}` | contract and adapter |
| `api/test/ba020-undo-redo.mysql.test.ts` | 10 integration scenarios |
| `web/src/features/operations/editable-target.test.ts` | 4 unit scenarios |
| `web/src/services/http/http-api.contract.test.ts` | endpoint contract |

## 9. Scenario coverage

| Case | Status | Evidence |
|---|---|---|
| UNDO-01 undo a valid operation | PASS | reassign, merge, visit move, visit merge |
| UNDO-02 redo what was undone | PASS | same tests |
| UNDO-03 no prior operation | PASS | empty state, `NOT_LATEST_DEVICE_OPERATION` |
| UNDO-04 another user | PASS | different session refused |
| UNDO-05 another session/device | PASS | isolation test |
| UNDO-06 entity changed by another actor | PASS | `UNDO_CONFLICT_MODIFIED` |
| UNDO-07 two concurrent undos | PASS | one winner, exactly one compensation row |
| UNDO-08 undo racing a mutation | PASS | version plus active-set precondition |
| UNDO-09 retry with the same Idempotency-Key | PASS | `idempotent-replayed: true`, identical body |
| UNDO-10 response lost after commit | PASS | same replay path |
| UNDO-11 failure before commit | PASS | no partial mutation asserted |
| UNDO-12/13 failure between compensation, audit, `change_seq` | PARTIAL | one transaction makes these unreachable by construction; no fault injection written |
| UNDO-14 old table already taken | PASS | conflict test takes the old table first |
| UNDO-15 booking already cancelled | PASS | refused, allocations stay released |
| UNDO-16 redo after a new operation | PASS | redo invalidation test |
| UNDO-17 cross venue / organization | PASS | isolation test |
| UNDO-18 CSRF / RBAC / unauthenticated | PASS | 401, 403, 403 |
| UNDO-19 mobile UI | PASS (indirect) | Sprint 2 and NA-11 mobile viewports drive the modified headers; no component-render harness exists in `web` |
| UNDO-20 desktop UI | PASS (indirect) | Phase 2B and NA-11 desktop flows |
| UNDO-21 preserve form draft | PASS | `editable-target` unit tests; NA-11 draft-retention check |
| UNDO-22 floor projection after compensation | PASS | `change_seq` advance plus full query invalidation; Phase 2B `floorRefetch`, `twoBrowserSync` |
| UNDO-23 audit / operation history | PASS | append-only chain with `compensates_operation_id` links |
| UNDO-24 business date across midnight | PASS | 23:45 booking restores on the original business date |

## 10. Verification receipts

All executed in this session on Node 25.8.0, writing only to
`gam21_platform_it_test` and `gam21_platform_test`.

| Gate | Result |
|---|---|
| Typecheck (api + web) | PASS |
| Lint (api + web) | PASS, pre-existing web warnings only |
| Production HTTP build (`VITE_API_MODE=http`, `/api/v1`) | PASS |
| API unit, no MySQL opt-in | PASS — 18 files, 207 tests |
| Web unit | PASS — 24 files, 345 tests |
| Full MySQL integration | PASS — 33 files, 448 tests, 13 opt-in skips |
| BA-020 focused MySQL | PASS — 10/10 |
| BA-005 plus allocation concurrency focused | PASS — 27/27 |
| Manual no-show opt-in | PASS — 13/13 (accounts for the 13 skips above) |
| Phase 2B HTTP E2E | PASS — 17 checks, cleanup `0` |
| NA-11 HTTP E2E | PASS — 11 check groups, `errors: []`, cleanup `0` |
| Sprint 2 HTTP E2E | PASS — BA-023, BA-004, AT1 to AT13, cleanup `0` |

Baseline comparison: API unit 207 unchanged; MySQL 438 to 448; web unit 342 to 345.
The web count moves because two table-driven "unsupported endpoint" cases for
`undo` and `redo` are no longer valid once the endpoints exist, replaced by a
real contract test plus four draft-preservation tests.

## 11. Security review

Authentication required on all three routes; `operation.undo` enforced; CSRF
required on both mutations; organization and venue scoping in every statement;
device ownership resolved server-side only; no phone or customer PII in request
or response bodies; audit rows store table ids and operation ids, not guest
data; no new dependency and no new environment variable.

## 12. Frontend integration

Desktop and Mobile V1 share `useUndoRedo`, so there is one API contract. Buttons
enable only from the server `undo-state`; a disabled button means the server
reported no candidate. The mutation holds a pending state, a conflict surfaces
through the existing error reporter and is never retried automatically, and a
success invalidates every query so the floor projection resynchronises.
Ctrl/Cmd+Z is ignored inside inputs, textareas, selects and contenteditable
hosts, so a draft is never lost. Mock mode keeps its local stack untouched; the
client never fakes a compensation the database did not perform.

## 13. Remaining risks

- UNDO-12/13 rely on transactional reasoning rather than injected faults.
- Verified on Node 25.8.0 while the repository declares `>=24 <25`; CI should
  repeat these gates on Node 24.
- Undo depth, any time window, and undo for cancel, check-in, waitlist and visit
  close all remain NEED_PO.
- Mobile Undo/Redo was verified through the existing browser E2E viewports; the
  `web` package has no component-render test harness to assert the buttons
  directly, and adding one was out of scope.

## 14. Git status

Local commits on `develop`, nothing pushed. No `.env`, `audit-reports/`, secret
or test database content is tracked in any BA-020 commit.

## 15. Verdict

`IMPLEMENTED_WITH_LIMITATIONS` — the four approved table operations are
implemented, verified and regression-clean; every other operation is explicitly
NEED_PO and fails closed.

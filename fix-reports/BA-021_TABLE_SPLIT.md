# BA-021 — Split (Tách bàn)

Date: 2026-11-07

Repository: `Tusie69/Bar_management`

Branch: `develop` (local)

> **Superseded in part.** The PO answered on 07/11/2026. Sections 2 (NEED_PO)
> and 9 (remaining risks) are superseded by
> [BA-021_SPLIT_PO_DECISIONS.md](BA-021_SPLIT_PO_DECISIONS.md), which records
> SPL-01 to SPL-05, the GWT acceptance criteria and the final verdict. The
> design, lock order and audit below still apply.

## 1. Environment

| Item | Value |
|---|---|
| Worktree used | `C:\Users\TuNgu\AndroidStudioProjects\Bar_management-ba020-verified`, switched to `develop` |
| Baseline | `5463960` (BA-020 integrated) |
| `origin/develop` | `30fb2cb`, untouched |
| Node | **24.22.2**, portable, SHA-256 verified against `SHASUMS256.txt` |
| Node before | 25.8.0 violated `engines: >=24 <25`; no nvm/fnm/volta on the machine |
| Databases written | `gam21_platform_it_test`, `gam21_platform_test` only |

`develop` was not checked out in any of the seven worktrees. It was checked out
in the worktree above, which already held the same commit. The protected branch
`codex/backup-ba020-recovery-20261107` was never touched.

## 2. Requirement discovery

Sources read: Use Case / User Story Lễ tân v2.0, the existing API, the table
group / visit / allocation / audit source, and the client contract.

**APPROVED**

| Rule | Source |
|---|---|
| Split is an operation of its own, with its own button | US-04 rule, 20/10 |
| Split belongs to the receptionist scope "Gán bàn, ghép bàn liền nhau, gộp ghế Bar, tách bàn" | UC-B (US-01, US-04, US-05) |
| Permission row "Đổi / ghép / tách bàn": Lễ tân ✓ | permission matrix |
| `visit.split` exists and is granted to the receptionist role | migration `0001` |
| Keep the chosen tables with the party, release the rest with reason `SPLIT`; the group symbol disappears; usage history is kept | `SplitInput`, mock `splitGroup`, `SplitDialog` — the contract already in this repository |
| Undoing a merge yields the split state | US-10-K1, delivered by BA-020 |

**NEED_PO**

- US-04 has no Given/When/Then criterion for Split. K1–K8 cover transfer,
  occupied target, cancelled popup, merge adjacency, bar-seat adjacency, cancel,
  and the late / no-show clock. Split has a rule and a button but no acceptance
  criterion, so no behaviour beyond the existing contract was invented.
- Guest count after a split is not specified. `guest_count` is left unchanged
  and capacity is **not** re-validated, matching the mock. A party of 8 kept on
  one table for 4 is therefore allowed. Needs a decision.
- Bill consequences are out of scope here: a merged group bills as one
  ("bàn ghép tính 1 bill ... trừ khi khách yêu cầu khác") while bill splitting
  belongs to the Cashier module ("tách bill thuộc Thu ngân"), to be built later.
- Keeping every table of the group is accepted and re-groups them under a new
  symbol. The dialog labels that case "Bỏ ký hiệu ghép", which reads as removing
  the symbol rather than replacing it. Mock behaves the same way, so the backend
  matches the mock and the copy mismatch is left for the PO.
- Mobile has no Split button. US-05 lists the mobile table popup as Sửa, Chuyển
  bàn, Ghép bàn, Hủy, Đón khách, Gọi khách — Split is not among them, so none
  was added.
- Partial split into two parties that both keep tables is not specified. The
  contract releases the detached tables rather than handing them to a second
  party.

## 3. Current state found

`splitGroup` was fully specified and exercised on the client — contract type,
mock implementation with a unit test, desktop dialog wired in `table-detail.tsx`
— but the HTTP adapter was `rejectUnsupported("tách nhóm bàn")`. Split therefore
worked in mock mode only and failed against the real backend. No backend
endpoint, repository function or integration test existed. `dissolveUnusedGroups`
is cleanup for groups that already have no active allocation, not a split.

## 4. Implemented scope

`POST /api/v1/tables/groups/:id/split`

| Aspect | Behaviour |
|---|---|
| Auth | required |
| Permission | `visit.split` (baseline permission, receptionist and owner admin) |
| CSRF | required |
| Body | `{ keepTableIds: number[] }` |
| Result | `{ operationId, changeSeq, summary, undoable: false, splitGroupId, group, keptTableIds, releasedTableIds, owner }` |

Flow, all inside one transaction:

1. Probe the group's active allocations unlocked, only to learn the owner.
2. Lock the owner (visit, or hold) — rejecting a closed visit or an inactive hold.
3. Lock the group's allocations, then the group row.
4. Re-validate: group still active, allocation set unchanged, every kept table
   still in the group. Otherwise `GROUP_STATE_CHANGED` / `GROUP_NOT_FOUND`.
5. Release every allocation of the group with `release_reason = 'SPLIT'`.
6. Dissolve the group.
7. Re-allocate the kept tables, preserving `kind`, `hold_id`, `visit_id` and
   business date; create a new group with a fresh symbol if two or more are kept.
8. Bump the owner version (`visits.version` or `table_holds.version`).
9. Advance venue `change_seq`.
10. Append the `TABLES_SPLIT` audit row on `table_group`.

Errors: `SPLIT_REQUIRES_KEPT_TABLE`, `SPLIT_TABLE_NOT_IN_GROUP`,
`GROUP_NOT_FOUND`, `GROUP_STATE_CHANGED`, `GROUP_STATE_INCONSISTENT`,
`VISIT_ALREADY_CLOSED`, `HOLD_NOT_ACTIVE`, `INVALID_GROUP_ID`,
`TABLES_REQUIRED`, `INVALID_TABLE_ID`. No PII in any payload.

Lock order is the merge path's order — owner entity, allocations, group, venue —
so Split and Merge cannot deadlock against each other. That is why the owner is
discovered with an unlocked probe and everything is re-validated after locking.

`is_undoable = 0` on the audit row: BA-020 cannot compensate a Split, so the
row does not claim that it can, and undo fails closed with `NOT_UNDOABLE`. A
Split also becomes the session's latest operation, so it correctly prevents
undoing an older step.

## 5. Preservation of earlier work

- **BA-020**: untouched. A regression test asserts that after a Split the undo
  state is empty, so no false undo affordance appears.
- **BA-005**: no baseline lock or concurrency code replaced; lock order matches
  merge; the focused concurrency suite still passes 42/42 together with BA-021.
- **BA-002**: untouched. Split takes no idempotency key, matching the sibling
  merge and move routes; see Remaining risks.
- **Frontend Sprint 2 Final**: only the adapter line changed; mock mode keeps
  its own implementation; all three browser E2E suites pass.

## 6. Database

No migration. `table_allocations.release_reason` is a free `VARCHAR(30)` with no
CHECK constraint, `operation_log.action` and `entity_type` likewise, and
`visit.split` is granted in migration `0001`. Verified directly against
`gam21_platform_it_test`: migrations through `0014` all reported "đã chạy".

## 7. Files changed

| File | Change |
|---|---|
| `api/src/modules/tables/table-split.repository.ts` | new: `splitTableGroup` |
| `api/src/modules/tables/table.route.ts` | new split route |
| `api/test/ba021-table-split.mysql.test.ts` | new: 10 integration scenarios |
| `web/src/services/http/http-api.ts` | `splitGroup` now calls the endpoint |
| `web/src/services/http/http-api.contract.test.ts` | split moved out of the unsupported list, real contract test added |

## 8. Test results

Every gate below was executed on **Node 24.22.2**.

| Gate | Result |
|---|---|
| Typecheck (api + web) | PASS |
| Lint (api + web) | PASS, pre-existing web warnings only |
| Production HTTP build | PASS |
| API unit, no MySQL opt-in | PASS — 18 files, 207 tests |
| Web unit | PASS — 24 files, 345 tests |
| Full MySQL integration | PASS — 34 files, **458** tests, 13 opt-in skips |
| BA-021 focused MySQL | PASS — 10/10 |
| BA-005 + allocation + BA-020 + BA-021 focused | PASS — 42/42 |
| Manual no-show opt-in | PASS — 13/13 |
| Phase 2B HTTP E2E | PASS — 17 checks, cleanup `0` |
| NA-11 HTTP E2E | PASS — `errors: []`, cleanup `0` |
| Sprint 2 HTTP E2E | PASS — 11 PASS lines, cleanup `0` |

MySQL moved 448 to 458, exactly the ten BA-021 scenarios. API unit and web unit
are unchanged, because the removed "unsupported endpoint" case for `splitGroup`
is replaced by the new contract test.

Scenario coverage: core split with release reason and dissolved group;
re-grouping when two or more tables stay; empty keep list; table outside the
group; unknown group; already split group; two concurrent splits with exactly
one winner, one audit row and no orphan group; booking hold group with the hold
left active; closed visit and cancelled booking refused; Split not offered as
undoable; 401, 403 for the wrong role, 403 without CSRF, and 400 on a malformed
body.

## 9. Remaining risks

- The client contract carries no version or precondition token for Split, so
  there is no optimistic concurrency check from the caller. Integrity rests on
  locking plus re-validation, which the concurrency test exercises. Adding a
  version would change the contract the desktop UI and mock already use.
- Split takes no `Idempotency-Key`. A retry after a lost response does not
  replay; it fails with `GROUP_NOT_FOUND` because the group is already
  dissolved. That is safe — no duplicate mutation — but it is not the BA-002
  replay behaviour. Worth aligning if the PO wants Split to be retry-safe.
- Capacity is not re-validated after a split; see NEED_PO.
- No fault injection between release, audit and `change_seq`; they share one
  transaction.

## 10. Git status

| Commit | Content |
|---|---|
| `1fb07a9` | source, route, adapter and tests |
| this report | separate commit |

Local commits on `develop` only. Nothing pushed, no reset, rebase, force or
history rewrite, no branch or worktree removed, no real database migrated. No
`.env`, `audit-reports/` or secret is tracked.

## 11. Verdict

`IMPLEMENTED_WITH_LIMITATIONS`

Split now works end to end against the real backend, atomically, with
concurrency protection, correct group/Visit/hold/allocation handling, audit and
`change_seq`, and it preserves BA-002, BA-005, BA-020 and Sprint 2 Final. It is
not `IMPLEMENTED_AND_VERIFIED` because US-04 states a rule and a button for
Split but no acceptance criterion, and three real policy questions — guest count
and capacity after a split, the keep-all wording, and whether Split should be
idempotent — remain NEED_PO. Nothing beyond the existing in-repo contract was
invented.

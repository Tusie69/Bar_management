# BA-021 — Split completion under the PO decisions of 07/11/2026

Date: 2026-11-07

Repository: `Tusie69/Bar_management`

Branch: `develop` (local)

Baseline for this round: `3a6b450`. Implementation commit: `e49f66d`.

Supersedes the NEED_PO items recorded in [BA-021_TABLE_SPLIT.md](BA-021_TABLE_SPLIT.md)
sections 2 and 9. The design, lock order and audit described there still apply.

## 1. PO decisions received

| Id | Decision |
|---|---|
| SPL-01 | Refuse a Split if the kept tables' total capacity is below `guest_count`. |
| SPL-02 | Refuse a Split that keeps every table, releasing none. |
| SPL-03 | A retry with the same `Idempotency-Key` and the same payload returns the committed result, with no duplicate mutation or audit; follow BA-002. |
| SPL-04 | Support Split on desktop and Mobile V1 through one API contract. |
| SPL-05 | Add GWT acceptance criteria for Split and record the PO decision and its basis. |

## 2. SPL-05 — acceptance criteria

Decision source: PO, 07/11/2026. Basis: US-04 approves Split as an operation of
its own with its own button (20/10); UC-B places it in the receptionist scope;
the permission row "Đổi / ghép / tách bàn" grants it to Lễ tân; `visit.split`
exists in migration `0001`. US-04 previously carried no Given/When/Then for
Split, which is what these criteria now supply.

| Code | Given | When | Then |
|---|---|---|---|
| US-04-S1 | Bàn 10 và 12 đang ghép cho 4 khách, mỗi bàn 4 chỗ | Lễ tân chọn Tách, giữ 10, bỏ chọn 12 | 10 giữ khách, 12 về Trắng, ký hiệu ghép biến mất, mọi máy cập nhật |
| US-04-S2 | Nhóm 3 bàn đang ghép | Lễ tân giữ 2 bàn, nhả 1 bàn | 2 bàn giữ lại vẫn ghép dưới ký hiệu mới, bàn còn lại về Trắng |
| US-04-S3 | Nhóm 2 bàn, 8 khách, mỗi bàn 4 chỗ | Lễ tân giữ 1 bàn | Báo lỗi không đủ sức chứa, nhóm giữ nguyên, không bàn nào bị nhả (SPL-01) |
| US-04-S4 | Nhóm 2 bàn đang ghép | Lễ tân giữ cả 2 bàn | Nút xác nhận bị vô hiệu; nếu gọi API thì bị từ chối, nhóm giữ nguyên (SPL-02) |
| US-04-S5 | Nhóm đang ghép, không chọn bàn nào để giữ | Lễ tân xác nhận | Báo phải giữ ít nhất một bàn; muốn trả hết bàn thì dùng Nhả bàn |
| US-04-S6 | Lễ tân vừa Tách thành công nhưng mất phản hồi | Gửi lại cùng `Idempotency-Key` và cùng payload | Trả lại đúng kết quả đã commit, không nhả thêm bàn, không thêm dòng nhật ký (SPL-03) |
| US-04-S7 | Đã dùng một `Idempotency-Key` cho một lần Tách | Gửi cùng key với payload khác | Bị từ chối `IDEMPOTENCY_KEY_REUSED`, không tạo mutation mới (SPL-03) |
| US-04-S8 | Hai máy cùng Tách một nhóm | Hai yêu cầu gửi đồng thời | Chỉ một yêu cầu thành công, đúng một dòng nhật ký, không phát sinh nhóm mồ côi |
| US-04-S9 | Bàn cũ đã bị nhóm khác dùng, hoặc lượt khách đã đóng, hoặc booking đã hủy | Lễ tân Tách | Bị từ chối an toàn, không thay đổi dữ liệu |
| US-04-S10 | Lễ tân dùng Mobile V1 | Chạm nhóm bàn, chọn Tách bàn, giữ một phần | Cùng kết quả và cùng API như desktop (SPL-04) |
| US-04-S11 | Tài khoản không có quyền `visit.split`, hoặc chưa đăng nhập, hoặc thiếu CSRF | Gọi API Tách | 401 / 403, không thay đổi dữ liệu |
| US-04-S12 | Vừa Tách bàn xong | Mở Hoàn tác | Không có thao tác nào để hoàn tác; Split không được chào là undoable |

## 3. Implementation

### SPL-01 capacity

The kept tables' capacities are summed and compared with the owner's guest
count, which is the rule merge and assignment already use, and the existing
`INSUFFICIENT_TABLE_CAPACITY` code is reused. No new calculation was written.

Guest count source, unchanged by Split: `visits.guest_count` for a USAGE group,
and the `party_size` of the reservation behind the hold for a HOLD group. The
check runs after the group, allocations and owner are locked, so it sees the
committed state. `guest_count` is never rewritten to fit the kept tables.

### SPL-02 release at least one table

`SPLIT_RELEASES_NO_TABLE` (409) when the kept set equals the group. The dialog
disables confirm and shows "Bỏ chọn ít nhất một bàn để nhả"; the misleading
"Bỏ ký hiệu ghép" branch is gone. The mock refuses the same case, so mock mode
and HTTP mode agree.

### SPL-03 idempotency

The route now carries `idempotent('table.group.split')`, and
`splitTableGroup` accepts the shared `idempotencyTransaction(response)`
connection exactly as BA-020's compensation does, so the stored response and the
mutation commit together. A retry with the same key and payload replays with
`idempotent-replayed: true` and an identical body; the same key with a different
payload is refused `IDEMPOTENCY_KEY_REUSED` (422).

`SplitInput` carries `idempotencyKey`. Both call sites use the existing
`useIdempotencyKey` hook, holding the key across retries of one attempt and
renewing it only after a commit, which is the pattern the booking and walk-in
forms already follow.

### SPL-04 one contract for both shells

Mobile V1 already had a "Tách bàn" action calling `api.splitGroup`; it now also
carries the key, so desktop and mobile differ only in presentation. Both go
through the same adapter, endpoint, validation and audit.

### Preserved

Single transaction; lock order still owner entity, allocations, group, venue, so
Split and Merge cannot deadlock; append-only allocation history; `change_seq`
advance; `TABLES_SPLIT` audit on `table_group` with `is_undoable = 0`; auth,
`visit.split` and CSRF unchanged. BA-020, BA-002 and BA-005 untouched.

## 4. Files changed

| File | Change |
|---|---|
| `api/src/modules/tables/table-split.repository.ts` | SPL-01 capacity, SPL-02 guard, SPL-03 shared transaction, guest count per owner kind |
| `api/src/modules/tables/table.route.ts` | BA-002 idempotency on the split route |
| `api/test/ba021-table-split.mysql.test.ts` | 14 scenarios (4 new) |
| `web/src/services/contracts.ts` | `SplitInput.idempotencyKey` |
| `web/src/services/http/http-api.ts` | adapter forwards the key |
| `web/src/services/mock/server.ts` | mock enforces SPL-01 and SPL-02 |
| `web/src/services/mock/server.test.ts` | mock-level SPL-01 / SPL-02 test |
| `web/src/features/floor/floor-dialogs.tsx` | SPL-02 in the dialog, capacity wording |
| `web/src/features/floor/table-detail.tsx` | desktop key held across retries |
| `web/src/features/mobile/actions.ts` | Mobile V1 key held across retries |

## 5. Test results

All on **Node 24.22.2**, writing only to `gam21_platform_it_test` and
`gam21_platform_test`.

| Gate | Result |
|---|---|
| Typecheck (api + web) | PASS |
| Lint (api + web) | PASS, pre-existing web warnings only |
| Production HTTP build | PASS |
| API unit, no MySQL opt-in | PASS — 207 tests |
| Web unit | PASS — 24 files, **346** tests |
| Full MySQL integration | PASS — 34 files, **462** tests, 13 opt-in skips |
| BA-021 focused | PASS — **14/14** |
| BA-005 + allocation + BA-020 + BA-021 focused | PASS — 46/46 |
| BA-002 idempotency coverage (`booking-lifecycle`) | PASS — 81 tests |
| Phase 2B HTTP E2E | PASS — 17 checks, `logout: PASS`, cleanup `0` |
| NA-11 HTTP E2E | PASS — `errors: []`, cleanup `0` |
| Sprint 2 HTTP E2E | PASS — 11 PASS lines, cleanup `0` |

Movement from the previous round: MySQL 458 to 462 (capacity on a visit group,
capacity on a hold group, release-nothing, idempotent replay plus fingerprint
mismatch); web unit 345 to 346 (mock SPL-01 / SPL-02).

Criteria mapping: S1 and S2 by the core and re-group tests; S3 by both capacity
tests; S4 by the release-nothing test and the mock test; S5 by the empty keep
list test; S6 and S7 by the replay test; S8 by the concurrency test; S9 by the
occupied, closed-visit and cancelled-booking tests; S10 by the shared adapter
plus the mock test on the path Mobile V1 uses, and the Sprint 2 and NA-11 mobile
viewports for regression; S11 by the transport security test; S12 by the undo
refusal test.

## 6. Remaining risks

- S10 is covered by the shared contract, the mock test and the mobile E2E
  viewports, not by a browser E2E that drives the mobile Split pick flow
  end to end. The `web` package has no component-render harness, and extending
  a browser suite with a Split journey was not part of these decisions.
- Split still carries no version or precondition token from the client;
  integrity rests on locking plus re-validation, now joined by idempotent
  replay. Adding a version would change the contract both shells use.
- A Split remains non-undoable. If the PO later wants Undo for Split, BA-020
  needs a compensation for `TABLES_SPLIT` and the audit row's `is_undoable`
  must change with it.
- Capacity is validated at split time only. A later guest-count increase can
  still leave a party above the capacity of its remaining tables; that path
  belongs to the guest-count flow, not to Split.
- No fault injection between release, audit and `change_seq`; they share one
  transaction.

## 7. Git

| Commit | Content |
|---|---|
| `e49f66d` | source, mock, frontend and tests |
| this report | separate commit |

Local commits on `develop` only. Nothing pushed, no reset, rebase, force or
history rewrite, no worktree or branch removed, no real database touched. No
`.env`, `audit-reports/` or secret is tracked.

## 8. Verdict

`IMPLEMENTED_AND_VERIFIED`

All five PO decisions are implemented and verified on Node 24 against a
disposable MySQL, with GWT criteria recorded and every earlier BA-021 NEED_PO
item that the PO answered now closed. The remaining risks above are scope
boundaries and follow-ups, not unverified behaviour.

# BA-003 — Canonical Walk-in Consistency

Date: 2026-11-07  
Branch: `develop`  
Verdict: **FIXED_AND_VERIFIED**

## 1. Baseline Git

- Sprint 2 remote baseline: `9621856daf15362d54e7be029dbce37753ebcc93` (`origin/develop`).
- BA-002 source: `83dea371b602e5cccb7d1e8649420098326348a5`.
- BA-002 report: `49fae03263b2b14614981e2c238f7ed9b1cd7f3b`.
- BA-003 source/test/docs: `ede2b723ebfc136f1b14141d84272bc504d22886`.
- BA-003 additional race/business-date tests: `e6422e5`.
- BA-002 was verified as an ancestor before work. `origin/develop` was fetched and remained at the Sprint 2 baseline. No push, force operation, rebase, merge or history rewrite was performed.
- Entry state had no tracked modifications. Existing `audit-reports/` (10 untracked files), `api/.env` and `web/.env` were preserved and never staged.

## 2. Audit coverage and current flow classification

| Component | Direct `POST /bookings/walk-ins` before BA-003 | Waitlist `POST /waitlist/:id/seat` | Final status |
|---|---|---|---|
| Auth / CSRF / permission | `visit.walkin` and CSRF present | Existing permissions present | DONE |
| Input / current business date | Party/table IDs and current shift present; optional name incomplete | Version/kind/date checks present | DONE |
| Canonical table validation | Manual ACTIVE/spare subset only | `lockAndValidateAssignableTables` | FIXED / DONE |
| Capacity | Missing | Present | FIXED / DONE |
| Venue / zone / kind | Venue predicate incomplete; zone/kind missing | Present | FIXED / DONE |
| Allocation conflict | Open allocation check present | Scoped/locked conflict check present | DONE |
| Multi-table group | Missing | Present | FIXED / DONE |
| Visit / USAGE | Present | Present for `arrived:true` WALK_IN | DONE |
| Waitlist transition | N/A | SEATED with `visit_id` | DONE |
| Audit | Missing | `WAITLIST_SEATED` present | FIXED / DONE |
| `change_seq` | Missing | One increment present | FIXED / DONE |
| Transaction | BA-002 shared connection supported | One repository transaction | DONE |
| Idempotency | BA-002 middleware/shared connection present | Version + row locks prevent double-seat | DONE |
| Floor/polling visibility | Visit visible, but no direct mutation sequence | Visit/group projection and sequence present | FIXED / DONE |
| Concurrency | Partial coverage | Double-seat coverage present | FIXED / DONE |
| Capacity override Q04/Q05 | No override | No override | NEED_PO / safely unchanged |

## 3. Findings from the previous backend audit

### Already resolved before BA-003

- Q06 present Walk-in seating from the waitlist already performed `Visit + USAGE + SEATED + WAITLIST_SEATED + change_seq` atomically.
- The waitlist flow already created canonical groups, checked capacity, same zone/kind, ACTIVE/non-spare/bookable state, and concurrent conflicts.
- BA-002 already passed the idempotency transaction connection into direct Walk-in and prevented the child repository from committing, rolling back or releasing that shared connection.
- Floor Projection already understood active Visit allocations and group IDs.

### Confirmed remaining defects

- Direct multi-table Walk-in did not create `table_groups` or populate allocation `group_id`.
- Direct Walk-in did not validate combined capacity, bookable zone, same zone or compatible table kind.
- Its table lookup lacked the organization predicate and duplicated a weaker validation implementation.
- It wrote no `operation_log` event and did not increment venue `change_seq`.
- Anonymous Walk-in display fell through to the non-canonical `Khách` fallback instead of `Khách Walk-in`.
- The HTTP/repository contract could not accept an optional protected phone.
- Direct Walk-in concurrency/fault/group/floor coverage was incomplete.

## 4. Root cause

`createWalkIn` predated the canonical assignment helpers and retained a standalone table query plus Visit/allocation loop. Later Sprint 2 work hardened booking assignment and waitlist seating but did not route direct Walk-in through the same invariants. Because the direct function returned immediately after allocations, it also bypassed the canonical group, audit and venue sequence stages. The BA-002 transaction hook made the function transaction-compatible but intentionally did not add these missing domain effects.

## 5. Source changes

- `api/src/modules/bookings/booking.repository.ts`
  - Reuses `lockAndValidateAssignableTables`.
  - Enforces total capacity without introducing an override.
  - Keeps the existing “any unreleased allocation” conflict policy, protecting confirmed/future booking holds and carry-over visits.
  - Creates one canonical group for multiple tables and stores its ID on every USAGE allocation.
  - Stores `Khách Walk-in` when the name is omitted.
  - Protects an optional phone with the existing encryption/HMAC key ring and creates/reuses an ACTIVE customer; no fake phone is generated.
  - Writes one `WALK_IN_CREATED` audit with non-sensitive IDs only and increments `change_seq` once.
- `api/src/modules/bookings/booking.route.ts`
  - Adds optional `phoneNumber` validation and trims the optional 120-character name.
  - Keeps auth, RBAC, CSRF, current-business-date and idempotency middleware unchanged.
- `docs/api.md`
  - Documents the optional name/phone direct Walk-in contract, canonical allocation behavior, idempotency semantics and the existing Q06 `{arrived:true}` transition.
- No migration or schema change was needed.

## 6. Reused canonical validation and helpers

- `lockAndValidateAssignableTables`: organization/venue binding, table existence, ACTIVE status, bookable zone, non-spare state, same-zone and compatible-kind rules.
- `createTableGroup`: canonical per-business-date symbol allocation.
- `protectPhoneNumber`, `phoneKeyRing`, `protectedPhoneValues`: encryption, HMAC and last-three storage.
- `nextVenueChangeSequence`: locked monotonic venue sequence update.
- Existing BA-002 `idempotencyTransaction(response)` connection handoff.

Duplicate input table IDs are normalized once before locks and writes, so no duplicate allocation or group membership can be created. Q10 does not introduce an adjacency check. Existing same-zone/kind rules remain because PO has not removed them.

## 7. Transaction boundaries and data model

Direct Walk-in now runs this sequence on one connection:

`begin/BA-002 shared transaction → normalize IDs → lock/validate tables → capacity → lock conflicts → optional protected Customer → optional Group → Visit → USAGE allocations → change_seq → audit → commit`

When a BA-002 connection is supplied, the repository does not begin, commit, roll back or release it. Any validation, Customer, group, Visit, allocation, sequence or audit failure rolls back the complete effect. A single-table Walk-in has a null `group_id`; a multi-table Walk-in has one live `table_groups` row shared by every active USAGE allocation. No reservation is manufactured for direct or present-waitlist Walk-in.

## 8. Audit and `change_seq`

- Action: `WALK_IN_CREATED`.
- Entity: `visit`, version after `1`.
- Actor user, membership and auth session are retained when available.
- Changes include only `groupId`, allocation IDs, table IDs and party size.
- Guest name and plaintext phone are excluded.
- Exactly one sequence is allocated inside the transaction. Idempotency replay does not allocate another sequence; rollback restores the prior venue sequence.

## 9. Idempotency compatibility

- Existing `Idempotency-Key` behavior remains optional and organization/endpoint/fingerprint bound.
- Same-key concurrent Walk-in requests return the same Visit ID with one Visit, one allocation set, one audit and one sequence increment.
- Injected completion failure leaves no Visit, Customer, group, allocation, audit, sequence or idempotency row; retry succeeds once.
- No nested transaction or premature commit was introduced.

## 10. WALK-01 through WALK-20 evidence

| ID | Evidence | Result |
|---|---|---|
| WALK-01 | Canonical one-table Visit + USAGE assertion | PASS |
| WALK-02 | Two distant same-zone tables share one group | PASS |
| WALK-03 | Omitted name/phone stores/displays `Khách Walk-in` | PASS |
| WALK-04 | Optional phone stored only as protected Customer fields; no response/audit plaintext | PASS |
| WALK-05 | Occupied-table races leave one active allocation | PASS |
| WALK-06 | Existing confirmed HOLD rejects Walk-in and remains intact | PASS |
| WALK-07 | Capacity/zone/kind invalid selection leaves zero Visit/allocation/group/audit | PASS |
| WALK-08 | Two concurrent Walk-ins on one table produce one winner | PASS |
| WALK-09 | Concurrent direct booking vs Walk-in produces one winner | PASS |
| WALK-10 | HTTP booking assign vs Walk-in repeated three times; one winner each | PASS |
| WALK-11 | Q06 waitlist present Walk-in produces Visit/USAGE/SEATED | PASS |
| WALK-12 | Concurrent double-seat produces one Visit | PASS |
| WALK-13 | Same Idempotency-Key replays one domain effect | PASS |
| WALK-14 | One audit and one venue sequence increment | PASS |
| WALK-15 | Forced audit/idempotency completion failures leave no partial data | PASS |
| WALK-16 | Cross-venue table ID returns `TABLE_NOT_FOUND`, no Visit | PASS |
| WALK-17 | HTTP Walk-in at local 00:30 retains previous business date | PASS |
| WALK-18 | Confirmed booking allocation has priority and is not overwritten | PASS |
| WALK-19 | Distant tables are accepted without adjacency configuration | PASS |
| WALK-20 | Floor Projection exposes both grouped tables as `IN_USE` with Visit/group metadata | PASS |

## 11. Full regression results

MySQL writes were limited to disposable databases with `_test` guards. `gam21_platform_it_test` was recreated after verifying no active connection. The temporary exact-name `gam21_platform_test` used by the manual no-show suite was created from migrations, verified unused after the suite, then dropped. No dev/production database was used.

| Gate | Result |
|---|---:|
| Typecheck API + web | PASS |
| Lint API + web | PASS, 0 errors; existing web warnings only |
| Production build | PASS |
| API unit | 205/205 PASS |
| Web unit | 286/286 PASS |
| Full MySQL final revision | 412 PASS, 0 FAIL; 13 opt-in skip |
| Manual no-show opt-in | 13/13 PASS |
| Assignment/canonical Walk-in focused | 32/32 PASS |
| Phase 2B live HTTP/MySQL | 17/17 PASS; cleanup `0` |
| NA-11 live HTTP/MySQL | 11/11 groups PASS across 5 viewports; `errors=[]`; cleanup `0` |
| `git diff --check` | PASS |

Baseline BA-002 was 401 active MySQL tests. BA-003 adds 11 active tests, producing 412. The final full run used the exact committed source plus the two additional committed tests.

Two discarded invocations did not execute product assertions: a custom database name was rejected by the integration guard, and an initial NA-11 wrapper lacked `npm_execpath`. One attempted parallel focused run caused two fixture files to clear the same test DB concurrently; it was classified test-orchestration error and rerun sequentially (32/32 plus WALK-17 PASS), followed by the clean 412-test full run.

## 12. Business decisions

- Q03: 15-minute booking schedule and Late +15 / No-show +30 behavior unchanged and covered by full regression.
- Q06: Present waitlist Walk-in path was already correct and remains atomic; no rewrite was made.
- Q10: Non-adjacent grouping remains allowed. Same-zone/kind restrictions remain because they were not revoked.
- Q13: Any unreleased confirmed booking HOLD blocks direct Walk-in; explicit regression PASS.
- US-03: Name and phone are optional; canonical default is `Khách Walk-in`; no fake customer phone is created.
- Q01/Q02: Phone reveal permissions, masking and no-store behavior were not weakened.
- Q04/Q05: Override authorization/policy remains **NEED_PO/NEED_BA**. BA-003 deliberately keeps capacity, spare, status, zone and kind validation with no new bypass.
- If PO wants cross-zone or mixed TABLE/BAR grouping, or wants a supplied name to overwrite an existing phone-linked Customer identity, that requires a separate explicit decision.

## 13. Security and regression review

- Auth/RBAC and CSRF middleware are unchanged.
- Full phone is neither returned by the Walk-in endpoint nor included in audit payloads.
- Customer phone storage uses existing encryption/HMAC/last-three fields.
- No conflict marker, mock production data, plaintext secret, `.env`, audit report or test artifact is included.
- No duplicate Visit, active allocation, orphan group, cross-venue row, partial audit or missing sequence was observed.
- Booking, waitlist, visit close, floor projection, polling, mobile/browser flows and BA-002 fault injection remain green.

## 14. API contract change

`POST /api/v1/bookings/walk-ins` now accepts:

```json
{
  "partySize": 2,
  "businessDate": "YYYY-MM-DD",
  "tableIds": [1],
  "guestName": "optional",
  "phoneNumber": "optional"
}
```

The response remains `201 {"visitId": number}` and never contains phone data. Existing clients omitting both optional fields remain compatible.

## 15. Migration changes

None. The current `customers`, `visits`, `table_groups`, `table_allocations`, `operation_log` and `venues.change_seq` schema already represents the canonical model.

## 16. Remaining questions and limitations

- Q04/Q05 override role matrix, reason requirements and audit shape remain unspecified; no override was implemented.
- Cross-zone and mixed table-kind Walk-in groups remain rejected under the current canonical helper.
- Customer identity is reused by phone HMAC. BA-003 does not silently rename an existing Customer from a new Walk-in request.
- The frontend currently need not send `phoneNumber`; backend support is additive.

None of these items blocks the approved BA-003 behavior.

## 17. Git and local state

- Source/test/docs commit: `ede2b723ebfc136f1b14141d84272bc504d22886`.
- Additional scenario-test commit: `e6422e5`.
- Report/API clarification is committed separately after this document is finalized.
- Local branch remains `develop`; no remote ref changed and no push occurred.
- `audit-reports/` remains untracked. Local `.env` files remain unchanged and ignored.

## 18. Final verdict

**FIXED_AND_VERIFIED**

Direct Walk-in now follows the same canonical allocation invariants as the approved booking/waitlist model, while Q06, Q10, Q13, BA-002 atomic idempotency, security controls and existing local behavior remain intact.

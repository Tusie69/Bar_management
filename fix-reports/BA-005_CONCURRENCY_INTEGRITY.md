# BA-005 — Backend Concurrency & Data Integrity

## 1. Git baseline

- Repository: `Tusie69/Bar_management`
- Verified baseline `develop` and `origin/develop`: `92efcb0ee3284f96b6664b59604cab7fd4d9d41e`
- Audit branch: `codex/ba-005-concurrency-integrity`
- Concurrency test commit: `9ee8899` (`test(api): cover concurrency integrity races`)
- BA-001 through BA-004, BA-023 and Sprint 2 Final remain ancestors.
- At report creation the remote remained at the baseline; release verification is recorded in the final task output after the one permitted push.

No production source or schema change was made because the deterministic race, fault and stress tests did not confirm a new integrity defect.

## 2. Transaction matrix

| Operation / endpoint | Transaction owner | Lock and validation order | Mutation, audit and change sequence | Result |
|---|---|---|---|---|
| Booking create `POST /bookings` | Repository, or idempotency middleware when a key is present | Source lookup; atomic customer upsert and identity lock | Reservation and idempotency result share the same connection/transaction | ALREADY_SAFE |
| Direct booking `POST /bookings/direct` | Repository/idempotency middleware | Tables sorted and locked; active allocations checked; customer resolved | Reservation, hold, group, allocations, venue sequence and audit commit together | ALREADY_SAFE |
| Booking update `PUT /bookings/:id` | Repository | Reservation `FOR UPDATE`, version/status revalidation; related identity locked as needed | Reservation version, audit and venue sequence in one transaction | ALREADY_SAFE |
| Assign/transfer `POST /bookings/:id/assign` | Repository | Reservation; sorted target tables; current allocations; target conflicts | Old hold release, group cleanup, new hold/allocations, version, sequence and audit are atomic | ALREADY_SAFE |
| Booking merge `POST /bookings/:id/merge` | Repository | Reservation; sorted same-zone tables; current allocations; additions; group | Group/allocations, booking version, sequence and audit are atomic; no adjacency restriction | ALREADY_SAFE |
| Booking cancel/no-show | Repository | Reservation; active hold allocations; linked open waitlist entries | Hold release, entry close, group cleanup, booking close and all audit/sequence rows commit together | ALREADY_SAFE |
| Booking check-in | Repository | Reservation; active hold allocations; active USAGE conflicts; linked entries | Visit, HOLD release, USAGE allocations, reservation/entry state and audit commit together | ALREADY_SAFE |
| Direct Walk-in | Repository/idempotency middleware | Sorted assignable tables; active allocation conflicts; customer identity | Visit, optional group, USAGE allocations, sequence and audit are atomic | ALREADY_SAFE |
| Waitlist seat `POST /waitlist/:id/seat` | Repository | Linked reservation first when present; entry; sorted tables; allocation conflicts | Reservation/visit, hold or USAGE, group, entry version, sequence and audit commit together | ALREADY_SAFE |
| Visit move/merge/close | Repository | Permission; visit row; current allocations; sorted target tables/conflicts; group | Allocation release/addition, group state, visit version, sequence and audit commit together | ALREADY_SAFE |
| Idempotent create operations | Idempotency middleware owns shared connection | Unique `(organization_id, idem_key)` row serializes contenders | Domain mutation plus stored HTTP result commit together; failures roll back both | ALREADY_SAFE |

Connection ownership is explicit: repositories accept the middleware transaction only for idempotent create operations and do not commit/release a borrowed connection. All other repositories acquire, commit/rollback and release their own connection.

## 3. Lock ordering audit

### Existing order

- Entity mutations lock the canonical reservation, visit or waitlist row before changing state.
- Requested table IDs are deduplicated and sorted before table locking.
- Allocation scans use `ORDER BY table_id, id` where multiple allocation rows may be locked.
- Booking cancellation/check-in and advance waitlist seating use reservation-before-waitlist ordering.
- Venue `change_seq` is incremented under a venue row lock in the same transaction as its audit row.
- Allocation uniqueness is also enforced by generated-key unique indexes for active USAGE and open claims.

Some cross-entity swap patterns can still form an InnoDB deadlock because visit movement locks its current allocation before target conflicts while a booking reassignment can hold its own allocation and wait on the visit allocation. This is a contention/performance risk, not a data-integrity failure: InnoDB aborts one complete transaction, repositories roll it back, and HTTP maps error 1213/1205 to `409 CONCURRENT_UPDATE_RETRY`. The deterministic FAIL-04 test verifies one complete rollback and a reusable connection pool.

### After BA-005

No production lock order was changed. Changing working order without a reproduced invariant violation could widen lock scope or introduce a different deadlock. The existing deadlock rollback/error contract is now covered by regression tests.

## 4. Confirmed concurrency defects

No new P0 concurrency or data-integrity defect was confirmed.

The audit specifically found no reproducible:

- double active allocation;
- cancelled booking retaining an active claim;
- duplicate Visit or USAGE;
- partial merge or orphan active group;
- lost reservation/waitlist/visit version update;
- audit/change-sequence row surviving rollback;
- idempotency retry restoring stale domain state;
- cross-tenant allocation;
- phone/RBAC regression.

The first FAIL-04 test attempt could not read `information_schema.innodb_trx` because the test user correctly lacks `PROCESS`. The test was changed to use a permission-free database round-trip barrier; no DB privilege was broadened and no assertion was relaxed.

## 5. Race scenarios

| Scenario | Runs / evidence | Result |
|---|---|---|
| RACE-01 transfer vs cancel | 3 independent runs; exactly one winner; final state is either serial transfer or serial cancellation | ALREADY_SAFE |
| RACE-02 merge vs transfer | 3 runs; exactly one winner; no partial group or overlap | ALREADY_SAFE |
| RACE-03 double waitlist seat | 20 simultaneous attempts for one entry; 1 success, 19 conflicts; 1 Visit/USAGE/audit | ALREADY_SAFE |
| RACE-04 booking vs Walk-in | Confirmed booking plus 20 Walk-ins; 0 Walk-in success; booking HOLD retained | ALREADY_SAFE |
| RACE-05 check-in vs transfer | 3 runs; exactly one winner; either one Visit/USAGE or one moved HOLD | ALREADY_SAFE |

All scenarios query the database after completion and run invariant queries; they do not only assert HTTP status.

## 6. Idempotency and fault injection

| Scenario | Evidence | Result |
|---|---|---|
| IDEM-RACE-01 same key/payload | Existing BA-002 concurrent HTTP test: one mutation, identical replayed IDs | ALREADY_SAFE |
| IDEM-RACE-02 response lost after commit | Existing `DROP_RESPONSE_AFTER_COMMIT`: retry replays committed result | ALREADY_SAFE |
| IDEM-RACE-03 same key/different payload | Existing test returns 422 without new mutation | ALREADY_SAFE |
| IDEM-RACE-04 replay while booking is cancelled | New concurrent replay/cancel test: replay does not recreate reservation or restore HOLD | ALREADY_SAFE |
| FAIL-01 connection lost before commit | Existing `DROP_CONNECTION_BEFORE_COMMIT`: zero domain/idempotency rows, retry succeeds once | ALREADY_SAFE |
| FAIL-02 allocation before audit | Audit constraint rejects reassignment; old allocation/version remain intact | ALREADY_SAFE |
| FAIL-03 sequence/audit failure | Same injected audit rejection rolls back venue `change_seq` with allocations | ALREADY_SAFE |
| FAIL-04 deadlock/timeout | Real two-connection deadlock: one full rollback; HTTP error mapping returns redacted retryable 409 | ALREADY_SAFE |

No automatic blind transaction retry was introduced. Clients receive an explicit retryable conflict after MySQL has rolled back the deadlock victim.

## 7. Stress metrics

| Stress case | Requests | Success | Expected conflicts | Unexpected errors | Deadlocks | Duplicates/orphans/invariant failures |
|---|---:|---:|---:|---:|---:|---:|
| Direct bookings for one table | 20 | 1 | 19 | 0 | 0 | 0 |
| Same waitlist entry seated | 20 | 1 | 19 | 0 | 0 | 0 |
| Twenty different entries for one table | 20 | 1 | 19 | 0 | 0 | 0 |
| Confirmed booking vs Walk-ins | 20 Walk-ins | 0 | 20 | 0 | 0 | 0; booking retained |
| Transfer/cancel | 3 rounds | 3 serial winners | 3 | 0 | 0 | 0 |
| Merge/transfer | 3 rounds | 3 serial winners | 3 | 0 | 0 | 0 |
| Check-in/transfer | 3 rounds | 3 serial winners | 3 | 0 | 0 | 0 |
| Explicit deadlock injection | 2 transactions | 1 commit | 1 deadlock victim | 0 | 1 expected | 0 partial writes |

The targeted 16-test suite passed three consecutive runs.

## 8. MySQL invariant queries

Each race/stress test verifies:

- active allocation overlap grouped by venue, business date and table = `0`;
- HOLD allocation without matching hold = `0`;
- USAGE allocation without matching visit = `0`;
- active group without active allocation = `0`;
- `CHECKED_IN` reservation without Visit = `0`;
- scenario-specific reservation, visit, waitlist, audit and venue sequence counts.

Q10 is retained: merges validate same zone/kind but do not require adjacency. Q13 is retained: an already confirmed booking allocation defeats all competing Walk-ins.

## 9. Regression results

| Gate | Result |
|---|---|
| Typecheck | PASS |
| Lint | PASS; baseline frontend warnings only |
| Production HTTP build | PASS |
| API unit | PASS — 207/207 (baseline 205 + 2 error-contract tests) |
| Web unit | PASS — 342/342 |
| Full MySQL | PASS — 438/438; 13 configuration-gated skips |
| Manual no-show opt-in | PASS — 13/13 on newly created disposable `gam21_platform_test` |
| BA-005 targeted | PASS — 16/16, repeated 3 times |
| Phase 2B HTTP E2E | PASS — 17/17 |
| NA-11 | PASS — 11/11 across mobile/tablet/desktop |
| Sprint 2 HTTP E2E | PASS, including BA-004 phone-only and BA-023 desktop/mobile calling |

The normal integration suite used `gam21_platform_it_test`. Manual no-show requires the exact guarded name `gam21_platform_test`; that database did not exist, so it was created as a new disposable test database and migrations 0001–0014 were applied. No development or production database was used.

## 10. Security and data review

- Organization and venue predicates remain server-side on every audited entity/assignment path.
- RBAC and CSRF middleware were unchanged and passed HTTP regression.
- No phone code, encryption/HMAC code or masking contract changed.
- `booking.phone.call` remains independent from both reveal permissions.
- No plaintext phone was added to tests, logs or audit payloads.
- No constraint was disabled. Temporary test-only CHECK constraints were always removed in `finally`.
- No migration was added and no UI file changed.

## 11. Files changed

- `api/test/ba005-concurrency-integrity.mysql.test.ts`
- `api/test/concurrency-error-handler.test.ts`
- `fix-reports/BA-005_CONCURRENCY_INTEGRITY.md`

## 12. Residual risks

- InnoDB deadlocks remain possible under rare cross-entity swaps. They are fail-safe and visible as retryable 409, but may affect latency under high contention.
- Stress was local and bounded to 20 concurrent requests; it is not a production load/capacity benchmark.
- Tests prove the covered interleavings, constraints and rollback behavior, not the absence of every possible future concurrency bug.
- If contention grows materially, lock-wait/deadlock metrics should be monitored before considering a broader canonical lock-order refactor.

## 13. Rollback

BA-005 changes only tests and this report. Reverting the report commit and `9ee8899` removes the added coverage; there is no production migration or runtime behavior to roll back.

## 14. Verdict

`ALREADY_SAFE`

All requested P0 scenarios, idempotency/failure cases and bounded stress checks preserve the approved invariants. No confirmed production defect justified a runtime change.

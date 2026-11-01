# MERGE_BE Boss review - 2026-10-31

Verdict: **CHANGES_REQUESTED**

Reviewer task `task_0101a9c4440d`, dispatch `ctx_5d386c2c9adf`. Worker task `task_8f432ee4ea6d`, dispatch `ctx_83282fae9499`. Base and HEAD both resolve to `0acec2f52f5a911f2b5fb817927c9e0727a2d0ae`; this review covers the uncommitted backend package, including untracked scripts/tests/documents.

Read the review task, merge task, workflow sections 2/4, template, worker report and integration contracts. Applied the coordinator decision that both waitlist kinds create grouped reservation holds, with visits created only at later normal check-in. Review only: this report is the sole file written by the reviewer; no source/config/test edits, commits, migrations, seeds, development DB connections or servers on 3000/5173.

## Findings

### BE-01 - MAJOR - New mutation notes bypass phone rejection and persist plaintext

**Location:** `api/src/modules/waitlist/waitlist.route.ts:90`; persistence at `api/src/modules/waitlist/waitlist.repository.ts:323`, `:364`, `:399`.

**What:** `mutationInput` checks only note type/length. Both new routes accept a note containing a full phone number. Contact recording stores it in `waitlist_contact_attempts.note`; cancellation stores it in `waitlist_entries.close_reason_note` and possibly the hold release note; both copy it to `operation_log.reason_note` through `auditEntry`.

**Why:** This bypasses the existing `containsPhoneNumber` / `PHONE_IN_NOTE_FORBIDDEN` protection at creation. The waitlist specification `D:\GAM-APP\database\06-waitlist-engine.md:86` prohibits phones in free-form notes; security doc 08 section 6 explicitly includes `note` and `close_reason_note`. Phone encryption and redacted audit requirements therefore no longer cover these new inputs. Parameterized SQL does not protect plaintext from database dumps, backups or audit consumers. This finding concerns the new routes, not a request to rewrite all existing note handling.

**Evidence:** Read-only route-handler probes ran from `api/` with `DB_NAME=gam21_platform_it_test`, using `node --import tsx --input-type=module`. The final handler of each actual route was invoked with valid actor/id/version/channel/reason and a synthetic phone-like note. `databasePool.getConnection` was replaced in that process with a throwing sentinel, preventing every DB access. Both handlers reached the repository instead of returning 422:

```text
cancel: phone-like note passed HTTP validation (repository stub prevented all DB access)
contact-attempts: phone-like note passed HTTP validation (repository stub prevented all DB access)
```

The persistence statements above pass `input.note` unchanged to the respective columns and audit. Existing new-route validation tests check oversized and non-string notes, but omit phone-like notes.

**Concrete fix:** In the existing `mutationInput`, trim the note and apply the same `containsPhoneNumber` check and 422 code/message already used by creation before calling either repository mutation. Keep the 300-character limit, permissions, CSRF, versions and transaction behavior. Extend `api/test/waitlist-security.mysql.test.ts`; update the API document to describe rejection on these mutations too.

**Verification:** Through authenticated HTTP, submit synthetic contiguous and spaced/dotted/dashed phone-like notes to both routes; require 422 `PHONE_IN_NOTE_FORBIDDEN`. Assert no attempt, closure, hold release, audit insertion or version increment occurs. Keep valid-note cases passing and rerun the backend gates below.

### BE-02 - MAJOR - Booking cancellation/no-show closes waitlist entries without recording that change in audit

**Location:** `api/src/modules/bookings/booking.repository.ts:878` (new waitlist update), `:909` (only audit insertion).

**What:** `closeBooking` bulk-updates linked open waitlist entries to CANCELLED, clears their claims and advances their versions. It records only the existing reservation event, whose `changes` contains released allocations; it records neither a waitlist event nor affected waitlist IDs, previous states or versions.

**Why:** The review requires ported transitions to be audited. There is no durable description of which waitlist entry changed, its before/after version/status, or why its claim disappeared. A booking audit containing only allocation IDs does not account for these additional entity mutations. The new normal check-in path already records each linked waitlist transition explicitly at `:1029-1053`, and the explicit cancellation endpoint does likewise.

**Evidence:** A no-DB SQL-capture probe invoked the actual `closeBooking` for both CANCELLED and NO_SHOW with a stub connection, captured its transaction statements, and stopped the post-transaction booking read with a sentinel. Each invocation updated the waitlist and inserted exactly one operation log row of entity type `reservation`:

```text
CANCELLED: linked waitlist update captured; only reservation audit inserted (zero DB access)
NO_SHOW: linked waitlist update captured; only reservation audit inserted (zero DB access)
```

Recheck directly with `rg -n 'UPDATE waitlist_entries|INSERT INTO operation_log' src/modules/bookings/booking.repository.ts` and inspect `closeBooking`. The existing `wave2` cancel/no-show test checks only final row values; its audit-failure case collides with the reservation audit, so neither detects this omission.

**Concrete fix:** Inside the existing transaction, capture and lock the linked open entries with their IDs/statuses/versions before updating them. Record their cancellation with actor/session, `RESERVATION_CANCELLED`, linked reservation ID and before/after versions/statuses using the same sequence/audit conventions as the new check-in path. Retain the reservation audit and current hold/group release semantics. Do not invoke the public cancellation repository function, which opens a separate transaction. An equivalent complete structured entry-transition record in the reservation audit is acceptable if the coordinator chooses that existing convention; silently omitting the transitions is not.

**Verification:** Extend `api/test/wave2.mysql.test.ts` for both booking cancel and no-show to assert the affected entry's identity, transition, versions, reason and authenticated actor in audit, including CONTACTING claim cleanup. Force failure of the added audit persistence and require the booking, waitlist, holds, allocations and sequence updates to roll back together. Terminal/unrelated entries must not acquire cancellation events.

### BE-03 - MINOR - Advance creation is falsely audited as WALK_IN

**Location:** `api/src/modules/waitlist/waitlist.repository.ts:233`, `:236`.

**What:** `createWaitlistEntry` now accepts ADVANCE_RESERVATION but its WAITLIST_ADDED event still hardcodes `changes[0].kind = 'WALK_IN'` and `reason_code = 'WALK_IN_WAITING'`. It also drops the linked reservation ID from this event.

**Why:** The new capability produces a false business audit trail: the stored entry and priority class are advance, while the immutable creation event claims a walk-in. This undermines later reconstruction of queue priority and booking linkage.

**Evidence:** An actual `createWaitlistEntry` invocation with an advance input and a no-DB SQL-capture connection returned an advance entry but captured this output:

```text
advance creation: audit.kind=WALK_IN, reason=WALK_IN_WAITING (SQL capture, zero DB access)
```

The existing creation test verifies response kind/order and does not verify creation audit contents.

**Concrete fix:** Derive audit kind and creation reason from `input.kind ?? 'WALK_IN'`; include the reservation ID for advance creation. Preserve the current walk-in event, redaction, actor/session data and atomicity. Use the existing unconstrained audit reason field; no migration is needed.

**Verification:** Add assertions for both kinds in `api/test/wave2.mysql.test.ts` / the existing waitlist tests: audit kind equals stored kind; advance linkage is correct; neither guest name nor plaintext phone is logged. Existing walk-in behavior must remain unchanged.

### BE-04 - MINOR - The newly imported fixture still makes the required gate intermittent

**Location:** `api/test/wave2.mysql.test.ts:19`; shared reset at `api/test/support/integration-fixture.ts:22` and `:32`; other callers are `waitlist-security.mysql.test.ts:35`, `allocation-concurrency.mysql.test.ts:15`, `e2e-fixes.mysql.test.ts:14`.

**What:** The first independent full gate failed in `beforeEach(resetFixture)` at the default 10-second hook limit. The OFFERED seating test body did not run. An unchanged full rerun passed. The worker report separately records two earlier 10-second setup-hook failures, so the known instability recurred during review.

**Why:** A required acceptance gate must not rely on reruns to become green. This is a test setup reliability problem, not evidence that OFFERED seating itself failed. The report's successful final run does not resolve the earlier documented fixture limit.

**Evidence:** Same command, no source changes or retries configured:

```text
First run: 1 failed | 19 passed files; 1 failed | 229 passed tests; 94.92s
Hook timed out in 10000ms.
test/wave2.mysql.test.ts:19:3 beforeEach(resetFixture)
Named test: assigns an advance OFFERED entry to grouped holds, then check-in creates its visit

Second run: 20 passed files; 230 passed tests; 46.33s
```

Read-only process diagnostics during review showed no long-running query/lock wait at the sampled instant; this is not enough to identify the timeout's root cause.

**Concrete fix:** Measure reset/cleanup time and exclude a competing suite using this shared destructive test DB. If this is normal bounded fixture latency, assign an explicit measured setup/cleanup hook budget at the four fixture callers, with useful timing on failure; if a lock or leaked request is responsible, fix that cause instead. Retain the exact DB-name guard, serial file execution and all assertions. Do not add automatic retries or a blanket long test timeout to conceal the failure.

**Verification:** Run the required full MySQL gate twice sequentially in isolation, without retries; both must pass. Demonstrate the fixture remains fail-closed for every other DB name. Report the measured setup duration and chosen bound, or the resolved lock/leak cause.

### BE-05 - NIT - Ported proposal links to an absent report

**Location:** `docs/design/event-blocking-proposal.md:37`.

**What / why:** The final reference points to `../integration/stabilization-backend-report.md`, which was not ported into this worktree. Readers cannot follow the proposal's cited evidence in the intended single codebase.

**Evidence:** `Test-Path docs/integration/stabilization-backend-report.md` returned `False`; `rg -n 'stabilization backend review' docs/design/event-blocking-proposal.md` identifies line 37.

**Concrete fix:** Replace the stale link with the relevant existing merge report/reference and a precise description of what it supports, or identify the historical source explicitly as external context. Do not import unrelated backend changes merely to satisfy the link.

**Verification:** Resolve every relative Markdown link in this proposal from its directory and confirm each target exists; ensure the deferred/not-implemented status is retained.

## Independent verification and preserved behavior

| Check | Result |
| --- | --- |
| `pnpm typecheck` in `api/` | PASS, exit 0 |
| `pnpm lint` in `api/` | PASS, exit 0 |
| `$env:DB_NAME='gam21_platform_it_test'; $env:RUN_MYSQL_INTEGRATION='1'; npx vitest run` | First run failed in fixture setup; unchanged rerun PASS, 20 files / 230 tests, 46.33s; see BE-04 |
| `node --check scripts/init-local-secrets.mjs` and `node --check scripts/verify-phone-e2e.mjs` | PASS |
| `git diff --check -- api docs/api.md docs/security docs/backlog docs/design docs/integration/merge-be-report.md` | PASS |
| `git diff --exit-code 0acec2f -- api/database/migrations api/src/database/migrate.ts api/src/modules/bookings/business-date.ts api/src/modules/bookings/booking-export.ts api/src/modules/bookings/booking-timing.ts api/src/modules/tables/table-group.repository.ts api/test/booking-lifecycle.mysql.test.ts` | PASS, no differences |
| SELECT-only migration history on both approved test DBs | Both contain main 0001-0005, plus the historical `0004_revoke_receptionist_phone_reveal.sql` row; reviewer applied nothing |
| SELECT-only role/permission/grant counts on integration DB | 4 roles / 29 permissions / 59 grants; supports the demo seed guard accepting 28 or 29 |
| Phone verifier wrong-target probe | PASS: an unapproved synthetic DB name is rejected before application imports; no DB connection |
| `git check-ignore api/.env`; tracked environment paths | `.env` is ignored; only `api/.env.example` is tracked in that API path selection |

The live MySQL suite includes main's lifecycle/group/date/classification/reception-window cases and the new authorization, scoping, concurrency, carry-over, HTTP phone masking and reveal cases. The source comparison preserves main's Zalo export/statistics, reception-window validation and PR1 phone checks. The advance flow reuses the reservation, creates grouped RESERVATION holds, clears CONTACTING claims and waits for normal check-in to create the visit. Advance priority is server-side. Owner-only table configuration retains reason/version checks, rejects live allocations on any date and audits atomically. No regression in these examined behaviors was found beyond the findings above.

The new secret initializer was reviewed and its 37 temporary-file tests ran in the full gate: independent random keys, non-empty values preserved, duplicate/ambiguous assignments and unsafe encoding rejected, atomic replacement and value-free diagnostics. It was not invoked on a repository environment file. The phone script checks the exact e2e DB before app imports and again checks the connected DB before fixture writes; its credentials/keys are ephemeral and its diagnostic output is fixed/redacted.

## Limits and remaining risk

The independent standalone phone verifier was inspected and its wrong-target guard was exercised, but its writing e2e path was not rerun by the reviewer; live HTTP/DB phone behavior was exercised by the approved MySQL suite. No browser/pixel checks or frontend review were performed. SQL-capture probes establish the executed code paths without real DB writes and supplement, rather than replace, the live suite.

No reviewer action connected to dev or ran migrations/seeds. Current test migration history verifies the applied filename set, not who applied each historical migration; no claim is made that history alone proves the worker never wrote to dev. The worker's reported dev migration analysis remains analysis, not authorization: preserve the old history row and review current schema/backups before any separate owner-approved dev migration.

No credential rotation, deployment-key decryptability test, Windows ACL audit, exhaustive secret-history scan or deferred admin/event implementation was performed. Existing documented key-retention and process-local rate-limit limitations remain. The initial Orca check and one heartbeat attempt hit runtime timeouts; subsequent checks succeeded with an empty inbox, and reporting continues through the same active dispatch.

## Fix instructions for the worker

1. **BE-01 MAJOR:** Reuse `containsPhoneNumber` in `mutationInput` for both new waitlist note inputs; reject with 422 before writes. Add HTTP rejection/no-side-effect tests and update the endpoint note policy.
2. **BE-02 MAJOR:** Capture and audit the linked waitlist cancellation transitions inside `closeBooking`'s existing transaction, with entry IDs/states/versions/reason/actor and atomic rollback tests for cancel and no-show. Preserve reservation audit, hold/group behavior and all scoping checks.
3. **BE-03 MINOR:** Make WAITLIST_ADDED audit kind/reason reflect advance versus walk-in and retain the advance reservation ID; assert audit contents for both kinds without logging guest/phone data.
4. **BE-04 MINOR:** Measure and resolve the repeated fixture-hook timeout; use an explicit measured hook budget only if normal bounded setup latency is the cause. Preserve the DB guard and serial execution, add no retries, and provide two consecutive clean full integration runs.
5. **BE-05 NIT:** Correct the proposal's missing-report reference without importing unrelated code or implementing deferred event blocking.

After the fixes, run `pnpm typecheck`, `pnpm lint`, and the required full MySQL gate from `api/` with the exact integration DB and opt-in environment variables. Update `docs/integration/merge-be-report.md` with the findings addressed, measured fixture result and fresh command outcomes. Keep migrations, `migrate.ts`, dev, secrets, frontend files and main's business behavior unchanged; no commit/push is authorized by this review.

# BA-022 — Account Management (US-11)

Date: 2026-11-07

Repository: `Tusie69/Bar_management`

Branch: `develop` (local)

Baseline for this round: `acbc5d6` (BA-020 and BA-021 integrated).
Implementation commit: `068fd4d`.

Runtime: Node **24.22.2**. Databases written: `gam21_platform_it_test` and
`gam21_platform_test` only.

## 1. Audit of what already existed

| Capability | State before BA-022 |
|---|---|
| Create account | **Missing** from the API. Only the interactive `bootstrap-admin` CLI could create one. |
| Lock / unlock | **Missing.** `users.status` (`ACTIVE`/`DISABLED`) and `memberships.status` existed but nothing could change them. |
| Change role | **Missing.** `membership_roles` supports grant and revoke with `granted_by`/`revoked_by`, unused by any endpoint. |
| Password reset | **Missing**, and not mentioned in US-11. |
| Session management | `auth_sessions` has `revoked_at` and `revoke_reason`; only logout used it. |
| Permission model | 4 roles, 29 permissions. `user.manage` exists, `is_sensitive = 1`, granted to `OWNER_ADMIN` only. |
| Login enforcement | Already correct: rejects a non-`ACTIVE` user, a non-`ACTIVE` membership, and a portal the account has no role for. |
| Session re-validation | Already correct: `authenticateSession` re-checks session, membership, user, venue and the portal-to-role binding **on every request**, so a lock or a role revoke ends live sessions at the next call. |

The API routes before this change were `login`, `me` and `logout` only.

## 2. Role matrix check

US-11's approved matrix, against the four roles migration `0001` seeds:

| Operation | SuperAdmin | Admin (Sửa) | Admin (Chỉ xem) | Lễ tân | Others | Implemented here |
|---|---|---|---|---|---|---|
| Log in at own portal | ✓ | ✓ | ✓ | ✓ | ✓ | already worked |
| Log in at another portal | ✗ | ✗ | ✗ | ✗ | ✗ | already worked |
| Create Admin account | ✓ | ✓ | ✗ | ✗ | ✗ | **yes**, via `user.manage` |
| Create staff account | [?] | ✓ | ✗ | ✗ | ✗ | **yes**, via `user.manage` |
| Change Admin Sửa ↔ Chỉ xem | ✓ | ✗ | ✗ | ✗ | ✗ | no — levels do not exist (NEED_PO) |
| Lock / unlock account | [?] | ✓ (TU-09) | ✗ | ✗ | ✗ | **yes**, via `user.manage` |
| View a staff account's screen | [?] | ✓ | [?] | ✗ | ✗ | no (NEED_PO) |
| See the full phone number | ✓ | ✓ | [?] | ✗ (3 last) | [?] | unchanged, out of scope |

`SuperAdmin`, `Admin (Sửa)` and `Admin (Chỉ xem)` have **no counterpart role** in the
schema; there is only `OWNER_ADMIN`. The matrix row that the implementation can
honour exactly is "Admin (Sửa)", because `user.manage` is held by `OWNER_ADMIN`
alone and there is no view-only admin to wrongly empower. **No role was created
and no permission grant was widened.**

Authoritative in-repo position, unchanged by this work:
`docs/backlog/admin-portal-rbac.md` — *"Status: deferred by owner; not
implemented. No admin RBAC migration is authorized by finalization."* It lists
`SUPER_ADMIN` and `ADMIN_VIEWER` as a design artifact only, and its open PO
questions match US-11's N6.

## 3. Implemented

| Endpoint | Auth | Permission | CSRF | Body | Result |
|---|---|---|---|---|---|
| `GET /api/v1/accounts` | required | `user.manage` | n/a | — | `{ accounts, roles }` |
| `POST /api/v1/accounts` | required | `user.manage` | required | `{ username, displayName, password, roleCode }` | `201 { account }` |
| `POST /api/v1/accounts/:id/status` | required | `user.manage` | required | `{ version, status }` | `{ account, revokedSessions }` |

- **Create** inserts the user, its membership and one role grant in a single
  transaction. The password is hashed with the existing scrypt helper. Limits
  come from `bootstrap-admin`: username ≤ 80, display name ≤ 120, password ≥ 12.
  `roleCode` must be one of the four seeded roles, so `SUPER_ADMIN` is a 400.
  The plaintext is never returned, stored or logged.
- **Lock / unlock** requires the current `users.version`, refuses a no-op, and on
  a lock revokes every live session of that account with
  `revoke_reason = 'ACCOUNT_LOCKED'`, reporting how many were ended.
- **Listing** is scoped by membership in the actor's organization and reports the
  roles effective at the actor's venue (`venue_id NULL` = all venues). It also
  returns the assignable role codes, so the UI cannot offer an unseeded role.

Isolation, security and audit:

- Every statement filters on `memberships.organization_id = actor.organizationId`,
  and role lookups additionally scope to the actor's venue. A single-tenant
  guard rejects any organization other than the configured one.
- Each change appends an `operation_log` row: `USER_ACCOUNT_CREATED`,
  `USER_ACCOUNT_LOCKED` or `USER_ACCOUNT_UNLOCKED`, `entity_type = 'user'`,
  `entity_id` the target user, actor, membership and auth session recorded, and
  `is_undoable = 0` because BA-020 cannot compensate an account change. No
  password, hash or customer PII is written to the audit row.
- `change_seq` is deliberately **not** advanced: an account change is not venue
  floor state, and bumping it would make every device refetch the floor.
- Session invalidation on a permission change needs no new machinery:
  `authenticateSession` already re-validates user status, membership status and
  the portal-to-role binding on every request. The explicit revoke on lock makes
  it immediate and auditable. Both paths are tested.

Two fail-closed guards keep the organization reachable, since the owner has not
ruled on lockout policy:

- `CANNOT_LOCK_SELF` — an admin cannot lock the account it is signed in as.
- `LAST_ADMIN_PROTECTED` — the last active admin cannot be locked. Over HTTP
  this is unreachable today: an acting admin is itself active, so either the
  target is itself (self-guard) or a second active admin exists. It is defence
  in depth for the day `user.manage` is granted to another role, and is tested
  at the repository level.

Errors: `INVALID_USERNAME`, `INVALID_DISPLAY_NAME`, `WEAK_PASSWORD`,
`ROLE_NOT_FOUND`, `USERNAME_TAKEN`, `ACCOUNT_NOT_FOUND`, `VERSION_CONFLICT`,
`ACCOUNT_STATUS_UNCHANGED`, `CANNOT_LOCK_SELF`, `LAST_ADMIN_PROTECTED`,
`INVALID_ACCOUNT_STATUS`, `INVALID_ACCOUNT_ID`, `ORGANIZATION_MISMATCH`.

## 4. NEED_PO

- **SuperAdmin as a distinct role, and Admin "Sửa" vs "Chỉ xem".** Deferred by
  the owner. Until then every admin is a full admin, and US-11-K4 (a view-only
  admin sees no create/edit control and is blocked by the API) cannot be
  satisfied, because no view-only admin exists to test.
- **Changing an existing account's role.** The matrix approves only
  "Đổi quyền Admin Sửa ↔ Chỉ xem" for SuperAdmin; those levels do not exist, and
  no rule covers moving a staff member between roles.
- **Password reset.** Absent from US-11 entirely. An initial password at creation
  is implemented because an account cannot exist without a credential; forced
  change at first login, expiry and self-service reset all need a decision.
- **Viewing another account's screen** (impersonation): approved for Admin in the
  matrix but with no technical contract, and high risk.
- **The staff roles US-11 lists** — Phục vụ, Bar, Kho — and Kế toán (N6) do not
  exist in the schema. Only Lễ tân, Thu ngân and CSKH map to seeded roles.
- **Portal paths per role** (N6) and **lockout policy** (who may lock whom, what
  protects the last admin, account recovery).
- **Ending a membership** (`memberships.status = 'ENDED'`) versus disabling the
  user: two different removals, no approved rule for either.

## 5. Files changed

| File | Change |
|---|---|
| `api/src/modules/accounts/account.repository.ts` | new: list, create, lock/unlock, guards, audit |
| `api/src/modules/accounts/account.route.ts` | new: three routes with auth, RBAC, CSRF |
| `api/src/app.ts` | mount `/api/v1/accounts` |
| `api/test/ba022-account-management.mysql.test.ts` | new: 10 integration scenarios |
| `web/src/services/contracts.ts` | `AccountSummary`, `AccountsView`, `CreateAccountInput`, three api methods, REST map |
| `web/src/services/http/http-api.ts` | real calls to the three routes |
| `web/src/services/mock/server.ts` | demo listing; mutations refused as server-only |
| `web/src/services/http/http-api.contract.test.ts` | account endpoint contract test |
| `web/src/features/settings/accounts-section.tsx` | new: accounts screen |
| `web/src/features/settings/settings-page.tsx` | render it in the existing "Phân quyền" tab |
| `web/src/hooks/use-data.ts` | `qk.accounts` query key |

Frontend integration deliberately reuses the existing settings tab, renders only
for `user.manage`, and is read-only in mock mode. No Sprint 2 Final floor,
booking or mobile screen was touched. BA-020 and BA-021 code was not modified.

## 6. Tests

| Gate | Result |
|---|---|
| Typecheck (api + web) | PASS |
| Lint (api + web) | PASS, pre-existing web warnings only |
| Production HTTP build | PASS |
| API unit, no MySQL opt-in | PASS — 207 tests |
| Web unit | PASS — 24 files, **347** tests |
| Full MySQL integration | PASS — 35 files, **472** tests, 13 opt-in skips |
| BA-022 focused MySQL | PASS — **10/10** |
| Auth + BA-005 + BA-020 + BA-021 + BA-022 focused | PASS — 67/67 |
| Auth HTTP E2E (`e2e/auth.mjs`) | PASS — includes account change and revoked session |
| Phase 2B HTTP E2E | PASS — `logout: PASS`, cleanup `0` |
| NA-11 HTTP E2E | PASS — `errors: []`, cleanup `0` |
| Sprint 2 HTTP E2E | PASS — 11 PASS lines, cleanup `0` |

MySQL 462 → 472, exactly the ten BA-022 scenarios. Web unit 346 → 347.

Scenario coverage, with the US-11 criteria each maps to:

| Scenario | Criterion |
|---|---|
| Listing is organization-scoped, reports roles, exposes no credential, offers only seeded roles | — |
| A created staff account logs in at its own portal and is refused at `/admin`; the stored hash is scrypt, not the plaintext | US-11-K7, K2 |
| Duplicate username, weak password and an unseeded role (`SUPER_ADMIN`) are refused, and no role or account is created | — |
| Locking revokes live sessions, the live session fails on its next request, and login is refused | US-11-K5, K8 |
| Unlocking restores login; the audit trail is append-only with `is_undoable = 0` and the right actor, venue and target | — |
| Version precondition, self-lock guard and no-op change all refused with nothing written | — |
| Locking one admin while another active admin remains is allowed | — |
| The last active admin is refused at the repository level | — |
| 401 unauthenticated, 403 for a receptionist on all three routes, 403 without CSRF, and nothing written | US-11-K3, K4 (API side) |
| Malformed status is a 400; an account change is never offered as undoable | — |

## 7. Remaining risks

- US-11-K4 is only half-verifiable: the API side (a role without `user.manage`
  is blocked) is tested, but "Admin Chỉ xem sees no create/edit button" cannot
  be tested until that access level exists.
- The accounts screen has no browser E2E of its own; `web` has no
  component-render harness, and the auth E2E covers the account-change and
  revoked-session behaviour rather than this screen. The endpoints are covered by
  the HTTP contract test and the integration suite.
- An admin creating an account becomes the latest operation in its own session,
  so BA-020 will not offer an undo of an earlier floor action from that session.
  That is correct and fails closed, but it is a behaviour worth knowing. It is
  the same consequence BA-021 already has.
- The initial password travels in the request body over the normal transport and
  is typed by the admin. There is no forced change at first login, because no
  policy is approved.
- `LAST_ADMIN_PROTECTED` is unreachable over HTTP today, so its production value
  depends on a future grant of `user.manage` to another role.

## 8. Git

| Commit | Content |
|---|---|
| `068fd4d` | backend, frontend and tests |
| this report | separate commit |

Local commits on `develop` only. Nothing pushed, no reset, rebase, force or
history rewrite, no branch or worktree removed, no real database migrated.
`.env` files and untracked files are intact and untracked; no `.env`,
`audit-reports/`, build output or secret is tracked.

## 9. Verdict

`IMPLEMENTED_WITH_LIMITATIONS`

The three operations US-11 approves for an Admin with edit rights — create an
Admin account, create a staff account, lock or unlock an account — are
implemented, isolated per organization and venue, hashed, RBAC- and
CSRF-protected, audited, and verified on Node 24 against a disposable MySQL,
together with the session invalidation the matrix implies. The rest of US-11
account management is blocked by the owner's own deferral of the admin RBAC
model: without SuperAdmin and the Admin access levels, role changes and the
view-only admin criterion cannot be built without inventing roles, which this
task forbids. Password reset and impersonation have no contract at all. Those
are recorded as NEED_PO rather than guessed.

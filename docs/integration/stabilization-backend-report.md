# Backend stabilization report

Date: 2026-10-30. Scope: STAB_BE, branches `integration/canonical-ui-api` in `Bar_management` and `21gam-platform`.

The safe adapter cache and additional RBAC regression assertions are implemented. Backend typecheck/lint and 167 tests pass; frontend typecheck/lint and 139 tests pass. Migration work was report-only: no migration, seed, DDL, DML or tests ran against `gam21_platform_dev`; every direct database inspection used SELECT. No migration was applied anywhere. No `.env`, UI, contract, generated file or pre-existing migration/seed was changed, and no commit was created. Existing servers on ports 3000/5173 were left alone. Tests wrote only to the explicitly guarded integration database.

## A. Migration safety review

### Runners, histories and collision risk

| Source | Directory read | Ordering/history | Finding |
| --- | --- | --- | --- |
| `api/src/database/migrate.ts`, `api/package.json` `db:migrate` | `path.resolve(process.cwd(), 'database', 'migrations')`; with API package cwd, `Bar_management/api/database/migrations` | Lexicographic full filename order; `schema_migrations.filename VARCHAR(255)` PK, `checksum CHAR(64)` SHA-256 of UTF-8 SQL, `applied_at TIMESTAMP(3)` | Reads integration revoke 0004. Never scans `Bar_management/db/migrations`. Same numeric prefixes with different filenames are separate migrations and would both run if placed in this directory; numeric gaps/out-of-order additions are not rejected. |
| Legacy dbmate workflow in `docs/mysql-setup.md` and database docs 10/14 | Default `db/migrations`, relative to its execution directory; flags/config can override | Numeric filename version, history `schema_migrations.version VARCHAR(128)`; no SQL checksum; `--strict` required for order validation | The admin 0004 uses dbmate markers. Do not aim dbmate at these existing API databases: their history tables have incompatible columns. Two numeric 0004 files in one dbmate stream cannot represent distinct reliable versions. |
| `D:\GAM-APP\database\migrations\0001_initial_schema.sql` | Separate database design/bootstrap artifact, not the API runner's 0001 | Header explicitly says admin RBAC was merged on 29/10 | Includes the two roles, two permissions, `role_portals`, `role_grant_rules` and their grants. Applying admin 0004 after that initial schema would duplicate objects/data. |

The reviewed `Bar_management/api/database/migrations/0001_initial_schema.sql` has only four roles and the original 28 permissions. API 0002 adds `booking.phone.reveal`, reaching 29 permissions and temporarily granting it to both owner and receptionist; API 0004 removes only the receptionist grant. The separate master initial schema has 30 permissions (28 plus admin additions), and is not interchangeable with API 0001. Its portal DDL is not present in any of the three databases inspected. Do not replace an applied API 0001 with the master file: the runner detects the changed checksum, and existing objects would conflict.

The API runner executes a whole SQL file with `multipleStatements: true` and then separately inserts its history row. It provides neither a migration transaction nor an advisory lock. DDL implicit commits and mixed DML/DDL in admin 0004 permit partial application; a history-insert failure can also leave changes without a history row. Do not run concurrent migrators or retry the admin script blindly after failure. The original admin file remains untouched and has an empty/comment-only down section; dbmate rollback would not undo its schema/data changes.

### Observed database state

Direct read-only snapshots were taken before acceptance tests, using the existing application connection settings without displaying them. All recorded migration checksums match the current API files byte-for-byte.

| Filename | SHA-256 |
| --- | --- |
| `0001_initial_schema.sql` | `eec35a6b8085f8fb7169b4b8e9ee705175830216b57bfeb7da80f0ae6608217e` |
| `0002_booking_phone_calling.sql` | `f097857601db7a5738edcdc500efc0fdf19774793e7f40cc127b7c0360aa53e1` |
| `0003_table_adjacency.sql` | `63955f803a45c5ad8e2f3ab92f3cf38cbb647f6f56606958924c5388e2564051` |
| `0004_revoke_receptionist_phone_reveal.sql` | `06c7f120a0a0ef9a90b14a6145cdefcdc5533fe088f73e1d2c4e1793abbf9572` |
| Separate `db/migrations/0004_admin_portal_rbac.sql` (unapplied) | `d56495557e7f3ce7e67d92a4b8b217981394e09c9bbeb47fb2fb8a685689d1ef` |

`schema_migrations.applied_at` values below are UTC, rendered by the inspection client:

| Database | 0001 | 0002 | 0003 | Revoke 0004 |
| --- | --- | --- | --- | --- |
| `gam21_platform_dev` | 2026-10-29 09:48:21.886 | 2026-10-29 09:48:22.021 | 2026-10-29 09:48:22.062 | absent |
| `gam21_platform_it_test` | 2026-10-29 18:20:31.419 | 2026-10-29 18:20:31.554 | 2026-10-29 18:20:31.598 | 2026-10-29 19:46:54.012 |
| `gam21_platform_e2e_test` | 2026-10-29 18:29:52.642 | 2026-10-29 18:29:52.789 | 2026-10-29 18:29:52.854 | 2026-10-29 19:46:54.887 |

| Database | Roles | Permissions | Role-permission rows | `booking.phone.reveal` holders | `venue.configure` holders |
| --- | --- | --- | --- | --- | --- |
| dev | 4 | 29 | 60 | OWNER_ADMIN, RECEPTIONIST | OWNER_ADMIN |
| it_test | 4 | 29 | 59 | OWNER_ADMIN | OWNER_ADMIN |
| e2e_test | 4 | 29 | 59 | OWNER_ADMIN | OWNER_ADMIN |

All three have roles OWNER_ADMIN, RECEPTIONIST, CUSTOMER_CARE and CASHIER with system flag 1; none has SUPER_ADMIN or ADMIN_VIEWER. Relevant permissions are `user.manage` (sensitive, owner-only), `venue.configure` (not sensitive, owner-only), `booking.phone.reveal` (sensitive), and `customer.phone.reveal` (sensitive, owner-only). `user.read` and `admin.access.change` are absent. A complete SELECT of all permission/grant rows found the only dev/test grant difference is receptionist `booking.phone.reveal`; each has the same 29 permission codes.

| Database | OWNER_ADMIN users / active | RECEPTIONIST users / active | CUSTOMER_CARE users / active | CASHIER users / active |
| --- | --- | --- | --- | --- |
| dev | 1 / 1 | 3 / 2 | 1 / 1 | 1 / 1 |
| it_test | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| e2e_test | 1 / 1 | 3 / 2 | 1 / 0 | 1 / 0 |

Counts are distinct users per membership role; active means both user and membership ACTIVE, not live browser sessions. These are pre-test snapshots and E2E counts can change if another authorized test run uses that database.

| Database | Customer rows / non-null phone ciphertext | Reservation rows / non-null phone ciphertext |
| --- | --- | --- |
| dev | 21 / 0 | 33 / 0 |
| it_test | 0 / 0 | 0 / 0 |
| e2e_test | 21 / 0 | 49 / 4 |

No ciphertext bytes, hashes, phone digits, session tokens, passwords or key values were selected or reported.

### Role/permission delta and data impact

Revoke 0004 deletes at most one `(RECEPTIONIST, booking.phone.reveal)` row, leaves the permission and owner grant intact, and changes no user, customer, reservation, allocation or ciphertext data. Dev moves from 60 to 59 grants. The current reveal route already requires both `booking.phone.reveal` and owner-only `customer.phone.reveal`, so receptionist requests are denied even while the redundant dev grant exists. The migration is still needed to align stored permissions and `/auth/me` with the approved rule. Current authentication reads permissions per request; already issued sessions do not freeze the old grants.

Admin 0004 depends on the base roles, permissions, `role_permissions`, and existing `user.manage`, `report.read`, `customer.view_masked`. It has no dependency on booking-phone 0002 or revoke 0004, and neither of its new roles receives phone-reveal or venue-configure permission. It adds two roles, two permissions, seven portal mappings, seven grant rules and seven role-permission rows: SUPER_ADMIN gets `user.read`, `user.manage`, `admin.access.change`; OWNER_ADMIN gets `user.read`; ADMIN_VIEWER gets `user.read`, `report.read`, `customer.view_masked`. After revoke plus admin, this API lineage would contain 6 roles, 31 permissions and 66 grants. Existing memberships/users remain unchanged, so the new roles have no users until explicitly provisioned.

`api/database/seeds/demo.sql` accepts permission counts 28, 29 or 31 plus the four base roles and empty business tables. Revocation leaves 29, and admin additions on API 0002 reach 31, both accepted by that count guard. The separate master 0001 alone has 30 and is rejected by this API seed. These counts do not validate exact grants or history and do not authorize reseeding existing databases; dev is populated and its seed guard would reject it. No seed was run.

### Backup command for the coordinator only

Not executed. Before approved migration work, the coordinator with root authority can run this PowerShell from `Bar_management`. The dump is created inside the Docker container so Windows shell encoding cannot corrupt it; the root password stays inside the container environment. Store the resulting sensitive dump with restricted ACLs, outside Git, and keep phone keys separately. Do not include concurrent schema changes in the snapshot window.

```powershell
New-Item -ItemType Directory -Force -Path .backups | Out-Null
docker exec 21gam-mysql sh -c 'umask 077; MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump --user=root --single-transaction --quick --routines --events --triggers --no-tablespaces --set-gtid-purged=OFF --databases gam21_platform_dev > /tmp/gam21_platform_dev-before-stabilization-20261030.sql'
if ($LASTEXITCODE -ne 0) { throw 'Database backup failed; stop.' }
docker cp 21gam-mysql:/tmp/gam21_platform_dev-before-stabilization-20261030.sql .backups/gam21_platform_dev-before-stabilization-20261030.sql
if ($LASTEXITCODE -ne 0) { throw 'Database backup copy failed; stop.' }
Get-FileHash .backups/gam21_platform_dev-before-stabilization-20261030.sql -Algorithm SHA256
```

Verify an isolated restore and the backup's recorded migrations/grants before proceeding. Remove the temporary container dump under the coordinator's normal retention policy once the secure copy is verified. No backup or restore was performed by this worker.

### Ordered execution plan (proposal, not approval)

1. Re-run the SELECT preflight below and compare file hashes/history. Freeze concurrent migration jobs. Confirm the target name explicitly and capture a restorable backup plus secret versions.
2. Keep the API filename/checksum runner for these existing API-lineage databases. From `Bar_management/api`, an operator may explicitly set `DB_NAME=gam21_platform_dev` and run `pnpm db:migrate` only after separate approval. With the currently reviewed directory, it skips checked 0001-0003 and applies revoke 0004 only. This worker did not run that command.
3. Re-run grants/history queries: dev should match the two test databases at four roles, 29 permissions and 59 grants; verify receptionist 403 and owner behavior privately without recording phone payloads. Do not seed.
4. Keep admin RBAC separate from the immediate security revoke. If approved later, preserve the untracked original and create a new reviewed API-lineage migration with a unique next filename such as `0005_admin_portal_rbac.sql`, after rechecking that 0005 remains unused. Do not copy/rename the user file or change an applied initial migration during this task. Explicitly review partial-application recovery and API support: current auth does not enforce `role_portals` or `role_grant_rules` by merely creating these tables, and canonical role mapping does not support the two new roles.
5. Validate that future admin migration first on a separately authorized isolated database restored from the actual API lineage, then on each intended target after its own backup/approval. Never replay master initial schema plus admin 0004, or point dbmate at an API history table. Check all new roles/permissions/mappings and unchanged phone grants.
6. If any statement fails, stop and inspect the partial state. Do not rerun non-idempotent DDL or insert a fake history row. Choose reviewed fix-forward SQL or restore the pre-change backup with the matching keys.

### Rollback SQL (proposal only)

Forward-only project policy in database doc 10 favors a new compensating migration or backup restore. Do not edit an applied migration or delete its history row. Re-granting phone reveal reverses an approved security restriction and needs explicit operator approval; it still does not grant `customer.phone.reveal`.

```sql
-- Compensating data migration for revoke 0004, only if explicitly approved:
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code = 'RECEPTIONIST' AND p.code = 'booking.phone.reveal'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
```

Admin 0004 has no automatic down SQL. The following compensation is appropriate only immediately after an otherwise successful first application, with zero new-role assignments and no subsequent mapping/grant edits. Capture the new mapping tables first if anything has changed; otherwise restore or design a targeted fix-forward. MySQL DDL below commits implicitly and cannot be made atomic by `ROLLBACK`.

```sql
-- Precondition: must return zero; otherwise STOP, do not delete memberships.
SELECT COUNT(*) AS new_role_assignments
FROM membership_roles mr JOIN roles r ON r.id = mr.role_id
WHERE r.code IN ('SUPER_ADMIN', 'ADMIN_VIEWER');

-- Run only after the operator confirms the precondition and unchanged mappings.
DROP TABLE role_grant_rules;
DROP TABLE role_portals;
DELETE rp FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
JOIN permissions p ON p.id = rp.permission_id
WHERE r.code IN ('SUPER_ADMIN', 'ADMIN_VIEWER')
   OR p.code IN ('user.read', 'admin.access.change');
DELETE FROM permissions WHERE code IN ('user.read', 'admin.access.change');
DELETE FROM roles WHERE code IN ('SUPER_ADMIN', 'ADMIN_VIEWER');
```

This is not safe for a database initialized from the master 0001, where those objects are baseline rather than an additive 0004. Never run it merely because a numeric version matches.

### Read-only preflight and verification SQL

Connect explicitly to each of the three named databases; repeat these SELECTs, comparing results with the snapshot above. The runner history uses full filenames rather than numeric versions.

```sql
SELECT DATABASE() AS target_database;
SELECT filename, checksum, applied_at FROM schema_migrations ORDER BY filename;
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('schema_migrations', 'role_portals', 'role_grant_rules')
ORDER BY TABLE_NAME, ORDINAL_POSITION;
SELECT id, code, is_system FROM roles ORDER BY code;
SELECT id, code, is_sensitive FROM permissions ORDER BY code;
SELECT r.code AS role_code, p.code AS permission_code
FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
JOIN permissions p ON p.id = rp.permission_id
ORDER BY r.code, p.code;
SELECT r.code, COUNT(DISTINCT m.user_id) AS users,
       COUNT(DISTINCT CASE WHEN u.status = 'ACTIVE' AND m.status = 'ACTIVE'
                          THEN m.user_id END) AS active_users
FROM roles r LEFT JOIN membership_roles mr ON mr.role_id = r.id
LEFT JOIN memberships m ON m.id = mr.membership_id
LEFT JOIN users u ON u.id = m.user_id GROUP BY r.code ORDER BY r.code;
SELECT 'customers' AS entity, COUNT(*) AS rows_total,
       COUNT(phone_ciphertext) AS encrypted_rows FROM customers
UNION ALL SELECT 'reservations', COUNT(*), COUNT(phone_ciphertext) FROM reservations;
```

Only after a future approved admin application, also verify:

```sql
SELECT r.code, rp.portal_code FROM role_portals rp
JOIN roles r ON r.id = rp.role_id ORDER BY r.code, rp.portal_code;
SELECT g.code AS grantor, e.code AS grantee FROM role_grant_rules rr
JOIN roles g ON g.id = rr.grantor_role_id
JOIN roles e ON e.id = rr.grantee_role_id ORDER BY g.code, e.code;
```

### Exact SQL of both existing 0004 files

The following appendix copies the source files verbatim inside SQL fences. These are review artifacts, not executed commands.

#### db/migrations/0004_admin_portal_rbac.sql

```sql
-- migrate:up transaction:false
-- GAM-APP / 21GAM - admin portal RBAC (diagram "Luồng A: đăng nhập theo cổng vai trò",
-- "Luồng B: tạo tài khoản, đổi quyền, khóa/mở", 29/10/2026).
--
-- Adds: SUPER_ADMIN and ADMIN_VIEWER roles (OWNER_ADMIN stays the editing Admin),
-- role -> login portal mapping (TU-07), who may create/lock which role, user.read and
-- admin.access.change permissions.
-- Already covered by 0001, no schema change: lock/unlock = users.status ACTIVE/DISABLED
-- (open sessions die because session lookup requires u.status = 'ACTIVE'), logout =
-- auth_sessions.revoked_at, permission changes apply on the next request (read live).
-- Pending PO, kept as data so they change without code: SuperAdmin portal, SuperAdmin
-- lock rights, whether Admin may create an Admin "Chỉ xem", OWNER_ADMIN on RECEPTION portal.

SET NAMES utf8mb4;

INSERT INTO roles (code, name, is_system) VALUES
  ('SUPER_ADMIN',  'Super Admin',     1),
  ('ADMIN_VIEWER', 'Admin (chỉ xem)', 1);

-- A role may open several portals; login is refused when none of the user's roles has the portal.
CREATE TABLE role_portals (
  role_id      BIGINT UNSIGNED NOT NULL,
  portal_code  VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (role_id, portal_code),
  CONSTRAINT fk_role_portals_role FOREIGN KEY (role_id) REFERENCES roles (id),
  CONSTRAINT ck_role_portals_portal CHECK (portal_code IN ('ADMIN','RECEPTION','CUSTOMER_CARE','CASHIER'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- grantor role may create accounts with, and lock/unlock accounts holding, the grantee role.
CREATE TABLE role_grant_rules (
  grantor_role_id  BIGINT UNSIGNED NOT NULL,
  grantee_role_id  BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (grantor_role_id, grantee_role_id),
  KEY ix_role_grant_rules_grantee (grantee_role_id),
  CONSTRAINT fk_role_grant_rules_grantor FOREIGN KEY (grantor_role_id) REFERENCES roles (id),
  CONSTRAINT fk_role_grant_rules_grantee FOREIGN KEY (grantee_role_id) REFERENCES roles (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO role_portals (role_id, portal_code)
SELECT r.id, x.portal_code
FROM roles r
JOIN (
  SELECT 'SUPER_ADMIN' AS role_code, 'ADMIN' AS portal_code
  UNION ALL SELECT 'OWNER_ADMIN',   'ADMIN'
  UNION ALL SELECT 'OWNER_ADMIN',   'RECEPTION'
  UNION ALL SELECT 'ADMIN_VIEWER',  'ADMIN'
  UNION ALL SELECT 'RECEPTIONIST',  'RECEPTION'
  UNION ALL SELECT 'CUSTOMER_CARE', 'CUSTOMER_CARE'
  UNION ALL SELECT 'CASHIER',       'CASHIER'
) x ON x.role_code = r.code;

-- SuperAdmin -> Admin (both levels); Admin -> Admin, staff. ADMIN_VIEWER grants nothing.
INSERT INTO role_grant_rules (grantor_role_id, grantee_role_id)
SELECT g.id, e.id
FROM roles g
JOIN roles e ON e.code IN ('OWNER_ADMIN','ADMIN_VIEWER')
WHERE g.code = 'SUPER_ADMIN'
UNION ALL
SELECT g.id, e.id
FROM roles g
JOIN roles e ON e.code IN ('OWNER_ADMIN','ADMIN_VIEWER','RECEPTIONIST','CUSTOMER_CARE','CASHIER')
WHERE g.code = 'OWNER_ADMIN';

INSERT INTO permissions (code, description, is_sensitive) VALUES
  ('user.read',           'Xem tài khoản nhân viên và quyền', 0),
  ('admin.access.change', 'Đổi quyền Admin giữa Sửa và Chỉ xem', 1);

-- Only SUPER_ADMIN switches an Admin between OWNER_ADMIN (Sửa) and ADMIN_VIEWER (Chỉ xem).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN ('user.read','user.manage','admin.access.change')
WHERE r.code = 'SUPER_ADMIN';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'user.read'
WHERE r.code = 'OWNER_ADMIN';

-- ADMIN_VIEWER: read only, no sensitive permission; the API blocks every write.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN ('user.read','report.read','customer.view_masked')
WHERE r.code = 'ADMIN_VIEWER';

-- migrate:down
-- irreversible: migrations are forward-only (doc 10 §2). Fix forward or restore a backup.

```

#### api/database/migrations/0004_revoke_receptionist_phone_reveal.sql

```sql
-- BD-07: only OWNER_ADMIN may reveal a booking phone number.
DELETE rp FROM role_permissions AS rp
JOIN roles AS r ON r.id = rp.role_id
JOIN permissions AS p ON p.id = rp.permission_id
WHERE r.code = 'RECEPTIONIST' AND p.code = 'booking.phone.reveal';

```


## B. Out-of-service/reopen RBAC, audit and event blocks

`table.route.ts` protects `PATCH /tables/:id/configuration` with authentication, CSRF and `requirePermission('venue.configure')`, before parsing either ACTIVE or OUT_OF_SERVICE. It validates a positive optimistic version, at least one configuration field, an allowed status and a trimmed 1-500 character reason. Both transitions and spare-flag changes follow the same repository transaction. The legacy status endpoint cannot bypass it: it rejects spare changes and ultimately returns `TABLE_STATE_DERIVED` without writing derived status.

`configureTable` locks the tenant/venue-scoped table, checks version, then checks any allocation with `released_at IS NULL`, across dates, using `FOR UPDATE`. Holds, visits and carry-over allocations all block configuration. It rejects no-ops, updates status/spare with a version guard, advances venue change sequence, and inserts `TABLE_CONFIGURATION_UPDATED` into `operation_log` in the same transaction. Audit stores actor kind USER, user/membership/session, old/new versions, old/new service status and spare flag, reason code MANUAL and the reason note. Audit failure rolls the configuration back. Owner-only holders were confirmed by SELECT on dev, it_test and e2e_test; SUPER_ADMIN and ADMIN_VIEWER are absent.

Existing HTTP/MySQL tests already cover permission denial, invalid reason/status/version, successful disable and reopen, both audit reasons/actor, and rejection of assignment/walk-in/waitlist seating on disabled tables. This stabilization extends `api/test/wave2.mysql.test.ts` with whitespace-only reasons and unauthorized reopen assertions, and a hold/visit x ACTIVE/OUT_OF_SERVICE matrix asserting the exact `TABLE_HAS_OPEN_ALLOCATION` code and no configuration audit row on rejection. Requesting ACTIVE on an already-active allocated table specifically proves the allocation guard runs before no-op handling. Existing foreign-venue tests cover configuration scoping. All execute against `gam21_platform_it_test` through Supertest with real Express auth/CSRF and MySQL, without starting a port-3000 server.

### Separate event block state: options only

Current `dining_tables.status` is persistent service configuration (`ACTIVE` or `OUT_OF_SERVICE`). `table_holds.hold_kind` allows only RESERVATION and WAITLIST_OFFER; CHECK constraints require a real reservation or a confirmed waitlist offer. The reason fields belong to deadline negotiation or release, not an independent event block. There is no event hold kind or general scheduled block entity. Do not create a fake guest booking or overload OUT_OF_SERVICE to represent an event.

| Option | Required design work | Tradeoff |
| --- | --- | --- |
| Extend `table_holds` with EVENT_BLOCK | New kind/shape constraints, block identity/reason, explicit release, appropriate actor permission and audit actions; reuse HOLD allocations and exclusive table locks | Reuses current conflict, carry-over and release mechanics. Booking-specific joins/conversion/deadline behavior need careful separation. |
| Separate `table_blocks` plus allocation integration | Scoped block header, table members, interval/reason/version/actor/release fields; integrate immediate blocking into allocation uniqueness, assignment, walk-in, waitlist, floor and availability | Clear independent lifecycle and permissions, with more API/query/schema work. A separate table alone does not prevent double allocation. |
| Future event reservation domain | Event entity linked to explicit table blocks, intervals and operator workflow | Fits multiple events and scheduling, but requires approved conflict and release rules first. |

Prefer a separate block domain if scheduling/reporting is needed; extending holds is a smaller option for immediate manual blocks only. Decide whether blocks are immediate or scheduled, single/multiple-table, their permission, cross-day behavior and explicit release policy before implementation. Planned end times must not silently release live allocations: existing database docs 05/06 treat deadlines as warnings requiring explicit release. No option was implemented and no schema proposal was applied.

## C. Phone encryption configuration

The operator guide is [phone-encryption-setup.md](../security/phone-encryption-setup.md). It records every phone/session setting and actual validation, independent AES/HMAC/CSRF generation directly into the ignored `api/.env` without printing values, fixed-output validation, SELECT-only ciphertext/key-id aggregates, isolated synthetic tests, backup/persistence, rotation and redacted leak checks. Generation commands are documentation only and were not run against any workspace environment file. No real deployment key was printed, hardcoded or committed.

AES-256-GCM uses a random 12-byte nonce and 16-byte tag; stored key ids select old decryption keys after active-id changes. Old ciphertext is not rewritten. Removing old keys makes it unreadable, replacing bytes under the same id breaks authentication, and there is no automated re-encryption/HMAC backfill. `SESSION_CSRF_SECRET` is independent and changing it invalidates issued CSRF tokens. The absent-secret development fallback is random per process, so it should not be used for stable multi-instance sessions. Phone operations fail closed when configuration is absent; reveal additionally requires a configured rate policy.

Round-trip coverage already exists in `api/test/phone-security.test.ts` and HTTP/MySQL phone tests, including nonce randomness, normalized decrypt, deterministic separate HMAC, missing key/tag failure, authorization, no plaintext list exposure and audit failures. No redundant round-trip test was added. Parser gaps (duplicate ids, permissive base64 and ids beyond SMALLINT range), in-process rate-limit scope, and the difference from database doc 08's tenant-bound AAD/HMAC proposal are documented, with no business-rule or crypto changes in this task. Existing E2E ciphertext was not decrypted; key retention remains necessary even though dev currently has none.

A final boolean-only configuration inspection confirmed `PHONE_ENCRYPTION_KEYS`, `PHONE_HMAC_KEYS` and `SESSION_CSRF_SECRET` are absent/blank in the current API `.env`. The guide's generation block was executed with in-memory filesystem stubs only: it generated correctly sized independent keys, preserved unrelated settings and refused a second run with existing keys, without writing any environment file. An exact-value scan of all six changed files found no configured phone/CSRF secret values; no values were printed. Both migration appendix blocks were also checked against their complete source strings.

## D. Catalog cache, polling and carry-over regressions

Changed only `21gam-platform/src/services/http/http-api.ts`, `http-client.ts`, `http-api.test.ts` in the frontend. The adapter keeps a private mapped catalog/source cache with a 60-second TTL from successful load, coalesces concurrent requests, never caches failed loads, and returns independent clones. An adapter instance never shares its cache with another instance. Configuration/status/spare mutation completion invalidates it in `finally`, covering successful writes and uncertain timeout/error outcomes. Generations prevent older in-flight requests from restoring invalidated data.

HTTP authentication is also part of invalidation: `HttpClient.setCsrfToken` advances a non-secret revision, used by the cache across AuthApi login, session restore, logout and clear/expiry. This matters because HTTP session state does not call `GamApi.setSession`; invalidating only that method would miss real login changes. `setSession` also invalidates for its direct callers. No token is exposed by the revision. Old in-flight loads cannot populate a later session's cache. Live table, booking, waitlist and availability state still fetches on each call; external reference changes expire after 60 seconds of cache retention. Existing React Query catalog observers keep their original stale/refetch policy; the cache does not add a push mechanism or periodic catalog-observer refresh.

### Idle floor polling audit

For a settled desktop live floor with the default shift panel visible, no draft, no selected table, no search, a stable business date and no focus/reconnect/mutation events, the active unique React Query keys are floor, overview, reservations and waitlist. The sidebar/shift panel share overview; the floor/alerts share floor; booking list/alerts share reservations. Multiple observers of one key share its request. Catalog has a 60-second stale time but no timer of its own; its load occurs at mount/refetch. Disabled availability queries issue nothing. HTTP `subscribe` is a no-op, and the clock tick only rerenders in real HTTP mode.

| Per 15-second poll | Before | After on warm cache |
| --- | --- | --- |
| GET `/tables?date=...` | 2 (floor and overview snapshots) | 2 |
| GET `/bookings?date=...` | 3 (floor, overview, reservation list) | 3 |
| GET `/waitlist?date=...` | 2 (overview and waitlist list) | 2 |
| GET `/tables/catalog` | 3 | 0 |
| GET `/bookings/sources` | 3 | 0 |
| Total | 13 | 7 |

On a warm poll at the cache-expiry boundary, the adapter adds one catalog/source pair, reaching 9 requests if the concurrent poll calls overlap; over four aligned 15-second ticks that is 30 requests instead of 52. Cold mount previously requested four reference pairs (standalone catalog plus floor/overview/reservations), reaching 15 requests; now overlapping loads share one pair, reaching 9. Timer skew or extra focus/refetch events can change exact grouping, so these counts describe the explicitly stated idle scenario. Mobile layouts or hiding the shift panel may remove the separate waitlist query; selected-table details/drafts/search introduce other reads. Live snapshots still duplicate some table/booking/waitlist fetches by design; changing that was outside this small reference-data fix.

Evidence: before implementation, the new regression test observed exactly 13 requests for a warm settled poll and four concurrent catalog fetches in the separate concurrency scenario. After implementation, the poll test observes exactly seven live reads. Tests also cover TTL boundary/external changes, configuration disable/reopen/spare invalidation, failed mutation outcomes, rejected-load retry, instance/session isolation, late session and mutation loads, real authentication revision changes and returned-object isolation. There are 13 added frontend cache tests, bringing the total from 126 to 139.

Carry-over regressions already exist in `api/test/e2e-fixes.mysql.test.ts` (five tests: old holds/visits/groups, date boundary/future exclusion and explicit release) and `src/services/http/floor-adapter.test.ts` (stale hold/group availability, allocation business date independent of visit start time, same-day/released cases). They remain in the full passing suites. The catalog cache never caches allocations or filters away older unreleased occupancy.

### Validation evidence

| Repository/cwd | Command | Result |
| --- | --- | --- |
| `Bar_management/api` | `pnpm typecheck` | PASS |
| `Bar_management/api` | `pnpm lint` | PASS, no warnings |
| `Bar_management/api` | `$env:DB_NAME='gam21_platform_it_test'; $env:RUN_MYSQL_INTEGRATION='1'; npx vitest run` | PASS, 19 files, 167/167 tests; 50.18 seconds |
| `21gam-platform` | `npm run typecheck` | PASS |
| `21gam-platform` | `npm run lint` | PASS, exit 0; 11 existing warnings confined to UI files |
| `21gam-platform` | `npm run test` | PASS, 12 files, 139/139 tests; 8.75 seconds |
| `21gam-platform` | Targeted Prettier check and `npx vitest run src/services/http/http-api.test.ts` after formatting | PASS, 14/14 tests; all three service files formatted |

Frontend warnings concern Fast Refresh exports, hook dependencies, React compiler memoization and a state-in-effect call in `components/booking-pickers.tsx`, floor quick-form/booking-list/floor-page and mobile ui/list/form/mobile-app. They were observed before this patch and none points at the changed service files. UI files are outside this worker's permitted edits and were not changed. Initial new-test typecheck found two invalid null `setSession` fixtures; those were corrected to real SessionUser values before the passing acceptance run. Targeted Prettier formatting is limited to the two edited adapter/test files.

Remaining operator decisions: approve or defer dev revoke 0004, decide whether/when admin portal RBAC is actually needed and choose its single migration lineage, configure/persist deployment phone/session secrets privately, retain keys for existing test ciphertext, and choose the separate event-block lifecycle before schema/API work. These decisions do not block the completed cache and regression changes.

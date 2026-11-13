# API 21GAM

Base URL: `http://localhost:3000/api/v1`. This document describes the implemented Express API, including its current limitations. Paths below are relative to that base URL.

## Transport and authentication

- JSON uses UTF-8; successful requests return 200 unless stated otherwise.
- Login sets an HttpOnly session cookie. Send that cookie on subsequent requests (`credentials: 'include'` in the browser).
- Every POST, PUT and PATCH requires `Origin` equal to `WEB_ORIGIN` (normally `http://localhost:5173`). Login also requires the trusted origin.
- Every authenticated mutation requires `X-CSRF-Token` from login or `/auth/me`. Store the token in memory. Logout revokes the session and clears its cookie.
- Actors, organization and venue are determined by the authenticated session. Request bodies cannot choose another organization, venue or user. Booking sources belong to the organization; bookings, tables, visits and waitlist belong to the active venue.
- All business routes require authentication and their listed permissions. Permissions are checked on every request, including after role revocation.
- Existing-entity writes require the current positive integer `version`. The status compatibility route uses optional `expectedVersion`. Stale versions return 409. Do not automatically retry mutations.
- `Idempotency-Key` is optional on protected create endpoints. When supplied, it is bound to the authenticated organization, endpoint and request fingerprint; concurrent/retried requests replay one committed response and share the domain transaction. Clients should still disable duplicate submission for user feedback.
- `businessDate` is a valid `YYYY-MM-DD`; response instants are ISO-8601 UTC strings. Booking `expectedAt` must include an offset and represent local time in `Asia/Ho_Chi_Minh` (normally `+07:00`). Business hours are 17:00 through before 05:00 the next morning; after midnight belongs to the previous business date. New or changed booking times must be within 19:00-01:00 inclusive and must fall on a 15-minute slot with zero seconds; anything else is rejected as `EXPECTED_AT_OFF_SLOT` (for example 22:35). This records the interval the API enforces today and is not an approval of it: Q03 is still open with the PO, and the written sources S2/S3/S4 specify a 5-minute step, so the acceptance criteria, pickers and this paragraph change together once Q03 is decided. Updating other fields on a historical booking may retain its existing out-of-window timestamp. Walk-ins keep the operating-hours rule.
- There is no subscription/change-feed endpoint. Clients may poll and refetch after successful mutations.

Errors use:

```json
{"error":{"code":"VERSION_CONFLICT","message":"Booking vừa được thay đổi. Vui lòng tải lại."}}
```

Common status codes: 400 `INVALID_*` validation, 401 `AUTHENTICATION_REQUIRED` / `SESSION_INVALID`, 403 `PERMISSION_DENIED` / `CSRF_TOKEN_INVALID` / `ORIGIN_NOT_ALLOWED`, 404 entity not found in the actor's scope, 409 stale version or allocation conflict, 422 `INVALID_PHONE_NUMBER` / `BOOKING_PHONE_UNAVAILABLE`, 429 rate limit, 503 `PHONE_*_UNAVAILABLE`. Duplicate keys map to `RESOURCE_CONFLICT`; database deadlocks/lock timeouts map to `CONCURRENT_UPDATE_RETRY`. Internal failures return a generic 500 without SQL or secrets.

## Health and session

| Method | Path | Access | Response |
| --- | --- | --- | --- |
| GET | `/health` | Public | `{ok:true}`; process liveness, not a database check |
| POST | `/auth/login` | Trusted origin | Body `{username,password,portal}`; returns `{user,permissions,csrfToken,portal,expiresAt}` and session cookie |
| GET | `/auth/me` | Session | `{user,permissions,csrfToken,portal}` |
| POST | `/auth/logout` | Session + CSRF | 204, no body |

`portal` is one of `admin`, `receptionist`, `customer-care` or `cashier`. The server verifies the password before checking portal eligibility, creates no session for a denied portal and stores the verified portal on the server-side session. Current conservative mapping is `admin → OWNER_ADMIN`, `receptionist → RECEPTIONIST`, `customer-care → CUSTOMER_CARE`, `cashier → CASHIER`. A multi-role account receives only roles and permissions mapped to the selected portal; the request value never grants a role. Changing a client URL cannot change the session portal. Invalid portal is `INVALID_PORTAL` (400); valid credentials at a disallowed portal are `PORTAL_ACCESS_DENIED` (403).

`user` contains `{id,username,displayName,organizationId,venueId,roles}`; `roles` contains only the active role codes eligible for the session portal and venue. Raw session tokens are never included in JSON. Login is limited after five failed credential attempts for the same IP/username in a 15-minute window. `/auth/me` restores the same portal after refresh. Disabled users, suspended memberships, expired/revoked sessions, or revocation of the last role eligible for the session portal make the next authenticated request return 401. Logout revokes the database session and clears the HttpOnly cookie. Migration `0012_add_auth_session_portal.sql` revokes legacy active sessions that had no server-verified portal instead of assigning one heuristically.

The current API schema does not contain `SUPER_ADMIN`, a read-only admin role, Service/Waiter, Bar or Warehouse roles. Their portal mapping remains `[?]` pending an approved NA-07 matrix; no role, permission or grant is synthesized by TU-07. See `docs/security/tu07-tu08-audit.md` for the endpoint RBAC and TU-08 audit.

## Venue settings

| Method | Path | Access | Request / response |
| --- | --- | --- | --- |
| GET | `/settings` | Authenticated session | `{quickTimes:string[],upcomingMinutes:number,noShowMinutes:number}` |
| PUT | `/settings` | Session + CSRF + `venue.configure` | Full body and response use the same camelCase shape |

Both endpoints derive organization and venue exclusively from the authenticated actor. There is no venue selector in the URL or body. `GET` is read-only, sends `Cache-Control: no-store`, never initializes missing rows and uses `['21:00','21:30','22:00','22:30']` only as the fallback when the venue has no valid `quick_times` row. The existing `GET /venues/:id/settings` compatibility endpoint and its snake_case wrapper remain unchanged.

`PUT` requires exactly `quickTimes`, `upcomingMinutes` and `noShowMinutes`; unknown or missing fields return 400. `quickTimes` contains 1–24 unique `HH:mm` values inside 19:00–01:00 inclusive. `upcomingMinutes` is an integer from 1 through 240. `noShowMinutes` is an unsigned-smallint value and must also remain greater than the venue's unchanged `late_warning_minutes`. Invalid settings use `INVALID_SETTINGS_PAYLOAD`, `INVALID_QUICK_TIMES`, `INVALID_UPCOMING_MINUTES` or `INVALID_NO_SHOW_MINUTES`. Seeded roles grant `venue.configure` only to `OWNER_ADMIN`; the backend checks the permission itself, so a read-only admin or staff role receives 403 while any separately provisioned super-admin role must explicitly have the same permission.

The update locks the venue and writes `venue_settings.quick_times`, `venues.upcoming_warning_minutes`, `venues.no_show_warning_minutes`, the venue version/change sequence and a redacted `VENUE_SETTINGS_UPDATED` audit in one transaction. `late_warning_minutes` is not modified. Failure of any write rolls everything back. Other venues are unaffected. Each committed update bumps `change_seq`; current floor polling and the settings query's 15-second polling refetch server-derived state without introducing another realtime channel. The booking forms show the database quick times as shortcuts and never replace the time already entered by the user. The pickers offer the slots the API accepts, which is the 15-minute step described under Transport while Q03 is open; they do not offer a 30-minute-only list.

Floor Projection and booking views continue to read thresholds directly from `venues`. Changing `upcomingMinutes` therefore changes the server-side `UPCOMING` boundary; it no longer moves any calling boundary, because `canCall` depends only on whether a phone is stored. Changing `noShowMinutes` changes the visual no-show warning and the TU-12 cutoff. It never automatically changes the persisted booking to `NO_SHOW`, cancels a hold or releases a table; manual no-show behavior remains authoritative.

## Tables and catalog

| Method | Path | Permission | Request / response |
| --- | --- | --- | --- |
| GET | `/tables/catalog` | `customer.view_masked` | `{venue,zones,tables,combinations}` |
| GET | `/tables?date=YYYY-MM-DD` | `customer.view_masked` | Atomic `{businessDate,serverNow,changeSeq,tables:FloorTableProjection[],groups:FloorGroupProjection[]}` |
| PATCH | `/tables/:id/status` | `table.assign` | Body `{businessDate,state,expectedVersion?,reason?}`; see limitation below |
| PATCH | `/tables/:id/configuration` | `venue.configure` | Body `{isSpare?:boolean,status?:"ACTIVE"|"OUT_OF_SERVICE",version,reason}`; returns `{table:{id,code,isBackup,status,version}}` |
| POST | `/tables/groups/:id/split` | `table.group.manage` or `visit.split` | Body `{keepTableIds}`, or `{version,mode:"ALL_TO_SINGLE"}` to dissolve a cluster; `{operationId,changeSeq,summary,undoable:false,splitGroupId,group,keptTableIds,releasedTableIds,owner}`. See **Table groups** below for the cluster endpoints. |

`FloorTableProjection` retains the legacy table fields additively and exposes `{tableId,tableCode,catalogStatus,isSpare,displayState,arrivalPhase,arrivalTime,minutesLate,claim,groupId,groupDisplayCode,groupMemberTableIds}`. `displayState` is `EMPTY`, `BOOKED`, `UPCOMING`, `LATE`, `NO_SHOW`, `IN_USE` or `OUT_OF_SERVICE`; it is computed with the venue thresholds and server clock. `NO_SHOW` is visual while the reservation may remain `BOOKED` with an active allocation. Active visits have precedence over holds. Reservation and waitlist holds for another business date are excluded; an unreleased visit from an earlier date remains visible and is marked stale.

Every command that allocates a table applies one occupancy policy, the same one this projection reads: an unreleased
`HOLD` blocks only the business date being allocated, so each operating day is planned independently; a command that
seats a party now blocks on any unreleased `USAGE` whatever date it carries; and a command that only plans a day blocks
on a `USAGE` that date would really carry, so planning a later day beside a table still in use today stays allowed. No
release time is inferred. This covers walk-in, create-and-assign, assign, booking and visit merge, visit move, waitlist
seating and undo compensation, which all answer with `TABLE_ALREADY_OCCUPIED`.

Split takes the merge group, not a table. `keepTableIds` are the tables that stay with the party and must all belong to
the group; every other table of the group is released with reason `SPLIT`. It must release at least one table
(`SPLIT_RELEASES_NO_TABLE`) and the kept tables must still seat the party (`INSUFFICIENT_TABLE_CAPACITY`), using the
same capacity rule as merge and assignment. The group is dissolved and the kept tables are re-allocated, forming a new
group with a fresh symbol when two or more stay. Allocation history is append-only: released rows are kept. The route
accepts `Idempotency-Key`, so a retry with the same key and payload replays the committed split, while the same key
with a different payload is refused `IDEMPOTENCY_KEY_REUSED`. A split is not undoable, so its audit row carries
`is_undoable = 0` and undo stays closed with `NOT_UNDOABLE`.

`claim` is null or a whitelisted `{kind,reservationId,visitId,waitlistEntryId,holdId,guestName,phoneLast3,partySize,turnNo,flags,groupId,groupDisplayCode,groupMemberTableIds,startsAt,deadlineAt,holdOverdue,paid,origin,sourceCode,version}`. `kind` is `RESERVATION`, `VISIT` or `WAITLIST_HOLD`. `turnNo` is currently null. `flags` only contains the structured values `BIRTHDAY`, `NEW` or `RETURNING`; notes are never parsed. A `VISIT` claim that was checked in from a booking keeps that booking's `reservationId`, `flags`, `sourceCode` and masked `phoneLast3`, resolved through `reservations.visit_id`; an independent Walk-in or Waitlist visit reports `reservationId` null, no flags and no source. `canCall` is true for any claim that has somewhere to log a call - a `reservationId`, a `waitlistEntryId` or a `visitId` - together with a `phoneLast3`. It no longer depends on the claim kind or the derived display state. The response never includes raw notes, full phone numbers, ciphertext or HMAC fields.

The endpoint performs two fixed-count reads inside one read-only `REPEATABLE READ` transaction. `serverNow` is the application clock instant used for every derived state and `changeSeq` is returned as a decimal string. Groups use persisted IDs and symbol numbers; display codes use Excel-style letters (`1 => ◆A`, `26 => ◆Z`, `27 => ◆AA`). The legacy `state` and `activeVisit` fields remain during rollout, but `activeVisit.note` is always null. GET has no lifecycle write side effects.

Catalog venue fields include `id,version,name,timezone,businessDayStartLocal,businessDayCutoffLocal,upcomingWarningMinutes,lateWarningMinutes,noShowWarningMinutes,waitlistHoldDefaultMinutes,waitlistClaimLeaseSeconds,reservationHoldPolicy,reservationWindowMinutes,groupSymbolCount,changeSeq`. The centralized arrival defaults are 10/15/30 minutes. Zones contain `id,version,code,name,isBookable,isWaitingArea`. Catalog tables contain `id,version,code,displayName,zoneId,zoneCode,kind,capacity,seqNo,isSpare,status,x,y,width,height`. Combinations contain `id,code,displayName,memberIds,capacity`.

**Direct status changes are unsupported in v1.** The status route accepts `AVAILABLE`, `RESERVED` or `IN_USE`, verifies table organization/venue (404 outside scope), checks `expectedVersion` if present (409 `VERSION_CONFLICT`), then returns 409 `TABLE_STATE_DERIVED`. It never creates an allocation, modifies the table or writes a mutation audit event. Use assign, check-in, move and close instead. Use the owner-only configuration route for manual `OUT_OF_SERVICE` / `ACTIVE` changes.

Spare configuration is persistent rather than per-day. `reason` is required, at most 500 characters. Provide at least one of `isSpare` or `status`; status supports `ACTIVE` and `OUT_OF_SERVICE`. The table must have no unreleased allocations (holds or visits, on any date), and at least one supplied value must change. `venue.configure` is granted only to OWNER_ADMIN. Successful configuration changes audit the actor and bump the table version. Sending `isBackup` to the status route returns 400 `FIXED_SPARE_TABLE`.

## Table groups — cụm bàn (C1)

A cluster of merged tables is part of the **floor layout**, not part of a booking. A receptionist merges two or more
tables before anyone has booked or arrived, and the cluster lives until a receptionist splits it. Three states stay
separate and nothing here conflates them: **layout** (single table, or member of a cluster — this section),
**operation** (empty / booked / in use — `table_allocations`, unchanged) and **history** (the bookings and visits that
happened — append-only, never rewritten by a layout change).

| Method | Path | Permission | Request | Response | Error codes |
| --- | --- | --- | --- | --- | --- |
| GET | `/tables/groups?includeDissolved=true` | `customer.view_masked` | — | `{groups:LayoutGroupView[]}` | — |
| GET | `/tables/groups/:id` | `customer.view_masked` | — | `{group:LayoutGroupView}` | `INVALID_GROUP_ID`, `TABLE_GROUP_NOT_FOUND` |
| POST | `/tables/groups` | `table.group.manage` | `{tableCodes:["B3","B4","B5"]}` or `{tableIds:[101,102,103]}`, optional `name`, `spareOverrideConfirmed` | 201 `{operationId,changeSeq,summary,undoable:false,group:LayoutGroupView}` | `INVALID_TABLE_CODES`, `DUPLICATE_TABLE_CODE`, `MERGE_REQUIRES_MULTIPLE_TABLES`, `TABLE_NOT_FOUND`, `TABLE_ALREADY_GROUPED`, `SPARE_TABLE_OVERRIDE_REQUIRED`, `INVALID_SPARE_OVERRIDE`, `ZONE_NOT_BOOKABLE`, `TABLE_KIND_MISMATCH`, `CROSS_ZONE_MERGE_DISABLED`, `TABLE_NOT_ADJACENT`, `TABLE_GROUP_MIXED_STATE`, `TABLE_GROUP_MULTIPLE_CLAIMS`, `TABLE_GROUP_CONFLICT`, `GROUP_SYMBOL_UNAVAILABLE`, `FORBIDDEN` |
| POST | `/tables/groups/:id/members` | `table.group.manage` | `{version, tableCodes|tableIds}`, optional `spareOverrideConfirmed` | `{operationId,changeSeq,summary,undoable:false,group:LayoutGroupView}` | as POST `/tables/groups`, plus `INVALID_VERSION`, `TABLE_GROUP_VERSION_CONFLICT`, `TABLE_GROUP_ALREADY_DISSOLVED`, `TABLE_ASSIGNMENT_UNCHANGED` |
| POST | `/tables/groups/:id/dissolve` | `table.group.manage` | `{}` or `{version}` | `{operationId,changeSeq,summary,undoable:false,groupId,groupCode,status:"DISSOLVED",releasedTableIds,releasedTables}` | `INVALID_GROUP_ID`, `TABLE_GROUP_NOT_FOUND`, `TABLE_GROUP_ALREADY_DISSOLVED`, `TABLE_GROUP_IN_USE`, `TABLE_GROUP_VERSION_CONFLICT`, `TABLE_GROUP_CONFLICT`, `FORBIDDEN` |
| POST | `/tables/groups/:id/split` | `table.group.manage` or `visit.split` | `{keepTableIds}` **or** `{version, mode:"ALL_TO_SINGLE"}` | the BA-021 split result, or the dissolve result for `ALL_TO_SINGLE` | BA-021 codes below, plus `INVALID_SPLIT_MODE` and the dissolve codes |
| GET | `/tables/stream` | `customer.view_masked` | — | `text/event-stream` | — |

`mode:"ALL_TO_SINGLE"` is the shipped client's spelling of Tách bàn on a cluster and delegates to the same dissolve
implementation, so the two paths cannot drift apart. A body with neither `mode` nor `keepTableIds` still answers
`TABLES_REQUIRED`.

`LayoutGroupView` is `{groupId,groupCode,symbolNo,displayCode,name,status,version,zoneId,tableIds,tableCodes,
tables:[{id,code,capacity}],totalCapacity,formedAt,dissolvedAt,inUseBy}`. `groupCode` is `TG-<groupId>`; `displayCode`
is the Excel-style floor mark (`1 => ◆A`). `status` is `ACTIVE` or `DISSOLVED`. `totalCapacity` is summed from the
member tables' own `dining_tables.capacity` — never a constant and never a configured default. `inUseBy` is null, or
`{kind:"HOLD"|"USAGE",holdId,visitId}` for the one booking or visit currently using the cluster. `version` is the
**cluster's layout version**, not a guest's: merge and split commands carry this one, commands on a guest carry
`claim.version`.

### Request and response example

```http
POST /api/v1/tables/groups
Content-Type: application/json
Origin: https://app.example.com
X-CSRF-Token: <memory-only token>
Idempotency-Key: 8e0f1b2c-3d4e-5f60-7182-93a4b5c6d7e8

{"tableCodes":["B3","B4","B5"]}
```

```json
{
  "operationId": 412,
  "changeSeq": 1884,
  "summary": "Đã ghép B3 + B4 + B5 thành cụm ◆A (12 chỗ).",
  "undoable": false,
  "group": {
    "groupId": 101, "groupCode": "TG-101", "symbolNo": 1, "displayCode": "◆A", "name": "◆A",
    "status": "ACTIVE", "version": 1, "zoneId": 2,
    "tableIds": [101, 102, 103], "tableCodes": ["B3", "B4", "B5"],
    "tables": [{"id":101,"code":"B3","capacity":4},{"id":102,"code":"B4","capacity":4},{"id":103,"code":"B5","capacity":4}],
    "totalCapacity": 12, "formedAt": "2026-11-10T13:02:11.421Z", "dissolvedAt": null, "inUseBy": null
  }
}
```

```http
POST /api/v1/tables/groups/101/dissolve
{"version":1}
```

```json
{
  "operationId": 418, "changeSeq": 1891, "undoable": false,
  "summary": "Đã tách cụm ◆A, trả lại B3, B4, B5.",
  "groupId": 101, "groupCode": "TG-101", "status": "DISSOLVED",
  "releasedTableIds": [101, 102, 103], "releasedTables": ["B3", "B4", "B5"]
}
```

### Validation rules

Merging takes a list of tables and nothing else: **no guest name, phone, party size or arrival time is required or
accepted**. The list must name at least two distinct tables that exist and are `ACTIVE`; a repeated code or id answers
`DUPLICATE_TABLE_CODE`. Codes are resolved against `dining_tables` — nothing is inferred from the shape of a code.

- **One cluster per table.** A table already in an active cluster answers `TABLE_ALREADY_GROUPED` with
  `details.conflictingTableIds`. This is enforced by `uq_group_member_active (venue_id, active_table_key)` in the
  database, not in application code, so two devices merging the same table concurrently cannot both win.
- **At least two physical tables.** One table is not a cluster (`MERGE_REQUIRES_MULTIPLE_TABLES`).
- **One claim, or none.** Every member must share one booking or visit, or all be empty. Mixing an empty table with an
  occupied one answers `TABLE_GROUP_MIXED_STATE`; two different bookings answer `TABLE_GROUP_MULTIPLE_CLAIMS`. Both
  carry `details.conflictingTableIds`.
- **Spare tables need a confirmation.** A spare table may join a cluster, but only with
  `spareOverrideConfirmed: true`; without it the server answers `409 SPARE_TABLE_OVERRIDE_REQUIRED` and writes nothing.
  The confirmation and the spare codes are recorded in the audit row. A spare table remains unbookable **directly**:
  assign and walk-in still answer `SPARE_TABLE_NOT_BOOKABLE`.
- **Adjacency comes from data.** Members must form one connected group over the venue's configured
  `table_adjacencies` edges (`TABLE_NOT_ADJACENT`). Migration `0003` ships that table empty on purpose, so a venue with
  no configured edges has nothing to check against and the rule is skipped rather than silently blocking every merge.
- **Zones.** Mixing `TABLE` with `BAR_SEAT` answers `TABLE_KIND_MISMATCH`; a zone that does not take guests answers
  `ZONE_NOT_BOOKABLE`. Cross-zone merging is gated by the feature flag below.

### Lifecycle

A cluster exists until someone with the permission calls dissolve. It is **never** dissolved automatically by paying,
Close Visit, a cancelled booking, a No-show, the end of a shift, the business-day rollover or a server restart — it is a
row, not memory. One cluster therefore serves several parties one after another.

Dissolve requires the cluster to be `ACTIVE`, runs in one transaction, and refuses `409 TABLE_GROUP_IN_USE` (with
`details.holdId` / `details.visitId`) while a party is seated on it or a booking is holding it: splitting then would
break that claim apart. The receptionist closes or moves the party first; dissolve never closes a visit on its own.

Nothing in a layout change touches history. `table_group_members` is append-only — leaving sets `left_at`, it never
deletes — and dissolve writes **no** `table_allocations` row at all. Past bookings keep pointing at the tables they
actually used; no old booking is rewritten to look like a single-table booking. The audit row
(`TABLE_GROUP_FORMED` / `TABLE_GROUP_MEMBERS_ADDED` / `TABLE_GROUP_DISSOLVED`, `entity_type = table_group`) snapshots
the membership at that moment, which is how a past party is traced back to the cluster it sat on after the cluster is
gone.

### Booking and visit integration

Booking, walk-in, assign and move **expand a requested table to every member of the active cluster it touches**, in the
same transaction, so a cluster is never half-booked and the client never has to know its membership — there is no window
between reading membership and acting on it. When the expanded set is exactly one cluster, the allocations record that
cluster's id, so the floor shows one identity rather than a second implicit group over the same tables. Check-in
inherits the hold's group, so it needs no expansion.

`table_groups` carries `origin`. `LAYOUT` is the cluster described here. `CLAIM` is the pre-existing implicit cluster of
one booking or visit: it is scoped to one business date and still auto-dissolves once nothing uses it, including at the
business-day cutoff. A `LAYOUT` symbol is reserved venue-wide for as long as it is active, so a cluster that outlives its
business date can never share a floor mark with a later `CLAIM` group.

### Floor projection

`GET /tables?date=` now returns a cluster with **no guest** in `groups[]`, which is what was impossible before.
`FloorGroupProjection` gains `{origin,version,name,zoneId,totalSeats,isOutOfService,displayState,claim,businessDate}`.
`displayState` is derived with the same `deriveTableDisplayState` as a table, from the cluster's single claim, so the
cluster tile and its member tables can never disagree; with no claim it is `EMPTY`. `isOutOfService` is true when any
member is out of service. Each member table reports `groupId`, `groupDisplayCode` and the full
`groupMemberTableIds`, so touching one table identifies the whole cluster, and gains
`claimOwner: "GROUP" | "TABLE" | null` saying where the claim is drawn. A member table's own `claim` and `displayState`
are unchanged, so the cluster marking never replaces a table's operational state.

### Feature flag: cross-zone merging

`ALLOW_CROSS_ZONE_TABLE_MERGE` defaults to **`false`**, and the cross-zone rule is read from it rather than hardcoded in
business logic. While false, members in two different zones answer `409 CROSS_ZONE_MERGE_DISABLED`. Setting it to `true`
only skips that one check: every other rule — two tables minimum, one cluster per table, one claim or none, kind, zone
bookability, adjacency, spare confirmation — still applies, so turning it on is not a blanket permission for any
combination of tables. The flag is read at startup and accepts only `true` or `false`.

### Realtime (SSE)

`GET /tables/stream` is a `text/event-stream` on the same cookie session, trusted-origin and permission checks as the
rest of `/api/v1`; no token is ever placed in the URL. Frames are `hello` on connect and `floor-changed` thereafter,
each `{"venueId":1,"changeSeq":"1884"}`.

The cursor is `venues.change_seq`, which every mutation already bumps **inside its transaction**, so a rolled-back
transaction can never produce an event: the number it would have published was never committed. A frame says "your
snapshot is stale", never what changed, so no customer data travels on the stream and an out-of-order or replayed frame
cannot overwrite newer state — the client refetches the authoritative projection, and a frame older than one already
seen is dropped by the monotonic cursor. On reconnect the client refetches before it trusts anything. `retry: 2000`
and a comment heartbeat every `REALTIME_HEARTBEAT_MS` keep proxies from closing an idle stream; `X-Accel-Buffering: no`
stops a buffering reverse proxy from spending the latency budget. Tuning: `REALTIME_POLL_INTERVAL_MS` (default 500) and
`REALTIME_HEARTBEAT_MS` (default 20000). The clients keep their 15-second poll as the fallback for a blocked stream.

### Capacity is guidance, not a limit

A table's capacity no longer blocks a booking and does not require confirmation. Booking, walk-in, assignment, merge,
and visit-move requests proceed normally when the party is larger than the selected tables' suggested capacity. The
legacy `capacityOverrideConfirmed` field is still accepted during rolling deployments but is no longer required.

Every other rule is untouched. Party size must still be a positive whole number; a table still cannot be double-booked
(`TABLE_ALREADY_OCCUPIED`), confirmation or no confirmation; a spare table is still not bookable directly; and the
BA-021 split still requires the kept tables to seat the party (`INSUFFICIENT_TABLE_CAPACITY`), which is a different rule
about shrinking under a seated party and is deliberately left as a hard block. Waitlist seating and undo compensation
keep their own capacity checks for the same reason.

### Compatibility with the previous API

All of this is additive. `POST /tables/groups/:id/split` with `{keepTableIds}` behaves exactly as before. `groups[]` and
`FloorTableProjection` only gain optional fields, and clients that ignore them keep working. `table_allocations.group_id`
keeps its meaning. `AppError` responses may now carry `error.details`; a client that reads only `code` and `message` is
unaffected. The intentional behaviour change is that booking, walk-in, assign, merge and move no longer return a
capacity error.

### Migration

`0017_independent_table_group_layout.sql` is additive and loses no data:

- `table_groups` gains `origin` (`DEFAULT 'CLAIM'`, so every existing row keeps its existing meaning), `name`,
  `version`, a stored `active_layout_symbol` and `uq_table_groups_active_layout_symbol`.
- `table_group_members` is created with `uq_group_member_active (venue_id, active_table_key)`, foreign keys to venue,
  group and table, and an append-only `left_at` / `left_by_user_id` / `left_reason`.
- Permission `table.group.manage` is inserted and granted to `OWNER_ADMIN` and `RECEPTIONIST`.

No row is updated or deleted. Migrations are forward-only (doc 10 §2); there is no down step. Apply with
`npm run db:migrate` from `Bar_management/api`, with `DB_NAME` pointing at the target database. Test databases that
hold layout clusters must delete `table_group_members` before `table_groups`; the integration and E2E fixtures already
do.

### Testing

```powershell
cd Bar_management/api
$env:RUN_MYSQL_INTEGRATION='1'
$env:DB_NAME='gam21_platform_it_test'
$env:NODE_ENV='test'
npx vitest run test/table-layout-group.mysql.test.ts
```

`test/table-layout-group.mysql.test.ts` covers merge, split, lifecycle across Close Visit / Cancel / No-show / the
business-day sweep, capacity confirmation, permission and spare tables, the cross-zone flag, concurrency (two devices on
one table, two devices splitting one cluster, a double-clicked request, a rolled-back merge) and the older `CLAIM`
grouping. `test/floor-change-stream.test.ts` covers the stream's cursor rules. On the web side,
`src/services/http/floor-stream.test.ts` covers the SSE client and
`src/features/floor/layout-cluster.test.ts` the cluster selection and confirmation dialogs.

A browser run on real phone and tablet viewports, against this API and a disposable MySQL test database:

```powershell
$env:DB_NAME='gam21_platform_test'
$env:DB_PORT='3306'
pnpm -C web e2e:c1
```

`web/e2e/c1-table-group-mobile.mjs` drives 360, 390, 430, 768 and 1024px with touch emulation. At every width it checks
that merge and split are reachable, that each control measures at least 44px on its short side (measured from the
rendered box, not from class names) and that the page does not scroll sideways. At 390 and 768 it runs the whole flow:
merge B3+B4+B5 with no guest details, one tap on a member identifying the cluster, a second browser context seeing the
split in under two seconds without a reload, re-merging the released tables, the capacity refusal and its confirmation,
and that a cluster serving a party is offered the BA-021 keep-tables split rather than a dissolve. It then revokes
`table.group.manage` to check the control is disabled and the server still answers 403, and marks a table spare to check
the confirmation gate. It reseeds the fixture before each viewport, so no result depends on the order they ran in.

The run needs `pnpm` (it drives the workspace filters), a Chromium that Playwright can launch, and `DB_NAME` ending in
`_test`; it refuses any database outside the approved disposable list. Set `PW_CHROMIUM_PATH` to use an installed
Chrome.

## Bookings

| Method | Path | Permission | Request / response |
| --- | --- | --- | --- |
| GET | `/bookings?date=YYYY-MM-DD` | `customer.view_masked` | `{businessDate,bookings:BookingView[]}` |
| GET | `/bookings/sources` | `customer.view_masked` | `{sources:[{code,name}]}`; active organization sources |
| GET | `/bookings/search?date=YYYY-MM-DD&last3=123` | `customer.view_masked` | Fast reception search: exact last 3 digits, scoped to session venue/date; returns masked booking/waitlist matches, real assigned `tableIds`, and a deduplicated summary |
| GET | `/bookings/search?date=YYYY-MM-DD&name=...` | `customer.view_masked` | Optional accent-insensitive reception name search; same masked response |
| GET | `/bookings/search?date=YYYY-MM-DD&q=...` | `customer.view_masked` | Backward-compatible booking search response `{businessDate,query,bookings}`; up to 100 results |
| GET | `/bookings/export?date=YYYY-MM-DD` | `customer.view_masked` | UTF-8 `text/plain` Zalo summary and booking statistics, no phone fields |
| GET | `/bookings/:id` | `customer.view_masked` | `{booking:BookingView}` |
| POST | `/bookings` | `reservation.create` | Body `BookingInput`; 201 `{booking}` |
| POST | `/bookings/direct` | `reservation.create` + `table.assign` | Body `BookingInput` plus `tableIds`; 201 `{booking}` with assigned table codes |
| PUT | `/bookings/:id` | `reservation.update` | Body `BookingInput` plus `version`; `{booking}` |
| POST | `/bookings/:id/assign` | `table.assign` | Body `{version,tableIds}`; `{booking}` |
| POST | `/bookings/:id/merge` | `visit.combine` | Body `{version,tableIds}`; `{booking,group:{id,symbolNo,tableIds}}` |
| POST | `/bookings/:id/cancel` | `reservation.cancel` | Body `{version,reasonNote?}`; `{booking}` |
| POST | `/bookings/:id/no-show` | `reservation.mark_no_show` | Body `{version}`; `{booking}` |
| POST | `/bookings/:id/late-confirm` | `reservation.update` | Body `{version}`; returns `{bookingId,lateConfirmed,lateConfirmedAt,version,changeSeq}` only |
| POST | `/bookings/:id/call` | `booking.phone.call` | Empty object; 201 `{callId,bookingId,initiatedAt,telUri}` with `Cache-Control: no-store` |
| POST | `/bookings/:id/calls/:callId/outcome` | `booking.phone.call` | Body `{outcome,bookingVersion?}`; records one result for the call |
| GET | `/bookings/:id/calls` | `booking.phone.call` | `{calls}`, newest first, never a phone number |
| POST | `/bookings/:id/check-in` | `visit.checkin` | Body `{version}`; `{booking}` |
| POST | `/bookings/:id/phone:reveal` | Both `booking.phone.reveal` and `customer.phone.reveal` | `{phoneNumber}`; owner-only under seeded roles |
| POST | `/bookings/walk-ins` | `visit.walkin` | Body `{partySize,businessDate,tableIds,guestName?,phoneNumber?}`; 201 `{visitId}` |

`BookingInput`:

```json
{
  "guestName":"Khách đặt bàn",
  "partySize":4,
  "expectedAt":"2030-10-24T20:00:00+07:00",
  "businessDate":"2030-10-24",
  "sourceCode":"HOTLINE",
  "note":"Ghi chú tùy chọn",
  "phoneNumber":"0987654321",
  "classification":"NEW",
  "isBirthday":false,
  "iconKeys":["star","pin"],
  "honorific":"MR",
  "socialPlatform":"IG"
}
```

At least one of `guestName` or `phoneNumber` is required. A supplied name is trimmed and limited to 120 characters; whitespace-only names are absent. A supplied phone is normalized and validated by the existing Vietnamese-phone policy. Phone-only creation resolves one organization-scoped Customer by deterministic phone HMAC, never invents a name, and preserves an existing Customer name. `partySize` is 1-500, `sourceCode` must exist and be active, and `note` is at most 500 characters. On update, omitted `phoneNumber` retains the existing phone, while null or blank removes it; removing the last contact identity is rejected. Update sends the complete non-sensitive booking fields, not a partial patch. Cancel `reasonNote` is at most 300 characters.

`BookingView` is `{id,guestName,hasGuestName,phoneLast3,partySize,expectedAt,businessDate,classification,guestType,isBirthday,iconKeys,honorific,socialPlatform,status,source,sourceCode,tableCodes,note,version,displayStatus,minutesLate,autoNoShowDue,canCall}`. `guestName` uses the existing display fallback `Khách`; `hasGuestName=false` distinguishes that label from stored identity so later edits do not persist the fallback as a customer name. `status` is `BOOKED`, `CHECKED_IN`, `CANCELLED` or `NO_SHOW`. For an active `BOOKED` reservation, display timing uses the current venue thresholds: `upcoming_warning_minutes` controls the pre-arrival window, `late_warning_minutes` controls the late boundary and `no_show_warning_minutes` controls the visual no-show boundary. Their seeded defaults are 10/15/30 minutes. Display `NO_SHOW` is non-terminal: `status` stays `BOOKED`, allocations and holds remain active, and `autoNoShowDue` stays false until an authorized user performs the manual no-show action. Search matches guest names or exactly three trailing phone digits. List, detail, search and mutation responses never contain a full stored phone or cryptographic fields. Export contains no phone fields, including suffixes.

Booking creation does not allocate tables or create a visit. Assign creates/replaces a hold; check-in requires an assigned booking and converts the hold to a visit/usage allocation. Cancel/no-show are explicit staff actions for `BOOKED` reservations and release their holds. Warnings after 15 and 30 minutes do not cancel or release anything. `NO_SHOW_WORKER_ENABLED` remains false.

Direct creation atomically creates the reservation, its hold, allocations and (for multiple tables) a group, with `RESERVATION_CREATED_AND_ASSIGNED` auditing. It requires a nonempty selection in one bookable zone, compatible table kinds, ACTIVE/non-spare tables, sufficient capacity and no same-date allocation conflicts. Any validation or audit failure rolls back the entire operation, including the reservation. Single Bar seats have capacity one. It does not create a visit; check in later through the normal route.

Merges preserve existing tables, add at least one table, require compatible kinds in one zone and sufficient combined capacity, and create/reuse an active group symbol. Reassignment may select multiple same-kind tables across bookable zones without adjacency configuration; multiple targets receive a shared group. Assignments reject spare/inactive tables and occupied allocations. The backend locks table rows and revalidates concurrent requests; a lost race returns 409 rather than double seating. No fixed seating duration is assumed.

Walk-ins require the current business date during operating hours; errors are `WALK_IN_OUTSIDE_BUSINESS_HOURS` or `BUSINESS_DATE_NOT_CURRENT`. A reservation for another date does not authorize a walk-in for that date. Name and phone are optional; an omitted name is stored/displayed as `Khách Walk-in`. An optional phone is protected through the existing encrypted customer identity and is never returned by this endpoint. The mutation locks and validates ACTIVE/non-spare tables in one bookable zone with compatible kinds and sufficient total capacity, rejects any unreleased allocation (including confirmed booking holds), creates a canonical group for multiple tables without an adjacency requirement, then writes the Visit, USAGE allocations, `WALK_IN_CREATED` audit and one venue `change_seq` increment atomically. An `Idempotency-Key` replay shares the same transaction and produces one domain effect.

### Booking icons, honorific and Social platform (migration 0016)

Migration `0016_add_booking_icons_social_honorific.sql` added `is_boss_table`,
`is_designated`, `social_platform` and `honorific` to `reservations`. No new
migration is needed to use them: `iconKeys` is the wire form of the two boolean
columns, so a venue already on 0016 needs no schema change.

`POST /bookings`, `POST /bookings/direct` and `PUT /bookings/:id` accept:

| Field | Values | Stored as |
| --- | --- | --- |
| `iconKeys` | array of `star` (⭐ Bàn sếp) and `pin` (📌 Chỉ định); `[]` or `null` clears both | `is_boss_table`, `is_designated` |
| `honorific` | `MR`, `MS`; `null` or `""` clears it | `honorific` |
| `socialPlatform` | `FB`, `IG`, `TIKTOK`, `THREADS`, `GG_REVIEW`; `null` or `""` clears it | `social_platform` |

`BookingView` returns `iconKeys` (always an array, `[]` when nothing is set),
`honorific` and `socialPlatform` (both nullable). A booking written before 0016
has all four columns at their defaults and reads back as `{"iconKeys":[],"honorific":null,"socialPlatform":null}`.

Rules:

* `🎂 Sinh nhật` is **not** an icon key — it stays the existing `isBirthday` boolean.
  🔥 Khách quen and 🆕 Khách mới are derived from `classification` and are not sent either.
  Any other key is refused rather than dropped in silence.
* `socialPlatform` is only stored while `sourceCode` is `SOCIAL`. For every other
  source the server writes `NULL`, whether the client sent a platform or not, and
  an update that moves a booking off `SOCIAL` clears the stored platform. A CHECK
  constraint cannot read the source code through the `booking_sources` foreign key,
  so this is enforced by the API.
* An omitted field keeps the stored value on update; an explicit `null` (or `[]`
  for `iconKeys`) clears it. A change to any of the three alone counts as a change,
  so such an edit is not rejected with `BOOKING_NOT_CHANGED`.
* The atomic Floor Projection claim also carries `honorific` and `iconKeys`, for a
  `RESERVATION`, a `WAITLIST_HOLD` and the `VISIT` a booking was checked in to, so
  the floor can render `Mr Nam` and the ⭐/📌 markers without a second request.

Errors, all 400:

| Code | Cause |
| --- | --- |
| `INVALID_ICON_KEYS` | not an array, more entries than there are icon keys, or a key outside `star`/`pin` |
| `INVALID_HONORIFIC` | a value outside `MR`/`MS` (case-sensitive) |
| `INVALID_SOCIAL_PLATFORM` | a value outside `FB`/`IG`/`TIKTOK`/`THREADS`/`GG_REVIEW` |

`POST /bookings/walk-ins` does not accept these three fields; a walk-in carries no
icons, honorific or platform.

### Late confirmation (TU-12)

`BookingView` and the atomic Floor Projection expose nullable `lateConfirmedAt`; neither exposes the confirming user or any unmasked phone data. The late-confirm response is intentionally minimal and contains no note, phone, ciphertext, HMAC or CRM fields. Late confirmation requires a current-business-date `BOOKED` reservation with an active table claim, no visit, a matching optimistic-lock version, and server time after `expectedAt` but before the no-show threshold. It increments the reservation version and venue change sequence once and writes `RESERVATION_LATE_CONFIRMED`. An exact retry of that successful input version is idempotent; unrelated stale versions return 409. Other 409 cases include wrong business date, terminal/check-in state, missing active claim and pre-arrival use. A new confirmation at/after the no-show threshold returns 409 `LATE_CONFIRM_NO_SHOW_THRESHOLD_REACHED`.

**Business Decision — Option A:** `LATE_CONFIRMED` does not extend a booking. It is rendered only before the configured no-show threshold. At exactly `expectedAt + no_show_warning_minutes`, `NO_SHOW` wins even when a prior confirmation exists. This is a display warning only: the reservation remains `BOOKED`, its confirmation history, hold, allocations and table group remain intact, and check-in is still allowed under the normal permission/business-date rules. Only the existing manual no-show or cancel workflow terminates the lifecycle and releases the tables.

### Calling a booking contact (TU)

The atomic Floor Projection and `BookingView` expose only `canCall` plus the existing `phoneLast3`. The server computes `canCall`: it is true whenever the guest has a valid encrypted phone, and false otherwise. Reception has to be able to ring a guest at any point of the night - before the pre-arrival window, past the no-show threshold, after check-in, and on a booking that was just cancelled - so calling no longer depends on the business date, the reservation status, a table claim or the derived display state. Venue thresholds still drive the display states themselves; they no longer move a calling boundary.

A waiting guest and a seated guest are called the same way, through `/waitlist/:id/call` and `/visits/:id/call`. They exist because `booking_call_logs.reservation_id` used to be `NOT NULL`, so a Walk-in on the waiting list - exactly the guest to ring when a table frees up or a hold runs out - could not be called at all. Migration 0023 makes that column nullable and adds `waitlist_entry_id` and `visit_id`, with a check constraint keeping exactly one of the three set. Their outcome route accepts only `CONTACTED` and `NO_ANSWER`: `LATE_CONFIRMED` moves a reservation, and these targets may have none. The per-user rate limiter counts booking, waitlist and visit ids in separate buckets, and `POST /bookings/:id/call` and the two new routes let a call through when no limit is configured, instead of the 503 that silenced the whole venue.

`POST /bookings/:id/call` accepts no phone number. BA-023 gives OWNER_ADMIN and RECEPTIONIST the dedicated sensitive permission `booking.phone.call`; it does not grant either reveal permission. The endpoint keeps the per-user/booking rate limiter and actor organization/venue scope, rechecks that a dialable phone exists, decrypts only after authorization, creates one `booking_call_logs` row, and returns a private/no-store RFC 3966 `tel:` response. Neither the URI nor the full number is written to `operation_log`, the floor projection, normal application logs or browser storage. The user must directly press the call action; the client creates a transient `tel:` link and does not retain it in application state or web storage. A `tel:` URI necessarily sends the full number to the browser and OS/dialer, may be visible in developer tools, and does not prove that a call connected. The outcome dialog therefore requires a human result. Backend-controlled telephony/hidden-number calling is not implemented.

Recording an outcome is independent from starting another call: an existing `callId` can still receive `CONTACTED`, `NO_ANSWER` or `LATE_CONFIRMED` after time-based call eligibility expires. `LATE_CONFIRMED` runs inside the same database transaction as the call outcome. If the booking is already late-confirmed, the endpoint validates the current booking version and records the new call result without repeating the TU-12 transition.

Each accepted call creates a distinct history row; FX-04 idempotency is intentionally not applied. Opening a `tel:` URI does not set an outcome. The UI offers `CONTACTED`, `NO_ANSWER` and `LATE_CONFIRMED` after returning, and retains a manual “Ghi kết quả cuộc gọi” action if `visibilitychange` is unavailable. Repeating the same outcome update for one `callId` returns the stored result without creating another row; trying to replace it with a different result returns `BOOKING_CALL_OUTCOME_CONFLICT`. `LATE_CONFIRMED` additionally requires `bookingVersion` and invokes the existing TU-12 transition. A concurrent booking change may therefore reject the result instead of forcing an invalid state transition. Other important errors are `BOOKING_CALL_NOT_ALLOWED`, `BOOKING_PHONE_UNAVAILABLE`, `BOOKING_CALL_NOT_FOUND`, `INVALID_CALL_OUTCOME`, `VERSION_CONFLICT`, 401 and 403.

## Booking classification

Payload tạo/sửa booking nhận `classification`: `RETURNING`, `NEW` hoặc `UNCLASSIFIED`. Trường không hợp lệ trả
`INVALID_BOOKING_CLASSIFICATION`. Nếu client cũ bỏ qua trường này, create dùng `UNCLASSIFIED` còn update giữ nguyên
giá trị hiện tại. Response list/detail luôn trả một trong ba giá trị; database `NULL` cũ được ánh xạ thành
`UNCLASSIFIED`. Classification thuộc booking, không thuộc customer profile.


### `GET /bookings/export?date=YYYY-MM-DD`

Yêu cầu session hợp lệ và quyền `customer.view_masked`. Response là `text/plain; charset=utf-8`, lấy booking,
allocation, bàn `OUT_OF_SERVICE` và bộ đếm waitlist trong cùng một MySQL transaction read snapshot. Query và formatter
không đọc/xuất số điện thoại, `phoneLast3`, ciphertext, HMAC hay customer ID. Thống kê trước/sau cộng `party_size`
theo `expected_at` với cutoff 21:30 giờ Việt Nam; đúng 21:30 thuộc nhóm trước (`<=` thuộc nhóm trước, chỉ `>` mới thuộc nhóm sau) và dòng text là `Khách vào trước/bằng 21:30`; O/N đếm booking theo classification và báo
riêng số `UNCLASSIFIED`. Endpoint chỉ trả text; không gửi sang Zalo.



### Phone protection

Receptionists never receive a full stored phone, including from `phone:reveal`. That route requires both permissions above; an owner can explicitly reveal a number. It applies per-user/booking rate limits, writes a redacted audit record before returning a number, and sets `Cache-Control: no-store, private, max-age=0` plus `Pragma: no-cache`. Audit failure prevents disclosure. Missing encryption/HMAC keys or rate-limit policy fail closed with 503.

Migration 0005 (`0005_revoke_receptionist_phone_reveal.sql`) revokes the historical `booking.phone.reveal` grant from RECEPTIONIST. Migration 0014 adds `booking.phone.call` to OWNER_ADMIN and RECEPTIONIST. Both `booking.phone.reveal` and `customer.phone.reveal` remain owner-only and are still required by the separate `phone:reveal` endpoint.

BA-023 records the approved PO decision: Receptionist calling uses the dedicated sensitive `booking.phone.call` permission and the controlled `tel:` response described above. This is an explicit exception for transferring the number to the browser/OS dialer; it does not broaden either general-purpose reveal permission.

## Visits

| Method | Path | Permission | Request / response |
| --- | --- | --- | --- |
| POST | `/visits/:id/close` | `visit.end` | Body `{version,mode:"MANUAL",reason,note?}`; `{visit:ClosedVisitView}` |
| POST | `/visits/:id/move` | `visit.move` | Body `{version,tableIds,note?}`; `{visit:MovedVisitView}` |
| POST | `/visits/:id/merge` | `visit.combine` | Body `{version,tableIds}`; `{visit:MovedVisitView,group:{id,symbolNo,tableIds}}` |
| GET | `/visits/turns?from=&to=` | `report.read` | Table-turn ledger over a range of operating days; see **Table turns** below |

Manual close reasons are `GUEST_LEFT` or `ENTRY_ERROR`; note is optional, at most 500 characters. Closing releases the visit allocations and dissolves unused groups. `ClosedVisitView` is `{id,businessDate,status:"CLOSED",endedAt,endReason,version,releasedTables:[{id,code}],turn}`, where `turn` is the table turn this close recorded (see **Table turns** below) or null when the visit already had one. Closing releases the operational state only: it never dissolves a LAYOUT cluster. `MovedVisitView` is `{id,businessDate,version,previousTables:[{id,code}],tables:[{id,code}]}`. Move validates capacity and same-kind targets, allows multiple tables across bookable zones without adjacency configuration, and creates or retains their shared group. It rejects every unreleased USAGE allocation on target tables regardless of business date, plus holds on the visit's business date. Merge follows the group rules above.

`BUSINESS_DAY_WORKER_ENABLED` defaults to `true`; `BUSINESS_DAY_WORKER_INTERVAL_MS` defaults to `30000`. The worker sweeps on startup and then at that interval. Each open visit becomes eligible at the venue's next-day business cutoff (05:00 in `Asia/Ho_Chi_Minh` with the default venue configuration). At or after the cutoff, one transaction ends the visit, releases all its active USAGE allocations, dissolves groups with no remaining allocations, increments the visit version/change sequence and audits `VISIT_AUTO_CLOSED_BUSINESS_DAY` as SYSTEM. Visit/allocation reasons are `BUSINESS_DAY_END`, with null staff actor IDs. Migration 0006 enables these reasons; migration 0007 permits system group dissolution only with `dissolve_reason = 'BUSINESS_DAY_END'` while preserving staff attribution on manual dissolution. The worker revalidates each scanned candidate under a lock and skips stale versions; a later sweep rescans them. Audit failure rolls the transaction back.

Carry-over occupancy remains visible and `staleFromPreviousDay` remains true on the current business-date projection until allocations are actually released. Past-date behavior is unchanged. A future business-date projection excludes earlier `USAGE` allocations and includes only exact-date `USAGE`, while reservation and waitlist holds remain scoped to the selected date. This projection filter never releases or rewrites allocations. It covers the interval before the worker runs and operation with the worker disabled; GET never performs a release. Auto-close takes precedence once its transaction commits, so subsequent current-date floor reads show the tables free and remove empty groups. It closes visits only: unreleased reservation/waitlist holds remain reserved on their own business date, CHECKED_IN reservations retain their status, and linked waitlist entries already closed as SEATED retain their closure metadata, version and WAITLIST_SEATED audit. There is no second waitlist cancellation or seating event at business-day end.

`AFTER_PAYMENT` is recognized but rejected because a trusted payment verifier is unavailable (`PAYMENT_VERIFICATION_UNAVAILABLE`). The API does not provide a payment-confirmation endpoint.

## Table turns — lượt khách (C2)

A table or a cluster earns **+1 turn** when both are true: it was `IN_USE`, and the receptionist completed Trả bàn.
Check-in records when the party sat down (`visits.started_at`); closing the visit is what closes the turn. Each turn is
its own row, so later statistics read history instead of recomputing it from live state.

The operating day is the venue's own, which turns over at the 05:00 cutoff: 00:30 on 12/11 belongs to the operating day
of **11/11**, and the badge resets when that day rolls over without deleting anything.

### Why a new table rather than `visits`

`visits` has the guest and the times, but no ordinal, no booking source, and no record of **which** tables or cluster
the party sat on — that lives in `table_allocations`, which is released on close and changes when a cluster is split.
Everything a turn needs is therefore snapshotted into `table_turns` at close time, so editing the booking or splitting
the cluster afterwards cannot rewrite what happened.

### ERD

```
venues ──1:N──> table_turns <──N:1── visits            (uq_turn_visit: one visit is one turn)
                     │ ▲
    dining_tables ───┘ └─── table_groups               (exactly one of table_id / group_id)
                     │
               reservations                            (nullable: a pure walk-in has none)

table_turns
  id                    PK
  organization_id, venue_id      FK venues (organization_id, id)
  business_date         DATE            operating day, 05:00 → 05:00
  scope                 'TABLE'|'GROUP'
  table_id              FK dining_tables (venue_id, id)   -- set when scope = TABLE
  group_id              FK table_groups  (venue_id, id)   -- set when scope = GROUP
  scope_key             GENERATED STORED = IF(scope='GROUP', group_id, table_id)
  turn_no               SMALLINT         ordinal within (venue, business_date, scope, scope_key)
  visit_id              FK visits (venue_id, id)
  reservation_id        FK reservations (venue_id, id), NULL for a walk-in
  table_codes_snapshot  JSON    ["B3","B4","B5"]
  member_table_ids      JSON    [101,102,103]
  group_code_snapshot   VARCHAR(24)  the cluster's mark at the time, NULL for a single table
  guest_name            VARCHAR(120)
  guest_count           SMALLINT
  source_code           VARCHAR(20)  booking source, NULL for a walk-in
  origin                'RESERVATION'|'WALK_IN'|'WAITLIST'
  seated_at             DATETIME(3)  giờ vào, from the visit
  released_at           DATETIME(3)  giờ ra, the instant the allocations carry
  end_reason            VARCHAR(20)
  completed_at          DATETIME(3)  NULL = recorded but not a served turn
  closed_by_user_id     FK users, NULL only for the business-day close
  created_at            DATETIME(3)

  UNIQUE uq_turn_visit    (venue_id, visit_id)
  UNIQUE uq_turn_ordinal  (venue_id, business_date, scope, scope_key, turn_no)
  KEY    ix_turn_badge    (venue_id, business_date, scope, scope_key, completed_at)
  KEY    ix_turn_range    (venue_id, business_date, id)
```

### Scope: one turn for a cluster, never one per table

A `LAYOUT` cluster has a lasting identity, so B3+B4+B5 earns **one** turn against the cluster. Anything else is counted
against a table: its own table when the party sat alone, or the **lowest member id** when the party sat on an ad-hoc
`CLAIM` grouping, whose id is discarded on close and so cannot carry an ordinal from one party to the next. That anchor
is the same cell the client already draws a cluster's badge on, so the number appears once either way.

### What counts

`completed_at` is the gate, not the row's existence:

| Close | Row written | Counted |
| --- | --- | --- |
| `GUEST_LEFT` (Trả bàn) | yes | **yes** |
| `ENTRY_ERROR` (sửa nhập sai) | yes | no |
| `BUSINESS_DAY_END` (worker cuối ca) | yes | no — see `[?]` below |
| A booking cancelled or marked No-show before check-in | no row at all | no |

A booking that never reached `IN_USE` writes nothing: the turn is written by the close path, which only runs on a visit.

### Idempotency and concurrency

`uq_turn_visit` makes one visit one turn, in the database rather than in a check this code performed first. A repeated
Close Visit is already refused by the visit's own state (`VISIT_ALREADY_CLOSED`); two devices closing the same visit at
once leave exactly one turn, because the loser's insert is refused by that key.

The ordinal is read **without** `FOR UPDATE` and the insert retries on a `uq_turn_ordinal` collision, up to six times.
A locking read took a gap lock on `table_turns` before the close path locks the venue row for `change_seq`, which let
two devices closing two unrelated visits deadlock; the retry keeps the guarantee without the lock. For the same reason
the turn is written **after** `nextVenueChangeSequence`, so concurrent closes serialise on the venue row first. It is
still the same transaction, so a rolled-back close leaves no turn.

### Badge on the floor

`GET /tables?date=` now returns `seatedTurnCount` on every table and on every group: completed turns for that operating
day. The client shows it from 1 and draws it once per cluster, on the cluster's anchor cell, so the number is never
multiplied by the member count. A member of a `LAYOUT` cluster reports the cluster's count, so the cell and the cluster
tile cannot disagree. Close Visit bumps `venues.change_seq`, which the SSE stream publishes, so every open device
refetches and the badge moves in well under two seconds — the count travels in the projection, never in the event.

A cluster that is split keeps its history: the old turns still name the original `group_id` and `group_code_snapshot`,
and they deliberately do **not** migrate to the now-single tables, whose badge is therefore 0.

### `GET /api/v1/visits/turns`

| Method | Path | Permission | Request | Response | Error codes |
| --- | --- | --- | --- | --- | --- |
| GET | `/visits/turns?from=&to=&page=&pageSize=&includeUncounted=` | `report.read` | query only | `{from,to,page,pageSize,total,completedTotal,guestTotal,turns:TurnView[]}` | `INVALID_BUSINESS_DATE`, `INVALID_DATE_RANGE`, `DATE_RANGE_TOO_WIDE`, `INVALID_PAGE`, `INVALID_PAGE_SIZE`, `INVALID_INCLUDE_UNCOUNTED`, `PERMISSION_DENIED` |

`from` and `to` are operating days, `YYYY-MM-DD`, inclusive, at most 366 days apart. `page` starts at 1, `pageSize` is
1–200 and defaults to 50. `includeUncounted=true` also returns the rows that do not count; the default returns only
served turns. `completedTotal` and `guestTotal` are totals for the whole range, not for the page.

It is gated on `report.read`, which **RECEPTIONIST does not hold**: a receptionist reads the badge from the floor
projection, not the statistics ledger. This endpoint exists for the statistics screen of a later sprint; no report
screen is built here.

```http
GET /api/v1/visits/turns?from=2026-11-11&to=2026-11-11
```

```json
{
  "from": "2026-11-11", "to": "2026-11-11", "page": 1, "pageSize": 50,
  "total": 1, "completedTotal": 1, "guestTotal": 12,
  "turns": [{
    "turnId": 31, "turnNo": 1, "businessDate": "2026-11-11",
    "scope": "GROUP", "groupCode": "◆A", "groupId": 101, "tableId": null,
    "tableCodes": ["B3", "B4", "B5"], "memberTableIds": [101, 102, 103],
    "guestName": "Đoàn 12 khách", "guestCount": 12,
    "sourceCode": "HOTLINE", "origin": "RESERVATION",
    "seatedAt": "2026-11-11T14:31:02.117Z", "releasedAt": "2026-11-11T16:04:55.903Z",
    "endReason": "GUEST_LEFT", "counted": true,
    "visitId": 77, "reservationId": 54
  }]
}
```

`POST /visits/:id/close` additionally answers `turn`, which is the turn the close recorded, or `null` when the visit
already had one:

```json
{"visit": {"id": 77, "status": "CLOSED", "releasedTables": [{"id":101,"code":"B3"}],
  "turn": {"turnId": 31, "scope": "GROUP", "turnNo": 1, "counted": true}}}
```

### Migration

`0018_table_turn_ledger.sql` creates `table_turns` and nothing else: no column is dropped, no row is updated or
deleted, and no existing behaviour changes shape. Migrations are forward-only (doc 10 §2). Apply with
`npm run db:migrate` from `Bar_management/api` with `DB_NAME` on the target database. Turns are not backfilled, because
a past visit's cluster membership and booking source can no longer be reconstructed truthfully — the ledger starts from
the first close after the migration, and that is deliberate rather than an omission.

Test and E2E databases must delete `table_turns` before `visits`, `reservations`, `dining_tables` and `table_groups`;
the shared fixtures and the per-file cleanups already do.

### Unconfirmed decisions

- `[?]` Whether Trả bàn counts as payment completed in the MVP. Applied as C7 of 01/11 describes, so a `GUEST_LEFT`
  close counts the turn; there is no payment verification behind it.
- `[?]` Whether the badge should reset at 17:00 rather than on the operating day. It currently follows the operating
  day, which turns over at the 05:00 cutoff that the rest of the system already uses.
- `[?]` Whether the end-of-shift auto-close should count as a served turn. It is recorded with `completed_at` null, so
  it is in the ledger but not in the badge; turning it on is a one-line change and needs no backfill.

### Testing

```powershell
cd Bar_management/api
$env:RUN_MYSQL_INTEGRATION='1'
$env:DB_NAME='gam21_platform_it_test'
$env:NODE_ENV='test'
npx vitest run test/table-turn.mysql.test.ts
```

`test/table-turn.mysql.test.ts` covers the eight recorded fields, a booking cancelled before check-in, the badge rising
per turn and resetting with the operating day, the 00:30 boundary, the date-range query with pagination and permission,
one turn for a cluster, a repeated and a concurrent close, distinct ordinals across two devices, history surviving a
split, Close Visit leaving a cluster standing, an entry correction and the end-of-shift close staying uncounted, and a
rolled-back close leaving nothing behind.

## Waitlist

| Method | Path | Permission | Request / response |
| --- | --- | --- | --- |
| GET | `/waitlist?date=YYYY-MM-DD` | `customer.view_masked` | `{businessDate,entries:WaitlistEntryView[]}` |
| POST | `/waitlist` | `waitlist.create` | Body WALK_IN `{kind?:"WALK_IN",guestName,partySize,businessDate,contactChannel,phoneNumber?,note?}` or ADVANCE `{kind:"ADVANCE_RESERVATION",reservationId,businessDate,contactChannel,note?}`; 201 `{entry}` |
| POST | `/waitlist/:id/seat` | `waitlist.accept_offer` + `reservation.create` + `table.assign`, plus `visit.walkin` when `arrived` is true | Body `{version,tableIds,arrived?}`; `{entry,reservationId,groupId}` where `reservationId` is null for an arrived Walk-in that creates a Visit without a reservation |
| POST | `/waitlist/:id/cancel` | `waitlist.cancel` | Body `{version,reasonCode,note?}`; `{entry}` |
| POST | `/waitlist/:id/contact-attempts` | `waitlist.record_contact` | Body `{version,channel,outcome,note?}`; `{entry}` |
| POST | `/waitlist/:id/call` | `booking.phone.call` | Empty object; 201 `{callId,targetKind,targetId,initiatedAt,telUri}` with `Cache-Control: no-store` |
| GET | `/waitlist/:id/calls` | `booking.phone.call` | `{calls}`, newest first, never a phone number |
| POST | `/waitlist/:id/calls/:callId/outcome` | `booking.phone.call` | Body `{outcome}`, only `CONTACTED` or `NO_ANSWER` |
| POST | `/visits/:id/call` | `booking.phone.call` | Empty object; 201 `{callId,targetKind,targetId,initiatedAt,telUri}` with `Cache-Control: no-store` |
| GET | `/visits/:id/calls` | `booking.phone.call` | `{calls}`, newest first, never a phone number |
| POST | `/visits/:id/calls/:callId/outcome` | `booking.phone.call` | Body `{outcome}`, only `CONTACTED` or `NO_ANSWER` |

`WaitlistEntryView` is `{id,kind,guestName,phoneLast3,partySize,businessDate,queuedAt,status,contactChannel,reservationId,reservationExpectedAt,visitId,note,version}`. `kind` is `ADVANCE_RESERVATION` or `WALK_IN`; omitted kind creates `WALK_IN`. Advance entries require a BOOKED reservation in the actor organization/venue on the same business date, without active holds or allocations; an existing non-terminal entry returns 409. Guest name and party size come from the reservation and must not be sent for advance entries. `reservationExpectedAt` is the ISO UTC appointment time for advance entries and null for walk-ins. Lists order by priority_class (advance before walk-in), queuedAt, then id. `status` is `WAITING`, `CONTACTING`, `OFFERED`, `HOLD_ACTIVE`, `SEATED`, `DECLINED` or `CANCELLED`. Only `phoneLast3` is returned. Optional WALK_IN `phoneNumber` uses the existing encrypted customer identity and duplicate checks. Phone numbers in creation notes are rejected.

Creation validates guest name (1-120), party size (1-500), date, channel and note (at most 500 characters). Its `contactChannel` values are `IN_PERSON`, `PHONE_CALLBACK`, `ZALO_THREAD`, `FANPAGE_THREAD`, `OTHER`. Creation, cancellation and contact-attempt notes are trimmed and reject phone numbers, including spaced, dotted and dashed forms, with 422 `PHONE_IN_NOTE_FORBIDDEN` before any repository mutation.

Seat supports WALK_IN entries in WAITING and ADVANCE_RESERVATION entries in WAITING, CONTACTING or OFFERED. Both lock the entry and tables, enforce same zone/type, bookable zone, capacity, ACTIVE/non-spare tables and same-date allocation conflicts. For a present WALK_IN, `{arrived:true}` is valid only on the current business date and atomically creates a Visit plus USAGE allocations (and a shared group for multiple tables), marks the entry SEATED, writes `WAITLIST_SEATED`, and increments venue `change_seq`; it does not create a reservation. Without `arrived:true`, WALK_IN creates a BOOKED reservation with classification UNCLASSIFIED; ADVANCE_RESERVATION reuses its BOOKED reservation (same business date, no existing active hold/allocation) and increments its version. Those booking paths create a RESERVATION hold, one HOLD allocation per table and a shared group for multiple tables, then mark the entry HOLD_ACTIVE and audit `WAITLIST_ASSIGNED_TO_RESERVATION`. Later normal booking check-in converts grouped holds to usage, creates the visit and closes the linked waitlist entry as SEATED with SEATED_OTHERWISE metadata and a `WAITLIST_SEATED` audit in the same transaction. `arrived:true` is rejected for ADVANCE_RESERVATION. Cancel/no-show of a reservation closes its open waitlist entry as RESERVATION_CANCELLED. All changes roll back together if auditing fails. No offer/hold automation is introduced.

Cancel supports all non-terminal statuses (`WAITING`, `CONTACTING`, `OFFERED`, `HOLD_ACTIVE`). Allowed `reasonCode` values from the existing schema are `CUSTOMER_DECLINED`, `CUSTOMER_WITHDREW`, `NO_SHOW_AFTER_ACCEPT`, `RESERVATION_CANCELLED`, `SEATED_OTHERWISE`, `DUPLICATE`, `ENTRY_ERROR`, `OTHER`. Note is optional, at most 300 characters. Cancellation clears a contact claim and explicitly releases the entry's active waitlist hold/allocations, dissolves unused groups, records closure metadata and bumps the entry version. Cancelling a booking-linked entry does not cancel the reservation. Audit `WAITLIST_CANCELLED` and all domain changes commit together.

Contact recording uses the existing `waitlist_contact_attempts` table. Its channel values differ from creation: `IN_PERSON`, `PHONE_BY_AUTHORIZED`, `ZALO_THREAD`, `FANPAGE_THREAD`, `OTHER`. Outcomes are `NO_ANSWER`, `CALLBACK_REQUESTED`, `OFFER_PENDING`, `ACCEPTED`, `DECLINED_OFFER`, `KEEP_WAITING`, `WITHDREW`, `WRONG_CONTACT`. Note is optional, at most 300 characters. The entry lock serializes attempt numbering; each completed attempt records the authenticated user, server timestamps, channel/outcome/note, bumps entry version and writes `WAITLIST_CONTACT_RECORDED` atomically. Recording an outcome does not change entry status or create an offer, hold or visit. Terminal entries reject both mutations with 409 `WAITLIST_TERMINAL`; stale versions return 409 `VERSION_CONFLICT` first. Unknown/out-of-scope entries return 404 `WAITLIST_NOT_FOUND`.

## Operations (undo/redo)

| Method | Path | Permission | Request / response |
| --- | --- | --- | --- |
| GET | `/operations/undo-state` | `operation.undo` | `{undo,redo}`, each null or `{operationId,action,summary}` |
| POST | `/operations/undo` | `operation.undo` | Body `{operationId}`; `{operationId,changeSeq,summary,undoable}` |
| POST | `/operations/redo` | `operation.undo` | Body `{operationId}`; same shape |

Undo is a compensating mutation with its own audit row; nothing is deleted and no past audit row is rewritten. Only the
single latest `operation_log` row of the caller's organization, venue and server-side `auth_session_id` is eligible, so
a device undoes only its own last step and never another device's. The device is resolved from the authenticated
session, never from the body or client storage. Only table reassignment and merge for a booking or a visit are
undoable; everything else answers `NOT_UNDOABLE`. The entity version and its complete active table set must still match
the recorded operation, and the restored tables are re-validated under lock, otherwise `UNDO_CONFLICT_MODIFIED`. Other
errors are `NOT_LATEST_DEVICE_OPERATION`, `UNDO_SESSION_REQUIRED`, `REDO_REQUIRED`, `UNDO_REQUIRED` and
`INSUFFICIENT_TABLE_CAPACITY`. Both mutations accept `Idempotency-Key` and advance the venue `change_seq`. How many
steps may be undone and any time window remain open with the PO; the API exposes only the session's current step.

## Accounts

| Method | Path | Permission | Request / response |
| --- | --- | --- | --- |
| GET | `/accounts` | `user.manage` | `{accounts:AccountSummary[],roles:[{code,name}]}` |
| POST | `/accounts` | `user.manage` | Body `{username,displayName,password,roleCode}`; 201 `{account}` |
| POST | `/accounts/:id/status` | `user.manage` | Body `{version,status:"ACTIVE"\|"DISABLED"}`; `{account,revokedSessions}` |

`user.manage` is sensitive and granted to `OWNER_ADMIN` only. `AccountSummary` is
`{id,username,displayName,status,membershipStatus,roles,lastLoginAt,version}`; no password, hash or customer data is
ever returned. Listing is scoped to the caller's organization and reports the roles effective at its venue, and
`roles` offers only the four roles the baseline seeds, so an unseeded code is rejected `ROLE_NOT_FOUND`. Creating an
account inserts the user, its membership and one role grant in one transaction, hashing the password with the existing
scrypt helper; the limits are username 80, display name 120 and password at least 12 characters (`WEAK_PASSWORD`,
`USERNAME_TAKEN`). Locking requires the current version and revokes every live session of that account with reason
`ACCOUNT_LOCKED`; `authenticateSession` re-checks user and membership status on every request, so a lock also takes
effect immediately on its own. An admin cannot lock itself (`CANNOT_LOCK_SELF`) and the last active admin is protected
(`LAST_ADMIN_PROTECTED`). Account changes audit on `entity_type = 'user'` with `is_undoable = 0` and deliberately do
not advance `change_seq`, because they are not floor state. Changing an existing account's role, resetting a password,
viewing another account's screen, and the SuperAdmin / view-only Admin levels are not implemented: the owner deferred
the admin RBAC model, so no role is created here.

## Unavailable capabilities

There are no implemented endpoints for customer search/profile/notes, operation-log listing, reports, zone flags, hold deadlines/releases, booking statistics as JSON, waitlist claim/release-claim, or standalone visits/allocations lists. Undo/redo, the table-group endpoints (merge, add members, dissolve, split), the floor SSE stream, the table-turn ledger read, venue configuration and account management do exist and are documented above. The turn ledger is a read for a later statistics screen; no report screen exists. A catalog exposing lease/hold configuration does not imply that those write APIs exist. Unknown routes return 404; HTTP adapters may expose these unavailable methods as explicit 501 `NOT_SUPPORTED_BY_BACKEND` errors. Direct table-state writes and payment-verified closing have the restrictions described above.

## Verification

Run from `Bar_management/api`:

```powershell
pnpm typecheck
pnpm lint
$env:DB_NAME='gam21_platform_it_test'
$env:RUN_MYSQL_INTEGRATION='1'
npx vitest run --no-file-parallelism
```

The test setup refuses any other database when MySQL integration is enabled. It generates throwaway encryption/HMAC keys and an explicit reveal rate-limit policy before application imports. No deployment phone key or `.env` edit is needed. Fixtures are destructive and belong only to the isolated, migrated integration database. Never run them against the development database.

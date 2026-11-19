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
- The authenticated `GET /tables/stream` SSE endpoint carries only a venue change cursor. Clients refetch protected
  projections after a frame and retain their 15-second poll as fallback.

Errors use:

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "Booking vừa được thay đổi. Vui lòng tải lại."
  }
}
```

Common status codes: 400 `INVALID_*` validation, 401 `AUTHENTICATION_REQUIRED` / `SESSION_REPLACED` /
`SESSION_EXPIRED` / `SESSION_REVOKED` / `ACCOUNT_LOCKED` / `SESSION_INVALID`, 403 `PERMISSION_DENIED` /
`CSRF_TOKEN_INVALID` / `ORIGIN_NOT_ALLOWED`, 404 entity not found in the actor's scope, 409 stale version or allocation
conflict, 422 `INVALID_PHONE_NUMBER` / `BOOKING_PHONE_UNAVAILABLE`, 429 rate limit, 503
`PHONE_*_UNAVAILABLE`. Duplicate keys map to `RESOURCE_CONFLICT`; database deadlocks/lock timeouts map to
`CONCURRENT_UPDATE_RETRY`. Internal failures return a generic 500 without SQL or secrets.

## Health and session

| Method | Path                        | Access                            | Response                                                                                                      |
| ------ | --------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| GET    | `/health`                   | Public                            | `{ok:true}`; process liveness, not a database check                                                           |
| POST   | `/auth/login`               | Trusted origin                    | Body `{username,password,portal}`; returns `{user,permissions,csrfToken,portal,expiresAt}` and session cookie |
| GET    | `/auth/me`                  | Session                           | `{user,permissions,csrfToken,portal}`                                                                         |
| POST   | `/auth/logout`              | Session + CSRF                    | 204, no body                                                                                                  |
| GET    | `/auth/sessions`            | Session + `session.read`          | `{sessions:[...]}`; các phiên đang hoạt động trong organization (TU-33)                                       |
| POST   | `/auth/sessions/:id/revoke` | Session + CSRF + `session.revoke` | `{revokedSessions,targetUserId}`; buộc đăng xuất một phiên (TU-33)                                            |

`portal` is one of `admin`, `receptionist`, `customer-care`, `cashier` or `waiter`. The server verifies the password before checking portal eligibility, creates no session for a denied portal and stores the verified portal on the server-side session. Mapping is `admin → OWNER | ADMIN`, `receptionist → RECEPTIONIST`, `customer-care → CUSTOMER_CARE`, `cashier → CASHIER`, `waiter → WAITER`. The mapping lives in one place (`PORTAL_ROLE_CODES` in `api/src/auth/auth-portal.ts`) and the session-validation SQL is generated from it, so login and session checks cannot disagree about which roles a portal accepts. ADMIN must have access level `WRITE` or `READ_ONLY` on its active venue grant. A multi-role account receives only roles and permissions mapped to the selected portal; the request value never grants a role. Changing a client URL cannot change the session portal. Invalid portal is `INVALID_PORTAL` (400); valid credentials at a disallowed portal are `PORTAL_ACCESS_DENIED` (403).

`user` contains `{id,username,displayName,organizationId,venueId,roles,accessLevel}`; `accessLevel` is `WRITE`, `READ_ONLY`, or `null` for non-ADMIN roles. `roles` contains only active role codes eligible for the session portal and venue. Raw session tokens are never included in JSON. Login is limited after five failed credential attempts for the same IP/username in a 15-minute window. `/auth/me` restores the same portal after refresh. Disabled users, suspended memberships, expired/revoked sessions, or revocation of the last role eligible for the session portal make the next authenticated request return 401. Logout revokes the database session and clears the HttpOnly cookie. Migration `0012_add_auth_session_portal.sql` revokes legacy active sessions that had no server-verified portal instead of assigning one heuristically.

### Single Active Session

Each account has at most one valid session across all portals and devices. After credentials and portal eligibility pass,
login starts a transaction, locks the `users` row with `SELECT ... FOR UPDATE`, rechecks the active user, membership,
venue and portal role, revokes every unexpired active session with reason `SESSION_REPLACED`, inserts the new hashed
session and commits. The cookie is sent only after commit. Concurrent logins therefore serialize on the same user row;
the session from the transaction committed last is the only valid one. A wrong password, invalid portal or denied
portal returns before the replacement transaction and does not affect the current session. Refresh and multiple tabs
reuse the same cookie and do not create a session. A logout request carrying a replaced cookie receives 401 and cannot
revoke the newer session.

The cookie contains the raw random session token and is `HttpOnly`, `SameSite` from
`SESSION_COOKIE_SAME_SITE`, `Secure` when configured (mandatory in production), scoped to `/api/v1`, and expires with
the server session TTL. The database stores only SHA-256 of that token. CSRF remains an in-memory client value derived
from the session; neither token is stored in browser local storage or sent in a URL.

Session failures are based on the current database row, not client claims:

| Code               | Meaning                                                     | Vietnamese message                                                                           |
| ------------------ | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `SESSION_REPLACED` | A later successful login replaced this session              | `Tài khoản này vừa được đăng nhập trên thiết bị khác. Phiên đăng nhập hiện tại đã kết thúc.` |
| `SESSION_EXPIRED`  | `expires_at` has passed                                     | `Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.`                                        |
| `SESSION_REVOKED`  | Logout, role/membership loss or another explicit revocation | `Phiên đăng nhập đã bị thu hồi. Vui lòng đăng nhập lại.`                                     |
| `ACCOUNT_LOCKED`   | User is disabled or the session was revoked by account lock | `Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.`                                      |
| `SESSION_INVALID`  | No matching server-side session or malformed legacy state   | `Phiên đăng nhập không hợp lệ.`                                                              |

Example replaced-session response:

```json
{
  "error": {
    "code": "SESSION_REPLACED",
    "message": "Tài khoản này vừa được đăng nhập trên thiết bị khác. Phiên đăng nhập hiện tại đã kết thúc."
  }
}
```

The web client clears the in-memory principal, permissions and CSRF state, closes its mounted SSE subscription and
returns to the matching portal login. It does not refresh or automatically log in a replaced session. A failed
`POST /auth/login` deliberately does not trigger the global protected-request 401 handler, so it cannot clear a valid
session. Login success/failure, replacement, logout and session revocation write redacted `operation_log` events; no
username, password/hash, raw token, cookie, IP or customer PII is included. Audit write failure is reported server-side
but never exposes secrets or corrupts the session transaction.

### Sáu cấp tài khoản (TU-32)

Biên bản họp 15/11/2026 mô tả sáu cấp nghiệp vụ. Chúng ánh xạ vào **sáu role database**, trong đó ba cấp quản trị dùng
hai role cộng với `access_level` — không tạo ba role riêng chỉ vì nghiệp vụ có ba cấp.

| Cấp | Vai trò nghiệp vụ | Role + access level   | Cổng đăng nhập |
| --- | ----------------- | --------------------- | -------------- |
| 1   | SuperAdmin        | `OWNER`               | `/admin`       |
| 2   | Admin Edit        | `ADMIN` + `WRITE`     | `/admin`       |
| 3   | Admin Read-Only   | `ADMIN` + `READ_ONLY` | `/admin`       |
| 4   | Lễ tân            | `RECEPTIONIST`        | `/letan`       |
| 5   | Thu ngân          | `CASHIER`             | `/thungan`     |
| 6   | Phục vụ           | `WAITER`              | `/phucvu`      |

`CUSTOMER_CARE` vẫn tồn tại cùng toàn bộ membership của nó tại cổng `/customer-care`. Biên bản không nhắc tới vai trò
này, và "không nhắc tới" không phải là "bỏ đi".

**URL và mã portal là hai lớp khác nhau.** URL công bố cho nhân viên là tiếng Việt; mã portal gửi lên API và lưu trong
`auth_sessions.portal` vẫn là tiếng Anh (`receptionist`, `cashier`, `waiter`). Lý do: giá trị portal đã nằm trong
database dưới CHECK constraint `ck_auth_sessions_portal`, nên đổi nó sẽ làm mọi session đang mở không khớp constraint và
đẩy toàn bộ nhân viên ra khỏi hệ thống giữa ca. URL tiếng Anh cũ (`/receptionist/login`, `/cashier`, …) vẫn mở được và
được redirect về URL tiếng Việt; backend luôn kiểm portal-role mapping, nên một URL alias không cấp thêm quyền gì.

Migration `0027_waiter_role_and_order_permissions.sql` thêm role `WAITER`, ba permission `order.create`, `order.read`,
`payment.collect`, và nới `ck_auth_sessions_portal` để nhận `waiter`.

**Ba permission order/payment là giàn giáo phân quyền, không phải nghiệp vụ đã có.** Module order chưa tồn tại trong
repository này và không có endpoint nào đang dùng chúng. Chúng được tạo trước để route guard của module order tương lai
có chỗ neo, và để bảng role × permission phản ánh đúng sáu cấp.

Grants của ba permission mới:

| Permission        | OWNER | ADMIN                   | CASHIER | WAITER    | RECEPTIONIST | CUSTOMER_CARE |
| ----------------- | ----- | ----------------------- | ------- | --------- | ------------ | ------------- |
| `order.create`    | Có    | Có (chỉ WRITE ghi được) | Có      | Có        | Không        | Không         |
| `order.read`      | Có    | Có                      | Có      | Có        | Không        | Không         |
| `payment.collect` | Có    | Có (chỉ WRITE ghi được) | Có      | **Không** | Không        | Không         |

Phục vụ không có `payment.collect` và không có `visit.mark_paid`: cấp 6 gọi món và xem trạng thái chờ thanh toán, không
chốt thanh toán. Phục vụ cũng không có `customer.view_masked`, nên không thấy cả ba số cuối SĐT — biên bản không cấp cho
Phục vụ quyền nào về khách hàng.

Số permission sau 0027 và 0028: 36 cho `OWNER`, 34 cho `ADMIN` (= 36 trừ `venue.configure` và `customer.anonymize`),
23 `RECEPTIONIST`, 7 `CUSTOMER_CARE`, 6 `CASHIER`, 2 `WAITER`.

### Quản lý thiết bị và phiên (TU-33)

Cơ chế Single Active Session không đổi. TU-33 thêm phần nhìn và điều khiển các phiên đó.

Migration `0028_session_device_management.sql` thêm `auth_sessions.device_id` và hai permission `session.read`,
`session.revoke`.

**Định danh thiết bị.** Client sinh một mã ngẫu nhiên, lưu trong `localStorage`, gửi ở header `X-Device-Id`. Mã không
hợp lệ hoặc thiếu thì server tự sinh một mã mới chứ không từ chối đăng nhập.

`device_id` **không bao giờ là yếu tố xác thực**: client tự khai nó nên nó chỉ đáng tin ở mức "cùng một trình duyệt".
Quyền truy cập vẫn do cookie session quyết định. Cố ý không dùng IP (toàn quán đi ra bằng một IP NAT, và một điện thoại
chuyển wifi sang 4G lại đổi IP giữa ca) và cố ý không dùng browser fingerprinting.

`device_label` lưu nhãn rút gọn kiểu `Chrome trên Android`, không lưu nguyên User-Agent: nhân viên chỉ cần nhận ra máy
nào là máy mình.

`GET /auth/sessions` trả mỗi phiên dạng:

```json
{
  "sessions": [
    {
      "sessionId": 41,
      "userId": 9874,
      "username": "letan01",
      "displayName": "Lễ tân 1",
      "roles": ["RECEPTIONIST"],
      "accessLevel": null,
      "portal": "receptionist",
      "deviceRef": "letan-ta",
      "deviceLabel": "Chrome trên Android",
      "loggedInAt": "2026-11-18T12:00:00.000Z",
      "lastSeenAt": "2026-11-18T12:04:31.000Z",
      "expiresAt": "2026-11-19T00:00:00.000Z",
      "status": "ACTIVE",
      "isCurrent": false
    }
  ]
}
```

`deviceRef` là 8 ký tự đầu của `device_id`. Response gửi kèm `Cache-Control: no-store` và **không bao giờ** chứa
`token_hash` hay token thật. `lastSeenAt` được cập nhật có tiết lưu (mặc định 60 giây một lần) ngoài đường đi của
request, nên nó là thông tin phụ trợ chứ không phải nguồn trạng thái xác thực.

**Hai quyền tách biệt.** `session.read` là chẩn đoán; `session.revoke` đẩy một nhân viên ra khỏi hệ thống giữa ca. Admin
Read-Only có `session.read` nhưng không có `session.revoke`.

Thẩm quyền của `POST /auth/sessions/:id/revoke`, kiểm trong transaction tại repository chứ không chỉ ở middleware:

| Tình huống                                | Kết quả                                        |
| ----------------------------------------- | ---------------------------------------------- |
| OWNER buộc đăng xuất ADMIN hoặc nhân viên | 200                                            |
| ADMIN WRITE buộc đăng xuất nhân viên      | 200                                            |
| ADMIN buộc đăng xuất OWNER                | 403 `OWNER_PROTECTED`                          |
| ADMIN buộc đăng xuất ADMIN khác           | 403 `ADMIN_TARGET_DENIED`                      |
| ADMIN READ_ONLY buộc đăng xuất bất kỳ ai  | 403                                            |
| Nhân viên buộc đăng xuất bất kỳ ai        | 403 `PERMISSION_DENIED`                        |
| Buộc đăng xuất phiên của chính mình       | 409 `CANNOT_REVOKE_SELF` (dùng `/auth/logout`) |
| Phiên đã bị thu hồi                       | 409 `SESSION_ALREADY_REVOKED`                  |
| Phiên không tồn tại trong organization    | 404 `SESSION_NOT_FOUND`                        |

Phiên bị thu hồi mang `revoke_reason = 'FORCED_LOGOUT'`, SSE của nó bị đóng ngay sau commit, và nó không tự khôi phục.

**Audit.** `AUTH_SESSION_FORCE_REVOKED` ghi `actor_user_id` là người **thực hiện** và `entity_id` là người **bị tác
động**, kèm `revokedDeviceRef`. `AUTH_SESSION_REVOKED` của luồng thay thế phiên ghi thêm `replacedDevices` và
`newDeviceRef`. Không bản ghi nào chứa token, cookie, mật khẩu hay User-Agent gốc.

**Khởi động lại API không làm ai bị đăng xuất.** Nguồn trạng thái phiên là bảng `auth_sessions`; không có phiên hợp lệ
nào chỉ tồn tại trong bộ nhớ process. `notifySessionsRevoked` chỉ là đường đóng SSE sớm hơn, không phải nơi lưu trạng
thái.

**Dữ liệu chưa lưu.** Hệ thống chưa có cơ chế lưu nháp. Khi một phiên bị thay thế hoặc bị buộc đăng xuất, nội dung đang
gõ dở trong form là mất, và trang đăng nhập nói đúng điều đó thay vì để nhân viên tự suy ra rằng dữ liệu còn. Booking đã
lưu trước đó không bị ảnh hưởng.

### OWNER and ADMIN access model

Migration `0024_owner_admin_access_model.sql` renames the existing `OWNER_ADMIN` role row to `OWNER` in place, preserving its role id and every membership foreign key. It adds role `ADMIN`, nullable `membership_roles.access_level` constrained to `WRITE | READ_ONLY`, and permission `user.read`. It does not create `SUPER_ADMIN`, separate editor/viewer roles, or new staff roles.

| Role / level    | Admin portal | Business mutation             | Account administration                                             | Full phone                                        | Venue configuration |
| --------------- | ------------ | ----------------------------- | ------------------------------------------------------------------ | ------------------------------------------------- | ------------------- |
| OWNER           | Yes          | Yes                           | Create/manage ADMIN and staff; change ADMIN level; reset passwords | Yes                                               | Yes                 |
| ADMIN WRITE     | Yes          | Yes                           | Create/manage/reset staff only                                     | Yes                                               | No                  |
| ADMIN READ_ONLY | Yes          | No                            | Read scoped account list; may change own password                  | Yes                                               | No                  |
| RECEPTIONIST    | No           | Existing receptionist matrix  | No                                                                 | Last three digits only; call permission unchanged | No                  |
| CUSTOMER_CARE   | No           | Existing customer-care matrix | No                                                                 | Last three digits only                            | No                  |
| CASHIER         | No           | Existing cashier matrix       | No                                                                 | Last three digits only                            | No                  |
| WAITER          | No           | Order only (TU-32)            | No                                                                 | None, not even the last three digits              | No                  |

ADMIN grants are resolved on every request. For `READ_ONLY`, the backend returns only `customer.view_masked`, both explicit phone-reveal permissions, `audit.read`, `report.read`, `user.read`, `session.read` and `order.read`; mutation permissions are removed. UI state is advisory and never bypasses this server calculation. Changing an ADMIN access level revokes every existing session with `ACCESS_LEVEL_CHANGED`, so an old session cannot retain WRITE authority or keep an SSE subscription.

## Venue settings

| Method | Path        | Access                             | Request / response                                                  |
| ------ | ----------- | ---------------------------------- | ------------------------------------------------------------------- |
| GET    | `/settings` | Authenticated session              | `{quickTimes:string[],upcomingMinutes:number,noShowMinutes:number}` |
| PUT    | `/settings` | Session + CSRF + `venue.configure` | Full body and response use the same camelCase shape                 |

Both endpoints derive organization and venue exclusively from the authenticated actor. There is no venue selector in the URL or body. `GET` is read-only, sends `Cache-Control: no-store`, never initializes missing rows and uses `['21:00','21:30','22:00','22:30']` only as the fallback when the venue has no valid `quick_times` row. The existing `GET /venues/:id/settings` compatibility endpoint and its snake_case wrapper remain unchanged.

`PUT` requires exactly `quickTimes`, `upcomingMinutes` and `noShowMinutes`; unknown or missing fields return 400. `quickTimes` contains 1–24 unique `HH:mm` values inside 19:00–01:00 inclusive. `upcomingMinutes` is an integer from 1 through 240. `noShowMinutes` is an unsigned-smallint value and must also remain greater than the venue's unchanged `late_warning_minutes`. Invalid settings use `INVALID_SETTINGS_PAYLOAD`, `INVALID_QUICK_TIMES`, `INVALID_UPCOMING_MINUTES` or `INVALID_NO_SHOW_MINUTES`. Only OWNER receives `venue.configure`; ADMIN and staff receive 403.

The update locks the venue and writes `venue_settings.quick_times`, `venues.upcoming_warning_minutes`, `venues.no_show_warning_minutes`, the venue version/change sequence and a redacted `VENUE_SETTINGS_UPDATED` audit in one transaction. `late_warning_minutes` is not modified. Failure of any write rolls everything back. Other venues are unaffected. Each committed update bumps `change_seq`; current floor polling and the settings query's 15-second polling refetch server-derived state without introducing another realtime channel. The booking forms show the database quick times as shortcuts and never replace the time already entered by the user. The pickers offer the slots the API accepts, which is the 15-minute step described under Transport while Q03 is open; they do not offer a 30-minute-only list.

Floor Projection and booking views continue to read thresholds directly from `venues`. Changing `upcomingMinutes` therefore changes the server-side `UPCOMING` boundary; it no longer moves any calling boundary, because `canCall` depends only on whether a phone is stored. Changing `noShowMinutes` changes the visual no-show warning and the TU-12 cutoff. It never automatically changes the persisted booking to `NO_SHOW`, cancels a hold or releases a table; manual no-show behavior remains authoritative.

## Tables and catalog

| Method | Path                        | Permission                            | Request / response                                                                                                                                                                                                                               |
| ------ | --------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/tables/catalog`           | `customer.view_masked`                | `{venue,zones,tables,combinations}`                                                                                                                                                                                                              |
| GET    | `/tables?date=YYYY-MM-DD`   | `customer.view_masked`                | Atomic `{businessDate,serverNow,changeSeq,tables:FloorTableProjection[],groups:FloorGroupProjection[]}`                                                                                                                                          |
| PATCH  | `/tables/:id/status`        | `table.assign`                        | Body `{businessDate,state,expectedVersion?,reason?}`; see limitation below                                                                                                                                                                       |
| PATCH  | `/tables/:id/configuration` | `venue.configure`                     | Body `{isSpare?:boolean,status?:"ACTIVE"                                                                                                                                                                                                         | "OUT_OF_SERVICE",version,reason}`; returns `{table:{id,code,isBackup,status,version}}` |
| POST   | `/tables/groups/:id/split`  | `table.group.manage` or `visit.split` | Body `{keepTableIds}`, or `{version,mode:"ALL_TO_SINGLE"}` to dissolve a cluster; `{operationId,changeSeq,summary,undoable:false,splitGroupId,group,keptTableIds,releasedTableIds,owner}`. See **Table groups** below for the cluster endpoints. |

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

The endpoint performs two fixed-count reads inside one read-only `REPEATABLE READ` transaction. `serverNow` is the application clock instant used for every derived state and `changeSeq` is returned as a decimal string. Groups use persisted IDs and symbol numbers; display codes are zero-padded group numbers (`1 => G01`, `26 => G26`, `50 => G50`). The legacy `state` and `activeVisit` fields remain during rollout, but `activeVisit.note` is always null. GET has no lifecycle write side effects.

Catalog venue fields include `id,version,name,timezone,businessDayStartLocal,businessDayCutoffLocal,upcomingWarningMinutes,lateWarningMinutes,noShowWarningMinutes,waitlistHoldDefaultMinutes,waitlistClaimLeaseSeconds,reservationHoldPolicy,reservationWindowMinutes,groupSymbolCount,changeSeq`. The centralized arrival defaults are 10/15/30 minutes. Zones contain `id,version,code,name,isBookable,isWaitingArea`. Catalog tables contain `id,version,code,displayName,zoneId,zoneCode,kind,capacity,seqNo,isSpare,status,x,y,width,height`. Combinations contain `id,code,displayName,memberIds,capacity`.

**Direct status changes are unsupported in v1.** The status route accepts `AVAILABLE`, `RESERVED` or `IN_USE`, verifies table organization/venue (404 outside scope), checks `expectedVersion` if present (409 `VERSION_CONFLICT`), then returns 409 `TABLE_STATE_DERIVED`. It never creates an allocation, modifies the table or writes a mutation audit event. Use assign, check-in, move and close instead. Use the owner-only configuration route for manual `OUT_OF_SERVICE` / `ACTIVE` changes.

Spare configuration is persistent rather than per-day. `reason` is required, at most 500 characters. Provide at least one of `isSpare` or `status`; status supports `ACTIVE` and `OUT_OF_SERVICE`. The table must have no unreleased allocations (holds or visits, on any date), and at least one supplied value must change. `venue.configure` is granted only to OWNER. Successful configuration changes audit the actor and bump the table version. Sending `isBackup` to the status route returns 400 `FIXED_SPARE_TABLE`.

## Table groups — cụm bàn (C1)

A cluster of merged tables is part of the **floor layout**, not part of a booking. A receptionist merges two or more
tables before anyone has booked or arrived, and the cluster lives until a receptionist splits it. Three states stay
separate and nothing here conflates them: **layout** (single table, or member of a cluster — this section),
**operation** (empty / booked / in use — `table_allocations`, unchanged) and **history** (the bookings and visits that
happened — append-only, never rewritten by a layout change).

| Method | Path                                   | Permission                            | Request                                                                                                  | Response                                                                                                              | Error codes                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------ | -------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/tables/groups?includeDissolved=true` | `customer.view_masked`                | —                                                                                                        | `{groups:LayoutGroupView[]}`                                                                                          | —                                                                                                                                                                                                                                                                                                                                                                                                                |
| GET    | `/tables/groups/:id`                   | `customer.view_masked`                | —                                                                                                        | `{group:LayoutGroupView}`                                                                                             | `INVALID_GROUP_ID`, `TABLE_GROUP_NOT_FOUND`                                                                                                                                                                                                                                                                                                                                                                      |
| POST   | `/tables/groups`                       | `table.group.manage`                  | `{tableCodes:["B3","B4","B5"]}` or `{tableIds:[101,102,103]}`, optional `name`, `spareOverrideConfirmed` | 201 `{operationId,changeSeq,summary,undoable:false,group:LayoutGroupView}`                                            | `INVALID_TABLE_CODES`, `DUPLICATE_TABLE_CODE`, `MERGE_REQUIRES_MULTIPLE_TABLES`, `TABLE_NOT_FOUND`, `TABLE_ALREADY_GROUPED`, `SPARE_TABLE_OVERRIDE_REQUIRED`, `INVALID_SPARE_OVERRIDE`, `ZONE_NOT_BOOKABLE`, `TABLE_KIND_MISMATCH`, `CROSS_ZONE_MERGE_DISABLED`, `TABLE_NOT_ADJACENT`, `TABLE_GROUP_MIXED_STATE`, `TABLE_GROUP_MULTIPLE_CLAIMS`, `TABLE_GROUP_CONFLICT`, `GROUP_SYMBOL_UNAVAILABLE`, `FORBIDDEN` |
| POST   | `/tables/groups/:id/members`           | `table.group.manage`                  | `{version, tableCodes                                                                                    | tableIds}`, optional `spareOverrideConfirmed`                                                                         | `{operationId,changeSeq,summary,undoable:false,group:LayoutGroupView}`                                                                                                                                                                                                                                                                                                                                           | as POST `/tables/groups`, plus `INVALID_VERSION`, `TABLE_GROUP_VERSION_CONFLICT`, `TABLE_GROUP_ALREADY_DISSOLVED`, `TABLE_ASSIGNMENT_UNCHANGED` |
| POST   | `/tables/groups/:id/dissolve`          | `table.group.manage`                  | `{}` or `{version}`                                                                                      | `{operationId,changeSeq,summary,undoable:false,groupId,groupCode,status:"DISSOLVED",releasedTableIds,releasedTables}` | `INVALID_GROUP_ID`, `TABLE_GROUP_NOT_FOUND`, `TABLE_GROUP_ALREADY_DISSOLVED`, `TABLE_GROUP_IN_USE`, `TABLE_GROUP_VERSION_CONFLICT`, `TABLE_GROUP_CONFLICT`, `FORBIDDEN`                                                                                                                                                                                                                                          |
| POST   | `/tables/groups/:id/split`             | `table.group.manage` or `visit.split` | `{keepTableIds}` **or** `{version, mode:"ALL_TO_SINGLE"}`                                                | the BA-021 split result, or the dissolve result for `ALL_TO_SINGLE`                                                   | BA-021 codes below, plus `INVALID_SPLIT_MODE` and the dissolve codes                                                                                                                                                                                                                                                                                                                                             |
| GET    | `/tables/stream`                       | `customer.view_masked`                | —                                                                                                        | `text/event-stream`                                                                                                   | —                                                                                                                                                                                                                                                                                                                                                                                                                |

`mode:"ALL_TO_SINGLE"` is the shipped client's spelling of Tách bàn on a cluster and delegates to the same dissolve
implementation, so the two paths cannot drift apart. A body with neither `mode` nor `keepTableIds` still answers
`TABLES_REQUIRED`.

`LayoutGroupView` is `{groupId,groupCode,symbolNo,displayCode,name,status,version,zoneId,tableIds,tableCodes,
tables:[{id,code,capacity}],totalCapacity,formedAt,dissolvedAt,inUseBy}`. `groupCode` is `TG-<groupId>`; `displayCode`
is the floor mark (`1 => G01`); turns closed before this change kept the older `◆A` form in `group_code_snapshot` and the clients normalise it on read. `status` is `ACTIVE` or `DISSOLVED`. `totalCapacity` is summed from the
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
  "summary": "Đã ghép B3 + B4 + B5 thành cụm G01 (12 chỗ).",
  "undoable": false,
  "group": {
    "groupId": 101,
    "groupCode": "TG-101",
    "symbolNo": 1,
    "displayCode": "G01",
    "name": "G01",
    "status": "ACTIVE",
    "version": 1,
    "zoneId": 2,
    "tableIds": [101, 102, 103],
    "tableCodes": ["B3", "B4", "B5"],
    "tables": [
      { "id": 101, "code": "B3", "capacity": 4 },
      { "id": 102, "code": "B4", "capacity": 4 },
      { "id": 103, "code": "B5", "capacity": 4 }
    ],
    "totalCapacity": 12,
    "formedAt": "2026-11-10T13:02:11.421Z",
    "dissolvedAt": null,
    "inUseBy": null
  }
}
```

```http
POST /api/v1/tables/groups/101/dissolve
{"version":1}
```

```json
{
  "operationId": 418,
  "changeSeq": 1891,
  "undoable": false,
  "summary": "Đã tách cụm G01, trả lại B3, B4, B5.",
  "groupId": 101,
  "groupCode": "TG-101",
  "status": "DISSOLVED",
  "releasedTableIds": [101, 102, 103],
  "releasedTables": ["B3", "B4", "B5"]
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

Every connection is bound to the authenticated server-side session ID established by the handshake. Before each
`floor-changed` frame, the server re-reads the session/account/portal role and rechecks `customer.view_masked`; a lost
session never receives that protected frame. Replacement, logout and account lock also publish an in-process revocation
notice immediately after their database commit, closing matching streams without waiting for the heartbeat. Expiry or
an out-of-process database revocation is detected by the same pre-event check and by the periodic heartbeat validation.
The final non-PII frame is `event: session-ended` with one of the documented session error codes, after which the server
ends the connection. Reconnect performs the complete HTTP authentication and permission middleware again. The browser
closes native `EventSource` on an error instead of allowing an authentication failure to create an infinite retry loop;
protected polling remains the fallback and surfaces the exact 401 code.

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
- Permission `table.group.manage` is granted to OWNER, ADMIN WRITE, and RECEPTIONIST. ADMIN READ_ONLY loses it during per-request permission resolution.

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

| Method | Path                                         | Permission                                              | Request / response                                                                                                                                                      |
| ------ | -------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/bookings?date=YYYY-MM-DD`                  | `customer.view_masked`                                  | `{businessDate,bookings:BookingView[]}`                                                                                                                                 |
| GET    | `/bookings/sources`                          | `customer.view_masked`                                  | `{sources:[{code,name}]}`; active organization sources                                                                                                                  |
| GET    | `/bookings/search?date=YYYY-MM-DD&last3=123` | `customer.view_masked`                                  | Fast reception search: exact last 3 digits, scoped to session venue/date; returns masked booking/waitlist matches, real assigned `tableIds`, and a deduplicated summary |
| GET    | `/bookings/search?date=YYYY-MM-DD&name=...`  | `customer.view_masked`                                  | Optional accent-insensitive reception name search; same masked response                                                                                                 |
| GET    | `/bookings/search?date=YYYY-MM-DD&q=...`     | `customer.view_masked`                                  | Backward-compatible booking search response `{businessDate,query,bookings}`; up to 100 results                                                                          |
| GET    | `/bookings/export?date=YYYY-MM-DD`           | `customer.view_masked`                                  | UTF-8 `text/plain` Zalo summary and booking statistics, no phone fields                                                                                                 |
| GET    | `/bookings/:id`                              | `customer.view_masked`                                  | `{booking:BookingView}`                                                                                                                                                 |
| POST   | `/bookings`                                  | `reservation.create`                                    | Body `BookingInput`; 201 `{booking}`                                                                                                                                    |
| POST   | `/bookings/direct`                           | `reservation.create` + `table.assign`                   | Body `BookingInput` plus `tableIds`; 201 `{booking}` with assigned table codes                                                                                          |
| PUT    | `/bookings/:id`                              | `reservation.update`                                    | Body `BookingInput` plus `version`; `{booking}`                                                                                                                         |
| POST   | `/bookings/:id/assign`                       | `table.assign`                                          | Body `{version,tableIds}`; `{booking}`                                                                                                                                  |
| POST   | `/bookings/:id/merge`                        | `visit.combine`                                         | Body `{version,tableIds}`; `{booking,group:{id,symbolNo,tableIds}}`                                                                                                     |
| POST   | `/bookings/:id/cancel`                       | `reservation.cancel`                                    | Body `{version,reasonNote?}`; `{booking}`                                                                                                                               |
| POST   | `/bookings/:id/no-show`                      | `reservation.mark_no_show`                              | Body `{version}`; `{booking}`                                                                                                                                           |
| POST   | `/bookings/:id/late-confirm`                 | `reservation.update`                                    | Body `{version}`; returns `{bookingId,lateConfirmed,lateConfirmedAt,version,changeSeq}` only                                                                            |
| POST   | `/bookings/:id/call`                         | `booking.phone.call`                                    | Empty object; 201 `{callId,bookingId,initiatedAt,telUri}` with `Cache-Control: no-store`                                                                                |
| POST   | `/bookings/:id/calls/:callId/outcome`        | `booking.phone.call`                                    | Body `{outcome,bookingVersion?}`; records one result for the call                                                                                                       |
| GET    | `/bookings/:id/calls`                        | `booking.phone.call`                                    | `{calls}`, newest first, never a phone number                                                                                                                           |
| POST   | `/bookings/:id/check-in`                     | `visit.checkin`                                         | Body `{version}`; `{booking}`                                                                                                                                           |
| POST   | `/bookings/:id/phone:reveal`                 | Both `booking.phone.reveal` and `customer.phone.reveal` | `{phoneNumber}`; OWNER and ADMIN only                                                                                                                                   |
| POST   | `/bookings/walk-ins`                         | `visit.walkin`                                          | Body `{partySize,businessDate,tableIds,guestName?,phoneNumber?}`; 201 `{visitId}`                                                                                       |

`BookingInput`:

```json
{
  "guestName": "Khách đặt bàn",
  "partySize": 4,
  "expectedAt": "2030-10-24T20:00:00+07:00",
  "businessDate": "2030-10-24",
  "sourceCode": "HOTLINE",
  "note": "Ghi chú tùy chọn",
  "phoneNumber": "0987654321",
  "classification": "NEW",
  "isBirthday": false,
  "iconKeys": ["star", "pin"],
  "honorific": "MR",
  "socialPlatform": "IG"
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

| Field            | Values                                                                           | Stored as                        |
| ---------------- | -------------------------------------------------------------------------------- | -------------------------------- |
| `iconKeys`       | array of `star` (⭐ Bàn sếp) and `pin` (📌 Chỉ định); `[]` or `null` clears both | `is_boss_table`, `is_designated` |
| `honorific`      | `MR`, `MS`; `null` or `""` clears it                                             | `honorific`                      |
| `socialPlatform` | `FB`, `IG`, `TIKTOK`, `THREADS`, `GG_REVIEW`; `null` or `""` clears it           | `social_platform`                |

`BookingView` returns `iconKeys` (always an array, `[]` when nothing is set),
`honorific` and `socialPlatform` (both nullable). A booking written before 0016
has all four columns at their defaults and reads back as `{"iconKeys":[],"honorific":null,"socialPlatform":null}`.

Rules:

- `🎂 Sinh nhật` is **not** an icon key — it stays the existing `isBirthday` boolean.
  🔥 Khách quen and 🆕 Khách mới are derived from `classification` and are not sent either.
  Any other key is refused rather than dropped in silence.
- `socialPlatform` is only stored while `sourceCode` is `SOCIAL`. For every other
  source the server writes `NULL`, whether the client sent a platform or not, and
  an update that moves a booking off `SOCIAL` clears the stored platform. A CHECK
  constraint cannot read the source code through the `booking_sources` foreign key,
  so this is enforced by the API.
- An omitted field keeps the stored value on update; an explicit `null` (or `[]`
  for `iconKeys`) clears it. A change to any of the three alone counts as a change,
  so such an edit is not rejected with `BOOKING_NOT_CHANGED`.
- The atomic Floor Projection claim also carries `honorific` and `iconKeys`, for a
  `RESERVATION`, a `WAITLIST_HOLD` and the `VISIT` a booking was checked in to, so
  the floor can render `Mr Nam` and the ⭐/📌 markers without a second request.

Errors, all 400:

| Code                      | Cause                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------- |
| `INVALID_ICON_KEYS`       | not an array, more entries than there are icon keys, or a key outside `star`/`pin` |
| `INVALID_HONORIFIC`       | a value outside `MR`/`MS` (case-sensitive)                                         |
| `INVALID_SOCIAL_PLATFORM` | a value outside `FB`/`IG`/`TIKTOK`/`THREADS`/`GG_REVIEW`                           |

`POST /bookings/walk-ins` does not accept these three fields; a walk-in carries no
icons, honorific or platform.

### Late confirmation (TU-12)

`BookingView` and the atomic Floor Projection expose nullable `lateConfirmedAt`; neither exposes the confirming user or any unmasked phone data. The late-confirm response is intentionally minimal and contains no note, phone, ciphertext, HMAC or CRM fields. Late confirmation requires a current-business-date `BOOKED` reservation with an active table claim, no visit, a matching optimistic-lock version, and server time after `expectedAt` but before the no-show threshold. It increments the reservation version and venue change sequence once and writes `RESERVATION_LATE_CONFIRMED`. An exact retry of that successful input version is idempotent; unrelated stale versions return 409. Other 409 cases include wrong business date, terminal/check-in state, missing active claim and pre-arrival use. A new confirmation at/after the no-show threshold returns 409 `LATE_CONFIRM_NO_SHOW_THRESHOLD_REACHED`.

**Business Decision — Option A:** `LATE_CONFIRMED` does not extend a booking. It is rendered only before the configured no-show threshold. At exactly `expectedAt + no_show_warning_minutes`, `NO_SHOW` wins even when a prior confirmation exists. This is a display warning only: the reservation remains `BOOKED`, its confirmation history, hold, allocations and table group remain intact, and check-in is still allowed under the normal permission/business-date rules. Only the existing manual no-show or cancel workflow terminates the lifecycle and releases the tables.

### Calling a booking contact (TU)

The atomic Floor Projection and `BookingView` expose only `canCall` plus the existing `phoneLast3`. The server computes `canCall`: it is true whenever the guest has a valid encrypted phone, and false otherwise. Reception has to be able to ring a guest at any point of the night - before the pre-arrival window, past the no-show threshold, after check-in, and on a booking that was just cancelled - so calling no longer depends on the business date, the reservation status, a table claim or the derived display state. Venue thresholds still drive the display states themselves; they no longer move a calling boundary.

A waiting guest and a seated guest are called the same way, through `/waitlist/:id/call` and `/visits/:id/call`. They exist because `booking_call_logs.reservation_id` used to be `NOT NULL`, so a Walk-in on the waiting list - exactly the guest to ring when a table frees up or a hold runs out - could not be called at all. Migration 0023 makes that column nullable and adds `waitlist_entry_id` and `visit_id`, with a check constraint keeping exactly one of the three set. Their outcome route accepts only `CONTACTED` and `NO_ANSWER`: `LATE_CONFIRMED` moves a reservation, and these targets may have none. The per-user rate limiter counts booking, waitlist and visit ids in separate buckets, and `POST /bookings/:id/call` and the two new routes let a call through when no limit is configured, instead of the 503 that silenced the whole venue.

`POST /bookings/:id/call` accepts no phone number. BA-023 gives OWNER, ADMIN WRITE and RECEPTIONIST the dedicated sensitive permission `booking.phone.call`; ADMIN READ_ONLY does not receive it at runtime. The endpoint keeps the per-user/booking rate limiter and actor organization/venue scope, rechecks that a dialable phone exists, decrypts only after authorization, creates one `booking_call_logs` row, and returns a private/no-store RFC 3966 `tel:` response. Neither the URI nor the full number is written to `operation_log`, the floor projection, normal application logs or browser storage. The user must directly press the call action; the client creates a transient `tel:` link and does not retain it in application state or web storage. A `tel:` URI necessarily sends the full number to the receiving browser and OS/dialer, may be visible in developer tools, and does not prove that a call connected. The outcome dialog therefore requires a human result. Backend-controlled telephony/hidden-number calling is not implemented.

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

Migration 0005 (`0005_revoke_receptionist_phone_reveal.sql`) revokes the historical `booking.phone.reveal` grant from RECEPTIONIST. Migration 0014 adds `booking.phone.call`; migration 0024 grants it to ADMIN WRITE through the ADMIN matrix. Both `booking.phone.reveal` and `customer.phone.reveal` are granted to OWNER and both ADMIN access levels and remain required by the separate `phone:reveal` endpoint. Staff retain masked last-three-digit projections only.

BA-023 records the approved PO decision: Receptionist calling uses the dedicated sensitive `booking.phone.call` permission and the controlled `tel:` response described above. This is an explicit exception for transferring the number to the browser/OS dialer; it does not broaden either general-purpose reveal permission.

## Visits

| Method | Path                      | Permission      | Request / response                                                               |
| ------ | ------------------------- | --------------- | -------------------------------------------------------------------------------- |
| POST   | `/visits/:id/close`       | `visit.end`     | Body `{version,mode:"MANUAL",reason,note?}`; `{visit:ClosedVisitView}`           |
| POST   | `/visits/:id/move`        | `visit.move`    | Body `{version,tableIds,note?}`; `{visit:MovedVisitView}`                        |
| POST   | `/visits/:id/merge`       | `visit.combine` | Body `{version,tableIds}`; `{visit:MovedVisitView,group:{id,symbolNo,tableIds}}` |
| GET    | `/visits/turns?from=&to=` | `report.read`   | Table-turn ledger over a range of operating days; see **Table turns** below      |
| GET    | `/visits/turns/summary?from=&to=` | `report.read` | Totals, averages and aggregates by business date, month, check-in user and logical table/group scope |

Manual close reasons are `GUEST_LEFT` or `ENTRY_ERROR`; note is optional, at most 500 characters. Closing releases the visit allocations and dissolves unused groups. `ClosedVisitView` is `{id,businessDate,status:"CLOSED",endedAt,endReason,version,releasedTables:[{id,code}],turn}`, where `turn` is the table turn this close recorded (see **Table turns** below) or null when the visit already had one. Closing releases the operational state only: it never dissolves a LAYOUT cluster. `MovedVisitView` is `{id,businessDate,version,previousTables:[{id,code}],tables:[{id,code}]}`. Move validates capacity and same-kind targets, allows multiple tables across bookable zones without adjacency configuration, and creates or retains their shared group. It rejects every unreleased USAGE allocation on target tables regardless of business date, plus holds on the visit's business date. Merge follows the group rules above.

`BUSINESS_DAY_WORKER_ENABLED` defaults to `true`; `BUSINESS_DAY_WORKER_INTERVAL_MS` defaults to `30000`. The worker sweeps on startup and then at that interval. Each open visit becomes eligible at the venue's next-day business cutoff (05:00 in `Asia/Ho_Chi_Minh` with the default venue configuration). At or after the cutoff, one transaction ends the visit, releases all its active USAGE allocations, dissolves groups with no remaining allocations, increments the visit version/change sequence and audits `VISIT_AUTO_CLOSED_BUSINESS_DAY` as SYSTEM. Visit/allocation reasons are `BUSINESS_DAY_END`, with null staff actor IDs. Migration 0006 enables these reasons; migration 0007 permits system group dissolution only with `dissolve_reason = 'BUSINESS_DAY_END'` while preserving staff attribution on manual dissolution. The worker revalidates each scanned candidate under a lock and skips stale versions; a later sweep rescans them. Audit failure rolls the transaction back.

Carry-over occupancy remains visible and `staleFromPreviousDay` remains true on the current business-date projection until allocations are actually released. Past-date behavior is unchanged. A future business-date projection excludes earlier `USAGE` allocations and includes only exact-date `USAGE`, while reservation and waitlist holds remain scoped to the selected date. This projection filter never releases or rewrites allocations. It covers the interval before the worker runs and operation with the worker disabled; GET never performs a release. Auto-close takes precedence once its transaction commits, so subsequent current-date floor reads show the tables free and remove empty groups. It closes visits only: unreleased reservation/waitlist holds remain reserved on their own business date, CHECKED_IN reservations retain their status, and linked waitlist entries already closed as SEATED retain their closure metadata, version and WAITLIST_SEATED audit. There is no second waitlist cancellation or seating event at business-day end.

`AFTER_PAYMENT` is recognized but rejected because a trusted payment verifier is unavailable (`PAYMENT_VERIFICATION_UNAVAILABLE`). The API does not provide a payment-confirmation endpoint.

## Table turns — lượt khách (C2)

A table or a cluster earns **+1 turn** when reception checks in a party: booking check-in, walk-in seating or arrived
waitlist seating opens a visit. OPEN visits count immediately from `visits.started_at`. Closing the visit records its
immutable `table_turns` snapshot; normal release preserves the count, while entry correction or business-day auto-close
removes that turn from counted totals. Reports combine open visits and closed snapshots once per visit.

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

An OPEN visit counts from check-in. Once closed, `completed_at` determines whether the historical row counts:

| Close                                                 | Row written   | Counted              |
| ----------------------------------------------------- | ------------- | -------------------- |
| `GUEST_LEFT` (Trả bàn)                                | yes           | **yes**              |
| `ENTRY_ERROR` (sửa nhập sai)                          | yes           | no                   |
| `BUSINESS_DAY_END` (worker cuối ca)                   | yes           | no — see `[?]` below |
| A booking cancelled or marked No-show before check-in | no row at all | no                   |

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

`GET /tables?date=` returns `seatedTurnCount` on every table and group: counted CLOSED turns plus OPEN check-ins for
that operating day, from the same visit projection as list/summary. The client draws the badge from turn 2, once per
cluster on its anchor cell, so the number is never
multiplied by the member count. A member of a `LAYOUT` cluster reports the cluster's count, so the cell and the cluster
tile cannot disagree. Check-in and Close Visit bump `venues.change_seq`, which the SSE stream publishes, so open
devices refetch the count from the projection. Normal release preserves the count; ENTRY_ERROR and BUSINESS_DAY_END
remove the closed turn from it.

A cluster that is split keeps its history: the old turns still name the original `group_id` and `group_code_snapshot`,
and they deliberately do **not** migrate to the now-single tables, whose badge is therefore 0.

### `GET /api/v1/visits/turns`

| Method | Path                                                        | Permission    | Request    | Response                                                                   | Error codes                                                                                                                                                 |
| ------ | ----------------------------------------------------------- | ------------- | ---------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/visits/turns?from=&to=&page=&pageSize=&includeUncounted=&checkedInByUserId=&closedByUserId=` | `report.read` | query only | `{from,to,page,pageSize,total,completedTotal,guestTotal,turns:TurnView[]}` | `INVALID_BUSINESS_DATE`, `INVALID_DATE_RANGE`, `DATE_RANGE_TOO_WIDE`, `INVALID_PAGE`, `INVALID_PAGE_SIZE`, `INVALID_INCLUDE_UNCOUNTED`, `INVALID_CHECKED_IN_BY_USER_ID`, `INVALID_CLOSED_BY_USER_ID`, `PERMISSION_DENIED` |

`from` and `to` are operating days, `YYYY-MM-DD`, inclusive, at most 366 days apart. `page` starts at 1, `pageSize` is
1–200 and defaults to 50. `includeUncounted=true` also returns the rows that do not count; the default returns only
counted check-ins, including guests still seated. The legacy `completedTotal` name is retained, but now counts
OPEN and counted CLOSED turns; `guestTotal` includes guests in those turns. Both totals cover the whole filter,
not the page. `checkedInByUserId` is an optional positive safe integer that filters list, totals and summary by
**người check-in**, derived from `visits.created_by_user_id` for booking, walk-in and waitlist seating.
`checkedInByUserId` and `checkedInByDisplayName` are nullable on each turn; `byStaff` uses those fields.
The optional legacy `closedByUserId` filter still selects the releasing user and excludes OPEN turns.
Both filters can be combined. `closedByUserId` and `closedByDisplayName`
are null on system closes. Display names come from current users with an organization and venue membership
(an organization-wide role also qualifies); they are not historical name snapshots. Revoked roles still
provide historical venue association. A user ID without a matching association has a null display name.

It is gated on `report.read`, which **RECEPTIONIST does not hold**: a receptionist reads the badge from the floor
projection, not the statistics ledger.

Each row has `status: "OPEN" | "CLOSED"`. An OPEN row has `turnId=null`, `releasedAt=null`, `endReason=null`,
`closedByUserId=null`, `closedByDisplayName=null` and `counted=true`. Use `visitId` as its stable identity across
release. Open visits and closed ledger snapshots are mutually exclusive per visit. ENTRY_ERROR, MERGED and
BUSINESS_DAY_END closes remain in history with `counted=false`, visible only with `includeUncounted=true`.
List ordering is business date descending, seated time descending, then visit ID descending, so releasing a
party does not move its position. The 17:00-05:00 business-day rules are unchanged.
The listed `turnNo` follows check-in order within the scope/day and skips uncounted turns, matching the floor
badge. Uncounted history can share this display number with a replacement check-in; identity is always `visitId`.
The immutable ledger's stored ordinal and the close mutation's ledger metadata remain unchanged.

```http
GET /api/v1/visits/turns?from=2026-11-11&to=2026-11-11
```

```json
{
  "from": "2026-11-11",
  "to": "2026-11-11",
  "page": 1,
  "pageSize": 50,
  "total": 1,
  "completedTotal": 1,
  "guestTotal": 12,
  "turns": [
    {
      "turnId": 31,
      "status": "CLOSED",
      "turnNo": 1,
      "businessDate": "2026-11-11",
      "scope": "GROUP",
      "groupCode": "G01",
      "groupId": 101,
      "tableId": null,
      "tableCodes": ["B3", "B4", "B5"],
      "memberTableIds": [101, 102, 103],
      "guestName": "Đoàn 12 khách",
      "guestCount": 12,
      "sourceCode": "HOTLINE",
      "origin": "RESERVATION",
      "seatedAt": "2026-11-11T14:31:02.117Z",
      "releasedAt": "2026-11-11T16:04:55.903Z",
      "endReason": "GUEST_LEFT",
      "counted": true,
      "visitId": 77,
      "reservationId": 54,
      "checkedInByUserId": 2,
      "checkedInByDisplayName": "Lễ tân",
      "closedByUserId": 3,
      "closedByDisplayName": "Chủ quán"
    }
  ]
}
```

`POST /visits/:id/close` additionally answers `turn`, which is the turn the close recorded, or `null` when the visit
already had one:

```json
{
  "visit": {
    "id": 77,
    "status": "CLOSED",
    "releasedTables": [{ "id": 101, "code": "B3" }],
    "turn": { "turnId": 31, "scope": "GROUP", "turnNo": 1, "counted": true }
  }
}
```

### `GET /api/v1/visits/turns/summary`

Requires authentication and `report.read`, with the same date, staff and `includeUncounted` validation and
venue/organization scope as the list. Pagination does not truncate aggregates. No write or CSRF token is required.
Dates are existing `business_date` values; the client supplies Monday-Sunday ranges for a business week.

```http
GET /api/v1/visits/turns/summary?from=2026-11-09&to=2026-11-15&checkedInByUserId=2
```

```json
{
  "from": "2026-11-09", "to": "2026-11-15", "completedTotal": 1, "openTotal": 0, "guestTotal": 12,
  "scopeTotal": 18, "physicalTableTotal": 24,
  "averagePerScope": 0.06, "averagePerPhysicalTable": 0.04,
  "byBusinessDate": [{"businessDate": "2026-11-11", "turns": 1, "guests": 12}],
  "byMonth": [{"month": "2026-11", "turns": 1, "guests": 12}],
  "byStaff": [{"checkedInByUserId": 2, "checkedInByDisplayName": "Lễ tân", "turns": 1, "guests": 12}],
  "byScope": [{"scope": "GROUP", "tableId": null, "groupId": 101, "label": "G01", "turns": 1, "guests": 12}]
}
```

### Turn statistics (TU-38)

The same endpoint carries the statistics the Sổ lượt tới quán screen reads; there is no second
report endpoint, and the screen never counts raw ledger rows.

| Query parameter      | Values              | Effect                                                                 |
| -------------------- | ------------------- | ---------------------------------------------------------------------- |
| `from`, `to`         | `YYYY-MM-DD`        | Operating days, inclusive. `from > to` is 400 `INVALID_DATE_RANGE`; a span over 366 days is 400 `DATE_RANGE_TOO_WIDE` |
| `includeUncounted`   | `true` \| `false`   | Buckets also include corrections and system closes. Anything else is 400 `INVALID_INCLUDE_UNCOUNTED` |
| `includeZeroScopes`  | `true` \| `false`   | Adds a `turns: 0, guests: 0` row to `byScope` for every countable scope with no turn in range. Anything else is 400 `INVALID_INCLUDE_ZERO_SCOPES` |
| `checkedInByUserId`  | positive integer    | Filter by check-in user. Otherwise 400 `INVALID_CHECKED_IN_BY_USER_ID` |
| `closedByUserId`     | positive integer    | Filter by closing user. Otherwise 400 `INVALID_CLOSED_BY_USER_ID`      |

Errors: 401 without a session, 403 `PERMISSION_DENIED` without `report.read`, 400 for the
validation above. No write or CSRF token is required and nothing is mutated.

**Per table or cluster (AC01).** `byScope` is one row per unit that earned a turn, grouped by
`(scope, groupId|tableId)`. A fixed (LAYOUT) cluster is one row with one turn per party, never
one row per member table. By default a scope with no turn in the range is absent, exactly as
before; with `includeZeroScopes=true` it appears once with zeroes, labelled from live inventory
(the table's `code`, or the cluster's `name`/symbol code). A measured row always wins over its
inventory twin, so a scope is never listed twice and the totals do not move.

**Venue total (AC02).** `completedTotal` is the number of counted turns in range, and
`byScope`, `byBusinessDate` and `byMonth` each sum to it when `includeUncounted` is off.
Nothing sums `turnNo` or expands cluster members.

**Averages and their denominators (AC03).** `scopeTotal` counts the units that can earn a turn:
ACTIVE non-spare tables that no active LAYOUT cluster owns, plus the active LAYOUT clusters.
`physicalTableTotal` counts ACTIVE non-spare tables. `averagePerScope` is
`completedTotal / scopeTotal` and `averagePerPhysicalTable` is
`completedTotal / physicalTableTotal`, both rounded to two decimals and 0 when the denominator
is 0. Both denominators are live venue inventory at query time, not a snapshot of the range, so
they stay populated for an empty range. The venue's own figure is `averagePerScope`: that is the
unit the ledger counts against. `averagePerPhysicalTable` is there because "trung bình mỗi bàn"
reads as a per-table number to a reader who does not know a cluster counts once.

**Monthly totals (AC04).** `byMonth` groups by `DATE_FORMAT(business_date, '%Y-%m')` in SQL,
ascending, as `YYYY-MM`. Months with no turn have no bucket. A cluster is counted once per party
here too, and a party seated after midnight falls in the month of its operating day.

**What is not counted (AC05).** A booking that was never checked in has no visit and so no turn.
A `CANCELLED` or `NO_SHOW` booking likewise. `BUSINESS_DAY_END` and `ENTRY_ERROR` closes stay
visible with `includeUncounted=true` but never reach `completedTotal`, `guestTotal` or the
averages.

**The operating day (AC06).** Every figure is grouped by the stored `business_date`, which the
check-in path derives from the venue's own `business_day_start_local` and
`business_day_cutoff_local`. Nothing in the statistics path assumes 17:00-05:00: a venue
configured for another shift groups by its own cutoff.

On the web side, `useBusinessShift()` reads those two columns from the catalog and is what
`useBusinessDate()`, the Admin header, the reception shift labels, the floor and reservation
timeline axes and the arrival-time list all derive their hours from. `FALLBACK_BUSINESS_SHIFT`
in `web/src/lib/time.ts` covers only the first render before the catalog resolves.

One place still holds the pair as a constant on purpose: `web/src/domain/booking-rules.ts`,
whose arrival slots and check-in window mirror the API's own booking validation in
`api/src/modules/bookings/business-date.ts` (`bookingDayStartHour`, `bookingDayCutoffHour`).
Reading the venue row on the web side alone would let the booking form accept an arrival the
API then refuses, so both sides keep the pair centralised on one constant each, and making the
API configurable is the single change the web file would then need. That is open work, not
part of TU-38.

**Performance (AC07, AC08).** The summary runs six aggregate queries whatever the row count:
four over the shared turn projection, one scope inventory and one table count. Migration 0031
adds `ix_visits_org_venue_date (organization_id, venue_id, business_date)` to `visits`, which is
the predicate the projection opens with. Measured on a three-month sample (5 400 turns), a
one-month summary answers in a median of 109ms and a slowest of 119ms against a 2000ms budget;
`test/tu38-turn-statistics-benchmark.mysql.test.ts` prints both the timings and the
`EXPLAIN FORMAT=TREE` plans. No schema or behaviour change touches TU-25, Booking/Visit or NA-34.

Every aggregate counts visit rows, never sums `turnNo` or expands group members. `byScope` groups by
`(scope, groupId|tableId)` and labels from the live OPEN turn if present, otherwise the latest matching ledger row (highest turn ID): group code,
or table snapshot codes joined with ` + `. It sorts by turns descending, then label. Dates sort ascending;
staff sorts by turns descending, then current display name and user ID. Days without turns have no bucket.

By default all returned rows and buckets are counted. With `includeUncounted=true`, buckets include corrections
and system closes; these stay attributed to their check-in user even when the closer is the system.
`completedTotal` and `guestTotal` still count only counted OPEN/CLOSED
turns, matching the existing list totals, so bucket sums can exceed these two totals when this flag is enabled.
`openTotal` counts OPEN turns under the same date, counting and staff filters, before pagination.
OPEN turns are always counted, so `0 <= openTotal <= completedTotal`; counted CLOSED turns equal
`completedTotal - openTotal`. Uncounted CLOSED turns never contribute to either total, even with
`includeUncounted=true`. Filtering by `closedByUserId` yields `openTotal: 0`, because OPEN turns have no closer.
An empty range returns zero totals and empty arrays. Payment verification is unchanged.
The summary uses four aggregate SQL queries regardless of row count; staff associations use `EXISTS` so multiple
roles cannot multiply counts. This addition requires no schema migration.

### Migration

`0018_table_turn_ledger.sql` creates `table_turns` and nothing else: no column is dropped, no row is updated or
deleted, and no existing behaviour changes shape. Migrations are forward-only (doc 10 §2). Apply with
`npm run db:migrate` from `Bar_management/api` with `DB_NAME` on the target database. Turns are not backfilled, because
a past visit's cluster membership and booking source can no longer be reconstructed truthfully — the ledger starts from
the first close after the migration, and that is deliberate rather than an omission.

Test and E2E databases must delete `table_turns` before `visits`, `reservations`, `dining_tables` and `table_groups`;
the shared fixtures and the per-file cleanups already do.

### Counting decisions

- A check-in counts immediately and a normal `GUEST_LEFT` release preserves it. This does not verify payment.
- The existing operating day and its 05:00 cutoff remain unchanged for the 17:00-05:00 service shift.
- BUSINESS_DAY_END and ENTRY_ERROR close rows have `completed_at` null, remain visible with `includeUncounted=true`
  and do not contribute to counted totals or the badge after closing.

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

TU-38 adds two files beside it, run the same way:

- `test/tu38-turn-statistics.mysql.test.ts` — per-scope rows for one day with and without
  `includeZeroScopes`, the venue total, both denominators and averages, the empty range,
  monthly totals across two months with a cluster counted once, a booking never checked in
  plus a cancelled and a no-show one, the operating day of a party seated after midnight, and
  the route contract including `report.read` and parameter validation.
- `test/tu38-turn-statistics-benchmark.mysql.test.ts` — seeds three months (5 400 turns),
  measures five one-month summaries against the 2000ms budget and prints the
  `EXPLAIN FORMAT=TREE` plan of each aggregate plus both plans for the `target_visits`
  predicate. Add `--disableConsoleIntercept` to see the printed evidence.

## Waitlist

| Method | Path                                  | Permission                                                                                                  | Request / response                                                                                                                                                                                           |
| ------ | ------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/waitlist?date=YYYY-MM-DD`           | `customer.view_masked`                                                                                      | `{businessDate,entries:WaitlistEntryView[]}`                                                                                                                                                                 |
| POST   | `/waitlist`                           | `waitlist.create`                                                                                           | Body WALK_IN `{kind?:"WALK_IN",guestName,partySize,businessDate,contactChannel,phoneNumber?,note?}` or ADVANCE `{kind:"ADVANCE_RESERVATION",reservationId,businessDate,contactChannel,note?}`; 201 `{entry}` |
| POST   | `/waitlist/:id/seat`                  | `waitlist.accept_offer` + `reservation.create` + `table.assign`, plus `visit.walkin` when `arrived` is true | Body `{version,tableIds,arrived?}`; `{entry,reservationId,groupId}` where `reservationId` is null for an arrived Walk-in that creates a Visit without a reservation                                          |
| POST   | `/waitlist/:id/cancel`                | `waitlist.cancel`                                                                                           | Body `{version,reasonCode,note?}`; `{entry}`                                                                                                                                                                 |
| POST   | `/waitlist/:id/contact-attempts`      | `waitlist.record_contact`                                                                                   | Body `{version,channel,outcome,note?}`; `{entry}`                                                                                                                                                            |
| POST   | `/waitlist/:id/call`                  | `booking.phone.call`                                                                                        | Empty object; 201 `{callId,targetKind,targetId,initiatedAt,telUri}` with `Cache-Control: no-store`                                                                                                           |
| GET    | `/waitlist/:id/calls`                 | `booking.phone.call`                                                                                        | `{calls}`, newest first, never a phone number                                                                                                                                                                |
| POST   | `/waitlist/:id/calls/:callId/outcome` | `booking.phone.call`                                                                                        | Body `{outcome}`, only `CONTACTED` or `NO_ANSWER`                                                                                                                                                            |
| POST   | `/visits/:id/call`                    | `booking.phone.call`                                                                                        | Empty object; 201 `{callId,targetKind,targetId,initiatedAt,telUri}` with `Cache-Control: no-store`                                                                                                           |
| GET    | `/visits/:id/calls`                   | `booking.phone.call`                                                                                        | `{calls}`, newest first, never a phone number                                                                                                                                                                |
| POST   | `/visits/:id/calls/:callId/outcome`   | `booking.phone.call`                                                                                        | Body `{outcome}`, only `CONTACTED` or `NO_ANSWER`                                                                                                                                                            |

`WaitlistEntryView` is `{id,kind,guestName,phoneLast3,partySize,businessDate,queuedAt,status,contactChannel,reservationId,reservationExpectedAt,visitId,note,version}`. `kind` is `ADVANCE_RESERVATION` or `WALK_IN`; omitted kind creates `WALK_IN`. Advance entries require a BOOKED reservation in the actor organization/venue on the same business date, without active holds or allocations; an existing non-terminal entry returns 409. Guest name and party size come from the reservation and must not be sent for advance entries. `reservationExpectedAt` is the ISO UTC appointment time for advance entries and null for walk-ins. Lists order by priority_class (advance before walk-in), queuedAt, then id. `status` is `WAITING`, `CONTACTING`, `OFFERED`, `HOLD_ACTIVE`, `SEATED`, `DECLINED` or `CANCELLED`. Only `phoneLast3` is returned. Optional WALK_IN `phoneNumber` uses the existing encrypted customer identity and duplicate checks. Phone numbers in creation notes are rejected.

Creation validates guest name (1-120), party size (1-500), date, channel and note (at most 500 characters). Its `contactChannel` values are `IN_PERSON`, `PHONE_CALLBACK`, `ZALO_THREAD`, `FANPAGE_THREAD`, `OTHER`. Creation, cancellation and contact-attempt notes are trimmed and reject phone numbers, including spaced, dotted and dashed forms, with 422 `PHONE_IN_NOTE_FORBIDDEN` before any repository mutation.

Seat supports WALK_IN entries in WAITING and ADVANCE_RESERVATION entries in WAITING, CONTACTING or OFFERED. Both lock the entry and tables, enforce same zone/type, bookable zone, capacity, ACTIVE/non-spare tables and same-date allocation conflicts. For a present WALK_IN, `{arrived:true}` is valid only on the current business date and atomically creates a Visit plus USAGE allocations (and a shared group for multiple tables), marks the entry SEATED, writes `WAITLIST_SEATED`, and increments venue `change_seq`; it does not create a reservation. Without `arrived:true`, WALK_IN creates a BOOKED reservation with classification UNCLASSIFIED; ADVANCE_RESERVATION reuses its BOOKED reservation (same business date, no existing active hold/allocation) and increments its version. Those booking paths create a RESERVATION hold, one HOLD allocation per table and a shared group for multiple tables, then mark the entry HOLD_ACTIVE and audit `WAITLIST_ASSIGNED_TO_RESERVATION`. Later normal booking check-in converts grouped holds to usage, creates the visit and closes the linked waitlist entry as SEATED with SEATED_OTHERWISE metadata and a `WAITLIST_SEATED` audit in the same transaction. `arrived:true` is rejected for ADVANCE_RESERVATION. Cancel/no-show of a reservation closes its open waitlist entry as RESERVATION_CANCELLED. All changes roll back together if auditing fails. No offer/hold automation is introduced.

Cancel supports all non-terminal statuses (`WAITING`, `CONTACTING`, `OFFERED`, `HOLD_ACTIVE`). Allowed `reasonCode` values from the existing schema are `CUSTOMER_DECLINED`, `CUSTOMER_WITHDREW`, `NO_SHOW_AFTER_ACCEPT`, `RESERVATION_CANCELLED`, `SEATED_OTHERWISE`, `DUPLICATE`, `ENTRY_ERROR`, `OTHER`. Note is optional, at most 300 characters. Cancellation clears a contact claim and explicitly releases the entry's active waitlist hold/allocations, dissolves unused groups, records closure metadata and bumps the entry version. Cancelling a booking-linked entry does not cancel the reservation. Audit `WAITLIST_CANCELLED` and all domain changes commit together.

Contact recording uses the existing `waitlist_contact_attempts` table. Its channel values differ from creation: `IN_PERSON`, `PHONE_BY_AUTHORIZED`, `ZALO_THREAD`, `FANPAGE_THREAD`, `OTHER`. Outcomes are `NO_ANSWER`, `CALLBACK_REQUESTED`, `OFFER_PENDING`, `ACCEPTED`, `DECLINED_OFFER`, `KEEP_WAITING`, `WITHDREW`, `WRONG_CONTACT`. Note is optional, at most 300 characters. The entry lock serializes attempt numbering; each completed attempt records the authenticated user, server timestamps, channel/outcome/note, bumps entry version and writes `WAITLIST_CONTACT_RECORDED` atomically. Recording an outcome does not change entry status or create an offer, hold or visit. Terminal entries reject both mutations with 409 `WAITLIST_TERMINAL`; stale versions return 409 `VERSION_CONFLICT` first. Unknown/out-of-scope entries return 404 `WAITLIST_NOT_FOUND`.

## Operations (undo/redo)

| Method | Path                     | Permission       | Request / response                                               |
| ------ | ------------------------ | ---------------- | ---------------------------------------------------------------- |
| GET    | `/operations/undo-state` | `operation.undo` | `{undo,redo}`, each null or `{operationId,action,summary}`       |
| POST   | `/operations/undo`       | `operation.undo` | Body `{operationId}`; `{operationId,changeSeq,summary,undoable}` |
| POST   | `/operations/redo`       | `operation.undo` | Body `{operationId}`; same shape                                 |

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

| Method | Path                           | Permission                                                   | Request / response                                                                               |
| ------ | ------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| GET    | `/accounts`                    | `user.read`                                                  | `{accounts:AccountSummary[],roles:[{code,name}]}`; assignable roles depend on actor              |
| POST   | `/accounts`                    | `user.manage`                                                | Body `{username,displayName,password?,roleCode,accessLevel?}`; 201 `{account,temporaryPassword}` |
| POST   | `/accounts/:id/status`         | `user.manage`                                                | Body `{version,status:"ACTIVE"\|"DISABLED"}`; `{account,revokedSessions}`                        |
| POST   | `/accounts/:id/access-level`   | `user.manage`, OWNER target rule                             | Body `{version,accessLevel:"WRITE"\|"READ_ONLY"}`; `{account,revokedSessions}`                   |
| POST   | `/accounts/:id/password-reset` | `user.manage` + target rule                                  | Body `{version,newPassword?}`; `{account,revokedSessions,temporaryPassword}`                     |
| POST   | `/accounts/me/password`        | Session + CSRF (works while a temporary password is pending) | Body `{currentPassword,newPassword}`; `{revokedSessions}`                                        |
| GET    | `/accounts/:id/permissions`    | `user.read`                                                  | `{account,permissions:AccountPermissionView[]}` (TU-34)                                          |
| POST   | `/accounts/:id/permissions`    | `user.manage` + target rule                                  | Body `{version,permissions:{[code]:boolean}}`; `{account,permissions,changed}` (TU-34)           |

`AccountSummary` is `{id,username,displayName,status,membershipStatus,roles,accessLevel,lastLoginAt,version}`; password,
hash, token and reset secret are never returned. Listing and every mutation require an active target role at the
actor's organization and venue. OWNER may create ADMIN (`accessLevel` required) or one of the four staff roles.
ADMIN WRITE may create only `RECEPTIONIST`, `CUSTOMER_CARE`, `CASHIER`, or `WAITER` (TU-32 adds `WAITER`).

### Temporary passwords (TU-34)

`POST /accounts` and `POST /accounts/:id/password-reset` generate a 16-character password when the body omits one, and
return it as `temporaryPassword` exactly once — no endpoint reads it back, and it never reaches `operation_log`. A
generated password sets `users.must_change_password`; a password the admin supplies explicitly does not, because that
is the password they chose rather than a temporary one. While the flag is set the account authenticates normally but
every business endpoint answers
`403 PASSWORD_CHANGE_REQUIRED` until `POST /accounts/me/password` succeeds. Only `GET /auth/me`, `POST /auth/logout`
and that password change accept a session in this state. A successful change clears the flag and revokes all sessions,
so the staff member signs in again with the password they chose.

### Per-account permissions (TU-34, grant model since 16/11)

`effective = (role_permissions ∪ enabled_overrides) ∩ ceiling`. SuperAdmin grants a permission the role does not
carry — that is what the 15/11 minutes mean by level 1 "phân quyền cho mọi vai" — and switches one off again. Three
rails keep the six levels meaningful:

1. **Owner-only work is never granted piecemeal.** `venue.configure` and `customer.anonymize` are the line between
   level 1 and level 2; granting them would make "cấp 2 KHÔNG cấu hình tính năng" meaningless. Promote the person to
   SuperAdmin instead.
2. **Admin Read-Only only ever gains read permissions** (the `READ_ONLY_ADMIN_PERMISSIONS` list). Level 3 is defined
   as read-only, so a write grant would contradict the level itself.
3. **`user.read` cannot be switched off** — it is the only door to the accounts screen.

Anything else is grantable. The price is that "what can role X do" no longer reads off the role matrix alone: the
per-account overrides must be read too. Every tick lands in the audit log (TU-35) as `USER_PERMISSIONS_CHANGED` with
the old and new value, so the grant is attributable.

The intersection is computed inside `listPermissions` — the single place permissions are computed — so
`requirePermission` enforces it on every endpoint, not just the admin screen. A grant takes effect on the target's
next request; no session is revoked.

`AccountPermissionView` is `{code,grantedByRole,enabled,overridden,editable,grantable}`. `grantedByRole` is what the
role carries, `enabled` the effective permission, `grantable` whether it is inside the ceiling, and `editable` is
`grantable` minus the protected set.

Both endpoints are **OWNER only** (`403 PERMISSION_MANAGEMENT_DENIED` for anyone else), which is TU-32's rule: Admin
Edit uses every operational feature but assigns permissions to nobody, not even staff, and Admin Read-Only cannot even
read the table. Writing additionally requires `user.manage`, an unchanged `version` (otherwise `409 VERSION_CONFLICT`),
and the target rules: nobody edits their own permissions (`409 CANNOT_MANAGE_SELF`) and OWNER accounts are untouchable
(`403 OWNER_PROTECTED`). A code outside the ceiling is rejected with `400 PERMISSION_NOT_GRANTABLE` rather than
silently ignored.

## Audit log (TU-35)

| Method | Path                        | Permission                  | Request / response                                                                            |
| ------ | --------------------------- | --------------------------- | --------------------------------------------------------------------------------------------- |
| GET    | `/operations/audit/filters` | `audit.read`                | `{filters:[{type,label,supported,note?}],retentionDays,canExport}`                            |
| GET    | `/operations/audit`         | `audit.read`                | `?from=&to=&types=&limit=&before=` → `{entries,hasMore,nextCursor,retentionDays,windowStart}` |
| GET    | `/operations/audit/export`  | `audit.read` + export level | Same query; `text/csv; charset=utf-8` as an attachment                                        |

`operation_log` is the audit trail and is append-only: nothing in the codebase updates or deletes a row, and the read
API above adds no write path. Entries come from the writes that already exist — `RESERVATION_CANCELLED`,
`VISIT_TABLES_MOVED`, `VISIT_TABLES_MERGED`, `TABLES_SPLIT`, `TABLE_GROUP_*`, `CUSTOMER_PHONE_REVEAL`,
`AUTH_LOGIN_*`, `AUTH_SESSION_REVOKED` (TU-33 "pushed off by another device"), `ADMIN_ACCESS_LEVEL_CHANGED`,
`USER_PERMISSIONS_CHANGED` and the `USER_ACCOUNT_*` family. `src/modules/operations/audit-actions.ts` maps each action
code to one of the seven filter groups in the prototype; an unmapped action still appears under "Tất cả" rather than
being hidden. The `discount` group has no action codes yet — ordering and payment do not exist — and reports
`supported: false` instead of pretending.

An entry is `{id,occurredAt,actor,actorUsername,action,actionLabel,actionType,target,device,detail}`. `target` is built
from the customer name, table code or account name of the referenced entity; `device` comes from
`auth_sessions.device_label` (TU-33), so a worker with no session reads "Hệ thống". `detail` is filtered through an
allowlist of keys from `changes` — a new key is dropped until someone considers it, so a sensitive field cannot leak
into the screen or the export by accident. **No phone number ever reaches the log**: the reveal action records that a
number was viewed, never the number.

Paging is cursor-based (`before` = last id of the previous page) because a large `OFFSET` makes MySQL read and discard
rows. Queries are bounded by `organization_id`, `venue_id` and `occurred_at`, which is what `ix_oplog_venue_time`
covers, so a one-month window stays an index range scan.

`retentionDays` and the export allowlist are read from `venue_settings` (`audit_retention_days`,
`audit_export_levels`), defaulting to 90 days and `["OWNER","ADMIN_WRITE"]` — the values pending anh Luân's answer to
C3. Reads never return rows older than the retention window. Physical deletion of expired rows is deliberately not
implemented: purging an audit trail is a decision, not a default, and C3 is still open.


## NA-34 - Anonymous visit assignment and duplicate customer review

Requires migration `0030_customer_history.sql`. Admin portal only. Reads use `report.read`; writes use `customer.history.manage`, granted to OWNER/ADMIN WRITE. Anonymous visit reads, assignment and undo are restricted to the server-selected actor venue. Duplicate suggestions are org-wide for OWNER/org-wide ADMIN, while venue-scoped ADMIN sees only pairs with either profile active in visits/reservations/waitlist at the actor venue and counts restricted to that venue. Only OWNER/org-wide ADMIN WRITE may merge or dismiss; venue ADMIN WRITE receives `403 CUSTOMER_ORG_WRITE_REQUIRED`; READ_ONLY writes receive `403 PERMISSION_DENIED`.

Migration 0030 replaces the former `0029_customer_history.sql` filename to keep `0029_user_permission_overrides.sql` unchanged and first in sequence. Its table and permission inserts are idempotent, so databases that already applied the old migration can run 0030 safely. Keep the old `schema_migrations` row and checksum: that leftover row is harmless because the migrator checks current filenames only. Existing dismissal decisions and account permission overrides are preserved. The accounts permission screen lists this permission separately as "Gán lượt khuyết danh / xử lý hồ sơ trùng"; the existing role ceilings and READ_ONLY filter still apply.

| Method | Path | Contract |
| --- | --- | --- |
| GET | `/visits/anonymous?from=YYYY-MM-DD&to=YYYY-MM-DD&page=1&pageSize=20` | Counted anonymous visits, newest first, `{visits,page,pageSize,hasMore}`; each row includes visitId, displayCode `L-<visitId>`, tableLabel, guestCount, seatedAt, businessDate, version. Inclusive range, max 366-day span; pageSize 1-50. |
| POST | `/visits/:id/customer-assignment` | `{version,phone,displayName?}` finds ACTIVE customer by org + protected phone HMAC, or creates with required displayName (422 CUSTOMER_NAME_REQUIRED if missing), then assigns atomically. Returns `{visitId,version,customer,customerCreated,undo:{operationId,visitId,version,previousCustomerId:null}}`. |
| POST | `/visits/:id/customer-assignment/undo` | `{version,operationId}` checks persisted assignment and unchanged visit, restores null customer, returns `{visitId,customerId:null,version,operationId}`. Newly created profile remains to avoid deleting identity used elsewhere. Dedicated undo, no redo. |
| GET | `/customers/duplicates?page=1&pageSize=20` | `{pairs:[{source,target}],page,pageSize,total,canMerge,canDismiss}`. Each profile has id/displayName/maskedPhone/version/visitCount/bookingCount. Source ACTIVE without phone, target ACTIVE with phone, identical nonempty normalized name_search and org; excludes MERGED/ANONYMIZED and permanently dismissed pairs. |
| POST | `/customers/duplicates/merge` | `{sourceCustomerId,targetCustomerId,sourceVersion,targetVersion}` locks and rechecks pair, repoints visits/reservations/waitlist_entries and existing merged customer links across the org, increments changed-row versions, marks source MERGED and preserves target identity. Returns IDs/new versions/moved counts/operationId. No undo; UI confirmation required. |
| POST | `/customers/duplicates/dismiss` | Same versioned pair body; permanently persists the decision and audit, returns sourceCustomerId/targetCustomerId/operationId. |

All writes use Origin/CSRF protection, optional `Idempotency-Key`, transactional audits with actor/time/before-after customer IDs, and optimistic versions. Full phone only enters requests; responses use `••• <last3>` or null and never return HMAC/ciphertext. Call logs and waitlist contacts retain parent IDs; immutable dismissal/audit history is not rewritten by merge. Typical errors: 403 permission/scope, 404 entity outside scope or missing, 409 version/undo/pair conflict, 422 validation/name/phone, 503 missing phone keys. Idempotency errors are 400 `INVALID_IDEMPOTENCY_KEY` for malformed keys, 409 `IDEMPOTENCY_IN_PROGRESS` while processing, and 422 `IDEMPOTENCY_KEY_REUSED` for a key bound to another user, venue, path or body; an exact successful retry replays the original response. The complete request/response and UI integration contract is `D:\GAM-APP\docs\contracts\na34-anonymous-visits-and-duplicates.md`.

Assignment, undo, merge and dismissal advance the existing realtime cursors for every venue in the organization in the domain/audit transaction, covering org-wide readers connected through any venue and cross-venue customer references. Rollback and idempotent replay produce no extra cursor advance; other organizations are unaffected.

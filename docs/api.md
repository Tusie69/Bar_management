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
- `businessDate` is a valid `YYYY-MM-DD`; response instants are ISO-8601 UTC strings. Booking `expectedAt` must include an offset and represent local time in `Asia/Ho_Chi_Minh` (normally `+07:00`). Business hours are 17:00 through before 05:00 the next morning; after midnight belongs to the previous business date. New or changed booking times must be within 19:00-01:00 inclusive. Updating other fields on a historical booking may retain its existing out-of-window timestamp. Walk-ins keep the operating-hours rule.
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

The update locks the venue and writes `venue_settings.quick_times`, `venues.upcoming_warning_minutes`, `venues.no_show_warning_minutes`, the venue version/change sequence and a redacted `VENUE_SETTINGS_UPDATED` audit in one transaction. `late_warning_minutes` is not modified. Failure of any write rolls everything back. Other venues are unaffected. Each committed update bumps `change_seq`; current floor polling and the settings query's 15-second polling refetch server-derived state without introducing another realtime channel. The booking forms show the database quick times as shortcuts while retaining all existing 30-minute choices and never replace the time already entered by the user.

Floor Projection, booking views and TU-Call continue to read thresholds directly from `venues`. Changing `upcomingMinutes` therefore changes the server-side `UPCOMING` and `canCall` boundary. Changing `noShowMinutes` changes the visual no-show warning and the TU-12 cutoff. It never automatically changes the persisted booking to `NO_SHOW`, cancels a hold or releases a table; manual no-show behavior remains authoritative.

## Tables and catalog

| Method | Path | Permission | Request / response |
| --- | --- | --- | --- |
| GET | `/tables/catalog` | `customer.view_masked` | `{venue,zones,tables,combinations}` |
| GET | `/tables?date=YYYY-MM-DD` | `customer.view_masked` | Atomic `{businessDate,serverNow,changeSeq,tables:FloorTableProjection[],groups:FloorGroupProjection[]}` |
| PATCH | `/tables/:id/status` | `table.assign` | Body `{businessDate,state,expectedVersion?,reason?}`; see limitation below |
| PATCH | `/tables/:id/configuration` | `venue.configure` | Body `{isSpare?:boolean,status?:"ACTIVE"|"OUT_OF_SERVICE",version,reason}`; returns `{table:{id,code,isBackup,status,version}}` |

`FloorTableProjection` retains the legacy table fields additively and exposes `{tableId,tableCode,catalogStatus,isSpare,displayState,arrivalPhase,arrivalTime,minutesLate,claim,groupId,groupDisplayCode,groupMemberTableIds}`. `displayState` is `EMPTY`, `BOOKED`, `UPCOMING`, `LATE`, `NO_SHOW`, `IN_USE` or `OUT_OF_SERVICE`; it is computed with the venue thresholds and server clock. `NO_SHOW` is visual while the reservation may remain `BOOKED` with an active allocation. Active visits have precedence over holds. Reservation and waitlist holds for another business date are excluded; an unreleased visit from an earlier date remains visible and is marked stale.

`claim` is null or a whitelisted `{kind,reservationId,visitId,waitlistEntryId,holdId,guestName,phoneLast3,partySize,turnNo,flags,groupId,groupDisplayCode,groupMemberTableIds,startsAt,deadlineAt,holdOverdue,paid,origin,sourceCode,version}`. `kind` is `RESERVATION`, `VISIT` or `WAITLIST_HOLD`. `turnNo` is currently null. `flags` only contains structured `NEW` or `RETURNING`; notes are never parsed. The response never includes raw notes, full phone numbers, ciphertext or HMAC fields.

The endpoint performs two fixed-count reads inside one read-only `REPEATABLE READ` transaction. `serverNow` is the application clock instant used for every derived state and `changeSeq` is returned as a decimal string. Groups use persisted IDs and symbol numbers; display codes use Excel-style letters (`1 => ◆A`, `26 => ◆Z`, `27 => ◆AA`). The legacy `state` and `activeVisit` fields remain during rollout, but `activeVisit.note` is always null. GET has no lifecycle write side effects.

Catalog venue fields include `id,version,name,timezone,businessDayStartLocal,businessDayCutoffLocal,upcomingWarningMinutes,lateWarningMinutes,noShowWarningMinutes,waitlistHoldDefaultMinutes,waitlistClaimLeaseSeconds,reservationHoldPolicy,reservationWindowMinutes,groupSymbolCount,changeSeq`. The centralized arrival defaults are 10/15/30 minutes. Zones contain `id,version,code,name,isBookable,isWaitingArea`. Catalog tables contain `id,version,code,displayName,zoneId,zoneCode,kind,capacity,seqNo,isSpare,status,x,y,width,height`. Combinations contain `id,code,displayName,memberIds,capacity`.

**Direct status changes are unsupported in v1.** The status route accepts `AVAILABLE`, `RESERVED` or `IN_USE`, verifies table organization/venue (404 outside scope), checks `expectedVersion` if present (409 `VERSION_CONFLICT`), then returns 409 `TABLE_STATE_DERIVED`. It never creates an allocation, modifies the table or writes a mutation audit event. Use assign, check-in, move and close instead. Use the owner-only configuration route for manual `OUT_OF_SERVICE` / `ACTIVE` changes.

Spare configuration is persistent rather than per-day. `reason` is required, at most 500 characters. Provide at least one of `isSpare` or `status`; status supports `ACTIVE` and `OUT_OF_SERVICE`. The table must have no unreleased allocations (holds or visits, on any date), and at least one supplied value must change. `venue.configure` is granted only to OWNER_ADMIN. Successful configuration changes audit the actor and bump the table version. Sending `isBackup` to the status route returns 400 `FIXED_SPARE_TABLE`.

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
| POST | `/bookings/:id/call` | Both `booking.phone.reveal` and `customer.phone.reveal` | Empty object; 201 `{callId,bookingId,initiatedAt,telUri}` with `Cache-Control: no-store` |
| POST | `/bookings/:id/calls/:callId/outcome` | `booking.phone.reveal` | Body `{outcome,bookingVersion?}`; records one result for the call |
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
  "classification":"NEW"
}
```

`guestName` is required (1-120 characters), `partySize` 1-500, `sourceCode` must exist and be active, `note` at most 500 characters. `phoneNumber` is optional: omitted on update retains the existing phone; null or blank removes it; a nonblank value is validated and encrypted. Update sends the complete booking fields, not a partial patch. Cancel `reasonNote` is at most 300 characters.

`BookingView` is `{id,guestName,phoneLast3,partySize,expectedAt,businessDate,classification,status,source,sourceCode,tableCodes,note,version,displayStatus,minutesLate,autoNoShowDue,canCall}`. `status` is `BOOKED`, `CHECKED_IN`, `CANCELLED` or `NO_SHOW`. For an active `BOOKED` reservation, display timing uses the current venue thresholds: `upcoming_warning_minutes` controls the pre-arrival window, `late_warning_minutes` controls the late boundary and `no_show_warning_minutes` controls the visual no-show boundary. Their seeded defaults are 10/15/30 minutes. Display `NO_SHOW` is non-terminal: `status` stays `BOOKED`, allocations and holds remain active, and `autoNoShowDue` stays false until an authorized user performs the manual no-show action. Search matches guest names or exactly three trailing phone digits. List, detail, search and mutation responses never contain a full stored phone or cryptographic fields. Export contains no phone fields, including suffixes.

Booking creation does not allocate tables or create a visit. Assign creates/replaces a hold; check-in requires an assigned booking and converts the hold to a visit/usage allocation. Cancel/no-show are explicit staff actions for `BOOKED` reservations and release their holds. Warnings after 15 and 30 minutes do not cancel or release anything. `NO_SHOW_WORKER_ENABLED` remains false.

Direct creation atomically creates the reservation, its hold, allocations and (for multiple tables) a group, with `RESERVATION_CREATED_AND_ASSIGNED` auditing. It requires a nonempty selection in one bookable zone, compatible table kinds, ACTIVE/non-spare tables, sufficient capacity and no same-date allocation conflicts. Any validation or audit failure rolls back the entire operation, including the reservation. Single Bar seats have capacity one. It does not create a visit; check in later through the normal route.

Merges preserve existing tables, add at least one table, require compatible kinds in one zone and sufficient combined capacity, and create/reuse an active group symbol. Reassignment may select multiple same-kind tables across bookable zones without adjacency configuration; multiple targets receive a shared group. Assignments reject spare/inactive tables and occupied allocations. The backend locks table rows and revalidates concurrent requests; a lost race returns 409 rather than double seating. No fixed seating duration is assumed.

Walk-ins require the current business date during operating hours; errors are `WALK_IN_OUTSIDE_BUSINESS_HOURS` or `BUSINESS_DATE_NOT_CURRENT`. A reservation for another date does not authorize a walk-in for that date. Name and phone are optional; an omitted name is stored/displayed as `Khách Walk-in`. An optional phone is protected through the existing encrypted customer identity and is never returned by this endpoint. The mutation locks and validates ACTIVE/non-spare tables in one bookable zone with compatible kinds and sufficient total capacity, rejects any unreleased allocation (including confirmed booking holds), creates a canonical group for multiple tables without an adjacency requirement, then writes the Visit, USAGE allocations, `WALK_IN_CREATED` audit and one venue `change_seq` increment atomically. An `Idempotency-Key` replay shares the same transaction and produces one domain effect.

### Late confirmation (TU-12)

`BookingView` and the atomic Floor Projection expose nullable `lateConfirmedAt`; neither exposes the confirming user or any unmasked phone data. The late-confirm response is intentionally minimal and contains no note, phone, ciphertext, HMAC or CRM fields. Late confirmation requires a current-business-date `BOOKED` reservation with an active table claim, no visit, a matching optimistic-lock version, and server time after `expectedAt` but before the no-show threshold. It increments the reservation version and venue change sequence once and writes `RESERVATION_LATE_CONFIRMED`. An exact retry of that successful input version is idempotent; unrelated stale versions return 409. Other 409 cases include wrong business date, terminal/check-in state, missing active claim and pre-arrival use. A new confirmation at/after the no-show threshold returns 409 `LATE_CONFIRM_NO_SHOW_THRESHOLD_REACHED`.

**Business Decision — Option A:** `LATE_CONFIRMED` does not extend a booking. It is rendered only before the configured no-show threshold. At exactly `expectedAt + no_show_warning_minutes`, `NO_SHOW` wins even when a prior confirmation exists. This is a display warning only: the reservation remains `BOOKED`, its confirmation history, hold, allocations and table group remain intact, and check-in is still allowed under the normal permission/business-date rules. Only the existing manual no-show or cancel workflow terminates the lifecycle and releases the tables.

### Calling a booking contact (TU)

The atomic Floor Projection and `BookingView` expose only `canCall` plus the existing `phoneLast3`. The server computes `canCall`; clients must not infer it from their device clock. It is true only for a current-business-date `BOOKED` reservation with a valid encrypted phone, an active table claim, and a server-derived state of `UPCOMING`, `LATE` or `LATE_CONFIRMED`. The pre-arrival boundary uses the venue `upcoming_warning_minutes` setting (default 10 minutes and dynamically updateable through `/settings`). `NO_SHOW`, checked-in, closed, unassigned and phone-less bookings are not callable.

`POST /bookings/:id/call` accepts no phone number. Because its RFC 3966 `tel:` response contains the full number, it uses the same fail-closed disclosure policy, per-user/booking rate limiter, dual `booking.phone.reveal` + `customer.phone.reveal` permissions and actor venue scope as `phone:reveal`. The server then rechecks all call eligibility conditions using `applicationNow()`, decrypts the phone only after acceptance, creates one `booking_call_logs` row, and returns the private/no-store response. Neither the URI nor the full number is written to `operation_log`, the floor projection, normal application logs or browser storage. A `tel:` URI necessarily exposes the number to the receiving browser/phone application and may be visible in browser developer tools. FX-20 LAN calling is not implemented.

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
theo `expected_at` với cutoff 21:30 giờ Việt Nam (`>=` thuộc nhóm sau); O/N đếm booking theo classification và báo
riêng số `UNCLASSIFIED`. Endpoint chỉ trả text; không gửi sang Zalo.



### Phone protection

Receptionists never receive a full stored phone, including from `phone:reveal`. That route requires both permissions above; an owner can explicitly reveal a number. It applies per-user/booking rate limits, writes a redacted audit record before returning a number, and sets `Cache-Control: no-store, private, max-age=0` plus `Pragma: no-cache`. Audit failure prevents disclosure. Missing encryption/HMAC keys or rate-limit policy fail closed with 503.

Migration 0005 (`0005_revoke_receptionist_phone_reveal.sql`) revokes the historical `booking.phone.reveal` grant from RECEPTIONIST. Both `booking.phone.reveal` and `customer.phone.reveal` remain required in code; only OWNER_ADMIN has the reveal grant in the current roles.

`[?]` Receptionist calling remains a PO/BA decision. Do not broaden either reveal permission implicitly. If operational staff must call without receiving general-purpose phone-reveal access, introduce a dedicated sensitive permission (for example `booking.call.initiate`) whose route still enforces the fail-closed disclosure policy, rate limit, tenant/venue scope and audit requirements.

## Visits

| Method | Path | Permission | Request / response |
| --- | --- | --- | --- |
| POST | `/visits/:id/close` | `visit.end` | Body `{version,mode:"MANUAL",reason,note?}`; `{visit:ClosedVisitView}` |
| POST | `/visits/:id/move` | `visit.move` | Body `{version,tableIds,note?}`; `{visit:MovedVisitView}` |
| POST | `/visits/:id/merge` | `visit.combine` | Body `{version,tableIds}`; `{visit:MovedVisitView,group:{id,symbolNo,tableIds}}` |

Manual close reasons are `GUEST_LEFT` or `ENTRY_ERROR`; note is optional, at most 500 characters. Closing releases the visit allocations and dissolves unused groups. `ClosedVisitView` is `{id,businessDate,status:"CLOSED",endedAt,endReason,version,releasedTables:[{id,code}]}`. `MovedVisitView` is `{id,businessDate,version,previousTables:[{id,code}],tables:[{id,code}]}`. Move validates capacity and same-kind targets, allows multiple tables across bookable zones without adjacency configuration, and creates or retains their shared group. It rejects every unreleased USAGE allocation on target tables regardless of business date, plus holds on the visit's business date. Merge follows the group rules above.

`BUSINESS_DAY_WORKER_ENABLED` defaults to `true`; `BUSINESS_DAY_WORKER_INTERVAL_MS` defaults to `30000`. The worker sweeps on startup and then at that interval. Each open visit becomes eligible at the venue's next-day business cutoff (05:00 in `Asia/Ho_Chi_Minh` with the default venue configuration). At or after the cutoff, one transaction ends the visit, releases all its active USAGE allocations, dissolves groups with no remaining allocations, increments the visit version/change sequence and audits `VISIT_AUTO_CLOSED_BUSINESS_DAY` as SYSTEM. Visit/allocation reasons are `BUSINESS_DAY_END`, with null staff actor IDs. Migration 0006 enables these reasons; migration 0007 permits system group dissolution only with `dissolve_reason = 'BUSINESS_DAY_END'` while preserving staff attribution on manual dissolution. The worker revalidates each scanned candidate under a lock and skips stale versions; a later sweep rescans them. Audit failure rolls the transaction back.

Carry-over occupancy remains visible and `staleFromPreviousDay` remains true on the current business-date projection until allocations are actually released. Past-date behavior is unchanged. A future business-date projection excludes earlier `USAGE` allocations and includes only exact-date `USAGE`, while reservation and waitlist holds remain scoped to the selected date. This projection filter never releases or rewrites allocations. It covers the interval before the worker runs and operation with the worker disabled; GET never performs a release. Auto-close takes precedence once its transaction commits, so subsequent current-date floor reads show the tables free and remove empty groups. It closes visits only: unreleased reservation/waitlist holds remain reserved on their own business date, CHECKED_IN reservations retain their status, and linked waitlist entries already closed as SEATED retain their closure metadata, version and WAITLIST_SEATED audit. There is no second waitlist cancellation or seating event at business-day end.

`AFTER_PAYMENT` is recognized but rejected because a trusted payment verifier is unavailable (`PAYMENT_VERIFICATION_UNAVAILABLE`). The API does not provide a payment-confirmation endpoint.

## Waitlist

| Method | Path | Permission | Request / response |
| --- | --- | --- | --- |
| GET | `/waitlist?date=YYYY-MM-DD` | `customer.view_masked` | `{businessDate,entries:WaitlistEntryView[]}` |
| POST | `/waitlist` | `waitlist.create` | Body WALK_IN `{kind?:"WALK_IN",guestName,partySize,businessDate,contactChannel,phoneNumber?,note?}` or ADVANCE `{kind:"ADVANCE_RESERVATION",reservationId,businessDate,contactChannel,note?}`; 201 `{entry}` |
| POST | `/waitlist/:id/seat` | `waitlist.accept_offer` + `reservation.create` + `table.assign` | Body `{version,tableIds,arrived?}`; `{entry,reservationId,groupId}` |
| POST | `/waitlist/:id/cancel` | `waitlist.cancel` | Body `{version,reasonCode,note?}`; `{entry}` |
| POST | `/waitlist/:id/contact-attempts` | `waitlist.record_contact` | Body `{version,channel,outcome,note?}`; `{entry}` |

`WaitlistEntryView` is `{id,kind,guestName,phoneLast3,partySize,businessDate,queuedAt,status,contactChannel,reservationId,reservationExpectedAt,visitId,note,version}`. `kind` is `ADVANCE_RESERVATION` or `WALK_IN`; omitted kind creates `WALK_IN`. Advance entries require a BOOKED reservation in the actor organization/venue on the same business date, without active holds or allocations; an existing non-terminal entry returns 409. Guest name and party size come from the reservation and must not be sent for advance entries. `reservationExpectedAt` is the ISO UTC appointment time for advance entries and null for walk-ins. Lists order by priority_class (advance before walk-in), queuedAt, then id. `status` is `WAITING`, `CONTACTING`, `OFFERED`, `HOLD_ACTIVE`, `SEATED`, `DECLINED` or `CANCELLED`. Only `phoneLast3` is returned. Optional WALK_IN `phoneNumber` uses the existing encrypted customer identity and duplicate checks. Phone numbers in creation notes are rejected.

Creation validates guest name (1-120), party size (1-500), date, channel and note (at most 500 characters). Its `contactChannel` values are `IN_PERSON`, `PHONE_CALLBACK`, `ZALO_THREAD`, `FANPAGE_THREAD`, `OTHER`. Creation, cancellation and contact-attempt notes are trimmed and reject phone numbers, including spaced, dotted and dashed forms, with 422 `PHONE_IN_NOTE_FORBIDDEN` before any repository mutation.

Seat supports WALK_IN entries in WAITING and ADVANCE_RESERVATION entries in WAITING, CONTACTING or OFFERED. Both lock the entry and tables, enforce same zone/type, bookable zone, capacity, ACTIVE/non-spare tables and same-date allocation conflicts. For a present WALK_IN, `{arrived:true}` is valid only on the current business date and atomically creates a Visit plus USAGE allocations (and a shared group for multiple tables), marks the entry SEATED, writes `WAITLIST_SEATED`, and increments venue `change_seq`; it does not create a reservation. Without `arrived:true`, WALK_IN creates a BOOKED reservation with classification UNCLASSIFIED; ADVANCE_RESERVATION reuses its BOOKED reservation (same business date, no existing active hold/allocation) and increments its version. Those booking paths create a RESERVATION hold, one HOLD allocation per table and a shared group for multiple tables, then mark the entry HOLD_ACTIVE and audit `WAITLIST_ASSIGNED_TO_RESERVATION`. Later normal booking check-in converts grouped holds to usage, creates the visit and closes the linked waitlist entry as SEATED with SEATED_OTHERWISE metadata and a `WAITLIST_SEATED` audit in the same transaction. `arrived:true` is rejected for ADVANCE_RESERVATION. Cancel/no-show of a reservation closes its open waitlist entry as RESERVATION_CANCELLED. All changes roll back together if auditing fails. No offer/hold automation is introduced.

Cancel supports all non-terminal statuses (`WAITING`, `CONTACTING`, `OFFERED`, `HOLD_ACTIVE`). Allowed `reasonCode` values from the existing schema are `CUSTOMER_DECLINED`, `CUSTOMER_WITHDREW`, `NO_SHOW_AFTER_ACCEPT`, `RESERVATION_CANCELLED`, `SEATED_OTHERWISE`, `DUPLICATE`, `ENTRY_ERROR`, `OTHER`. Note is optional, at most 300 characters. Cancellation clears a contact claim and explicitly releases the entry's active waitlist hold/allocations, dissolves unused groups, records closure metadata and bumps the entry version. Cancelling a booking-linked entry does not cancel the reservation. Audit `WAITLIST_CANCELLED` and all domain changes commit together.

Contact recording uses the existing `waitlist_contact_attempts` table. Its channel values differ from creation: `IN_PERSON`, `PHONE_BY_AUTHORIZED`, `ZALO_THREAD`, `FANPAGE_THREAD`, `OTHER`. Outcomes are `NO_ANSWER`, `CALLBACK_REQUESTED`, `OFFER_PENDING`, `ACCEPTED`, `DECLINED_OFFER`, `KEEP_WAITING`, `WITHDREW`, `WRONG_CONTACT`. Note is optional, at most 300 characters. The entry lock serializes attempt numbering; each completed attempt records the authenticated user, server timestamps, channel/outcome/note, bumps entry version and writes `WAITLIST_CONTACT_RECORDED` atomically. Recording an outcome does not change entry status or create an offer, hold or visit. Terminal entries reject both mutations with 409 `WAITLIST_TERMINAL`; stale versions return 409 `VERSION_CONFLICT` first. Unknown/out-of-scope entries return 404 `WAITLIST_NOT_FOUND`.

## Unavailable capabilities

There are no implemented endpoints for customer search/profile/notes, operation-log listing, undo/redo, reports, venue configuration, zone flags, hold deadlines/releases, group split, waitlist claim/release-claim, or standalone visits/allocations lists. A catalog exposing lease/hold configuration does not imply that those write APIs exist. Unknown routes return 404; HTTP adapters may expose these unavailable methods as explicit 501 `NOT_SUPPORTED_BY_BACKEND` errors. Direct table-state writes and payment-verified closing have the restrictions described above.

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

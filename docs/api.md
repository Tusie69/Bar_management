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
- `Idempotency-Key` is not enforced. Disable duplicate submission in clients.
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
| POST | `/auth/login` | Trusted origin | Body `{username,password}`; returns `{user,permissions,csrfToken,expiresAt}` and session cookie |
| GET | `/auth/me` | Session | `{user,permissions,csrfToken}` |
| POST | `/auth/logout` | Session + CSRF | 204, no body |

`user` contains `{id,username,displayName,organizationId,venueId,roles}`; `roles` contains the active membership role codes for this venue. Raw session tokens are never included in JSON. Login is limited after five failed attempts for the same IP/username in a 15-minute window.

## Tables and catalog

| Method | Path | Permission | Request / response |
| --- | --- | --- | --- |
| GET | `/tables/catalog` | `customer.view_masked` | `{venue,zones,tables,combinations}` |
| GET | `/tables?date=YYYY-MM-DD` | `customer.view_masked` | `{businessDate,tables:TableView[],groups:FloorGroupView[]}` |
| PATCH | `/tables/:id/status` | `table.assign` | Body `{businessDate,state,expectedVersion?,reason?}`; see limitation below |
| PATCH | `/tables/:id/configuration` | `venue.configure` | Body `{isSpare?:boolean,status?:"ACTIVE"|"OUT_OF_SERVICE",version,reason}`; returns `{table:{id,code,isBackup,status,version}}` |

`TableView` contains `{id,code,displayName,type,capacity,area:{code,name,floor},position:{x,y},state,isBackup,version,staleFromPreviousDay,allocationBusinessDate,activeVisit}`. `state` is `AVAILABLE`, `RESERVED`, `IN_USE` or `OUT_OF_SERVICE`. `activeVisit` is null or `{id,version,tableCodes,displayName,phoneLast3,guestCount,startedAt,origin,paid,note}`. The floor includes unreleased allocations on or before the requested business date. `staleFromPreviousDay` flags earlier allocations and `allocationBusinessDate` is their oldest date; GET never releases them. Future allocations are excluded. `FloorGroupView` is `{id,symbolNo,tableIds}` and contains active groups with at least two allocations.

Catalog venue fields include `id,version,name,timezone,businessDayStartLocal,businessDayCutoffLocal,lateWarningMinutes,noShowWarningMinutes,waitlistHoldDefaultMinutes,waitlistClaimLeaseSeconds,reservationHoldPolicy,reservationWindowMinutes,groupSymbolCount,changeSeq`. Zones contain `id,version,code,name,isBookable,isWaitingArea`. Catalog tables contain `id,version,code,displayName,zoneId,zoneCode,kind,capacity,seqNo,isSpare,status,x,y,width,height`. Combinations contain `id,code,displayName,memberIds,capacity`.

**Direct status changes are unsupported in v1.** The status route accepts `AVAILABLE`, `RESERVED` or `IN_USE`, verifies table organization/venue (404 outside scope), checks `expectedVersion` if present (409 `VERSION_CONFLICT`), then returns 409 `TABLE_STATE_DERIVED`. It never creates an allocation, modifies the table or writes a mutation audit event. Use assign, check-in, move and close instead. Use the owner-only configuration route for manual `OUT_OF_SERVICE` / `ACTIVE` changes.

Spare configuration is persistent rather than per-day. `reason` is required, at most 500 characters. Provide at least one of `isSpare` or `status`; status supports `ACTIVE` and `OUT_OF_SERVICE`. The table must have no unreleased allocations (holds or visits, on any date), and at least one supplied value must change. `venue.configure` is granted only to OWNER_ADMIN. Successful configuration changes audit the actor and bump the table version. Sending `isBackup` to the status route returns 400 `FIXED_SPARE_TABLE`.

## Bookings

| Method | Path | Permission | Request / response |
| --- | --- | --- | --- |
| GET | `/bookings?date=YYYY-MM-DD` | `customer.view_masked` | `{businessDate,bookings:BookingView[]}` |
| GET | `/bookings/sources` | `customer.view_masked` | `{sources:[{code,name}]}`; active organization sources |
| GET | `/bookings/search?date=YYYY-MM-DD&q=...` | `customer.view_masked` | `{businessDate,query,bookings}`; up to 100 results |
| GET | `/bookings/export?date=YYYY-MM-DD` | `customer.view_masked` | UTF-8 `text/plain` Zalo summary and booking statistics, no phone fields |
| GET | `/bookings/:id` | `customer.view_masked` | `{booking:BookingView}` |
| POST | `/bookings` | `reservation.create` | Body `BookingInput`; 201 `{booking}` |
| PUT | `/bookings/:id` | `reservation.update` | Body `BookingInput` plus `version`; `{booking}` |
| POST | `/bookings/:id/assign` | `table.assign` | Body `{version,tableIds}`; `{booking}` |
| POST | `/bookings/:id/merge` | `visit.combine` | Body `{version,tableIds}`; `{booking,group:{id,symbolNo,tableIds}}` |
| POST | `/bookings/:id/cancel` | `reservation.cancel` | Body `{version,reasonNote?}`; `{booking}` |
| POST | `/bookings/:id/no-show` | `reservation.mark_no_show` | Body `{version}`; `{booking}` |
| POST | `/bookings/:id/check-in` | `visit.checkin` | Body `{version}`; `{booking}` |
| POST | `/bookings/:id/phone:reveal` | Both `booking.phone.reveal` and `customer.phone.reveal` | `{phoneNumber}`; owner-only under seeded roles |
| POST | `/bookings/walk-ins` | `visit.walkin` | Body `{partySize,businessDate,tableIds,guestName?}`; 201 `{visitId}` |

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

`BookingView` is `{id,guestName,phoneLast3,partySize,expectedAt,businessDate,classification,status,source,sourceCode,tableCodes,note,version,displayStatus,minutesLate,autoNoShowDue}`. `status` is `BOOKED`, `CHECKED_IN`, `CANCELLED` or `NO_SHOW`. Search matches guest names or exactly three trailing phone digits. List, detail, search and mutation responses never contain a full stored phone or cryptographic fields. Export contains no phone fields, including suffixes.

Booking creation does not allocate tables or create a visit. Assign creates/replaces a hold; check-in requires an assigned booking and converts the hold to a visit/usage allocation. Cancel/no-show are explicit staff actions for `BOOKED` reservations and release their holds. Warnings after 15 and 30 minutes do not cancel or release anything. `NO_SHOW_WORKER_ENABLED` remains false.

Merges preserve existing tables, add at least one table, require compatible kinds in one zone and sufficient combined capacity, and create/reuse an active group symbol. Assignments reject spare/inactive tables and occupied allocations. The backend locks table rows and revalidates concurrent requests; a lost race returns 409 rather than double seating. No fixed seating duration is assumed.

Walk-ins require the current business date during operating hours; errors are `WALK_IN_OUTSIDE_BUSINESS_HOURS` or `BUSINESS_DATE_NOT_CURRENT`. A reservation for another date does not authorize a walk-in for that date.

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

## Visits

| Method | Path | Permission | Request / response |
| --- | --- | --- | --- |
| POST | `/visits/:id/close` | `visit.end` | Body `{version,mode:"MANUAL",reason,note?}`; `{visit:ClosedVisitView}` |
| POST | `/visits/:id/move` | `visit.move` | Body `{version,tableIds,note?}`; `{visit:MovedVisitView}` |
| POST | `/visits/:id/merge` | `visit.combine` | Body `{version,tableIds}`; `{visit:MovedVisitView,group:{id,symbolNo,tableIds}}` |

Manual close reasons are `GUEST_LEFT` or `ENTRY_ERROR`; note is optional, at most 500 characters. Closing releases the visit allocations and dissolves unused groups. `ClosedVisitView` is `{id,businessDate,status:"CLOSED",endedAt,endReason,version,releasedTables:[{id,code}]}`. `MovedVisitView` is `{id,businessDate,version,previousTables:[{id,code}],tables:[{id,code}]}`. Move validates connected target tables and capacity; merge follows the group rules above.

`AFTER_PAYMENT` is recognized but rejected because a trusted payment verifier is unavailable (`PAYMENT_VERIFICATION_UNAVAILABLE`). The API does not provide a payment-confirmation endpoint.

## Waitlist

| Method | Path | Permission | Request / response |
| --- | --- | --- | --- |
| GET | `/waitlist?date=YYYY-MM-DD` | `customer.view_masked` | `{businessDate,entries:WaitlistEntryView[]}` |
| POST | `/waitlist` | `waitlist.create` | Body WALK_IN `{kind?:"WALK_IN",guestName,partySize,businessDate,contactChannel,phoneNumber?,note?}` or ADVANCE `{kind:"ADVANCE_RESERVATION",reservationId,businessDate,contactChannel,note?}`; 201 `{entry}` |
| POST | `/waitlist/:id/seat` | `waitlist.accept_offer` + `reservation.create` + `table.assign` | Body `{version,tableIds}`; `{entry,reservationId,groupId}` |
| POST | `/waitlist/:id/cancel` | `waitlist.cancel` | Body `{version,reasonCode,note?}`; `{entry}` |
| POST | `/waitlist/:id/contact-attempts` | `waitlist.record_contact` | Body `{version,channel,outcome,note?}`; `{entry}` |

`WaitlistEntryView` is `{id,kind,guestName,phoneLast3,partySize,businessDate,queuedAt,status,contactChannel,reservationId,reservationExpectedAt,visitId,note,version}`. `kind` is `ADVANCE_RESERVATION` or `WALK_IN`; omitted kind creates `WALK_IN`. Advance entries require a BOOKED reservation in the actor organization/venue on the same business date, without active holds or allocations; an existing non-terminal entry returns 409. Guest name and party size come from the reservation and must not be sent for advance entries. `reservationExpectedAt` is the ISO UTC appointment time for advance entries and null for walk-ins. Lists order by priority_class (advance before walk-in), queuedAt, then id. `status` is `WAITING`, `CONTACTING`, `OFFERED`, `HOLD_ACTIVE`, `SEATED`, `DECLINED` or `CANCELLED`. Only `phoneLast3` is returned. Optional WALK_IN `phoneNumber` uses the existing encrypted customer identity and duplicate checks. Phone numbers in creation notes are rejected.

Creation validates guest name (1-120), party size (1-500), date, channel and note (at most 500 characters). Its `contactChannel` values are `IN_PERSON`, `PHONE_CALLBACK`, `ZALO_THREAD`, `FANPAGE_THREAD`, `OTHER`. Creation, cancellation and contact-attempt notes are trimmed and reject phone numbers, including spaced, dotted and dashed forms, with 422 `PHONE_IN_NOTE_FORBIDDEN` before any repository mutation.

Seat supports WALK_IN entries in WAITING and ADVANCE_RESERVATION entries in WAITING, CONTACTING or OFFERED. Both use the main booking-hold flow: lock entry and tables, enforce same zone/type, bookable zone, capacity, ACTIVE/non-spare tables and same-date allocation conflicts. WALK_IN creates a BOOKED reservation with classification UNCLASSIFIED; ADVANCE_RESERVATION reuses its BOOKED reservation (same business date, no existing active hold/allocation) and increments its version. Both create a RESERVATION hold, one HOLD allocation per table and a shared table group for multiple tables, then mark the entry HOLD_ACTIVE and audit WAITLIST_ASSIGNED_TO_RESERVATION. No visit is created by this route. Later normal booking check-in converts the grouped holds to usage, creates the visit and closes the waitlist entry as SEATED with SEATED_OTHERWISE metadata and a WAITLIST_SEATED audit in the same transaction. Cancel/no-show of a reservation closes its open waitlist entry as RESERVATION_CANCELLED. All changes roll back together if auditing fails. This preserves main's flow per coordinator decision 2026-10-31 and supersedes the immediate check-in detail in contract v1.1. No offer/hold automation is introduced.

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

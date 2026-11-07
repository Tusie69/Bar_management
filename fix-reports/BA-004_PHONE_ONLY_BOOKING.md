# BA-004 — Phone-only booking

## 1. Git baseline

- Baseline local/remote `develop`: `3b04b469487fbb87200ad4341e817749469862ad`.
- Work branch: `codex/ba-004-phone-only-booking`.
- Source/test commit: `5cf5bb4` (`fix(booking): support phone-only reservations`).
- No push, merge, rebase, migration, or development/production database operation was performed.
- Local `.env` files and untracked `audit-reports/` were preserved.

## 2. Root cause

The Sprint 2 forms and mock service already implemented US-01 as “name or phone”. The real HTTP path did not:

1. `bookingBody()` in `api/src/modules/bookings/booking.route.ts` always called `requiredText()` for `guestName`, rejecting omitted, null, empty, and whitespace-only names before phone validation or persistence.
2. `commonPayload()` in `web/src/services/http/booking-adapter.ts` independently rejected an empty name, so real HTTP submission failed even though desktop/mobile form validation enabled it.
3. `reservations.ck_reservations_contact` requires `customer_id` or `contact_name`. A phone-only reservation therefore must resolve a canonical Customer; inserting only protected phone columns is not sufficient.
4. The response fallback `Khách` did not distinguish a display label from stored identity. A later full update could otherwise persist that fallback as a real name.

## 3. Relevant US-01 rule

- Name only: valid.
- Valid phone only: valid.
- Name and phone: valid.
- Neither: `400 BOOKING_CONTACT_REQUIRED`.
- Invalid phone only: existing `422 INVALID_PHONE_NUMBER` behavior.
- Whitespace-only name is absent, not an identity.
- Walk-in anonymity from BA-003 remains unchanged.

## 4. Backend request contracts

Create and direct-create accept optional `guestName`. The route trims it and requires at least one effective identity. Null, empty, and whitespace-only names are normalized to absence. Existing phone length, normalization, encryption, and validation remain unchanged.

Update accepts a missing name only when the stored phone is retained or a new valid phone is supplied. Removing the phone while no name exists is rejected. The API now returns `hasGuestName`; `guestName` continues to use the existing safe display fallback.

## 5. Customer resolution

Phone-only creation protects the normalized phone first, then atomically upserts an organization-scoped Customer using the existing unique `(organization_id, phone_hmac)` identity. Concurrent requests converge on one Customer. An existing active Customer is reused; its stored name is neither cleared nor overwritten.

Named bookings retain their established reservation-contact storage path. This avoids changing legacy identity behavior outside BA-004. Phone-only reservations link `customer_id` and continue storing the booking-contact ciphertext/HMAC fields required by existing reveal/update contracts.

## 6. Database/schema impact

No migration is needed. The existing nullable Customer name, phone all-or-none constraints, unique organization phone HMAC, reservation foreign key, and reservation contact constraint already support the canonical phone-only model.

The simple create path now opens its own transaction when no BA-002 shared connection is supplied. When a shared idempotency transaction is supplied, it never commits, rolls back, or releases that connection.

## 7. Frontend/mobile changes

- HTTP payload validation now implements name-or-phone instead of name-only.
- Empty names are omitted from create/direct-create payloads; no fake identity is sent.
- `hasGuestName=false` prevents the display fallback from being copied into a later full update.
- Existing Sprint 2 desktop, mobile, table-first, direct booking, waitlist, and responsive layouts were not redesigned.
- Real-browser tests create phone-only direct bookings from both 1280×800 desktop and 390×844 mobile floor forms.

## 8. API contract changes

`BookingView` adds `hasGuestName: boolean`. `guestName` remains a non-null display string for backward-compatible rendering. Phone-only list/detail/floor output exposes only `phoneLast3`; no full phone or cryptographic material is returned.

`docs/api.md` documents identity validation, canonical Customer resolution, update semantics, and the display-label distinction.

## 9. Privacy and security review

- Existing Vietnamese phone normalization is unchanged.
- AES-GCM ciphertext, deterministic HMAC, key IDs, and last-three storage remain all-or-none.
- Plaintext phone is absent from booking/list/floor/waitlist responses, audit changes, browser DOM, and test output.
- Existing RBAC, CSRF, venue filtering, reveal permissions, no-store headers, and rate limiting are unchanged and passed regression.
- No secret signature, `.env`, dump, key file, or migration is present in the diff.

## 10. BA-002 idempotency compatibility

Customer upsert and reservation creation use the same `PoolConnection` as BA-002 idempotency completion. Fault injection proves that a completion failure rolls back Customer, reservation, and idempotency row together. A retry creates one domain effect, and replay returns the same booking. Concurrent same-phone creation produces distinct bookings under one canonical Customer.

## 11. Files changed

Source:

- `api/src/modules/bookings/booking.route.ts`
- `api/src/modules/bookings/booking.repository.ts`
- `web/src/services/http/booking-adapter.ts`
- `docs/api.md`

Tests and HTTP/browser fixtures:

- `api/test/booking-lifecycle.mysql.test.ts`
- `api/test/support/phase2b-e2e-fixture.ts`
- `web/src/services/http/booking-api.test.ts`
- `web/src/services/http/direct-booking.test.ts`
- `web/e2e/sprint2-booking-http.mjs`

## 12. New test coverage

| Cases | Result |
|---|---|
| PHONE-01/02 | Existing name+phone and name-only suites PASS |
| PHONE-03–06 | Phone-only with omitted/null/empty/whitespace name PASS |
| PHONE-07/08 | Missing identity and invalid phone rejected PASS |
| PHONE-09/10 | Existing phone Customer reused; existing name preserved PASS |
| PHONE-11 | Idempotency retry/replay creates one Customer/booking PASS |
| PHONE-12/23 | Six concurrent normalized same-phone creates share one identity PASS |
| PHONE-13/14 | Ciphertext/HMAC storage and masked responses PASS |
| PHONE-15 | Existing organization/venue isolation regression PASS; no new cross-organization browser scenario |
| PHONE-16 | Direct phone-only booking PASS |
| PHONE-17 | ADVANCE waitlist from phone-only reservation PASS |
| PHONE-18/19 | Real HTTP mobile and desktop submission PASS |
| PHONE-20 | Floor Projection renders `Khách đặt` and masked suffix PASS |
| PHONE-21 | Customer/booking/idempotency atomic rollback PASS |
| PHONE-22 | Anonymous BA-003 Walk-in remains valid PASS |

## 13. MySQL results

Only `gam21_platform_it_test` was used. The `_test` suffix and zero active connections were verified before writes. Final full run:

- 30 test files passed, 1 opt-in file skipped.
- 419 tests passed, 13 opt-in tests skipped, 0 failed.
- Targeted booking lifecycle, booking phone, assignment, concurrency, encryption, masking, fault injection, BA-002, and BA-003 coverage passed.

No development/production database or migration was touched.

## 14. HTTP E2E results

- Phase 2B: 17/17 PASS; cleanup count `0`.
- NA-11: 11/11 check groups PASS across five viewports; `errors=[]`; cleanup count `0`.
- Sprint 2 HTTP: BA-004 desktop and mobile plus AT1–AT13 PASS; cleanup count `0`.
- Auth/RBAC, CSRF, polling/change sequence, masked phone, booking priority, allocation race, waitlist transitions, Q06 and Q10 paths remained green.

## 15. Mobile/desktop browser evidence

- Desktop 1280×800: phone-only table-first booking returned 201, omitted `guestName`, returned `hasGuestName=false` and only suffix `222`.
- Mobile 390×844: phone-only table-first booking returned 201, floor projection rendered `Khách đặt`, and only suffix `444` was visible.
- Both checks assert that the plaintext synthetic phone is absent from the DOM.

## 16. Regression summary

| Gate | Result |
|---|---|
| Typecheck | PASS |
| Lint | PASS, 0 errors; 11 pre-existing warnings |
| Production HTTP build | PASS, 3,075 modules |
| API unit | PASS, 205/205 |
| Web unit | PASS, 340/340 |
| Full MySQL | PASS, 419/419; 13 opt-in skip |
| Phase 2B HTTP | PASS, 17/17 |
| NA-11 HTTP | PASS, 11/11 groups |
| Sprint 2 HTTP/browser | PASS, BA-004 desktop/mobile and AT1–AT13 |

Q03 15-minute slots, Q06 waitlist-arrival Visit creation, Q10 non-adjacent grouping, Q13 confirmed-booking priority, BA-002 shared transaction, BA-003 canonical Walk-in, business date, floor projection, and polling/change sequence all remain covered by passing regression suites.

## 17. Unresolved business decisions

No new business rule was assumed. Named bookings with phones continue their established reservation-contact behavior; BA-004 only adds canonical Customer linkage where the name is absent. Expanding canonical Customer linkage or customer-name reconciliation for every named booking would be a separate identity-policy change.

The explicit new test does not create the same phone under two different organizations; isolation is enforced structurally by the existing `(organization_id, phone_hmac)` unique key and existing venue/tenant regression tests.

## 18. Git status

The source/test commit is local only. This report is committed separately. `audit-reports/` remains untracked and `.env` files remain unchanged. Remote `origin/develop` remains at the baseline unless the user performs a later approved push.

## 19. Final verdict

**FIXED_AND_VERIFIED**


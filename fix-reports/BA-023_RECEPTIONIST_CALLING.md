# BA-023 — Receptionist Calling

## 1. Git baseline

- Repository: `Tusie69/Bar_management`
- Baseline and pre-change `develop` / `origin/develop`: `6455806dc19c521557be3a09018d3d66bab4885b`
- Source commit: `f0b1b15` (`fix(booking): allow receptionist customer calls`)
- BA-002, BA-003, BA-004 and Sprint 2 Final are ancestors of the source commit.
- Development and tests used branch `codex/ba-023-receptionist-calling`.
- Only disposable database `gam21_platform_it_test` was migrated. No development or production migration was run.

## 2. Root cause audit

| Question | Finding | Classification |
|---|---|---|
| Why Receptionist received 403 | `/bookings/:id/call` required both reveal permissions; migration 0005 correctly removed Receptionist reveal access | BUG |
| Call permission before BA-023 | `booking.phone.reveal` + `customer.phone.reveal` | BUG |
| Outcome permission before BA-023 | `booking.phone.reveal` | BUG |
| Full-phone reveal | Separate `/phone:reveal` route requires both reveal permissions and remains owner-only | DONE |
| Organization/venue scope | Repository predicates use both authenticated organization and venue | DONE |
| Booking state validation | Current business date, `BOOKED`, active claim and server-derived upcoming/late state are required | DONE |
| Phone-only booking | Encrypted phone is present and callable; no guest-name dependency | DONE |
| Booking without phone | Now returns `422 BOOKING_PHONE_UNAVAILABLE` without PII | FIXED |
| Decryption boundary | Repository decrypts only after authentication/RBAC, scope and business validation | DONE |
| Normal list/detail responses | Continue to expose only masked phone metadata (`phoneLast3`) | DONE |
| Audit | `BOOKING_CALL_INITIATED` stores actor/scope/booking/operation data, not the phone or `tel:` URI | DONE |
| CSRF/rate limit | Both remain enforced; the existing per-user/booking disclosure limiter is retained | DONE |
| Frontend mechanism | Direct user action calls the API and creates a transient `tel:` anchor | FIXED |
| Permission bypass | No server-side bypass found; frontend visibility is not treated as authorization | DONE |

## 3. Permission matrix

| Capability | Before Owner | Before Receptionist | After Owner | After Receptionist |
|---|---:|---:|---:|---:|
| Start call / record outcome | Yes | No | Yes | Yes |
| Reveal booking phone | Yes | No | Yes | No |
| Reveal customer phone | Yes | No | Yes | No |
| Masked customer data | Yes | Yes | Yes | Yes |

Migration `0014_add_booking_phone_call_permission.sql` creates sensitive permission `booking.phone.call` and grants it only to `OWNER_ADMIN` and `RECEPTIONIST`. It does not add or broaden either reveal grant.

## 4. Backend and API changes

- `POST /api/v1/bookings/:id/call` and the outcome route now require `booking.phone.call`.
- Authentication, CSRF, scope checks, rate limiting, eligibility, audit and `Cache-Control: no-store` behavior are unchanged and remain server-side.
- A phone-less booking returns the specific non-PII error before the generic call-state error.
- The existing `phone:reveal` endpoint is unchanged and still requires both `booking.phone.reveal` and `customer.phone.reveal`.
- Call initiation remains distinct from a successful connection. Outcome values are human-recorded and the UI does not infer `CALL_CONNECTED`.

## 5. Frontend changes

- Desktop, mobile map and reservation detail use `booking.phone.call` for visibility and execution.
- The client no longer blocks desktop user agents; it lets the browser/OS decide whether a registered dialer can handle `tel:`.
- The API response is consumed inside the click action and used to create a transient anchor. It is not written to React shared state, local storage or session storage.
- Mock permission behavior and E2E session fixtures match the production permission matrix.
- Loading and error behavior continue through the existing action/reporting path.

## 6. Privacy and security assessment

The MVP follows the PO-approved browser `tel:` option, but it is not hidden-number telephony. The authorized call response necessarily delivers the full number to browser JavaScript and then to the OS/dialer. A device user may see or copy it, and developer tools may observe the response. `no-store`, short-lived in-memory handling and the absence of web-storage/analytics persistence reduce exposure but cannot make the number secret from the device user.

For stronger concealment, a future release requires an OS/native bridge or backend-controlled telephony provider. Neither is part of BA-023.

## 7. Security test coverage (CALL-01 through CALL-20)

- CALL-01/02/03: Receptionist can call named and phone-only bookings through real HTTP.
- CALL-04: no-phone booking returns `422 BOOKING_PHONE_UNAVAILABLE` without PII.
- CALL-05/08/09: unauthorized role, no session and invalid/missing CSRF are rejected.
- CALL-06/07: cross-venue and cross-organization repository access resolves as not found.
- CALL-10/11/12: reveal remains owner-only; list/detail masking tests remain green.
- CALL-13/14: response is no-store and operation audit contains no plaintext phone.
- CALL-15: role matrix unit tests cover Owner, Receptionist, Cashier and Customer Care.
- CALL-16/17/18: real mobile and desktop browser flows open the controlled URI and confirm no full phone in DOM/localStorage/sessionStorage.
- CALL-19: existing rate limiter accepts the configured count then returns 429; accepted attempts create one log each.
- CALL-20: phone-only booking and all BA-004 browser flows remain green.

All test numbers are synthetic fixtures.

## 8. Regression results

| Gate | Result |
|---|---|
| Typecheck | PASS |
| Lint | PASS; only pre-existing Fast Refresh/hooks warnings |
| Production HTTP build | PASS |
| API unit | PASS — 205/205 |
| Web unit | PASS — 342/342 |
| Targeted MySQL | PASS — 127/127 |
| Full MySQL | PASS — 420/420; 13 configuration-gated skips |
| Phase 2B HTTP E2E | PASS — 17/17 |
| NA-11 HTTP E2E | PASS — 11/11 across mobile/tablet/desktop |
| Sprint 2 HTTP E2E | PASS, including BA-023 desktop/mobile and all existing booking/waitlist/walk-in flows |
| Auth/RBAC/CSRF/privacy | PASS in real API/MySQL and HTTP suites |

An additional legacy mock-only `web/e2e/auth.mjs` invocation is not a release gate and remains PRE_EXISTING: after starting Vite it times out looking for the old text `Đăng nhập Lễ tân` before any BA-023 permission fixture is exercised. BA-023 changes only two permission arrays in that file and does not modify login routing or text. The real Auth/RBAC/CSRF suites above pass.

Coverage retains BA-002 idempotency/concurrency, BA-003 canonical walk-in, BA-004 phone-only booking, Q03 15-minute time steps, Q06 waitlist-to-visit, Q10 non-adjacent merge, Q13 booking priority, floor projection, polling/change sequence, encryption/HMAC, masking and business-day behavior.

## 9. Files changed

- Migration and backend: permission grant, call/outcome route authorization and phone-less error ordering.
- Frontend: permission model, call control and mock authorization.
- Tests: access matrix, MySQL Auth/RBAC/call security and real mobile/desktop browser calling.
- Documentation: API and security matrices, encryption/calling exposure guidance.

No `.env`, audit report, database dump, credential or generated build artifact is included.

## 10. Outstanding decisions and remaining risks

- No PO decision blocks the approved `tel:` MVP. The existing callable-state contract was preserved rather than broadened.
- The dialer may be absent or reject `tel:` on a desktop; the browser/OS owns that result.
- The application cannot prove that a call connected. Staff must record the observed outcome.
- Production deployment must apply migration 0014 through the normal controlled migration process before Receptionist calls will be authorized. This task does not run that migration in production.
- Hidden-number calling remains future work.

## 11. Rollback

Before deployment, revert the BA-023 report commit and source commit. After migration 0014 has been deployed, first remove the `booking.phone.call` role grants/permission with a reviewed forward migration, then revert application code. Do not edit the production migration ledger manually.

## 12. Verdict

`FIXED_WITH_LIMITATIONS`

The implementation and mandatory regression gates are verified. The limitation is inherent to the explicitly selected `tel:` mechanism: the full number reaches the authorized browser/OS dialer and is not cryptographically hidden from the device user.

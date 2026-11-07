# TU-07 portal login and TU-08 security audit

Audit basis: API migrations `0001`–`0012`, the current Express routes and the seeded NA-07-compatible permission grants. This document records implemented behavior; it does not grant new permissions.

## Portal mapping

| Portal | Server-eligible role | Effective permissions |
| --- | --- | --- |
| `admin` | `OWNER_ADMIN` | Existing OWNER_ADMIN grants, including configuration and sensitive phone actions |
| `receptionist` | `RECEPTIONIST` | Existing receptionist grants; no full-phone reveal or customer calling |
| `customer-care` | `CUSTOMER_CARE` | Existing waitlist/customer-masked grants |
| `cashier` | `CASHIER` | Existing visit close/paid and masked-customer grants |

`SUPER_ADMIN`, Admin read-only, Service/Waiter, Bar and Warehouse are `[?]`: they do not exist in the production API lineage and the deferred NA-07 backlog explicitly says the matrix is not approved. OWNER_ADMIN access to the receptionist portal is also `[?]`; the conservative implementation denies it rather than broadening access. Portal selection filters a multi-role session and is not an authorization substitute: every action still requires its endpoint permission.

## TU-08 result

- Session persistence: PASS. `/auth/me` restores the HttpOnly-cookie session, verified portal and in-memory CSRF token without creating a new session.
- Revocation: PASS. Expired/revoked sessions, disabled users, suspended memberships and loss of the portal role return 401 on the next request. Permissions are resolved from current database grants on every request.
- Logout: PASS. Backend sets `revoked_at/revoke_reason`, clears the cookie and rejects the old session. The client clears identity/permissions and returns to the matching portal login route.
- CSRF/origin: PASS. Trusted origin applies to all mutations and every authenticated mutation uses the session-bound CSRF token.
- Phone masking: PASS. Booking list/detail/search, waitlist, table/floor projection and text export expose at most `phoneLast3`; export exposes no phone field. Ciphertext/HMAC are repository-only. Full phone and `tel:` output remain behind both sensitive permissions, venue scope, rate limiting and no-store headers. Receptionist receives neither full-phone permission.
- Client storage: PASS. Raw session tokens stay only in the HttpOnly cookie. CSRF is held in `HttpClient` memory; localStorage contains only mock user/theme presentation settings.

## Booking/waitlist/floor RBAC audit

All rows below are venue/tenant scoped from the authenticated actor. All mutations also require trusted Origin; “CSRF” means `requireCsrfProtection` is present.

| Method | Endpoint | Auth | CSRF | Permission(s) | Seeded eligible roles |
| --- | --- | --- | --- | --- | --- |
| GET | `/tables`, `/tables/catalog` | Yes | — | `customer.view_masked` | OWNER_ADMIN, RECEPTIONIST, CUSTOMER_CARE, CASHIER |
| PATCH | `/tables/:id/status` | Yes | Yes | `table.assign` | OWNER_ADMIN, RECEPTIONIST |
| PATCH | `/tables/:id/configuration` | Yes | Yes | `venue.configure` | OWNER_ADMIN |
| GET | `/bookings`, `/bookings/:id`, `/bookings/search`, `/bookings/sources`, `/bookings/export` | Yes | — | `customer.view_masked` | OWNER_ADMIN, RECEPTIONIST, CUSTOMER_CARE, CASHIER |
| POST | `/bookings` | Yes | Yes | `reservation.create` | OWNER_ADMIN, RECEPTIONIST |
| POST | `/bookings/direct` | Yes | Yes | `reservation.create` + `table.assign` | OWNER_ADMIN, RECEPTIONIST |
| PUT | `/bookings/:id` | Yes | Yes | `reservation.update` | OWNER_ADMIN, RECEPTIONIST |
| POST | `/bookings/:id/cancel` | Yes | Yes | `reservation.cancel` | OWNER_ADMIN, RECEPTIONIST |
| POST | `/bookings/:id/no-show` | Yes | Yes | `reservation.mark_no_show` | OWNER_ADMIN, RECEPTIONIST |
| POST | `/bookings/:id/late-confirm` | Yes | Yes | `reservation.update` | OWNER_ADMIN, RECEPTIONIST |
| POST | `/bookings/:id/assign` | Yes | Yes | `table.assign` | OWNER_ADMIN, RECEPTIONIST |
| POST | `/bookings/:id/check-in` | Yes | Yes | `visit.checkin` | OWNER_ADMIN, RECEPTIONIST |
| POST | `/bookings/walk-ins` | Yes | Yes | `visit.walkin` | OWNER_ADMIN, RECEPTIONIST |
| POST | `/bookings/:id/merge` | Yes | Yes | `visit.combine` | OWNER_ADMIN, RECEPTIONIST |
| POST | `/visits/:id/move` | Yes | Yes | `visit.move` | OWNER_ADMIN, RECEPTIONIST |
| POST | `/visits/:id/merge` | Yes | Yes | `visit.combine` | OWNER_ADMIN, RECEPTIONIST |
| POST | `/visits/:id/close` | Yes | Yes | `visit.end` | OWNER_ADMIN, RECEPTIONIST, CASHIER |
| GET | `/waitlist` | Yes | — | `customer.view_masked` | OWNER_ADMIN, RECEPTIONIST, CUSTOMER_CARE, CASHIER |
| POST | `/waitlist` | Yes | Yes | `waitlist.create` | OWNER_ADMIN, RECEPTIONIST, CUSTOMER_CARE |
| POST | `/waitlist/:id/seat` | Yes | Yes | `waitlist.accept_offer` + `reservation.create` + `table.assign` | OWNER_ADMIN, RECEPTIONIST |
| POST | `/waitlist/:id/cancel` | Yes | Yes | `waitlist.cancel` | OWNER_ADMIN, RECEPTIONIST, CUSTOMER_CARE |
| POST | `/waitlist/:id/contact-attempts` | Yes | Yes | `waitlist.record_contact` | OWNER_ADMIN, RECEPTIONIST, CUSTOMER_CARE |
| POST | `/bookings/:id/call` | Yes | Yes | `booking.phone.call` | OWNER_ADMIN, RECEPTIONIST |
| POST | `/bookings/:id/calls/:callId/outcome` | Yes | Yes | `booking.phone.call` | OWNER_ADMIN, RECEPTIONIST |
| POST | `/bookings/:id/phone:reveal` | Yes | Yes | `booking.phone.reveal` + `customer.phone.reveal` | OWNER_ADMIN only |

Repository queries include organization and venue predicates; cross-scope entities resolve as not found or are rejected. No checked mutation relies only on frontend visibility.

## Proposed Trello comment

> TU-07 implemented portal-bound login/session for the four roles that exist in the API lineage. TU-08 audit passed for refresh, logout/revocation, CSRF, server-side RBAC and phone masking/TU-Call safeguards. Multi-role permissions are now restricted to the verified session portal. Migration 0012 stores the portal and revokes legacy unbound sessions. `[?]` NA-07 decision is still required for SuperAdmin, read-only Admin, Service/Waiter, Bar, Warehouse and whether OWNER_ADMIN may enter the receptionist portal. No Trello card was changed because this environment has no Trello access.

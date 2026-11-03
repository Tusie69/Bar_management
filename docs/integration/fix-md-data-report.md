# MD-06 and MD-07 data fixes

Date: 2026-11-01

## MD-06 - endpoint-specific mock validation

Added strict validation to direct reservation creation, booking reassignment, and reservation/visit moves. Direct creation requires one zone and one table kind. Reassignment and movement allow cross-zone destinations of one kind. These operations reject spare tables and insufficient total capacity with HTTP-compatible 409 codes, even when an owner supplies an override reason. Existing availability/version checks and transactional rollback remain in place. The shared `assertClaimable` override behavior for approved mock walk-in demonstrations is unchanged.

Regression proof covers four rejected direct sets and three rejected destinations for each of assignment, reservation movement, and visit movement. Each rejection compares customers, reservations, visits, waitlist, holds, groups, allocations, operation history, and venue sequence against the complete pre-request state. Positive coverage creates a two-seat Bar booking, reassigns it across zones, checks in, and moves the visit across zones while preserving its group. The test closes the seeded A0 visit through the public API before using that destination.

Before the fix, the new direct boundary cases reproduced successful creation for mixed-kind, cross-zone, under-capacity, and spare selections despite owner override. The regression cases now reject atomically. Rule/error precedence was compared with `api/src/modules/tables/table-group.repository.ts`, booking direct/assignment handlers, visit movement, and existing cases in `api/test/assignment.mysql.test.ts`, including its mixed-zone/mixed-kind direct rejection, Bar capacity, spare rejection, and cross-zone assignment/movement coverage. No MySQL connection or API change was needed.

## MD-07 - exact service cleanup

- Removed the three legacy singleton instances and their class imports from `services/index.ts`, plus the replacement-only adapter/waitlist/direct-booking reexports. Canonical API, demo, auth, HTTP client, clock, and contract exports remain.
- Deleted `web/src/services/http/waitlist-api.ts`.
- Removed `directBookingSelection`, its table imports/factory, and its two obsolete tests. Retained `createAndAssignDirectBooking` and atomic request/failure tests.
- Removed `HttpBookingApi.assignmentTables`, `assign(current, ...)`, and `cancel(current, ...)`. Retained the class, `assignVersion`, `cancelVersion`, and the canonical adapter's other methods.
- Removed assignment-table types/mapping and its orphan mapping test. Retargeted HTTP assignment/cancellation checks to versioned methods and retained mutation method/URL/body/version assertions.

Repository searches across `web/src` found no remaining deleted symbols or imports. Searches across `web/src` and `web/e2e` found no deleted replacement-page/controller names. The canonical `createHttpApi` still directly imports and uses the retained booking helper and versioned mutations. Its existing contract suite continues to cover atomic direct create/failure, cancellation, assignment, stored-count check-in, and waitlist transport.

## Verification

| Check | Result |
| --- | --- |
| `web/`: `pnpm typecheck` | PASS, exit 0. |
| `web/`: `pnpm lint` | PASS, exit 0; 11 existing UI warnings, no service warnings or errors. |
| `web/`: `pnpm test` | PASS, 13 files, 195 tests, exit 0. |
| `web/`: `VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 pnpm build` | PASS, exit 0. |
| Mock browser flows at `http://127.0.0.1:5183`: `pnpm e2e` | PASS, all 20 flows, exit 0. |
| Both-theme accessibility at the same mock URL: `pnpm a11y` | PASS, 12 views in each theme, `NO VIOLATIONS`, exit 0. |
| Deleted-symbol/page-name searches | PASS, no matches. |
| Owned-file whitespace/conflict-marker check | PASS. |

Browser commands use `E2E_BASE_URL=http://127.0.0.1:5183` and `PW_CHROMIUM_PATH=C:/Program Files/Google/Chrome/Application/chrome.exe`. The temporary Vite server is stopped after verification. Browser evidence is mock evidence, and HTTP contract tests use transport fixtures; neither establishes a live database Phase 2B result. No database, migration, UI, E2E, or API source was changed by this worker. No git commands, commit, push, merge, or deployment were run.

## Changed files

- `web/src/services/index.ts`
- `web/src/services/mock/server.ts`
- `web/src/services/mock/server.test.ts`
- `web/src/services/http/direct-booking.ts`
- `web/src/services/http/direct-booking.test.ts`
- `web/src/services/http/booking-api.ts`
- `web/src/services/http/booking-api.test.ts`
- `web/src/services/http/booking-adapter.ts`
- `web/src/services/http/booking-adapter.test.ts`
- `web/src/services/http/waitlist-api.ts` (deleted)
- `docs/integration/fix-md-data-report.md` (this report)

The coordinator owns final integration review and the isolated-database Phase 2B execution. Status messages have announced data readiness to the coordinator so the E2E worker can continue.

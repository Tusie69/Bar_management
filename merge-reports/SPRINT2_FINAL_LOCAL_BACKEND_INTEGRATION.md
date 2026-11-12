# Sprint 2 Final UI + Local Backend Integration

Date: 2026-11-07

Verdict: **INTEGRATED_AND_VERIFIED**

## A. Git

### Revisions

- Original worktree branch: `develop`.
- Protected local baseline: `a05d9a3432880bd477d45ebbe7157cccf65c6591`.
- Remote `develop`: `9621856daf15362d54e7be029dbce37753ebcc93`.
- Source ref: `refs/heads/Doirangmuoi/sprint2-final`.
- Fetched source SHA: `22e15da62e3ca16e799e8b51ad19eb5843806df1`.
- Three-way merge base: `9621856daf15362d54e7be029dbce37753ebcc93`.
- Integration branch: `integration/sprint2-final-with-local-backend`.
- Integration worktree: `C:\Users\B-Tech Computer\AppData\Local\Temp\21gam-sprint2-final-a05d9a3\integration`.

### Commits created

1. `e0b6419` — `Merge sprint2-final UI with local backend`.
2. `80b6bcb` — `test(web): run Sprint 2 HTTP E2E on Windows`.
3. This report/evidence update is committed separately after finalization.

The merge commit has both the complete protected local baseline and source SHA as ancestors. BA-002 (`83dea371`) and BA-003 (`ede2b72`) remain ancestors of the integration HEAD.

### Original state protection

- Original `develop` remained at `a05d9a3` throughout integration.
- Original tracked working tree remained clean.
- Original `audit-reports/` remained untracked with 10 files.
- Original `api/.env` and `web/.env` were not copied, edited, staged or committed.
- Existing `codex/pr10-selective-trial` worktree/branch was not changed or removed.
- No push, force operation, rebase, history rewrite, fast-forward of `develop`, PR operation or branch deletion occurred.
- Live remote refs remained `origin/develop=9621856` and source `22e15da` at final verification.

## B. Files integrated

### Source acceptance totals

- Source diff from merge base: 64 files, 5,277 insertions and 1,210 deletions.
- Accepted from source: all 64 files.
- Web files accepted: 63.
- `web/src/features/mobile/**` accepted: 14/14.
- API files accepted: one test fixture, `api/test/support/phase2b-e2e-fixture.ts`.
- Backend runtime files accepted from source: zero.
- Database/migration files accepted from source: zero.

Immediately after the merge, the complete `web/` tree matched source SHA `22e15da` exactly. The final `web/src/` tree still matches source exactly; the only subsequent web difference is the Windows-safe path fix in the new Sprint 2 HTTP E2E harness.

### Mobile UI files accepted

- `actions.ts`
- `booking-table-selection.ts` and its test
- `context.ts`
- `form.tsx`
- `list.tsx`
- `map.tsx`
- `mobile-app.tsx`
- `mobile.css`
- `model.ts` and new `model.test.ts`
- `overlays.tsx`
- `wait.tsx`
- `walk-in-selection.ts`

These are the source versions, not fallback copies of the previous local UI.

### Frontend dependencies accepted

- Floor canvas, framing, visual rules, status legend, table detail and timeline.
- Table-first quick form and new shared `use-booking-draft` hook.
- Booking picker, booking sheet and reservation detail/status/list integration.
- Waiting-list assignment helper and tests.
- Shared domain enums, schema, access rules, status metadata and UI state.
- Responsive shell and global/mobile styling.
- HTTP facade integration and mock parity.
- Phase 2B, NA-11, mock flow, accessibility and new Sprint 2 HTTP E2E coverage.

### Combined/fixed files

- `web/e2e/sprint2-booking-http.mjs`: source test behavior and assertions were retained; only the Windows root-path conversion was changed from raw URL pathname to `fileURLToPath`. Without this correction, a workspace path containing a space became `%20` and fixture startup failed before any product assertion.
- `api/test/support/phase2b-e2e-fixture.ts`: source additions for venue quick times and cleanup were accepted; backend runtime remained local.

### Kept local

All local backend/runtime and post-Sprint-2 fixes were retained, including:

- BA-002 idempotency middleware and shared `PoolConnection` transaction.
- Booking and waitlist repository/route changes.
- BA-003 canonical direct Walk-in validation/group/audit/change sequence/phone handling.
- Q03 booking schedule enforcement and fake-clock corrections.
- Q06 present-Walk-in waitlist seating.
- Q10 non-adjacent grouping behavior.
- Q13 confirmed booking allocation priority.
- Auth/RBAC/CSRF, phone privacy, venue isolation and migrations.

`git diff a05d9a3..integration-HEAD -- api/src api/database` is empty. No backend runtime or database file changed in this integration.

## C. Visual verification

### Actual entry point

- `web/src/app/app.tsx` lazy-loads `@/features/mobile/mobile-app`.
- `Root()` renders `MobileApp` below the 768px breakpoint and `AppShell` for tablet/desktop.
- Receptionist routing is server-role aware and resolves to `/floor`; it does not render the removed fallback pages.
- `MobileApp` directly imports `./mobile.css`.
- Mobile route mapping covers `/home`, `/reservations`, `/floor` and `/waitlist`.
- Production build was executed with `VITE_API_MODE=http`; build and runtime guards reject mock mode in production.

### Browser evidence

The new UI was exercised against the real Express API and disposable MySQL, not only against mock data.

| Viewport | Result | Evidence |
|---|---|---|
| 360x800 | PASS, no overflow, table-first form | [360x800 booking form](./sprint2-final-ui/360x800-booking-form.png) |
| 375x812 | PASS, no overflow, table-first form | [375x812 booking form](./sprint2-final-ui/375x812-booking-form.png) |
| 390x844 | PASS, no overflow, table-first form | [390x844 booking form](./sprint2-final-ui/390x844-booking-form.png) |
| 768x1024 | PASS, responsive tablet form | [768x1024 booking form](./sprint2-final-ui/768x1024-booking-form.png) |
| 1280x800 | PASS, desktop map + side sheet | [1280x800 booking form](./sprint2-final-ui/1280x800-booking-form.png) |

Additional live-backend screenshots:

- [Waitlist table selection/confirmation](./sprint2-final-ui/390x844-waitlist-assignment.png)
- [Walk-in sheet on a selected table](./sprint2-final-ui/390x844-walkin-form.png)

### Visually and functionally verified

- New full-floor map and responsive camera framing.
- Table-first booking sheet on mobile and desktop.
- 15-minute time wheel and filtered venue quick times.
- Held/spare/out-of-service tables are not offered as free.
- Booking conflict keeps entered form data and permits selecting another table.
- Booking without a table enters Bàn chờ as `ADVANCE_RESERVATION`.
- Present Walk-in from Bàn chờ selects multiple Bar seats and opens them through Q06.
- Direct Walk-in creates an active Visit and occupied floor state.
- Search by last three phone digits, highlighting, selected business date and multi-device polling.
- Waiting-list badge/sheet, assignment confirmation, status chips and phone privacy.
- No serious horizontal overflow at 360, 375, 390, 768 or 1280.
- Dark/light accessibility audit covered desktop and receptionist mobile booking/Walk-in scenarios with no violations.

## D. Business verification

### Q03 — booking time

- Frontend constant remains 15 minutes.
- Minute wheel contains only `00`, `15`, `30`, `45`.
- Invalid configured quick time `20:10` is filtered out.
- Live E2E saved 22:30 and 21:15 successfully.
- Live E2E proved 00:30 belongs to the previous business date.
- Late +15 and No-show +30 display/domain tests remain green; historical off-grid values are not silently rewritten.

### Q06 — present Walk-in from Bàn chờ

- Live Sprint 2 HTTP E2E sent `arrived:true`.
- Backend returned 200.
- Entry became `SEATED`.
- Both selected Bar seats became `IN_USE` with the same Visit ID.
- Full MySQL retains atomic Visit/USAGE/SEATED/audit/change-sequence assertions.

### Q10 — non-adjacent grouping

- No adjacency rule was introduced by frontend integration.
- Mock and live HTTP suites exercise multi-table grouping/move/merge.
- Backend canonical same-zone/kind/capacity/ownership invariants remain unchanged.

### Q13 — booking priority

- Held/reserved tables remain unavailable in table-first forms.
- Multi-device race test makes the backend reject a newly occupied table and preserves the user's form data.
- Tomorrow-held and today-occupied scenarios pass in both mobile themes.

### BA-002 idempotency

- HTTP client sends `Idempotency-Key` only on create mutations.
- Mobile form, floor quick form, booking sheet, Walk-in and waitlist creation use form-scoped keys.
- Local BA-002 shared transaction source is unchanged.
- Full MySQL fault injection/retry/concurrency suite remains green.

### Auth/RBAC/privacy

- Login/logout, cookie session, CSRF and role-derived routing pass live HTTP E2E.
- Receptionist cannot reveal full phone; owner flow remains separately authorized.
- NA-11 observed only masked phone data and reported `errors=[]`.
- Production HTTP build does not fall back to the mock server.

## E. Regression results

Only disposable `_test` schemas were used. `gam21_platform_it_test` was recreated after confirming zero active connections. The separate exact-name `gam21_platform_test` used by manual no-show was created from migrations, run, verified unused, and dropped. No development or production DB was accessed.

| Gate | Result |
|---|---:|
| Typecheck API + web | PASS |
| Lint API + web | PASS, 0 errors; 11 existing/source warnings |
| Production HTTP build | PASS, 3,075 modules transformed |
| API unit | 205/205 PASS |
| Web unit | 339/339 PASS |
| Full MySQL | 412 PASS, 0 FAIL; 13 opt-in skip |
| Manual no-show opt-in | 13/13 PASS |
| Phase 2B live HTTP/MySQL | 17/17 PASS; cleanup `0` |
| NA-11 live HTTP/MySQL | 11/11 groups PASS, 5 viewports, `errors=[]`, cleanup `0` |
| Sprint 2 final live HTTP/MySQL | AT1–AT13 PASS; cleanup `0` |
| Mock browser flows | ALL PASSED, including responsive/mobile conflict and grouping matrices |
| Accessibility dark/light | NO VIOLATIONS |
| Critical concurrency | PASS in full MySQL, NA-11 and Sprint 2 multi-device race |
| Idempotency fault injection | PASS in full MySQL |
| Q06 Walk-in tests | PASS in MySQL and live browser/API |
| Auth/RBAC/privacy | PASS in MySQL, Phase 2B, NA-11 and mock flows |

Evidence JSON:

- [Sprint 2 HTTP results](./sprint2-final-ui/sprint2-http-results.json)
- [NA-11 HTTP results](./sprint2-final-ui/na11-http-results.json)

### Failure classification

- Initial production build without a copied `.env`: **NOT A REGRESSION**. The expected production guard rejected missing `VITE_API_MODE=http`; explicit HTTP-mode rerun passed.
- Initial Sprint 2 E2E spawn on a path with a space: **SOURCE_BRANCH_DEFECT → FIXED** with `fileURLToPath`; all original assertions then passed.
- Integration regressions: none found.
- Backend regressions: none found.

## F. Outstanding issues

- Q04/Q05 capacity/spare override role matrix remains NEED_PO/NEED_BA. Existing safe backend validations remain authoritative.
- Receptionists still do not receive full-phone reveal permission. Tablet UI explicitly explains unavailable direct calling; this is privacy-preserving, not bypassed.
- Realtime remains polling/change-sequence based; no unapproved SLA or websocket behavior was introduced.
- Existing/source lint warnings concern fast refresh, effect dependencies and compiler memoization; there are no lint errors and no observed functional regression.
- Raw generated Sprint 2 artifacts were preserved outside the worktree under `C:\Users\B-Tech Computer\AppData\Local\Temp\21gam-sprint2-final-a05d9a3\generated-e2e-artifacts`; curated evidence is committed under `merge-reports/sprint2-final-ui/`.

No missing UI function or API contract gap blocks the tested Sprint 2 flows.

## G. Final verdict

**INTEGRATED_AND_VERIFIED**

The selected Sprint 2 Final frontend is present in the actual application entry points, renders at mobile and desktop viewports, uses the real HTTP backend in production/E2E mode, and passes booking, Walk-in, waitlist, floor, search, privacy, concurrency and idempotency regression gates. Local backend runtime and every BA-002/BA-003 change are preserved.

The integration branch is ready for human diff/screenshot review. `develop` must remain unchanged until explicit approval.

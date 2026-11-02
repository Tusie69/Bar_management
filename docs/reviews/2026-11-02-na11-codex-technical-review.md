# NA-11 independent technical review - 2026-11-02

TECHNICAL REVIEW: CHANGES_REQUESTED

Technical review and requested evidence are complete. Approval is withheld for the reproduced SQL chronology failure and inherited serious dark-mode button contrast. Nam alone approves final UI; this report does not approve merging or deployment.

Architecture: reviewed implementation a37e6bc..19be884 and Gemini's final six-file UI patch 19be884..91f43a0e07c235a9256177abb25db1b93f13645a. The coordinator committed UI bytes during capture without changing source; this worker verified all captured source SHA256 values remain identical afterward. Existing services, floor model, date/search query keys, waitlist and export are reused. Venue scope belongs to the server session. No dependency, production backend, global token, typography or FloorCanvas change was made by this worker. Final Gemini diff preserves original text-base/font-semibold/bg-primary treatment and changes surrounding semantic containers, form loading guards, waitlist scrolling and focus/disabled affordances.

Functional correctness: final real HTTP E2E passed direct future-date booking bound to A1, more-than-seven-day calendar selection, duplicate last3 matches across two bookings/tables, masked phone display, check-in, walk-in, move, merge, spare/out-of-service guards, capacity rejection, draft retention and legacy receptionist route redirects. Five widths 360/375/390/768/1280 passed geometry. Existing 17:00-05:00 business-date rules and TU-11/TU-12/TU-21 application semantics remain unchanged.

Security: actual E2E verified receptionist phone reveal returns403, phone ciphertext/full number fields are absent from read responses, exact three-digit searches and no two-digit request, server capacity rejection and one-winner concurrent allocation. Existing API tests cover RBAC, CSRF/origin, tenant scope, optimistic versions and note privacy. No dev/production DB or production data was used.

Realtime: HTTP subscribe remains a no-op; synchronization is the existing15-second polling. Actual two-browser E2E observed an external booking edit within20seconds. Local useAction invalidates queries after completion/failure. This is polling evidence, not websocket evidence.

Regression: final owner E2E saves an optional unassigned booking; a deliberately paused real selected-table availability query keeps submit disabled; reduced-motion computes animationName=none. Before Gemini's fix, the correct-state assertion failed. The owner Check availability/select table/fill/save path also passed independently, so the earlier broad P1/deadlock description was corrected: the observed regression concerned false loading and optional unassigned saving, not every owner booking. Explicit-current-day mock floor state is asserted equal to omitted date, including B3late. Final matched floor images show B3late+25 on both sides.

Tests:

All logs below are retained under `web/e2e/.artifacts/na11/gates/`.

| Actual command / environment | Observed result | Evidence |
| --- | --- | --- |
| pnpm typecheck, final settled UI | exit0 | settled-typecheck.log |
| pnpm lint, final settled UI | exit0; existing warnings | settled-lint.log |
| pnpm build, final settled UI | exit0; import chunk warning | settled-build.log |
| pnpm --filter @21gam/web test, final settled UI | 238 passed,15files | settled-web-test.log |
| pnpm test, clean isolated current API schema, first final UI handoff | API296passed/1failed; web238passed | final-test.log |
| pnpm --filter @21gam/web exec node e2e/na11-http.mjs, final settled UI | exit0,11checks,fixtureclean | settled-na11-http.log |
| pnpm --filter @21gam/web exec vitest run src/services/mock/server.test.ts | 39passed; explicit-date equivalence | mock-current-date.log |
| Final controlled visual runner derived from existing na11-visual.mjs | 50images,0overflow; exit1 solely for6contrast findings; owner/loading/motion assertions completed | controlled-final-after.log |
| Corrected controlled Before runner from clean a37e6bc | 50images,0overflow | controlled-before-booking.log |
| Owner behavior assertions extracted from tracked visual E2E | unassigned save, actual pending guard and reduced-motion PASS | owner-fix-assertions.log |
| Owner assigned booking real browser path | PASS | owner-assigned-path.log |
| Narrow NA14 rehearsal tests: na14.mysql.test.ts + booking-metadata.test.ts | 6passed with authorized isolated-container root | na14-readonly-metadata-root.log |

Initial pnpm test on existing33317 test schema produced API284passed/13failed, web238passed (`test.log`). Three failures were caused by foreign NA14 migration0008/classification constraints. Ten failures were test-clock mistakes. After clock fixes,293passed/4failed (`test-clock-fixes.log`); a fresh current schema then yielded296passed/1SQLchronology failure (`test-isolated.log`). A diagnostic full run later passed297/297 (`test-diagnostic.log`), but targeted original-query reproduction and final uninstrumented gate failed again. Passing retries do not erase the blocker.

Four API test files fix fixture clocks without changing production validation: booking-versus-walk-in races now freeze19:00 before the20:00 booking; advance check-in and business-day sweep tests freeze the fixture business date; one repository check-in passes its existing explicit now parameter. With Boss authorization, manual synthetic visit release uses starts_at so fixture setup does not depend on external wall-clock ordering. Existing assertions and strict database-name guards remain intact. Web tests add actual guest-count assertions and current-day mock equivalence; visual E2E retains the original pending diff and adds owner/loading/motion checks, availability/opacity settling, and case-insensitive baseline booking selection.

Required technical fixes:

1. Resolve the reproduced SQL chronology/environment issue before claiming a stable complete API gate. At group192, formed_at was2026-11-02T13:23:21.785Z, dissolved_at/by/reason wereNULL, but an immediate same-connection SQL UTC timestamp was2026-11-02T13:22:42.375Z,39.410seconds earlier. Original dissolve UPDATE correctly failed ck_table_groups_dissolve and returned500; transaction rollback preserved the group. Evidence: `original-query-1.log`. Actor9801/org1/venue1 was valid. Separate protocol samples show about39.6seconds host/DB skew, but offset alone does not establish its mechanism. Both group creation and dissolution use SQL time. Correction: an intermediate mixed-JavaScript/SQL hypothesis was wrong; direct createWalkIn also uses SQL UTC timestamps. No production GREATEST workaround, weakened constraint, host/VM clock change or Docker restart was performed. All temporary backend diagnostics were removed; backend diff is empty and this file is identical to base.
2. Resolve or explicitly accept the inherited serious dark primary-button contrast within the authorized design scope. Final stable enabled button has disabled=false,opacity=1,foreground#fcfcfc/background#3f83cb,ratio3.84against required4.5. Original16px/font-semibold treatment remains. Exact HTML, computed colors and axe data are in `final-a11y-context.json` and `gates/final-a11y-context.log`. Earlier3.09sample was a transition artifact and is superseded by stable3.84evidence. No axe suppression or typography/palette bypass was used.

Final visual evidence:

- Correct Before: `web/e2e/.artifacts/na11/controlled-baseline-booking/manifest.json`.
- Final After: `web/e2e/.artifacts/na11/controlled-final-after/manifest.json`.
- Five widths360/375/390/768/1280, both themes, five states,50images each. Chrome156.0.8078.74, existing deterministic mock seed, fixed2026-11-02T14:30:00Z, same selected B5 booking form. Before empty-table intentionally shows the original table sheet; After empty-table shows the new direct booking entry.
- Baseline guard verifies clean a37e6bc93de1e02a47c6f3b50ddce011dcc9649d source. The case-sensitive old selector incorrectly chose Walk-in on mobile; corrected selector now captures actual booking B5/21:30. Older attempts remain preserved.
- Final After has0overflow and only6serious color-contrast findings:360/375/390dark empty-table/form. No final landmark/region findings. Gemini's semantic-container corrections removed those inherited findings. Worker inspected representative360mobile and1280desktop images; Nam/Gemini own final aesthetic approval.
- Existing57original Before artifacts still match `before-preservation-sha256.json`. `final-source-sha256.json` verifies source stability across final capture/gates/coordinator commit. `controlled-provenance.json` records baseline setup; final capture script is `controlled-capture-booking.mjs`. Mock screenshots are separate from actual HTTP evidence.

Environment and boundaries:

- Node24.21.0. API tests explicitly use NODE_ENV=test,RUN_MYSQL_INTEGRATION=1,DB_HOST=127.0.0.1,DB_NAME=gam21_platform_it_test. Strict exact-name destructive-fixture guards were preserved.
- Existing33317 test DB already contains migration0008 and was preserved. A new disposable mysql:9.7.2 container on loopback33318 used current migrations0001-0007 and random credentials. `schema-audit.json` records the7-versus8migration distinction. Own container was stopped/auto-removed and its credential file deleted after tests. Original test schema/dev/production were not reset or rebuilt.
- HTTP E2E uses its separate *_test fixture, random login/session/phone keys and verifies cleanup. Installed pnpm required explicit npm_execpath pointing to installed pnpm.mjs; initial missing-env invocation failed before fixture setup.
- Boss authorized temporary ignored baseline node_modules junction/config to reuse dependencies with separate cache. Only own baseline Vite was stopped; verified junction-only nonrecursive removal and config cleanup left baseline source/index/HEAD clean. No tracked source in another checkout was edited.
- NA14 rehearsal inspected read-only: detachedHEAD19be884,MERGE_HEAD33dd9a2bed16fcd713e6b0d871bca6ea5c67cd04,staged resolved patch,no unmerged entries,pending E2E diff. Metadata overlap is floor/quick-form and mobile/form/detail. Initial narrow test run had5pass/1CREATE DATABASE denial; Boss then authorized existing test-container root credentials in memory, yielding6/6PASS. Existing tests guard exact integration DB and create/drop unique *_test schemas in finally; no grants or persisted root credentials. This proves narrow metadata/settings/migration/seed RBAC behavior, not full merged UI compatibility. Coordinator reports read-only merge-tree at finalHEAD versus NA14 exits0/tree817ffc692d45599f9e7209d365d929bbc3d6093d; this is attributed coordinator evidence, not worker merge execution.
- Guest count intentionally reuses booking export: reservation booked/checked-in totals, excludes walk-ins. Real E2E verifies exact booked2/arrived2 and absent named walk-in. No NA16/TU15 attendance feature was added.
- Existing search caps remain: HTTP LIMIT100 and mock digit-search slice20. Every returned match renders, but absolute all-matches beyond caps is an explicit TU21 dependency.
- Final lint retains existing Fast Refresh and mobile-list hook dependency warnings. Static WaitlistPage import produces an ineffective dynamic-import chunk warning; build succeeds. No UI or generated file was edited by this worker to silence warnings.
- Worker performed no git mutation, UI source edit, extra-worker launch, publish, merge or deployment. Coordinator owns commits/Draft PR and final integration decisions.
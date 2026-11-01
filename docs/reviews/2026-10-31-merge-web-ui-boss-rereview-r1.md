# MERGE_WEB_UI Boss re-review, fix round 1 - 2026-10-31

Verdict: **CHANGES_REQUESTED**

Four original findings are fixed. WUI-02 is partially fixed but mobile contact logging remains unavailable, and WUI-05 still contains broken Phase 2B selectors. Two additional MINOR findings concern a false-positive mobile regression and an overflowing mobile edit dialog. All required quality gates pass; those gates do not cover these failures.

## Scope and evidence boundaries

- Reviewer task `task_a2b36eae1c36`, dispatch `ctx_5e8d2dcfa4b7`, run `run_e8edc795b163`.
- Worktree `C:\Users\DELL\orca\workspaces\Bar_management\feature-canonical-ui-web`, branch `Doirangmuoi/feature-canonical-ui-web`. HEAD and `origin/main` resolve to `0acec2f52f5a911f2b5fb817927c9e0727a2d0ae`. Reviewed the uncommitted implementation, the previous Boss report, round-1 fix specification, worker report and approved backend/data re-review.
- Read the prescribed workflow and Boss template. Agentmemory recall succeeded but returned historical command fragments, not additional binding project decisions. No `.codegraph/` exists in this worktree or the canonical tree. Used the `orca-cli` and `webapp-testing` skills; ran the prescribed existing JavaScript suites and in-memory Playwright probes. No sub-agents were launched.
- Browser tests used only this reviewer's Vite server, `VITE_API_MODE=mock`, port **5179**, and `C:/Program Files/Google/Chrome/Application/chrome.exe`. Standard flows/a11y results are **MOCK MODE**.
- Additional **HTTP TRANSPORT FIXTURE** checks replaced the browser's runtime-config module with HTTP mode and intercepted every `/api/v1/**` request. They exercised the real HTTP adapter with synthetic responses, served from the same mock-mode Vite server. No request reached an API or database. Fixture counters establish browser request ordering and client behavior, not real database transactions.
- No `phase2b-booking.mjs` fixture setup, server startup, cleanup or database command was executed. Its relevant browser interactions were reproduced separately against intercepted responses. A complete live Phase 2B run remains the coordinator's responsibility on the isolated test DB.
- Only this report was intentionally edited. Checks generated ignored build/cache/screenshot artifacts. No source, test, configuration, backend, data layer or canonical file was edited; no commit or database write was made. No server on 3000/5173 was started or stopped. The owned Vite listener on 5179 was stopped, and absence of a listener was confirmed.

## Original findings

| Finding | Status | Independent evidence |
| --- | --- | --- |
| WUI-01, MAJOR | **FIXED** | Desktop `waitlist-page.tsx:899` recognizes HOLD_ACTIVE independently of `hold`; both desktop and `mobile/wait.tsx:181` resolve the linked booking, use its observed version and submit normal check-in with the stored count. Four additional real-mock cases covered both kinds at 1280px and 390x844 with B5+B7: assignment produced BOOKED, `hold: null`, zero new visits, then exactly one check-in/visit, SEATED and the same two-table group. Advance entries reused their booking. Sixteen HTTP fixture cases covered both widths, both kinds and all four channels; assignment sent one `/waitlist/101/seat`, followed only at arrival by one `/bookings/201/check-in`, with no claim. Missing-booking cases at both widths displayed `Không tìm thấy thông tin đặt bàn liên kết.` and sent no check-in or second assignment. Mock offer-only conversion remains working. |
| WUI-02, MAJOR | **NOT FIXED** | Supported assignment now works on desktop/mobile for IN_PERSON, PHONE_CALLBACK, ZALO_THREAD and FANPAGE_THREAD. Desktop contact logging also works without claim or offered tables. Assignment-denied fixtures disabled the action and produced zero mutations. However, every phone WAITING fixture exposed only assignment and cancel; contact action count was zero despite `waitlist.record_contact` permission. CONTACTING/OFFERED still uses a desktop-only informational toast. See remaining WUI-02 below. |
| WUI-03, MAJOR | **FIXED** | Mobile list reuses `ZaloBookingExport` with its selected `bd` and `customer.view_masked`; form sends classification; detail displays it and opens the shared edit UI. The retained mock create/export case passed. An independent 390x844 HTTP fixture created RETURNING, read it in detail, edited to NEW through a PUT, and read the updated server-export text in a second browser context. Selecting tomorrow requested `date=2026-11-01` rather than the created booking's `2026-10-31`. A permission-denied case disabled export and made zero export requests. New responsive defect WUI-R1-02 is reported separately. |
| WUI-04, MAJOR | **FIXED** | `waitlist-page.tsx:965` derives one `storedParty`, renders it read-only, passes it to TablePicker and `seatWaitlist`. Browser probes for WALK_IN and ADVANCE_RESERVATION found no increment/decrement controls at assignment or normal arrival, and the actual reservation sizes stayed 2 and 4 respectively. Ordinary walk-in editing still works in the passing original flows. |
| WUI-05, MINOR | **NOT FIXED** | Auth now supplies roles, honors the executable/base URL and passes all eight advertised auth scenarios against HTTP transport interception. Phase 2B still waits for nonexistent exact empty-state text at lines 110/114 and selects a status filter instead of tomorrow at line 229. Both defects were independently reproduced without running its DB code. See WUI-05 below. |
| WUI-06, MINOR | **FIXED** | `floor-canvas.tsx:479` restores canonical foreground stroke, stroke opacity 0.45, width 1.4 and dash `0.1 3.6`. Actual rendered SVG attributes were checked on grouped visits in dark/light modes; screenshots were inspected. Group IDs, symbols and accessible table descriptions remain present, and the two-table group survived check-in in all four mock cases. |

WDATA-R1-01 and the backend/data verdict remain outside this UI fix decision. The obsolete package entries are absent, consistent with their existing approval; no backend/data changes are requested.

## Remaining and new findings

### WUI-02 - MAJOR - mobile cannot log a supported contact attempt

**Location:** `web/src/features/mobile/wait.tsx:176`, `:219`.

**What is wrong / why:** The HTTP assignment half is repaired, but the phone WAITING card has only `Đề nghị bàn ...` and `Hủy`. There is no independent contact-log action, regardless of channel or contact permission. For CONTACTING/OFFERED, `Ghi kết quả liên hệ` only shows `Ghi kết quả liên hệ trên Tablet hoặc Desktop ở V1`. The binding fix explicitly requires supported contact-attempt logging without a claim. Phone staff cannot record an unanswered contact, callback or other result unless they change devices; assigning tables is a different operation and cannot replace this record.

**Evidence:** At phone width, intercepted sessions had `waitlist.record_contact` and `table.assign`, a WAITING entry and a free fitting table. For both kinds and each of IN_PERSON, PHONE_CALLBACK, ZALO_THREAD and FANPAGE_THREAD, the rendered contact-control count was 0 and the only entry actions were `Đề nghị bàn A1` and `Hủy`. Source lines 219-222 confirm that the other contact states still produce only a toast. The same transport fixture successfully submitted `/waitlist/101/contact-attempts` from desktop without claim or offered tables, demonstrating the supported contract.

**Concrete fix:** Add a reachable mobile contact action and a canonical mobile dialog/sheet for channel, outcome and optional validated note. Gate it with `waitlist.record_contact`. In HTTP mode submit only the supported `recordContact` fields, with the observed entry version; do not claim, include offered tables, create a hold or imply logging itself seats the guest. Reuse existing contact-form logic where practical while preserving desktop behavior and mock claim/offer semantics. Keep assignment/check-in separate and preserve advance-first ordering.

**Verify:** At 390x844, for both kinds and all channels, a permitted WAITING entry must allow contact logging without a claim, including when no table fits. Assert one contact-attempt POST, correct version/outcome/note, no claim/seat/check-in, truthful success/error handling and unchanged reservation/visit state. Repeat without contact permission and assert no mutation. Keep the now-passing assignment/arrival cases.

### WUI-05 - MINOR - retained Phase 2B still cannot follow the canonical UI

**Location:** `web/e2e/phase2b-booking.mjs:110`, `:114`, `:229`.

**What is wrong / why:** The first list assertion expects exact text `Chưa có booking`; the canonical empty list renders `Không có booking phù hợp`. The script therefore stops before creating a booking. Its later mobile date selector, `button[aria-pressed]` at index 1, targets `Cần xử lý`, not tomorrow. Fixing only the first timeout leaves the second context exporting today's data and failing the retained statistics assertions. This prevents the required isolated-DB verification from reaching its intended scenarios.

**Evidence:** A valid authenticated HTTP fixture with an empty bookings response rendered one `Không có booking phù hợp` and zero exact `Chưa có booking` elements. The independent mobile fixture reported the matching button order as `Tất cả 1`, `Cần xử lý 1`, `Sắp đến 0`, `Đã nhận bàn 0`, `Không đến, hủy 0`, `Hôm nay`, `CN 01/11`, etc. Executing the script's `.nth(1)` interaction left export date at `2026-10-31`; explicitly selecting the date button requested `2026-11-01`. See [empty-state screenshot](../../web/e2e/.artifacts/boss-r1-phase2b-empty.png). The auth suite itself passed and is not included in this remaining failure.

**Concrete fix:** Replace both empty-state selectors with the actual canonical state and scope the mobile selector to the date controls, using the expected business date instead of a page-wide button index. Assert the selected date/export request before inspecting statistics. Exercise the entire retained browser sequence with transport interception to catch subsequent selector errors, preserving all existing persistence, masking, cross-context, assignment and statistics assertions. Keep environment-variable support and cleanup intact; do not remove assertions or change the UI to match obsolete test text.

**Verify:** The corrected browser interactions must pass a synthetic HTTP transport run with no DB setup. The coordinator must then run the full retained script only against the approved isolated E2E DB and record all 16 results. This review makes no claim that later live-DB steps already pass.

### WUI-R1-01 - MINOR - the new phone direct-assignment regression passes while seating another guest

**Location:** `web/e2e/flows.mjs:275` through `:280`.

**What is wrong / why:** Waiting for `Chị mặc váy đỏ` does not scope subsequent actions to that card. Page-wide `.first()` controls select another waiting entry, then an already seeded hold. In mock mode `Đề nghị bàn` also uses claim/contact-offer rather than direct assignment. The test's HOLD_ACTIVE assertion is satisfied by existing holds and never establishes `reservationId` plus `hold: null` for the target. Consequently, the passing test does not protect the exact WUI-01 regression it claims to cover.

**Evidence:** Ran the existing phone flow body in memory with call tracing only; its original assertions still passed. Trace:

```text
claimWaitlist(entry 3)
seatWaitlist(entry 5, existing held table [7])
recordContact(entry 3, ACCEPTED, offeredTableIds [13])
checkIn(reservation 587 for entry 5)
Final: entry 5 SEATED; entry 3 HOLD_ACTIVE, reservationId null, offer hold present;
       entry 6 (the named Chị mặc váy đỏ) WAITING.
PASS direct waitlist assignment -> HOLD_ACTIVE -> arrival check-in (phone 390px)
```

The generated numeric reservation ID is run-specific. See [resulting phone state](../../web/e2e/.artifacts/boss-r1-retained-phone-false-positive.png). Separate reviewer probes establish that the actual direct-assignment arrival implementation now works; that does not repair the committed regression.

**Concrete fix:** Scope all actions and assertions to one captured entry ID/card. Establish a real reservation-backed direct assignment, using the supported API as setup where the mock phone button intentionally retains the offer workflow, or an HTTP transport fixture exercising `/seat`. Assert the target's HOLD_ACTIVE, non-null reservation ID, null offer hold, BOOKED reservation and zero new visits before clicking that same target's arrival control. Afterwards assert one normal check-in, one new visit, target SEATED and preserved group. Cover both kinds. Keep the accepted-offer case as its own meaningful regression.

**Verify:** The revised case must fail if the reservation-backed mobile arrival handler is removed or made dependent on `e.hold`, and must fail if another seeded guest is seated instead. Then `pnpm e2e` must pass at the prescribed mock port. Coordinate this shared E2E file through one owner.

### WUI-R1-02 - MINOR - the newly exposed mobile edit dialog clips its title and close control

**Location:** `web/src/features/mobile/detail.tsx:244`; shared content at `web/src/features/reservations/reservation-detail.tsx:376`.

**What is wrong / why:** Mobile detail now mounts the desktop edit dialog, whose content has no viewport-height bound or scrolling container. Its expanded time picker and classification fields make it taller than the phone viewport. The title, close button and part of the cancel control are outside the screen. Classification can be saved, but the new mobile edit path lacks a fully visible, touch-accessible dismissal and header.

**Evidence:** At **390x844**, create/open a booking, tap `Sửa booking`, and wait for the dialog animation to finish. Measured dialog: `x=16, y=-49, width=358, height=942`; `overflow-y=visible`; title `y=-24`; close control `y=-36`. The footer extends to `y=893`. A [390x844 screenshot](../../web/e2e/.artifacts/boss-r1-mobile-http-edit.png) visibly clips the title/close control and cancel area. The problem follows from the shared wrapper independently of API mode; this measurement used the HTTP fixture. It is introduced into the phone path by the new mobile caller.

**Concrete fix:** Give this edit dialog a viewport-bounded responsive container with a scrollable form body and reachable header/footer, either through a narrowly scoped shared-dialog option or a mobile wrapper. Preserve the canonical desktop layout and existing edit payload/validation. Do not alter global dialog styling, design tokens, data contracts or the time-slot rules merely to fit this screen.

**Verify:** At 390x844 in dark/light themes, verify the header/close control and save/cancel are reachable by touch, all fields can scroll into view, and keyboard focus remains visible. Open classification, edit/save and cancel without changes in both mock and HTTP fixtures; rerun mobile axe and existing desktop a11y. Check a shorter viewport/onscreen-keyboard case as well.

## Independent commands and preservation checks

Commands ran in `web/` unless stated otherwise.

| Check | Result |
| --- | --- |
| `pnpm typecheck` | PASS, exit 0. |
| `pnpm lint` | PASS, exit 0, with the same 11 pre-existing fast-refresh/compiler/effect/dependency warnings recorded in the earlier review. No new lint error. |
| `pnpm test` | PASS, 12 files / 173 tests. |
| `$env:VITE_API_MODE='http'; $env:VITE_API_BASE_URL='/api/v1'; pnpm build` | PASS, 3063 modules. No mock-named chunk or `MockGamApi` / `WAITLIST_ASSIGNED_TO_RESERVATION` marker was found in the built JavaScript. |
| `$env:VITE_API_MODE='mock'; npx vite --port 5179 --strictPort` | Started only on 5179; owned listener PID 17996 was verified by its worktree/Vite command line, stopped, and absence of listener confirmed. |
| `E2E_BASE_URL=http://localhost:5179`, `PW_CHROMIUM_PATH=...`; `pnpm e2e` | **MOCK MODE PASS, 18/18**. The phone false positive is separately identified above. |
| Same environment; `pnpm a11y` | **MOCK MODE PASS**, 24 states across 12 desktop views in dark/light, zero axe violations. This suite is not a mobile audit. |
| Retained auth body, browser-only HTTP runtime interception | **HTTP TRANSPORT FIXTURE PASS**, bootstrap, invalid login, login, reload, CSRF logout, account change, revoked session and network error; no DB. |
| Additional waitlist HTTP probes | PASS for 16 assignment/arrival combinations: 2 widths x 2 kinds x 4 channels, plus 2 missing-booking and 2 denied-assignment cases. Desktop contact logging passed; phone contact absence reproduced WUI-02. These phone fixtures used 390x800; real-mock group/arrival and mobile export/edit probes used 390x844. |
| Additional direct real-mock probes | PASS, 4 cases: both kinds at desktop and 390x844, two tables, stored counts, BOOKED/no visit before arrival, exactly one later check-in/visit, group preservation, no duplicate advance reservation. Phone direct holds were deliberately established through the supported mock API before testing arrival. |
| Mobile export/classification HTTP fixture | PASS create RETURNING, detail, edit NEW, second independent browser context export, selected-date request, masking of displayed data, and denied export with zero requests. Mobile export-dialog axe returned zero WCAG A/AA violations. Server-export text was synthetic; actual backend statistics were not recalculated or validated by this fixture. |
| Owner-only OUT_OF_SERVICE affordance | PASS in real-mock browser checks: receptionist has no `Tùy chọn bàn`; owner has `Ngưng phục vụ`. No status mutation needed. |
| Canonical source comparison | Ignoring only CRLF/LF, 69 equal UI/entry/style/asset files, 16 different, zero missing in compared groups. Examined all differences. Entire `index.css` and mobile CSS match canonical, including pending `--tx-3` / `--destructive`. |
| Group styling | Rendered SVG attributes checked and dark/light group screenshots inspected. Canonical monochrome dotted connectors and group symbols are restored. |
| `git diff --check 0acec2f -- web` | PASS, exit 0; existing Git LF/CRLF notices only. |
| Live API/MySQL / full Phase 2B | NOT RUN under the no-DB-write review boundary. |

Untouched canonical files remain exact in the compared scope. Existing suites preserve masked phones, warning-only late/no-show behavior, walk-in count editing, accepted offers, conflicts/undo and date-aware availability. Source inspection found no new HTTP path calling the mock-only claim/offer methods. The additional direct-arrival checks establish no visit before check-in. No new dead-code or swallowed-error finding was established; desktop/mobile arrival logic is duplicated, but that duplication is not being promoted to a separate blocking issue without a concrete defect.

This was source comparison plus rendered inspection, not a full pixel-diff against a separately launched canonical app. Ignored screenshots are supporting local artifacts; the reproduction steps, request traces and measurements above are retained in this report.

## Fix instructions for the worker

Each group below should have one file owner. Groups can proceed independently; the coordinator should serialize integration into the shared test/report files.

1. **Mobile waitlist owner - `web/src/features/mobile/wait.tsx` and any narrowly scoped new contact UI:** resolve **WUI-02 / MAJOR**. Add permission-gated mobile contact logging without claim or offered-table fields in HTTP mode, including when no table fits. Preserve the fixed assignment/arrival paths and mock offer flow. If extracting desktop contact UI requires editing `waitlist-page.tsx`, assign that file to this same owner; other groups must not touch it.
2. **Mobile edit owner - `web/src/features/mobile/detail.tsx` and `web/src/features/reservations/reservation-detail.tsx`:** resolve **WUI-R1-02 / MINOR**. Bound and scroll the edit content so header, close, save and cancel are reachable at 390x844 and with a shorter visible viewport. Preserve desktop appearance, contracts and validation; keep this change local to the edit dialog.
3. **E2E owner - `web/e2e/phase2b-booking.mjs`, `web/e2e/flows.mjs`, and the worker report:** resolve **WUI-05 / MINOR** by fixing both empty-list selectors and selecting/asserting the actual mobile business date. Resolve **WUI-R1-01 / MINOR** by pinning all phone actions to the intended entry and asserting the reservation-backed null-offer-hold lifecycle, counts, visits and group for both kinds. Add contact and edit-layout regressions after the two UI groups integrate. Do not weaken existing assertions; distinguish mock, transport fixture and coordinator-only live DB evidence in the report.
4. Rerun typecheck, lint, unit tests, HTTP build, mock flows and a11y; repeat the targeted HTTP/mobile checks. The coordinator runs full Phase 2B on its isolated E2E database. Preserve all fixed WUI items, approved backend/data behavior, canonical styling and pending owner tokens. No backend/data-layer change is needed for these findings.

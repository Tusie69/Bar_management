# NA-11 independent UI review - 2026-11-02

UI REVIEW: CHANGES_REQUESTED

Status: UI ownership transfer and visual refinements completed by Gemini 3.8 Flash High; design freeze strictly preserved. Approval is withheld (CHANGES_REQUESTED) solely due to an inherited technical accessibility contrast finding (WCAG AA 3.84:1 vs 4.5:1 required) on dark-mode `.bg-primary` buttons in mobile form and empty-table action cards, which cannot be resolved locally without modifying global design tokens or typography scale frozen under Canonical UI and Nam's explicit aesthetic authority.

---

### Visual consistency:
- Canonical UI alignment: The single-floor receptionist experience aligns cleanly with canonical patterns across mobile, tablet, and desktop viewports.
- Unified header composition: Unified business date picker sits immediately adjacent to the Notification Bell on both mobile and desktop headers. Selected business date is synchronously propagated across floor state, reservation lists, search controls, and waitlist overlays.
- Receptionist search: Fixed 3-digit phone suffix search (`pattern="[0-9]{3}" maxLength={3}`) safely masks guest phone numbers as `***{last3}` and prevents full phone disclosure. Match buttons now feature clear hover and keyboard focus-visible rings (`focus-visible:ring-2 focus-visible:ring-ring`).
- Table states & direct actions: Tapping an empty table immediately triggers contextual booking creation prefilled with table ID, date, and default party size. Reserved and occupied tables provide targeted operational actions (Đổi bàn, Ghép bàn, Xem booking, Nhả bàn) without navigating away.
- Waitlist overlay: The virtual waitlist badge accurately reflects live queue counts (`+n`) and opens an embedded Sheet/modal with action cards rather than unformatted raw JSON or isolated secondary pages.
- Guest count entry: Integrates seamlessly with the existing Zalo booking export workflow for the chosen business date, without redesigning or duplicating TU-15/NA-16 attendance tracking.

---

### Mobile UX:
- Elimination of legacy clutter: The legacy 4 bottom tabs, disjointed status containers, and generic `+` creation floating action button are completely removed for the RECEPTIONIST role.
- Sheet & modal ergonomics: Bottom sheets on 360px, 375px, and 390px viewports use ergonomic touch targets (minimum 44px to 52px height) and proper touch zones.
- Non-blocking table verification: Selection validation during booking creation (`isChecking`) no longer blocks unassigned owner bookings with perpetual loading states. When a specific table is selected, verification displays a neutral, calm indicator (`Đang kiểm tra lại bàn đã chọn...`) without jarring pulse animations (`animationName: "none"`), respecting `prefers-reduced-motion`. Submissions are safely guarded while checking is in flight.
- Inactive action states: Waitlist cards with unavailable tables now clearly display muted, disabled actions (`border-strong bg-transparent text-[var(--text-muted)] opacity-60 cursor-not-allowed`) rather than deceptively active primary borders.

---

### Responsive:
- Viewports validated: Tested across five canonical screen widths (360x800, 375x812, 390x844, 768x1024, and 1280x800).
- Zero geometry overflow: Document horizontal overflow evaluated to `false` across all 50 captured states (`document.documentElement.scrollWidth <= window.innerWidth`).
- Tablet & Desktop Sheet presentation: Fixed duplicate title headers on tablet and desktop (`sm:max-w-[920px]`) by applying `sr-only` to Radix `SheetTitle` and `SheetDescription`, allowing [WaitlistPage](file:///D:/GAM-APP/Bar_management/web/src/features/waitlist/waitlist-page.tsx) to provide the primary semantic header. Wrapped content in `<div className="min-h-0 flex-1 overflow-y-auto">` to ensure smooth independent scrolling without clipping.
- FloorCanvas containment: Converted outer canvas wrapper in [mobile/map.tsx](file:///D:/GAM-APP/Bar_management/web/src/features/mobile/map.tsx) to semantic `<main className="relative min-h-0 flex-1 bg-[var(--floor)]">`, ensuring floating zoom controls and zone tabs reside inside a valid landmark, resolving axe `region` containment violations.

---

### Dark/Light:
- Light theme: Clean, high-contrast palette with 100% WCAG AA compliance across text, borders, surface hierarchy, and active controls.
- Dark theme: Backgrounds, surface elevations (`surface-1`, `surface-2`), table states (free, reserved, occupied, late), and badge tokens render consistently without wash-out or unintended shadows.
- Technical Contrast Finding: In dark mode, the global `--primary` token (`oklch(0.6 0.13 252)`, sampled hex `#3f83cb`) combined with `--primary-foreground` (`oklch(0.99 0 0)`, sampled hex `#fcfcfc`) yields a contrast ratio of 3.84:1. For normal text (16px / font-weight: 600), WCAG AA requires 4.5:1. This finding occurs on:
  - Mobile empty-table action button (`.bg-primary`)
  - Mobile form submission button (`.bg-primary`)
- Design Freeze Constraint: Resolving this finding requires either darkening the dark-mode button background, lightening the text, or increasing the typography scale to large text (>= 18.66px bold or >= 24px regular, threshold 3.0:1). Because global palette tokens in `index.css` and canonical typography scales are strictly frozen by Nam, local ad-hoc color overrides were intentionally avoided to maintain brand integrity.

---

### Visual regressions:
- No visual regressions observed relative to canonical baseline functionality.
- Fixed blank skeleton flash: Replaced dynamic `lazy()` import of [WaitlistPage](file:///D:/GAM-APP/Bar_management/web/src/features/waitlist/waitlist-page.tsx) in [floor-page.tsx](file:///D:/GAM-APP/Bar_management/web/src/features/floor/floor-page.tsx) with a static import, eliminating blank loading skeletons and layout shift when opening the waitlist sheet in dark mode.
- Fixed landmark duplication: Replaced modal `<header>` with `<div>` in [mobile/form.tsx](file:///D:/GAM-APP/Bar_management/web/src/features/mobile/form.tsx) to eliminate duplicate banner landmarks on mobile screens.
- NA-14 rehearsal compatibility: Inspected overlap with PR #3 in rehearsal workspace. UI refinements in [quick-form.tsx](file:///D:/GAM-APP/Bar_management/web/src/features/floor/quick-form.tsx) and [mobile/form.tsx](file:///D:/GAM-APP/Bar_management/web/src/features/mobile/form.tsx) strictly preserve the surrounding lines for `guestType`, `classification`, and `isBirthday`, guaranteeing conflict-free integration.

---

### Required UI fixes:
1. Primary Button Dark-Mode Contrast (Aesthetic & Token Authorization Required):
   - Affected components: Mobile submit button in [web/src/features/mobile/form.tsx](file:///D:/GAM-APP/Bar_management/web/src/features/mobile/form.tsx) and table action buttons in [web/src/features/mobile/detail.tsx](file:///D:/GAM-APP/Bar_management/web/src/features/mobile/detail.tsx) / [quick-form.tsx](file:///D:/GAM-APP/Bar_management/web/src/features/floor/quick-form.tsx).
   - Finding: 3.84:1 contrast ratio against `#3f83cb` in dark theme.
   - Recommended resolution for Nam: Update the dark-mode `--primary` CSS variable in `index.css` to a slightly deeper shade (e.g., `oklch(0.55 0.14 252)`), or authorize an intentional WCAG 3.0:1 large-text exception with 18.66px font sizing.
2. Maintain Source Freeze:
   - All other UI components are settled, fully functional, and verified. No further source modifications should be made without Nam's explicit token direction.

---

### Decisions on existing UI changes (Keep vs Fix):

| File | Codex Implementation Decision | Gemini UI Modification & Rationale |
| --- | --- | --- |
| [web/src/app/app.tsx](file:///D:/GAM-APP/Bar_management/web/src/app/app.tsx) | RETAIN | Preserved role-based router redirecting RECEPTIONIST directly to `/floor`. |
| [web/src/app/shell.tsx](file:///D:/GAM-APP/Bar_management/web/src/app/shell.tsx) | RETAIN | Preserved single top-level header and removed legacy bottom navigation tabs. |
| [web/src/features/floor/floor-page.tsx](file:///D:/GAM-APP/Bar_management/web/src/features/floor/floor-page.tsx) | FIX | Replaced lazy import of `WaitlistPage` with static import to prevent blank skeleton; added `sr-only` to duplicate sheet header; wrapped in scrollable flex container; simplified `draftAt` memoization dependency. |
| [web/src/features/floor/quick-form.tsx](file:///D:/GAM-APP/Bar_management/web/src/features/floor/quick-form.tsx) | FIX | Enhanced tab styling with `disabled:opacity-40 disabled:pointer-events-none transition-colors` so non-current-day Walk-in tab is visibly disabled. |
| [web/src/features/floor/reception-controls.tsx](file:///D:/GAM-APP/Bar_management/web/src/features/floor/reception-controls.tsx) | FIX | Added interactive hover and keyboard focus rings (`hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring`) to last-3-digits search match buttons. |
| [web/src/features/mobile/mobile-app.tsx](file:///D:/GAM-APP/Bar_management/web/src/features/mobile/mobile-app.tsx) | RETAIN | Preserved mobile role-specific layout and overlay routing. |
| [web/src/features/mobile/map.tsx](file:///D:/GAM-APP/Bar_management/web/src/features/mobile/map.tsx) | FIX | Wrapped canvas, zoom controls, and zone tabs inside semantic `<main>` landmark to resolve axe region violation. |
| [web/src/features/mobile/form.tsx](file:///D:/GAM-APP/Bar_management/web/src/features/mobile/form.tsx) | FIX | Memoized table preset dependency; isolated table availability check (`isChecking`) from unassigned owner bookings; replaced jarring red alert with neutral non-pulsing status text; replaced header tag with `div` to resolve duplicate banner landmark; retained canonical button typography and tokens. |
| [web/src/features/mobile/detail.tsx](file:///D:/GAM-APP/Bar_management/web/src/features/mobile/detail.tsx) | RETAIN | Preserved table action buttons and contextual modal transitions. |
| [web/src/features/mobile/overlays.tsx](file:///D:/GAM-APP/Bar_management/web/src/features/mobile/overlays.tsx) | RETAIN | Preserved modal sheet wrappers and backdrop blur styling. |
| [web/src/features/mobile/wait.tsx](file:///D:/GAM-APP/Bar_management/web/src/features/mobile/wait.tsx) | FIX | Replaced deceptive primary border on inactive waitlist actions with `border-strong bg-transparent text-[var(--text-muted)] opacity-60 cursor-not-allowed`. |
| [web/src/features/waitlist/waitlist-page.tsx](file:///D:/GAM-APP/Bar_management/web/src/features/waitlist/waitlist-page.tsx) | RETAIN | Preserved waitlist table view, action menus, and business-date filtering. |

---

### Tests Run:

| Suite | Command | Result | Evidence |
| --- | --- | --- | --- |
| TypeScript Check | `pnpm --filter web typecheck` | Passed (exit 0) | [final-typecheck.log](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/gates/final-typecheck.log) |
| Linter | `pnpm --filter web lint` | Passed (exit 0, 10 non-blocking warnings) | [final-lint.log](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/gates/final-lint.log) |
| Web Production Build | `pnpm --filter web build` | Passed (exit 0, built in 1.25s) | [final-build.log](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/gates/final-build.log) |
| Web Unit Tests | `pnpm --filter web test` | Passed (exit 0, 15 files, 238 passed) | [settled-web-test.log](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/gates/settled-web-test.log) |
| Visual Regression & A11y | `node web/e2e/na11-visual.mjs` | 50 screenshots, 0 overflow, 1 contrast finding | [controlled-final-after.log](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/gates/controlled-final-after.log) |
| HTTP E2E Acceptance | `node web/e2e/na11-http.mjs` | Passed (exit 0, 11/11 checks clean) | [settled-na11-http.log](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/gates/settled-na11-http.log) |

---

### Screenshots reviewed:

Controlled matched comparison evaluated between baseline [controlled-baseline-booking](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/controlled-baseline-booking/) and final after [controlled-final-after](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/controlled-final-after/):

1. **360x800 Mobile**:
   - [360x800-light-floor.png](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/controlled-final-after/360x800-light-floor.png) vs [baseline](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/controlled-baseline-booking/360x800-light-floor.png): Clean single header; date picker adjacent to bell; no legacy bottom tabs; canvas centered.
   - [360x800-dark-floor.png](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/controlled-final-after/360x800-dark-floor.png) vs [baseline](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/controlled-baseline-booking/360x800-dark-floor.png): Identical table geometry; B3 late status rendered cleanly; contrast on floor surfaces stable.
   - [360x800-light-empty-table.png](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/controlled-final-after/360x800-light-empty-table.png) vs [baseline](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/controlled-baseline-booking/360x800-light-empty-table.png): Contextual bottom sheet for Table A1 renders directly; clear touch action.
   - [360x800-dark-empty-table.png](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/controlled-final-after/360x800-dark-empty-table.png) vs [baseline](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/controlled-baseline-booking/360x800-dark-empty-table.png): Dark sheet elevation correct; button contrast noted for Nam.
   - [360x800-light-form.png](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/controlled-final-after/360x800-light-form.png) vs [baseline](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/controlled-baseline-booking/360x800-light-form.png): Direct booking form prefilled; party counter and quick buttons responsive.
   - [360x800-dark-form.png](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/controlled-final-after/360x800-dark-form.png) vs [baseline](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/controlled-baseline-booking/360x800-dark-form.png): Form renders with proper input backgrounds; neutral status text on table check; button contrast noted.
   - [360x800-light-occupied-table.png](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/controlled-final-after/360x800-light-occupied-table.png) vs [baseline](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/controlled-baseline-booking/360x800-light-occupied-table.png): Contextual actions (Đổi bàn, Ghép bàn, Xem booking, Nhả bàn) distinct and accessible.
   - [360x800-dark-occupied-table.png](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/controlled-final-after/360x800-dark-occupied-table.png) vs [baseline](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/controlled-baseline-booking/360x800-dark-occupied-table.png): High-contrast danger/warning colors for release and change table actions.
   - [360x800-light-waitlist.png](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/controlled-final-after/360x800-light-waitlist.png) vs [baseline](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/controlled-baseline-booking/360x800-light-waitlist.png): Virtual waitlist sheet opens cleanly; entry cards display party size and status.
   - [360x800-dark-waitlist.png](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/controlled-final-after/360x800-dark-waitlist.png) vs [baseline](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/controlled-baseline-booking/360x800-dark-waitlist.png): Static import renders immediately with zero skeleton flash.

2. **375x812 Mobile (Standard iPhone)**:
   - [375x812-light-floor.png](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/controlled-final-after/375x812-light-floor.png), [375x812-dark-floor.png](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/controlled-final-after/375x812-dark-floor.png): Safe-area padding respected; zoom controls positioned within main floor area.
   - [375x812-light-form.png](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/controlled-final-after/375x812-light-form.png), [375x812-dark-form.png](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/controlled-final-after/375x812-dark-form.png): Full vertical scrolling verified; fixed CTA bar pinned above bottom navigation safe area.
   - [375x812-light-empty-table.png](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/controlled-final-after/375x812-light-empty-table.png), [375x812-dark-empty-table.png](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/controlled-final-after/375x812-dark-empty-table.png): Sheet presentation fluid without horizontal jitter.

3. **390x844 Mobile (Modern Smartphone)**:
   - [390x844-light-floor.png](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/controlled-final-after/390x844-light-floor.png), [390x844-dark-floor.png](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/controlled-final-after/390x844-dark-floor.png): Verified floor state at 2026-11-02T14:30:00Z; search bar neatly integrated.
   - [390x844-light-form.png](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/controlled-final-after/390x844-light-form.png), [390x844-dark-form.png](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/controlled-final-after/390x844-dark-form.png): Form layout clean; 3-digit masked results and booking fields comfortably spaced.
   - [390x844-light-waitlist.png](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/controlled-final-after/390x844-light-waitlist.png), [390x844-dark-waitlist.png](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/controlled-final-after/390x844-dark-waitlist.png): Inactive action button displays muted border-strong outline with disabled styling.

4. **768x1024 Tablet**:
   - [768x1024-light-floor.png](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/controlled-final-after/768x1024-light-floor.png), [768x1024-dark-floor.png](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/controlled-final-after/768x1024-dark-floor.png): Layout scales cleanly; header controls consolidate into responsive row.
   - [768x1024-light-form.png](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/controlled-final-after/768x1024-light-form.png), [768x1024-dark-form.png](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/controlled-final-after/768x1024-dark-form.png): Right-side drawer renders without overlapping floor overview.
   - [768x1024-light-waitlist.png](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/controlled-final-after/768x1024-light-waitlist.png), [768x1024-dark-waitlist.png](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/controlled-final-after/768x1024-dark-waitlist.png): Sheet width capped at 920px; single header shown; no double header text.

5. **1280x800 Desktop**:
   - [1280x800-light-floor.png](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/controlled-final-after/1280x800-light-floor.png), [1280x800-dark-floor.png](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/controlled-final-after/1280x800-dark-floor.png): Expansive floor view with full zone selection tabs and quick reception controls.
   - [1280x800-light-form.png](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/controlled-final-after/1280x800-light-form.png), [1280x800-dark-form.png](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/controlled-final-after/1280x800-dark-form.png): Form and list sidebars render side-by-side with zero horizontal clipping.
   - [1280x800-light-waitlist.png](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/controlled-final-after/1280x800-light-waitlist.png), [1280x800-dark-waitlist.png](file:///D:/GAM-APP/Bar_management/web/e2e/.artifacts/na11/controlled-final-after/1280x800-dark-waitlist.png): Waitlist sheet displays rich information columns with clean scrollable list.

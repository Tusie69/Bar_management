# NA-11 design freeze and visual acceptance contract

Mode: Extension of Canonical UI, workflow changes only. User explicitly authorized this system and autonomous implementation; human visual approval is the final draft-PR gate, not an additional speculative design checkpoint.

Design Read: operational floor interface for receptionists at phone distance and tablet/desktop counter distance. Existing restrained operational UI, two established responsive shells. Visual variance 2, motion 2, information density 7, asset dependence 3, brand fidelity 10. Keep one floor focal area; move secondary tasks into existing overlays rather than adding panels. No new motion.

Positioning: operational workspace, not marketing; quiet and readable under time pressure; phone touch targets at least 44px where new controls are added; header must fit 360px with search/actions arranged in existing spacing rhythm, not squeezed into one dense row.

Existing brand/assets:
- Logo: web/public/21gam-logo.png, reused by existing shell; no redraw.
- Desktop fonts: Roboto via web/src/index.css; mobile: Be Vietnam Pro via web/src/features/mobile/mobile.css.
- Existing light primary: oklch(0.5 0.15 255); mobile primary: oklch(0.52 0.15 255); dark tokens remain their existing values. All new controls use semantic existing tokens.
- Desktop radius --radius=2px; mobile scoped --radius=12px plus existing component radii. No global changes.
- Existing border/shadow/spacing/Button/Dialog/Sheet/Calendar/Popover/icon vocabulary only.
- Tokens, table state colors, typography, logo, FloorCanvas source/geometry/zoom/pan are frozen.

Baseline: develop a37e6bc, browser Chrome headless, existing deterministic mock development fixture with browser clock fixed to 2026-11-02T14:30:00.000Z (21:30 Vietnam). These are explicitly synthetic visual-test fixtures; production functionality must use existing HTTP services, not fabricated search/count/waitlist data.

Capture Before/After at 360x800, 390x844, 768x1024, 1280x800 in light/dark, plus 375x812 responsive validation. Same seed/clock/browser/business date/viewport/theme for comparison. States: floor/header/navigation, empty-table panel/form, occupied/reserved panel, waitlist. Screenshots under Git-ignored web/e2e/.artifacts/na11.

Runtime/QA: verify no overflow, reachable controls, focusable overlays, correct date/form table binding, spare/oos guards, all last3 matches, real waitlist/count contracts, owner navigation unchanged, phone masking, mutation invalidation/polling and NA-14 compatibility. HTTP/MySQL checks separately from synthetic visual fixtures.

Rollback: feature branch only; develop and NA-14 branch unchanged. No force push/merge. Any rejected visual change can be reverted selectively after review without deleting others' work.

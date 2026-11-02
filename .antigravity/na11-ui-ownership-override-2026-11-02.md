# NA-11 UI ownership transfer - Nam's explicit override, 2026-11-02

You are the actual Gemini 3.8 Flash High UI owner. Do not impersonate a different model. Confirm actual model/effort from the Orca launch. Coordinate under the live Task/Dispatch.

Target: D:/GAM-APP/Bar_management, existing feature/na-11-single-floor. Base develop a37e6bc93de1e02a47c6f3b50ddce011dcc9649d. Existing NA-11 commit 19be8843e822228c21d41e71200556dda1e452dd was implemented by Codex before this ownership override. Preserve it, review it, retain good parts, selectively fix UI. No reset, clean, branch replacement, commits, pushes, merge or DB changes. Do not edit D:/GAM-APP/21gam-platform or na11-na14-rehearsal.

Read user AGENTS instructions and relevant project workflow; query relevant agentmemory. No .codegraph exists in this repo. Existing implementation diff: git diff a37e6bc..19be884 -- web/src. You now directly own all visual decisions and React TSX/CSS implementation for NA-11. Codex owns engineering, tests and services; ask coordinator before crossing that boundary. Boss must not replace your visual decisions. Do not spawn extra workers.

Scope/ownership: web/src/app/{app,shell}.tsx; web/src/features/floor/{floor-page,quick-form,reception-controls}.tsx; web/src/features/mobile/{mobile-app,map,form,detail,overlays,wait}.tsx; web/src/features/waitlist/waitlist-page.tsx; UI fixes within related existing components only after reporting need. You may write docs/reviews/2026-11-02-na11-gemini-ui-review.md. Do not touch web/e2e, service/hooks/rules/test files (Codex owns), backend, package/lockfiles, tokens/global typography/palette or floor-canvas.tsx. If a technical problem requires changing one of your UI files, give Codex exact component/patch direction or make the fix yourself.

Required outcome: one receptionist floor on mobile/tablet/desktop; no old 4 tabs, separate old status areas or general create (+). Existing empty valid table opens prefilled booking form; reserved/occupied tables keep valid actions. Calendar next to bell; consistent selected business date. Exactly 3-digit last-phone search, no full phone disclosure or fabricated results. Real waitlist (+n) overlay. Functional existing guest-count entry (no NA-16/TU-15 reimplementation). Preserve owner/admin routes, booking capacity/spare/oos validation, walk-in/check-in/move/merge, accessibility, realtime and NA-14 metadata.

Design freeze: extend Canonical UI only; preserve Dark/Light, typography, palette, tokens, icon set, radii/shadows, spacing conventions, standardized components, FloorCanvas geometry/table positions/shapes/zoom/pan. Header/component composition and local spacing changes allowed. No redesign.

Visual baseline already exists at web/e2e/.artifacts/na11/before/; after/ also exists but requires your actual review. Read manifests and inspect actual image files with image tools. Same browser/data fixture/time/theme/viewports: 360x800,390x844,768x1024,1280x800, light/dark. Baseline a37e6bc; deterministic mock fixture at 2026-11-02T14:30:00.000Z, explicitly synthetic visual testing. Technical HTTP tests are separate. Do not claim you captured old baseline. Codex can refresh after images; coordinate once UI edits settle. Also validate 375px. Check contrast, touch reachability, no overflow, overlay focus/scroll, table visibility, and visual consistency. Deadline target 21:00 Asia/Saigon today without sacrificing quality.

Report actual files changed, decisions on each existing UI change (keep/fix), tests run and screenshots actually inspected. Required verdict:
UI REVIEW: APPROVED | CHANGES_REQUESTED
Visual consistency:
Mobile UX:
Responsive:
Dark/Light:
Visual regressions:
Required UI fixes:
Screenshots reviewed:

Your self-review is not fully independent. Codex performs separate technical review, Boss verifies evidence, Nam alone approves aesthetics and merge remains forbidden. Check coordination inbox at checkpoints, send legitimate worker_done and idle after completion.

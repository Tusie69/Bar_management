# NA-11 Codex Worker

Workspace: D:/GAM-APP/Bar_management. Branch feature/na-11-single-floor from develop a37e6bc. Boss is the parent agent. Read this brief and applicable AGENTS instructions. Query relevant memory; no direct memory DB access.

Stage 1 is READ-ONLY architecture audit. Do not edit product source until parent sends RELEASE_IMPLEMENTATION after visual baseline and Gemini availability/review check. Send a concise file/flow plan and specific risks quickly.

Implement the user's NA-11 single-floor receptionist workflow only. Preserve canonical visual identity exactly: no global CSS/tokens, fonts, icon vocabulary, FloorCanvas source/geometry/zoom/pan changes. Other roles retain existing routes and workflows. No backend/schema/seed changes. No dependency additions. PR #3/NA-14 remains unmerged on feat/na-14-booking-metadata; avoid editing its form/adapter regions and preserve metadata when integrated later.

Audit mobile/mobile-app.tsx, mobile/map.tsx, mobile/context.ts, mobile/actions.ts, mobile/overlays.tsx, floor/floor-page.tsx, floor/floor-toolbar.tsx, floor/quick-form.tsx, floor/table-detail.tsx, app/nav.ts, app/shell.tsx, routing, state/ui.ts, hooks/use-data.ts, use-floor-model.ts, waitlist/reservation overlays, services/contracts. Read callers before edits.

Work packages: mobile single-floor and no bottom nav/general plus for RECEPTIONIST; header calendar next to alerts; selected business date shared by floor/bookings/waitlist and preserved after overlays; empty valid table opens existing booking form prefilled with table/date; reserved/occupied opens existing correct actions; forbid spare/oos/nonbookable/missing states; search exactly 3 digits using existing real booking search if usable (all matches, only phoneLast3, date scoped); real waitlist entrypoint (+n) overlay reuse; honest count entrypoint with existing export/count data or disabled explanation; desktop/tablet same floor-centric composition without removing owner/admin screens. Keep check-in/walk-in/move/combine/table pick actions and capacity checks.

Preferred minimum composition: role-scoped existing shells and floor canvas; reuse existing Sheet/Dialog/Calendar/DateField/actions instead of a parallel application. Do not assume mobile map's current business-date wiring is correct; use model for selected date. Do not synthesize backend data.

Ownership after release: web/src application files and meaningful unit tests for new logic. Parent owns web/e2e, docs, .codex/.antigravity prompts, git/PR and validation orchestration. Coordinate before touching parent-owned files. No other agents, commits, git switches/merges, pushes, PR actions or server restarts without parent instruction.

Return changed files, architecture decisions, tests actually run, remaining risks. Use actual tools; do not impersonate Gemini or claim independent approval. No user-facing approval questions: preserve/freeze directions and autonomous execution were explicitly authorized; human visual approval is the final PR gate.

# NA-11 engineering and independent technical review - 2026-11-02

Role: Codex supporting engineer and technical QA. Target D:/GAM-APP/Bar_management on EXISTING feature/na-11-single-floor. Base a37e6bc; existing Codex implementation 19be884. Preserve it and the two pending changes web/e2e/na11-{http,visual}.mjs. Do not reset, clean, switch branch, commit, push, merge, change DB dev/production or touch other checkouts. Query relevant agentmemory; no .codegraph at repo root. Do not spawn extra workers.

Nam's override: Gemini 3.8 Flash High now owns ALL UI TSX/CSS/layout/composition/visual decisions. Never independently design, rewrite or adjust UI, fonts/colors/icons/spacing/FloorCanvas. Report UI bugs to Boss with exact reproduction and suggested technical constraint; Gemini decides patch. You can execute a precise Gemini UI patch only when explicitly delegated. Scope: state/API integration, hooks/services/reception rules/unit tests, web/e2e tests, technical review report. Parent owns prompts, final report, git/PR actions. Do not touch UI files concurrently with Gemini. First read all relevant callers before any fix.

Audit existing git diff a37e6bc..19be884 and pending E2E diff. Check state/table/venue/date propagation, real API/query invalidation, booking create/edit/check-in/walk-in/move/merge, date 17:00-05:00, capacity, spare/oos guard, last3 search exactly three digits/all matches/masking, real waitlist and existing guest count, realtime/polling, RBAC/route guards and multiuser concurrency. Preserve TU-11/TU-12/TU-21 semantics; no fabricated production data.

PR #3 NA-14 remains open head 33dd9a2bed16fcd713e6b0d871bca6ea5c67cd04. High-risk overlap: floor/quick-form.tsx and mobile/{form,detail}.tsx. Do not merge/cherry-pick/reset any branch. Existing detached D:/GAM-APP/na11-na14-rehearsal may contain a prior merge rehearsal; inspect read-only, report exact status and conflict hunks/metadata compatibility. All actual integration belongs to later human-authorized merge. Develop unchanged.

Run actual existing pnpm typecheck/lint/test/build scripts and relevant E2E, retaining logs under Git-ignored web/e2e/.artifacts/na11. Reproduce any defect via real-user-like E2E before fix. Existing NA11 HTTP E2E uses isolated *_test MySQL on port 33317 and random ephemeral credentials; never print secrets or use dev DB. Inspect environment before tests. Technical tests can run while Gemini reviews; do not capture final After while UI edits are in progress. Run refreshed visual screenshot script after coordinator says UI settled; 360/375/390/768/1280 required geometry/responsive, Before/After 360x800,390x844,768x1024,1280x800 light/dark. Keep same seed/time/browser/theme/state; preserve before/. Synthetic screenshots do not prove HTTP integration.

Report severe findings promptly for Gemini. Make smallest engineering fixes and meaningful assertions, no speculative features/dependencies. Run technical review of Gemini's final diff separately after UI handoff; do not claim final review while Gemini is still editing. Write docs/reviews/2026-11-02-na11-codex-technical-review.md with actual commands, outcomes, evidence and limitations. Required verdict:
TECHNICAL REVIEW: APPROVED | CHANGES_REQUESTED
Architecture:
Functional correctness:
Security:
Realtime:
Regression:
Tests:
Required technical fixes:

No PASS without observed evidence. Deadline target 21:00 Asia/Saigon today; quality wins. Check coordinator inbox at checkpoints, legitimate worker_done on completion and idle. Nam alone approves final UI.

Receptionists now work from one floor map on mobile, tablet and desktop. Empty bookable tables open the existing booking form with the selected table and business date; reserved/occupied tables retain their actions. Calendar, masked three-digit phone search, real waitlist and reservation guest totals use existing overlays and APIs. Owner/admin routes and Canonical UI tokens, typography and FloorCanvas are preserved.

## Review state

Draft, CHANGES_REQUESTED. Gemini directly owns the UI and supplied a UI review; Codex supplied a separate technical review. Both withhold approval. Nam has not approved aesthetics. Detailed files/owners, acceptance criteria, actual evidence and risks: [NA-11 delivery report](docs/integration/na11-2026-11-02-report.md).

## Validation

- Final typecheck/lint/build pass; 238 web unit tests pass.
- Real HTTP E2E: 11 checks pass across 360/375/390/768/1280, including booking/check-in/walk-in/move/merge, dates, masks, RBAC, polling and concurrency.
- Matched Before/After: 50 PNG each, five viewports, Light/Dark, five states, no overflow. Local gallery/portable visual archive are recorded in the report.
- Owner unassigned saving, actual pending availability guard and reduced-motion regression assertions pass.
- NA-14 narrow metadata/settings/migration/seed tests: 6 pass; audited textual merge clean. Full merged UI validation remains pending.

## Blocking findings

- Isolated current-schema API gate: 296 pass/1 fail. Reproduced SQL chronology anomaly makes grouped cancellation/no-show return 500; a later passing retry does not resolve it. Backend source, guards and constraints are unchanged.
- Visual accessibility gate exits 1 on six occurrences of the inherited dark mobile primary-button contrast issue: stable enabled button 3.84:1 versus 4.5:1. Original Canonical type/palette remain frozen. No rule suppression or new color/type bypass.

Guest totals reuse existing booking export and exclude walk-ins. Existing search caps remain a TU-21 dependency; NA-16/TU-15 are not implemented here. PR #3 remains independent. Do not merge until technical findings and human visual approval are resolved.

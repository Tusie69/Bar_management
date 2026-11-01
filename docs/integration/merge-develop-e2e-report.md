# E2E merge of origin/develop into canonical web E2E test suites

Date: 2026-10-31 / 2026-11-01. Worktree: `feature-canonical-ui-web`.  
Task: `task_98d7301d67dc`; dispatch: `ctx_62fb1d61233e`; terminal: `term_97493906-917f-4189-8c88-0ffc32ec8eac`.  
Worker: 4 of 4 (E2E Integration & Verification).

---

## 1. Conflict Resolutions in `web/e2e/phase2b-booking.mjs`

- **Preservation of Canonical Foundation**:
  - Retained canonical role- and accessible-label-based selectors approved in round 2 for WUI-05, avoiding brittle internal test IDs or obsolete CSS class selectors.
  - Kept canonical Mobile V1 layout workflows and interaction patterns.
- **Reconciliation of Develop's New Assertions**:
  - **Waitlist Background Polling**: Incorporated assertions ensuring `validWaitlistReads >= 1`, background polling continues across views, and `invalidWaitlistReads === 0`.
  - **Horizontal Time Picker (Desktop Sheet)**: Incorporated develop's 13-slot rendering check, horizontal slot alignment validation, arrow key navigation (`ArrowRight` / `ArrowLeft`), and scroll/overflow boundary checks.
  - **Mobile Touch Context**: Added `hasTouch: true` to the Mobile V1 context.
  - **Mobile Time Picker Wheel Interaction**: Incorporated mobile booking sheet opening and wheel scroll / touch interaction checks.
- **Verification**:
  - 0 conflict markers remain. Confirmed clean state via regex search.
  - As instructed, `phase2b-booking.mjs` was not executed against any local database; execution is reserved for the coordinator on the isolated e2e database.

---

## 2. Porting Develop Additions from `web/e2e/layout-first.mjs` to `web/e2e/flows.mjs`

Develop had added scenarios testing direct bar seating and multi-seat bar reservations in `web/e2e/layout-first.mjs`, a temporary test file scheduled for deletion in the canonical UI.

1. **`bar seat: single walk-in from table detail`**:
   - Ported to `web/e2e/flows.mjs`.
   - Clicks a free bar seat (`Ghế Bar 13`), opens table detail modal, clicks `Mở Ghế Bar 13 cho 1 khách`, and verifies live status transitions to `Đang sử dụng`.
2. **`bar seat: multi-seat booking capacity check & group reservation`**:
   - Ported to `web/e2e/flows.mjs`.
   - Covers develop's `directBarCapacityPreflight` and `directBarMultiSeatAtomic` flows.
   - Clicks free bar seat (`Ghế Bar 8`), clicks `Đặt trước` to open QuickForm.
   - Selects `2 khách` -> asserts capacity shortage warning (`thiếu 1 chỗ cho 2 khách`).
   - Clicks adjacent bar seat (`Ghế Bar 7`) directly on the floor canvas -> asserts capacity satisfied (`Sức chứa 2 chỗ · đủ cho 2 khách`).
   - Fills customer contact details (`Khách Bar Ghép`, `0912345678`) and submits `Lưu đặt bàn`.
   - Asserts both bar seats transition to reserved (`Đang đặt`) and grouped (`nhóm \d+`).
3. **Hardened Existing Flows in `web/e2e/flows.mjs`**:
   - Fixed Playwright strict mode locator collision in `direct waitlist assignment -> HOLD_ACTIVE -> arrival check-in (desktop)` at line 250 by using `{ exact: true }` on `getByText("Đang giữ bàn", { exact: true })`.
4. **Deletion of Obsolete Test File**:
   - `web/e2e/layout-first.mjs` was completely removed from disk via normal filesystem deletion (`Remove-Item`). No `git rm` was executed.

---

## 3. Verification & Acceptance Proof

### Static Quality Checks
- `pnpm --dir web typecheck`: **Exit 0** (`tsc -b --noEmit` passed with 0 errors across the entire codebase).
- `pnpm --dir web lint`: **Exit 0** (`oxlint src e2e` passed with 0 errors, 11 existing warnings from untouched files).

### Runtime Mock Server
- Started Vite mock server on dedicated port **5184**:
  ```powershell
  Set-Location web; $env:VITE_API_MODE='mock'; npx vite --port 5184 --strictPort
  ```
- Verified HTTP 200 response on `http://localhost:5184/`.

### E2E Flows Suite (`pnpm e2e` / `node e2e/flows.mjs`)
Executed with `E2E_BASE_URL=http://localhost:5184` and `PW_CHROMIUM_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'`:
- **Result**: **Exit 0 — ALL PASSED** (19 of 19 flows passed):
  1. `PASS walk-in from table panel, then undo`
  2. `PASS inline walk-in suggests a table (3 taps)`
  3. `PASS check-in reserved booking A5`
  4. `PASS move seated party B7? -> combine B5 + B7 then split`
  5. `PASS booking flow end-to-end for tomorrow with table`
  6. `PASS validation: booking needs name or phone, note without phone`
  7. `PASS conflict: another device takes the table at confirm`
  8. `PASS undo blocked after remote edit (conflict UX)`
  9. `PASS time warp: A5 becomes late after +15', no auto cancel after +60'`
  10. `PASS waitlist: claim, accept offer -> hold, then seat when guest arrives`
  11. `PASS receptionist cannot reveal phone; owner can`
  12. `PASS receptionist sees no reveal button and no reports`
  13. `PASS availability tomorrow: B3 reserved, A3 free`
  14. `PASS inline form: occupied table is refused, free table is picked on the map`
  15. `PASS cancel booking requires confirmation with reason`
  16. `PASS direct waitlist assignment -> HOLD_ACTIVE -> arrival check-in (desktop)`
  17. `PASS direct waitlist assignment -> HOLD_ACTIVE -> arrival check-in (phone 390px)`
  18. `PASS mobile booking creation with classification and Zalo export (phone 390px)`
  19. `PASS bar seat: single walk-in from table detail`
  20. `PASS bar seat: multi-seat booking capacity check & group reservation`

### Accessibility Suite (`pnpm a11y` / `node e2e/a11y.mjs`)
Executed against port 5184 for all application views across dark and light themes:
- Views audited: `floor`, `overview`, `reservations`, `waitlist`, `guests`, `reports`, `settings`, `booking`, `walkin`, `table-seated`, `table-free`, `timeline`.
- **Result**: **Exit 0 — NO VIOLATIONS**.

### Server Teardown
- Vite background daemon on port 5184 terminated cleanly. Verified port 5184 is no longer in use.

---

## 4. Summary of File Changes

| File | Status | Description |
| --- | --- | --- |
| `web/e2e/phase2b-booking.mjs` | Modified | Resolved merge conflicts; integrated develop's polling, time picker, and mobile assertions onto canonical selectors. |
| `web/e2e/flows.mjs` | Modified | Ported single bar walk-in and atomic multi-seat group booking scenarios; fixed strict mode locator ambiguity. |
| `web/e2e/layout-first.mjs` | Deleted from disk | Obsolete develop test file reconciled and removed. |
| `docs/integration/merge-develop-e2e-report.md` | Created | Comprehensive merge and verification report. |

No files outside the permitted scope (`web/e2e/**`, `docs/integration/merge-develop-e2e-report.md`) were modified. No git commit, push, merge, rebase, reset, stash, add, or rm operations were performed.

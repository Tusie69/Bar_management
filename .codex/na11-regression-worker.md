# NA-11 legacy regression worker

Parent delegated only web/e2e/flows.mjs to this worker. Preserve all business assertions and run every test without skips. Legacy multi-page scenarios use owner user3, whose existing UI remains available, and report themselves as Owner legacy regression. Keep receptionist security on user1: /reports redirects to /floor and phone reveal remains unavailable. Parent's real HTTP NA-11 suite covers receptionist single-floor booking, exact last3, waitlist/count, check-in, walk-in, move/merge and concurrency.

Use the existing mock Vite at http://127.0.0.1:5191 and Chrome C:/Program Files/Google/Chrome/Application/chrome.exe. Run the actual pnpm --filter @21gam/web e2e script with E2E_BASE_URL and PW_CHROMIUM_PATH. Fix harness assumptions only, disclose baseline failures, no unrelated product rewrites, no changes to other e2e files, no commits or branch operations.

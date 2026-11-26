// E2E verification & before/after screenshot capture for NA-43 (P2) Admin UI.
// Usage:
//   Verify HEAD:  node web/e2e/na43-p2.mjs
//   Capture:      node web/e2e/na43-p2.mjs --capture --out <dir> --prefix <before|after> [--root <repoRoot>]
import assert from "node:assert/strict"
import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "@playwright/test"
import { createServer } from "vite"

const require = createRequire(import.meta.url)
const axeSrc = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8")
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const defaultRepoRoot = path.resolve(__dirname, "..", "..")

function parseArgs(argv) {
  const args = { capture: false, out: null, prefix: "after", root: defaultRepoRoot }
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token === "--capture") args.capture = true
    else if (token === "--out") args.out = argv[++i]
    else if (token === "--prefix") args.prefix = argv[++i]
    else if (token === "--root") args.root = path.resolve(argv[++i])
  }
  return args
}

const VIRTUAL_ENTRY_ID = "/src/__na43_p2_entry.js"
const RESOLVED_VIRTUAL_ENTRY_ID = `\0${VIRTUAL_ENTRY_ID}`

function buildVirtualEntrySource() {
  return `
import "@/index.css"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createElement, StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { createBrowserRouter, Navigate, RouterProvider } from "react-router"
import { Toaster } from "sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { adminRoute } from "@/features/admin/admin-routes"
import { AuthBoundary } from "@/features/auth/auth-boundary"
import { api } from "@/services"
import { useSession } from "@/state/session"

const profile = window.__NA43_PROFILE__
if (api.mode === "mock" && profile === "READ_ONLY") {
  const readonlyUser = {
    id: 99,
    displayName: "Admin Chỉ đọc",
    role: "ADMIN",
    deviceLabel: "Web",
  }
  api.setSession(readonlyUser)
  useSession.setState({
    user: readonlyUser,
    principal: {
      id: 99,
      username: "admin_readonly",
      displayName: "Admin Chỉ đọc",
      organizationId: 1,
      venueId: 1,
      roles: ["ADMIN"],
      accessLevel: "READ_ONLY",
    },
    permissions: ["report.read", "user.read", "customer.view_masked", "audit.read"],
    portal: "admin",
    authStatus: "authenticated",
    authError: null,
  })
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 1000, retry: false } },
})

const router = createBrowserRouter([
  { path: "/", element: createElement(Navigate, { to: "/admin/overview", replace: true }) },
  adminRoute,
  { path: "*", element: createElement("div") },
])

createRoot(document.getElementById("root")).render(
  createElement(
    StrictMode,
    null,
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(
        TooltipProvider,
        { delayDuration: 150 },
        createElement(AuthBoundary, null, createElement(RouterProvider, { router })),
        createElement(Toaster, { position: "bottom-right", richColors: true, closeButton: true }),
      ),
    ),
  ),
)
`
}

function createVirtualEntryPlugin(webRoot) {
  const indexHtmlPath = path.join(webRoot, "index.html")
  return {
    name: "na43-p2-virtual-entry",
    resolveId(id) {
      if (id === VIRTUAL_ENTRY_ID) return RESOLVED_VIRTUAL_ENTRY_ID
      return null
    },
    load(id) {
      if (id === RESOLVED_VIRTUAL_ENTRY_ID) return buildVirtualEntrySource()
      return null
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const rawUrl = req.url ?? "/"
        const pathname = rawUrl.split("?")[0]
        if (
          req.method !== "GET" ||
          pathname.startsWith("/@") ||
          pathname.startsWith("/src/") ||
          pathname.startsWith("/node_modules/") ||
          pathname.startsWith("/api/") ||
          path.extname(pathname) !== ""
        ) {
          next()
          return
        }
        try {
          const rawHtml = fs.readFileSync(indexHtmlPath, "utf8").replace("/src/main.tsx", VIRTUAL_ENTRY_ID)
          const html = await server.transformIndexHtml(rawUrl, rawHtml)
          res.statusCode = 200
          res.setHeader("Content-Type", "text/html; charset=utf-8")
          res.end(html)
        } catch (err) {
          next(err)
        }
      })
    },
  }
}

async function startViteServer(webRoot, envOverrides = {}) {
  const previous = new Map()
  for (const [key, value] of Object.entries(envOverrides)) {
    previous.set(key, process.env[key])
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    const server = await createServer({
      root: webRoot,
      configFile: path.join(webRoot, "vite.config.ts"),
      server: { port: 0, host: "127.0.0.1", strictPort: false, open: false },
      optimizeDeps: { noDiscovery: false },
      plugins: [createVirtualEntryPlugin(webRoot)],
    })
    await server.listen()
    const addr = server.httpServer?.address()
    assert(addr && typeof addr === "object", "Vite server failed to bind a TCP port")
    return { server, baseUrl: `http://127.0.0.1:${addr.port}` }
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

function launchBrowser() {
  const defaultChrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  return chromium.launch(
    process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : fs.existsSync(defaultChrome)
        ? { executablePath: defaultChrome }
        : {},
  )
}

function createFixtureAccounts() {
  return [
    {
      id: 9524,
      version: 1,
      username: "na40_143b20d1",
      displayName: "Nhân viên kiểm kê giao diện ca tối 27",
      roles: ["WAITER"],
      accessLevel: null,
      status: "ACTIVE",
      membershipStatus: "ACTIVE",
      lastLoginAt: null,
    },
    {
      id: 9523,
      version: 1,
      username: "na40_1cbebff4",
      displayName: "Nhân viên kiểm kê giao diện ca tối 26",
      roles: ["WAITER"],
      accessLevel: null,
      status: "ACTIVE",
      membershipStatus: "ACTIVE",
      lastLoginAt: "2026-11-22T14:20:00.000Z",
    },
    {
      id: 1,
      version: 1,
      username: "le_tan_1",
      displayName: "Lễ tân 1",
      roles: ["RECEPTIONIST"],
      accessLevel: null,
      status: "ACTIVE",
      membershipStatus: "ACTIVE",
      lastLoginAt: "2026-11-23T09:10:00.000Z",
    },
    {
      id: 2,
      version: 1,
      username: "thu_ngan_1",
      displayName: "Thu ngân 1",
      roles: ["CASHIER"],
      accessLevel: null,
      status: "ACTIVE",
      membershipStatus: "ACTIVE",
      lastLoginAt: "2026-11-23T08:00:00.000Z",
    },
    {
      id: 5,
      version: 1,
      username: "admin_ro",
      displayName: "Quản lý chỉ xem",
      roles: ["ADMIN"],
      accessLevel: "READ_ONLY",
      status: "ACTIVE",
      membershipStatus: "ACTIVE",
      lastLoginAt: "2026-11-22T18:30:00.000Z",
    },
    {
      id: 3,
      version: 2,
      username: "owner",
      displayName: "Chủ quán",
      roles: ["OWNER"],
      accessLevel: null,
      status: "ACTIVE",
      membershipStatus: "ACTIVE",
      lastLoginAt: "2026-11-23T10:05:00.000Z",
    },
  ]
}

function createFixtureAuditEntries() {
  return [
    {
      id: 101,
      occurredAt: "2026-11-23T01:51:49.000Z",
      actor: "Hệ thống",
      actorUsername: null,
      action: "AUTH_LOGIN_FAILED",
      actionType: "login",
      actionLabel: "Đăng nhập thất bại",
      target: "Phiên của E2E Chủ quán",
      detail: "portal: admin · result: FAILURE",
      device: "Hệ thống",
    },
    {
      id: 100,
      occurredAt: "2026-11-23T01:49:10.000Z",
      actor: "Hệ thống",
      actorUsername: null,
      action: "AUTH_LOGIN_FAILED",
      actionType: "login",
      actionLabel: "Đăng nhập thất bại",
      target: "Phiên của E2E Bartender",
      detail: "portal: preparation · result: FAILURE",
      device: "Hệ thống",
    },
    {
      id: 99,
      occurredAt: "2026-11-23T01:45:02.000Z",
      actor: "Chủ quán",
      actorUsername: "owner",
      action: "AUTH_LOGIN_SUCCEEDED",
      actionType: "login",
      actionLabel: "Đăng nhập thành công",
      target: "Phiên của Chủ quán",
      detail: "portal: admin · result: SUCCESS",
      device: "Chrome Desktop",
    },
    {
      id: 98,
      occurredAt: "2026-11-23T01:30:00.000Z",
      actor: "Chủ quán",
      actorUsername: "owner",
      action: "ACCOUNT_ROLE_UPDATED",
      actionType: "permission",
      actionLabel: "Đổi quyền",
      target: "Tài khoản Lễ tân 1",
      detail: "roleCode: WAITER · accessLevel: READ_ONLY · unknownKey: rawValue",
      device: "Chrome Desktop",
    },
    {
      id: 97,
      occurredAt: "2026-11-23T01:15:00.000Z",
      actor: "Lễ tân 1",
      actorUsername: "le_tan_1",
      action: "BOOKING_CANCEL",
      actionType: "booking_cancel",
      actionLabel: "Hủy booking",
      target: "Booking #42 · Phạm Quốc Khoa",
      detail: "tableCodes: A7 · reason: Khách báo bận",
      device: "iPad Lễ tân",
    },
  ]
}

async function setupHttpStubs(context, options = {}) {
  const { readOnly = false, longAccount = false, extraAuditEntries = [] } = options
  const accounts = createFixtureAccounts()
  if (longAccount && accounts[0]) {
    accounts[0].displayName = "W".repeat(120)
    accounts[0].username = "w".repeat(80)
  }
  const auditEntries = [...extraAuditEntries, ...createFixtureAuditEntries()]
  const auditRequests = []
  const statusMutations = []
  const passwordResets = []

  await context.addInitScript(() => {
    window.EventSource = class extends EventTarget {
      close() {}
    }
  })

  await context.route("**/api/v1/**", async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const apiPath = url.pathname

    if (apiPath === "/api/v1/auth/me" && req.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          user: {
            id: readOnly ? 5 : 3,
            username: readOnly ? "admin_ro" : "owner",
            displayName: readOnly ? "Quản lý chỉ xem" : "Chủ quán",
            organizationId: 1,
            venueId: 1,
            roles: [readOnly ? "ADMIN" : "OWNER"],
            accessLevel: readOnly ? "READ_ONLY" : null,
          },
          permissions: readOnly
            ? ["report.read", "user.read", "customer.view_masked", "audit.read"]
            : [
                "report.read",
                "customer.view_masked",
                "customer.phone.reveal",
                "booking.phone.reveal",
                "user.read",
                "user.manage",
                "venue.configure",
                "audit.read",
              ],
          csrfToken: "csrf-na43-token",
          portal: "admin",
        }),
      })
      return
    }

    if (apiPath === "/api/v1/accounts" && req.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          accounts,
          roles: [
            { code: "RECEPTIONIST", name: "Lễ tân" },
            { code: "WAITER", name: "Phục vụ" },
            { code: "CASHIER", name: "Thu ngân" },
            { code: "ADMIN", name: "Admin" },
          ],
        }),
      })
      return
    }

    const permMatch = /^\/api\/v1\/accounts\/(\d+)\/permissions$/.exec(apiPath)
    if (permMatch && req.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          permissions: [
            {
              code: "report.read",
              grantedByRole: false,
              overridden: false,
              enabled: false,
              grantable: true,
              editable: true,
            },
            {
              code: "customer.phone.reveal",
              grantedByRole: false,
              overridden: false,
              enabled: false,
              grantable: true,
              editable: true,
            },
            {
              code: "user.manage",
              grantedByRole: false,
              overridden: false,
              enabled: false,
              grantable: true,
              editable: true,
            },
            {
              code: "audit.read",
              grantedByRole: false,
              overridden: false,
              enabled: false,
              grantable: true,
              editable: true,
            },
          ],
        }),
      })
      return
    }

    const statusMatch = /^\/api\/v1\/accounts\/(\d+)\/status$/.exec(apiPath)
    if (statusMatch && req.method() === "POST") {
      const id = Number(statusMatch[1])
      const body = req.postDataJSON()
      statusMutations.push({ id, ...body })
      const acc = accounts.find((a) => a.id === id)
      if (acc) {
        acc.status = body.status
        acc.version += 1
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ account: acc }) })
      return
    }

    const pwMatch = /^\/api\/v1\/accounts\/(\d+)\/password:reset$/.exec(apiPath)
    if (pwMatch && req.method() === "POST") {
      const id = Number(pwMatch[1])
      const body = req.postDataJSON()
      passwordResets.push({ id, ...body })
      const acc = accounts.find((a) => a.id === id)
      if (acc) acc.version += 1
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ account: acc, temporaryPassword: body?.newPassword ? null : "TempPass123456!" }),
      })
      return
    }

    if (apiPath === "/api/v1/operations/audit/filters" && req.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          retentionDays: 90,
          canExport: !readOnly,
          filters: [
            { type: "booking_cancel", label: "Hủy booking", supported: true },
            { type: "table_move", label: "Đổi bàn", supported: true },
            { type: "phone_reveal", label: "Xem SĐT đầy đủ", supported: true },
            { type: "discount", label: "Giảm giá / hủy món", supported: false, note: "Chưa hỗ trợ" },
            { type: "login", label: "Đăng nhập", supported: true },
            { type: "permission", label: "Đổi quyền", supported: true },
            { type: "account", label: "Tài khoản", supported: true },
          ],
        }),
      })
      return
    }

    if (apiPath === "/api/v1/operations/audit" && req.method() === "GET") {
      auditRequests.push(Object.fromEntries(url.searchParams.entries()))
      const from = url.searchParams.get("from")
      const to = url.searchParams.get("to")
      const typesParam = url.searchParams.get("types")
      const types = typesParam ? typesParam.split(",").filter(Boolean) : []
      const filtered = auditEntries.filter((entry) => {
        if (types.length && !types.includes(entry.actionType)) return false
        if (from && entry.occurredAt.slice(0, 10) < from) return false
        if (to && entry.occurredAt.slice(0, 10) > to) return false
        return true
      })
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          entries: filtered,
          hasMore: false,
          nextCursor: null,
          retentionDays: 90,
          windowStart: "2026-08-25T00:00:00.000Z",
        }),
      })
      return
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({}),
    })
  })

  return { auditRequests, statusMutations, passwordResets }
}

async function waitForSettledAnimations(page) {
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => {})),
    )
  })
  await page.waitForTimeout(250)
}

async function runAxe(page) {
  await waitForSettledAnimations(page)
  await page.addScriptTag({ content: axeSrc })
  return page.evaluate(async () => {
    const out = await window.axe.run(document, {
      resultTypes: ["violations"],
      runOnly: ["wcag2a", "wcag2aa", "best-practice"],
    })
    return out.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
      }))
  })
}

async function runVerification(webRoot) {
  const browser = await launchBrowser()
  const mockVite = await startViteServer(webRoot, { VITE_API_MODE: "mock", VITE_API_BASE_URL: "" })
  const httpVite = await startViteServer(webRoot, { VITE_API_MODE: "http", VITE_API_BASE_URL: "/api/v1" })
  const axeSummary = []

  try {
    // 1. UI-50 + UI-53 on Accounts at 320x640 and 360x780 (HTTP stub with long name)
    for (const vp of [
      { width: 320, height: 640 },
      { width: 360, height: 780 },
    ]) {
      const context = await browser.newContext({ viewport: vp })
      await setupHttpStubs(context)
      const page = await context.newPage()
      await page.goto(`${httpVite.baseUrl}/admin/accounts`, { waitUntil: "networkidle" })
      await page.getByTestId("admin-accounts-page").waitFor({ state: "visible" })
      await page
        .locator('[data-testid="admin-accounts-page"] ul.lg\\:hidden > li')
        .first()
        .waitFor({ state: "visible" })

      const check = await page.evaluate(() => {
        const docOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth
        const main = document.querySelector('[data-testid="admin-main-content"]')
        const mainOverflow = main ? main.scrollWidth > main.clientWidth : false
        const cards = Array.from(document.querySelectorAll('[data-testid="admin-accounts-page"] ul.lg\\:hidden > li'))
        const cardIssues = []
        for (const card of cards) {
          const cardRect = card.getBoundingClientRect()
          if (cardRect.right > window.innerWidth + 1) {
            cardIssues.push(`card right ${cardRect.right} > viewport ${window.innerWidth}`)
          }
          for (const el of card.querySelectorAll('[data-slot="badge"], button')) {
            const r = el.getBoundingClientRect()
            if (r.right > cardRect.right + 1 || r.left < cardRect.left - 1) {
              cardIssues.push(
                `${el.textContent?.trim()} clipped (${r.left}..${r.right} vs ${cardRect.left}..${cardRect.right})`,
              )
            }
            if (el.tagName === "BUTTON" && r.height < 44) {
              cardIssues.push(`button ${el.textContent?.trim()} height ${r.height} < 44`)
            }
          }
        }
        const chipsGroup = document.querySelector('[role="group"][aria-label="Lọc theo vai trò"]')
        const chipTops = chipsGroup
          ? Array.from(chipsGroup.querySelectorAll("button")).map((b) => Math.round(b.getBoundingClientRect().top))
          : []
        const chipsOneRow = chipTops.length > 0 && Math.max(...chipTops) - Math.min(...chipTops) <= 2
        return { docOverflow, mainOverflow, cardCount: cards.length, cardIssues, chipsOneRow }
      })
      assert.equal(check.docOverflow, false, `Accounts ${vp.width} doc overflow`)
      assert.equal(check.mainOverflow, false, `Accounts ${vp.width} main overflow`)
      assert(check.cardCount >= 5, `Expected accounts cards at ${vp.width}`)
      assert.deepEqual(check.cardIssues, [], `UI-50 card issues at ${vp.width}: ${check.cardIssues.join("; ")}`)
      assert.equal(check.chipsOneRow, true, `UI-53 accounts chips not on 1 row at ${vp.width}`)
      await context.close()
    }

    // 2. UI-51 on Accounts at 1024x768 and 1440x900 (+ overflow menu executes same actions + READ_ONLY disables them)
    for (const vp of [
      { width: 1024, height: 768 },
      { width: 1440, height: 900 },
    ]) {
      const context = await browser.newContext({ viewport: vp })
      const stubs = await setupHttpStubs(context)
      const page = await context.newPage()
      await page.goto(`${httpVite.baseUrl}/admin/accounts`, { waitUntil: "networkidle" })
      await page.getByTestId("admin-accounts-page").waitFor({ state: "visible" })
      await page.locator("table tbody tr").first().waitFor({ state: "visible" })

      const rowLayout = await page.evaluate(() => {
        const container = document.querySelector('[data-testid="admin-accounts-page"] [data-slot="table-container"]')
        const tableOverflow = container ? container.scrollWidth > container.clientWidth + 1 : false
        const rows = Array.from(document.querySelectorAll("table tbody tr"))
        const issues = []
        if (tableOverflow) {
          issues.push(`Table overflows container: ${container.scrollWidth} > ${container.clientWidth}`)
        }
        for (const row of rows) {
          const actionCell = row.querySelector("td:last-child")
          const buttons = actionCell ? Array.from(actionCell.querySelectorAll("button")) : []
          const rects = buttons.map((b) => b.getBoundingClientRect())
          if (rects.length !== 3) issues.push(`Expected 3 action buttons (Đổi quyền, Xem, ...), got ${rects.length}`)
          const tops = rects.map((r) => Math.round(r.top))
          if (Math.max(...tops) - Math.min(...tops) > 2) {
            issues.push(`Action buttons wrapped onto multiple lines: tops=${tops.join(",")}`)
          }
          if (window.innerWidth <= 1024) {
            for (const r of rects) {
              if (r.height < 44) issues.push(`Touch target at 1024px < 44px: ${r.height}`)
            }
          }
        }
        return { rowCount: rows.length, issues }
      })
      assert(rowLayout.rowCount >= 5)
      assert.deepEqual(rowLayout.issues, [], `UI-51 layout issues at ${vp.width}: ${rowLayout.issues.join("; ")}`)

      // R02: Open menu by mouse -> axe serious/critical = 0 + R03: menu items >= 44x44 at <= 1024
      const menuTrigger = page.getByTestId("account-actions-menu-9524")
      await menuTrigger.click()
      const pwItem = page.getByRole("menuitem", { name: "Đổi mật khẩu" })
      const lockItem = page.getByRole("menuitem", { name: "Khóa" })
      await lockItem.waitFor({ state: "visible" })

      const openMenuViolations = await runAxe(page)
      assert.deepEqual(
        openMenuViolations,
        [],
        `R02 axe serious/critical violations with menu open at ${vp.width}: ${JSON.stringify(openMenuViolations)}`,
      )
      axeSummary.push({
        route: "/admin/accounts#menu-open",
        viewport: `${vp.width}x${vp.height}`,
        seriousOrCritical: 0,
      })

      if (vp.width <= 1024) {
        const menuBoxes = await Promise.all([pwItem.boundingBox(), lockItem.boundingBox()])
        for (const [idx, box] of menuBoxes.entries()) {
          assert(
            box && box.width >= 44 && box.height >= 44,
            `R03 menu item #${idx} < 44x44 at ${vp.width}: ${JSON.stringify(box)}`,
          )
        }
      }

      // Close with Escape -> focus returns to trigger
      await page.keyboard.press("Escape")
      await lockItem.waitFor({ state: "detached" })
      assert.equal(
        await page.evaluate(() => document.activeElement?.getAttribute("data-testid")),
        "account-actions-menu-9524",
        `R02 Escape must return focus to trigger at ${vp.width}`,
      )

      // R02: Open menu by keyboard (Enter), run axe, navigate with ArrowDown/ArrowUp, open & close PasswordResetDialog
      await menuTrigger.focus()
      await page.keyboard.press("Enter")
      await pwItem.waitFor({ state: "visible" })
      const kbMenuViolations = await runAxe(page)
      assert.deepEqual(
        kbMenuViolations,
        [],
        `R02 keyboard-opened menu axe violations at ${vp.width}: ${JSON.stringify(kbMenuViolations)}`,
      )
      const afterOpenEl = await page.evaluate(() => ({
        role: document.activeElement?.getAttribute("role"),
        text: document.activeElement?.textContent?.trim(),
      }))
      assert.equal(afterOpenEl.role, "menuitem")
      assert.equal(afterOpenEl.text, "Đổi mật khẩu")
      await page.keyboard.press("ArrowDown")
      await page.waitForTimeout(50)
      const afterDownEl = await page.evaluate(() => ({
        role: document.activeElement?.getAttribute("role"),
        text: document.activeElement?.textContent?.trim(),
      }))
      assert.equal(afterDownEl.role, "menuitem")
      assert.equal(afterDownEl.text, "Khóa")
      await page.keyboard.press("ArrowUp")
      await page.waitForTimeout(50)
      const afterUpEl = await page.evaluate(() => ({
        role: document.activeElement?.getAttribute("role"),
        text: document.activeElement?.textContent?.trim(),
      }))
      assert.equal(afterUpEl.role, "menuitem")
      assert.equal(afterUpEl.text, "Đổi mật khẩu")
      await page.keyboard.press("Enter")
      await page.getByTestId("admin-password-dialog").waitFor({ state: "visible" })
      await page.keyboard.press("Escape")
      await page.getByTestId("admin-password-dialog").waitFor({ state: "detached" })
      assert.equal(
        await page.evaluate(() => document.activeElement?.getAttribute("data-testid")),
        "account-actions-menu-9524",
        `R02 PasswordResetDialog Escape must return focus to trigger at ${vp.width}`,
      )

      // Test overflow menu actions on first row (id 9524)
      await menuTrigger.click()
      await lockItem.waitFor({ state: "visible" })
      await lockItem.click()
      await page.waitForTimeout(200)
      assert.equal(stubs.statusMutations.length, 1, "Overflow menu Khóa must invoke status mutation")
      assert.equal(stubs.statusMutations[0].status, "DISABLED")

      // Unlock again via overflow menu
      await menuTrigger.click()
      await page.getByRole("menuitem", { name: "Mở khóa" }).click()
      await page.waitForTimeout(200)
      assert.equal(stubs.statusMutations.length, 2)
      assert.equal(stubs.statusMutations[1].status, "ACTIVE")

      // Protected SuperAdmin (OWNER, id 3) keeps both menu items disabled
      await page.getByTestId("account-actions-menu-3").click()
      assert.equal(await page.getByRole("menuitem", { name: "Đổi mật khẩu" }).getAttribute("aria-disabled"), "true")
      assert.equal(await page.getByRole("menuitem", { name: "Khóa" }).getAttribute("aria-disabled"), "true")
      await page.keyboard.press("Escape")
      await context.close()
    }

    // R04: Long valid account displayName (120 W) and username (80 w) must wrap without pushing actions out of view
    for (const vp of [
      { width: 320, height: 640 },
      { width: 640, height: 400 },
      { width: 1024, height: 768 },
      { width: 1440, height: 900 },
    ]) {
      const context = await browser.newContext({ viewport: vp })
      await setupHttpStubs(context, { longAccount: true })
      const page = await context.newPage()
      await page.goto(`${httpVite.baseUrl}/admin/accounts`, { waitUntil: "networkidle" })
      await page.getByTestId("admin-accounts-page").waitFor({ state: "visible" })

      const docOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      )
      assert.equal(docOverflow, false, `R04 doc horizontal overflow at ${vp.width}x${vp.height}`)

      if (vp.width >= 1024) {
        await page.locator("table tbody tr").first().waitFor({ state: "visible" })
        const longCheck = await page.evaluate(() => {
          const container = document.querySelector('[data-testid="admin-accounts-page"] [data-slot="table-container"]')
          const containerRect = container.getBoundingClientRect()
          const row = document.querySelector("table tbody tr")
          const buttons = Array.from(row.querySelectorAll("td:last-child button")).map((b) => {
            const r = b.getBoundingClientRect()
            return { text: b.textContent?.trim(), left: r.left, right: r.right, width: r.width, height: r.height }
          })
          return {
            scrollWidth: container.scrollWidth,
            clientWidth: container.clientWidth,
            containerRight: containerRect.right,
            buttons,
          }
        })
        assert(
          longCheck.scrollWidth <= longCheck.clientWidth + 1,
          `R04 table overflow at ${vp.width}: ${longCheck.scrollWidth} > ${longCheck.clientWidth}`,
        )
        assert.equal(longCheck.buttons.length, 3)
        for (const btn of longCheck.buttons) {
          assert(
            btn.right <= longCheck.containerRight + 1 && btn.right <= vp.width + 1,
            `R04 action button '${btn.text}' pushed out of view at ${vp.width}: ${JSON.stringify(btn)} vs containerRight=${longCheck.containerRight}`,
          )
        }
        const firstRow = page.locator("table tbody tr").first()
        await firstRow.getByRole("button", { name: "Đổi quyền" }).click()
        await firstRow.getByRole("button", { name: "Xem" }).click()
        await page.getByTestId("admin-account-detail-dialog").waitFor({ state: "visible" })
        await page.keyboard.press("Escape")
        await page.getByTestId("admin-account-detail-dialog").waitFor({ state: "detached" })
        await page.getByTestId("account-actions-menu-9524").click()
        await page.getByRole("menuitem", { name: "Khóa" }).waitFor({ state: "visible" })
        await page.keyboard.press("Escape")
      }
      await context.close()
    }

    // UI-51 READ_ONLY check on overflow menu items
    {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
      await setupHttpStubs(context, { readOnly: true })
      const page = await context.newPage()
      await page.goto(`${httpVite.baseUrl}/admin/accounts`, { waitUntil: "networkidle" })
      await page.getByTestId("account-actions-menu-9524").click()
      const pwItem = page.getByRole("menuitem", { name: "Đổi mật khẩu" })
      const lockItem = page.getByRole("menuitem", { name: "Khóa" })
      assert.equal(await pwItem.getAttribute("aria-disabled"), "true")
      assert.equal(await lockItem.getAttribute("aria-disabled"), "true")
      await page.keyboard.press("Escape")
      await context.close()
    }

    // 3. UI-52 + UI-53 + R01 + R06 on Audit (390x844, 640x400, and 1440x900)
    const r06Entries = [
      {
        id: 102,
        occurredAt: "2026-11-23T01:55:00.000Z",
        actor: "Phục vụ 1",
        actorUsername: "phuc_vu_1",
        action: "ORDER_CANCELLATION_REQUESTED",
        actionType: "discount",
        actionLabel: "Xin hủy món",
        target: "Đơn #18 · Bàn A2",
        detail: "ticketStatus: ACCEPTED · policy: STANDARD · quantity: 1",
        device: "iPad Phục vụ",
      },
      {
        id: 103,
        occurredAt: "2026-11-23T01:54:00.000Z",
        actor: "Phục vụ 1",
        actorUsername: "phuc_vu_1",
        action: "ORDER_CANCELLATION_APPROVED",
        actionType: "discount",
        actionLabel: "Duyệt hủy món",
        target: "Đơn #18 · Bàn A2",
        detail: "ticketStatus: PREPARING · policy: READY_WASTE · quantity: 1",
        device: "POS Thu ngân",
      },
    ]
    for (const vp of [
      { width: 390, height: 844 },
      { width: 640, height: 400 },
      { width: 1440, height: 900 },
    ]) {
      const context = await browser.newContext({ viewport: vp })
      const stubs = await setupHttpStubs(context, { extraAuditEntries: r06Entries })
      const page = await context.newPage()
      await page.goto(`${httpVite.baseUrl}/admin/audit`, { waitUntil: "networkidle" })
      await page
        .getByText("Cổng: Quản trị · Kết quả: Thất bại")
        .locator("visible=true")
        .first()
        .waitFor({ state: "visible" })

      const bodyText = await page.locator('[data-testid="admin-main-content"]').innerText()
      assert(!bodyText.includes("portal: admin"), "Raw 'portal: admin' leaked into Audit UI")
      assert(!bodyText.includes("result: FAILURE"), "Raw 'result: FAILURE' leaked into Audit UI")
      assert(!bodyText.includes("ticketStatus:"), "Raw 'ticketStatus:' leaked into Audit UI")
      assert(!bodyText.includes("ACCEPTED"), "Raw 'ACCEPTED' leaked into Audit UI")
      assert(!bodyText.includes("PREPARING"), "Raw 'PREPARING' leaked into Audit UI")
      assert(bodyText.includes("Cổng: Quản trị · Kết quả: Thất bại"))
      assert(bodyText.includes("Vai trò: Phục vụ · Cấp truy cập: Chỉ xem · unknownKey: rawValue"))
      assert(bodyText.includes("Trạng thái phiếu: Đã tiếp nhận · Chính sách: Chuẩn · Số lượng: 1"))
      assert(bodyText.includes("Trạng thái phiếu: Đang làm · Chính sách: Hủy món đã làm · Số lượng: 1"))

      if (vp.width < 768) {
        const mobileAudit = await page.evaluate(() => {
          const docOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth
          const chips = Array.from(
            document.querySelectorAll('[role="group"][aria-label="Lọc theo loại thao tác"] button'),
          )
          const tops = chips.map((b) => Math.round(b.getBoundingClientRect().top))
          const chipsOneRow = chips.length > 0 && Math.max(...tops) - Math.min(...tops) <= 2
          const desktopFromVisible = Boolean(document.getElementById("audit-from")?.getClientRects().length)
          return { docOverflow, chipsOneRow, desktopFromVisible }
        })
        assert.equal(mobileAudit.docOverflow, false)
        assert.equal(mobileAudit.chipsOneRow, true, "Audit mobile chips must be 1 horizontally scrollable row")
        assert.equal(mobileAudit.desktopFromVisible, false, "Inline date inputs must be hidden on mobile")

        // R01: Keyboard open via SheetTrigger, Tab traversal, clear dates keeps focus inside Sheet, close returns focus
        const trigger = page.getByTestId("audit-filter-sheet-trigger")
        assert.equal(await trigger.getAttribute("aria-haspopup"), "dialog")
        assert.equal(await trigger.getAttribute("aria-expanded"), "false")

        await trigger.focus()
        await page.keyboard.press("Enter")
        await page.getByTestId("audit-filter-sheet").waitFor({ state: "visible" })
        assert.equal(await trigger.getAttribute("aria-expanded"), "true")

        // Fill dates and Tab through inputs + footer buttons
        await page.locator("#audit-from-sheet").fill("2026-11-20")
        const toRespPromise = page.waitForResponse(
          (res) => res.url().includes("/api/v1/operations/audit") && res.url().includes("to=2026-11-23"),
        )
        await page.locator("#audit-to-sheet").fill("2026-11-23")
        await toRespPromise
        const filledQuery = stubs.auditRequests.at(-1)
        assert.equal(filledQuery?.from, "2026-11-20")
        assert.equal(filledQuery?.to, "2026-11-23")

        const tabUntil = async (predicate, label) => {
          for (let i = 0; i < 8; i++) {
            await page.keyboard.press("Tab")
            const hit = await page.evaluate(predicate)
            if (hit) return
          }
          assert.fail(`Tab could not reach ${label} at ${vp.width}`)
        }
        await page.locator("#audit-from-sheet").focus()
        await tabUntil(() => document.activeElement?.id === "audit-to-sheet", "#audit-to-sheet")
        await tabUntil(() => document.activeElement?.textContent?.trim() === "Xóa ngày lọc", "Xóa ngày lọc")
        await tabUntil(() => document.activeElement?.textContent?.trim() === "Xong", "Xong")

        // Clear dates with Xóa ngày lọc -> focus stays inside Sheet on #audit-from-sheet & query drops from/to
        const clearRespPromise = page.waitForResponse(
          (res) => res.url().includes("/api/v1/operations/audit") && !res.url().includes("from="),
        )
        await page.getByRole("button", { name: "Xóa ngày lọc" }).click()
        await clearRespPromise
        assert.equal(await page.locator("#audit-from-sheet").inputValue(), "")
        assert.equal(await page.locator("#audit-to-sheet").inputValue(), "")
        const focusAfterClear = await page.evaluate(() => ({
          id: document.activeElement?.id ?? null,
          inSheet: Boolean(document.activeElement?.closest('[data-testid="audit-filter-sheet"]')),
        }))
        assert.equal(focusAfterClear.inSheet, true, `R01 focus escaped Sheet after clear at ${vp.width}`)
        assert.equal(focusAfterClear.id, "audit-from-sheet")
        const clearedQuery = stubs.auditRequests.at(-1)
        assert.equal(clearedQuery?.from, undefined)
        assert.equal(clearedQuery?.to, undefined)

        // Close with Escape -> focus returns to trigger
        await page.keyboard.press("Escape")
        await page.getByTestId("audit-filter-sheet").waitFor({ state: "detached" })
        assert.equal(
          await page.evaluate(() => document.activeElement?.getAttribute("data-testid")),
          "audit-filter-sheet-trigger",
          `R01 Escape must return focus to Lọc at ${vp.width}`,
        )

        // Re-open with Enter, set dates, close with Xong -> focus returns to trigger & query has dates
        await page.keyboard.press("Enter")
        await page.getByTestId("audit-filter-sheet").waitFor({ state: "visible" })
        await page.locator("#audit-from-sheet").fill("2026-11-21")
        const reToResp = page.waitForResponse(
          (res) => res.url().includes("/api/v1/operations/audit") && res.url().includes("to=2026-11-22"),
        )
        await page.locator("#audit-to-sheet").fill("2026-11-22")
        await reToResp
        await page.getByRole("button", { name: "Xong" }).click()
        await page.getByTestId("audit-filter-sheet").waitFor({ state: "detached" })
        assert.equal(
          await page.evaluate(() => document.activeElement?.getAttribute("data-testid")),
          "audit-filter-sheet-trigger",
          `R01 Xong must return focus to Lọc at ${vp.width}`,
        )
        const lastQuery = stubs.auditRequests.at(-1)
        assert.equal(lastQuery?.from, "2026-11-21")
        assert.equal(lastQuery?.to, "2026-11-22")

        // Re-open with Enter, close with close (X) button -> focus returns to trigger
        await page.keyboard.press("Enter")
        await page.getByTestId("audit-filter-sheet").waitFor({ state: "visible" })
        await page.locator('[data-testid="audit-filter-sheet"] button:has-text("Đóng")').click()
        await page.getByTestId("audit-filter-sheet").waitFor({ state: "detached" })
        assert.equal(
          await page.evaluate(() => document.activeElement?.getAttribute("data-testid")),
          "audit-filter-sheet-trigger",
          `R01 close button must return focus to Lọc at ${vp.width}`,
        )
      }
      await context.close()
    }

    // R03: Customers filter chips >= 44x44 at 390x844, 820x1180, and 1024x768
    for (const vp of [
      { width: 390, height: 844 },
      { width: 820, height: 1180 },
      { width: 1024, height: 768 },
    ]) {
      const context = await browser.newContext({ viewport: vp })
      await context.addInitScript(() => {
        localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 3, theme: "light" }))
      })
      const page = await context.newPage()
      await page.goto(`${mockVite.baseUrl}/admin/customers`, { waitUntil: "networkidle" })
      await page.locator('[role="group"][aria-label="Lọc khách"] button').first().waitFor({ state: "visible" })
      const chipBoxes = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[role="group"][aria-label="Lọc khách"] button')).map((btn) => {
          const r = btn.getBoundingClientRect()
          return { text: btn.textContent?.trim(), width: r.width, height: r.height }
        }),
      )
      assert.equal(chipBoxes.length, 4)
      for (const chip of chipBoxes) {
        assert(
          chip.width >= 44 && chip.height >= 44,
          `R03 customer chip '${chip.text}' < 44x44 at ${vp.width}: ${JSON.stringify(chip)}`,
        )
      }
      await context.close()
    }

    // 4. UI-54 + UI-55 on Visits (320x640, 390x844, 1024x768, 1440x900)
    for (const vp of [
      { width: 320, height: 640 },
      { width: 390, height: 844 },
      { width: 1024, height: 768 },
      { width: 1440, height: 900 },
    ]) {
      const context = await browser.newContext({ viewport: vp })
      await context.addInitScript(() => {
        localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 3, theme: "light" }))
      })
      const page = await context.newPage()
      await page.goto(`${mockVite.baseUrl}/admin/visits`, { waitUntil: "networkidle" })
      await page.getByTestId("turns-metrics-grid").waitFor({ state: "visible" })

      const gridCheck = await page.evaluate(() => {
        const docOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth
        const cards = Array.from(document.querySelectorAll('[data-testid="turns-metrics-grid"] > div'))
        const rects = cards.map((c) => {
          const r = c.getBoundingClientRect()
          return { top: Math.round(r.top), left: Math.round(r.left), right: Math.round(r.right) }
        })
        const dateBtn = document.querySelector('[data-testid="turns-date-picker-trigger"]')
        return {
          docOverflow,
          rects,
          dateBtnText: dateBtn?.textContent?.trim() ?? "",
          dateBtnAria: dateBtn?.getAttribute("aria-label") ?? "",
        }
      })
      assert.equal(gridCheck.docOverflow, false, `Visits ${vp.width} doc overflow`)
      assert.equal(gridCheck.rects.length, 4)
      if (vp.width < 768) {
        assert(
          Math.abs(gridCheck.rects[0].top - gridCheck.rects[1].top) <= 2 &&
            Math.abs(gridCheck.rects[2].top - gridCheck.rects[3].top) <= 2 &&
            gridCheck.rects[2].top > gridCheck.rects[0].top + 20,
          `UI-54 expected 2x2 grid at ${vp.width}, got ${JSON.stringify(gridCheck.rects)}`,
        )
      }
      assert(
        gridCheck.dateBtnAria.toLowerCase().includes(gridCheck.dateBtnText.toLowerCase()),
        `UI-55 aria-label "${gridCheck.dateBtnAria}" must include visible text "${gridCheck.dateBtnText}"`,
      )
      await context.close()
    }

    // 5. UI-55 axe serious+critical = 0 on ALL admin pages at 390x844 and 1440x900 + 640x400 overflow check
    const axeRoutes = [
      { path: "/admin/overview", mode: "mock", ready: "shift-overview-page" },
      { path: "/admin/accounts", mode: "http", ready: "admin-accounts-page" },
      { path: "/admin/audit", mode: "http", ready: "admin-main-content" },
      { path: "/admin/visits", mode: "mock", ready: "turn-ledger-page" },
      { path: "/admin/customers", mode: "mock", ready: "admin-main-content" },
      { path: "/admin/reports", mode: "mock", ready: "admin-main-content" },
      { path: "/admin/reconciliation", mode: "mock", ready: "admin-main-content" },
      { path: "/admin/settings", mode: "mock", ready: "admin-main-content" },
    ]
    for (const vp of [
      { width: 390, height: 844 },
      { width: 1440, height: 900 },
      { width: 640, height: 400 },
    ]) {
      for (const route of axeRoutes) {
        const context = await browser.newContext({ viewport: vp })
        if (route.mode === "mock") {
          await context.addInitScript(() => {
            localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 3, theme: "light" }))
          })
        } else {
          await setupHttpStubs(context)
        }
        const page = await context.newPage()
        const baseUrl = route.mode === "mock" ? mockVite.baseUrl : httpVite.baseUrl
        await page.goto(`${baseUrl}${route.path}`, { waitUntil: "networkidle" })
        await page.getByTestId(route.ready).waitFor({ state: "visible" })

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        )
        assert.equal(overflow, false, `Page-level horizontal overflow on ${route.path} at ${vp.width}x${vp.height}`)

        if (vp.width !== 640) {
          const violations = await runAxe(page)
          assert.deepEqual(
            violations,
            [],
            `axe serious/critical violations on ${route.path} at ${vp.width}x${vp.height}: ${JSON.stringify(violations)}`,
          )
          axeSummary.push({ route: route.path, viewport: `${vp.width}x${vp.height}`, seriousOrCritical: 0 })
        }
        await context.close()
      }
    }

    console.log(JSON.stringify({ status: "PASS", axeChecks: axeSummary.length }, null, 2))
  } finally {
    await mockVite.server.close()
    await httpVite.server.close()
    await browser.close()
  }
}

async function runCapture(args) {
  assert(args.out, "--out is required in --capture mode")
  fs.mkdirSync(args.out, { recursive: true })
  const webRoot = path.join(args.root, "web")
  const browser = await launchBrowser()
  const mockVite = await startViteServer(webRoot, { VITE_API_MODE: "mock", VITE_API_BASE_URL: "" })
  const httpVite = await startViteServer(webRoot, { VITE_API_MODE: "http", VITE_API_BASE_URL: "/api/v1" })

  const viewports = [
    { width: 320, height: 640 },
    { width: 390, height: 844 },
    { width: 820, height: 1180 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
    { width: 640, height: 400, deviceScaleFactor: 2 },
  ]

  const targets = [
    { name: "overview", path: "/admin/overview", mode: "mock", ready: "shift-overview-page" },
    { name: "accounts", path: "/admin/accounts", mode: "http", ready: "admin-accounts-page" },
    { name: "accounts-edit", path: "/admin/accounts", mode: "http", ready: "admin-accounts-page", openEdit: true },
    {
      name: "audit",
      path: "/admin/audit",
      mode: "http",
      ready: "admin-main-content",
      waitText: "Phiên của E2E Chủ quán",
    },
    { name: "visits", path: "/admin/visits", mode: "mock", ready: "turn-ledger-page" },
    { name: "customers", path: "/admin/customers", mode: "mock", ready: "admin-main-content" },
    { name: "reports", path: "/admin/reports", mode: "mock", ready: "admin-main-content" },
  ]

  const files = []
  try {
    for (const vp of viewports) {
      for (const target of targets) {
        const context = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          ...(vp.deviceScaleFactor ? { deviceScaleFactor: vp.deviceScaleFactor } : {}),
        })
        if (target.mode === "mock") {
          await context.addInitScript(() => {
            localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 3, theme: "light" }))
          })
        } else {
          await setupHttpStubs(context)
        }
        const page = await context.newPage()
        const baseUrl = target.mode === "mock" ? mockVite.baseUrl : httpVite.baseUrl
        await page.goto(`${baseUrl}${target.path}`, { waitUntil: "networkidle" })
        await page.getByTestId(target.ready).waitFor({ state: "visible" })
        if (target.waitText) {
          await page.getByText(target.waitText).locator("visible=true").first().waitFor({ state: "visible" })
        }
        if (target.openEdit) {
          await page.getByRole("button", { name: "Xem", exact: true }).locator("visible=true").first().click()
          await page.getByTestId("admin-account-detail-dialog").waitFor({ state: "visible" })
        }
        await waitForSettledAnimations(page)
        const fileName = `${args.prefix}-${target.name}-${vp.width}x${vp.height}.png`
        const outPath = path.join(args.out, fileName)
        await page.screenshot({ path: outPath })
        files.push(outPath)
        await context.close()
      }
    }
    console.log(
      JSON.stringify({ status: "CAPTURED", prefix: args.prefix, count: files.length, out: args.out }, null, 2),
    )
  } finally {
    await mockVite.server.close()
    await httpVite.server.close()
    await browser.close()
  }
}

const args = parseArgs(process.argv.slice(2))
if (args.capture) {
  await runCapture(args)
} else {
  await runVerification(path.join(args.root, "web"))
}

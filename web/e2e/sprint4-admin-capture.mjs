// Reproducible verification and screenshot capture for Sprint 4 NA-32 Round 2.
// Usage (from repo root or web/): node web/e2e/sprint4-admin-capture.mjs
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "@playwright/test"
import { createServer } from "vite"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(__dirname, "..")
const outDir = path.join(webRoot, "e2e", ".artifacts", "sprint4-na32-r2")
fs.mkdirSync(outDir, { recursive: true })

const VIRTUAL_ENTRY_ID = "/src/__admin_capture_entry.js"
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
import { adminRouteObject } from "@/features/admin/admin-routes"
import { AuthBoundary } from "@/features/auth/auth-boundary"
import { useRealtimeSync } from "@/hooks/use-data"
import { api } from "@/services"
import { useSession } from "@/state/session"

const captureProfile = window.__CAPTURE_PROFILE__
if (api.mode === "mock" && captureProfile === "READ_ONLY") {
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
    permissions: ["report.read", "user.read", "customer.view_masked"],
    portal: "admin",
    authStatus: "authenticated",
    authError: null,
  })
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 1000, retry: false } },
})

function CaptureRealtimeSync() {
  useRealtimeSync()
  return null
}

const router = createBrowserRouter([
  { path: "/", element: createElement(Navigate, { to: "/admin/overview", replace: true }) },
  { path: "/floor", element: createElement("div", { "data-testid": "portal-floor-stub" }, "Sơ đồ bàn") },
  { path: "/cashier", element: createElement("div", { "data-testid": "portal-cashier-stub" }, "Thu ngân") },
  adminRouteObject,
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
        createElement(
          AuthBoundary,
          null,
          api.mode === "http" ? createElement(CaptureRealtimeSync) : null,
          createElement(RouterProvider, { router }),
        ),
        createElement(Toaster, { position: "bottom-right", richColors: true, closeButton: true }),
      ),
    ),
  ),
)
`
}

function capturePlugin() {
  const indexHtmlPath = path.join(webRoot, "index.html")
  return {
    name: "admin-capture-virtual-entry",
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

async function startViteServer(envOverrides = {}) {
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
      plugins: [capturePlugin()],
    })
    await server.listen()
    const addr = server.httpServer?.address()
    assert(addr && typeof addr === "object", "Vite server failed to bind a TCP port")
    return {
      server,
      baseUrl: `http://127.0.0.1:${addr.port}`,
    }
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

async function attachErrorCollector(page) {
  const errors = []
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`))
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`)
  })
  return errors
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

const report = {
  modeSummary: {
    overview: "mock",
    turns: "mock",
    drawer: "mock",
    readonlyAccounts: "mock",
    anonDeepLink: "http-stub",
  },
  checks: {},
  screenshots: [],
}

const browser = await launchBrowser()

try {
  // 1. Mock mode server for shell, mounted pages, drawer, footer, full-height sidebar, and READ_ONLY accounts
  const mockVite = await startViteServer({ VITE_API_MODE: "mock", VITE_API_BASE_URL: "" })
  try {
    // (a) Overview 1440x1024 + footer 58px check + developer-text absence
    {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1024 } })
      await context.addInitScript(() => {
        localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 3, theme: "light" }))
      })
      const page = await context.newPage()
      const errors = await attachErrorCollector(page)
      await page.goto(`${mockVite.baseUrl}/admin/overview`, { waitUntil: "networkidle" })
      await page.getByTestId("shift-overview-page").waitFor({ state: "visible" })

      const metrics = await page.evaluate(() => {
        const footer = document.querySelector('[data-testid="admin-sidebar-footer"]')
        const sidebar = document.querySelector('[data-testid="admin-sidebar"]')
        const footerRect = footer?.getBoundingClientRect()
        const sidebarRect = sidebar?.getBoundingClientRect()
        const text = document.body.innerText
        return {
          footerRect: footerRect ? { x: footerRect.x, y: footerRect.y, width: footerRect.width, height: footerRect.height } : null,
          sidebarRect: sidebarRect ? { x: sidebarRect.x, y: sidebarRect.y, width: sidebarRect.width, height: sidebarRect.height } : null,
          overflowX: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
          hasDeveloperText: /Figma|Frame\s*\d+|NA-3[234]|TU-35|admin-preview-harness|AdminShell/i.test(text),
        }
      })

      assert(metrics.footerRect, "Sidebar footer missing")
      assert.equal(Math.round(metrics.footerRect.height), 58, `Expected footer height 58px, got ${metrics.footerRect.height}`)
      assert.equal(Math.round(metrics.footerRect.width), 199, `Expected footer width 199px, got ${metrics.footerRect.width}`)
      assert.equal(Math.round(metrics.footerRect.y), 942, `Expected footer y=942, got ${metrics.footerRect.y}`)
      assert.equal(metrics.overflowX, 0, `Horizontal overflow detected: ${metrics.overflowX}`)
      assert.equal(metrics.hasDeveloperText, false, "Developer text leaked into rendered DOM")
      assert.deepEqual(errors, [], `Console/page errors: ${errors.join(" | ")}`)

      const shot = path.join(outDir, "overview-1440x1024.png")
      await page.screenshot({ path: shot })
      report.checks.overview = metrics
      report.screenshots.push(shot)
      await context.close()
    }

    // (b) Turns 1440x1024 tall page ("Tuần này") + fixed sidebar + full-height rail fullPage screenshot
    {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1024 } })
      await context.addInitScript(() => {
        localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 3, theme: "light" }))
      })
      const page = await context.newPage()
      const errors = await attachErrorCollector(page)
      await page.goto(`${mockVite.baseUrl}/admin/turns`, { waitUntil: "networkidle" })
      await page.getByTestId("turn-ledger-page").waitFor({ state: "visible" })
      await page.getByTestId("turns-range-week").click()
      await page.waitForTimeout(400)

      let initialHeight = await page.evaluate(() => document.documentElement.scrollHeight)
      if (initialHeight <= 1024) {
        await page.getByTestId("turns-range-7days").click()
        await page.waitForTimeout(400)
        initialHeight = await page.evaluate(() => document.documentElement.scrollHeight)
      }
      assert(initialHeight > 1024, `Expected turns page height > 1024px, got ${initialHeight}`)

      await page.evaluate(() => window.scrollTo(0, 600))
      await page.waitForTimeout(150)
      const scrolledSidebar = await page.evaluate(() => {
        const sidebar = document.querySelector('[data-testid="admin-sidebar"]')
        const shell = document.querySelector('[data-testid="admin-shell"]')
        const beforeStyle = shell ? getComputedStyle(shell, "::before") : null
        const rect = sidebar?.getBoundingClientRect()
        return {
          scrollY: window.scrollY,
          scrollHeight: document.documentElement.scrollHeight,
          sidebarTop: rect ? Math.round(rect.top) : null,
          sidebarHeight: rect ? Math.round(rect.height) : null,
          beforeHeight: beforeStyle ? beforeStyle.height : null,
          beforeBg: beforeStyle ? beforeStyle.backgroundColor : null,
        }
      })

      assert(scrolledSidebar.scrollY > 0, "Main window failed to scroll")
      assert.equal(scrolledSidebar.sidebarTop, 0, `Sidebar drifted on scroll: top=${scrolledSidebar.sidebarTop}`)
      assert.equal(scrolledSidebar.sidebarHeight, 1024, `Sidebar viewport height mismatch: ${scrolledSidebar.sidebarHeight}`)
      assert.deepEqual(errors, [], `Console/page errors: ${errors.join(" | ")}`)

      await page.evaluate(() => window.scrollTo(0, 0))
      await page.waitForTimeout(100)
      const shot = path.join(outDir, "turns-1440x1024.png")
      await page.screenshot({ path: shot, fullPage: true })
      report.checks.turns = scrolledSidebar
      report.screenshots.push(shot)
      await context.close()
    }

    // (c) Tablet drawer 820x1180 + focus trap + Esc return focus + light portal isolation under html.dark
    {
      const context = await browser.newContext({ viewport: { width: 820, height: 1180 } })
      await context.addInitScript(() => {
        localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 3, theme: "light" }))
      })
      const page = await context.newPage()
      const errors = await attachErrorCollector(page)
      await page.goto(`${mockVite.baseUrl}/admin/overview`, { waitUntil: "networkidle" })
      await page.getByTestId("shift-overview-page").waitFor({ state: "visible" })
      // Force html.dark to prove SheetContent portal carries .admin-root light theme isolation
      await page.evaluate(() => document.documentElement.classList.add("dark"))

      const trigger = page.getByTestId("admin-menu-trigger")
      await trigger.click()
      const drawer = page.getByTestId("admin-drawer-panel")
      await drawer.waitFor({ state: "visible" })
      await page.waitForFunction(() => {
        const panel = document.querySelector('[data-testid="admin-drawer-panel"]')
        if (!panel) return false
        const rect = panel.getBoundingClientRect()
        return Math.abs(rect.left) < 0.5 && Math.round(rect.width) === 232
      })

      const initialState = await page.evaluate(() => {
        const panel = document.querySelector('[data-testid="admin-drawer-panel"]')
        const rect = panel?.getBoundingClientRect()
        const active = document.activeElement
        return {
          role: panel?.getAttribute("role"),
          ariaModal: panel?.getAttribute("aria-modal"),
          bg: panel ? getComputedStyle(panel).backgroundColor : null,
          left: rect ? (Math.round(rect.left) === 0 ? 0 : Math.round(rect.left)) : null,
          width: rect ? Math.round(rect.width) : null,
          initialFocusTestId: active?.getAttribute("data-testid") ?? null,
        }
      })
      assert.equal(initialState.role, "dialog")
      assert.equal(initialState.ariaModal, "true")
      assert.equal(initialState.left, 0)
      assert.equal(initialState.width, 232)
      assert.equal(initialState.bg, "rgb(255, 255, 255)", `Drawer must render in light surface (#ffffff), got ${initialState.bg}`)
      assert.equal(initialState.initialFocusTestId, "admin-drawer-close", `Expected initial focus on drawer close, got ${initialState.initialFocusTestId}`)

      for (let i = 0; i < 14; i++) {
        await page.keyboard.press("Tab")
        const inside = await page.evaluate(() => {
          const panel = document.querySelector('[data-testid="admin-drawer-panel"]')
          return Boolean(panel && panel.contains(document.activeElement))
        })
        assert(inside, `Tab step ${i + 1} escaped drawer focus trap`)
      }
      for (let i = 0; i < 14; i++) {
        await page.keyboard.press("Shift+Tab")
        const inside = await page.evaluate(() => {
          const panel = document.querySelector('[data-testid="admin-drawer-panel"]')
          return Boolean(panel && panel.contains(document.activeElement))
        })
        assert(inside, `Shift+Tab step ${i + 1} escaped drawer focus trap`)
      }

      const shot = path.join(outDir, "drawer-820x1180.png")
      await page.screenshot({ path: shot })

      await page.keyboard.press("Escape")
      await drawer.waitFor({ state: "detached" })
      const focusReturned = await page.evaluate(
        () => document.activeElement?.getAttribute("data-testid") === "admin-menu-trigger",
      )
      assert(focusReturned, "Focus did not return to drawer trigger after Esc")

      // Breakpoint 1024x768 check: navigate inside drawer closes drawer cleanly
      await page.setViewportSize({ width: 1024, height: 768 })
      await trigger.click()
      await drawer.waitFor({ state: "visible" })
      await drawer.getByTestId("admin-nav-turns").click()
      await drawer.waitFor({ state: "detached" })
      await page.getByTestId("turn-ledger-page").waitFor({ state: "visible" })

      assert.deepEqual(errors, [], `Console/page errors: ${errors.join(" | ")}`)
      report.checks.drawer = { ...initialState, focusTrappedTabs: 14, focusReturnedOnEsc: focusReturned }
      report.screenshots.push(shot)
      await context.close()
    }

    // (d) READ_ONLY accounts page 1440x1024: mutation controls hidden
    {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1024 } })
      await context.addInitScript(() => {
        window.__CAPTURE_PROFILE__ = "READ_ONLY"
      })
      const page = await context.newPage()
      const errors = await attachErrorCollector(page)
      await page.goto(`${mockVite.baseUrl}/admin/accounts`, { waitUntil: "networkidle" })
      await page.getByTestId("admin-accounts-page").waitFor({ state: "visible" })
      await page.getByTestId("admin-readonly-banner").waitFor({ state: "visible" })
      await page.getByText("Lễ tân 1").waitFor({ state: "visible" })

      const mutationCount = await page
        .locator("button")
        .filter({ hasText: /Tạo tài khoản|Đặt lại mật khẩu|Đặt lại MK|Khóa|Mở khóa|Đổi sang/ })
        .count()
      const actionHeaderCount = await page.locator("th").filter({ hasText: "Thao tác" }).count()
      assert.equal(mutationCount, 0, `READ_ONLY should have 0 account mutation buttons, found ${mutationCount}`)
      assert.equal(actionHeaderCount, 0, `READ_ONLY should hide Thao tác column header, found ${actionHeaderCount}`)
      assert.deepEqual(errors, [], `Console/page errors: ${errors.join(" | ")}`)

      const shot = path.join(outDir, "readonly-accounts-1440x1024.png")
      await page.screenshot({ path: shot })
      report.checks.readonlyAccounts = { mutationCount, actionHeaderCount }
      report.screenshots.push(shot)
      await context.close()
    }
  } finally {
    await mockVite.server.close()
  }

  // 2. HTTP stub mode server for anonymous deep-link -> admin login -> return path verification
  const httpVite = await startViteServer({
    VITE_API_MODE: "http",
    VITE_API_BASE_URL: "/api/v1",
  })
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1024 } })
    let serverSession = null
    const deviceIds = []
    await context.addInitScript(() => {
      window.__sessionStreams = []
      window.EventSource = class extends EventTarget {
        closed = false
        constructor() {
          super()
          window.__sessionStreams.push(this)
        }
        close() { this.closed = true }
      }
    })

    await context.route("**/api/v1/**", async (route) => {
      const req = route.request()
      const url = new URL(req.url())
      const apiPath = url.pathname

      if (apiPath === "/api/v1/auth/me" && req.method() === "GET") {
        if (!serverSession) {
          await route.fulfill({
            status: 401,
            contentType: "application/json",
            body: JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Chưa đăng nhập." } }),
          })
          return
        }
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(serverSession) })
        return
      }

      if (apiPath === "/api/v1/auth/login" && req.method() === "POST") {
        const body = req.postDataJSON()
        deviceIds.push(req.headers()["x-device-id"])
        const role = { admin: "OWNER", receptionist: "RECEPTIONIST", cashier: "CASHIER", waiter: "WAITER" }[body.portal]
        assert(role, `Unexpected login portal ${body.portal}`)
        serverSession = {
          user: {
            id: 3,
            username: body?.username ?? "owner",
            displayName: "Chủ quán",
            organizationId: 1,
            venueId: 1,
            roles: [role],
            accessLevel: null,
          },
          permissions: [
            "report.read",
            "customer.view_masked",
            "customer.phone.reveal",
            "booking.phone.reveal",
            "user.read",
            "user.manage",
            "venue.configure",
            "audit.read",
          ],
          csrfToken: "csrf-capture-token",
          portal: body?.portal ?? "admin",
        }
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(serverSession) })
        return
      }

      if (apiPath === "/api/v1/visits/turns" && req.method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            from: "2026-11-16",
            to: "2026-11-16",
            page: 1,
            pageSize: 20,
            total: 0,
            completedTotal: 0,
            guestTotal: 0,
            turns: [],
          }),
        })
        return
      }

      if (apiPath === "/api/v1/visits/turns/summary" && req.method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            from: "2026-11-16",
            to: "2026-11-16",
            completedTotal: 0,
            guestTotal: 0,
            byBusinessDate: [],
            byStaff: [],
            byScope: [],
          }),
        })
        return
      }

      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "NOT_FOUND", message: "Stub route" } }) })
    })

    const page = await context.newPage()
    const errors = []
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`))
    page.on("console", (msg) => {
      // Initial 401 on /auth/me logs a network resource error in Chromium console; ignore only 401 auth probe noise
      const text = msg.text()
      if (msg.type() === "error" && !text.includes("401 (Unauthorized)")) errors.push(`console.error: ${text}`)
    })

    // Verify receptionist & cashier anonymous portals remain intact
    await page.goto(`${httpVite.baseUrl}/floor`, { waitUntil: "networkidle" })
    await page.getByRole("heading", { name: "Đăng nhập Lễ tân" }).waitFor({ state: "visible" })
    await page.goto(`${httpVite.baseUrl}/cashier`, { waitUntil: "networkidle" })
    await page.getByRole("heading", { name: "Đăng nhập Thu ngân" }).waitFor({ state: "visible" })

    // Verify anonymous deep-link /admin/turns lands on admin login
    await page.goto(`${httpVite.baseUrl}/admin/turns`, { waitUntil: "networkidle" })
    const loginHeading = page.getByRole("heading", { name: "Đăng nhập Quản trị" })
    await loginHeading.waitFor({ state: "visible" })
    assert.equal(await page.getByRole("heading", { name: "Đăng nhập Lễ tân" }).count(), 0)

    const shot = path.join(outDir, "anon-turns-login-1440x1024.png")
    await page.screenshot({ path: shot })

    // Log in and assert post-login destination returns to /admin/turns
    await page.getByLabel("Tên đăng nhập", { exact: true }).fill("owner")
    await page.getByLabel("Mật khẩu", { exact: true }).fill("StrongPassword123!")
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click()

    await page.getByTestId("turn-ledger-page").waitFor({ state: "visible" })
    const finalPath = new URL(page.url()).pathname
    assert.equal(finalPath, "/admin/turns", `Expected return path /admin/turns after login, got ${finalPath}`)
    assert.deepEqual(errors, [], `Console/page errors: ${errors.join(" | ")}`)

    report.checks.anonDeepLink = {
      initialLoginHeading: "Đăng nhập Quản trị",
      returnedPath: finalPath,
      receptionistPortalIntact: true,
      cashierPortalIntact: true,
    }
    report.screenshots.push(shot)

    // Exercise the actual realtime hook, session store and boundary with the admin shell mounted.
    report.checks.adminSessionEnded = []
    for (const code of ["SESSION_REPLACED", "SESSION_REVOKED"]) {
      serverSession = null
      const ended = await page.evaluate(async (sessionCode) => {
        const { useSession } = await import("/src/state/session.ts")
        const streams = window.__sessionStreams.filter((stream) => !stream.closed)
        if (!streams.length) throw new Error("No active realtime stream in admin shell")
        streams.at(-1).dispatchEvent(new MessageEvent("session-ended", { data: JSON.stringify({ code: sessionCode }) }))
        const state = useSession.getState()
        return { status: state.authStatus, principal: state.principal, permissions: state.permissions, code: state.authEndCode }
      }, code)
      assert.deepEqual(ended, { status: "anonymous", principal: null, permissions: [], code })
      await page.waitForURL("**/admin/login")
      await page.getByRole("heading", { name: "Đăng nhập Quản trị" }).waitFor()
      assert.equal(await page.getByTestId("admin-shell").count(), 0)
      report.checks.adminSessionEnded.push(code)
      await page.goto(`${httpVite.baseUrl}/admin/turns`, { waitUntil: "networkidle" })
      await page.getByLabel("Tên đăng nhập", { exact: true }).fill("owner")
      await page.getByLabel("Mật khẩu", { exact: true }).fill("StrongPassword123!")
      await page.getByRole("button", { name: "Đăng nhập", exact: true }).click()
      await page.getByTestId("turn-ledger-page").waitFor()
    }

    report.checks.staffPortalLogin = []
    for (const [alias, canonical, portal, label] of [
      ["receptionist", "letan", "receptionist", "Lễ tân"],
      ["cashier", "thungan", "cashier", "Thu ngân"],
      ["waiter", "phucvu", "waiter", "Phục vụ"],
    ]) {
      serverSession = null
      await page.goto(`${httpVite.baseUrl}/${alias}/login`, { waitUntil: "networkidle" })
      await page.waitForURL(`**/${canonical}/login`)
      await page.getByRole("heading", { name: `Đăng nhập ${label}` }).waitFor()
      await page.getByLabel("Tên đăng nhập", { exact: true }).fill(portal)
      await page.getByLabel("Mật khẩu", { exact: true }).fill("StrongPassword123!")
      await page.getByRole("button", { name: "Đăng nhập", exact: true }).click()
      await page.getByTestId("portal-floor-stub").waitFor()
      assert.equal(new URL(page.url()).pathname, "/floor")
      assert.equal(serverSession.portal, portal)
      report.checks.staffPortalLogin.push(portal)
    }
    assert(deviceIds.every((id) => typeof id === "string" && id.length >= 16), "Every login must include a device ID")
    assert.equal(new Set(deviceIds).size, 1, "Device ID must survive login redirects and account changes")
    assert.deepEqual(errors, [], `Console/page errors: ${errors.join(" | ")}`)
    await context.close()
  } finally {
    await httpVite.server.close()
  }
} finally {
  await browser.close()
}

const resultsPath = path.join(outDir, "results.json")
fs.writeFileSync(resultsPath, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))

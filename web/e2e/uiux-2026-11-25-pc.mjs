// E2E verification & after screenshot capture for Package PC (2026-11-25 UI/UX audit).
// Usage:
//   Verify only:     node web/e2e/uiux-2026-11-25-pc.mjs
//   Verify + shots:  node web/e2e/uiux-2026-11-25-pc.mjs --capture [--out <dir>]
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
const webRoot = path.resolve(__dirname, "..")
const defaultAfterDir = "D:\\GAM-APP\\docs\\ui-inventory\\2026-11-25-after\\PC"

function parseArgs(argv) {
  const args = { capture: false, out: defaultAfterDir }
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token === "--capture") args.capture = true
    else if (token === "--out") args.out = path.resolve(argv[++i])
  }
  return args
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

async function startVite(mode, plugins = []) {
  const prevMode = process.env.VITE_API_MODE
  const prevBase = process.env.VITE_API_BASE_URL
  process.env.VITE_API_MODE = mode
  process.env.VITE_API_BASE_URL = mode === "http" ? "http://127.0.0.1:59999/api/v1" : ""
  const server = await createServer({
    root: webRoot,
    configFile: path.join(webRoot, "vite.config.ts"),
    server: { port: 0, host: "127.0.0.1", strictPort: false, open: false },
    plugins,
  })
  await server.listen()
  const addr = server.httpServer?.address()
  assert(addr && typeof addr === "object", "Vite server failed to bind a TCP port")
  return {
    server: {
      close: async () => {
        await server.close()
        if (prevMode === undefined) delete process.env.VITE_API_MODE
        else process.env.VITE_API_MODE = prevMode
        if (prevBase === undefined) delete process.env.VITE_API_BASE_URL
        else process.env.VITE_API_BASE_URL = prevBase
      },
    },
    baseUrl: `http://127.0.0.1:${addr.port}`,
  }
}

const VIRTUAL_RESERVATIONS_ENTRY = "/src/__pc_reservations_mobile_entry.js"
const RESOLVED_RESERVATIONS_ENTRY = `\0${VIRTUAL_RESERVATIONS_ENTRY}`

function buildReservationsMobileEntry() {
  return `
import "@/index.css"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createElement, StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { createBrowserRouter, RouterProvider } from "react-router"
import { Toaster } from "sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import ReservationsPage from "@/features/reservations/reservations-page"

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 1000, retry: false } },
})

const router = createBrowserRouter([
  {
    path: "*",
    element: createElement("main", { className: "h-dvh min-h-0" }, createElement(ReservationsPage)),
  },
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
        createElement(RouterProvider, { router }),
        createElement(Toaster, { position: "bottom-right" }),
      ),
    ),
  ),
)
`
}

function createReservationsMobilePlugin() {
  const indexHtmlPath = path.join(webRoot, "index.html")
  return {
    name: "pc-reservations-mobile-entry",
    resolveId(id) {
      if (id === VIRTUAL_RESERVATIONS_ENTRY) return RESOLVED_RESERVATIONS_ENTRY
      return null
    },
    load(id) {
      if (id === RESOLVED_RESERVATIONS_ENTRY) return buildReservationsMobileEntry()
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
          const rawHtml = fs.readFileSync(indexHtmlPath, "utf8").replace("/src/main.tsx", VIRTUAL_RESERVATIONS_ENTRY)
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

async function settle(page) {
  await page.waitForFunction(
    () =>
      document.body.innerText.trim().length > 0 &&
      !/^Đang (tải|kiểm tra)[^.]*\.{0,3}$/.test(document.body.innerText.trim()) &&
      !document.querySelector('[aria-busy="true"]'),
    undefined,
    { timeout: 10_000 },
  )
  await page.evaluate(() => Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2500))]))
  await page.waitForTimeout(150)
}

async function runAxe(page) {
  await page.evaluate(axeSrc)
  return page.evaluate(async () => {
    const res = await window.axe.run({ resultTypes: ["violations"] })
    return res.violations
      .filter((v) => ["serious", "critical"].includes(v.impact))
      .map((v) => ({
        id: v.id,
        impact: v.impact,
        description: v.description,
        nodes: v.nodes.map((n) => ({
          target: n.target,
          html: n.html?.slice(0, 320),
          summary: n.failureSummary,
        })),
      }))
  })
}

async function measureLayout(page) {
  return page.evaluate(() => {
    const docOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth
    const h1Count = document.querySelectorAll("h1").length
    const mainCount = document.querySelectorAll("main").length
    const smallFonts = []
    const smallTargets = []
    for (const el of document.querySelectorAll("body *")) {
      if (!(el instanceof HTMLElement)) continue
      const style = getComputedStyle(el)
      if (style.display === "none" || style.visibility !== "visible" || el.closest("[hidden],details:not([open])"))
        continue
      const rect = el.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) continue
      const hasDirectText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0)
      if (hasDirectText) {
        const fsPx = parseFloat(style.fontSize)
        if (fsPx > 0 && fsPx < 11.9) {
          smallFonts.push({
            tag: el.localName,
            text: el.textContent.trim().slice(0, 40),
            fontSize: Math.round(fsPx * 10) / 10,
          })
        }
      }
      if (
        innerWidth <= 1024 &&
        el.matches("button,a[href],input:not([type=hidden]),select,textarea,[role=button],[role=tab]")
      ) {
        const minDim = Math.min(rect.width, rect.height)
        if (minDim < 43.5) {
          smallTargets.push({
            tag: el.localName,
            text: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40),
            w: Math.round(rect.width),
            h: Math.round(rect.height),
          })
        }
      }
    }
    return { docOverflow, h1Count, mainCount, smallFonts, smallTargets }
  })
}

function attachConsoleErrorGuard(page, errors) {
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`)
  })
  page.on("pageerror", (err) => {
    errors.push(`pageerror: ${err.message}`)
  })
}

async function verifyDs04AdminGuard(browser, capture, outDir) {
  const { server, baseUrl } = await startVite("http")
  try {
    // 1. Loading state (Suspense fallback -> AdminLoading) under html.dark + prefers-contrast: more
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      contrast: "more",
    })
    await ctx.addInitScript(() => {
      window.EventSource = class extends EventTarget {
        close() {}
      }
      localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 3, theme: "dark" }))
      document.addEventListener("DOMContentLoaded", () => {
        document.documentElement.classList.add("dark")
      })
    })
    const page = await ctx.newPage()
    const errors = []
    attachConsoleErrorGuard(page, errors)

    let releaseAdminShell
    const adminShellPending = new Promise((r) => {
      releaseAdminShell = r
    })
    await page.route("**/src/features/admin/admin-shell.tsx*", async (route) => {
      await adminShellPending
      await route.continue()
    })
    await page.route("**/api/v1/**", async (route) => {
      const url = new URL(route.request().url())
      if (url.pathname === "/api/v1/auth/me") {
        return route.fulfill({
          status: 200,
          json: {
            user: {
              id: 3,
              username: "owner",
              displayName: "Chủ quán",
              organizationId: 1,
              venueId: 1,
              roles: ["OWNER"],
              accessLevel: null,
            },
            permissions: ["report.read", "user.read", "customer.view_masked", "audit.read", "venue.configure"],
            csrfToken: "t",
            portal: "admin",
          },
        })
      }
      if (url.pathname === "/api/v1/venue/shift") {
        return route.fulfill({ status: 200, json: { startLocal: "17:00:00", cutoffLocal: "05:00:00" } })
      }
      return route.fulfill({ status: 200, json: {} })
    })

    await page.goto(`${baseUrl}/admin/settings`, { waitUntil: "domcontentloaded" })
    const loadingRoot = page.locator('[aria-label="Đang kiểm tra quyền quản trị"]')
    await loadingRoot.waitFor({ state: "visible" })

    const loadingStyles = await loadingRoot.evaluate((el) => {
      const cs = getComputedStyle(el)
      return {
        hasAdminPortal: el.classList.contains("admin-portal"),
        bg: cs.backgroundColor,
        colorScheme: cs.colorScheme,
        admBorder: cs.getPropertyValue("--adm-border").trim(),
        admTextMuted: cs.getPropertyValue("--adm-text-muted").trim(),
      }
    })
    assert(loadingStyles.hasAdminPortal, "DS-04: AdminLoading must carry .admin-portal")
    assert.equal(
      loadingStyles.bg,
      "rgb(247, 246, 243)",
      "DS-04: AdminLoading must render light #f7f6f3 even with html.dark",
    )
    assert.equal(loadingStyles.colorScheme, "light", "DS-04: AdminLoading must enforce color-scheme: light")
    assert.equal(loadingStyles.admBorder, "#b8b3a8", "DS-04: prefers-contrast: more must apply to AdminLoading")
    assert.equal(loadingStyles.admTextMuted, "#4b473f", "DS-04: prefers-contrast: more muted text must apply")
    if (capture) {
      await page.screenshot({
        path: path.join(outDir, "ds04-admin-guard-loading-1440x900.png"),
        animations: "disabled",
      })
    }
    releaseAdminShell()
    await page.getByTestId("admin-shell").waitFor({ state: "visible" })
    assert.equal(errors.length, 0, `DS-04 loading console errors: ${errors.join("; ")}`)
    await ctx.close()

    // 2. Forbidden state under html.dark + prefers-contrast: more
    const fCtx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      contrast: "more",
    })
    await fCtx.addInitScript(() => {
      window.EventSource = class extends EventTarget {
        close() {}
      }
      localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 1, theme: "dark" }))
      document.addEventListener("DOMContentLoaded", () => {
        document.documentElement.classList.add("dark")
      })
    })
    const fPage = await fCtx.newPage()
    const fErrors = []
    attachConsoleErrorGuard(fPage, fErrors)
    await fPage.route("**/api/v1/**", async (route) => {
      const url = new URL(route.request().url())
      if (url.pathname === "/api/v1/auth/me") {
        return route.fulfill({
          status: 200,
          json: {
            user: {
              id: 1,
              username: "letan1",
              displayName: "Lễ tân 1",
              organizationId: 1,
              venueId: 1,
              roles: ["RECEPTIONIST"],
              accessLevel: null,
            },
            permissions: [],
            csrfToken: "t",
            portal: "receptionist",
          },
        })
      }
      return route.fulfill({ status: 200, json: {} })
    })
    await fPage.goto(`${baseUrl}/admin/overview`, { waitUntil: "domcontentloaded" })
    const forbiddenMain = fPage.locator("main.admin-portal")
    await forbiddenMain.waitFor({ state: "visible" })
    const forbiddenStyles = await forbiddenMain.evaluate((el) => {
      const cs = getComputedStyle(el)
      return {
        bg: cs.backgroundColor,
        colorScheme: cs.colorScheme,
        h1: el.querySelector("h1")?.textContent?.trim(),
        linkHeight: el.querySelector("a")?.getBoundingClientRect().height ?? 0,
      }
    })
    assert.equal(forbiddenStyles.bg, "rgb(247, 246, 243)", "DS-04: AdminForbidden must render light #f7f6f3")
    assert.equal(forbiddenStyles.colorScheme, "light", "DS-04: AdminForbidden must enforce color-scheme: light")
    assert.equal(forbiddenStyles.h1, "Không có quyền truy cập")
    assert(forbiddenStyles.linkHeight >= 44, `DS-04: Forbidden link height >= 44, got ${forbiddenStyles.linkHeight}`)
    if (capture) {
      await fPage.screenshot({
        path: path.join(outDir, "ds04-admin-guard-forbidden-1440x900.png"),
        animations: "disabled",
      })
    }
    assert.equal(fErrors.length, 0, `DS-04 forbidden console errors: ${fErrors.join("; ")}`)
    await fCtx.close()
  } finally {
    await server.close()
  }
}

async function verifyMockAdminAndShell(browser, capture, outDir) {
  const { server, baseUrl } = await startVite("mock")
  const viewportsCore = [
    [320, 568],
    [390, 844],
    [820, 1180],
    [1024, 768],
    [1440, 900],
  ]
  const viewportsExtended = [
    [320, 568],
    [375, 667],
    [390, 844],
    [768, 1024],
    [820, 1180],
    [1024, 768],
    [1366, 768],
    [1440, 900],
    [1920, 1080],
  ]

  try {
    // A. Admin routes across matrix
    const adminRoutes = [
      { route: "/admin/overview", slug: "admin-overview", vps: viewportsExtended },
      { route: "/admin/visits", slug: "admin-visits", vps: viewportsExtended },
      { route: "/admin/accounts", slug: "admin-accounts", vps: viewportsExtended },
      { route: "/admin/audit", slug: "admin-audit", vps: viewportsCore },
      { route: "/admin/customers/1", slug: "admin-customers-1", vps: viewportsExtended },
    ]

    for (const item of adminRoutes) {
      for (const [w, h] of item.vps) {
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w <= 1024 })
        await ctx.addInitScript(() => {
          localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 3, theme: "light" }))
        })
        const page = await ctx.newPage()
        const errors = []
        attachConsoleErrorGuard(page, errors)

        await page.goto(`${baseUrl}${item.route}`, { waitUntil: "networkidle" })
        await settle(page)

        const m = await measureLayout(page)
        assert.equal(m.docOverflow, false, `${item.route} ${w}x${h} horizontal overflow`)
        assert.equal(m.mainCount, 1, `${item.route} ${w}x${h} mainCount=${m.mainCount}`)
        assert.equal(m.h1Count, 1, `${item.route} ${w}x${h} h1Count=${m.h1Count}`)
        assert.equal(m.smallFonts.length, 0, `${item.route} ${w}x${h} smallFonts: ${JSON.stringify(m.smallFonts)}`)

        // Run axe-core on key viewports before Tab interactions open transient tooltips
        if ([320, 390, 820, 1024, 1440].includes(w)) {
          const violations = await runAxe(page)
          assert.equal(
            violations.length,
            0,
            `${item.route} ${w}x${h} axe serious/critical: ${JSON.stringify(violations)}`,
          )
        }

        // Route-specific assertions
        if (item.route === "/admin/overview") {
          // UX-25: legend trigger uses Info SVG icon instead of "!"
          const legendCheck = await page.evaluate(() => {
            const btn = document.querySelector('[data-testid="so-legend-trigger"]')
            return {
              hasBtn: Boolean(btn),
              hasSvg: Boolean(btn?.querySelector("svg")),
              text: btn?.textContent?.trim() ?? "",
            }
          })
          assert(legendCheck.hasBtn && legendCheck.hasSvg, "UX-25: legend trigger must render Info SVG icon")
          assert.equal(legendCheck.text, "", `UX-25: legend trigger must not render '!', got '${legendCheck.text}'`)
        }

        if (item.route === "/admin/customers/1") {
          // DS-06: no gradient on profile hero
          const heroInfo = await page.evaluate(() => {
            const nameEl = document.getElementById("customer-name")
            if (!nameEl) return null
            const heroWrap = nameEl.closest("section")?.firstElementChild
            return {
              tagName: nameEl.tagName,
              bg: heroWrap ? getComputedStyle(heroWrap).backgroundImage : "",
            }
          })
          assert(heroInfo, "customer-name missing")
          assert.equal(heroInfo.tagName, "H2", "UX-14: customer-name must be H2, not duplicate H1")
          assert.equal(heroInfo.bg, "none", `DS-06: expected no gradient on customer profile hero, got ${heroInfo.bg}`)

          // UX-05 + tabs >= 44px up to 1024px + DS-07 flat visit rows vs dashed booking rows
          const profileMetrics = await page.evaluate(() => {
            const tabButtons = [...document.querySelectorAll('[role="group"][aria-label="Lọc lịch sử"] button')]
            const tabBoxes = tabButtons.map((b) => {
              const r = b.getBoundingClientRect()
              return { text: b.textContent.trim(), w: r.width, h: r.height }
            })
            const backLink = document.querySelector('main a[href^="/admin/customers"]')
            const backRect = backLink?.getBoundingClientRect()
            const countSpans = tabButtons.map((b) => {
              const span = b.querySelector("span")
              return span ? parseFloat(getComputedStyle(span).opacity) : 1
            })
            const visitEventCards = [...document.querySelectorAll("ol > li > div")].map((d) => {
              const cs = getComputedStyle(d)
              return { borderStyle: cs.borderStyle, boxShadow: cs.boxShadow }
            })
            return { tabBoxes, backH: backRect?.height ?? 0, countSpans, visitEventCards }
          })
          assert.equal(profileMetrics.tabBoxes.length, 3)
          if (w <= 1024) {
            for (const tb of profileMetrics.tabBoxes) {
              assert(tb.h >= 44, `Customer history tab '${tb.text}' height ${tb.h} < 44 at ${w}x${h}`)
            }
            assert(profileMetrics.backH >= 44, `Back link height ${profileMetrics.backH} < 44 at ${w}x${h}`)
          }
          for (const op of profileMetrics.countSpans) {
            assert.equal(op, 1, `UX-05: tab count span must not use opacity < 1, got ${op}`)
          }
          // DS-07: visit rows have no box-shadow; booking rows keep dashed border
          assert(
            profileMetrics.visitEventCards.some((c) => c.boxShadow === "none"),
            "DS-07: expected flat timeline rows without shadow",
          )
          assert(
            profileMetrics.visitEventCards.some((c) => c.borderStyle.includes("dashed")),
            "DS-07: expected dashed cue preserved for booking rows",
          )
        }

        if (item.route === "/admin/visits") {
          // UX-22: header says "Khách", never "Pax"
          const thTexts = await page.evaluate(() =>
            [...document.querySelectorAll('[data-testid="turns-history-table"] th')].map((th) => th.textContent.trim()),
          )
          assert(thTexts.includes("Khách"), `UX-22: expected 'Khách' column header, got ${JSON.stringify(thTexts)}`)
          assert(!thTexts.some((t) => /^pax$/i.test(t)), `UX-22: 'Pax' still present in ${JSON.stringify(thTexts)}`)
        }

        if (item.route === "/admin/accounts" && w <= 390) {
          // UX-21: scroll fade cue visible when overflowing horizontally, and disappears when scrolled to end
          const cueVisible = await page.getByTestId("accounts-filter-scroll-cue").isVisible()
          assert(cueVisible, `UX-21: accounts filter scroll cue should be visible at ${w}x${h}`)
          await page.evaluate(() => {
            const g = document.querySelector('[role="group"][aria-label="Lọc theo vai trò"]')
            if (g) {
              g.scrollLeft = g.scrollWidth
              g.dispatchEvent(new Event("scroll"))
            }
          })
          await page.waitForTimeout(80)
          const cueAfterEnd = await page.getByTestId("accounts-filter-scroll-cue").count()
          assert.equal(cueAfterEnd, 0, `UX-21: accounts filter cue should hide at scroll end (${w}x${h})`)
          // Reset scroll before screenshot
          await page.evaluate(() => {
            const g = document.querySelector('[role="group"][aria-label="Lọc theo vai trò"]')
            if (g) {
              g.scrollLeft = 0
              g.dispatchEvent(new Event("scroll"))
            }
          })
          await page.waitForTimeout(80)
        }

        if (item.route === "/admin/audit" && w <= 390) {
          const cueVisible = await page.getByTestId("audit-filter-scroll-cue").isVisible()
          assert(cueVisible, `UX-21: audit filter scroll cue should be visible at ${w}x${h}`)
        }

        if (w >= 1024) {
          const hasAside = await page.locator("aside[data-testid='admin-sidebar']").count()
          assert.equal(hasAside, 1, `UX-14: expected <aside> landmark for admin sidebar at ${w}x${h}`)
        }

        if (capture) {
          await page.screenshot({
            path: path.join(outDir, `${item.slug}-busy-${w}x${h}.png`),
            animations: "disabled",
          })
        }

        // Check focus-visible on Tab (4 steps)
        for (let t = 0; t < 4; t++) await page.keyboard.press("Tab")
        const focusActive = await page.evaluate(() => document.activeElement?.tagName ?? "BODY")
        assert.notEqual(focusActive, "BODY", `${item.route} ${w}x${h} keyboard focus fell to BODY`)

        assert.equal(errors.length, 0, `${item.route} ${w}x${h} console errors: ${errors.join("; ")}`)
        await ctx.close()
      }
    }

    // B. AppShell Desktop/Tablet routes (>= 768px)
    const shellRoutes = [
      { route: "/overview", slug: "owner-overview", vps: viewportsExtended.filter(([w]) => w >= 768) },
      { route: "/reservations", slug: "owner-reservations", vps: viewportsExtended.filter(([w]) => w >= 768) },
      {
        route: "/waitlist",
        slug: "owner-waitlist",
        vps: [
          [820, 1180],
          [1024, 768],
          [1440, 900],
        ],
      },
      {
        route: "/guests",
        slug: "owner-guests",
        vps: [
          [820, 1180],
          [1024, 768],
          [1440, 900],
        ],
      },
      {
        route: "/reports",
        slug: "owner-reports",
        vps: [
          [820, 1180],
          [1024, 768],
          [1440, 900],
        ],
      },
      {
        route: "/settings",
        slug: "owner-settings",
        vps: [
          [820, 1180],
          [1024, 768],
          [1440, 900],
        ],
      },
    ]

    for (const item of shellRoutes) {
      for (const [w, h] of item.vps) {
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w <= 1024 })
        await ctx.addInitScript(() => {
          localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 3, theme: "light" }))
        })
        const page = await ctx.newPage()
        const errors = []
        attachConsoleErrorGuard(page, errors)

        await page.goto(`${baseUrl}${item.route}`, { waitUntil: "networkidle" })
        await settle(page)

        const m = await measureLayout(page)
        assert.equal(m.docOverflow, false, `${item.route} ${w}x${h} horizontal overflow`)
        assert.equal(m.mainCount, 1, `${item.route} ${w}x${h} mainCount=${m.mainCount}`)
        assert.equal(m.h1Count, 1, `${item.route} ${w}x${h} h1Count=${m.h1Count}`)
        if (["/overview", "/reservations", "/reports", "/settings"].includes(item.route)) {
          // PendingTag in PA-owned components/common.tsx:235 still uses 11px
          const pcSmallFonts = m.smallFonts.filter((sf) => !["Chờ PO duyệt", "Vai trò TECH_PROPOSED"].includes(sf.text))
          assert.equal(pcSmallFonts.length, 0, `${item.route} ${w}x${h} smallFonts: ${JSON.stringify(pcSmallFonts)}`)
        } else {
          // /waitlist and /guests pages are outside PC ownership; still enforce 0 <12px fonts in AppShell chrome
          const shellSmall = await page.evaluate(
            () =>
              [...document.querySelectorAll("header *")].filter((el) => {
                const s = getComputedStyle(el)
                const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0)
                return hasText && s.display !== "none" && s.visibility === "visible" && parseFloat(s.fontSize) < 11.9
              }).length,
          )
          assert.equal(shellSmall, 0, `${item.route} ${w}x${h} AppShell header has <12px fonts`)
        }

        // UX-07: ClockMenu aria-label matches visible text order
        const clockCheck = await page.evaluate(() => {
          const btn = document.querySelector('button[aria-label*="Mở điều khiển thời gian"]')
          if (!btn) return null
          return {
            aria: btn.getAttribute("aria-label") ?? "",
            text: btn.textContent.replace(/\s+/g, " ").trim(),
          }
        })
        assert(clockCheck, `${item.route} ${w}x${h}: ClockMenu trigger not found`)
        const timeMatch = /\d{2}:\d{2}/.exec(clockCheck.text)
        assert(timeMatch, `UX-07: expected HH:mm in ClockMenu text, got '${clockCheck.text}'`)
        assert(
          clockCheck.aria.startsWith(timeMatch[0]),
          `UX-07: aria-label '${clockCheck.aria}' must start with visible time '${timeMatch[0]}'`,
        )

        if ([820, 1024, 1440].includes(w)) {
          const violations = (await runAxe(page)).filter((v) => {
            if (item.route === "/reservations" && v.id === "label-content-name-mismatch") {
              // Pre-existing DateField in PA-owned features/floor/floor-toolbar.tsx:53 (not in PC scope)
              const nonExternal = v.nodes.filter((n) => !n.html?.includes('aria-label="Chọn ngày kinh doanh"'))
              return nonExternal.length > 0
            }
            return true
          })
          assert.equal(
            violations.length,
            0,
            `${item.route} ${w}x${h} axe serious/critical: ${JSON.stringify(violations)}`,
          )
        }

        if (capture) {
          await page.screenshot({
            path: path.join(outDir, `${item.slug}-busy-${w}x${h}.png`),
            animations: "disabled",
          })
        }

        // Check focus-visible on Tab (4 steps)
        for (let t = 0; t < 4; t++) await page.keyboard.press("Tab")
        const focusActive = await page.evaluate(() => document.activeElement?.tagName ?? "BODY")
        assert.notEqual(focusActive, "BODY", `${item.route} ${w}x${h} keyboard focus fell to BODY`)

        assert.equal(errors.length, 0, `${item.route} ${w}x${h} console errors: ${errors.join("; ")}`)
        await ctx.close()
      }
    }
  } finally {
    await server.close()
  }
}

async function verifyReservationsMobileNestedFix(browser, capture, outDir) {
  // Mount ReservationsPage directly at 320x568 and 390x844 to test its md:hidden list view (UX-06)
  const { server, baseUrl } = await startVite("mock", [createReservationsMobilePlugin()])
  try {
    for (const [w, h] of [
      [320, 568],
      [390, 844],
    ]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true })
      await ctx.addInitScript(() => {
        localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 3, theme: "light" }))
      })
      const page = await ctx.newPage()
      const errors = []
      attachConsoleErrorGuard(page, errors)

      await page.goto(`${baseUrl}/reservations`, { waitUntil: "networkidle" })
      await settle(page)

      const violations = await runAxe(page)
      const nested = violations.filter((v) => v.id === "nested-interactive")
      assert.equal(
        nested.length,
        0,
        `UX-06: nested-interactive on ReservationsPage ${w}x${h}: ${JSON.stringify(nested)}`,
      )

      if (capture) {
        await page.screenshot({
          path: path.join(outDir, `reservations-mobile-list-busy-${w}x${h}.png`),
          animations: "disabled",
        })
      }

      // Hit-test check: clicking Check-in action button hits the action button, not row overlay; clicking row text hits row button
      const hitCheck = await page.evaluate(() => {
        const list = document.querySelector("ul.grid.md\\:hidden")
        if (!list) return { hasList: false }
        const checkInBtn = list.querySelector('button[aria-label^="Check-in "]')
        const rowBtn = list.querySelector("li > button")
        if (!rowBtn) return { hasList: true, hasRowBtn: false }
        const rr = rowBtn.getBoundingClientRect()
        const rowHit = document.elementFromPoint(rr.left + 20, rr.top + rr.height / 2)
        let actionHitOk = true
        if (checkInBtn) {
          checkInBtn.scrollIntoView({ block: "center" })
          const ar = checkInBtn.getBoundingClientRect()
          const ah = document.elementFromPoint(ar.left + ar.width / 2, ar.top + ar.height / 2)
          actionHitOk = Boolean(ah && (checkInBtn === ah || checkInBtn.contains(ah)))
        }
        return {
          hasList: true,
          hasRowBtn: true,
          rowHitOk: Boolean(rowHit && (rowBtn === rowHit || rowBtn.contains(rowHit))),
          actionHitOk,
          nestedCount: list.querySelectorAll('[role="button"] button, button button').length,
        }
      })
      assert(hitCheck.hasList && hitCheck.hasRowBtn, `UX-06: expected mobile reservation list at ${w}x${h}`)
      assert(hitCheck.rowHitOk, `UX-06: hit-test on reservation row failed at ${w}x${h}`)
      assert(hitCheck.actionHitOk, `UX-06: hit-test on Check-in button failed at ${w}x${h}`)
      assert.equal(hitCheck.nestedCount, 0, `UX-06: found nested buttons at ${w}x${h}`)
      assert.equal(errors.length, 0, `UX-06 ${w}x${h} console errors: ${errors.join("; ")}`)
      await ctx.close()
    }
  } finally {
    await server.close()
  }
}

async function verifyMobileAppReservationsAnd24h(browser, capture, outDir) {
  const { server, baseUrl } = await startVite("mock")
  try {
    for (const [w, h] of [
      [320, 568],
      [390, 844],
    ]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true })
      await ctx.addInitScript(() => {
        localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 3, theme: "light" }))
      })
      const page = await ctx.newPage()
      const errors = []
      attachConsoleErrorGuard(page, errors)

      // 1. MobileApp /reservations (BookingCard UX-06 + 24h UX-08)
      await page.goto(`${baseUrl}/reservations`, { waitUntil: "networkidle" })
      await settle(page)

      const m = await measureLayout(page)
      assert.equal(m.docOverflow, false, `Mobile /reservations ${w}x${h} horizontal overflow`)
      const violations = await runAxe(page)
      const nested = violations.filter((v) => v.id === "nested-interactive")
      assert.equal(
        nested.length,
        0,
        `UX-06 MobileApp /reservations ${w}x${h} nested-interactive: ${JSON.stringify(nested)}`,
      )

      const bodyText = await page.evaluate(() => document.body.innerText)
      assert(
        !/\b\d{1,2}:\d{2}\s?(?:AM|PM)\b/i.test(bodyText),
        `UX-08: 12h AM/PM time found on mobile /reservations ${w}x${h}`,
      )

      // Hit-test StatusChip vs BookingCard detail button
      const cardHit = await page.evaluate(() => {
        const card = document.querySelector("article")
        if (!card) return null
        const detailBtn = card.querySelector('button[aria-label*="Mở chi tiết"]')
        const statusBtn = card.querySelector('button[aria-label*="Đổi trạng thái"]')
        if (!detailBtn || !statusBtn) return { missing: true }
        const dr = detailBtn.getBoundingClientRect()
        const sr = statusBtn.getBoundingClientRect()
        const dh = document.elementFromPoint(dr.left + 12, dr.top + dr.height / 2)
        const sh = document.elementFromPoint(sr.left + sr.width / 2, sr.top + sr.height / 2)
        return {
          detailOk: Boolean(dh && (detailBtn === dh || detailBtn.contains(dh))),
          statusOk: Boolean(sh && (statusBtn === sh || statusBtn.contains(sh))),
          statusH: Math.round(sr.height),
          detailH: Math.round(dr.height),
          nestedInArticle: card.querySelectorAll("button button, [role='button'] button").length,
        }
      })
      assert(cardHit && !cardHit.missing, `UX-06: BookingCard buttons missing at ${w}x${h}`)
      assert(cardHit.detailOk, `UX-06: BookingCard detail button hit-test failed at ${w}x${h}`)
      assert(cardHit.statusOk, `UX-06: BookingCard StatusChip hit-test failed at ${w}x${h}`)
      assert(
        cardHit.statusH >= 44 && cardHit.detailH >= 44,
        `UX-06: BookingCard touch targets < 44px: ${JSON.stringify(cardHit)}`,
      )
      assert.equal(cardHit.nestedInArticle, 0, "UX-06: BookingCard still has nested interactive buttons")

      if (capture) {
        await page.screenshot({
          path: path.join(outDir, `owner-reservations-mobile-busy-${w}x${h}.png`),
          animations: "disabled",
        })
      }

      // Switch to Timeline tab on mobile /reservations -> verify 24h axis labels (no AM/PM)
      const timelineTab = page.getByRole("tab", { name: "Thời gian" })
      if ((await timelineTab.count()) > 0) {
        await timelineTab.click()
        await page.waitForTimeout(150)
        const timelineText = await page.evaluate(() => document.body.innerText)
        assert(!/\b\d{1,2}\s?(?:AM|PM)\b/i.test(timelineText), `UX-08: AM/PM found on mobile timeline ${w}x${h}`)
      }

      // 2. MobileApp /home -> verify 24h
      await page.goto(`${baseUrl}/home`, { waitUntil: "networkidle" })
      await settle(page)
      const homeText = await page.evaluate(() => document.body.innerText)
      assert(!/\b\d{1,2}:\d{2}\s?(?:AM|PM)\b/i.test(homeText), `UX-08: 12h AM/PM found on /home ${w}x${h}`)
      if (capture && w === 390) {
        await page.screenshot({
          path: path.join(outDir, `owner-home-mobile-busy-${w}x${h}.png`),
          animations: "disabled",
        })
      }

      assert.equal(errors.length, 0, `MobileApp ${w}x${h} console errors: ${errors.join("; ")}`)
      await ctx.close()
    }

    // 3. Receptionist /floor at 390x844 -> verify Toast15 shows 24h time (no AM/PM)
    const rCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })
    await rCtx.addInitScript(() => {
      localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 1, theme: "light" }))
    })
    const rPage = await rCtx.newPage()
    const rErrors = []
    attachConsoleErrorGuard(rPage, rErrors)
    await rPage.goto(`${baseUrl}/floor`, { waitUntil: "networkidle" })
    await settle(rPage)
    const floorText = await rPage.evaluate(() => document.body.innerText)
    assert(!/\b\d{1,2}:\d{2}\s?(?:AM|PM)\b/i.test(floorText), "UX-08: 12h AM/PM found on receptionist /floor")
    if (capture) {
      await rPage.screenshot({ path: path.join(outDir, "receptionist-floor-24h-390x844.png"), animations: "disabled" })
    }
    assert.equal(rErrors.length, 0, `Receptionist /floor console errors: ${rErrors.join("; ")}`)
    await rCtx.close()
  } finally {
    await server.close()
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.capture) fs.mkdirSync(args.out, { recursive: true })

  const browser = await launchBrowser()
  try {
    await verifyDs04AdminGuard(browser, args.capture, args.out)
    await verifyMockAdminAndShell(browser, args.capture, args.out)
    await verifyReservationsMobileNestedFix(browser, args.capture, args.out)
    await verifyMobileAppReservationsAnd24h(browser, args.capture, args.out)
    console.log(
      `PASS: uiux-2026-11-25-pc verified DS-04, DS-06, DS-07, UX-05, UX-06, UX-07, UX-08, UX-14, UX-18, UX-21, UX-22, UX-25${args.capture ? ` (screenshots -> ${args.out})` : ""}`,
    )
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})

/**
 * E2E verification & evidence capture for Admin Tổng quan ca:
 * - Spatial read-only floor map reusing FloorCanvas + venue-layout.ts
 * - Round "!" legend trigger + responsive Popover (desktop) / Sheet (phone)
 * - No-mutation, no-dialog, no-write-handler guarantees across click/tap/keyboard
 * - 8-viewport responsive layout & zero overlap/cropping checks
 * - Reception /floor + Reception StatusLegend regression checks
 *
 * Usage (from web/): VITE_API_MODE=mock node e2e/admin-floor-map.mjs
 */
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "@playwright/test"
import { createServer } from "vite"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(__dirname, "..")
const evidenceRoot =
  process.env.ADMIN_FLOOR_EVIDENCE_DIR || "D:\\GAM-APP\\docs\\Sprint4\\evidence\\admin-floor-map-2026-11-18\\after"
fs.mkdirSync(evidenceRoot, { recursive: true })

const VIEWPORTS = [
  { width: 375, height: 812, label: "375x812", touch: true },
  { width: 390, height: 844, label: "390x844", touch: true },
  { width: 768, height: 1024, label: "768x1024", touch: true },
  { width: 820, height: 1180, label: "820x1180", touch: true },
  { width: 1024, height: 768, label: "1024x768", touch: false },
  { width: 1366, height: 768, label: "1366x768", touch: false },
  { width: 1440, height: 900, label: "1440x900", touch: false },
  { width: 1920, height: 1080, label: "1920x1080", touch: false },
]

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

async function startMockViteServer() {
  const prevMode = process.env.VITE_API_MODE
  const prevBase = process.env.VITE_API_BASE_URL
  process.env.VITE_API_MODE = "mock"
  process.env.VITE_API_BASE_URL = ""
  const port = Number(process.env.PW_PORT || 5207)
  try {
    const server = await createServer({
      root: webRoot,
      configFile: path.join(webRoot, "vite.config.ts"),
      server: { port, host: "127.0.0.1", strictPort: true, open: false },
    })
    await server.listen()
    const addr = server.httpServer?.address()
    assert(addr && typeof addr === "object", "Vite server failed to bind a TCP port")
    return { server, baseUrl: `http://127.0.0.1:${addr.port}` }
  } finally {
    if (prevMode === undefined) delete process.env.VITE_API_MODE
    else process.env.VITE_API_MODE = prevMode
    if (prevBase === undefined) delete process.env.VITE_API_BASE_URL
    else process.env.VITE_API_BASE_URL = prevBase
  }
}

async function attachCollectors(page, baseUrl) {
  const errors = []
  const mutationRequests = []
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`))
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`)
  })
  page.on("request", (req) => {
    const method = req.method().toUpperCase()
    const url = req.url()
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && (url.startsWith(baseUrl) || url.includes("/api/"))) {
      mutationRequests.push(`${method} ${url}`)
    }
  })
  return { errors, mutationRequests }
}

async function installApiMutationSpy(page) {
  await page.evaluate(async () => {
    const { api } = await import("/src/services/index.ts")
    const writeMethods = [
      "createReservation",
      "updateReservation",
      "cancelReservation",
      "markNoShow",
      "assignTables",
      "seatWalkIn",
      "checkInReservation",
      "moveVisit",
      "combineTables",
      "splitTable",
      "endVisit",
      "markPaid",
      "createTableGroup",
      "splitTableGroup",
      "undo",
      "redo",
      "addWaitlist",
      "updateReceptionGuestCount",
      "setTableSpare",
    ]
    window.__adminFloorMutations = []
    for (const method of writeMethods) {
      if (typeof api[method] === "function") {
        const orig = api[method].bind(api)
        api[method] = async (...args) => {
          window.__adminFloorMutations.push(method)
          return orig(...args)
        }
      }
    }
  })
}

async function dismissReceptionAlerts(page) {
  for (let i = 0; i < 6; i++) {
    const btn = page.getByRole("button", { name: /Đã xem.*xử lý sau|Đã xem, nhắc sau|Để sau|Đóng thông báo/ }).first()
    if (!(await btn.isVisible().catch(() => false))) break
    await btn.click()
    await page.waitForTimeout(150)
  }
}

function rectsOverlap(a, b) {
  return !(a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1)
}

const browser = await launchBrowser()
const { server, baseUrl } = await startMockViteServer()

try {
  // 1. 8-viewport responsive & spatial rendering verification on /admin/overview
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      hasTouch: vp.touch,
    })
    await context.addInitScript(() => {
      localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 3, theme: "light" }))
    })
    const page = await context.newPage()
    const { errors, mutationRequests } = await attachCollectors(page, baseUrl)

    await page.goto(`${baseUrl}/admin/overview`, { waitUntil: "networkidle" })
    await page.getByTestId("shift-overview-page").waitFor({ state: "visible" })
    await page.waitForTimeout(350)

    const snapshot = await page.evaluate(() => {
      const docOverflowX = Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)
      const main = document.querySelector('[data-testid="admin-main-content"]')
      const mainOverflowX = main ? Math.max(0, main.scrollWidth - main.clientWidth) : 0
      const floorSection = document.querySelector('[data-testid="shift-overview-floor"]')
      const stage = document.querySelector('[data-testid="shift-overview-floor-stage"]')
      const alerts = document.querySelector('[data-testid="shift-overview-alerts"]')
      const occupancy = document.querySelector('[data-testid="shift-overview-occupancy"]')
      const trigger = document.querySelector('[data-testid="so-legend-trigger"]')
      const kpiCards = document.querySelectorAll(".so-kpi-card")
      const svg = stage?.querySelector('svg[role="group"]')
      const wallPath = svg?.querySelector('path[d*="M80 704"]')
      const wallRect = wallPath?.getBoundingClientRect()
      const barSeats = Array.from(svg?.querySelectorAll("g") ?? []).filter((g) =>
        (g.getAttribute("aria-label") ?? "").startsWith("Ghế Bar "),
      )

      const box = (el) => {
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
      }

      const stageText = stage ? (stage.textContent ?? "") : ""
      const stageAria = Array.from(stage?.querySelectorAll("[aria-label]") ?? [])
        .map((el) => el.getAttribute("aria-label") ?? "")
        .join(" | ")

      return {
        docOverflowX,
        mainOverflowX,
        hasChipGrid: Boolean(document.querySelector(".so-chip-grid")),
        hasZonesList: Boolean(document.querySelector(".so-zones-list")),
        hasPermanentLegend: Boolean(document.querySelector(".so-legend")),
        hasBellInsideFloor: Boolean(floorSection?.querySelector("svg.lucide-bell")),
        kpiCount: kpiCards.length,
        floorRect: box(floorSection),
        alertsRect: box(alerts),
        occupancyRect: box(occupancy),
        stageRect: box(stage),
        wallRect: wallRect
          ? {
              left: wallRect.left,
              top: wallRect.top,
              right: wallRect.right,
              bottom: wallRect.bottom,
              width: wallRect.width,
              height: wallRect.height,
            }
          : null,
        triggerRect: box(trigger),
        triggerLabel: trigger?.getAttribute("aria-label"),
        svgButtonRoles: svg?.querySelectorAll('[role="button"]').length ?? 0,
        stageHtmlButtons: stage?.querySelectorAll("button").length ?? 0,
        clusterOutlines: svg?.querySelectorAll('[data-cluster-outline="1"]').length ?? 0,
        clusterCodes: svg?.querySelectorAll('[data-cluster-code="1"]').length ?? 0,
        barSeatCount: barSeats.length,
        hasKhuC: stageText.includes("Khu C"),
        hasKhuB: stageText.includes("Khu B"),
        hasKhuA: stageText.includes("Khu A"),
        hasQuayBar: stageText.includes("QUẦY BAR"),
        hasLoiVao: stageText.includes("LỐI VÀO"),
        hasA10: stageText.includes("A10"),
        hasSpareWord: stageText.includes("sơ cua"),
        hasBarGuestList: Boolean(stage?.querySelector('[data-testid="bar-guest-list"]')),
        showsCustomerNames:
          /Phạm Quốc/.test(stageText) && stageText.includes("Dương Quốc Long") && stageAria.includes("Phạm Quốc Khoa"),
        leaksRawPhones:
          /09\d{7,}|08\d{7,}|03\d{7,}|\+84\d{7,}/.test(stageText) ||
          /09\d{7,}|08\d{7,}|03\d{7,}|\+84\d{7,}/.test(stageAria),
      }
    })

    assert.equal(snapshot.docOverflowX, 0, `${vp.label}: document horizontal overflow ${snapshot.docOverflowX}`)
    assert.equal(snapshot.mainOverflowX, 0, `${vp.label}: main horizontal overflow ${snapshot.mainOverflowX}`)
    assert.equal(snapshot.hasChipGrid, false, `${vp.label}: .so-chip-grid must not exist`)
    assert.equal(snapshot.hasZonesList, false, `${vp.label}: .so-zones-list must not exist`)
    assert.equal(snapshot.hasPermanentLegend, false, `${vp.label}: permanent .so-legend must not exist`)
    assert.equal(snapshot.hasBellInsideFloor, false, `${vp.label}: bell icon must not appear in floor header`)
    assert.equal(snapshot.kpiCount, 10, `${vp.label}: expected 6 primary + 4 classification KPI cards`)

    assert(snapshot.floorRect && snapshot.alertsRect && snapshot.occupancyRect, `${vp.label}: main panels missing`)
    assert.equal(
      rectsOverlap(snapshot.floorRect, snapshot.alertsRect),
      false,
      `${vp.label}: floor panel overlaps alerts`,
    )
    assert.equal(
      rectsOverlap(snapshot.floorRect, snapshot.occupancyRect),
      false,
      `${vp.label}: floor panel overlaps occupancy`,
    )

    assert(snapshot.triggerRect, `${vp.label}: '!' legend trigger missing`)
    assert(
      snapshot.triggerRect.width >= 44 && snapshot.triggerRect.height >= 44,
      `${vp.label}: '!' trigger hit target below 44x44 (${snapshot.triggerRect.width}x${snapshot.triggerRect.height})`,
    )
    assert.equal(snapshot.triggerLabel, "Chú giải ký hiệu")

    assert(snapshot.stageRect && snapshot.wallRect, `${vp.label}: SVG stage or outer wall missing`)
    assert(
      snapshot.wallRect.left >= snapshot.stageRect.left - 1 &&
        snapshot.wallRect.right <= snapshot.stageRect.right + 1 &&
        snapshot.wallRect.top >= snapshot.stageRect.top - 1 &&
        snapshot.wallRect.bottom <= snapshot.stageRect.bottom + 1,
      `${vp.label}: floor wall cropped outside stage`,
    )
    const wallAspect = snapshot.wallRect.width / snapshot.wallRect.height
    assert(
      Math.abs(wallAspect - 370 / 702) < 0.03,
      `${vp.label}: floor aspect ratio distorted (${wallAspect.toFixed(3)} vs ${(370 / 702).toFixed(3)})`,
    )

    assert.equal(snapshot.svgButtonRoles, 0, `${vp.label}: read-only SVG must not expose role="button"`)
    assert.equal(snapshot.stageHtmlButtons, 0, `${vp.label}: read-only stage must not render <button>`)
    assert.equal(snapshot.barSeatCount, 21, `${vp.label}: expected 21 bar seats, got ${snapshot.barSeatCount}`)
    assert(snapshot.clusterOutlines > 0 && snapshot.clusterCodes > 0, `${vp.label}: expected group outlines and codes`)
    assert(
      snapshot.hasKhuC &&
        snapshot.hasKhuB &&
        snapshot.hasKhuA &&
        snapshot.hasQuayBar &&
        snapshot.hasLoiVao &&
        snapshot.hasA10 &&
        snapshot.hasSpareWord &&
        snapshot.hasBarGuestList,
      `${vp.label}: missing required spatial features`,
    )
    assert(snapshot.showsCustomerNames, `${vp.label}: expected guest names when customer.view_masked is granted`)
    assert.equal(snapshot.leaksRawPhones, false, `${vp.label}: raw phone leaked into read-only floor map`)
    assert.deepEqual(mutationRequests, [], `${vp.label}: unexpected mutation request`)
    assert.deepEqual(errors, [], `${vp.label}: console/page errors: ${errors.join(" | ")}`)

    await page.screenshot({ path: path.join(evidenceRoot, `admin-${vp.label}.png`) })
    const floorEl = page.getByTestId("shift-overview-floor")
    await floorEl.scrollIntoViewIfNeeded()
    await page.waitForTimeout(150)
    await floorEl.screenshot({ path: path.join(evidenceRoot, `admin-floor-${vp.label}.png`) })
    await context.close()
  }

  // 2. Read-only interaction & no-mutation verification + Desktop Popover & Phone Sheet Legend
  for (const mode of [
    { width: 1440, height: 900, label: "desktop", touch: false },
    { width: 390, height: 844, label: "phone", touch: true },
  ]) {
    const context = await browser.newContext({
      viewport: { width: mode.width, height: mode.height },
      hasTouch: mode.touch,
    })
    await context.addInitScript(() => {
      localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 3, theme: "light" }))
    })
    const page = await context.newPage()
    const { errors, mutationRequests } = await attachCollectors(page, baseUrl)
    await page.goto(`${baseUrl}/admin/overview`, { waitUntil: "networkidle" })
    await page.getByTestId("shift-overview-page").waitFor({ state: "visible" })
    await installApiMutationSpy(page)

    const stage = page.getByTestId("shift-overview-floor-stage")
    await stage.scrollIntoViewIfNeeded()

    // Click/tap/keyboard on tables, bar seats, group area, bar guest list, and empty canvas
    const targets = [
      stage.locator('g[aria-label^="Bàn A6"]').first(),
      stage.locator('g[aria-label^="Bàn B3"]').first(),
      stage.locator('g[aria-label^="Bàn C4"]').first(),
      stage.locator('g[aria-label^="Bàn A10"]').first(),
      stage.locator('g[aria-label^="Ghế Bar 1,"]').first(),
      stage.locator('g[aria-label^="Ghế Bar 15,"]').first(),
      stage.locator('[data-testid="bar-guest-list"]').first(),
      stage.locator('rect[data-bg="1"]').first(),
    ]
    for (const target of targets) {
      if (mode.touch) {
        await target.tap({ force: true })
      } else {
        await target.click({ force: true })
      }
      await page.waitForTimeout(40)
    }

    // Keyboard Enter & Space on focused table and bar seat
    const tableA6 = stage.locator('g[aria-label^="Bàn A6"]').first()
    await tableA6.focus()
    await page.keyboard.press("Enter")
    await page.keyboard.press("Space")
    const seat1 = stage.locator('g[aria-label^="Ghế Bar 1,"]').first()
    await seat1.focus()
    await page.keyboard.press("Enter")
    await page.keyboard.press("Space")

    assert.equal(await page.locator('[role="dialog"]').count(), 0, `${mode.label}: clicking floor opened a dialog`)
    const apiMutations = await page.evaluate(() => window.__adminFloorMutations)
    assert.deepEqual(apiMutations, [], `${mode.label}: read-only floor triggered API mutations: ${apiMutations}`)
    assert.deepEqual(mutationRequests, [], `${mode.label}: unexpected HTTP mutation requests`)

    // Open "!" legend popup via mouse/touch
    const trigger = page.getByTestId("so-legend-trigger")
    await trigger.scrollIntoViewIfNeeded()
    if (mode.touch) {
      await trigger.tap()
    } else {
      await trigger.click()
    }
    const dialog = page.getByTestId("so-legend-dialog")
    await dialog.waitFor({ state: "visible" })
    await page.waitForTimeout(380)

    const popupChecks = await page.evaluate(() => {
      const dlg = document.querySelector('[data-testid="so-legend-dialog"]')
      const r = dlg?.getBoundingClientRect()
      const text = dlg ? (dlg.textContent ?? "") : ""
      return {
        insideViewport: Boolean(
          r && r.left >= -1 && r.top >= -1 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1,
        ),
        overflowX: dlg ? Math.max(0, dlg.scrollWidth - dlg.clientWidth) : 999,
        hasTitle: text.includes("Chú giải ký hiệu"),
        hasStates:
          text.includes("Màu ô bàn") &&
          text.includes("Trống") &&
          text.includes("Đã đặt") &&
          text.includes("Sắp tới") &&
          text.includes("Tới muộn") &&
          text.includes("Đã tới") &&
          text.includes("Sơ cua"),
        hasTileAnatomy:
          text.includes("Thông tin trong 1 ô bàn") && text.includes("Số khách") && text.includes("Số lượt khách"),
        hasGuestIcons: text.includes("Đã từng đặt bàn") && text.includes("Chưa từng đặt bàn"),
        hasTableTypes: text.includes("Bàn sếp / VIP") && text.includes("Sinh nhật") && text.includes("Chỉ định"),
        hasGroupSection: text.includes("Nhóm bàn ghép") && text.includes("G01 / G02"),
        hasBarSection: text.includes("Khu quầy bar") && text.includes("Bar5-6"),
        hasSpareSection: text.includes("Bàn sơ cua") && text.includes("A10"),
      }
    })
    assert(popupChecks.insideViewport, `${mode.label}: legend popup exceeded viewport`)
    assert.equal(popupChecks.overflowX, 0, `${mode.label}: legend popup horizontal overflow`)
    assert(
      popupChecks.hasTitle &&
        popupChecks.hasStates &&
        popupChecks.hasTileAnatomy &&
        popupChecks.hasGuestIcons &&
        popupChecks.hasTableTypes &&
        popupChecks.hasGroupSection &&
        popupChecks.hasBarSection &&
        popupChecks.hasSpareSection,
      `${mode.label}: legend popup missing expected sections: ${JSON.stringify(popupChecks)}`,
    )

    await page.screenshot({ path: path.join(evidenceRoot, `legend-${mode.label}.png`) })

    // Close with Escape and verify focus return
    await page.keyboard.press("Escape")
    await dialog.waitFor({ state: "detached" })
    const focusAfterEsc = await page.evaluate(
      () => document.activeElement?.getAttribute("data-testid") === "so-legend-trigger",
    )
    assert(focusAfterEsc, `${mode.label}: focus did not return to '!' trigger after Escape`)

    // Reopen via keyboard Enter, then close via Close button and verify focus return
    await page.keyboard.press("Enter")
    await dialog.waitFor({ state: "visible" })
    await page.waitForTimeout(350)
    await dialog.getByRole("button", { name: "Đóng bảng chú giải" }).click()
    await dialog.waitFor({ state: "detached" })
    const focusAfterCloseBtn = await page.evaluate(
      () => document.activeElement?.getAttribute("data-testid") === "so-legend-trigger",
    )
    assert(focusAfterCloseBtn, `${mode.label}: focus did not return to '!' trigger after close button`)

    // Reopen via Space, then close via outside click
    await page.keyboard.press("Space")
    await dialog.waitFor({ state: "visible" })
    await page.waitForTimeout(350)
    await page.mouse.click(8, 8)
    await dialog.waitFor({ state: "detached" })

    assert.deepEqual(errors, [], `${mode.label}: console/page errors: ${errors.join(" | ")}`)
    await context.close()
  }

  // 3. Permission gate check: revoking customer.view_masked omits guest names across tiles, BarGuestList & ARIA
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await context.addInitScript(() => {
      localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 3, theme: "light" }))
    })
    const page = await context.newPage()
    const { errors } = await attachCollectors(page, baseUrl)
    await page.goto(`${baseUrl}/admin/overview`, { waitUntil: "networkidle" })
    await page.getByTestId("shift-overview-page").waitFor({ state: "visible" })

    await page.evaluate(async () => {
      const { useSession } = await import("/src/state/session.ts")
      useSession.setState({
        principal: {
          id: 99,
          username: "admin_no_customer_mask",
          displayName: "Admin Không Xem Khách",
          organizationId: 1,
          venueId: 1,
          roles: ["ADMIN"],
          accessLevel: "READ_ONLY",
        },
        permissions: ["report.read"],
      })
    })
    await page.waitForTimeout(150)

    const redacted = await page.evaluate(() => {
      const stage = document.querySelector('[data-testid="shift-overview-floor-stage"]')
      const stageText = stage ? (stage.textContent ?? "") : ""
      const stageAria = Array.from(stage?.querySelectorAll("[aria-label]") ?? [])
        .map((el) => el.getAttribute("aria-label") ?? "")
        .join(" | ")
      return {
        stageText,
        stageAria,
        hasGroupCode: stageText.includes("G01"),
        hasBarGuestList: Boolean(stage?.querySelector('[data-testid="bar-guest-list"]')),
        leaksCustomerNames:
          /Phạm Quốc|Dương Quốc Long|Mai Minh Thịnh|Châu Hoàng|Bùi Khánh/.test(stageText) ||
          /Phạm Quốc Khoa|Dương Quốc Long|Mai Minh Thịnh|Châu Hoàng|Bùi Khánh/.test(stageAria),
        fakesWalkIn: stageText.includes("Khách Walk-in") || stageAria.includes("Khách Walk-in"),
      }
    })
    assert(redacted.hasGroupCode && redacted.hasBarGuestList, "Redacted floor lost operational structure")
    assert.equal(redacted.leaksCustomerNames, false, "Guest names leaked when customer.view_masked was absent")
    assert.equal(redacted.fakesWalkIn, false, "Named bookings must not turn into 'Khách Walk-in' when redacted")
    assert.deepEqual(errors, [], `permission-gate errors: ${errors.join(" | ")}`)
    await context.close()
  }

  // 4. Reduced motion smoke check for legend popup
  {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      reducedMotion: "reduce",
    })
    await context.addInitScript(() => {
      localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 3, theme: "light" }))
    })
    const page = await context.newPage()
    const { errors } = await attachCollectors(page, baseUrl)
    await page.goto(`${baseUrl}/admin/overview`, { waitUntil: "networkidle" })
    await page.getByTestId("so-legend-trigger").tap()
    const dialog = page.getByTestId("so-legend-dialog")
    await dialog.waitFor({ state: "visible" })
    await dialog.getByRole("button", { name: "Đã hiểu" }).click()
    await dialog.waitFor({ state: "detached" })
    assert.deepEqual(errors, [], `reduced-motion errors: ${errors.join(" | ")}`)
    await context.close()
  }

  // 4. Reception floor & reception legend unchanged check
  for (const vp of [
    { width: 1440, height: 900, label: "desktop", touch: false },
    { width: 390, height: 844, label: "phone", touch: true },
  ]) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      hasTouch: vp.touch,
    })
    await context.addInitScript(() => {
      localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 1, theme: "light" }))
    })
    const page = await context.newPage()
    const { errors } = await attachCollectors(page, baseUrl)
    await page.goto(`${baseUrl}/floor`, { waitUntil: "networkidle" })
    await page.waitForTimeout(450)
    await dismissReceptionAlerts(page)
    await page.screenshot({ path: path.join(evidenceRoot, `reception-floor-${vp.label}.png`) })

    await page
      .getByRole("button", { name: /Ký hiệu:/ })
      .first()
      .click()
    await page.getByRole("dialog", { name: "Chú giải ký hiệu" }).waitFor({ state: "visible" })
    await page.waitForTimeout(250)
    await page.screenshot({ path: path.join(evidenceRoot, `reception-legend-${vp.label}.png`) })
    assert.deepEqual(errors, [], `reception-${vp.label} errors: ${errors.join(" | ")}`)
    await context.close()
  }

  console.log("admin-floor-map E2E verification PASSED")
} finally {
  await browser.close()
  await server.close()
}

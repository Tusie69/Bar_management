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
import { randomUUID } from "node:crypto"
import fs from "node:fs"
import net from "node:net"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "@playwright/test"
import { createServer } from "vite"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(__dirname, "..")
const evidenceRoot =
  process.env.ADMIN_FLOOR_EVIDENCE_DIR || path.join(__dirname, ".artifacts", `admin-floor-map-${randomUUID()}`)
fs.mkdirSync(evidenceRoot, { recursive: true })

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on("error", reject)
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address()
      const port = typeof addr === "object" && addr ? addr.port : 5215
      srv.close(() => resolve(port))
    })
  })
}

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

async function startViteServer({ port, apiMode = "mock", apiBaseUrl = "" }) {
  const prevMode = process.env.VITE_API_MODE
  const prevBase = process.env.VITE_API_BASE_URL
  const prevVenue = process.env.VITE_VENUE_ID
  process.env.VITE_API_MODE = apiMode
  process.env.VITE_API_BASE_URL = apiBaseUrl
  process.env.VITE_VENUE_ID = "1"
  const server = await createServer({
    root: webRoot,
    configFile: path.join(webRoot, "vite.config.ts"),
    server: { port, host: "127.0.0.1", strictPort: true, open: false },
  })
  await server.listen()
  const addr = server.httpServer?.address()
  assert(addr && typeof addr === "object", "Vite server failed to bind a TCP port")
  const restoreEnv = () => {
    if (prevMode === undefined) delete process.env.VITE_API_MODE
    else process.env.VITE_API_MODE = prevMode
    if (prevBase === undefined) delete process.env.VITE_API_BASE_URL
    else process.env.VITE_API_BASE_URL = prevBase
    if (prevVenue === undefined) delete process.env.VITE_VENUE_ID
    else process.env.VITE_VENUE_ID = prevVenue
  }
  return {
    server,
    baseUrl: `http://127.0.0.1:${addr.port}`,
    close: async () => {
      try {
        await server.close()
      } finally {
        restoreEnv()
      }
    },
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

const WRITE_METHODS = [
  "updateReceptionGuestCount",
  "createReservation",
  "updateReservation",
  "assignTables",
  "cancelReservation",
  "markNoShow",
  "confirmLate",
  "startCall",
  "recordCallOutcome",
  "checkIn",
  "seatWalkIn",
  "moveClaim",
  "combineTables",
  "createTableGroup",
  "addTableGroupMembers",
  "splitGroup",
  "dissolveTableGroup",
  "endVisit",
  "markPaid",
  "setTableStatus",
  "addWaitlist",
  "claimWaitlist",
  "releaseClaim",
  "recordContact",
  "seatWaitlist",
  "cancelWaitlist",
  "setHoldDeadline",
  "releaseHold",
  "revealPhone",
  "updateCustomerNotes",
  "undo",
  "redo",
  "updateVenueConfig",
  "updateVenueSettings",
  "setZoneFlags",
]

async function installApiMutationSpy(page) {
  const installed = await page.evaluate(async (methods) => {
    const { api } = await import("/src/services/index.ts")
    const missing = methods.filter((m) => typeof api[m] !== "function")
    if (missing.length > 0) {
      return { ok: false, missing }
    }
    window.__adminFloorMutations = []
    for (const method of methods) {
      api[method] = async () => {
        window.__adminFloorMutations.push(method)
        throw new Error(`Read-only admin floor test blocked write method: ${method}`)
      }
    }
    return { ok: true, count: methods.length }
  }, WRITE_METHODS)
  assert(installed.ok, `Missing GamApi write methods in spy: ${JSON.stringify(installed.missing)}`)
}

async function verifyMutationSpyTrap(page) {
  const probe = await page.evaluate(async () => {
    const { api } = await import("/src/services/index.ts")
    const probed = [
      "checkIn",
      "moveClaim",
      "splitGroup",
      "setTableStatus",
      "revealPhone",
      "addTableGroupMembers",
      "dissolveTableGroup",
    ]
    const caught = []
    for (const m of probed) {
      try {
        await api[m]({})
      } catch (err) {
        caught.push({ method: m, msg: String(err?.message ?? err) })
      }
    }
    const recorded = [...window.__adminFloorMutations]
    window.__adminFloorMutations = []
    return { probed, caught, recorded }
  })
  assert.equal(
    probe.caught.length,
    probe.probed.length,
    `Spy trap did not throw for all probed methods: ${JSON.stringify(probe)}`,
  )
  assert.deepEqual(probe.recorded, probe.probed, `Spy trap did not record all probed methods`)
}

async function snapshotUiStore(page) {
  return page.evaluate(async () => {
    const { useUi } = await import("/src/state/ui.ts")
    const s = useUi.getState()
    return {
      zone: s.zone,
      zoneRefitTick: s.zoneRefitTick,
      selectedTableId: s.selectedTableId,
      pick: s.pick ? { partySize: s.pick.partySize } : null,
      pickSelection: [...(s.pickSelection ?? [])],
      confirmRequest: Boolean(s.confirmRequest),
      conflictRequest: Boolean(s.conflictRequest),
    }
  })
}

/**
 * Polls until the legend dialog/sheet is mounted, visible, done animating
 * (transform settled, willChange reset to auto, Web Animations finished),
 * and reports the same in-viewport bounding box across two consecutive samples.
 */
async function waitForSettledDialog(page, testId, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  let prev = null
  while (Date.now() < deadline) {
    const sample = await page.evaluate((id) => {
      const el = document.querySelector(`[data-testid="${id}"]`)
      if (!el) return null
      if (el.getAttribute("data-motion-state") === "closing") return null
      const cs = getComputedStyle(el)
      if (Number(cs.opacity) < 0.99 || cs.visibility !== "visible") return null
      if (cs.transform !== "none" && cs.transform !== "matrix(1, 0, 0, 1, 0, 0)") return null
      if (cs.willChange && cs.willChange !== "auto") return null
      const runningAnims = el.getAnimations({ subtree: true }).some((a) => a.playState === "running")
      if (runningAnims) return null
      const r = el.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0) return null
      const inside =
        r.left >= -1 && r.top >= -1 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1
      if (!inside) return null
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
    }, testId)

    if (
      sample &&
      prev &&
      Math.abs(sample.left - prev.left) < 0.15 &&
      Math.abs(sample.top - prev.top) < 0.15 &&
      Math.abs(sample.right - prev.right) < 0.15 &&
      Math.abs(sample.bottom - prev.bottom) < 0.15
    ) {
      return sample
    }
    prev = sample
    await page.waitForTimeout(40)
  }
  throw new Error(`Timed out waiting for settled dialog [data-testid="${testId}"] within ${timeoutMs}ms`)
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
const mockVite = process.env.E2E_BASE_URL
  ? { baseUrl: process.env.E2E_BASE_URL, close: async () => {} }
  : await startViteServer({ port: Number(process.env.PW_PORT || 5207) })
let httpVite = null

try {
  const baseUrl = mockVite.baseUrl
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
    const uiBefore = await snapshotUiStore(page)

    const stage = page.getByTestId("shift-overview-floor-stage")
    await stage.scrollIntoViewIfNeeded()

    // Click/tap/dblclick/contextmenu/long-press/drag/keyboard on tables, bar seats, group area, bar guest list, and empty canvas
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
        await target.dblclick({ force: true })
        await target.click({ button: "right", force: true })
      }
      await page.waitForTimeout(30)
    }

    // Long press & drag gesture across table A6 and BarGuestList
    const a6Box = await stage.locator('g[aria-label^="Bàn A6"]').first().boundingBox()
    if (a6Box) {
      const cx = a6Box.x + a6Box.width / 2
      const cy = a6Box.y + a6Box.height / 2
      await page.mouse.move(cx, cy)
      await page.mouse.down()
      await page.waitForTimeout(520)
      await page.mouse.move(cx + 24, cy + 16, { steps: 4 })
      await page.mouse.up()
    }

    // Keyboard Enter, Space, and Undo/Redo shortcuts on focused table and bar seat
    const tableA6 = stage.locator('g[aria-label^="Bàn A6"]').first()
    await tableA6.focus()
    await page.keyboard.press("Enter")
    await page.keyboard.press("Space")
    await page.keyboard.press("Control+z")
    await page.keyboard.press("Control+Shift+z")
    await page.keyboard.press("Control+y")
    const seat1 = stage.locator('g[aria-label^="Ghế Bar 1,"]').first()
    await seat1.focus()
    await page.keyboard.press("Enter")
    await page.keyboard.press("Space")

    assert.equal(await page.locator('[role="dialog"]').count(), 0, `${mode.label}: clicking floor opened a dialog`)
    const apiMutations = await page.evaluate(() => window.__adminFloorMutations)
    assert.deepEqual(apiMutations, [], `${mode.label}: read-only floor triggered API mutations: ${apiMutations}`)
    assert.deepEqual(mutationRequests, [], `${mode.label}: unexpected HTTP mutation requests`)
    const uiAfter = await snapshotUiStore(page)
    assert.deepEqual(uiAfter, uiBefore, `${mode.label}: read-only interactions mutated useUi store`)
    await verifyMutationSpyTrap(page)

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
    const settledDebug = await waitForSettledDialog(page, "so-legend-dialog")

    const popupChecks = await page.evaluate(() => {
      const dlg = document.querySelector('[data-testid="so-legend-dialog"]')
      const r = dlg?.getBoundingClientRect()
      const text = dlg ? (dlg.textContent ?? "") : ""
      return {
        rect: r
          ? {
              left: r.left,
              top: r.top,
              right: r.right,
              bottom: r.bottom,
              vw: window.innerWidth,
              vh: window.innerHeight,
              transform: getComputedStyle(dlg).transform,
              opacity: getComputedStyle(dlg).opacity,
            }
          : null,
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
          text.includes("Sơ cua") &&
          text.includes("Ngưng phục vụ"),
        hasTileAnatomy:
          text.includes("Thông tin trong 1 ô bàn") && text.includes("Số khách") && text.includes("Số lượt khách"),
        hasGuestIcons: text.includes("Đã từng đặt bàn") && text.includes("Chưa từng đặt bàn"),
        hasTableTypes: text.includes("Bàn sếp / VIP") && text.includes("Sinh nhật") && text.includes("Chỉ định"),
        hasGroupSection: text.includes("Nhóm bàn ghép") && text.includes("G01 / G02"),
        hasBarSection: text.includes("Khu quầy bar") && text.includes("Bar5-6"),
        hasSpareSection: text.includes("Bàn sơ cua") && text.includes("A10"),
      }
    })
    assert(
      popupChecks.insideViewport,
      `${mode.label}: legend popup exceeded viewport: ${JSON.stringify(popupChecks.rect)} (settled=${JSON.stringify(settledDebug)})`,
    )
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
    await waitForSettledDialog(page, "so-legend-dialog")
    await dialog.getByRole("button", { name: "Đóng bảng chú giải" }).click()
    await dialog.waitFor({ state: "detached" })
    const focusAfterCloseBtn = await page.evaluate(
      () => document.activeElement?.getAttribute("data-testid") === "so-legend-trigger",
    )
    assert(focusAfterCloseBtn, `${mode.label}: focus did not return to '!' trigger after close button`)

    // Reopen via Space, then close via outside click
    await page.keyboard.press("Space")
    await dialog.waitFor({ state: "visible" })
    await waitForSettledDialog(page, "so-legend-dialog")
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
    const reducedMotionImmediate = await page.evaluate(() => {
      const dlg = document.querySelector('[data-testid="so-legend-dialog"]')
      if (!dlg) return null
      const cs = getComputedStyle(dlg)
      const r = dlg.getBoundingClientRect()
      return {
        transform: cs.transform,
        insideViewport:
          r.left >= -1 && r.top >= -1 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1,
      }
    })
    assert(
      reducedMotionImmediate &&
        (reducedMotionImmediate.transform === "none" ||
          reducedMotionImmediate.transform === "matrix(1, 0, 0, 1, 0, 0)"),
      `Reduced motion sheet should have no slide transform: ${JSON.stringify(reducedMotionImmediate)}`,
    )
    assert(reducedMotionImmediate.insideViewport, "Reduced motion sheet exceeded viewport")
    await waitForSettledDialog(page, "so-legend-dialog")
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

  // 5. Real HTTP-adapter network interception suite (ADM-01 OOS counts, ADM-02 phone-shaped names, ADM-04 zero HTTP writes)
  await mockVite.close()
  const httpPort = await findFreePort()
  httpVite = await startViteServer({ port: httpPort, apiMode: "http", apiBaseUrl: "/api/v1" })
  const httpBaseUrl = httpVite.baseUrl

  let activePhoneOverrides = null
  const buildHttpTablesPayload = (dateParam, todayIso, overrides) => {
    const startsAt = `${todayIso}T13:15:00.000Z`
    const makeClaim = (tableId, guestName, kind = "VISIT") => ({
      kind,
      reservationId: kind === "RESERVATION" ? 900 + tableId : null,
      visitId: kind === "VISIT" ? 800 + tableId : null,
      waitlistEntryId: null,
      holdId: null,
      guestName,
      phoneLast3: "567",
      partySize: 2,
      turnNo: tableId === 5 ? 2 : 1,
      flags: [],
      groupId: null,
      groupDisplayCode: null,
      groupMemberTableIds: [tableId],
      startsAt,
      deadlineAt: null,
      holdOverdue: false,
      paid: false,
      origin: "RESERVATION",
      sourceCode: "HOTLINE",
      version: 1,
    })
    // Table IDs from rawTables order above:
    // 1:A7, 2:A6, 3:A5, 4:A4, 5:A3, 6:A2(OOS), 7:A1(EMPTY), 8:A0(spare), 9:A10(spare)
    // 24:BAR01, 25:BAR02
    const special = new Map([
      [2, { displayState: "IN_USE", claim: makeClaim(2, overrides?.a6 ?? "Phạm Quốc Khoa") }],
      [3, { displayState: "IN_USE", claim: makeClaim(3, overrides?.a5 ?? "Khách 090/123\\4567") }],
      [
        4,
        { displayState: "BOOKED", claim: makeClaim(4, overrides?.a4 ?? "Vy ๐๙๑\u2212２３４\u2212٥٦٧٨", "RESERVATION") },
      ],
      [5, { displayState: "IN_USE", claim: makeClaim(5, overrides?.a3 ?? "Mai ０９０\u2E31١٢٣\u2E314567") }],
      [6, { displayState: "OUT_OF_SERVICE", isOutOfService: true, claim: null }],
      [24, { displayState: "IN_USE", claim: makeClaim(24, overrides?.bar1 ?? "0912\u00B7345\u00B7678") }],
      [25, { displayState: "IN_USE", claim: makeClaim(25, overrides?.bar2 ?? "Dương Quốc Long") }],
    ])
    const codes = [
      "A7",
      "A6",
      "A5",
      "A4",
      "A3",
      "A2",
      "A1",
      "A0",
      "A10",
      "B7",
      "B8",
      "B6",
      "B5",
      "B3",
      "B4",
      "B21",
      "B22",
      "B11",
      "B12",
      "C4",
      "C5",
      "C1",
      "C2",
      ...Array.from({ length: 21 }, (_, idx) => `BAR${String(idx + 1).padStart(2, "0")}`),
    ]
    return {
      businessDate: dateParam || todayIso,
      serverNow: new Date().toISOString(),
      changeSeq: "10",
      groups: [],
      tables: codes.map((code, idx) => {
        const id = idx + 1
        const sp = special.get(id)
        const isSpare = code === "A0" || code === "A10" || code === "B8"
        return {
          tableId: id,
          seatedTurnCount: id === 5 ? 2 : 0,
          isOutOfService: sp?.isOutOfService ?? false,
          tableCode: code,
          catalogStatus: sp?.isOutOfService ? "OUT_OF_SERVICE" : "ACTIVE",
          isSpare,
          displayState: sp?.displayState ?? "EMPTY",
          arrivalPhase: null,
          arrivalTime: null,
          minutesLate: 0,
          claim: sp?.claim ?? null,
          groupId: null,
          groupDisplayCode: null,
          groupMemberTableIds: [],
          staleFromPreviousDay: false,
        }
      }),
    }
  }

  for (const scenario of [
    { name: "masked-only", permissions: ["report.read", "customer.view_masked"], expectNames: true },
    { name: "no-customer-mask", permissions: ["report.read"], expectNames: false },
  ]) {
    activePhoneOverrides = null
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await context.addInitScript(() => {
      window.EventSource = class extends EventTarget {
        closed = false
        constructor() {
          super()
        }
        close() {
          this.closed = true
        }
      }
    })
    const httpMutationRequests = []
    const unexpectedGets = []
    const todayIso = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" })

    await context.route("**/api/v1/**", async (route) => {
      const req = route.request()
      const method = req.method().toUpperCase()
      const url = new URL(req.url())
      const apiPath = url.pathname.replace(/^\/api\/v1/, "")

      if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
        httpMutationRequests.push(`${method} ${apiPath}`)
        await route.abort()
        return
      }

      if (/\/phone:reveal|\/call|\/availability|\/undo-state|\/search|\/bookings\/\d+/.test(apiPath)) {
        unexpectedGets.push(`${method} ${apiPath}`)
      }

      const json = (payload) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) })

      if (apiPath === "/auth/me") {
        await json({
          user: {
            id: 42,
            username: "admin_ro_http",
            displayName: "Admin Chỉ Xem",
            organizationId: 1,
            venueId: 1,
            roles: ["ADMIN"],
            accessLevel: "READ_ONLY",
          },
          permissions: scenario.permissions,
          csrfToken: "csrf-e2e-readonly",
          portal: "admin",
        })
        return
      }
      if (apiPath === "/settings") {
        await json({
          venueId: 1,
          venueName: "21GAM",
          timezone: "Asia/Ho_Chi_Minh",
          businessDayCutoffHour: 5,
          businessDayStartLocal: "17:00:00",
          businessDayCutoffLocal: "05:00:00",
          lateThresholdMinutes: 15,
          noShowThresholdMinutes: 30,
          waitlistHoldMinutes: 15,
        })
        return
      }
      if (apiPath === "/bookings/sources") {
        await json({ sources: [{ code: "HOTLINE", name: "Hotline" }] })
        return
      }
      if (apiPath === "/tables/catalog") {
        // Canonical coordinates matching venue-layout.ts (all 23 tables + 21 bar seats)
        const A = (code, y, isSpare = false) => ({
          code,
          zoneCode: "A",
          x: 44,
          y,
          width: 56,
          height: 34,
          isSpare,
          kind: "TABLE",
          seqNo: null,
        })
        const B = (code, x, y, isSpare = false) => ({
          code,
          zoneCode: "B",
          x,
          y,
          width: 46,
          height: 34,
          isSpare,
          kind: "TABLE",
          seqNo: null,
        })
        const C = (code, x, y) => ({
          code,
          zoneCode: "C",
          x,
          y,
          width: 40,
          height: 32,
          isSpare: false,
          kind: "TABLE",
          seqNo: null,
        })
        const rawTables = [
          A("A7", 319),
          A("A6", 363),
          A("A5", 407),
          A("A4", 451),
          A("A3", 495),
          A("A2", 539),
          A("A1", 583),
          A("A0", 627, true),
          {
            code: "A10",
            zoneCode: "A",
            x: 111,
            y: 627,
            width: 54,
            height: 34,
            isSpare: true,
            kind: "TABLE",
            seqNo: null,
          },
          B("B7", 63, 147),
          B("B8", 39, 187, true),
          B("B6", 89, 187),
          B("B5", 63, 227),
          B("B3", 163, 147),
          B("B4", 163, 203),
          B("B21", 257, 147),
          B("B22", 257, 189),
          B("B11", 257, 231),
          B("B12", 257, 273),
          C("C4", 176, 26),
          C("C5", 176, 64),
          C("C1", 220, 26),
          C("C2", 264, 26),
        ]
        const barYs = [662, 638, 614, 590, 566, 542, 518, 494, 470, 446, 422, 398, 374, 350]
        barYs.forEach((y, idx) =>
          rawTables.push({
            code: `BAR${String(idx + 1).padStart(2, "0")}`,
            zoneCode: "BAR",
            x: 156,
            y,
            width: 20,
            height: 20,
            isSpare: false,
            kind: "BAR_SEAT",
            seqNo: idx + 1,
          }),
        )
        const barXs = [180, 209, 239, 268, 297, 327, 356]
        barXs.forEach((x, idx) =>
          rawTables.push({
            code: `BAR${String(idx + 15).padStart(2, "0")}`,
            zoneCode: "BAR",
            x,
            y: 326,
            width: 20,
            height: 20,
            isSpare: false,
            kind: "BAR_SEAT",
            seqNo: idx + 15,
          }),
        )
        const zoneIds = { A: 1, B: 2, C: 3, BAR: 4 }
        await json({
          venue: {
            id: 1,
            name: "21GAM",
            timezone: "Asia/Ho_Chi_Minh",
            changeSeq: 10,
            businessDayStartLocal: "17:00:00",
            businessDayCutoffLocal: "05:00:00",
          },
          zones: [
            { id: 3, version: 1, code: "C", name: "Khu C", isBookable: true, isWaitingArea: false, displayOrder: 1 },
            { id: 2, version: 1, code: "B", name: "Khu B", isBookable: true, isWaitingArea: false, displayOrder: 2 },
            { id: 1, version: 1, code: "A", name: "Khu A", isBookable: true, isWaitingArea: false, displayOrder: 3 },
            {
              id: 4,
              version: 1,
              code: "BAR",
              name: "Quầy Bar",
              isBookable: true,
              isWaitingArea: false,
              displayOrder: 4,
            },
          ],
          tables: rawTables.map((t, i) => ({
            id: i + 1,
            version: 1,
            code: t.code,
            displayName: t.kind === "BAR_SEAT" ? `Ghế ${t.seqNo}` : `Bàn ${t.code}`,
            zoneId: zoneIds[t.zoneCode],
            zoneCode: t.zoneCode,
            kind: t.kind,
            capacity: t.kind === "BAR_SEAT" ? 1 : 4,
            seqNo: t.seqNo,
            isSpare: t.isSpare,
            status: t.code === "A2" ? "OUT_OF_SERVICE" : "ACTIVE",
            x: t.x,
            y: t.y,
            width: t.width,
            height: t.height,
          })),
          combinations: [],
        })
        return
      }
      if (apiPath === "/tables") {
        await json(buildHttpTablesPayload(url.searchParams.get("date"), todayIso, activePhoneOverrides))
        return
      }
      if (apiPath === "/reception/guest-counts") {
        await json({
          guestCount: {
            businessDate: url.searchParams.get("date") || todayIso,
            totalArrived: 10,
            barGuests: 2,
            walkInGuests: 0,
            vipGuests: 0,
            regularGuests: 0,
            newGuests: 0,
            updatedAt: new Date().toISOString(),
            version: 1,
          },
        })
        return
      }
      if (apiPath === "/bookings") {
        await json({ businessDate: url.searchParams.get("date") || todayIso, bookings: [] })
        return
      }
      if (apiPath === "/waitlist") {
        await json({ businessDate: url.searchParams.get("date") || todayIso, entries: [] })
        return
      }
      if (apiPath === "/tables/stream") {
        await route.fulfill({
          status: 200,
          contentType: "text/event-stream",
          body: "event: ping\ndata: {}\n\n",
        })
        return
      }
      unexpectedGets.push(`${method} ${apiPath}`)
      await route.abort()
    })

    const page = await context.newPage()
    const { errors } = await attachCollectors(page, httpBaseUrl)
    await page.goto(`${httpBaseUrl}/admin/overview`, { waitUntil: "networkidle" })
    await page.getByTestId("shift-overview-page").waitFor({ state: "visible" })
    await page.waitForTimeout(250)

    const assertRedactedAdminDom = async (label, expectedPositives) => {
      const surface = await page.evaluate(() => {
        const stage = document.querySelector('[data-testid="shift-overview-floor-stage"]')
        const stageText = stage ? (stage.textContent ?? "") : ""
        const stageSvgTitles = Array.from(stage?.querySelectorAll("title") ?? [])
          .map((t) => t.textContent ?? "")
          .join(" | ")
        const stageHtmlTitles = Array.from(stage?.querySelectorAll("[title]") ?? [])
          .map((el) => el.getAttribute("title") ?? "")
          .join(" | ")
        const stageAria = Array.from(stage?.querySelectorAll("[aria-label]") ?? [])
          .map((el) => el.getAttribute("aria-label") ?? "")
          .join(" | ")
        const a3 = stage?.querySelector('g[aria-label^="Bàn A3"]')
        const a3LabelText = a3?.querySelector("text")?.textContent ?? ""
        const a3Aria = a3?.getAttribute("aria-label") ?? ""
        const a3Title = a3?.querySelector("title")?.textContent ?? ""
        const a3Surface = a3 ? `${a3.textContent ?? ""} | ${a3Title} | ${a3Aria}` : ""

        const a6 = stage?.querySelector('g[aria-label^="Bàn A6"]')
        const a6LabelText = a6?.querySelector("text")?.textContent ?? ""
        const a6Aria = a6?.getAttribute("aria-label") ?? ""
        const a6Title = a6?.querySelector("title")?.textContent ?? ""

        const bar1Seat = stage?.querySelector('g[aria-label^="Ghế Bar 1,"]')
        const bar1SeatNumber = bar1Seat?.querySelector("text")?.textContent ?? ""
        const bar1SeatSubText = bar1Seat?.querySelectorAll("text")?.[1]?.textContent ?? ""
        const bar1SeatAria = bar1Seat?.getAttribute("aria-label") ?? ""
        const bar1SeatTitle = bar1Seat?.querySelector("title")?.textContent ?? ""

        const barPanel = stage?.querySelector('[data-testid="bar-guest-list"]')
        const barRows = Array.from(barPanel?.querySelectorAll('[role="listitem"]') ?? [])
        const barFirstRow = barRows[0]
        const barFirstRowAria = barFirstRow?.querySelector("[aria-label]")?.getAttribute("aria-label") ?? ""
        const barFirstRowTitle = barFirstRow?.querySelector("span[title]")?.getAttribute("title") ?? null
        const barFirstRowText = barFirstRow?.textContent ?? ""
        const barSecondRow = barRows[1]
        const barSecondRowAria = barSecondRow?.querySelector("[aria-label]")?.getAttribute("aria-label") ?? ""
        const barSecondRowTitle = barSecondRow?.querySelector("span[title]")?.getAttribute("title") ?? null
        const barSurface = barPanel
          ? `${barPanel.textContent ?? ""} | ${Array.from(barPanel.querySelectorAll("[title]"))
              .map((el) => el.getAttribute("title") ?? "")
              .join(" | ")} | ${Array.from(barPanel.querySelectorAll("[aria-label]"))
              .map((el) => el.getAttribute("aria-label") ?? "")
              .join(" | ")}`
          : ""
        const telLinks = stage?.querySelectorAll('a[href^="tel:"]').length ?? 0
        const combined = `${stageText} | ${stageSvgTitles} | ${stageHtmlTitles} | ${stageAria}`
        const phoneLeakRe =
          /090[\s\u00A0\u2009\u2010-\u2015\u2043\u2212\uFE58\uFE63\uFF0D.\u00B7\u2022\u2024\u2027\u30FB\uFF65\u2E31/\\()[\]{}]*123|0912[\u00B7.]*345|901\s*234\s*567|4567|٥٦٧٨|[０-９]{3,}|[٠-٩]{3,}|[๐-๙]{3,}|Mai\s*０９０|Vy\s*๐๙๑|A0B9C0D1E2F3G4H5I6/
        return {
          combined,
          stageText,
          a3Surface,
          a3LabelText,
          a3Aria,
          a3Title,
          a6LabelText,
          a6Aria,
          a6Title,
          bar1SeatNumber,
          bar1SeatSubText,
          bar1SeatAria,
          bar1SeatTitle,
          barSurface,
          barFirstRowAria,
          barFirstRowTitle,
          barFirstRowText,
          barSecondRowAria,
          barSecondRowTitle,
          telLinks,
          leaksPhone: phoneLeakRe.test(combined) || phoneLeakRe.test(a3Surface) || phoneLeakRe.test(barSurface),
          fakesWalkIn: stageText.includes("Khách Walk-in") || stageAria.includes("Khách Walk-in"),
        }
      })

      assert.equal(surface.telLinks, 0, `${label}: tel: links found`)
      assert.equal(
        surface.leaksPhone,
        false,
        `${label}: leaked phone-shaped name (a3=${surface.a3Surface}, bar=${surface.barSurface})`,
      )
      assert.equal(surface.a3LabelText, "A3", `${label}: unexpected A3 tile text: ${surface.a3LabelText}`)
      assert.equal(surface.a3Aria, "Bàn A3, Đã tới, 2 khách", `${label}: unexpected A3 aria-label: ${surface.a3Aria}`)
      assert.equal(surface.a3Title, "Bàn A3, Đã tới, 2 khách", `${label}: unexpected A3 <title>: ${surface.a3Title}`)
      assert.equal(surface.bar1SeatNumber, "1", `${label}: unexpected BAR01 seat number: ${surface.bar1SeatNumber}`)
      assert.match(
        surface.bar1SeatSubText,
        /^\d{2}:\d{2}$/,
        `${label}: BAR01 seat subtext should show time only, got: ${surface.bar1SeatSubText}`,
      )
      assert.equal(
        surface.bar1SeatAria,
        "Ghế Bar 1, Đã tới, 2 khách",
        `${label}: unexpected BAR01 aria-label: ${surface.bar1SeatAria}`,
      )
      assert.equal(
        surface.bar1SeatTitle,
        "Ghế Bar 1, Đã tới, 2 khách",
        `${label}: unexpected BAR01 <title>: ${surface.bar1SeatTitle}`,
      )
      assert.match(
        surface.barFirstRowAria,
        /^Bar1, vào lúc \d{2}:\d{2}, 2 khách, Trạng thái: Đã tới$/,
        `${label}: unexpected Bar1 redacted aria-label: ${surface.barFirstRowAria}`,
      )
      assert.equal(surface.barFirstRowTitle, null, `${label}: Bar1 guest title attribute must be omitted`)

      for (const expectedName of expectedPositives) {
        if (scenario.expectNames) {
          assert(surface.combined.includes(expectedName), `${label}: expected permitted name "${expectedName}"`)
        } else {
          assert.equal(
            surface.combined.includes(expectedName),
            false,
            `${label}: leaked "${expectedName}" without customer.view_masked`,
          )
        }
      }
      if (!scenario.expectNames) {
        assert.equal(surface.a6LabelText, "A6", `${label}: expected A6 tile redacted without customer.view_masked`)
        assert.equal(surface.a6Aria, "Bàn A6, Đã tới, 2 khách", `${label}: expected A6 ARIA redacted`)
        assert.equal(surface.a6Title, "Bàn A6, Đã tới, 2 khách", `${label}: expected A6 title redacted`)
        assert.equal(
          surface.barSecondRowTitle,
          null,
          `${label}: expected Bar2 title omitted without customer.view_masked`,
        )
        assert.equal(surface.fakesWalkIn, false, `${label}: faked Walk-in label when redacted`)
      }
      return surface
    }

    await assertRedactedAdminDom(`HTTP ${scenario.name}`, ["Phạm Quốc Khoa", "Dương Quốc Long"])

    // ADM-01 in HTTP mode: open "!" legend and verify OOS count = 1, spare = 3, seated = 5, reserved = 1, free = 34
    const httpTrigger = page.getByTestId("so-legend-trigger")
    await httpTrigger.click()
    const httpDialog = page.getByTestId("so-legend-dialog")
    await httpDialog.waitFor({ state: "visible" })
    await waitForSettledDialog(page, "so-legend-dialog")
    const legendText = await httpDialog.evaluate((el) => el.textContent ?? "")
    assert(
      legendText.includes("Ngưng phục vụ1"),
      `HTTP ${scenario.name}: expected Ngưng phục vụ count 1, got: ${legendText}`,
    )
    assert(legendText.includes("Sơ cua3"), `HTTP ${scenario.name}: expected Sơ cua count 3, got: ${legendText}`)
    assert(legendText.includes("Đã tới5"), `HTTP ${scenario.name}: expected Đã tới count 5, got: ${legendText}`)
    assert(legendText.includes("Đã đặt1"), `HTTP ${scenario.name}: expected Đã đặt count 1, got: ${legendText}`)
    assert(legendText.includes("Trống34"), `HTTP ${scenario.name}: expected Trống count 34, got: ${legendText}`)
    await page.keyboard.press("Escape")
    await httpDialog.waitFor({ state: "detached" })

    // ADM-04 HTTP gestures: click, dblclick, right-click, drag, keyboard -> zero mutations & zero unexpected GETs
    const httpStage = page.getByTestId("shift-overview-floor-stage")
    const a3 = httpStage.locator('g[aria-label^="Bàn A3"]').first()
    await a3.click({ force: true })
    await a3.dblclick({ force: true })
    await a3.click({ button: "right", force: true })
    await a3.focus()
    await page.keyboard.press("Enter")
    await page.keyboard.press("Space")
    await page.keyboard.press("Control+z")
    // ADM-02 round 4 browser matrix: dot look-alikes, dashes, NBSP/thin spaces, slashes, brackets, mixed letters+digits, and 1-8 digit negatives
    const adm02Matrix = [
      {
        label: "dots-bullet-leader-brackets-digits-1-8",
        overrides: {
          a3: "Khách 090\u2022123\u20244567",
          bar1: "Yến 090\u2027123\u30FB4567",
          a5: "Tuấn (090)[123]{4567}",
          a4: "Ngọc 090\u00A0123\u20094567",
          a6: "Bàn 12",
          bar2: "Nhóm 2024",
        },
        positives: ["Bàn 12", "Nhóm 2024"],
      },
      {
        label: "halfwidth-dot-mixed-alphanum-arabic-fw",
        overrides: {
          a3: "Linh 090\uFF65123\u00B74567",
          bar1: "A0B9C0D1E2F3G4H5I6",
          a5: "Mai ０９０\u2212١٢٣\u22124567",
          a4: "Bảo （０９０）／１２３／４５６７",
          a6: "Phạm Quốc Khoa",
          bar2: "Nguyễn 18-11-2026",
        },
        positives: ["Phạm Quốc Khoa", "Nguyễn 18-11-2026"],
      },
    ]
    for (const batch of adm02Matrix) {
      activePhoneOverrides = batch.overrides
      await page.reload({ waitUntil: "networkidle" })
      await page.getByTestId("shift-overview-page").waitFor({ state: "visible" })
      await page.waitForTimeout(200)
      await assertRedactedAdminDom(`HTTP ${scenario.name} [${batch.label}]`, batch.positives)
    }

    assert.deepEqual(
      httpMutationRequests,
      [],
      `HTTP ${scenario.name}: mutation requests fired: ${httpMutationRequests}`,
    )
    assert.deepEqual(unexpectedGets, [], `HTTP ${scenario.name}: unexpected GET requests fired: ${unexpectedGets}`)
    assert.deepEqual(errors, [], `HTTP ${scenario.name}: console/page errors: ${errors.join(" | ")}`)
    await context.close()
  }

  console.log("admin-floor-map E2E verification PASSED")
} finally {
  await browser.close()
  await mockVite.close().catch(() => {})
  if (httpVite) await httpVite.close().catch(() => {})
}

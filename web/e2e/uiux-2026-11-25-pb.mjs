/**
 * Gói PB — Kiểm thử và chụp ảnh nghiệm thu UI/UX Audit 2026-11-25 (chế độ mock Vite HTTP).
 *
 * Chạy kiểm thử:
 *   node web/e2e/uiux-2026-11-25-pb.mjs
 * Chạy kèm lưu ảnh After:
 *   node web/e2e/uiux-2026-11-25-pb.mjs --capture-dir D:\GAM-APP\docs\ui-inventory\2026-11-25-after\PB
 */
import assert from "node:assert/strict"
import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { chromium, expect } from "@playwright/test"
import axe from "axe-core"
import { createServer } from "vite"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(__dirname, "..")
const { values } = parseArgs({ options: { "capture-dir": { type: "string" } } })
const captureDir = values["capture-dir"] ? path.resolve(values["capture-dir"]) : null

const NOW = "2026-11-25T13:25:00.000Z" // 20:25 Asia/Ho_Chi_Minh

const MATRIX_9 = [
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

const CORE_5 = [
  [320, 568],
  [390, 844],
  [820, 1180],
  [1024, 768],
  [1440, 900],
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

async function startVite() {
  const prevMode = process.env.VITE_API_MODE
  const prevBase = process.env.VITE_API_BASE_URL
  process.env.VITE_API_MODE = "http"
  process.env.VITE_API_BASE_URL = "/api/v1"
  const server = await createServer({
    root: webRoot,
    configFile: path.join(webRoot, "vite.config.ts"),
    server: { port: 0, host: "127.0.0.1", strictPort: false, open: false },
  })
  await server.listen()
  const addr = server.httpServer?.address()
  assert(addr && typeof addr === "object", "Vite server failed to bind a TCP port")
  return {
    close: async () => {
      await server.close()
      if (prevMode === undefined) delete process.env.VITE_API_MODE
      else process.env.VITE_API_MODE = prevMode
      if (prevBase === undefined) delete process.env.VITE_API_BASE_URL
      else process.env.VITE_API_BASE_URL = prevBase
    },
    baseUrl: `http://127.0.0.1:${addr.port}`,
  }
}

function makeSession({ roles, portal, permissions, displayName }) {
  return {
    user: {
      id: 42,
      username: "pb_e2e",
      displayName,
      organizationId: 1,
      venueId: 1,
      roles,
      accessLevel: null,
    },
    permissions,
    csrfToken: "pb-e2e-csrf",
    portal,
    mustChangePassword: false,
  }
}

const catalogPayload = {
  venue: {
    id: 1,
    version: 1,
    name: "21GAM",
    timezone: "Asia/Ho_Chi_Minh",
    businessDayStartLocal: "17:00:00",
    businessDayCutoffLocal: "05:00:00",
    upcomingWarningMinutes: 15,
    lateWarningMinutes: 15,
    noShowWarningMinutes: 30,
    waitlistHoldDefaultMinutes: 15,
    waitlistClaimLeaseSeconds: 120,
    reservationHoldPolicy: "RELEASE",
    reservationWindowMinutes: null,
    groupSymbolCount: 9,
    changeSeq: 1,
  },
  zones: [
    { id: 1, version: 1, code: "A", name: "Khu A", isBookable: true, isWaitingArea: false },
    { id: 2, version: 1, code: "BAR", name: "Quầy Bar", isBookable: true, isWaitingArea: false },
  ],
  tables: [
    {
      id: 1,
      version: 1,
      code: "A1",
      displayName: "A1",
      zoneId: 1,
      zoneCode: "A",
      kind: "TABLE",
      capacity: 4,
      seqNo: 1,
      isSpare: false,
      status: "ACTIVE",
      x: 80,
      y: 220,
      width: 68,
      height: 54,
    },
    {
      id: 2,
      version: 1,
      code: "A2",
      displayName: "A2",
      zoneId: 1,
      zoneCode: "A",
      kind: "TABLE",
      capacity: 4,
      seqNo: 2,
      isSpare: false,
      status: "ACTIVE",
      x: 164,
      y: 220,
      width: 68,
      height: 54,
    },
    {
      id: 3,
      version: 1,
      code: "A3",
      displayName: "A3",
      zoneId: 1,
      zoneCode: "A",
      kind: "TABLE",
      capacity: 4,
      seqNo: 3,
      isSpare: false,
      status: "ACTIVE",
      x: 248,
      y: 220,
      width: 68,
      height: 54,
    },
    {
      id: 101,
      version: 1,
      code: "BAR01",
      displayName: "Ghế Bar 1",
      zoneId: 2,
      zoneCode: "BAR",
      kind: "BAR_SEAT",
      capacity: 1,
      seqNo: 1,
      isSpare: false,
      status: "ACTIVE",
      x: 156,
      y: 662,
      width: 20,
      height: 20,
    },
  ],
  combinations: [],
}

const servicePayload = {
  businessDate: "2026-11-25",
  serverNow: NOW,
  changeSeq: "1",
  groups: [{ id: 7, symbolNo: 1, displayCode: "G01", tableIds: [1, 2], zoneId: 1 }],
  tables: [
    {
      tableId: 1,
      tableCode: "A1",
      catalogStatus: "ACTIVE",
      isSpare: false,
      displayState: "IN_USE",
      arrivalPhase: null,
      arrivalTime: null,
      minutesLate: 0,
      claim: {
        kind: "VISIT",
        visitId: 1,
        reservationId: null,
        waitlistEntryId: null,
        holdId: null,
        partySize: 4,
        turnNo: 1,
        flags: [],
        groupId: 7,
        groupDisplayCode: "G01",
        groupMemberTableIds: [1, 2],
        startsAt: "2026-11-25T12:30:00.000Z",
        deadlineAt: null,
        holdOverdue: false,
        paid: false,
        origin: "WALK_IN",
        sourceCode: null,
        version: 1,
      },
      groupId: 7,
      groupDisplayCode: "G01",
      groupMemberTableIds: [1, 2],
      staleFromPreviousDay: false,
      waiterPhase: "DINING",
    },
    {
      tableId: 2,
      tableCode: "A2",
      catalogStatus: "ACTIVE",
      isSpare: false,
      displayState: "IN_USE",
      arrivalPhase: null,
      arrivalTime: null,
      minutesLate: 0,
      claim: {
        kind: "VISIT",
        visitId: 1,
        reservationId: null,
        waitlistEntryId: null,
        holdId: null,
        partySize: 4,
        turnNo: 1,
        flags: [],
        groupId: 7,
        groupDisplayCode: "G01",
        groupMemberTableIds: [1, 2],
        startsAt: "2026-11-25T12:30:00.000Z",
        deadlineAt: null,
        holdOverdue: false,
        paid: false,
        origin: "WALK_IN",
        sourceCode: null,
        version: 1,
      },
      groupId: 7,
      groupDisplayCode: "G01",
      groupMemberTableIds: [1, 2],
      staleFromPreviousDay: false,
      waiterPhase: "DINING",
    },
    {
      tableId: 3,
      tableCode: "A3",
      catalogStatus: "ACTIVE",
      isSpare: false,
      displayState: "IN_USE",
      arrivalPhase: null,
      arrivalTime: null,
      minutesLate: 0,
      claim: {
        kind: "VISIT",
        visitId: 2,
        reservationId: null,
        waitlistEntryId: null,
        holdId: null,
        partySize: 2,
        turnNo: 1,
        flags: [],
        groupId: null,
        groupDisplayCode: null,
        groupMemberTableIds: [],
        startsAt: "2026-11-25T13:15:00.000Z",
        deadlineAt: null,
        holdOverdue: false,
        paid: false,
        origin: "WALK_IN",
        sourceCode: null,
        version: 1,
      },
      groupId: null,
      groupDisplayCode: null,
      groupMemberTableIds: [],
      staleFromPreviousDay: false,
      waiterPhase: "SEATED",
    },
    {
      tableId: 101,
      tableCode: "BAR01",
      catalogStatus: "ACTIVE",
      isSpare: false,
      displayState: "IN_USE",
      arrivalPhase: null,
      arrivalTime: null,
      minutesLate: 0,
      claim: {
        kind: "VISIT",
        visitId: 3,
        reservationId: null,
        waitlistEntryId: null,
        holdId: null,
        partySize: 1,
        turnNo: 1,
        flags: [],
        groupId: null,
        groupDisplayCode: null,
        groupMemberTableIds: [],
        startsAt: "2026-11-25T13:10:00.000Z",
        deadlineAt: null,
        holdOverdue: false,
        paid: false,
        origin: "WALK_IN",
        sourceCode: null,
        version: 1,
      },
      groupId: null,
      groupDisplayCode: null,
      groupMemberTableIds: [],
      staleFromPreviousDay: false,
      waiterPhase: "ORDERING",
    },
  ],
}

const waiterMenuPayload = {
  catalogVersion: "1",
  visit: {
    visitId: 1,
    tableCodes: ["A1", "A2"],
    guestCount: 4,
    startedAt: "2026-11-25T12:30:00.000Z",
  },
  categories: [
    { id: 1, code: "SIGNATURE", name: "Signature Cocktails", parentId: null, displayOrder: 1 },
    { id: 2, code: "BEER", name: "Bia", parentId: null, displayOrder: 2 },
    { id: 3, code: "FOOD", name: "Đồ ăn", parentId: null, displayOrder: 3 },
  ],
  items: [
    {
      id: 1,
      code: "NEGRONI",
      categoryId: 1,
      name: "21GAM Negroni Khói Quế",
      description: "Cocktail signature",
      preparationStation: "BAR",
      availabilityStatus: "AVAILABLE",
      displayOrder: 1,
      variants: [
        {
          variantId: 11,
          unitCode: "GLASS",
          displayName: "Ly",
          quantityInUnit: null,
          availabilityStatus: "AVAILABLE",
          amountVnd: 220000,
          priceId: 1,
          priceVersion: 1,
          effectiveFrom: "2026-01-01T00:00:00.000Z",
        },
      ],
    },
    {
      id: 2,
      code: "MACALLAN",
      categoryId: 1,
      name: "Macallan 12 Double Cask",
      description: null,
      preparationStation: "BAR",
      availabilityStatus: "AVAILABLE",
      displayOrder: 2,
      variants: [
        {
          variantId: 21,
          unitCode: "GLASS",
          displayName: "Ly",
          quantityInUnit: null,
          availabilityStatus: "AVAILABLE",
          amountVnd: 280000,
          priceId: 2,
          priceVersion: 1,
          effectiveFrom: "2026-01-01T00:00:00.000Z",
        },
        {
          variantId: 22,
          unitCode: "BOTTLE",
          displayName: "Chai",
          quantityInUnit: null,
          availabilityStatus: "AVAILABLE",
          amountVnd: 2850000,
          priceId: 3,
          priceVersion: 1,
          effectiveFrom: "2026-01-01T00:00:00.000Z",
        },
      ],
    },
    {
      id: 3,
      code: "GIN_OOS",
      categoryId: 1,
      name: "Gin Tonic Vỏ Bưởi Hồng",
      description: null,
      preparationStation: "BAR",
      availabilityStatus: "TEMPORARILY_UNAVAILABLE",
      displayOrder: 3,
      variants: [
        {
          variantId: 31,
          unitCode: "GLASS",
          displayName: "Ly",
          quantityInUnit: null,
          availabilityStatus: "TEMPORARILY_UNAVAILABLE",
          amountVnd: 195000,
          priceId: 4,
          priceVersion: 1,
          effectiveFrom: "2026-01-01T00:00:00.000Z",
        },
      ],
    },
    {
      id: 4,
      code: "TRUFFLE",
      categoryId: 3,
      name: "Khoai tây chiên sốt Truffle",
      description: null,
      preparationStation: "KITCHEN",
      availabilityStatus: "AVAILABLE",
      displayOrder: 4,
      variants: [
        {
          variantId: 41,
          unitCode: "PORTION",
          displayName: "Đĩa",
          quantityInUnit: null,
          availabilityStatus: "AVAILABLE",
          amountVnd: 145000,
          priceId: 5,
          priceVersion: 1,
          effectiveFrom: "2026-01-01T00:00:00.000Z",
        },
      ],
    },
  ],
}

const waiterOrdersPayload = {
  visitId: 1,
  tableCodes: ["A1", "A2"],
  orderCount: 1,
  totalAmountVnd: 585000,
  cancelledAmountVnd: 0,
  netAmountVnd: 585000,
  orders: [
    {
      orderId: 55,
      visitId: 1,
      visitSequence: 1,
      status: "SUBMITTED",
      submittedAt: "2026-11-25T13:12:00.000Z",
      orderedByUserId: 6,
      orderedByDisplayName: "Phục vụ 1",
      lineCount: 2,
      itemCount: 3,
      totalAmountVnd: 585000,
      cancelledItemCount: 0,
      cancelledAmountVnd: 0,
      netAmountVnd: 585000,
      stations: ["BAR", "KITCHEN"],
    },
  ],
}

const waiterOrderDetailPayload = {
  order: {
    ...waiterOrdersPayload.orders[0],
    businessDate: "2026-11-25",
    lines: [
      {
        lineNo: 1,
        menuItemId: 1,
        variantId: 11,
        itemCode: "NEGRONI",
        itemName: "21GAM Negroni Khói Quế",
        variantDisplayName: "Ly",
        unitCode: "GLASS",
        preparationStation: "BAR",
        unitPriceVnd: 220000,
        priceId: 1,
        priceVersion: 1,
        quantity: 2,
        lineTotalVnd: 440000,
        note: "Ít đá",
        lineVersion: 1,
        cancelledQuantity: 0,
        netQuantity: 2,
        netTotalVnd: 440000,
        preparationStatus: "SUBMITTED",
        canAdjustQuantity: true,
        pendingCancellation: null,
        lastRejection: null,
      },
      {
        lineNo: 2,
        menuItemId: 4,
        variantId: 41,
        itemCode: "TRUFFLE",
        itemName: "Khoai tây chiên sốt Truffle",
        variantDisplayName: "Đĩa",
        unitCode: "PORTION",
        preparationStation: "KITCHEN",
        unitPriceVnd: 145000,
        priceId: 5,
        priceVersion: 1,
        quantity: 1,
        lineTotalVnd: 145000,
        note: null,
        lineVersion: 1,
        cancelledQuantity: 0,
        netQuantity: 1,
        netTotalVnd: 145000,
        preparationStatus: "READY",
        canAdjustQuantity: false,
        pendingCancellation: null,
        lastRejection: null,
      },
    ],
    tickets: [],
  },
}

function makePrepTickets(station = "BAR") {
  const mkLine = (lineNo, name, variantId, quantity, doneQuantity, pendingCancellation = null) => ({
    lineNo,
    itemName: name,
    variantDisplayName: station === "BAR" ? "Ly" : "Phần",
    menuItemVariantId: variantId,
    unitCode: station === "BAR" ? "GLASS" : "PORTION",
    quantity,
    cancelledQuantity: 0,
    originalQuantity: quantity,
    doneQuantity,
    progressVersion: doneQuantity > 0 ? 1 : 0,
    note: lineNo === 1 ? "Ít đá, trang trí vỏ cam cháy, báo bàn VIP khi xong" : null,
    pendingCancellation,
  })
  return [
    {
      ticketId: 1,
      orderId: 101,
      visitId: 1,
      visitSequence: 1,
      station,
      status: "SUBMITTED",
      version: 1,
      submittedAt: "2026-11-25T13:12:00.000Z", // 13 phút -> critical
      acceptedAt: null,
      startedAt: null,
      readyAt: null,
      collectedAt: null,
      waitSeconds: 780,
      tableCodes: ["A1", "A2"],
      orderedByDisplayName: "Phục vụ 1",
      guestFlags: { vip: true, birthday: true, designated: false },
      lines: [
        mkLine(1, "Cocktail Signature #1 (Khói Quế)", 101, 2, 2),
        mkLine(2, "Cocktail Signature #2 (Khói Quế)", 102, 2, 2, {
          cancellationId: 88,
          quantity: 1,
          groupId: null,
        }),
        mkLine(3, "Cocktail Signature #3 (Khói Quế)", 103, 2, 0),
      ],
    },
    {
      ticketId: 2,
      orderId: 102,
      visitId: 2,
      visitSequence: 1,
      station,
      status: "ACCEPTED",
      version: 2,
      submittedAt: "2026-11-25T13:16:00.000Z", // 9 phút -> warning (UX-03)
      acceptedAt: "2026-11-25T13:17:00.000Z",
      startedAt: null,
      readyAt: null,
      collectedAt: null,
      waitSeconds: 540,
      tableCodes: ["A3"],
      orderedByDisplayName: "Phục vụ 1",
      guestFlags: { vip: false, birthday: false, designated: true },
      lines: [
        mkLine(1, "Cocktail Signature #1 (Khói Quế)", 101, 2, 2),
        mkLine(2, "Cocktail Signature #2 (Khói Quế)", 102, 2, 2),
      ],
    },
    {
      ticketId: 3,
      orderId: 103,
      visitId: 3,
      visitSequence: 1,
      station,
      status: "PREPARING",
      version: 3,
      submittedAt: "2026-11-25T13:18:00.000Z", // 7 phút -> normal
      acceptedAt: "2026-11-25T13:19:00.000Z",
      startedAt: "2026-11-25T13:20:00.000Z",
      readyAt: null,
      collectedAt: null,
      waitSeconds: 420,
      tableCodes: ["B11"],
      orderedByDisplayName: "Phục vụ 2",
      guestFlags: { vip: false, birthday: false, designated: false },
      lines: [
        mkLine(1, "Cocktail Signature #1 (Khói Quế)", 101, 2, 1), // incomplete warning (DS-05)
        mkLine(2, "Cocktail Signature #4 (Khói Quế)", 104, 2, 2),
      ],
    },
    {
      ticketId: 4,
      orderId: 104,
      visitId: 4,
      visitSequence: 1,
      station,
      status: "READY",
      version: 4,
      submittedAt: "2026-11-25T13:10:00.000Z", // 15 phút -> critical
      acceptedAt: "2026-11-25T13:11:00.000Z",
      startedAt: "2026-11-25T13:12:00.000Z",
      readyAt: "2026-11-25T13:15:00.000Z",
      collectedAt: null,
      waitSeconds: 900,
      tableCodes: ["BAR01"],
      orderedByDisplayName: "Phục vụ 1",
      guestFlags: { vip: false, birthday: false, designated: false },
      lines: [mkLine(1, "Cocktail Signature #3 (Khói Quế)", 103, 2, 2)],
    },
  ]
}

const cancellationQueueEntries = [
  {
    cancellationId: 1,
    groupId: null,
    status: "PENDING",
    policy: "STANDARD",
    version: 1,
    visitId: 1,
    tableCodes: ["A1", "A2"],
    orderId: 55,
    visitSequence: 1,
    lineNo: 2,
    itemName: "Khoai tây chiên sốt Truffle",
    variantDisplayName: "Đĩa",
    station: "KITCHEN",
    ticketStatusAtRequest: "PREPARING",
    quantity: 1,
    unitPriceVnd: 145000,
    amountVnd: 145000,
    reason: "Khách đổi sang sườn nướng mật ong",
    requestedByUserId: 6,
    requestedByDisplayName: "Phục vụ 1",
    requestedAt: "2026-11-25T13:20:00.000Z",
    decidedByUserId: null,
    decidedByDisplayName: null,
    decidedAt: null,
    decisionNote: null,
  },
  {
    cancellationId: 2,
    groupId: null,
    status: "PENDING",
    policy: "READY_WASTE",
    version: 1,
    visitId: 2,
    tableCodes: ["A3"],
    orderId: 56,
    visitSequence: 1,
    lineNo: 1,
    itemName: "21GAM Negroni Khói Quế",
    variantDisplayName: "Ly",
    station: "BAR",
    ticketStatusAtRequest: "READY",
    quantity: 1,
    unitPriceVnd: 220000,
    amountVnd: 220000,
    reason: "Khách báo quá nặng, xin đổi món khác",
    requestedByUserId: 6,
    requestedByDisplayName: "Phục vụ 1",
    requestedAt: "2026-11-25T13:22:00.000Z",
    decidedByUserId: null,
    decidedByDisplayName: null,
    decidedAt: null,
    decisionNote: null,
  },
  {
    cancellationId: 3,
    groupId: 90,
    status: "PENDING",
    policy: "READY_WASTE",
    version: 1,
    visitId: 3,
    tableCodes: ["BAR01"],
    orderId: 57,
    visitSequence: 2,
    lineNo: 1,
    itemName: "Old Fashioned",
    variantDisplayName: "Ly",
    station: "BAR",
    ticketStatusAtRequest: "READY",
    quantity: 1,
    unitPriceVnd: 250000,
    amountVnd: 250000,
    reason: "Khách có việc gấp phải về",
    requestedByUserId: 6,
    requestedByDisplayName: "Phục vụ 1",
    requestedAt: "2026-11-25T13:23:00.000Z",
    decidedByUserId: null,
    decidedByDisplayName: null,
    decidedAt: null,
    decisionNote: null,
  },
]

async function openContext(browser, [width, height], { dark = false } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    isMobile: width < 768,
    hasTouch: width <= 1024,
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
  })
  await context.addInitScript((isDark) => {
    class QuietEventSource {
      addEventListener() {}
      removeEventListener() {}
      close() {}
    }
    Object.defineProperty(window, "EventSource", { value: QuietEventSource })
    if (isDark) {
      if (document.documentElement) document.documentElement.classList.add("dark")
      else document.addEventListener("DOMContentLoaded", () => document.documentElement.classList.add("dark"))
    }
  }, dark)
  const page = await context.newPage()
  await page.clock.setFixedTime(new Date(NOW))
  const consoleErrors = []
  page.on("console", (msg) => {
    if (msg.type() === "error" && !msg.text().includes("401")) consoleErrors.push(msg.text())
  })
  page.on("pageerror", (err) => consoleErrors.push(err.message))
  return { context, page, consoleErrors }
}

async function runAuditProbes(
  page,
  label,
  { allow401 = false, checkSmallFonts = true, axeExclude = [], allowContrastTargets = [] } = {},
) {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(150)

  await page.evaluate(axe.source)
  const axeViolations = await page.evaluate(async (excludes) => {
    const context = excludes.length ? { exclude: excludes } : document
    return (await window.axe.run(context, { resultTypes: ["violations"] })).violations
      .filter((v) => ["serious", "critical"].includes(v.impact))
      .map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => ({
          target: n.target,
          summary: n.failureSummary,
          data: n.any?.[0]?.data ?? null,
        })),
      }))
  }, axeExclude)
  const filteredViolations = axeViolations.filter((v) => {
    if (v.id !== "color-contrast" || allowContrastTargets.length === 0) return true
    const remaining = v.nodes.filter((n) => !allowContrastTargets.some((pat) => n.target.join(" ").includes(pat)))
    if (remaining.length < v.nodes.length) {
      console.log(`INT-R03 recorded out-of-scope contrast (${label}):`, JSON.stringify(v.nodes))
    }
    return remaining.length > 0
  })
  assert.deepEqual(
    filteredViolations,
    [],
    `${label}: axe serious/critical violations: ${JSON.stringify(filteredViolations)}`,
  )

  const dom = await page.evaluate((checkFonts) => {
    const vw = document.documentElement.clientWidth
    const overflowX = document.documentElement.scrollWidth > vw
    const mains = [...document.querySelectorAll("main")].filter((el) => {
      const s = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      return (
        s.display !== "none" && s.display !== "contents" && s.visibility === "visible" && r.width > 0 && r.height > 0
      )
    })
    const h1s = [...document.querySelectorAll("h1")].filter((el) => getComputedStyle(el).display !== "none")

    const smallTargets = []
    if (innerWidth <= 1024) {
      const nodes = [...document.querySelectorAll("button,a[href],input:not([type=hidden]),select,textarea,[role=tab]")]
      for (const el of nodes) {
        if (el.closest("svg")) continue
        const s = getComputedStyle(el)
        if (s.display === "none" || s.visibility !== "visible" || el.closest("[hidden]")) continue
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        if (r.width < 43.5 || r.height < 43.5) {
          smallTargets.push({
            tag: el.localName,
            text: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 50),
            w: Math.round(r.width),
            h: Math.round(r.height),
          })
        }
      }
    }

    const smallFonts = []
    if (checkFonts) {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      let node
      while ((node = walker.nextNode())) {
        if (!node.textContent || !node.textContent.trim()) continue
        const el = node.parentElement
        if (!el || el.closest("svg") || el.closest(".sr-only") || el.classList.contains("sr-only")) continue
        const s = getComputedStyle(el)
        if (s.display === "none" || s.visibility !== "visible" || Number(s.opacity) === 0) continue
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        const fs = parseFloat(s.fontSize)
        if (fs < 11.9) {
          smallFonts.push({ text: node.textContent.trim().slice(0, 40), fontSize: fs })
        }
      }
    }

    return {
      overflowX,
      mainCount: mains.length,
      h1Count: h1s.length,
      smallTargets,
      smallFonts,
    }
  }, checkSmallFonts)

  assert.equal(dom.overflowX, false, `${label}: horizontal overflow detected`)
  assert.equal(dom.mainCount, 1, `${label}: expected exactly 1 visible <main>, got ${dom.mainCount}`)
  assert.equal(dom.h1Count, 1, `${label}: expected exactly 1 <h1>, got ${dom.h1Count}`)
  assert.deepEqual(dom.smallTargets, [], `${label}: touch targets < 44px: ${JSON.stringify(dom.smallTargets)}`)
  assert.deepEqual(dom.smallFonts, [], `${label}: text < 12px: ${JSON.stringify(dom.smallFonts)}`)
  if (!allow401) {
    // checked via consoleErrors on caller
  }
}

async function saveShot(page, name) {
  if (!captureDir) return
  await fsp.mkdir(captureDir, { recursive: true })
  await page.screenshot({ path: path.join(captureDir, name), fullPage: true, animations: "disabled", caret: "hide" })
}

async function setupWaiterMocks(page, { roles = ["WAITER"], portal = "waiter", permissions } = {}) {
  const perms = permissions ?? [
    "order.read",
    "order.create",
    "order.line.adjust",
    "order.cancel.request",
    "order.cancel.ready",
  ]
  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({
      json: makeSession({ roles, portal, displayName: "Phục vụ 1", permissions: perms }),
    }),
  )
  await page.route("**/api/v1/tables/catalog", (route) => route.fulfill({ json: catalogPayload }))
  await page.route("**/api/v1/tables/service?*", (route) => {
    const date = new URL(route.request().url()).searchParams.get("date") ?? servicePayload.businessDate
    return route.fulfill({ json: { ...servicePayload, businessDate: date } })
  })
  await page.route("**/api/v1/preparation/ready-notifications", (route) =>
    route.fulfill({ json: { notifications: [] } }),
  )
  await page.route("**/api/v1/waiter/notifications", (route) => route.fulfill({ json: { notifications: [] } }))
  await page.route("**/api/v1/waiter/visits/*/ordering", (route) => route.fulfill({ json: {} }))
  await page.route("**/api/v1/waiter/menu?*", (route) => route.fulfill({ json: waiterMenuPayload }))
  await page.route("**/api/v1/waiter/visits/*/orders", (route) => route.fulfill({ json: waiterOrdersPayload }))
  await page.route("**/api/v1/waiter/orders/*", (route) => route.fulfill({ json: waiterOrderDetailPayload }))
  await page.route("**/api/v1/preparation/BAR/tickets", (route) =>
    route.fulfill({
      json: {
        station: "BAR",
        changeCursor: "10",
        generatedAt: NOW,
        printing: { enabled: false },
        limit: 200,
        tickets: makePrepTickets("BAR"),
      },
    }),
  )
}

const vite = await startVite()
const browser = await launchBrowser()
let checks = 0

try {
  // 1. DS-03 + Landmark h1 on /phucvu across all 9 viewports
  for (const vp of MATRIX_9) {
    const { context, page, consoleErrors } = await openContext(browser, vp)
    try {
      await setupWaiterMocks(page)
      await page.goto(`${vite.baseUrl}/phucvu`, { waitUntil: "networkidle" })
      await expect(page.getByRole("group", { name: "Sơ đồ bàn ca hiện tại" })).toBeVisible()
      await runAuditProbes(page, `/phucvu ${vp.join("x")}`, {
        axeExclude: ['svg[aria-label="Sơ đồ bàn ca hiện tại"]'],
      })
      assert.deepEqual(consoleErrors, [], `/phucvu console errors: ${consoleErrors}`)

      if (vp[0] === 390 || vp[0] === 1440) {
        // Verify DS-03: wordmark button is a real ghost Button with >=44px height, focus-visible ring, hover feedback (desktop), and press feedback
        const homeBtn = page.locator("header button", { hasText: "21GAM" })
        const box = await homeBtn.boundingBox()
        assert(box && box.height >= 44, `Wordmark button height ${box?.height} < 44`)
        assert.equal(await homeBtn.getAttribute("data-variant"), "ghost", "DS-03: expected Button variant=ghost")

        if (vp[0] === 390) {
          // Tab on fresh page lands on 21GAM wordmark; verify focus-visible ring (matching Account button)
          let focusedInfo = { text: "", boxShadow: "none" }
          for (let step = 0; step < 3; step++) {
            await page.keyboard.press("Tab")
            focusedInfo = await page.evaluate(() => {
              const el = document.activeElement
              const s = el ? getComputedStyle(el) : null
              return {
                text: el?.textContent?.trim() ?? "",
                boxShadow: s?.boxShadow ?? "none",
              }
            })
            if (focusedInfo.text.includes("21GAM")) break
          }
          assert(focusedInfo.text.includes("21GAM"), `Expected focus on 21GAM wordmark, got ${focusedInfo.text}`)
          assert.notEqual(focusedInfo.boxShadow, "none", "DS-03: Wordmark button missing focus-visible ring")
          await saveShot(page, "waiter-phucvu-focus-390x844.png")
          await page.evaluate(() => document.activeElement?.blur?.())
        }

        if (vp[0] === 1440) {
          const beforeBg = await homeBtn.evaluate((el) => getComputedStyle(el).backgroundColor)
          await homeBtn.hover()
          await page.waitForTimeout(200)
          const hoverBg = await homeBtn.evaluate((el) => getComputedStyle(el).backgroundColor)
          assert.notEqual(hoverBg, beforeBg, "DS-03: Wordmark button background did not change on hover")
        }

        // Verify pointer-down press feedback (active:scale-[0.97] -> CSS `scale` in Tailwind v4)
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
        await page.mouse.down()
        await page.waitForTimeout(120)
        const activeScale = await homeBtn.evaluate((el) => ({
          scale: getComputedStyle(el).scale,
          transform: getComputedStyle(el).transform,
        }))
        await page.mouse.up()
        assert(
          activeScale.scale !== "none" || activeScale.transform !== "none",
          `DS-03: Wordmark button missing active press feedback (${JSON.stringify(activeScale)})`,
        )
      }
      await saveShot(page, `waiter-phucvu-busy-${vp.join("x")}.png`)
      checks++
    } finally {
      await context.close()
    }
  }

  // 2. UX-10 + UX-24 on /phucvu/phien/1/goi-mon + CartSheet + OrderSentBanner + /orders
  for (const vp of MATRIX_9) {
    const { context, page, consoleErrors } = await openContext(browser, vp)
    try {
      await setupWaiterMocks(page)
      await page.goto(`${vite.baseUrl}/phucvu/phien/1/goi-mon`, { waitUntil: "networkidle" })
      await expect(page.getByRole("heading", { name: "Gọi món" })).toBeVisible()
      await runAuditProbes(page, `/goi-mon ${vp.join("x")}`)
      assert.deepEqual(consoleErrors, [], `/goi-mon console errors: ${consoleErrors}`)

      // UX-24: Category tabs are rounded-lg (<=12px), status badge is rounded-full (9999px)
      const shapes = await page.evaluate(() => {
        const tab = document.querySelector('[role="tab"]')
        const statusBadge = [...document.querySelectorAll("span")].find((el) =>
          el.textContent?.includes("Đang gọi món"),
        )
        return {
          tabRadius: tab ? parseFloat(getComputedStyle(tab).borderRadius) : -1,
          badgeRadius: statusBadge ? parseFloat(getComputedStyle(statusBadge).borderRadius) : -1,
        }
      })
      assert(
        shapes.tabRadius > 0 && shapes.tabRadius <= 12,
        `UX-24: tab radius ${shapes.tabRadius} should be rounded-lg`,
      )
      assert(shapes.badgeRadius >= 999, `UX-24: badge radius ${shapes.badgeRadius} should stay pill`)

      await saveShot(page, `waiter-phucvu-phien-1-goi-mon-busy-${vp.join("x")}.png`)

      // Test CartSheet & ItemSheet on core viewports
      if (CORE_5.some(([w]) => w === vp[0])) {
        await page.getByRole("button", { name: "Gọi thêm một phần 21GAM Negroni Khói Quế", exact: true }).click()
        await runAuditProbes(page, `/goi-mon with item in cart ${vp.join("x")}`)
        await page.getByRole("button", { name: /Giỏ gọi món/ }).click()
        await expect(page.getByRole("dialog")).toBeVisible()
        await runAuditProbes(page, `/goi-mon cart ${vp.join("x")}`)
        await saveShot(page, `waiter-phucvu-phien-1-goi-mon-cart-${vp.join("x")}.png`)
        await page.keyboard.press("Escape")
        await expect(page.getByRole("dialog")).toHaveCount(0)

        // Open item variants sheet to verify note preset chips (UX-10 & UX-24)
        await page.getByRole("button", { name: "Chọn đơn vị cho Macallan 12 Double Cask", exact: true }).click()
        await expect(page.getByRole("dialog")).toBeVisible()
        await runAuditProbes(page, `/goi-mon item sheet ${vp.join("x")}`)
        const presetRadius = await page
          .getByRole("button", { name: "Ít đá", exact: true })
          .evaluate((el) => parseFloat(getComputedStyle(el).borderRadius))
        assert(presetRadius > 0 && presetRadius <= 12, `UX-24: preset chip radius ${presetRadius} should be rounded-lg`)
        await page.keyboard.press("Escape")
      }
      checks++
    } finally {
      await context.close()
    }
  }

  // /phucvu/orders/1 across MATRIX_9 + expanded order line check
  for (const vp of MATRIX_9) {
    const { context, page, consoleErrors } = await openContext(browser, vp)
    try {
      await setupWaiterMocks(page)
      await page.goto(`${vite.baseUrl}/phucvu/orders/1`, { waitUntil: "networkidle" })
      await expect(page.getByRole("heading", { name: /Đơn của bàn/ })).toBeVisible()
      if (vp[0] === 390 || vp[0] === 820) {
        await page.getByRole("button", { name: /Đơn 1/ }).click()
        await expect(page.getByText("21GAM Negroni Khói Quế")).toBeVisible()
      }
      await runAuditProbes(page, `/phucvu/orders/1 ${vp.join("x")}`)
      assert.deepEqual(consoleErrors, [], `/orders console errors: ${consoleErrors}`)
      await saveShot(page, `waiter-phucvu-orders-1-busy-${vp.join("x")}.png`)
      checks++
    } finally {
      await context.close()
    }
  }

  // 3. UX-03, UX-11, DS-05, scrollable-region-focusable, landmark <main> on /chebien (BAR + KITCHEN, light + dark) and /phucvu/hang-doi
  for (const station of ["BAR", "KITCHEN"]) {
    const role = station === "BAR" ? "bar" : "kitchen"
    const viewports = station === "BAR" ? MATRIX_9 : CORE_5
    for (const vp of viewports) {
      const { context, page, consoleErrors } = await openContext(browser, vp)
      try {
        await page.route("**/api/v1/auth/me", (route) =>
          route.fulfill({
            json: makeSession({
              roles: [station],
              portal: "preparation",
              displayName: `${station} 1`,
              permissions: [
                `preparation.${station.toLowerCase()}.read`,
                `preparation.${station.toLowerCase()}.transition`,
              ],
            }),
          }),
        )
        await page.route(`**/api/v1/preparation/${station}/tickets`, (route) =>
          route.fulfill({
            json: {
              station,
              changeCursor: "10",
              generatedAt: NOW,
              printing: { enabled: false },
              limit: 200,
              tickets: makePrepTickets(station),
            },
          }),
        )
        await page.goto(`${vite.baseUrl}/chebien`, { waitUntil: "networkidle" })
        await expect(page.getByRole("heading", { name: `Hàng đợi ${station === "BAR" ? "Bar" : "Bếp"}` })).toBeVisible()
        await runAuditProbes(page, `${role} /chebien ${vp.join("x")}`)
        assert.deepEqual(consoleErrors, [], `${role} /chebien console errors: ${consoleErrors}`)

        const prepMetrics = await page.evaluate(() => {
          const panel = document.querySelector("[data-preparation-totals]")
          const toggle = panel?.querySelector("button[aria-expanded]")
          const scrollRegion = panel?.querySelector("[tabindex='0']")
          const nav = document.querySelector('nav[aria-label="Chuyển nhanh theo cột"]')
          const navLinks = nav ? [...nav.querySelectorAll("a")] : []
          const firstLinkTop = navLinks[0]?.getBoundingClientRect().top ?? 0
          const multiRowNav = navLinks.some((a) => Math.abs(a.getBoundingClientRect().top - firstLinkTop) > 12)
          return {
            expanded: toggle?.getAttribute("aria-expanded"),
            panelHeight: panel ? Math.round(panel.getBoundingClientRect().height) : 0,
            hasFocusableScroll: Boolean(scrollRegion),
            navVisible: nav ? getComputedStyle(nav).display !== "none" : false,
            multiRowNav,
          }
        })

        if (vp[0] < 768) {
          assert.equal(prepMetrics.expanded, "false", `UX-11: ${role} ${vp[0]} should collapse totals under 768px`)
          if (prepMetrics.navVisible) {
            assert.equal(prepMetrics.multiRowNav, false, `UX-11: ${role} ${vp[0]} jump nav wrapped onto 2 rows`)
          }
        } else {
          assert.equal(prepMetrics.expanded, "true", `UX-11: ${role} ${vp[0]} should expand totals >= 768px`)
          assert.equal(prepMetrics.hasFocusableScroll, true, "scrollable-region-focusable: missing tabIndex=0")
          assert(
            prepMetrics.panelHeight <= 240,
            `UX-11: ${role} ${vp.join("x")} totals panel height ${prepMetrics.panelHeight}px > 240px`,
          )
        }

        // Verify DS-05 callouts, UX-03 warning chip, and INT-R03 critical chip token
        const waitChipStyles = await page.evaluate(() => {
          const warn = document.querySelector('span[data-wait-tone="warning"]')
          const crit = document.querySelector('span[data-wait-tone="critical"]')
          return {
            hasWarn: Boolean(warn),
            warnColor: warn ? getComputedStyle(warn).color : null,
            hasCrit: Boolean(crit),
            critColor: crit ? getComputedStyle(crit).color : null,
          }
        })
        assert(waitChipStyles.hasWarn && waitChipStyles.hasCrit, "Expected warning and critical wait chips on /chebien")
        // INT-R03: Daylight warning=#854d0e (rgb(133, 77, 14)), critical uses --destructive (NOT #991b1b rgb(153, 27, 27))
        assert.equal(waitChipStyles.warnColor, "rgb(133, 77, 14)", "UX-03: warning chip color mismatch in Daylight")
        assert.notEqual(
          waitChipStyles.critColor,
          "rgb(153, 27, 27)",
          "INT-R03: critical chip must use --destructive, not --st-late-ink",
        )

        // INT-R06: jump-link scroll cue at 320/390, Tab reaches all 4 links, clicking 4th jumps to READY column; hidden at 820/1440
        if (station === "BAR" && (vp[0] === 320 || vp[0] === 390)) {
          const cue = page.getByTestId("preparation-jump-scroll-cue")
          await expect(cue).toBeVisible()
          const cuePointer = await cue.evaluate((el) => getComputedStyle(el).pointerEvents)
          assert.equal(cuePointer, "none", "INT-R06: jump-link scroll cue must be pointer-events: none")

          // Tab through all 4 jump links and verify focus-visible ring
          const navLinks = page.locator('nav[aria-label="Chuyển nhanh theo cột"] a')
          assert.equal(await navLinks.count(), 4, "INT-R06: expected 4 jump links for BAR")
          await navLinks.first().focus()
          for (let i = 0; i < 4; i++) {
            const focused = await page.evaluate(() => {
              const el = document.activeElement
              const cs = el ? getComputedStyle(el) : null
              return {
                href: el?.getAttribute("href") ?? "",
                focusVisible: el?.matches(":focus-visible") ?? false,
                boxShadow: cs?.boxShadow ?? "none",
              }
            })
            assert(focused.focusVisible && focused.boxShadow !== "none", `INT-R06 link[${i}] missing focus ring`)
            if (i < 3) await page.keyboard.press("Tab")
          }
          // Click last jump link (#queue-READY) -> verify scrolled to end & cue hides + column heading focused
          await navLinks.last().click()
          await page.waitForTimeout(150)
          const afterJump = await page.evaluate(() => {
            const scroller = document.querySelector('nav[aria-label="Chuyển nhanh theo cột"] > div')
            return {
              scrollLeft: scroller?.scrollLeft ?? 0,
              scrollMax: scroller ? scroller.scrollWidth - scroller.clientWidth : 0,
              cueCount: document.querySelectorAll('[data-testid="preparation-jump-scroll-cue"]').length,
              activeId: document.activeElement?.id ?? "",
            }
          })
          assert.equal(afterJump.activeId, "queue-READY", `INT-R06: clicking 4th jump link did not focus #queue-READY`)
          assert.equal(afterJump.cueCount, 0, `INT-R06: cue should hide at scroll end (${JSON.stringify(afterJump)})`)

          // Reset nav scroll and page scroll before screenshot
          await page.evaluate(() => {
            const scroller = document.querySelector('nav[aria-label="Chuyển nhanh theo cột"] > div')
            if (scroller) {
              scroller.scrollLeft = 0
              scroller.dispatchEvent(new Event("scroll"))
            }
            window.scrollTo(0, 0)
          })
          await page.waitForTimeout(80)
        } else if (station === "BAR" && vp[0] === 820) {
          assert.equal(
            await page.getByTestId("preparation-jump-scroll-cue").count(),
            0,
            "INT-R06: 820px wraps jump links and must not show scroll cue",
          )
        }

        await saveShot(page, `${role}-chebien-busy-${vp.join("x")}.png`)
        checks++
      } finally {
        await context.close()
      }
    }
  }

  // Dark mode (Service) check on /chebien for UX-03, DS-05, and INT-R03 critical token check
  {
    const { context, page, consoleErrors } = await openContext(browser, [1440, 900], { dark: true })
    try {
      await page.route("**/api/v1/auth/me", (route) =>
        route.fulfill({
          json: makeSession({
            roles: ["BAR"],
            portal: "preparation",
            displayName: "Bar Service",
            permissions: ["preparation.bar.read", "preparation.bar.transition"],
          }),
        }),
      )
      await page.route("**/api/v1/preparation/BAR/tickets", (route) =>
        route.fulfill({
          json: {
            station: "BAR",
            changeCursor: "10",
            generatedAt: NOW,
            printing: { enabled: false },
            limit: 200,
            tickets: makePrepTickets("BAR"),
          },
        }),
      )
      await page.goto(`${vite.baseUrl}/chebien`, { waitUntil: "networkidle" })
      await expect(page.getByRole("heading", { name: "Hàng đợi Bar" })).toBeVisible()
      await runAuditProbes(page, "bar /chebien dark 1440x900", {
        allowContrastTargets: ['data-wait-tone="critical"'],
      })
      const darkChipColors = await page.evaluate(() => {
        const warn = document.querySelector('span[data-wait-tone="warning"]')
        const crit = document.querySelector('span[data-wait-tone="critical"]')
        return {
          warnColor: warn ? getComputedStyle(warn).color : null,
          critColor: crit ? getComputedStyle(crit).color : null,
        }
      })
      assert.equal(darkChipColors.warnColor, "rgb(252, 211, 77)", "UX-03: warning chip dark color mismatch")
      assert.notEqual(
        darkChipColors.critColor,
        "rgb(252, 165, 165)",
        "INT-R03: dark critical chip must use --destructive, not --st-late-ink",
      )
      await saveShot(page, "bar-chebien-dark-1440x900.png")
      assert.deepEqual(consoleErrors, [], `bar dark console errors: ${consoleErrors}`)
      checks++
    } finally {
      await context.close()
    }
  }

  // Embedded /phucvu/hang-doi across [390x844, 820x1180, 1440x900]
  for (const vp of [
    [390, 844],
    [820, 1180],
    [1440, 900],
  ]) {
    const { context, page, consoleErrors } = await openContext(browser, vp)
    try {
      await setupWaiterMocks(page, {
        roles: ["BAR"],
        portal: "waiter",
        permissions: ["order.read", "preparation.bar.read", "preparation.bar.transition"],
      })
      await page.goto(`${vite.baseUrl}/phucvu/hang-doi`, { waitUntil: "networkidle" })
      await expect(page.getByRole("heading", { name: "Hàng đợi Bar" })).toBeVisible()
      await runAuditProbes(page, `bar /phucvu/hang-doi ${vp.join("x")}`)
      assert.deepEqual(consoleErrors, [], `/phucvu/hang-doi console errors: ${consoleErrors}`)
      await saveShot(page, `bar-phucvu-hang-doi-busy-${vp.join("x")}.png`)
      checks++
    } finally {
      await context.close()
    }
  }

  // 4. UX-02 + UX-24 + Landmark <main> on /duyet-huy-mon
  for (const vp of CORE_5) {
    const { context, page, consoleErrors } = await openContext(browser, vp)
    let approveNormalPayloads = []
    let approveWastePayloads = []
    let approveGroupPayloads = []
    let rejectNormalPayloads = []
    let wasteDelayMs = 0
    try {
      await page.route("**/api/v1/auth/me", (route) =>
        route.fulfill({
          json: makeSession({
            roles: ["OWNER"],
            portal: "admin",
            displayName: "Chủ quán",
            permissions: ["order.cancel.approve"],
          }),
        }),
      )
      await page.route("**/api/v1/orders/cancellations?*", (route) =>
        route.fulfill({ json: { pendingCount: 3, entries: cancellationQueueEntries } }),
      )
      await page.route("**/api/v1/orders/cancellations/1/approve", (route) => {
        approveNormalPayloads.push(route.request().postDataJSON())
        return route.fulfill({ json: { cancellationId: 1, status: "APPROVED", version: 2 } })
      })
      await page.route("**/api/v1/orders/cancellations/1/reject", (route) => {
        rejectNormalPayloads.push(route.request().postDataJSON())
        return route.fulfill({ json: { cancellationId: 1, status: "REJECTED", version: 2 } })
      })
      await page.route("**/api/v1/orders/cancellations/2/approve", async (route) => {
        approveWastePayloads.push(route.request().postDataJSON())
        if (wasteDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, wasteDelayMs))
        return route.fulfill({ json: { cancellationId: 2, status: "APPROVED", version: 2 } })
      })
      await page.route("**/api/v1/orders/cancellations/groups/90/approve", (route) => {
        approveGroupPayloads.push(route.request().postDataJSON())
        return route.fulfill({ json: { groupId: 90, status: "APPROVED", decidedCount: 1 } })
      })

      await page.goto(`${vite.baseUrl}/duyet-huy-mon`, { waitUntil: "networkidle" })
      await expect(page.getByRole("heading", { name: "Phê duyệt hủy món" })).toBeVisible()
      await runAuditProbes(page, `/duyet-huy-mon ${vp.join("x")}`, {
        allowContrastTargets: ["text-destructive"],
      })
      assert.deepEqual(consoleErrors, [], `/duyet-huy-mon console errors: ${consoleErrors}`)

      // Verify UX-02: Duyệt ghi hao and Duyệt cả đơn (with wasteQuantity > 0) have destructive red style, while Duyệt hủy has primary blue
      const btnCheck = await page.evaluate(() => {
        const approveNormal = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Duyệt hủy"))
        const approveWaste = [...document.querySelectorAll("button")].find((b) =>
          b.textContent?.includes("Duyệt ghi hao"),
        )
        const approveGroupWaste = [...document.querySelectorAll("button")].find((b) =>
          b.textContent?.includes("Duyệt cả đơn"),
        )
        const tab = document.querySelector('[role="tab"]')
        return {
          normalVariant: approveNormal?.getAttribute("data-variant"),
          wasteVariant: approveWaste?.getAttribute("data-variant"),
          groupWasteVariant: approveGroupWaste?.getAttribute("data-variant"),
          normalBg: approveNormal ? getComputedStyle(approveNormal).backgroundColor : "",
          wasteBg: approveWaste ? getComputedStyle(approveWaste).backgroundColor : "",
          tabRadius: tab ? parseFloat(getComputedStyle(tab).borderRadius) : -1,
        }
      })
      assert.equal(btnCheck.normalVariant, "default")
      assert.equal(btnCheck.wasteVariant, "destructive")
      assert.equal(btnCheck.groupWasteVariant, "destructive")
      assert.notEqual(
        btnCheck.wasteBg,
        btnCheck.normalBg,
        "UX-02: waste button background must differ from normal approve",
      )
      assert(
        btnCheck.tabRadius > 0 && btnCheck.tabRadius <= 12,
        `UX-24: /duyet-huy-mon tab radius ${btnCheck.tabRadius}`,
      )

      // INT-R03: group waste callout uses --destructive (not --st-late-ink #991b1b)
      const calloutColor = await page.evaluate(() => {
        const p = [...document.querySelectorAll("p")].find((el) =>
          el.textContent?.includes("duyệt nghĩa là ghi hao số này"),
        )
        return p ? getComputedStyle(p).color : null
      })
      assert(
        calloutColor && calloutColor !== "rgb(153, 27, 27)",
        `INT-R03: waste callout must use --destructive (${calloutColor})`,
      )

      await saveShot(page, `owner-duyet-huy-mon-busy-${vp.join("x")}.png`)

      const assertOpenDialogLayout = async (stageLabel) => {
        const dialog = page.getByRole("alertdialog")
        await expect(dialog).toBeVisible()
        if (captureDir) await page.waitForTimeout(300)
        await runAuditProbes(page, `/duyet-huy-mon dialog ${stageLabel} ${vp.join("x")}`, {
          allowContrastTargets: ["text-destructive"],
        })
        const metrics = await dialog.evaluate((el) => {
          const rect = el.getBoundingClientRect()
          const btns = [...el.querySelectorAll("button")].map((b) => {
            const br = b.getBoundingClientRect()
            return { text: b.textContent?.trim() ?? "", w: Math.round(br.width), h: Math.round(br.height) }
          })
          return {
            vw: document.documentElement.clientWidth,
            vh: window.innerHeight,
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            scrollW: el.scrollWidth,
            clientW: el.clientWidth,
            btns,
          }
        })
        assert(
          metrics.left >= 0 && metrics.right <= metrics.vw && metrics.scrollW <= metrics.clientW + 1,
          `UX-02 dialog overflow (${stageLabel} ${vp.join("x")}): ${JSON.stringify(metrics)}`,
        )
        assert(
          metrics.top >= 0 && metrics.bottom <= metrics.vh,
          `UX-02 dialog vertical overflow (${stageLabel} ${vp.join("x")}): ${JSON.stringify(metrics)}`,
        )
        for (const b of metrics.btns) {
          assert(
            b.w >= 44 && b.h >= 44,
            `UX-02 dialog button < 44px (${stageLabel} ${vp.join("x")}): ${JSON.stringify(b)}`,
          )
        }
        return dialog
      }

      if ([320, 390, 820, 1440].includes(vp[0])) {
        // 1) Normal approve ("Duyệt hủy"): open -> no API -> Huỷ bỏ closes & returns focus
        const normalBtn = page.getByRole("button", { name: "Duyệt hủy", exact: true })
        await normalBtn.click()
        const normalDialog = await assertOpenDialogLayout("normal")
        assert.equal(approveNormalPayloads.length, 0, "UX-02: opening normal dialog must not call API")
        await expect(normalDialog).toContainText("Khoai tây chiên sốt Truffle")
        await expect(normalDialog).toContainText("1 phần")
        await expect(normalDialog).toContainText("Bàn A1 + A2 · đơn 1")
        await expect(normalDialog).toContainText("145.000đ")
        assert.equal(
          (await normalDialog.textContent())?.includes("Ghi hao món đã làm - tính vào hao hụt"),
          false,
          "UX-02: normal dialog must not show waste warning",
        )
        assert.equal(
          await normalDialog.getByRole("button", { name: "Xác nhận", exact: true }).getAttribute("data-variant"),
          "default",
        )
        if (vp[0] === 390) await saveShot(page, `ux02-confirm-normal-${vp.join("x")}.png`)
        await normalDialog.getByRole("button", { name: "Huỷ bỏ", exact: true }).click()
        await expect(page.getByRole("alertdialog")).toHaveCount(0)
        assert.equal(approveNormalPayloads.length, 0, "UX-02: Huỷ bỏ must not call API")
        await expect(normalBtn).toBeFocused()

        // 2) Waste approve ("Duyệt ghi hao"): open -> no API -> screenshot -> Esc closes & returns focus
        const wasteBtn = page.getByRole("button", { name: "Duyệt ghi hao", exact: true })
        await wasteBtn.click()
        const wasteDialog = await assertOpenDialogLayout("waste")
        assert.equal(approveWastePayloads.length, 0, "UX-02: opening waste dialog must not call API")
        await expect(wasteDialog).toContainText("21GAM Negroni Khói Quế")
        await expect(wasteDialog).toContainText("1 phần")
        await expect(wasteDialog).toContainText("Bàn A3 · đơn 1")
        await expect(wasteDialog).toContainText("220.000đ")
        await expect(wasteDialog).toContainText("Ghi hao món đã làm - tính vào hao hụt")
        assert.equal(
          await wasteDialog.getByRole("button", { name: "Xác nhận", exact: true }).getAttribute("data-variant"),
          "destructive",
        )
        await saveShot(page, `ux02-confirm-waste-${vp.join("x")}.png`)
        await page.keyboard.press("Escape")
        await expect(page.getByRole("alertdialog")).toHaveCount(0)
        assert.equal(approveWastePayloads.length, 0, "UX-02: Escape must not call API")
        await expect(wasteBtn).toBeFocused()

        // 3) Group approve ("Duyệt cả đơn"): open -> no API -> Esc closes & returns focus
        const groupBtn = page.getByRole("button", { name: "Duyệt cả đơn", exact: true })
        await groupBtn.click()
        const groupDialog = await assertOpenDialogLayout("group")
        assert.equal(approveGroupPayloads.length, 0, "UX-02: opening group dialog must not call API")
        await expect(groupDialog).toContainText("Old Fashioned")
        await expect(groupDialog).toContainText("1 phần (1 dòng món)")
        await expect(groupDialog).toContainText("Đơn 2 · Bàn BAR01")
        await expect(groupDialog).toContainText("250.000đ")
        await expect(groupDialog).toContainText("Ghi hao món đã làm - tính vào hao hụt")
        assert.equal(
          await groupDialog.getByRole("button", { name: "Xác nhận", exact: true }).getAttribute("data-variant"),
          "destructive",
        )
        if (vp[0] === 390) await saveShot(page, `ux02-confirm-group-${vp.join("x")}.png`)
        await page.keyboard.press("Escape")
        await expect(page.getByRole("alertdialog")).toHaveCount(0)
        assert.equal(approveGroupPayloads.length, 0)
        await expect(groupBtn).toBeFocused()
      }

      if (vp[0] === 390) {
        // 4) Reject ("Từ chối") works directly without confirmation dialog
        await page.getByRole("button", { name: "Từ chối", exact: true }).first().click()
        await expect.poll(() => rejectNormalPayloads.length).toBe(1)
        assert.equal(await page.getByRole("alertdialog").count(), 0, "UX-02: reject must not open dialog")
        assert.equal(rejectNormalPayloads[0]?.expectedVersion, 1)
        assert.equal(typeof rejectNormalPayloads[0]?.idempotencyKey, "string")

        // 5) Keyboard Tab/Enter/Esc + payload + sending state ("Đang duyệt...") on waste approve
        const noteInput = page.getByLabel("Ghi chú quyết định cho yêu cầu 2", { exact: true })
        await noteInput.fill("Khách đổi món khác")
        const wasteBtn = page.getByRole("button", { name: "Duyệt ghi hao", exact: true })
        await wasteBtn.focus()
        await page.keyboard.press("Enter")
        await expect(page.getByRole("alertdialog")).toBeVisible()
        await page.keyboard.press("Escape")
        await expect(page.getByRole("alertdialog")).toHaveCount(0)
        await expect(wasteBtn).toBeFocused()

        await page.keyboard.press("Enter")
        const dialog = page.getByRole("alertdialog")
        await expect(dialog).toBeVisible()
        for (let step = 0; step < 4; step++) {
          const activeText = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "")
          if (activeText === "Xác nhận") break
          await page.keyboard.press("Tab")
        }
        assert.equal(
          await page.evaluate(() => document.activeElement?.textContent?.trim()),
          "Xác nhận",
          "UX-02: Tab must focus Xác nhận button inside dialog",
        )

        wasteDelayMs = 300
        await page.keyboard.press("Enter")
        await expect(dialog.getByRole("button", { name: "Đang duyệt...", exact: true })).toBeDisabled()
        await expect(dialog.getByRole("button", { name: "Huỷ bỏ", exact: true })).toBeDisabled()
        await expect.poll(() => approveWastePayloads.length).toBe(1)
        assert.equal(approveWastePayloads[0]?.expectedVersion, 1)
        assert.equal(approveWastePayloads[0]?.note, "Khách đổi món khác")
        assert.equal(typeof approveWastePayloads[0]?.idempotencyKey, "string")
        await expect(page.getByRole("alertdialog")).toHaveCount(0)

        // 6) Confirm normal approve & group approve each call API exactly once with original payload
        await page.getByRole("button", { name: "Duyệt hủy", exact: true }).click()
        await page.getByRole("alertdialog").getByRole("button", { name: "Xác nhận", exact: true }).click()
        await expect.poll(() => approveNormalPayloads.length).toBe(1)
        assert.equal(approveNormalPayloads[0]?.expectedVersion, 1)
        assert.equal(typeof approveNormalPayloads[0]?.idempotencyKey, "string")
        await expect(page.getByRole("alertdialog")).toHaveCount(0)

        await page.getByRole("button", { name: "Duyệt cả đơn", exact: true }).click()
        await page.getByRole("alertdialog").getByRole("button", { name: "Xác nhận", exact: true }).click()
        await expect.poll(() => approveGroupPayloads.length).toBe(1)
        assert.equal(typeof approveGroupPayloads[0]?.idempotencyKey, "string")
        await expect(page.getByRole("alertdialog")).toHaveCount(0)
      }
      checks++
    } finally {
      await context.close()
    }
  }

  // Dark mode (Service) check on /duyet-huy-mon for INT-R03
  {
    const { context, page, consoleErrors } = await openContext(browser, [1440, 900], { dark: true })
    try {
      await page.route("**/api/v1/auth/me", (route) =>
        route.fulfill({
          json: makeSession({
            roles: ["OWNER"],
            portal: "admin",
            displayName: "Chủ quán",
            permissions: ["order.cancel.approve"],
          }),
        }),
      )
      await page.route("**/api/v1/orders/cancellations?*", (route) =>
        route.fulfill({ json: { pendingCount: 3, entries: cancellationQueueEntries } }),
      )
      await page.goto(`${vite.baseUrl}/duyet-huy-mon`, { waitUntil: "networkidle" })
      await expect(page.getByRole("heading", { name: "Phê duyệt hủy món" })).toBeVisible()
      await runAuditProbes(page, "/duyet-huy-mon dark 1440x900", {
        allowContrastTargets: ["text-destructive"],
      })
      const darkCalloutColor = await page.evaluate(() => {
        const p = [...document.querySelectorAll("p")].find((el) =>
          el.textContent?.includes("duyệt nghĩa là ghi hao số này"),
        )
        return p ? getComputedStyle(p).color : null
      })
      assert(
        darkCalloutColor && darkCalloutColor !== "rgb(252, 165, 165)",
        `INT-R03: dark waste callout must use --destructive (${darkCalloutColor})`,
      )
      await saveShot(page, "owner-duyet-huy-mon-dark-1440x900.png")
      assert.deepEqual(consoleErrors, [], `/duyet-huy-mon dark console errors: ${consoleErrors}`)
      checks++
    } finally {
      await context.close()
    }
  }

  // 5. UX-12 & INT-R02: Login 5 portals + keyboard viewports (375x420, 390x500) + error state + PasswordChangeGate
  const PORTALS = ["letan", "thungan", "phucvu", "chebien", "admin"]
  for (const portal of PORTALS) {
    const viewports =
      portal === "letan"
        ? [...MATRIX_9, [375, 420], [390, 500]]
        : [
            [390, 844],
            [1440, 900],
          ]
    for (const vp of viewports) {
      const { context, page, consoleErrors } = await openContext(browser, vp)
      try {
        await page.route("**/api/v1/**", (route) => {
          if (new URL(route.request().url()).pathname === "/api/v1/auth/login") {
            return route.fulfill({
              status: 401,
              json: { error: { code: "INVALID_CREDENTIALS", message: "Sai tên đăng nhập hoặc mật khẩu." } },
            })
          }
          return route.fulfill({
            status: 401,
            json: { error: { code: "AUTHENTICATION_REQUIRED", message: "Chưa đăng nhập" } },
          })
        })
        await page.goto(`${vite.baseUrl}/${portal}/login`, { waitUntil: "networkidle" })
        await expect(page.getByLabel("Tên đăng nhập", { exact: true })).toBeVisible()
        await runAuditProbes(page, `/${portal}/login ${vp.join("x")}`, { allow401: true })
        assert.deepEqual(consoleErrors, [], `/${portal}/login console errors: ${consoleErrors}`)

        if (vp[1] <= 500 || (portal === "letan" && vp[0] === 1440)) {
          const usernameInput = page.getByLabel("Tên đăng nhập", { exact: true })
          const passwordInput = page.getByLabel("Mật khẩu", { exact: true })
          const togglePwdBtn = page.getByRole("button", { name: "Hiện mật khẩu", exact: true })
          // Tab forward & backward across form controls
          await usernameInput.focus()
          await page.keyboard.press("Tab")
          assert.equal(await page.evaluate(() => document.activeElement?.id), "password")
          await page.keyboard.press("Tab")
          assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Hiện mật khẩu")
          await page.keyboard.press("Shift+Tab")
          assert.equal(await page.evaluate(() => document.activeElement?.id), "password")

          // Toggle show password and verify focus stays intact and viewport contains password + submit
          await togglePwdBtn.click()
          await expect(page.getByRole("button", { name: "Ẩn mật khẩu", exact: true })).toHaveAttribute(
            "aria-pressed",
            "true",
          )
          await passwordInput.focus()
          await page.waitForTimeout(150)

          const assertLoginViewport = async (stage) => {
            const layout = await page.evaluate(() => {
              const pwd = document.getElementById("password")
              const submit = document.querySelector('button[type="submit"]')
              const pwdBox = pwd?.getBoundingClientRect()
              const subBox = submit?.getBoundingClientRect()
              return {
                vh: window.innerHeight,
                pwdTop: pwdBox?.top ?? -1,
                pwdBottom: pwdBox?.bottom ?? 9999,
                subTop: subBox?.top ?? -1,
                subBottom: subBox?.bottom ?? 9999,
              }
            })
            assert(
              layout.pwdTop >= 0 && layout.pwdBottom <= layout.vh,
              `UX-12 ${vp.join("x")} (${stage}): password input outside viewport (${JSON.stringify(layout)})`,
            )
            assert(
              layout.subTop >= 0 && layout.subBottom <= layout.vh,
              `UX-12 ${vp.join("x")} (${stage}): submit button clipped below viewport (${JSON.stringify(layout)})`,
            )
          }
          await assertLoginViewport("shown-password")
          if (vp[1] <= 500) {
            await saveShot(
              page,
              vp[0] === 375 ? "login-letan-login-keyboard-se-375x420.png" : "login-letan-login-keyboard-390x500.png",
            )
          }

          // Trigger error alert and re-focus password -> input & submit CTA remain visible
          await usernameInput.fill("letan1")
          await passwordInput.fill("wrongpass1234")
          await page.getByRole("button", { name: "Đăng nhập", exact: true }).click()
          await expect(page.getByRole("alert")).toBeVisible()
          await passwordInput.focus()
          await page.waitForTimeout(150)
          await assertLoginViewport("after-error")
        } else {
          await saveShot(page, `login-${portal}-login-empty-${vp.join("x")}.png`)
        }
        checks++
      } finally {
        await context.close()
      }
    }
  }

  // INT-R02: PasswordChangeGate at 375x420, 390x500, and 1440x900
  for (const vp of [
    [375, 420],
    [390, 500],
    [1440, 900],
  ]) {
    const { context, page, consoleErrors } = await openContext(browser, vp)
    try {
      await page.route("**/api/v1/auth/me", (route) =>
        route.fulfill({
          json: {
            ...makeSession({
              roles: ["RECEPTIONIST"],
              portal: "receptionist",
              displayName: "Lễ tân 1",
              permissions: [],
            }),
            mustChangePassword: true,
          },
        }),
      )
      await page.goto(`${vite.baseUrl}/floor`, { waitUntil: "networkidle" })
      await expect(page.getByRole("heading", { name: "Đổi mật khẩu trước khi tiếp tục" })).toBeVisible()
      await runAuditProbes(page, `password-change-gate ${vp.join("x")}`)
      const confirmInput = page.getByLabel("Nhập lại mật khẩu mới", { exact: true })
      await confirmInput.focus()
      await page.waitForTimeout(150)
      const gateLayout = await page.evaluate(() => {
        const inp = document.getElementById("pwd-confirm")
        const submit = document.querySelector('button[type="submit"]')
        const ir = inp?.getBoundingClientRect()
        const sr = submit?.getBoundingClientRect()
        return {
          vh: window.innerHeight,
          inpTop: ir?.top ?? -1,
          inpBottom: ir?.bottom ?? 9999,
          subTop: sr?.top ?? -1,
          subBottom: sr?.bottom ?? 9999,
        }
      })
      assert(
        gateLayout.inpTop >= 0 && gateLayout.inpBottom <= gateLayout.vh,
        `INT-R02 PasswordChangeGate ${vp.join("x")}: confirm input outside viewport (${JSON.stringify(gateLayout)})`,
      )
      assert(
        gateLayout.subTop >= 0 && gateLayout.subBottom <= gateLayout.vh,
        `INT-R02 PasswordChangeGate ${vp.join("x")}: submit button outside viewport (${JSON.stringify(gateLayout)})`,
      )
      assert.deepEqual(consoleErrors, [], `password-change-gate console errors: ${consoleErrors}`)
      checks++
    } finally {
      await context.close()
    }
  }

  console.log(`PB E2E PASS: ${JSON.stringify({ checks })}`)
} finally {
  await browser.close()
  await vite.close()
}

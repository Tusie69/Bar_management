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

async function runAuditProbes(page, label, { allow401 = false, checkSmallFonts = true, axeExclude = [] } = {}) {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(150)

  await page.evaluate(axe.source)
  const axeViolations = await page.evaluate(async (excludes) => {
    const context = excludes.length ? { exclude: excludes } : document
    return (await window.axe.run(context, { resultTypes: ["violations"] })).violations
      .filter((v) => ["serious", "critical"].includes(v.impact))
      .map((v) => ({ id: v.id, impact: v.impact, targets: v.nodes.map((n) => n.target) }))
  }, axeExclude)
  assert.deepEqual(axeViolations, [], `${label}: axe serious/critical violations: ${JSON.stringify(axeViolations)}`)

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

        // Verify DS-05 callouts & UX-03 warning chip exist
        const hasWarningChip = await page.locator('[data-wait-tone="warning"]').count()
        assert(hasWarningChip > 0, "Expected warning wait chip on /chebien")

        await saveShot(page, `${role}-chebien-busy-${vp.join("x")}.png`)
        checks++
      } finally {
        await context.close()
      }
    }
  }

  // Dark mode (Service) check on /chebien for UX-03 & DS-05 contrast
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
      await runAuditProbes(page, "bar /chebien dark 1440x900")
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
    let approveHit = false
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
      await page.route("**/api/v1/orders/cancellations/2/approve", (route) => {
        approveHit = true
        return route.fulfill({ json: { cancellationId: 2, status: "APPROVED", version: 2 } })
      })

      await page.goto(`${vite.baseUrl}/duyet-huy-mon`, { waitUntil: "networkidle" })
      await expect(page.getByRole("heading", { name: "Phê duyệt hủy món" })).toBeVisible()
      await runAuditProbes(page, `/duyet-huy-mon ${vp.join("x")}`)
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

      await saveShot(page, `owner-duyet-huy-mon-busy-${vp.join("x")}.png`)

      // Verify UX-02 constraint: NO confirmation dialog added, 1-click triggers approve directly
      if (vp[0] === 390) {
        await page.getByRole("button", { name: "Duyệt ghi hao" }).click()
        await expect.poll(() => approveHit).toBe(true)
        assert.equal(await page.getByRole("alertdialog").count(), 0, "UX-02: must not add confirmation dialog")
      }
      checks++
    } finally {
      await context.close()
    }
  }

  // 5. UX-12: Login 5 portals + keyboard viewports (375x420, 390x500)
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
        await page.route("**/api/v1/**", (route) =>
          route.fulfill({
            status: 401,
            json: { error: { code: "AUTHENTICATION_REQUIRED", message: "Chưa đăng nhập" } },
          }),
        )
        await page.goto(`${vite.baseUrl}/${portal}/login`, { waitUntil: "networkidle" })
        await expect(page.getByLabel("Tên đăng nhập", { exact: true })).toBeVisible()
        await runAuditProbes(page, `/${portal}/login ${vp.join("x")}`, { allow401: true })
        assert.deepEqual(consoleErrors, [], `/${portal}/login console errors: ${consoleErrors}`)

        if (vp[1] <= 500) {
          const passwordInput = page.getByLabel("Mật khẩu", { exact: true })
          await passwordInput.focus()
          await page.waitForTimeout(150)
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
            `UX-12 ${vp.join("x")}: password input outside viewport (${JSON.stringify(layout)})`,
          )
          assert(
            layout.subTop >= 0 && layout.subBottom <= layout.vh,
            `UX-12 ${vp.join("x")}: submit button clipped below viewport (${JSON.stringify(layout)})`,
          )
          await saveShot(
            page,
            vp[0] === 375 ? "login-letan-login-keyboard-se-375x420.png" : "login-letan-login-keyboard-390x500.png",
          )
        } else {
          await saveShot(page, `login-${portal}-login-empty-${vp.join("x")}.png`)
        }
        checks++
      } finally {
        await context.close()
      }
    }
  }

  console.log(`PB E2E PASS: ${JSON.stringify({ checks })}`)
} finally {
  await browser.close()
  await vite.close()
}

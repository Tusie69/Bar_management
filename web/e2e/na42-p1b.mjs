/**
 * NA-42 P1B — Nghiệm thu UI-20..UI-22 & UI-30..UI-35 trên mock Vite server.
 *
 * Chạy: `E2E_BASE_URL=http://127.0.0.1:15191 node web/e2e/na42-p1b.mjs`
 */
import fs from "node:fs"
import { chromium, expect } from "@playwright/test"

const base = process.env.E2E_BASE_URL ?? "http://127.0.0.1:15191"
const chrome = process.env.PW_CHROMIUM_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe"
const browser = await chromium.launch(fs.existsSync(chrome) ? { executablePath: chrome } : {})

const NOW = "2026-11-23T12:10:00.000Z"

function makeSession({ roles, portal, permissions, displayName }) {
  return {
    user: {
      id: 42,
      username: "na42_e2e",
      displayName,
      organizationId: 1,
      venueId: 1,
      roles,
      accessLevel: null,
    },
    permissions,
    csrfToken: "na42-e2e-csrf",
    portal,
    mustChangePassword: false,
  }
}

async function openContext(viewport) {
  const context = await browser.newContext({
    viewport,
    isMobile: viewport.width < 768,
    hasTouch: viewport.width <= 1024,
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
  })
  await context.addInitScript(() => {
    class QuietEventSource {
      addEventListener() {}
      removeEventListener() {}
      close() {}
    }
    Object.defineProperty(window, "EventSource", { value: QuietEventSource })
  })
  const page = await context.newPage()
  await page.clock.setFixedTime(new Date(NOW))
  return { context, page }
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
  zones: [{ id: 1, version: 1, code: "A", name: "Khu A", isBookable: true, isWaitingArea: false }],
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
      x: 120,
      y: 220,
      width: 90,
      height: 70,
    },
    {
      id: 101,
      version: 1,
      code: "BAR01",
      displayName: "Ghế Bar 1",
      zoneId: 1,
      zoneCode: "A",
      kind: "BAR_SEAT",
      capacity: 1,
      seqNo: 1,
      isSpare: false,
      status: "ACTIVE",
      x: 280,
      y: 420,
      width: 18,
      height: 18,
    },
  ],
  combinations: [],
}

const servicePayload = {
  businessDate: "2026-11-23",
  serverNow: NOW,
  changeSeq: "1",
  groups: [],
  tables: [
    {
      tableId: 1,
      tableCode: "A1",
      catalogStatus: "ACTIVE",
      isSpare: false,
      displayState: "EMPTY",
      arrivalPhase: null,
      arrivalTime: null,
      minutesLate: 0,
      claim: null,
      groupId: null,
      groupDisplayCode: null,
      groupMemberTableIds: [],
      staleFromPreviousDay: false,
      waiterPhase: null,
    },
    {
      tableId: 101,
      tableCode: "BAR01",
      catalogStatus: "ACTIVE",
      isSpare: false,
      displayState: "EMPTY",
      arrivalPhase: null,
      arrivalTime: null,
      minutesLate: 0,
      claim: null,
      groupId: null,
      groupDisplayCode: null,
      groupMemberTableIds: [],
      staleFromPreviousDay: false,
      waiterPhase: null,
    },
  ],
}

function makeLongLines(count, doneQuantity = 0) {
  return Array.from({ length: count }, (_, idx) => ({
    lineNo: idx + 1,
    itemName: `Món thử dài ${idx + 1}`,
    variantDisplayName: "Ly",
    menuItemVariantId: 200 + idx,
    unitCode: "GLASS",
    quantity: 2,
    cancelledQuantity: 0,
    originalQuantity: 2,
    doneQuantity,
    progressVersion: doneQuantity > 0 ? 1 : 0,
    note: "Ghi chú: Ít đá, để riêng sốt và báo lại nhân viên khi món sẵn sàng.",
    pendingCancellation: null,
  }))
}

function makePrepTickets(firstStatus = "SUBMITTED", firstVersion = 1, station = "BAR", options = {}) {
  const tickets = [
    {
      ticketId: 1,
      orderId: 101,
      visitId: 1,
      visitSequence: 1,
      station,
      status: firstStatus,
      version: firstVersion,
      submittedAt: "2026-11-23T12:00:00.000Z",
      acceptedAt: null,
      startedAt: null,
      readyAt: null,
      collectedAt: null,
      waitSeconds: 600,
      tableCodes: ["A1", "A2"],
      orderedByDisplayName: "E2E Phục vụ",
      guestFlags: { vip: false, birthday: false, designated: false },
      lines: makeLongLines(10),
    },
    {
      ticketId: 2,
      orderId: 102,
      visitId: 2,
      visitSequence: 1,
      station,
      status: "ACCEPTED",
      version: 2,
      submittedAt: "2026-11-23T12:01:00.000Z",
      acceptedAt: "2026-11-23T12:02:00.000Z",
      startedAt: null,
      readyAt: null,
      collectedAt: null,
      waitSeconds: 540,
      tableCodes: ["A3"],
      orderedByDisplayName: "E2E Phục vụ",
      guestFlags: { vip: true, birthday: false, designated: false },
      lines: makeLongLines(2),
    },
    {
      ticketId: 3,
      orderId: 103,
      visitId: 3,
      visitSequence: 1,
      station,
      status: "PREPARING",
      version: 3,
      submittedAt: "2026-11-23T12:02:00.000Z",
      acceptedAt: "2026-11-23T12:03:00.000Z",
      startedAt: "2026-11-23T12:04:00.000Z",
      readyAt: null,
      collectedAt: null,
      waitSeconds: 480,
      tableCodes: ["A4"],
      orderedByDisplayName: "E2E Phục vụ",
      guestFlags: { vip: false, birthday: false, designated: false },
      lines: makeLongLines(options.preparingLines ?? 1),
    },
    {
      ticketId: 4,
      orderId: 104,
      visitId: 4,
      visitSequence: 1,
      station,
      status: "READY",
      version: 4,
      submittedAt: "2026-11-23T12:05:00.000Z",
      acceptedAt: "2026-11-23T12:06:00.000Z",
      startedAt: "2026-11-23T12:07:00.000Z",
      readyAt: "2026-11-23T12:09:00.000Z",
      collectedAt: null,
      waitSeconds: 300,
      tableCodes: ["BAR01"],
      orderedByDisplayName: "E2E Phục vụ",
      guestFlags: { vip: false, birthday: false, designated: false },
      lines: makeLongLines(1),
    },
  ]
  if (options.includeCompletePreparing) {
    tickets.push({
      ticketId: 5,
      orderId: 105,
      visitId: 5,
      visitSequence: 1,
      station,
      status: "PREPARING",
      version: 1,
      submittedAt: "2026-11-23T12:03:00.000Z",
      acceptedAt: "2026-11-23T12:04:00.000Z",
      startedAt: "2026-11-23T12:05:00.000Z",
      readyAt: null,
      collectedAt: null,
      waitSeconds: 420,
      tableCodes: ["B1"],
      orderedByDisplayName: "E2E Phục vụ",
      guestFlags: { vip: false, birthday: false, designated: false },
      lines: makeLongLines(1, 2),
    })
  }
  return tickets
}

async function setupWaiterRoutes(page) {
  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({
      json: makeSession({
        roles: ["WAITER"],
        portal: "waiter",
        displayName: "Phục vụ E2E",
        permissions: ["order.read", "order.create", "order.cancel.request"],
      }),
    }),
  )
  await page.route("**/api/v1/tables/catalog", (route) => route.fulfill({ json: catalogPayload }))
  await page.route("**/api/v1/tables/service?*", (route) => route.fulfill({ json: servicePayload }))
  await page.route("**/api/v1/preparation/ready-notifications", (route) =>
    route.fulfill({ json: { notifications: [] } }),
  )
  await page.route("**/api/v1/waiter/notifications", (route) => route.fulfill({ json: { notifications: [] } }))
  await page.route("**/api/v1/waiter/visits/*/ordering", (route) => route.fulfill({ json: {} }))
  await page.route("**/api/v1/waiter/menu?*", (route) =>
    route.fulfill({
      json: {
        catalogVersion: "1",
        visit: {
          visitId: 1,
          tableCodes: ["A1", "A2"],
          guestCount: 2,
          startedAt: "2026-11-23T11:30:00.000Z",
        },
        categories: [{ id: 1, code: "BEER", name: "Bia", displayOrder: 1 }],
        items: [
          {
            id: 1,
            code: "SG",
            categoryId: 1,
            name: "Bia Sài Gòn Special",
            description: null,
            preparationStation: "BAR",
            availabilityStatus: "AVAILABLE",
            displayOrder: 1,
            variants: [
              {
                variantId: 11,
                unitCode: "CAN",
                displayName: "Lon",
                quantityInUnit: null,
                availabilityStatus: "AVAILABLE",
                amountVnd: 65000,
                priceId: 1,
                priceVersion: 1,
                effectiveFrom: "2026-01-01T00:00:00.000Z",
              },
              {
                variantId: 12,
                unitCode: "BOTTLE",
                displayName: "Chai",
                quantityInUnit: null,
                availabilityStatus: "AVAILABLE",
                amountVnd: 65000,
                priceId: 2,
                priceVersion: 1,
                effectiveFrom: "2026-01-01T00:00:00.000Z",
              },
            ],
          },
          {
            id: 2,
            code: "MAC",
            categoryId: 1,
            name: "Macallan 12",
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
                priceId: 3,
                priceVersion: 1,
                effectiveFrom: "2026-01-01T00:00:00.000Z",
              },
              {
                variantId: 22,
                unitCode: "BOTTLE",
                displayName: "Chai",
                quantityInUnit: null,
                availabilityStatus: "AVAILABLE",
                amountVnd: 2300000,
                priceId: 4,
                priceVersion: 1,
                effectiveFrom: "2026-01-01T00:00:00.000Z",
              },
            ],
          },
          {
            id: 3,
            code: "GIN",
            categoryId: 1,
            name: "Gin Tonic vỏ bưởi",
            description: null,
            preparationStation: "BAR",
            availabilityStatus: "AVAILABLE",
            displayOrder: 3,
            variants: [
              {
                variantId: 31,
                unitCode: "GLASS",
                displayName: "Ly",
                quantityInUnit: null,
                availabilityStatus: "AVAILABLE",
                amountVnd: 95000,
                priceId: 5,
                priceVersion: 1,
                effectiveFrom: "2026-01-01T00:00:00.000Z",
              },
            ],
          },
        ],
      },
    }),
  )
}

try {
  // 1. UI-20 + UI-22 on /phucvu at 320x640, 640x400, 820x1180, 1440x900
  for (const vp of [
    { width: 320, height: 640 },
    { width: 640, height: 400 },
    { width: 820, height: 1180 },
    { width: 1440, height: 900 },
  ]) {
    const { context, page } = await openContext(vp)
    try {
      await setupWaiterRoutes(page)
      await page.goto(`${base}/phucvu`, { waitUntil: "networkidle" })
      await expect(page.getByRole("group", { name: "Sơ đồ bàn ca hiện tại" })).toBeVisible()
      // UI-22: WAITER does not see queue button
      await expect(page.getByRole("button", { name: /Hàng đợi/ })).toHaveCount(0)
      // UI-20 (owner decision B): centered max-w-3xl shell, full plan fits without vertical scroll, real plan/table bounds
      const dims = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth
        const main = document.querySelector("main")
        const svg = document.querySelector('svg[aria-label="Sơ đồ bàn ca hiện tại"]')
        const bg = svg?.querySelector('rect[data-bg="1"]')
        const mainRect = main?.getBoundingClientRect()
        const svgRect = svg?.getBoundingClientRect()
        const bgRect = bg?.getBoundingClientRect()
        return {
          vw,
          overflowX: document.documentElement.scrollWidth > vw,
          overflowY: document.documentElement.scrollHeight > window.innerHeight,
          mainWidth: mainRect ? Math.round(mainRect.width) : 0,
          svgHeight: svgRect ? Math.round(svgRect.height) : 0,
          bgWidth: bgRect ? Number(bgRect.width.toFixed(2)) : 0,
          bgHeight: bgRect ? Number(bgRect.height.toFixed(2)) : 0,
          bgFitsVertically: bgRect && svgRect ? bgRect.bottom <= svgRect.bottom + 1 : false,
        }
      })
      expect(dims.overflowX).toBe(false)
      expect(dims.overflowY).toBe(false)
      expect(dims.mainWidth).toBe(Math.min(dims.vw, 768))
      expect(dims.bgWidth).toBeGreaterThan(vp.height < 500 ? 120 : 250)
      expect(dims.bgFitsVertically).toBe(true)
      // Last table (BAR01) reachable without scroll
      await page.getByRole("button", { name: /BAR01|Ghế Bar 1/ }).click()
      await expect(page.getByRole("dialog").or(page.locator("[data-mobile-table-sheet]"))).toBeVisible()
      console.log(
        `PASS UI-20/UI-22 /phucvu ${vp.width}x${vp.height}: main=${dims.mainWidth}px bg=${dims.bgWidth}x${dims.bgHeight}px`,
      )
    } finally {
      await context.close()
    }
  }

  // Verify /phucvu/phien/1/goi-mon stays centered (max-w-3xl) on 1440x900 and no horizontal overflow at 640x400
  for (const vp of [
    { width: 640, height: 400 },
    { width: 1440, height: 900 },
  ]) {
    const { context, page } = await openContext(vp)
    try {
      await setupWaiterRoutes(page)
      await page.goto(`${base}/phucvu/phien/1/goi-mon`, { waitUntil: "networkidle" })
      const metrics = await page.evaluate(() => ({
        vw: document.documentElement.clientWidth,
        overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        mainWidth: Math.round(document.querySelector("main").getBoundingClientRect().width),
      }))
      expect(metrics.overflowX).toBe(false)
      expect(metrics.mainWidth).toBe(Math.min(metrics.vw, 768))
      console.log(`PASS /phucvu/phien/1/goi-mon ${vp.width}x${vp.height}: main=${metrics.mainWidth}px`)
    } finally {
      await context.close()
    }
  }

  // 2. UI-21 on /phucvu/phien/1/goi-mon + UI-22 on /phucvu/hang-doi (WAITER)
  {
    const { context, page } = await openContext({ width: 390, height: 844 })
    try {
      await setupWaiterRoutes(page)
      await page.goto(`${base}/phucvu/phien/1/goi-mon`, { waitUntil: "networkidle" })
      await expect(page.getByText("65.000đ", { exact: true })).toBeVisible()
      await expect(page.getByText("65.000đ – 65.000đ")).toHaveCount(0)
      await expect(page.getByText("280.000đ – 2.300.000đ", { exact: true })).toBeVisible()
      await expect(page.getByText("95.000đ · Ly", { exact: true })).toBeVisible()
      console.log("PASS UI-21 single price when min === max")

      await page.goto(`${base}/phucvu/hang-doi`, { waitUntil: "networkidle" })
      await expect(page.getByRole("heading", { name: "Không có quyền xem hàng đợi Bar" })).toBeVisible()
      const bodyText = await page.locator("main").innerText()
      expect(bodyText).not.toContain("preparation.bar.read")
      expect(bodyText).not.toContain("Backend")
      console.log("PASS UI-22 WAITER queue denial without permission code")
    } finally {
      await context.close()
    }
  }

  // 3. UI-30, UI-31, UI-32, UI-33, UI-34 on /chebien
  for (const vp of [
    { width: 320, height: 640 },
    { width: 390, height: 844 },
    { width: 820, height: 1180 },
    { width: 1440, height: 900 },
  ]) {
    const { context, page } = await openContext(vp)
    let firstStatus = "SUBMITTED"
    let firstVersion = 1
    let transitionCount = 0

    await page.route("**/api/v1/auth/me", (route) =>
      route.fulfill({
        json: makeSession({
          roles: ["BAR"],
          portal: "preparation",
          displayName: "Bar E2E",
          permissions: ["preparation.bar.read", "preparation.bar.transition"],
        }),
      }),
    )
    await page.route("**/api/v1/preparation/BAR/tickets", (route) =>
      route.fulfill({
        json: {
          station: "BAR",
          changeCursor: "89",
          generatedAt: NOW,
          printing: { enabled: false },
          limit: 200,
          tickets: makePrepTickets(firstStatus, firstVersion),
        },
      }),
    )
    await page.route("**/api/v1/preparation/BAR/tickets/1/transition", async (route) => {
      transitionCount += 1
      firstStatus = "ACCEPTED"
      firstVersion = 2
      await route.fulfill({ json: { ticket: makePrepTickets(firstStatus, firstVersion)[0], changeCursor: "90" } })
    })

    try {
      await page.goto(`${base}/chebien`, { waitUntil: "networkidle" })
      const heading = page.getByRole("heading", { name: "Hàng đợi Bar" })
      await expect(heading).toBeVisible()

      // UI-32 & P1B-04: no Cursor 89, short Vietnamese subtitle fits without ellipsis
      const headerMetrics = await page.evaluate(() => {
        const header = document.querySelector("header")
        const subtitle = header.querySelector("p")
        return {
          headerText: header.innerText,
          subtitleText: subtitle?.textContent?.trim() ?? "",
          subtitleClientWidth: subtitle?.clientWidth ?? 0,
          subtitleScrollWidth: subtitle?.scrollWidth ?? 0,
        }
      })
      expect(headerMetrics.headerText).not.toContain("Cursor")
      expect(headerMetrics.subtitleText).toBe("Tự cập nhật")
      if (vp.width <= 390) {
        expect(headerMetrics.subtitleScrollWidth).toBeLessThanOrEqual(headerMetrics.subtitleClientWidth)
      }

      // UI-33: on 320/390, icon buttons stay on title row and >= 44px
      if (vp.width <= 390) {
        const rowCheck = await page.evaluate(() => {
          const header = document.querySelector("header")
          const h1 = header.querySelector("h1")
          const buttons = [...header.querySelectorAll("button")]
          const h1Box = h1.getBoundingClientRect()
          return {
            scrollOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
            buttons: buttons.map((b) => {
              const r = b.getBoundingClientRect()
              return { w: Math.round(r.width), h: Math.round(r.height), dy: Math.abs(r.top - h1Box.top) }
            }),
          }
        })
        expect(rowCheck.scrollOverflow).toBe(false)
        for (const btn of rowCheck.buttons) {
          expect(btn.w).toBeGreaterThanOrEqual(44)
          expect(btn.h).toBeGreaterThanOrEqual(44)
          expect(btn.dy).toBeLessThan(24)
        }
      }

      // UI-30: collapsed < 768px, open >= 768px
      const panel = page.locator("[data-preparation-totals]")
      const toggle = panel.getByRole("button", { name: /Tổng món đang chờ pha/ })
      await expect(toggle).toContainText("26 phần")
      if (vp.width < 768) {
        await expect(toggle).toHaveAttribute("aria-expanded", "false")
        await toggle.click()
        await expect(toggle).toHaveAttribute("aria-expanded", "true")
      } else {
        await expect(toggle).toHaveAttribute("aria-expanded", "true")
      }

      // UI-31: primary action on long ticket is inside header and reachable in initial viewport
      const ticket1 = page.locator('[data-ticket-id="1"]')
      const acceptBtn = ticket1.locator("header").getByRole("button", { name: "Tiếp nhận" })
      await expect(acceptBtn).toBeVisible()
      const btnTop = await acceptBtn.evaluate((el) => el.getBoundingClientRect().top)
      if (vp.width >= 768) {
        expect(btnTop).toBeLessThan(vp.height)
      }

      // UI-34: at 820x1180 check jump nav + drag between columns
      if (vp.width === 820) {
        const nav = page.getByRole("navigation", { name: "Chuyển nhanh theo cột" })
        await expect(nav).toBeVisible()
        await expect(nav).toContainText("Mới nhận (1)")
        await expect(nav).toContainText("Đã tiếp nhận (1)")
        await expect(nav).toContainText("Đang pha (1)")
        await expect(nav).toContainText("Hoàn thành · chờ bàn giao (1)")

        // Drag ticket 1 from SUBMITTED column to ACCEPTED column
        const handle = ticket1.getByRole("button", { name: /Kéo phiếu .* sang cột khác/ })
        const targetCol = page.locator('[data-queue-status="ACCEPTED"]')
        const hBox = await handle.boundingBox()
        const tBox = await targetCol.boundingBox()
        await page.mouse.move(hBox.x + hBox.width / 2, hBox.y + hBox.height / 2)
        await page.mouse.down()
        await page.mouse.move(tBox.x + tBox.width / 2, tBox.y + 40, { steps: 10 })
        await page.mouse.up()
        await expect.poll(() => transitionCount).toBe(1)
        console.log("PASS UI-34 drag-between-columns on 820x1180")
      } else {
        await acceptBtn.click()
        await expect.poll(() => transitionCount).toBe(1)
      }

      console.log(`PASS UI-30..34 ${vp.width}x${vp.height}`)
    } finally {
      await context.close()
    }
  }

  // 3b. P1B-02, P1B-03, P1B-04, P1B-05 checks across BAR, KITCHEN, and embedded /phucvu/hang-doi
  for (const station of ["BAR", "KITCHEN"]) {
    const { context, page } = await openContext({ width: 820, height: 1180 })
    const transitions = []
    let tickets = makePrepTickets("SUBMITTED", 1, station, {
      preparingLines: 10,
      includeCompletePreparing: true,
    })

    await page.route("**/api/v1/auth/me", (route) =>
      route.fulfill({
        json: makeSession({
          roles: [station],
          portal: "preparation",
          displayName: `${station} E2E`,
          permissions: [`preparation.${station.toLowerCase()}.read`, `preparation.${station.toLowerCase()}.transition`],
        }),
      }),
    )
    await page.route(`**/api/v1/preparation/${station}/tickets`, (route) =>
      route.fulfill({
        json: {
          station,
          changeCursor: "89",
          generatedAt: NOW,
          printing: { enabled: false },
          limit: 200,
          tickets,
        },
      }),
    )
    await page.route(`**/api/v1/preparation/${station}/tickets/*/transition`, async (route) => {
      const url = route.request().url()
      const id = Number(url.match(/tickets\/(\d+)\/transition/)?.[1] ?? 0)
      const body = route.request().postDataJSON()
      transitions.push({ id, ...body })
      tickets = tickets.map((t) => (t.ticketId === id ? { ...t, status: body.toStatus, version: t.version + 1 } : t))
      const updated = tickets.find((t) => t.ticketId === id)
      await route.fulfill({ json: { ticket: updated, changeCursor: "90" } })
    })

    try {
      await page.goto(`${base}/chebien`, { waitUntil: "networkidle" })
      await expect(page.getByRole("heading", { name: `Hàng đợi ${station === "BAR" ? "Bar" : "Bếp"}` })).toBeVisible()

      // P1B-02: 10-line PREPARING ticket warning in header above Báo hoàn thành + aria-describedby
      const ticket3 = page.locator('[data-ticket-id="3"]')
      const ticket3Header = ticket3.locator("header")
      const completeBtn = ticket3Header.getByRole("button", { name: "Báo hoàn thành" })
      const warning = ticket3Header.getByRole("status")
      await expect(warning).toHaveText("10 dòng chưa đủ số lượng. Bạn vẫn có thể báo xong nếu đã đối chiếu thực tế.")
      const describedBy = await completeBtn.getAttribute("aria-describedby")
      expect(describedBy).toBe("preparation-ticket-3-incomplete-warning")
      expect(await warning.getAttribute("id")).toBe(describedBy)
      const layout = await ticket3Header.evaluate((hdr) => {
        const w = hdr.querySelector('[role="status"]').getBoundingClientRect()
        const b = hdr.querySelector("[data-ticket-actions]").getBoundingClientRect()
        return { warningBottom: w.bottom, actionsTop: b.top }
      })
      expect(layout.warningBottom).toBeLessThanOrEqual(layout.actionsTop + 1)

      // Complete PREPARING ticket (#5) must NOT have warning or aria-describedby
      const ticket5 = page.locator('[data-ticket-id="5"]')
      await expect(ticket5.locator('[role="status"]')).toHaveCount(0)
      expect(
        await ticket5
          .locator("header")
          .getByRole("button", { name: "Báo hoàn thành" })
          .getAttribute("aria-describedby"),
      ).toBeNull()

      // P1B-03: jump link #queue-READY -> Enter focuses heading -> Tab enters READY column
      const nav = page.getByRole("navigation", { name: "Chuyển nhanh theo cột" })
      const readyLink = nav.locator('a[href="#queue-READY"]')
      await readyLink.focus()
      await page.keyboard.press("Enter")
      const focusAfterEnter = await page.evaluate(() => ({
        id: document.activeElement?.id ?? null,
        tag: document.activeElement?.tagName ?? null,
        tabIndex: document.activeElement?.getAttribute("tabindex") ?? null,
      }))
      expect(focusAfterEnter).toEqual({ id: "queue-READY", tag: "H2", tabIndex: "-1" })
      await page.keyboard.press("Tab")
      const focusInsideReady = await page.evaluate(
        () => !!document.activeElement?.closest('[data-queue-status="READY"]'),
      )
      expect(focusInsideReady).toBe(true)

      // Trigger Báo hoàn thành via keyboard/click -> single POST with toStatus=READY, expectedVersion=3
      await completeBtn.focus()
      await page.keyboard.press("Enter")
      await expect.poll(() => transitions.length).toBe(1)
      expect(transitions[0]).toMatchObject({ id: 3, toStatus: "READY", expectedVersion: 3 })

      // Drag across columns (1: SUBMITTED->ACCEPTED, 2: ACCEPTED->PREPARING) + blocked revert from READY (4->PREPARING)
      for (const [ticketId, toStatus] of [
        [1, "ACCEPTED"],
        [2, "PREPARING"],
      ]) {
        const handle = page.locator(`[data-ticket-id="${ticketId}"]`).getByRole("button", {
          name: /Kéo phiếu .* sang cột khác/,
        })
        const targetCol = page.locator(`[data-queue-status="${toStatus}"]`)
        await handle.scrollIntoViewIfNeeded()
        const hBox = await handle.boundingBox()
        const tBox = await targetCol.boundingBox()
        await page.mouse.move(hBox.x + hBox.width / 2, hBox.y + hBox.height / 2)
        await page.mouse.down()
        await page.mouse.move(tBox.x + tBox.width / 2, tBox.y + 40, { steps: 10 })
        await page.mouse.up()
      }
      await expect.poll(() => transitions.length).toBe(3)

      // Blocked revert from READY -> PREPARING (ticket 3 is now at top of READY beside PREPARING)
      const readyHandle = page.locator('[data-ticket-id="3"]').getByRole("button", {
        name: /Kéo phiếu .* sang cột khác/,
      })
      const prepCol = page.locator('[data-queue-status="PREPARING"]')
      await prepCol.locator("h2").scrollIntoViewIfNeeded()
      const rhBox = await readyHandle.boundingBox()
      const pBox = await prepCol.boundingBox()
      await page.mouse.move(rhBox.x + rhBox.width / 2, rhBox.y + rhBox.height / 2)
      await page.mouse.down()
      await page.mouse.move(pBox.x + pBox.width / 2, pBox.y + 40, { steps: 10 })
      await page.mouse.up()
      await expect(page.getByRole("alert")).toBeVisible()
      expect(transitions.length).toBe(3)
      console.log(`PASS P1B-02/P1B-03 ${station} 820x1180`)
    } finally {
      await context.close()
    }
  }

  // P1B-03 on embedded BAR queue (/phucvu/hang-doi) at 820x1180
  {
    const { context, page } = await openContext({ width: 820, height: 1180 })
    await page.route("**/api/v1/auth/me", (route) =>
      route.fulfill({
        json: makeSession({
          roles: ["BAR"],
          portal: "waiter",
          displayName: "Bar Embedded E2E",
          permissions: ["order.read", "preparation.bar.read", "preparation.bar.transition"],
        }),
      }),
    )
    await page.route("**/api/v1/preparation/BAR/tickets", (route) =>
      route.fulfill({
        json: {
          station: "BAR",
          changeCursor: "89",
          generatedAt: NOW,
          printing: { enabled: false },
          limit: 200,
          tickets: makePrepTickets("SUBMITTED", 1, "BAR"),
        },
      }),
    )
    try {
      await page.goto(`${base}/phucvu/hang-doi`, { waitUntil: "networkidle" })
      const readyLink = page
        .getByRole("navigation", { name: "Chuyển nhanh theo cột" })
        .locator('a[href="#queue-READY"]')
      await readyLink.focus()
      await page.keyboard.press("Enter")
      expect(await page.evaluate(() => document.activeElement?.id)).toBe("queue-READY")
      await page.keyboard.press("Tab")
      expect(await page.evaluate(() => !!document.activeElement?.closest('[data-queue-status="READY"]'))).toBe(true)
      console.log("PASS P1B-03 embedded /phucvu/hang-doi 820x1180")
    } finally {
      await context.close()
    }
  }

  // P1B-04 KITCHEN 320x640 subtitle + P1B-05 1024x768 drag handle >= 44px
  for (const [station, vp] of [
    ["KITCHEN", { width: 320, height: 640 }],
    ["BAR", { width: 1024, height: 768 }],
    ["KITCHEN", { width: 1024, height: 768 }],
  ]) {
    const { context, page } = await openContext(vp)
    await page.route("**/api/v1/auth/me", (route) =>
      route.fulfill({
        json: makeSession({
          roles: [station],
          portal: "preparation",
          displayName: `${station} E2E`,
          permissions: [`preparation.${station.toLowerCase()}.read`, `preparation.${station.toLowerCase()}.transition`],
        }),
      }),
    )
    await page.route(`**/api/v1/preparation/${station}/tickets`, (route) =>
      route.fulfill({
        json: {
          station,
          changeCursor: "89",
          generatedAt: NOW,
          printing: { enabled: false },
          limit: 200,
          tickets: makePrepTickets("SUBMITTED", 1, station),
        },
      }),
    )
    try {
      await page.goto(`${base}/chebien`, { waitUntil: "networkidle" })
      await expect(page.getByRole("heading", { name: `Hàng đợi ${station === "BAR" ? "Bar" : "Bếp"}` })).toBeVisible()
      if (vp.width === 320) {
        const sub = await page.evaluate(() => {
          const p = document.querySelector("header p")
          return {
            text: p?.textContent?.trim(),
            cw: p?.clientWidth ?? 0,
            sw: p?.scrollWidth ?? 0,
            overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          }
        })
        expect(sub.text).toBe("Tự cập nhật")
        expect(sub.sw).toBeLessThanOrEqual(sub.cw)
        expect(sub.overflowX).toBe(false)
      } else {
        const handleBox = await page
          .locator('[data-ticket-id="1"]')
          .getByRole("button", { name: /Kéo phiếu .* sang cột khác/ })
          .boundingBox()
        expect(handleBox.width).toBeGreaterThanOrEqual(44)
        expect(handleBox.height).toBeGreaterThanOrEqual(44)
      }
      console.log(`PASS P1B-04/05 ${station} ${vp.width}x${vp.height}`)
    } finally {
      await context.close()
    }
  }

  // 4. UI-35 on /duyet-huy-mon at 320x640
  {
    const { context, page } = await openContext({ width: 320, height: 640 })
    try {
      await page.route("**/api/v1/auth/me", (route) =>
        route.fulfill({
          json: makeSession({
            roles: ["OWNER"],
            portal: "admin",
            displayName: "Chủ quán E2E",
            permissions: ["order.cancel.approve"],
          }),
        }),
      )
      await page.route("**/api/v1/orders/cancellations?*", (route) =>
        route.fulfill({
          json: {
            pendingCount: 1,
            entries: [
              {
                cancellationId: 1,
                groupId: null,
                visitId: 1,
                visitSequence: 1,
                orderId: 10,
                lineNo: 1,
                tableCodes: ["A1"],
                station: "BAR",
                itemName: "Bia Sài Gòn Special",
                variantDisplayName: "Lon",
                quantity: 1,
                amountVnd: 65000,
                policy: "RETURN",
                ticketStatusAtRequest: "SUBMITTED",
                reason: "Khách đổi ý",
                status: "PENDING",
                requestedByDisplayName: "Phục vụ E2E",
                requestedAt: "2026-11-23T11:50:00.000Z",
                decidedByDisplayName: null,
                decidedAt: null,
                decisionNote: null,
                version: 1,
              },
            ],
          },
        }),
      )
      await page.goto(`${base}/duyet-huy-mon`, { waitUntil: "networkidle" })
      const input = page.getByPlaceholder("Ghi chú (không bắt buộc)")
      await expect(input).toBeVisible()
      const metrics = await input.evaluate((el) => ({
        clientWidth: el.clientWidth,
        scrollWidth: el.scrollWidth,
        height: el.getBoundingClientRect().height,
        pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      }))
      expect(metrics.pageOverflow).toBe(false)
      expect(metrics.height).toBeGreaterThanOrEqual(44)
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1)
      console.log("PASS UI-35 320x640 placeholder fits without truncation")
    } finally {
      await context.close()
    }
  }

  console.log("PASS na42-p1b all checks")
} finally {
  await browser.close()
}

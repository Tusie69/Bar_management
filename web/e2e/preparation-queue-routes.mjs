/**
 * Giai đoạn 3 — nghiệm thu HAI route của hàng đợi chế biến bằng trình duyệt thật.
 *
 * `preparation-queue.mjs` chỉ mở `/chebien` với một phiên BAR ở cổng
 * `preparation`. Hai điều quan trọng nhất của Giai đoạn 3 không được route đó
 * chạm tới:
 *
 * 1. `/phucvu/hang-doi` — cùng component `PreparationQueue` nhưng nhúng trong
 *    `WaiterShell`, cố định station BAR, có nút quay về sơ đồ và KHÔNG có bộ
 *    chọn Bar/Bếp hay nút đăng xuất riêng. Một phiên Bartender ở cổng `waiter`
 *    phải vào thẳng, không bị `WaiterGuard` chặn.
 * 2. `/chebien` với một phiên KITCHEN — màn Bếp phải giữ nguyên ngôn ngữ cũ
 *    ("Đang làm", "Bắt đầu làm") trong khi màn Bar đã đổi sang ngôn ngữ
 *    Bartender ("Đang pha", "Bắt đầu pha"). Nếu presentation map rò rỉ nhãn BAR
 *    sang Bếp thì không test đơn vị nào thấy được, vì nó là lỗi của route.
 *
 * Cả hai kịch bản gửi CÙNG mã state machine lên API; chỉ nhãn khác nhau. Mock
 * bám đúng contract Giai đoạn 2, không có localStorage giả cho badge hay dữ
 * liệu nghiệp vụ.
 *
 * Chạy: `pnpm --filter @21gam/web e2e:preparation-routes` với dev server đang
 * chạy ở `E2E_BASE_URL`.
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { chromium, expect } from "@playwright/test"

const base = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5191"
const output = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), "21gam-preparation-routes")
fs.mkdirSync(output, { recursive: true })
const chrome = process.env.PW_CHROMIUM_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe"
const launchOptions = fs.existsSync(chrome) ? { executablePath: chrome } : {}

const viewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
]

/** Mốc cố định để nhãn chờ và tone cảnh báo là tất định. */
const NOW = "2030-10-24T12:10:00.000Z"
const BUSINESS_DATE = "2030-10-24"

function session({ roles, portal, permissions, displayName }) {
  return {
    user: { id: 41, username: "prep_e2e", displayName, organizationId: 1, venueId: 1, roles, accessLevel: null },
    permissions,
    csrfToken: "preparation-routes-csrf",
    portal,
    mustChangePassword: false,
  }
}

/** Dòng phiếu theo đúng contract Preparation Giai đoạn 4C1. */
function line(overrides = {}) {
  return {
    lineNo: 1,
    itemName: "Negroni",
    variantDisplayName: "Ly",
    menuItemVariantId: 101,
    unitCode: "GLASS",
    quantity: 2,
    cancelledQuantity: 0,
    originalQuantity: 2,
    doneQuantity: 0,
    progressVersion: 0,
    note: null,
    pendingCancellation: null,
    ...overrides,
  }
}

/**
 * Bốn phiếu phủ bốn cột, kèm metadata, cờ vận hành và cả hai trạng thái hủy.
 * `minutesAgo` chọn sẵn để phiếu 2 rơi vào warning (9 phút) và phiếu 3 rơi vào
 * critical (14 phút).
 */
function ticket(
  station,
  { ticketId, status, version, minutesAgo, flags = {}, baseLine = {}, extraLines = [], orderedBy },
) {
  return {
    ticketId,
    orderId: ticketId + 100,
    visitId: 50 + ticketId,
    visitSequence: ticketId,
    station,
    status,
    version,
    submittedAt: new Date(Date.parse(NOW) - minutesAgo * 60_000).toISOString(),
    acceptedAt: null,
    startedAt: null,
    readyAt: null,
    collectedAt: null,
    waitSeconds: minutesAgo * 60,
    tableCodes: [`B${ticketId}`],
    orderedByDisplayName: orderedBy,
    guestFlags: { vip: false, birthday: false, designated: false, ...flags },
    lines: [line({ itemName: "Negroni", note: ticketId === 1 ? "Ít đá" : null, ...baseLine }), ...extraLines],
  }
}

function queueSnapshot(station, tickets) {
  return {
    station,
    changeCursor: "7",
    generatedAt: NOW,
    printing: { enabled: false },
    limit: 200,
    tickets,
  }
}

function tickets(station, firstStatus, firstVersion) {
  return [
    ticket(station, {
      ticketId: 1,
      status: firstStatus,
      version: firstVersion,
      minutesAgo: 3,
      orderedBy: "Minh",
      baseLine: { pendingCancellation: { cancellationId: 91_001, quantity: 1, groupId: 99_001 } },
    }),
    ticket(station, {
      ticketId: 2,
      status: "ACCEPTED",
      version: 2,
      minutesAgo: 9,
      orderedBy: "Minh",
      flags: { vip: true, designated: true },
      baseLine: { pendingCancellation: { cancellationId: 92_001, quantity: 1, groupId: null } },
      extraLines: [
        // Vừa có phần đã được duyệt hủy, vừa có yêu cầu hủy mới chưa duyệt.
        line({
          lineNo: 2,
          itemName: "Khay thịt muối",
          variantDisplayName: "Phần",
          menuItemVariantId: 202,
          unitCode: "PORTION",
          quantity: 2,
          cancelledQuantity: 1,
          originalQuantity: 4,
          pendingCancellation: { cancellationId: 11, quantity: 1, groupId: 11 },
        }),
      ],
    }),
    ticket(station, { ticketId: 3, status: "PREPARING", version: 3, minutesAgo: 14, orderedBy: "Lan" }),
    ticket(station, { ticketId: 4, status: "READY", version: 4, minutesAgo: 2, orderedBy: "Lan" }),
  ]
}

/* ---------------- sơ đồ tối thiểu cho `/phucvu` ---------------- */

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
  zones: [{ id: 1, version: 1, code: "B", name: "Khu B", isBookable: true, isWaitingArea: false }],
  tables: [1, 2].map((id) => ({
    id,
    version: 1,
    code: `B${id}`,
    displayName: `B${id}`,
    zoneId: 1,
    zoneCode: "B",
    kind: "TABLE",
    capacity: 4,
    seqNo: id,
    isSpare: false,
    status: "ACTIVE",
    x: id * 120,
    y: 80,
    width: 90,
    height: 90,
  })),
  combinations: [],
}

const servicePayload = {
  businessDate: BUSINESS_DATE,
  serverNow: NOW,
  changeSeq: "1",
  groups: [],
  tables: [1, 2].map((tableId) => ({
    tableId,
    tableCode: `B${tableId}`,
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
  })),
}

async function horizontalOverflow(page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    wide: [...document.querySelectorAll("article,section,header,button,li,p")]
      .map((element) => ({
        label: element.getAttribute("aria-label") || element.textContent?.trim().slice(0, 40),
        right: Math.round(element.getBoundingClientRect().right),
      }))
      .filter((entry) => entry.right > document.documentElement.clientWidth + 1),
  }))
}

async function newPage(browser, viewport) {
  const context = await browser.newContext({
    viewport,
    isMobile: viewport.width < 768,
    hasTouch: viewport.width <= 1024,
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
  })
  // SSE không chạy được qua `page.route`; màn hàng đợi vẫn phải sống mà không
  // có nó, nên thay bằng một EventSource im lặng.
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

/** Những gì một card phải nói, ở cả hai route. */
async function assertSharedTicketContent(page) {
  const card = page.locator('[data-ticket-id="2"]')
  // Metadata: bàn, đơn thứ mấy, giờ gọi (19:01 giờ quán) và người gọi.
  await expect(card).toContainText("B2")
  await expect(card).toContainText("Đơn 2 · gọi lúc 19:01 · Minh")
  await expect(card).not.toContainText("Phiên #")
  // Cờ vận hành có chữ, không chỉ emoji: emoji mang `aria-hidden`, nên tên
  // đọc được của badge phải là chữ.
  const flags = card.getByRole("list", { name: "Cờ vận hành" })
  await expect(flags.locator('[data-flag="vip"]')).toHaveText(/VIP/)
  await expect(flags.locator('[data-flag="designated"]')).toHaveText(/Chỉ định/)
  await expect(flags.locator('[data-flag="birthday"]')).toHaveCount(0)
  await expect(flags.getByRole("listitem").filter({ hasText: "VIP" })).toHaveCount(1)
  await expect(card.getByText("Sinh nhật")).toHaveCount(0)
  // Hủy đã duyệt và hủy đang chờ duyệt đọc được tách bạch trên cùng một dòng.
  const mixed = card.locator('[data-line-no="2"]')
  await expect(mixed).toHaveAttribute("data-cancelled", "partial")
  await expect(mixed).toHaveAttribute("data-pending-cancellation", "true")
  await expect(mixed).toContainText("Đã hủy 1, chỉ làm 2")
  await expect(mixed).toContainText("Đang chờ duyệt hủy 1 phần")
  // Tone cảnh báo chờ, kèm nhãn chữ cho screen reader.
  await expect(card).toHaveAttribute("data-wait-tone", "warning")
  await expect(card.getByText("Chờ 9 phút, cần chú ý")).toBeAttached()
  await expect(page.locator('[data-ticket-id="3"]')).toHaveAttribute("data-wait-tone", "critical")
  await expect(page.locator('[data-ticket-id="1"]')).toHaveAttribute("data-wait-tone", "normal")
  // Không có dữ liệu khách định danh nào trên màn quầy.
  await expect(page.getByText(/Khách:|Điện thoại|Ghi chú đặt bàn/)).toHaveCount(0)
}

async function assertGroupedCancellationContent(page, stationLabel) {
  const full = page.locator('[data-ticket-id="1"]')
  const fullBanner = full.locator('[data-grouped-cancellation="all"]')
  await expect(fullBanner).toContainText(`Toàn bộ phần ${stationLabel} của phiếu đang chờ duyệt hủy theo đơn.`)
  await expect(fullBanner).toContainText("1 dòng · 1 phần đang chờ duyệt.")
  await expect(full.locator('[data-line-no="1"]')).toContainText("Thuộc yêu cầu hủy theo đơn")
  await expect(full).not.toContainText("91001")
  await expect(full).not.toContainText("99001")

  const partial = page.locator('[data-ticket-id="2"]')
  const partialBanner = partial.locator('[data-grouped-cancellation="partial"]')
  await expect(partialBanner).toContainText(`Một phần phiếu ${stationLabel} thuộc yêu cầu hủy theo đơn đang chờ duyệt.`)
  await expect(partialBanner).toContainText("Phiếu này đồng thời có yêu cầu hủy riêng từng món.")
  await expect(partial.locator('[data-line-no="1"]')).not.toContainText("Thuộc yêu cầu hủy theo đơn")
  await expect(partial.locator('[data-line-no="2"]')).toContainText("Thuộc yêu cầu hủy theo đơn")
}

async function assertTotalsPanel(page, { title, queueReads }) {
  const panel = page.locator("[data-preparation-totals]")
  const toggle = panel.getByRole("button", { name: title })
  const list = panel.getByRole("list", { name: title })

  await expect(panel).toBeVisible()
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  await expect(panel).toContainText("Tính trên toàn bộ hàng đợi, không phụ thuộc bộ lọc.")
  const negroni = list.getByRole("listitem").filter({ hasText: "Negroni" })
  await expect(negroni).toContainText("6×")
  await expect(negroni).toContainText("1 dòng có ghi chú")
  await expect(negroni).not.toContainText("Ít đá")
  const meatTray = list.getByRole("listitem").filter({ hasText: "Khay thịt muối" })
  await expect(meatTray).toContainText("2×")
  await expect(meatTray).toContainText("1 phần đang chờ duyệt hủy")
  await expect(panel).not.toContainText(/\b101\b|\b202\b|GLASS|PORTION/)

  const queueReadsBeforeCollapse = queueReads()
  await toggle.click()
  await expect(toggle).toHaveAttribute("aria-expanded", "false")
  await expect(list).toHaveCount(0)
  await page.waitForTimeout(100)
  expect(queueReads()).toBe(queueReadsBeforeCollapse)
  await toggle.click()
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  await expect(list).toBeVisible()

  return panel.innerText()
}

const failures = []
const browser = await chromium.launch(launchOptions)

/* ================= 1. Bartender nhúng trong khu vực Phục vụ ================= */

for (const viewport of viewports) {
  const { context, page } = await newPage(browser, viewport)
  const transitions = []
  const kitchenReads = []
  let queueReads = 0
  let firstStatus = "SUBMITTED"
  let firstVersion = 1

  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({
      json: session({
        roles: ["BAR"],
        portal: "waiter",
        displayName: "Bartender E2E",
        permissions: ["order.read", "order.create", "preparation.bar.read", "preparation.bar.transition"],
      }),
    }),
  )
  await page.route("**/api/v1/tables/stream", (route) => route.abort())
  await page.route("**/api/v1/tables/catalog", (route) => route.fulfill({ json: catalogPayload }))
  await page.route("**/api/v1/tables/service?*", (route) => route.fulfill({ json: servicePayload }))
  await page.route("**/api/v1/preparation/ready-notifications", (route) =>
    route.fulfill({ json: { notifications: [] } }),
  )
  await page.route("**/api/v1/waiter/notifications", (route) => route.fulfill({ json: { notifications: [] } }))
  await page.route("**/api/v1/preparation/KITCHEN/**", (route) => {
    kitchenReads.push(route.request().url())
    return route.fulfill({ status: 403, json: { code: "FORBIDDEN" } })
  })
  await page.route("**/api/v1/preparation/BAR/tickets", (route) => {
    if (route.request().method() !== "GET") return route.fallback()
    queueReads += 1
    return route.fulfill({ json: queueSnapshot("BAR", tickets("BAR", firstStatus, firstVersion)) })
  })
  await page.route("**/api/v1/preparation/BAR/tickets/1/transition", async (route) => {
    const payload = route.request().postDataJSON()
    transitions.push(payload)
    firstStatus = payload.toStatus
    firstVersion += 1
    await route.fulfill({
      json: {
        ticket: ticket("BAR", {
          ticketId: 1,
          status: firstStatus,
          version: firstVersion,
          minutesAgo: 3,
          orderedBy: "Minh",
          baseLine: { pendingCancellation: { cancellationId: 91_001, quantity: 1, groupId: 99_001 } },
        }),
        changeCursor: "8",
      },
    })
  })

  const label = `bartender ${viewport.width}x${viewport.height}`
  try {
    // 1. Vào thẳng route nhúng, không redirect và không màn từ chối quyền.
    await page.goto(`${base}/phucvu/hang-doi`, { waitUntil: "networkidle" })
    expect(new URL(page.url()).pathname).toBe("/phucvu/hang-doi")
    await expect(page.getByRole("heading", { name: "Không có quyền truy cập" })).toHaveCount(0)
    await expect(page.getByText(/Không có quyền xem hàng đợi/)).toHaveCount(0)

    // 2 + 3. Nằm trong WaiterShell, header nói đúng vai Bartender.
    const shell = page.locator("header").first()
    await expect(shell).toContainText("21GAM")
    await expect(shell).toContainText("Bartender")
    await expect(shell.getByRole("button", { name: /^Thông báo/ })).toBeVisible()

    // 4. Hàng đợi cố định station BAR.
    await expect(page.getByRole("heading", { name: "Hàng đợi Bar" })).toBeVisible()
    expect(kitchenReads).toEqual([])
    const audioToggle = page.getByRole("button", { name: "Bật âm báo phiếu mới" })
    await expect(audioToggle).toBeVisible()
    await expect(audioToggle).toHaveAttribute("aria-pressed", "false")

    // 5 + 6. Có nút quay về sơ đồ, không có bộ chọn Bar/Bếp và không có nút
    // đăng xuất riêng của `/chebien`.
    await expect(page.getByRole("button", { name: "Quay về sơ đồ" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Bếp", exact: true })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Bar", exact: true })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Đăng xuất" })).toHaveCount(0)

    // 7. Nhãn BAR.
    await expect(page.getByText("Đang pha", { exact: true })).toBeVisible()
    await expect(page.getByText("Hoàn thành · chờ bàn giao", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Bắt đầu pha" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Đã bàn giao món" })).toBeVisible()
    await expect(page.getByText("Đang làm", { exact: true })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Bắt đầu làm" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Đã nhận món" })).toHaveCount(0)

    // 8. Metadata, cờ và hủy chờ duyệt vẫn render trong route nhúng.
    await assertSharedTicketContent(page)
    await assertGroupedCancellationContent(page, "Bar")

    // BT-11. Tổng dùng toàn snapshot: READY không góp vào 6× Negroni, pending
    // không trừ 2× khay thịt và collapse không chạm API.
    const totalsTextBeforeFilter = await assertTotalsPanel(page, {
      title: "Tổng món đang chờ pha",
      queueReads: () => queueReads,
    })

    // BT-07. Filter chỉ chiếu snapshot tại chỗ: một lựa chọn, không refetch,
    // không đổi thứ tự và count cột nói rõ visible/total.
    const queueReadsBeforeFilter = queueReads
    await expect(page.getByRole("group", { name: "Lọc hàng đợi" })).toBeVisible()
    await page.getByRole("button", { name: "VIP", exact: true }).click()
    await expect(page.locator('[data-ticket-id="2"]')).toBeVisible()
    await expect(page.locator('[data-ticket-id="1"]')).toHaveCount(0)
    await expect(page.locator('[data-ticket-id="3"]')).toHaveCount(0)
    await expect(page.locator('[data-ticket-id="4"]')).toHaveCount(0)
    await expect(page.getByText("Đang lọc VIP — 3 phiếu bị ẩn.")).toBeVisible()
    await expect(page.getByText("1 phiếu bị ẩn đã chờ quá lâu.")).toBeVisible()
    expect(await page.locator("[data-preparation-totals]").innerText()).toBe(totalsTextBeforeFilter)
    await expect(page.locator('[data-queue-status="SUBMITTED"] [data-visible-count]')).toHaveText("0/1")
    await expect(page.locator('[data-queue-status="ACCEPTED"] [data-visible-count]')).toHaveAttribute(
      "aria-label",
      "1 phiếu hiển thị trên tổng 1 phiếu",
    )
    await page.waitForTimeout(100)
    expect(queueReads).toBe(queueReadsBeforeFilter)
    const filteredMetrics = await horizontalOverflow(page)
    expect(filteredMetrics.wide).toEqual([])
    expect(filteredMetrics.scrollWidth).toBeLessThanOrEqual(filteredMetrics.clientWidth)

    await page.getByRole("button", { name: "Chỉ định", exact: true }).click()
    await expect(page.getByText("Đang lọc Chỉ định — 3 phiếu bị ẩn.")).toBeVisible()
    expect(queueReads).toBe(queueReadsBeforeFilter)
    await page.getByRole("button", { name: "Xem tất cả" }).click()
    await expect(page.locator("[data-ticket-id]")).toHaveCount(4)
    await expect(page.getByText(/phiếu bị ẩn/)).toHaveCount(0)

    // 12. Nút hành động chính đủ lớn để bấm bằng ngón tay.
    const actionHeight = await page
      .getByRole("button", { name: "Tiếp nhận" })
      .first()
      .evaluate((node) => node.getBoundingClientRect().height)
    expect(actionHeight).toBeGreaterThanOrEqual(44)

    // 11. Không tràn ngang.
    const metrics = await horizontalOverflow(page)
    expect(metrics.wide).toEqual([])
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth)

    await page.screenshot({ path: path.join(output, `bartender-${viewport.width}x${viewport.height}.png`) })

    // 9. Một transition gửi đúng status kế tiếp + version, và card chuyển cột.
    await page.getByRole("button", { name: "Tiếp nhận" }).click()
    await expect.poll(() => transitions.length).toBe(1)
    expect(transitions[0].toStatus).toBe("ACCEPTED")
    expect(transitions[0].expectedVersion).toBe(1)
    expect(typeof transitions[0].idempotencyKey).toBe("string")
    await expect(page.locator('[data-ticket-id="1"]').getByRole("button", { name: "Bắt đầu pha" })).toBeVisible()
    await expect(page.locator('[data-ticket-id="1"]').getByText("Đã làm 0/2")).toBeVisible()
    await expect(
      page.locator('[data-ticket-id="1"]').getByRole("button", { name: "Tăng số đã làm của Negroni" }),
    ).toBeVisible()
    await expect(page.getByRole("button", { name: "Tiếp nhận" })).toHaveCount(0)

    // State filter thuộc vòng đời component, không theo route hay storage.
    await page.getByRole("button", { name: "VIP", exact: true }).click()
    await expect(page.locator("[data-ticket-id]")).toHaveCount(1)

    // 10. Quay về sơ đồ Phục vụ.
    await page.getByRole("button", { name: "Quay về sơ đồ" }).click()
    await expect.poll(() => new URL(page.url()).pathname).toBe("/phucvu")
    await expect(page.locator("header").first()).toContainText("Bartender")
    const queueButton = page.getByRole("button", { name: /^Hàng đợi Bar:/ })
    await expect(queueButton).toBeVisible()
    await queueButton.click()
    await expect.poll(() => new URL(page.url()).pathname).toBe("/phucvu/hang-doi")
    await expect(page.getByRole("button", { name: "Tất cả", exact: true })).toHaveAttribute("aria-pressed", "true")
    await expect(page.locator("[data-ticket-id]")).toHaveCount(4)

    console.log(`PASS ${label}`)
  } catch (error) {
    failures.push(label)
    console.error(`FAIL ${label}:`, error)
  } finally {
    await context.close()
  }
}

/* ================= 2. Bếp giữ nguyên ngôn ngữ cũ ở /chebien ================= */

for (const viewport of [viewports[0], viewports[3]]) {
  const { context, page } = await newPage(browser, viewport)
  const transitions = []
  const barReads = []
  let queueReads = 0
  let firstStatus = "SUBMITTED"
  let firstVersion = 1

  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({
      json: session({
        roles: ["KITCHEN"],
        portal: "preparation",
        displayName: "Bếp E2E",
        permissions: ["preparation.kitchen.read", "preparation.kitchen.transition"],
      }),
    }),
  )
  await page.route("**/api/v1/tables/stream", (route) => route.abort())
  await page.route("**/api/v1/preparation/BAR/**", (route) => {
    barReads.push(route.request().url())
    return route.fulfill({ status: 403, json: { code: "FORBIDDEN" } })
  })
  await page.route("**/api/v1/preparation/KITCHEN/tickets", (route) => {
    if (route.request().method() !== "GET") return route.fallback()
    queueReads += 1
    return route.fulfill({ json: queueSnapshot("KITCHEN", tickets("KITCHEN", firstStatus, firstVersion)) })
  })
  await page.route("**/api/v1/preparation/KITCHEN/tickets/1/transition", async (route) => {
    const payload = route.request().postDataJSON()
    transitions.push(payload)
    firstStatus = payload.toStatus
    firstVersion += 1
    await route.fulfill({
      json: {
        ticket: ticket("KITCHEN", {
          ticketId: 1,
          status: firstStatus,
          version: firstVersion,
          minutesAgo: 3,
          orderedBy: "Minh",
          baseLine: { pendingCancellation: { cancellationId: 91_001, quantity: 1, groupId: 99_001 } },
        }),
        changeCursor: "8",
      },
    })
  })

  const label = `kitchen ${viewport.width}x${viewport.height}`
  try {
    await page.goto(`${base}/chebien`, { waitUntil: "networkidle" })

    // 1. Heading là hàng đợi Bếp.
    await expect(page.getByRole("heading", { name: "Hàng đợi Bếp" })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Hàng đợi Bar" })).toHaveCount(0)
    expect(barReads).toEqual([])
    await expect(page.getByRole("button", { name: "Bật âm báo phiếu mới" })).toHaveAttribute("aria-pressed", "false")

    // 2. Nhãn KITCHEN giữ nguyên.
    await expect(page.getByText("Đang làm", { exact: true })).toBeVisible()
    await expect(page.getByText("Hoàn thành", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Bắt đầu làm" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Đã nhận món" })).toBeVisible()

    // 3. Không rò rỉ nhãn chỉ dành cho BAR.
    await expect(page.getByText("Đang pha", { exact: true })).toHaveCount(0)
    await expect(page.getByText("Hoàn thành · chờ bàn giao", { exact: true })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Bắt đầu pha" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Đã bàn giao món" })).toHaveCount(0)

    // 5. Metadata, cờ và hủy chờ duyệt vẫn render ở màn Bếp.
    await assertSharedTicketContent(page)
    await assertGroupedCancellationContent(page, "Bếp")

    const totalsTextBeforeFilter = await assertTotalsPanel(page, {
      title: "Tổng món đang chờ làm",
      queueReads: () => queueReads,
    })
    await expect(page.getByRole("button", { name: "Tổng món đang chờ pha" })).toHaveCount(0)

    // BT-07 áp dụng cùng projection tại chỗ cho Bếp.
    const queueReadsBeforeFilter = queueReads
    await page.getByRole("button", { name: "VIP", exact: true }).click()
    await expect(page.locator('[data-ticket-id="2"]')).toBeVisible()
    await expect(page.locator("[data-ticket-id]")).toHaveCount(1)
    await expect(page.getByText("Đang lọc VIP — 3 phiếu bị ẩn.")).toBeVisible()
    expect(await page.locator("[data-preparation-totals]").innerText()).toBe(totalsTextBeforeFilter)
    await page.waitForTimeout(100)
    expect(queueReads).toBe(queueReadsBeforeFilter)
    await page.getByRole("button", { name: "Xem tất cả" }).click()
    await expect(page.locator("[data-ticket-id]")).toHaveCount(4)

    // 6. Không tràn ngang.
    const metrics = await horizontalOverflow(page)
    expect(metrics.wide).toEqual([])
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth)

    await page.screenshot({ path: path.join(output, `kitchen-${viewport.width}x${viewport.height}.png`) })

    // 4. Cùng mã state machine, chỉ nhãn khác.
    await page.getByRole("button", { name: "Tiếp nhận" }).click()
    await expect.poll(() => transitions.length).toBe(1)
    expect(transitions[0].toStatus).toBe("ACCEPTED")
    expect(transitions[0].expectedVersion).toBe(1)
    await expect(page.locator('[data-ticket-id="1"]').getByRole("button", { name: "Bắt đầu làm" })).toBeVisible()

    console.log(`PASS ${label}`)
  } catch (error) {
    failures.push(label)
    console.error(`FAIL ${label}:`, error)
  } finally {
    await context.close()
  }
}

/* ============== 3. Filtered-empty thật trên mobile KITCHEN ============== */

{
  const viewport = { width: 360, height: 800 }
  const { context, page } = await newPage(browser, viewport)
  const snapshotTickets = tickets("KITCHEN", "SUBMITTED", 1).map((item) => ({
    ...item,
    guestFlags: { ...item.guestFlags, designated: false },
  }))
  let queueReads = 0

  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({
      json: session({
        roles: ["KITCHEN"],
        portal: "preparation",
        displayName: "Bếp Filter E2E",
        permissions: ["preparation.kitchen.read", "preparation.kitchen.transition"],
      }),
    }),
  )
  await page.route("**/api/v1/tables/stream", (route) => route.abort())
  await page.route("**/api/v1/preparation/BAR/**", (route) =>
    route.fulfill({ status: 403, json: { code: "FORBIDDEN" } }),
  )
  await page.route("**/api/v1/preparation/KITCHEN/tickets", (route) => {
    if (route.request().method() !== "GET") return route.fallback()
    queueReads += 1
    return route.fulfill({ json: queueSnapshot("KITCHEN", snapshotTickets) })
  })

  const label = "kitchen filtered-empty 360x800"
  try {
    await page.goto(`${base}/chebien`, { waitUntil: "networkidle" })
    const cards = page.locator("[data-ticket-id]")
    const initialOrder = await cards.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-ticket-id")))
    expect(initialOrder).toEqual(["1", "2", "3", "4"])
    const queueReadsBeforeFilter = queueReads

    await expect(page.getByRole("group", { name: "Lọc hàng đợi" })).toBeVisible()
    await page.getByRole("button", { name: "Chỉ định", exact: true }).click()
    await expect(page.getByText("Không có phiếu nào khớp bộ lọc.")).toBeVisible()
    await expect(page.getByText("Đang lọc Chỉ định — 4 phiếu bị ẩn.")).toBeVisible()
    await expect(page.getByText("1 phiếu bị ẩn đã chờ quá lâu.")).toBeVisible()
    await expect(page.getByText("Chưa có phiếu đang chờ.")).toHaveCount(0)
    await expect(cards).toHaveCount(0)
    for (const status of ["SUBMITTED", "ACCEPTED", "PREPARING", "READY"]) {
      await expect(page.locator(`[data-queue-status="${status}"] [data-visible-count]`)).toHaveText("0/1")
    }
    await page.waitForTimeout(100)
    expect(queueReads).toBe(queueReadsBeforeFilter)
    const filteredMetrics = await horizontalOverflow(page)
    expect(filteredMetrics.wide).toEqual([])
    expect(filteredMetrics.scrollWidth).toBeLessThanOrEqual(filteredMetrics.clientWidth)

    await page.getByRole("button", { name: "Xem tất cả" }).click()
    await expect(cards).toHaveCount(4)
    const restoredOrder = await cards.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-ticket-id")))
    expect(restoredOrder).toEqual(initialOrder)
    expect(queueReads).toBe(queueReadsBeforeFilter)

    await page.screenshot({ path: path.join(output, "kitchen-filtered-empty-360x800.png") })
    console.log(`PASS ${label}`)
  } catch (error) {
    failures.push(label)
    console.error(`FAIL ${label}:`, error)
  } finally {
    await context.close()
  }
}

/* =============== 4. Aggregate rỗng nhưng queue còn READY =============== */

{
  const viewport = { width: 360, height: 800 }
  const { context, page } = await newPage(browser, viewport)
  const readyOnly = [
    ticket("KITCHEN", {
      ticketId: 4,
      status: "READY",
      version: 4,
      minutesAgo: 2,
      orderedBy: "Lan",
    }),
  ]

  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({
      json: session({
        roles: ["KITCHEN"],
        portal: "preparation",
        displayName: "Bếp Empty Totals E2E",
        permissions: ["preparation.kitchen.read", "preparation.kitchen.transition"],
      }),
    }),
  )
  await page.route("**/api/v1/tables/stream", (route) => route.abort())
  await page.route("**/api/v1/preparation/KITCHEN/tickets", (route) =>
    route.fulfill({ json: queueSnapshot("KITCHEN", readyOnly) }),
  )

  const label = "kitchen empty totals 360x800"
  try {
    await page.goto(`${base}/chebien`, { waitUntil: "networkidle" })
    const panel = page.locator("[data-preparation-totals]")
    await expect(panel).toBeVisible()
    await expect(panel.getByRole("button", { name: "Tổng món đang chờ làm" })).toHaveAttribute("aria-expanded", "true")
    await expect(panel).toContainText("Không còn món đang chờ làm.")
    await expect(panel).not.toContainText("pha")
    await expect(page.locator('[data-ticket-id="4"]')).toBeVisible()
    await expect(page.getByText("Chưa có phiếu đang chờ.")).toHaveCount(0)
    const metrics = await horizontalOverflow(page)
    expect(metrics.wide).toEqual([])
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth)
    console.log(`PASS ${label}`)
  } catch (error) {
    failures.push(label)
    console.error(`FAIL ${label}:`, error)
  } finally {
    await context.close()
  }
}

/* ========= 5. Chuông thông báo của WaiterShell vẫn gộp hai nguồn ========= */

/*
 * Giai đoạn 3 đổi màn hàng đợi, không đổi chuông. Ba điều phải còn nguyên, và
 * cả ba chỉ sai ở runtime chứ không sai ở type: chuông vẫn đọc READY của Module
 * 4, vẫn poll 20 giây, và vẫn là MỘT chuông cho cả tin duyệt hủy. Điều thứ tư
 * là điều dễ hỏng nhất khi thêm một màn mới vào khung: `WaiterShell` không được
 * mở thêm một vòng poll hàng đợi chế biến của riêng nó — badge trên sơ đồ đã
 * poll rồi, và hai vòng trên cùng một query key sẽ tranh nhau.
 */
{
  const viewport = { width: 1280, height: 800 }
  const context = await browser.newContext({ viewport, locale: "vi-VN", timezoneId: "Asia/Ho_Chi_Minh" })
  await context.addInitScript(() => {
    class QuietEventSource {
      addEventListener() {}
      removeEventListener() {}
      close() {}
    }
    Object.defineProperty(window, "EventSource", { value: QuietEventSource })
  })
  const page = await context.newPage()
  await page.clock.install({ time: new Date(NOW) })

  const READY_VISIT = 77
  let readyCalls = 0
  let queueCalls = 0

  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({
      json: session({
        roles: ["BAR"],
        portal: "waiter",
        displayName: "Bartender E2E",
        permissions: ["order.read", "order.create", "preparation.bar.read", "preparation.bar.transition"],
      }),
    }),
  )
  await page.route("**/api/v1/tables/stream", (route) => route.abort())
  await page.route("**/api/v1/tables/catalog", (route) => route.fulfill({ json: catalogPayload }))
  await page.route("**/api/v1/tables/service?*", (route) => route.fulfill({ json: servicePayload }))
  await page.route("**/api/v1/preparation/BAR/tickets", (route) => {
    queueCalls += 1
    return route.fulfill({ json: queueSnapshot("BAR", tickets("BAR", "SUBMITTED", 1)) })
  })
  await page.route("**/api/v1/preparation/ready-notifications", (route) => {
    readyCalls += 1
    return route.fulfill({
      json: {
        notifications: [
          {
            eventId: 1,
            ticketId: 9,
            visitId: READY_VISIT,
            orderedByUserId: 41,
            station: "BAR",
            audience: "ORDERED_BY_USER",
            createdAt: NOW,
            acknowledgedAt: null,
          },
        ],
      },
    })
  })
  await page.route("**/api/v1/waiter/notifications", (route) =>
    route.fulfill({
      json: {
        notifications: [
          {
            notificationId: 5,
            kind: "CANCELLATION_DECIDED",
            visitId: READY_VISIT,
            orderId: 55,
            cancellationGroupId: null,
            cancellationId: 9,
            decision: "APPROVED",
            lineCount: 1,
            quantity: 2,
            wasteQuantity: 0,
            amountVnd: 760000,
            reason: "Khách đổi ý",
            decisionNote: "Chưa pha",
            decidedByUserId: 2,
            decidedByDisplayName: "Thu ngân Lan",
            decidedAt: NOW,
            tableCodes: ["B2"],
            visitSequence: 2,
            createdAt: NOW,
            acknowledgedAt: null,
          },
        ],
      },
    }),
  )
  await page.route(`**/api/v1/waiter/visits/${READY_VISIT}/orders`, (route) =>
    route.fulfill({
      json: {
        visitId: READY_VISIT,
        tableCodes: ["B2"],
        orderCount: 0,
        totalAmountVnd: 0,
        cancelledAmountVnd: 0,
        netAmountVnd: 0,
        orders: [],
      },
    }),
  )

  const label = "notifications 1280x800"
  try {
    await page.goto(`${base}/phucvu/hang-doi`, { waitUntil: "networkidle" })

    // Badge đếm GỘP: 1 phiếu món đã xong + 1 tin duyệt hủy.
    const bell = page.getByRole("button", { name: /^Thông báo/ })
    await expect(bell).toHaveAttribute("aria-label", "Thông báo: 2 tin chưa đọc")

    // Một chuông, hai nguồn, trong cùng một popover.
    await bell.click()
    await expect(page.getByText("1 phiếu món đã xong")).toBeVisible()
    await expect(page.getByText(/Đã duyệt hủy món · Đơn 2 · B2/)).toBeVisible()
    await expect(page.getByText(/Thu ngân Lan/)).toBeVisible()

    // "Mở bàn mới nhất" đi tới đúng màn đơn của Phiên đó.
    await page.getByRole("button", { name: "Mở bàn mới nhất" }).click()
    await expect.poll(() => new URL(page.url()).pathname).toBe(`/phucvu/orders/${READY_VISIT}`)

    // Rời khỏi màn hàng đợi: khung KHÔNG được tự poll hàng đợi chế biến.
    const queueCallsAfterLeaving = queueCalls
    const readyCallsBefore = readyCalls
    await page.clock.fastForward(25_000)
    // Chuông vẫn poll 20 giây.
    await expect.poll(() => readyCalls, { timeout: 10_000 }).toBeGreaterThan(readyCallsBefore)
    expect(queueCalls).toBe(queueCallsAfterLeaving)

    await page.screenshot({ path: path.join(output, "notifications-1280x800.png") })
    console.log(`PASS ${label}`)
  } catch (error) {
    failures.push(label)
    console.error(`FAIL ${label}:`, error)
  } finally {
    await context.close()
  }
}

await browser.close()
if (failures.length) {
  console.error(`FAILED: ${failures.join(", ")}`)
  process.exitCode = 1
}

/**
 * Module Phục vụ 5 — E2E màn "Đơn của bàn" và màn phê duyệt hủy món.
 *
 * Bốn viewport bắt buộc, và những điều phải đúng ở bản đã build:
 *
 * 1. Trạng thái món đọc được trên từng dòng, theo phiếu của quầy mang dòng đó.
 * 2. Sửa số lượng CHỈ hiện khi quầy chưa nhận phiếu, và gửi kèm
 *    `expectedLineVersion` — không có nó thì hai máy ghi đè nhau.
 * 3. Món đã xong đổi nút thành "Xin ghi hao" và buộc một lần tick riêng.
 * 4. Phục vụ gửi yêu cầu hủy có lý do; màn này KHÔNG có nút hủy thẳng.
 * 5. Người có quyền phê duyệt thấy hàng chờ; người không có quyền đọc một câu
 *    rõ ràng thay vì một danh sách trống.
 *
 * Chạy: `pnpm --filter @21gam/web e2e:waiter-order-board` với dev server ở 5191.
 */
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { chromium, expect } from "@playwright/test"

const base = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5191"
const output = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), "21gam-waiter-order-board")
const launchOptions = process.env.PW_CHROMIUM_PATH
  ? { executablePath: process.env.PW_CHROMIUM_PATH }
  : { executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" }
const viewports = [
  { name: "360x800", width: 360, height: 800 },
  { name: "390x844", width: 390, height: 844 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1280x800", width: 1280, height: 800 },
]

const VISIT_ID = 42
const ORDER_ID = 55
const WAITER_ID = 6

const session = (permissions, roles = ["WAITER"], portal = "waiter") => ({
  user: {
    id: WAITER_ID,
    username: "waiter_ui",
    displayName: "Phục vụ UI",
    organizationId: 1,
    venueId: 1,
    roles,
    accessLevel: null,
  },
  permissions,
  csrfToken: "e2e-token",
  portal,
  mustChangePassword: false,
})

const WAITER_PERMISSIONS = ["order.create", "order.read", "order.line.adjust", "order.cancel.request"]
const APPROVER_PERMISSIONS = [...WAITER_PERMISSIONS, "order.cancel.approve"]

const line = (overrides = {}) => ({
  lineNo: 1,
  menuItemId: 7,
  variantId: 1,
  itemCode: "MACALLAN_12",
  itemName: "MACALLAN 12",
  variantDisplayName: "Ly",
  unitCode: "GLASS",
  preparationStation: "BAR",
  unitPriceVnd: 380000,
  priceId: 11,
  priceVersion: 1,
  quantity: 3,
  lineTotalVnd: 1140000,
  note: null,
  lineVersion: 1,
  cancelledQuantity: 0,
  netQuantity: 3,
  netTotalVnd: 1140000,
  preparationStatus: "SUBMITTED",
  canAdjustQuantity: true,
  pendingCancellation: null,
  ...overrides,
})

const summary = {
  orderId: ORDER_ID,
  visitId: VISIT_ID,
  visitSequence: 1,
  status: "SUBMITTED",
  submittedAt: "2030-01-01T13:30:00.000Z",
  orderedByUserId: WAITER_ID,
  orderedByDisplayName: "Phục vụ UI",
  lineCount: 3,
  itemCount: 5,
  totalAmountVnd: 1500000,
  cancelledItemCount: 0,
  cancelledAmountVnd: 0,
  netAmountVnd: 1500000,
  stations: ["BAR", "KITCHEN"],
}

const listView = {
  visitId: VISIT_ID,
  tableCodes: ["A1", "A2"],
  orderCount: 1,
  totalAmountVnd: 1500000,
  cancelledAmountVnd: 0,
  netAmountVnd: 1500000,
  orders: [summary],
}

const detail = {
  order: {
    ...summary,
    businessDate: "2030-01-01",
    lines: [
      line(),
      line({
        lineNo: 2,
        itemName: "BOTTLE ONLY RESERVE",
        variantDisplayName: "Chai",
        quantity: 1,
        lineTotalVnd: 180000,
        unitPriceVnd: 180000,
        netQuantity: 1,
        netTotalVnd: 180000,
        preparationStatus: "ACCEPTED",
        canAdjustQuantity: false,
      }),
      line({
        lineNo: 3,
        itemName: "TRUFFLE FRIES",
        variantDisplayName: "Phần",
        preparationStation: "KITCHEN",
        quantity: 1,
        unitPriceVnd: 180000,
        lineTotalVnd: 180000,
        netQuantity: 1,
        netTotalVnd: 180000,
        preparationStatus: "READY",
        canAdjustQuantity: false,
      }),
    ],
    tickets: [
      { ticketId: 9, station: "BAR", status: "SUBMITTED", lineCount: 2, itemCount: 4, cancelledItemCount: 0 },
      { ticketId: 10, station: "KITCHEN", status: "READY", lineCount: 1, itemCount: 1, cancelledItemCount: 0 },
    ],
  },
}

const readyNotifications = {
  notifications: [
    {
      eventId: 1,
      ticketId: 10,
      visitId: VISIT_ID,
      orderedByUserId: WAITER_ID,
      station: "KITCHEN",
      audience: "ORDERED_BY_USER",
      createdAt: "2030-01-01T13:55:00.000Z",
      acknowledgedAt: null,
    },
  ],
}

const queueEntry = {
  cancellationId: 9,
  status: "PENDING",
  policy: "STANDARD",
  version: 1,
  visitId: VISIT_ID,
  tableCodes: ["A1", "A2"],
  orderId: ORDER_ID,
  visitSequence: 1,
  lineNo: 1,
  itemName: "MACALLAN 12",
  variantDisplayName: "Ly",
  station: "BAR",
  ticketStatusAtRequest: "SUBMITTED",
  quantity: 2,
  unitPriceVnd: 380000,
  amountVnd: 760000,
  reason: "Khách đổi ý",
  requestedByUserId: WAITER_ID,
  requestedByDisplayName: "Phục vụ UI",
  requestedAt: "2030-01-01T14:00:00.000Z",
  decidedByUserId: null,
  decidedByDisplayName: null,
  decidedAt: null,
  decisionNote: null,
}

async function readOverflow(page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    overflow: [...document.querySelectorAll("button,input,output,section,li,header")]
      .map((element) => ({
        label: element.getAttribute("aria-label") || element.textContent?.trim().slice(0, 30),
        rect: element.getBoundingClientRect(),
      }))
      .filter(({ rect }) => rect.width > 0 && rect.right > document.documentElement.clientWidth + 1)
      .map(({ label, rect }) => ({ label, right: Math.round(rect.right) })),
  }))
}

await fs.mkdir(output, { recursive: true })
const browser = await chromium.launch(launchOptions)
const failures = []

for (const viewport of viewports) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.width < 768,
    hasTouch: viewport.width < 768,
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
  await page.clock.setFixedTime(new Date("2030-01-01T14:00:00.000Z"))

  const adjustCalls = []
  const cancelCalls = []
  const decisionCalls = []
  let permissions = WAITER_PERMISSIONS

  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ json: session(permissions) }))
  await page.route(`**/api/v1/waiter/visits/${VISIT_ID}/orders`, (route) => route.fulfill({ json: listView }))
  await page.route(`**/api/v1/waiter/orders/${ORDER_ID}`, (route) => route.fulfill({ json: detail }))
  await page.route("**/api/v1/preparation/ready-notifications", (route) => route.fulfill({ json: readyNotifications }))
  await page.route(`**/api/v1/waiter/orders/${ORDER_ID}/lines/1`, async (route) => {
    adjustCalls.push(route.request().postDataJSON())
    await route.fulfill({ json: detail })
  })
  await page.route(`**/api/v1/waiter/orders/${ORDER_ID}/lines/*/cancellations`, async (route) => {
    cancelCalls.push({ url: route.request().url(), body: route.request().postDataJSON() })
    await route.fulfill({
      status: 201,
      json: { cancellation: { cancellationId: 9, status: "PENDING", policy: "STANDARD", version: 1 } },
    })
  })
  await page.route("**/api/v1/orders/cancellations?*", (route) =>
    route.fulfill({ json: { status: "PENDING", pendingCount: 1, entries: [queueEntry] } }),
  )
  await page.route("**/api/v1/orders/cancellations/9/approve", async (route) => {
    decisionCalls.push(route.request().postDataJSON())
    await route.fulfill({ json: { cancellationId: 9, status: "APPROVED", version: 2, order: detail.order } })
  })

  // ---------------------------------------------- màn "Đơn của bàn" (Phục vụ)
  await page.goto(`${base}/phucvu/orders/${VISIT_ID}`, { waitUntil: "networkidle" })
  await expect(page.getByRole("heading", { name: /Đơn của bàn · A1 \+ A2/ })).toBeVisible()
  await expect(page.getByText("1 đơn · còn phải trả 1.500.000đ")).toBeVisible()
  // Badge thông báo trên header của khu vực Phục vụ đếm phiếu món đã xong.
  await expect(page.getByRole("button", { name: "Thông báo: 1 phiếu món đã xong" })).toBeVisible()
  // Dải thông báo của đúng Phiên này.
  await expect(page.getByText("phiếu món đã xong cho bàn này")).toBeVisible()

  await page.getByRole("button", { name: /Đơn 1/ }).click()
  // Badge trạng thái, khớp chính xác: câu giải thích bên dưới dòng cũng chứa
  // cùng những chữ này.
  await expect(page.getByText("Chờ quầy nhận", { exact: true })).toBeVisible()
  await expect(page.getByText("Quầy đã nhận", { exact: true })).toBeVisible()
  await expect(page.getByText("Món đã xong", { exact: true })).toBeVisible()

  // Chỉ dòng chưa được quầy nhận có stepper sửa số lượng.
  await expect(page.getByRole("button", { name: "Tăng số lượng MACALLAN 12 Ly" })).toBeVisible()
  await expect(page.getByRole("button", { name: /Tăng số lượng BOTTLE ONLY RESERVE/ })).toHaveCount(0)
  await expect(page.getByRole("button", { name: /Tăng số lượng TRUFFLE FRIES/ })).toHaveCount(0)
  // Món đã xong đổi nút thành ghi hao.
  await expect(page.getByRole("button", { name: "Xin ghi hao" })).toBeVisible()

  await page.getByRole("button", { name: "Tăng số lượng MACALLAN 12 Ly" }).click()
  await expect.poll(() => adjustCalls.length).toBe(1)
  if (adjustCalls[0]?.expectedLineVersion !== 1 || adjustCalls[0]?.quantity !== 4) {
    failures.push(`${viewport.name}: payload sửa số lượng sai ${JSON.stringify(adjustCalls[0])}`)
  }
  if (!adjustCalls[0]?.idempotencyKey) {
    failures.push(`${viewport.name}: sửa số lượng thiếu mã chống trùng`)
  }

  // Xin hủy: lý do là bắt buộc, nút gửi khóa cho tới khi có lý do.
  await page.getByRole("button", { name: "Xin hủy món" }).first().click()
  await expect(page.getByRole("heading", { name: "Xin hủy món" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Gửi yêu cầu" })).toBeDisabled()
  await page.getByLabel("Lý do (bắt buộc)").fill("Khách đổi ý")
  await page.getByRole("button", { name: "Gửi yêu cầu" }).click()
  await expect.poll(() => cancelCalls.length).toBe(1)
  if (cancelCalls[0]?.body?.reason !== "Khách đổi ý" || cancelCalls[0]?.body?.expectedLineVersion !== 1) {
    failures.push(`${viewport.name}: payload xin hủy sai ${JSON.stringify(cancelCalls[0]?.body)}`)
  }
  if (!cancelCalls[0]?.url.endsWith("/lines/1/cancellations")) {
    failures.push(`${viewport.name}: yêu cầu hủy gửi sai dòng ${cancelCalls[0]?.url}`)
  }

  let dimensions = await readOverflow(page)
  if (dimensions.scrollWidth > dimensions.clientWidth + 1 || dimensions.overflow.length) {
    failures.push(`${viewport.name}: order board overflow ${JSON.stringify(dimensions)}`)
  }
  await page.screenshot({ path: path.join(output, `${viewport.name}-don-cua-ban.png`) })

  // ------------------------------------- màn phê duyệt: không có quyền thì nói
  await page.goto(`${base}/duyet-huy-mon`, { waitUntil: "networkidle" })
  await expect(page.getByRole("heading", { name: "Không có quyền phê duyệt hủy món" })).toBeVisible()

  // ------------------------------------------- màn phê duyệt: có quyền thì làm
  permissions = APPROVER_PERMISSIONS
  await page.goto(`${base}/duyet-huy-mon`, { waitUntil: "networkidle" })
  await expect(page.getByRole("heading", { name: "Phê duyệt hủy món" })).toBeVisible()
  await expect(page.getByText("1 yêu cầu đang chờ")).toBeVisible()
  await expect(page.getByText("Khách đổi ý")).toBeVisible()
  await expect(page.getByText("Bàn A1 + A2 · đơn 1 · dòng 1")).toBeVisible()
  await expect(page.getByText("760.000đ")).toBeVisible()

  await page.getByRole("button", { name: /Duyệt hủy/ }).click()
  await expect.poll(() => decisionCalls.length).toBe(1)
  if (decisionCalls[0]?.expectedVersion !== 1 || !decisionCalls[0]?.idempotencyKey) {
    failures.push(`${viewport.name}: payload quyết định sai ${JSON.stringify(decisionCalls[0])}`)
  }

  dimensions = await readOverflow(page)
  if (dimensions.scrollWidth > dimensions.clientWidth + 1 || dimensions.overflow.length) {
    failures.push(`${viewport.name}: approval queue overflow ${JSON.stringify(dimensions)}`)
  }
  await page.screenshot({ path: path.join(output, `${viewport.name}-duyet-huy-mon.png`) })
  await context.close()
}

await browser.close()
if (failures.length) {
  for (const failure of failures) console.error(failure)
  process.exit(1)
}
console.log(`Đạt: ${viewports.length} viewport, đơn của bàn và phê duyệt hủy món; ảnh tại ${output}`)

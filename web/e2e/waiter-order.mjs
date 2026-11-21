/**
 * Module Phục vụ 3 — E2E giỏ gọi món và gửi đơn.
 *
 * Bốn viewport bắt buộc, và năm điều phải đúng ở bản đã build:
 *
 * 1. Chọn đơn vị bán, số lượng, ghi chú rồi thêm vào giỏ.
 * 2. Giá đổi → hỏi lại bằng số cụ thể, KHÔNG tự gửi đơn sau khi xác nhận.
 * 3. Lỗi giữ nguyên giỏ; giỏ chỉ trống sau khi máy chủ trả về đơn.
 * 4. Một lần bấm = một request. Bấm thêm trong lúc đang gửi không thành đơn thứ hai.
 * 5. Nháp giỏ nằm trong sessionStorage, phân vùng theo userId + venueId + visitId.
 *
 * Chạy: `pnpm --filter @21gam/web e2e:waiter-order` với dev server ở 5191.
 */
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { chromium, expect } from "@playwright/test"

const base = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5191"
const output = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), "21gam-waiter-order")
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
const USER_ID = 6
const VENUE_ID = 1
const CART_KEY = `21gam.waiter-cart.v1:${USER_ID}:${VENUE_ID}:${VISIT_ID}`

const session = {
  user: {
    id: USER_ID,
    username: "waiter_ui",
    displayName: "Phục vụ UI",
    organizationId: 1,
    venueId: VENUE_ID,
    roles: ["WAITER"],
    accessLevel: null,
  },
  permissions: ["order.create", "order.read"],
  csrfToken: "e2e-token",
  portal: "waiter",
  mustChangePassword: false,
}

const variant = (variantId, unitCode, displayName, amountVnd, availabilityStatus = "AVAILABLE") => ({
  variantId,
  unitCode,
  displayName,
  quantityInUnit: null,
  availabilityStatus,
  amountVnd,
  priceId: variantId + 100,
  priceVersion: 1,
  effectiveFrom: "2029-01-01T00:00:00.000Z",
})

const menu = {
  catalogVersion: "2030-01-01T00:00:00.000Z",
  visit: {
    visitId: VISIT_ID,
    tableCodes: ["A1", "A2"],
    guestCount: 4,
    startedAt: "2030-01-01T13:00:00.000Z",
    status: "OPEN",
  },
  categories: [
    { id: 1, code: "SPIRITS", name: "Rượu mạnh", parentId: null, displayOrder: 1 },
    { id: 2, code: "WHISKY", name: "Single Malt Whisky", parentId: 1, displayOrder: 1 },
    { id: 3, code: "FOOD_GROUP", name: "Đồ ăn", parentId: null, displayOrder: 2 },
    { id: 4, code: "FOOD", name: "Food", parentId: 3, displayOrder: 1 },
  ],
  items: [
    {
      id: 1,
      code: "MACALLAN_12",
      categoryId: 2,
      name: "MACALLAN 12",
      description: "Single malt Scotch whisky, 12 years",
      preparationStation: "BAR",
      availabilityStatus: "AVAILABLE",
      displayOrder: 1,
      variants: [variant(1, "GLASS", "Ly", 380000), variant(2, "BOTTLE", "Chai", 6500000)],
    },
    {
      id: 3,
      code: "TRUFFLE_FRIES",
      categoryId: 4,
      name: "TRUFFLE FRIES",
      description: "Khoai tây chiên nấm truffle",
      preparationStation: "KITCHEN",
      availabilityStatus: "TEMPORARILY_UNAVAILABLE",
      displayOrder: 1,
      variants: [variant(4, "PORTION", "Phần", 180000, "TEMPORARILY_UNAVAILABLE")],
    },
  ],
}

const priceChangedBody = {
  error: {
    code: "MENU_PRICE_CHANGED",
    message: "Giá món vừa thay đổi. Xác nhận lại giá mới với khách trước khi gửi đơn.",
    details: {
      changes: [
        {
          variantId: 1,
          itemName: "MACALLAN 12",
          variantDisplayName: "Ly",
          submittedPriceId: 101,
          submittedPriceVersion: 1,
          currentPriceId: 201,
          currentPriceVersion: 1,
          currentAmountVnd: 420000,
        },
      ],
    },
  },
}

function createdOrder(payload) {
  const lines = payload.lines.map((line, index) => ({
    lineNo: index + 1,
    menuItemId: 1,
    variantId: line.variantId,
    itemCode: "MACALLAN_12",
    itemName: "MACALLAN 12",
    variantDisplayName: line.variantId === 1 ? "Ly" : "Chai",
    unitCode: line.variantId === 1 ? "GLASS" : "BOTTLE",
    preparationStation: "BAR",
    unitPriceVnd: line.priceId === 201 ? 420000 : line.variantId === 1 ? 380000 : 6500000,
    priceId: line.priceId,
    priceVersion: line.priceVersion,
    quantity: line.quantity,
    lineTotalVnd: (line.priceId === 201 ? 420000 : line.variantId === 1 ? 380000 : 6500000) * line.quantity,
    note: line.note ?? null,
  }))
  const itemCount = lines.reduce((total, line) => total + line.quantity, 0)
  return {
    order: {
      orderId: 55,
      visitId: VISIT_ID,
      visitSequence: 1,
      status: "SUBMITTED",
      submittedAt: "2030-01-01T14:00:00.000Z",
      orderedByUserId: USER_ID,
      orderedByDisplayName: "Phục vụ UI",
      lineCount: lines.length,
      itemCount,
      totalAmountVnd: lines.reduce((total, line) => total + line.lineTotalVnd, 0),
      stations: ["BAR"],
      businessDate: "2030-01-01",
      lines,
      tickets: [{ ticketId: 9, station: "BAR", status: "QUEUED", lineCount: lines.length, itemCount }],
    },
  }
}

async function readOverflow(page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    overflow: [...document.querySelectorAll("button,input,output,main,section,li")]
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

  const submissions = []
  let rejectNextWithPriceChange = true
  let holdResponseMs = 0

  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ json: session }))
  await page.route("**/api/v1/waiter/menu?*", (route) => route.fulfill({ json: menu }))
  await page.route(`**/api/v1/waiter/visits/${VISIT_ID}/orders`, (route) =>
    route.fulfill({
      json: { visitId: VISIT_ID, tableCodes: ["A1", "A2"], orderCount: 0, totalAmountVnd: 0, orders: [] },
    }),
  )
  await page.route("**/api/v1/waiter/orders", async (route) => {
    const payload = route.request().postDataJSON()
    submissions.push(payload)
    if (holdResponseMs) await new Promise((resolve) => setTimeout(resolve, holdResponseMs))
    if (rejectNextWithPriceChange) {
      rejectNextWithPriceChange = false
      await route.fulfill({ status: 409, json: priceChangedBody })
      return
    }
    await route.fulfill({ status: 201, json: createdOrder(payload) })
  })

  await page.goto(`${base}/phucvu/phien/${VISIT_ID}/goi-mon`, { waitUntil: "networkidle" })
  await expect(page.getByRole("heading", { name: /Gọi món · A1 \+ A2/ })).toBeVisible()

  // Chưa chọn món thì không có thanh giỏ nào trông như dùng được.
  await expect(page.getByRole("button", { name: /Giỏ gọi món/ })).toHaveCount(0)

  // 1. Chọn đơn vị bán, số lượng và ghi chú.
  await page.getByRole("heading", { name: "MACALLAN 12", exact: true }).click()
  await expect(page.getByRole("radio", { name: /Ly/ })).toHaveAttribute("aria-checked", "true")
  await page.getByRole("radio", { name: /Chai/ }).click()
  await page.getByRole("button", { name: "Tăng số lượng MACALLAN 12" }).click()
  await page.getByLabel("Ghi chú cho Bar/Bếp").fill("mở tại bàn")
  await expect(page.getByRole("button", { name: /Thêm vào giỏ · 13\.000\.000đ/ })).toBeVisible()
  await page.getByRole("button", { name: /Thêm vào giỏ/ }).click()

  // 2. Thanh giỏ nói đúng số món và tổng tiền.
  await expect(page.getByRole("button", { name: /Giỏ gọi món · 2 món/ })).toBeVisible()
  await expect(page.getByRole("button", { name: /13\.000\.000đ/ })).toBeVisible()

  // Món tạm hết không thêm được vào giỏ.
  await page.getByRole("heading", { name: "TRUFFLE FRIES", exact: true }).click()
  await expect(page.getByText("Món này đang tạm hết ở mọi đơn vị bán")).toBeVisible()
  await expect(page.getByRole("button", { name: "Thêm vào giỏ" })).toBeDisabled()
  await page.keyboard.press("Escape")

  // Thêm thêm một ly: giỏ gộp theo biến thể, không sinh dòng thứ hai.
  await page.getByRole("heading", { name: "MACALLAN 12", exact: true }).click()
  await page.getByRole("radio", { name: /Ly/ }).click()
  await page.getByRole("button", { name: /Thêm vào giỏ/ }).click()
  await expect(page.getByRole("button", { name: /Giỏ gọi món · 3 món/ })).toBeVisible()

  const draftAfterAdd = await page.evaluate((key) => sessionStorage.getItem(key), CART_KEY)
  if (!draftAfterAdd || !draftAfterAdd.includes('"variantId":2')) {
    failures.push(`${viewport.name}: nháp giỏ không được ghi vào ${CART_KEY}`)
  }
  const foreignDraft = await page.evaluate(
    (key) => sessionStorage.getItem(key),
    `21gam.waiter-cart.v1:${USER_ID}:${VENUE_ID}:999`,
  )
  if (foreignDraft !== null) failures.push(`${viewport.name}: nháp rò sang Phiên khác`)

  // 2b. Cùng một biến thể, hai ghi chú khác nhau = hai dòng.
  //
  // Đây là lý do dòng giỏ có `cartLineId`: nếu sửa/xóa đi theo variantId thì
  // chạm vào dòng nào cũng sửa cả hai, và một trong hai lời nhắn sẽ không tới
  // được Bar.
  for (const note of ["ít đá", "không đá"]) {
    await page.getByRole("heading", { name: "MACALLAN 12", exact: true }).click()
    await page.getByRole("radio", { name: /Ly/ }).click()
    await page.getByLabel("Ghi chú cho Bar/Bếp").fill(note)
    await page.getByRole("button", { name: /Thêm vào giỏ/ }).click()
  }
  await page.getByRole("button", { name: /Giỏ gọi món/ }).click()
  await expect(page.getByLabel("Ghi chú cho MACALLAN 12 Ly · ít đá")).toHaveValue("ít đá")
  await expect(page.getByLabel("Ghi chú cho MACALLAN 12 Ly · không đá")).toHaveValue("không đá")
  // Gộp chỉ khi cùng ghi chú: thêm lại "ít đá" làm dòng đó thành 2, không tạo dòng thứ ba.
  await page.keyboard.press("Escape")
  await page.getByRole("heading", { name: "MACALLAN 12", exact: true }).click()
  await page.getByRole("radio", { name: /Ly/ }).click()
  await page.getByLabel("Ghi chú cho Bar/Bếp").fill("Ít  Đá")
  await page.getByRole("button", { name: /Thêm vào giỏ/ }).click()
  await page.getByRole("button", { name: /Giỏ gọi món/ }).click()
  await expect(page.getByRole("button", { name: /^Giảm số lượng MACALLAN 12 Ly · ít đá$/ })).toHaveCount(1)
  await expect(page.getByLabel("Ghi chú cho MACALLAN 12 Ly · ít đá")).toHaveValue("ít đá")
  // Bỏ hai dòng vừa thêm: phần còn lại của luồng kiểm đúng một dòng như trước.
  await page.getByRole("button", { name: "Bỏ MACALLAN 12 Ly · ít đá khỏi giỏ" }).click()
  await page.getByRole("button", { name: "Bỏ MACALLAN 12 Ly · không đá khỏi giỏ" }).click()
  await page.keyboard.press("Escape")

  // 3. Mở giỏ, sửa số lượng và ghi chú.
  await page.getByRole("button", { name: /Giỏ gọi món · 3 món/ }).click()
  await expect(page.getByRole("heading", { name: /Giỏ gọi món · A1 \+ A2/ })).toBeVisible()
  await expect(page.getByText("mở tại bàn")).toHaveCount(0)
  await expect(page.getByLabel("Ghi chú cho MACALLAN 12 Chai · mở tại bàn")).toHaveValue("mở tại bàn")
  await page.getByRole("button", { name: "Giảm số lượng MACALLAN 12 Chai · mở tại bàn" }).click()
  await expect(page.getByRole("button", { name: /Gửi đơn/ }).last()).toBeVisible()

  if (viewport.name === "390x844") {
    await page.screenshot({ path: path.join(output, `${viewport.name}-cart.png`) })
  }

  // 4. Gửi đơn: xác nhận, rồi giá đổi → hỏi lại bằng số cụ thể.
  await page.getByRole("button", { name: "Gửi đơn" }).last().click()
  await expect(page.getByRole("heading", { name: /Gửi đơn tới Quầy bar\?/ })).toBeVisible()
  await page.getByRole("button", { name: "Gửi đơn" }).last().click()
  await expect(page.getByRole("heading", { name: "Giá vừa thay đổi" })).toBeVisible()
  const priceRow = page.getByRole("alertdialog").getByRole("listitem").first()
  await expect(priceRow.locator("s")).toHaveText("380.000đ")
  await expect(priceRow.locator("strong").last()).toHaveText("420.000đ")
  await page.getByRole("button", { name: "Xác nhận giá mới" }).click()

  // Xác nhận giá KHÔNG gửi đơn: vẫn đúng một request tới giờ.
  if (submissions.length !== 1) failures.push(`${viewport.name}: xác nhận giá đã tự gửi đơn`)
  await expect(page.getByRole("alert")).toContainText("Bấm Gửi đơn")
  // Giỏ được giữ nguyên sau lỗi, và giá mới đã vào giỏ.
  await expect(page.getByRole("button", { name: /Giỏ gọi món · 2 món/ })).toHaveCount(0)
  await expect(page.getByText("420.000đ").first()).toBeVisible()

  // 5. Bấm lại: lần này thành công. Trong lúc đang gửi, nút bị khóa.
  holdResponseMs = 600
  await page.getByRole("button", { name: "Gửi đơn" }).last().click()
  await page.getByRole("button", { name: "Gửi đơn" }).last().click()
  await expect(page.getByRole("button", { name: "Đang gửi đơn…" })).toBeDisabled()
  await expect(page.getByText(/Đã gửi \d+ món tới Quầy bar/)).toBeVisible({ timeout: 10_000 })
  if (submissions.length !== 2) {
    failures.push(`${viewport.name}: ${submissions.length} request gửi đơn, mong đợi 2`)
  }
  const keys = new Set(submissions.map((payload) => payload.idempotencyKey))
  if (keys.size !== 2) failures.push(`${viewport.name}: mã chống trùng không đổi sau khi giỏ đổi`)
  for (const payload of submissions) {
    const fields = Object.keys(payload).sort().join(",")
    if (fields !== "idempotencyKey,lines,visitId") {
      failures.push(`${viewport.name}: payload gửi thêm trường ngoài hợp đồng (${fields})`)
    }
    for (const line of payload.lines) {
      const lineFields = Object.keys(line).sort().join(",")
      if (
        !["priceId,priceVersion,quantity,variantId", "note,priceId,priceVersion,quantity,variantId"].includes(
          lineFields,
        )
      ) {
        failures.push(`${viewport.name}: dòng đơn gửi thêm trường (${lineFields})`)
      }
    }
  }

  // 6. Giỏ chỉ trống SAU khi có đơn thật, và nháp đã được dọn.
  await expect(page.getByRole("button", { name: /Giỏ gọi món/ })).toHaveCount(0)
  const draftAfterSend = await page.evaluate((key) => sessionStorage.getItem(key), CART_KEY)
  if (draftAfterSend !== null) failures.push(`${viewport.name}: nháp giỏ còn lại sau khi gửi thành công`)

  const dimensions = await readOverflow(page)
  if (dimensions.scrollWidth > dimensions.clientWidth + 1 || dimensions.overflow.length) {
    failures.push(`${viewport.name}: horizontal overflow ${JSON.stringify(dimensions)}`)
  }
  await page.screenshot({ path: path.join(output, `${viewport.name}.png`), fullPage: false })
  await context.close()
}

await browser.close()
if (failures.length) {
  for (const failure of failures) console.error(failure)
  process.exit(1)
}
console.log(`Đạt: ${viewports.length} viewport, giỏ gọi món và gửi đơn; ảnh tại ${output}`)

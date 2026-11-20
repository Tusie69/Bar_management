import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { chromium, expect } from "@playwright/test"

const base = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5191"
const output = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), "21gam-waiter-menu")
const launchOptions = process.env.PW_CHROMIUM_PATH
  ? { executablePath: process.env.PW_CHROMIUM_PATH }
  : { executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" }
const viewports = [
  { name: "360x800", width: 360, height: 800 },
  { name: "390x844", width: 390, height: 844 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1280x800", width: 1280, height: 800 },
]

const session = {
  user: {
    id: 6,
    username: "waiter_ui",
    displayName: "Phục vụ UI",
    organizationId: 1,
    venueId: 1,
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
    visitId: 42,
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
      id: 2,
      code: "BOTTLE_ONLY",
      categoryId: 2,
      name: "BOTTLE ONLY RESERVE",
      description: null,
      preparationStation: "BAR",
      availabilityStatus: "AVAILABLE",
      displayOrder: 2,
      variants: [variant(3, "BOTTLE", "Chai", 4200000)],
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
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ json: session }))
  await page.route("**/api/v1/waiter/menu?*", (route) => route.fulfill({ json: menu }))
  await page.goto(`${base}/phucvu/phien/42/goi-mon`, { waitUntil: "networkidle" })
  await expect(page.getByRole("heading", { name: /Gọi món · A1 \+ A2/ })).toBeVisible()
  await expect(page.getByText("4 khách", { exact: true })).toBeVisible()
  await expect(page.getByText("MACALLAN 12", { exact: true })).toBeVisible()
  await expect(page.getByText("TRUFFLE FRIES", { exact: true })).toBeVisible()
  await expect(page.getByText("Tạm hết", { exact: true })).toBeVisible()

  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    overflow: [...document.querySelectorAll("button,input,main,section")]
      .map((element) => ({
        label: element.getAttribute("aria-label") || element.textContent?.trim().slice(0, 30),
        rect: element.getBoundingClientRect(),
      }))
      .filter(({ rect }) => rect.width > 0 && rect.right > document.documentElement.clientWidth + 1)
      .map(({ label, rect }) => ({ label, right: Math.round(rect.right) })),
  }))
  if (dimensions.scrollWidth > dimensions.clientWidth + 1 || dimensions.overflow.length) {
    failures.push(`${viewport.name}: horizontal overflow ${JSON.stringify(dimensions)}`)
  }

  if (viewport.name === "390x844") {
    await page.getByRole("searchbox", { name: "Tìm món" }).fill("macallan")
    await expect(page.getByText("BOTTLE ONLY RESERVE", { exact: true })).toHaveCount(0)
    await page.getByText("MACALLAN 12", { exact: true }).click()
    await expect(page.getByText("Ly", { exact: true })).toBeVisible()
    await expect(page.getByText("380.000đ", { exact: true })).toBeVisible()
    await expect(page.getByText("Chai", { exact: true })).toBeVisible()
    await expect(page.getByText("6.500.000đ", { exact: true })).toBeVisible()
    // Module 3: ô chọn món giờ có chọn đơn vị bán, số lượng và ghi chú. Luồng
    // giỏ và gửi đơn được kiểm riêng ở `waiter-order.mjs`.
    await expect(page.getByRole("radio", { name: /Ly/ })).toHaveAttribute("aria-checked", "true")
    await expect(page.getByRole("button", { name: /Thêm vào giỏ · 380\.000đ/ })).toBeVisible()
    await page.keyboard.press("Escape")
    await page.getByRole("searchbox", { name: "Tìm món" }).fill("")
    await page.getByRole("tab", { name: "Đồ ăn" }).click()
    await expect(page.getByText("TRUFFLE FRIES", { exact: true })).toBeVisible()
    await expect(page.getByText("MACALLAN 12", { exact: true })).toHaveCount(0)
  }
  await page.screenshot({ path: path.join(output, `${viewport.name}.png`), fullPage: false })
  await context.close()
}

await browser.close()
if (failures.length) {
  for (const failure of failures) console.error(failure)
  process.exit(1)
}
console.log(`Đạt: ${viewports.length} viewport, không tràn ngang; ảnh tại ${output}`)

import fs from "node:fs/promises"
import path from "node:path"
import { chromium } from "@playwright/test"

const base = process.env.E2E_BASE_URL ?? "http://localhost:5173"
const output = process.env.E2E_ARTIFACT_DIR
if (!output) throw new Error("E2E_ARTIFACT_DIR is required")
await fs.mkdir(output, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
const consoleErrors = []
const failedResponses = []
const requests = []
let signedIn = false
let delayReads = false
let floorError = false
let tableReads = 0

page.on("console", (message) => {
  if (message.type() === "error" && !message.text().includes("Failed to load resource")) {
    consoleErrors.push(message.text())
  }
})
page.on("request", (request) => requests.push(request.url()))
page.on("response", (response) => {
  if (response.status() >= 400 && response.status() !== 401) {
    failedResponses.push(`${response.status()} ${response.url()}`)
  }
})

const headers = { "access-control-allow-origin": base, "access-control-allow-credentials": "true" }
const session = {
  user: { id: 7, username: "operator", displayName: "Lễ tân", organizationId: 1, venueId: 1 },
  permissions: ["customer.view_masked"],
  csrfToken: "csrf-visual",
}
const catalog = {
  venue: {
    id: 1,
    version: 1,
    name: "21GAM",
    timezone: "Asia/Ho_Chi_Minh",
    businessDayStartLocal: "17:00:00",
    businessDayCutoffLocal: "05:00:00",
    lateWarningMinutes: 15,
    noShowWarningMinutes: 30,
    waitlistHoldDefaultMinutes: 30,
    waitlistClaimLeaseSeconds: 300,
    reservationHoldPolicy: "SEQUENTIAL",
    reservationWindowMinutes: null,
    groupSymbolCount: 12,
    changeSeq: 12,
  },
  zones: [
    { id: 1, version: 1, code: "C", name: "Khu C", isBookable: false, isWaitingArea: true },
    { id: 2, version: 1, code: "B", name: "Khu B", isBookable: true, isWaitingArea: false },
    { id: 3, version: 1, code: "A", name: "Khu A", isBookable: true, isWaitingArea: false },
    { id: 4, version: 1, code: "BAR", name: "Quầy Bar", isBookable: true, isWaitingArea: false },
  ],
  tables: [
    {
      id: 1,
      version: 1,
      code: "A1",
      displayName: "Bàn A1",
      zoneId: 3,
      zoneCode: "A",
      kind: "TABLE",
      capacity: 4,
      seqNo: null,
      isSpare: false,
      status: "ACTIVE",
      x: 80,
      y: 654,
      width: 46,
      height: 32,
    },
    {
      id: 2,
      version: 1,
      code: "A10",
      displayName: "Bàn A10",
      zoneId: 3,
      zoneCode: "A",
      kind: "TABLE",
      capacity: 4,
      seqNo: null,
      isSpare: true,
      status: "ACTIVE",
      x: 231,
      y: 685,
      width: 38,
      height: 38,
    },
    {
      id: 3,
      version: 1,
      code: "B11",
      displayName: "Bàn B11",
      zoneId: 2,
      zoneCode: "B",
      kind: "TABLE",
      capacity: 4,
      seqNo: null,
      isSpare: false,
      status: "ACTIVE",
      x: 381,
      y: 286,
      width: 48,
      height: 30,
    },
    {
      id: 4,
      version: 1,
      code: "B12",
      displayName: "Bàn B12",
      zoneId: 2,
      zoneCode: "B",
      kind: "TABLE",
      capacity: 4,
      seqNo: null,
      isSpare: false,
      status: "ACTIVE",
      x: 381,
      y: 325,
      width: 48,
      height: 30,
    },
    {
      id: 5,
      version: 1,
      code: "BAR21",
      displayName: "Ghế Bar 21",
      zoneId: 4,
      zoneCode: "BAR",
      kind: "BAR_SEAT",
      capacity: 1,
      seqNo: 21,
      isSpare: false,
      status: "OUT_OF_SERVICE",
      x: 514,
      y: 358,
      width: 20,
      height: 20,
    },
  ],
  combinations: [],
}

await page.route("**/api/v1/**", async (route) => {
  const request = route.request()
  const url = new URL(request.url())
  const endpoint = url.pathname
  if (endpoint === "/api/v1/auth/me") {
    return signedIn
      ? route.fulfill({ status: 200, headers, json: session })
      : route.fulfill({
          status: 401,
          headers,
          json: { error: { code: "AUTHENTICATION_REQUIRED", message: "Vui lòng đăng nhập." } },
        })
  }
  if (endpoint === "/api/v1/auth/login") {
    signedIn = true
    return route.fulfill({ status: 200, headers, json: session })
  }
  if (delayReads && endpoint !== "/api/v1/auth/me") await new Promise((resolve) => setTimeout(resolve, 2000))
  if (floorError && endpoint !== "/api/v1/auth/me") {
    return route.fulfill({
      status: 500,
      headers,
      json: { error: { code: "READ_FAILED", message: "Không đọc được dữ liệu bàn." } },
    })
  }
  if (endpoint === "/api/v1/tables/catalog") return route.fulfill({ status: 200, headers, json: catalog })
  if (endpoint === "/api/v1/bookings/sources") {
    return route.fulfill({ status: 200, headers, json: { sources: [{ code: "HOTLINE", name: "Hotline" }] } })
  }
  if (endpoint === "/api/v1/tables") {
    tableReads += 1
    return route.fulfill({
      status: 200,
      headers,
      json: {
        businessDate: "2026-10-28",
        tables: [
          {
            id: 1,
            code: "A1",
            state: "IN_USE",
            isBackup: false,
            activeVisit: {
              id: 31,
              version: 1,
              tableCodes: ["A1"],
              displayName: "Khách tại bàn",
              phoneLast3: null,
              guestCount: 4,
              startedAt: "2026-10-28T12:00:00.000Z",
              origin: "WALK_IN",
              paid: false,
              note: null,
            },
          },
          { id: 2, code: "A10", state: "AVAILABLE", isBackup: true, activeVisit: null },
          { id: 3, code: "B11", state: "RESERVED", isBackup: false, activeVisit: null },
          { id: 4, code: "B12", state: "AVAILABLE", isBackup: false, activeVisit: null },
          { id: 5, code: "BAR21", state: "OUT_OF_SERVICE", isBackup: false, activeVisit: null },
        ],
      },
    })
  }
  if (endpoint === "/api/v1/bookings") {
    return route.fulfill({
      status: 200,
      headers,
      json: {
        businessDate: "2026-10-28",
        bookings: [
          {
            id: 41,
            guestName: "Khách đặt",
            phoneLast3: "789",
            partySize: 4,
            expectedAt: "2026-10-28T12:30:00.000Z",
            businessDate: "2026-10-28",
            status: "BOOKED",
            sourceCode: "HOTLINE",
            tableCodes: ["B11"],
            note: null,
            version: 1,
            displayStatus: "UPCOMING",
            minutesLate: 0,
          },
        ],
      },
    })
  }
  return route.fulfill({ status: 404, headers, json: { error: { code: "NOT_FOUND", message: "Không tìm thấy." } } })
})

const shot = (name) => page.screenshot({ path: path.join(output, name), fullPage: true })

await page.goto(base, { waitUntil: "networkidle" })
await page.getByText("Đăng nhập 21GAM").waitFor()
await shot("01-login.png")
await page.getByLabel("Tên đăng nhập").fill("operator")
await page.getByLabel("Mật khẩu").fill("visual-test-password")
await page.getByRole("button", { name: "Đăng nhập", exact: true }).click()
await page.getByLabel("Sơ đồ bàn từ backend").waitFor()
await page.getByRole("button", { name: /Bàn A10, Bàn sơ cua/ }).waitFor()
await page.getByRole("button", { name: /Ghế Bar 21, Ngưng phục vụ/ }).waitFor()
await shot("02-floor-desktop-1920x1080.png")

const beforeRefresh = tableReads
await page.getByRole("button", { name: "Làm mới" }).click()
await page.waitForTimeout(500)
if (tableReads <= beforeRefresh) throw new Error("Refresh did not request floor state again")

await page.setViewportSize({ width: 1366, height: 768 })
await page.getByLabel("Sơ đồ bàn từ backend").waitFor()
await shot("03-floor-laptop-1366x768.png")

await page.setViewportSize({ width: 390, height: 844 })
await page.getByLabel("Sơ đồ bàn từ backend").waitFor()
await shot("04-floor-mobile-390x844.png")

await page.setViewportSize({ width: 1366, height: 768 })
delayReads = true
await page.reload({ waitUntil: "domcontentloaded" })
await page.getByLabel("Đang tải sơ đồ bàn").waitFor()
await shot("05-floor-loading.png")
delayReads = false
await page.getByLabel("Sơ đồ bàn từ backend").waitFor()

floorError = true
await page.reload({ waitUntil: "networkidle" })
await page.getByText("Không tải được sơ đồ bàn").waitFor()
await shot("06-floor-error.png")

if (requests.some((url) => url.toLowerCase().includes("mock"))) throw new Error("HTTP mode requested a mock resource")
if (failedResponses.some((item) => item.startsWith("404")))
  throw new Error(`Unexpected 404: ${failedResponses.join(", ")}`)
if (consoleErrors.length) throw new Error(`Browser console errors: ${consoleErrors.join(" | ")}`)

console.log(JSON.stringify({ output, screenshots: 6, tableReads, unexpected404: 0, consoleErrors: 0 }))
await browser.close()

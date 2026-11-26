// E2E verification for NA-45 HU-44 v1.1 W2 (Waiter + Bartender: Xem tạm tính & Xuất hóa đơn).
// Intended to run after W1's mock implementation is merged. Port 43942 only.
// Artifacts (screenshots) are written strictly inside web/e2e/.artifacts/w2-waiter-bar/.
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { chromium, expect } from "@playwright/test"
import { createServer as createViteServer } from "vite"

const ARTIFACTS_DIR = path.resolve("e2e/.artifacts/w2-waiter-bar")
fs.mkdirSync(ARTIFACTS_DIR, { recursive: true })

const BASE_PORT = 43942
const PROVIDED_BASE = process.env.E2E_BASE_URL
const base = PROVIDED_BASE ?? `http://127.0.0.1:${BASE_PORT}`

async function startOwnedVite(port) {
  const server = await createViteServer({
    configFile: path.resolve("vite.config.ts"),
    clearScreen: false,
    logLevel: "silent",
    server: { host: "127.0.0.1", port, strictPort: true },
  })
  await server.listen()
  return server
}

let viteServer = null
if (!PROVIDED_BASE) {
  viteServer = await startOwnedVite(BASE_PORT)
}

const launchOptions = {
  headless: true,
  ...(process.platform === "win32" && fs.existsSync("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
    ? { executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" }
    : {}),
  ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
}

const browser = await chromium.launch(launchOptions)

async function openUser(vp, userId, startPath) {
  const context = await browser.newContext({ viewport: vp })
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (e) => errors.push(e.message))
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text())
  })
  await page.addInitScript((uid) => {
    localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: uid, theme: "light" }))
  }, userId)
  await page.goto(`${base}${startPath}`, { waitUntil: "networkidle" })
  await page.evaluate(() => window.__21gamPaymentMock?.reset?.())
  await page.goto(`${base}${startPath}`, { waitUntil: "networkidle" })
  return { context, page, errors }
}

async function assertNoOverflow(page, label) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  assert(overflow <= 1, `${label}: horizontal overflow ${overflow}px`)
}

const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "1440", width: 1440, height: 900 },
]

const results = []
try {
  // 1. VM-01 / VM-03 / VM-04 / VM-05 / VM-11 / NA45C-12: Waiter flow (userId 6)
  for (const vp of VIEWPORTS) {
    const { context, page, errors } = await openUser({ width: vp.width, height: vp.height }, 6, "/phucvu")
    try {
      await page.locator('[aria-label^="Bàn A3,"]').first().click()
      await page.getByRole("button", { name: /Xem tạm tính & xuất hóa đơn/ }).click()

      const visitId = new URL(page.url()).pathname.split("/")[3]
      assert(/^\d+$/.test(visitId), `${vp.name}: expected numeric visitId, got ${visitId}`)
      await assertNoOverflow(page, `waiter-${vp.name}-detail`)
      await expect(page.getByRole("button", { name: "Gửi yêu cầu thanh toán" })).toHaveCount(0)
      await expect(page.getByRole("button", { name: "Chốt bill & thu tiền" })).toHaveCount(0)
      await page.screenshot({ path: path.join(ARTIFACTS_DIR, `waiter-${vp.name}-detail.png`) })

      // VM-03 / VM-04: Xem tạm tính -> NO QR, label "Tạm tính – chưa phải hóa đơn", no state change
      await page.getByRole("button", { name: "Xem tạm tính" }).click()
      await expect(page.getByText("Tạm tính – chưa phải hóa đơn").first()).toBeVisible()
      await expect(page.getByText("DEMO – KHÔNG CHUYỂN TIỀN")).toHaveCount(0)
      await assertNoOverflow(page, `waiter-${vp.name}-preview`)
      await page.screenshot({ path: path.join(ARTIFACTS_DIR, `waiter-${vp.name}-preview.png`) })

      // Back to /phucvu and verify A3 is still SERVING (canOrder enabled)
      await page.getByRole("button", { name: "Chi tiết Phiên" }).click()
      await page.getByRole("button", { name: "Sơ đồ bàn" }).click()
      await page.locator('[aria-label^="Bàn A3,"]').first().click()
      await expect(page.getByRole("button", { name: "Gọi món" })).toBeEnabled()

      // Return to bill detail and issue invoice -> Invoice with QR + Techcombank + Sonner toast (NA45C-12)
      await page.getByRole("button", { name: /Xem tạm tính & xuất hóa đơn/ }).click()
      await page.getByRole("button", { name: "Xuất hóa đơn" }).click()
      await expect(page.getByText("HÓA ĐƠN", { exact: true })).toBeVisible()
      await expect(page.getByText("DEMO – KHÔNG CHUYỂN TIỀN")).toBeVisible()
      await expect(page.getByText("Techcombank")).toBeVisible()
      await expect(page.locator("[data-sonner-toast]").filter({ hasText: /Đã xuất hóa đơn/ })).toBeVisible()
      await expect(page.getByTestId("pay-feedback")).toHaveCount(0)
      await assertNoOverflow(page, `waiter-${vp.name}-invoice`)
      await page.screenshot({ path: path.join(ARTIFACTS_DIR, `waiter-${vp.name}-invoice.png`) })

      // TN-07-K7: money views blocked
      for (const forbidden of ["method", "cash", "qr", "success"]) {
        await page.goto(`${base}/phucvu/phien/${visitId}/thanh-toan?view=${forbidden}`, {
          waitUntil: "networkidle",
        })
        await expect(page.getByRole("button", { name: /Xác nhận đã nhận/ })).toHaveCount(0)
        await expect(page.getByRole("heading", { name: "Chọn phương thức thanh toán" })).toHaveCount(0)
      }

      assert.deepEqual(errors, [], `waiter-${vp.name} console errors: ${errors.join(" | ")}`)
      results.push(`PASS waiter-${vp.name}`)
    } finally {
      await context.close()
    }
  }

  // 2. VM-02 / D1 / TN-02-K7: Bartender flow on /chebien (userId 8)
  for (const vp of VIEWPORTS) {
    const { context, page, errors } = await openUser({ width: vp.width, height: vp.height }, 8, "/chebien")
    try {
      await page.getByRole("button", { name: "Hóa đơn quầy Bar" }).click()
      await expect(page.getByText("Khách quầy Bar")).toBeVisible()
      await page.locator(".pay-w2-sess-btn", { hasText: "BAR01" }).click()
      await assertNoOverflow(page, `bar-${vp.name}-detail`)

      await page.getByRole("button", { name: "Xem tạm tính" }).click()
      await expect(page.getByText("Tạm tính – chưa phải hóa đơn").first()).toBeVisible()
      await expect(page.getByText("DEMO – KHÔNG CHUYỂN TIỀN")).toHaveCount(0)

      await page.getByRole("button", { name: "Xuất hóa đơn" }).click()
      await expect(page.getByText("HÓA ĐƠN", { exact: true })).toBeVisible()
      await expect(page.getByText("DEMO – KHÔNG CHUYỂN TIỀN")).toBeVisible()
      await expect(page.getByText("Techcombank")).toBeVisible()
      await expect(page.getByRole("button", { name: /Xác nhận đã nhận/ })).toHaveCount(0)
      await expect(page.getByRole("button", { name: /Chốt bill & thu tiền/ })).toHaveCount(0)
      await assertNoOverflow(page, `bar-${vp.name}-invoice`)
      await page.screenshot({ path: path.join(ARTIFACTS_DIR, `bar-${vp.name}-invoice.png`) })

      assert.deepEqual(errors, [], `bar-${vp.name} console errors: ${errors.join(" | ")}`)
      results.push(`PASS bar-${vp.name}`)
    } finally {
      await context.close()
    }
  }

  console.log(results.join("\n"))
} finally {
  await browser.close()
  if (viteServer) await viteServer.close()
}

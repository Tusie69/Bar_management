// E2E mock verification for NA-45/46 payment flows across 390, 820, and 1440 viewports.
// Artifacts (screenshots) are written strictly inside web/e2e/.artifacts/.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { chromium, expect } from "@playwright/test"

const ARTIFACTS_DIR = path.resolve("e2e/.artifacts")
fs.mkdirSync(ARTIFACTS_DIR, { recursive: true })

const BASE_PORT = 4195
const PROVIDED_BASE = process.env.E2E_BASE_URL
const base = PROVIDED_BASE ?? `http://127.0.0.1:${BASE_PORT}`

async function waitForServer(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok) return true
    } catch {
      /* waiting */
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}

let devServer = null
if (!PROVIDED_BASE) {
  const alreadyUp = await waitForServer(base, 800)
  if (!alreadyUp) {
    devServer =
      process.platform === "win32"
        ? spawn("cmd.exe", ["/c", "pnpm", "exec", "vite", "--host", "127.0.0.1", "--port", String(BASE_PORT), "--strictPort"], {
            stdio: "ignore",
          })
        : spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", String(BASE_PORT), "--strictPort"], {
            stdio: "ignore",
          })
    const ready = await waitForServer(base, 25_000)
    if (!ready) {
      devServer.kill()
      throw new Error(`Timed out waiting for Vite dev server at ${base}`)
    }
  }
}

const launchOptions = {
  headless: true,
  ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
}

const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "820", width: 820, height: 1180 },
  { name: "1440", width: 1440, height: 900 },
]

const browser = await chromium.launch(launchOptions)

async function openCashierPayment(vp, userId = 5) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (e) => errors.push(e.message))
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text())
  })
  await page.addInitScript((uid) => {
    localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: uid, theme: "light" }))
  }, userId)
  await page.goto(`${base}/payment`, { waitUntil: "networkidle" })
  await page.evaluate(() => window.__21gamPaymentMock?.reset?.())
  await page.goto(`${base}/payment`, { waitUntil: "networkidle" })
  return { context, page, errors }
}

const results = []
try {
  for (const vp of VIEWPORTS) {
    // 1. S1 List, notifications, floor map zoom + split cluster, S2 detail, S3 preview, S4 method, S5 cash (short/exact/over), S7 success
    {
      const { context, page, errors } = await openCashierPayment(vp, 5)
      try {
        await expect(page.getByText("Xin chào,").first()).toBeVisible()
        await expect(page.getByText("Thu ngân · Thu ngân").first()).toBeVisible()

        // Sort order check: G01 (awaiting payment) first, B4 (requested) second
        const rowCodes = await page.locator(".pay-sess b").allTextContents()
        const orderedCodes = rowCodes.filter((c) => ["G01", "B4", "A3", "Bar1", "G02"].includes(c))
        assert.deepEqual(orderedCodes, ["G01", "B4", "A3", "Bar1", "G02"], `${vp.name}: unexpected sort order ${orderedCodes}`)

        // No "A1 + A2" for cluster G01
        const listText = await page.locator(".pay-sess-list").textContent()
        assert(!listText.includes("A1 + A2"), `${vp.name}: cluster must show G01, never A1 + A2`)

        // Notifications bell: unread dot -> open clears unread & shows types
        const bell = page.getByRole("button", { name: /Thông báo thanh toán/ })
        await expect(page.getByTestId("pay-ntf-unread-dot")).toBeVisible()
        await bell.click()
        await expect(page.getByRole("dialog", { name: "Thông báo thanh toán" })).toBeVisible()
        await expect(page.getByText("Đã hủy món").first()).toBeVisible()
        await expect(page.getByText("Gọi thanh toán").first()).toBeVisible()
        await expect(page.getByText("Chờ thanh toán").first()).toBeVisible()
        await bell.click()
        await expect(page.getByTestId("pay-ntf-unread-dot")).toHaveCount(0)

        // Floor map A10 must not overlap Bar1/Bar2
        const clearance = await page.evaluate(() => {
          const a10 = document.querySelector('[aria-label^="A10,"]')?.getBoundingClientRect()
          const bar1 = document.querySelector('[aria-label^="BAR01,"]')?.getBoundingClientRect()
          if (!a10 || !bar1) return true
          return a10.right <= bar1.left + 0.5
        })
        assert(clearance, `${vp.name}: A10 overlapped Bar1`)

        // First tap on G02 -> zooms & splits into 2 frames
        await page.locator(".pay-sess", { hasText: "G02" }).click()
        await expect(page.getByText("Cụm G02 có bàn ở xa nhau nên sơ đồ tách thành 2 khung.")).toBeVisible()
        await expect(page.locator(".pay-fpanel")).toHaveCount(2)
        await page.screenshot({ path: path.join(ARTIFACTS_DIR, `payment-${vp.name}-s1-split.png`) })

        // Zoom back out with Toàn sơ đồ
        await page.getByRole("button", { name: "Toàn sơ đồ", exact: true }).click()
        await expect(page.locator(".pay-fpanel")).toHaveCount(1)

        // First tap on A3 selects; second tap opens S2 detail
        const a3Row = page.locator(".pay-sess", { hasText: "A3" })
        await a3Row.click()
        await expect(page.getByText("Chạm lần nữa để mở chi tiết")).toBeVisible()
        await page.screenshot({ path: path.join(ARTIFACTS_DIR, `payment-${vp.name}-s1-list.png`) })
        await a3Row.click()

        // S2 detail: cancelled Margarita hidden, Mojito making warning visible, rounding shown separately
        await expect(page.getByRole("heading", { name: "Chi tiết Phiên" })).toBeVisible()
        await expect(page.getByText("Tiger Crystal")).toBeVisible()
        await expect(page.getByText("Mojito")).toBeVisible()
        await expect(page.getByText("Margarita")).toHaveCount(0)
        await expect(page.getByText(/dòng món đã hủy/)).toHaveCount(0)
        await expect(page.getByText("1 món đang làm, vẫn tính vào bill. Hỏi khách trước khi chốt.")).toBeVisible()
        await expect(page.getByText("Làm tròn lên nghìn (bước cuối)")).toBeVisible()
        await page.screenshot({ path: path.join(ARTIFACTS_DIR, `payment-${vp.name}-s2-detail.png`) })

        // S3 preview: no page title, toggle 80mm, demo QR
        await page.getByRole("button", { name: "Xem tạm tính" }).click()
        await expect(page.getByRole("button", { name: "Trên màn hình" })).toBeVisible()
        await expect(page.getByRole("button", { name: "Bản in 80mm" })).toBeVisible()
        await expect(page.getByText("Bill tạm tính, chưa phải hóa đơn. Món đã hủy không tính.")).toBeVisible()
        await page.screenshot({ path: path.join(ARTIFACTS_DIR, `payment-${vp.name}-s3-preview.png`) })
        await page.getByRole("button", { name: "Bản in 80mm" }).click()
        await expect(page.getByLabel("Bản in tạm tính khổ 80mm")).toBeVisible()

        // S4 method
        await page.getByRole("button", { name: "Chốt bill & thu tiền" }).click()
        await expect(page.getByRole("heading", { name: "Chọn phương thức thanh toán" })).toBeVisible()
        await page.screenshot({ path: path.join(ARTIFACTS_DIR, `payment-${vp.name}-s4-method.png`) })

        // S5 cash: short -> exact -> over -> confirm -> S7 success
        await page.getByRole("button", { name: /Tiền mặt/ }).click()
        await expect(page.getByRole("heading", { name: "Thanh toán tiền mặt" })).toBeVisible()
        const cashInput = page.getByLabel("Khách đưa")
        await cashInput.fill("100000")
        await expect(page.getByText("Còn thiếu")).toBeVisible()
        const confirmCashBtn = page.getByRole("button", { name: /Xác nhận đã nhận/ })
        await expect(confirmCashBtn).toBeDisabled()

        // Exact chip (231.000) has no "vừa đủ" sub-label
        const exactChip = page.getByRole("button", { name: "231.000", exact: true })
        await exactChip.click()
        await expect(page.locator("#pay-cash-res").getByText("Vừa đủ")).toBeVisible()
        await expect(page.locator("#pay-cash-res").getByText("0đ", { exact: true })).toBeVisible()

        // Over (500.000)
        await page.getByRole("button", { name: "500.000", exact: true }).click()
        await expect(page.getByText("Tiền thừa trả khách")).toBeVisible()
        await page.waitForTimeout(200)
        await page.screenshot({ path: path.join(ARTIFACTS_DIR, `payment-${vp.name}-s5-cash.png`) })

        await confirmCashBtn.click()
        await expect(page.getByRole("heading", { name: "Đã thanh toán" })).toBeVisible()
        await expect(page.getByText("Trống", { exact: true }).first()).toBeVisible()
        await page.screenshot({ path: path.join(ARTIFACTS_DIR, `payment-${vp.name}-s7-success-cash.png`) })

        // Back to S1: A3 is gone from open list and A3 tile is Trống
        await page.getByRole("button", { name: "Về danh sách Phiên" }).click()
        await expect(page.locator(".pay-sess", { hasText: "A3" })).toHaveCount(0)
        await expect(page.getByRole("button", { name: /^Bàn A3, trống$/ })).toBeVisible()

        assert.deepEqual(errors, [], `${vp.name} console errors: ${errors.join(" | ")}`)
        results.push(`PASS ${vp.name} cash flow`)
      } finally {
        await context.close()
      }
    }

    // 2. QR manual confirm + Network error + Duplicate 409
    {
      const { context, page, errors } = await openCashierPayment(vp, 5)
      try {
        // Network error on Cash (B4), then retry succeeds
        await page.locator(".pay-sess", { hasText: "B4" }).click()
        await page.locator(".pay-sess", { hasText: "B4" }).click()
        await page.getByRole("button", { name: "Chốt bill & thu tiền" }).click()
        await page.getByRole("button", { name: /Tiền mặt/ }).click()
        await page.getByRole("button", { name: "500.000", exact: true }).click()
        await page.evaluate(() => window.__21gamPaymentMock.setFault({ nextConfirm: "net" }))
        await page.getByRole("button", { name: /Xác nhận đã nhận/ }).click()
        await expect(page.getByText("Không gửi được tới máy chủ")).toBeVisible()
        await page.screenshot({ path: path.join(ARTIFACTS_DIR, `payment-${vp.name}-err-net.png`) })

        // Retry QR manual confirm on G01 (s408)
        await page.getByRole("button", { name: "Chọn phương thức" }).click()
        await page.getByRole("button", { name: /Chuyển khoản QR/ }).click()
        await page.getByRole("button", { name: /Kiểm tra giao dịch/ }).click()
        await expect(page.getByText("Chưa thấy giao dịch khớp")).toBeVisible()
        await page.screenshot({ path: path.join(ARTIFACTS_DIR, `payment-${vp.name}-s6-qr.png`) })

        await page.getByRole("button", { name: "Xác nhận đã nhận tiền" }).click()
        await page.getByRole("checkbox").check()
        await page.getByRole("button", { name: "Xác nhận", exact: true }).click()
        await expect(page.getByRole("heading", { name: "Đã thanh toán" })).toBeVisible()
        await expect(page.getByText("Chuyển khoản QR · xác nhận tay")).toBeVisible()
        await page.screenshot({ path: path.join(ARTIFACTS_DIR, `payment-${vp.name}-s7-success-qr.png`) })

        // Duplicate 409 on G01
        await page.getByRole("button", { name: "Về danh sách Phiên" }).click()
        await page.locator(".pay-sess", { hasText: "G01" }).click()
        await page.locator(".pay-sess", { hasText: "G01" }).click()
        await page.getByRole("button", { name: "Chốt bill & thu tiền" }).click()
        await page.getByRole("button", { name: /Chuyển khoản QR/ }).click()
        await page.evaluate(() => window.__21gamPaymentMock.setFault({ nextConfirm: "dup" }))
        await page.getByRole("button", { name: "Xác nhận đã nhận tiền" }).click()
        await page.getByRole("checkbox").check()
        await page.getByRole("button", { name: "Xác nhận", exact: true }).click()
        await expect(page.getByText("Bill này đã được thanh toán trên thiết bị khác")).toBeVisible()
        await page.screenshot({ path: path.join(ARTIFACTS_DIR, `payment-${vp.name}-err-dup.png`) })

        assert.deepEqual(errors, [], `${vp.name} QR/error console errors: ${errors.join(" | ")}`)
        results.push(`PASS ${vp.name} qr + error + dup`)
      } finally {
        await context.close()
      }
    }
  }

  // 3. Waiter PA-A flow reached only through session detail on /phucvu (at 390):
  //    Waiter sees S2 + S3 (provisional bill with QR) + request payment, and S4-S7 are unreachable.
  {
    const { context, page, errors } = await openCashierPayment(VIEWPORTS[0], 6)
    try {
      await page.goto(`${base}/phucvu`, { waitUntil: "networkidle" })
      await page.locator('[aria-label^="Bàn A3,"]').first().click()
      await page.getByRole("button", { name: /Xem tạm tính & gọi thu ngân/ }).click()
      await expect(page.getByText("PHƯƠNG ÁN A · QUYỀN PHỤC VỤ")).toBeVisible()
      await expect(page.getByRole("button", { name: "Chốt bill & thu tiền" })).toHaveCount(0)
      const reqBtn = page.getByRole("button", { name: "Gửi yêu cầu thanh toán" })
      await expect(reqBtn).toBeVisible()
      await reqBtn.click()
      await expect(page.getByRole("button", { name: "Đã gửi · chờ Thu ngân chốt" })).toBeDisabled()
      await page.screenshot({ path: path.join(ARTIFACTS_DIR, "payment-390-waiter-pa-a.png") })

      // S3 provisional bill with QR is reachable for Waiter to show guest, without collect button
      await page.getByRole("button", { name: "Xem tạm tính" }).click()
      await expect(page.getByText("BILL TẠM TÍNH", { exact: true })).toBeVisible()
      await expect(page.getByLabel("Mã QR minh họa trên bill, không chuyển tiền được")).toBeVisible()
      await expect(page.getByRole("button", { name: "Chốt bill & thu tiền" })).toHaveCount(0)

      // Prove S4-S7 money routes are blocked for Waiter (direct URL redirect / no money screen)
      for (const forbiddenUrl of [
        "/payment",
        "/payment/s412/method",
        "/payment/s412/cash",
        "/payment/s412/qr",
        "/payment/s412/success",
      ]) {
        await page.goto(`${base}${forbiddenUrl}`, { waitUntil: "networkidle" })
        assert(
          new URL(page.url()).pathname.startsWith("/phucvu"),
          `Waiter direct URL ${forbiddenUrl} should redirect to /phucvu, got ${page.url()}`,
        )
      }
      await page.goto(`${base}/phucvu/phien/s412/thanh-toan?view=cash`, { waitUntil: "networkidle" })
      await expect(page.getByRole("heading", { name: "Thanh toán tiền mặt" })).toHaveCount(0)
      await expect(page.getByRole("button", { name: /Xác nhận đã nhận/ })).toHaveCount(0)

      assert.deepEqual(errors, [], `Waiter PA-A console errors: ${errors.join(" | ")}`)
      results.push("PASS 390 waiter PA-A session detail flow + S4-S7 blocked")
    } finally {
      await context.close()
    }
  }

  console.log(results.join("\n"))
} finally {
  await browser.close()
  if (devServer) devServer.kill()
}

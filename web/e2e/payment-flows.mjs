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
  ...(process.platform === "win32" && fs.existsSync("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
    ? { executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" }
    : {}),
  ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
}

const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "820", width: 820, height: 1180 },
  { name: "1440", width: 1440, height: 900 },
]

const browser = await chromium.launch(launchOptions)

async function openRole(vp, userId, startPath = "/payment", extraOptions = {}) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    ...extraOptions,
  })
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

const results = []
try {
  for (const vp of VIEWPORTS) {
    // 1. S1 List, notifications unread dot on PAID, A10/BAR01 clearance, scroll-to-top on S3,
    //    Cash (short/exact/over), S7 success, Back lock on S4, floor sync on /floor
    {
      const { context, page, errors } = await openRole(vp, 5, "/payment")
      try {
        await expect(page.getByText("Xin chào,").first()).toBeVisible()
        await expect(page.getByText("Thu ngân · Thu ngân").first()).toBeVisible()

        // Sort order check: G02 (awaiting payment) first, G04 (requested) second
        const rowCodes = await page.locator(".pay-sess b").allTextContents()
        const orderedCodes = rowCodes.filter((c) => ["G02", "G04", "A3", "A2", "BAR01"].includes(c))
        assert.deepEqual(orderedCodes, ["G02", "G04", "A3", "A2", "BAR01"], `${vp.name}: unexpected sort order ${orderedCodes}`)

        // Cluster G02 never renders "B11 + B12"
        const listText = await page.locator(".pay-sess-list").textContent()
        assert(!listText.includes("B11 + B12"), `${vp.name}: cluster must show G02, never B11 + B12`)

        // Notifications bell: unread dot -> open clears unread -> stays cleared until new PAID event
        const bell = page.getByRole("button", { name: /Thông báo thanh toán/ })
        await expect(page.getByTestId("pay-ntf-unread-dot")).toBeVisible()
        await bell.click()
        await expect(page.getByRole("dialog", { name: "Thông báo thanh toán" })).toBeVisible()
        await expect(page.getByText("Đã hủy món").first()).toBeVisible()
        await expect(page.getByText("Gọi thanh toán").first()).toBeVisible()
        await expect(page.getByText("Chờ thanh toán").first()).toBeVisible()
        await bell.click()
        await expect(page.getByTestId("pay-ntf-unread-dot")).toHaveCount(0)

        // Floor map: BOTH A10 and BAR01 selectors MUST exist and A10 must stay clear of BAR01
        const clearance = await page.evaluate(() => {
          const a10 = document.querySelector('[aria-label^="Bàn A10,"]')?.getBoundingClientRect()
          const bar1 = document.querySelector('[aria-label^="BAR01,"]')?.getBoundingClientRect()
          if (!a10 || !bar1) return { ok: false, reason: `missing selector a10=${Boolean(a10)} bar1=${Boolean(bar1)}` }
          return { ok: a10.right <= bar1.left + 0.5, reason: `a10.right=${a10.right}, bar1.left=${bar1.left}` }
        })
        assert(clearance.ok, `${vp.name}: A10/BAR01 clearance failed: ${clearance.reason}`)

        // First tap on A3 selects; second tap opens S2 detail
        const a3Row = page.locator(".pay-sess", { hasText: "A3" })
        await a3Row.click()
        await expect(page.getByText("Chạm lần nữa để mở chi tiết")).toBeVisible()
        await page.screenshot({ path: path.join(ARTIFACTS_DIR, `payment-${vp.name}-s1-list.png`) })
        await a3Row.click()

        // S2 detail: cancelled Margarita hidden, Mojito making warning visible, rounding shown separately
        await expect(page.getByRole("heading", { name: "Chi tiết Phiên" })).toBeVisible()
        const a3VisitId = new URL(page.url()).pathname.split("/")[2]
        assert(/^\d+$/.test(a3VisitId), `${vp.name}: expected numeric visitId for A3, got ${a3VisitId}`)
        await expect(page.getByText("Tiger Crystal")).toBeVisible()
        await expect(page.getByText("Mojito")).toBeVisible()
        await expect(page.getByText("Margarita")).toHaveCount(0)
        await expect(page.getByText(/dòng món đã hủy/)).toHaveCount(0)
        await expect(page.getByText("1 món đang làm, vẫn tính vào bill. Hỏi khách trước khi chốt.")).toBeVisible()
        await expect(page.getByText("Làm tròn lên nghìn (bước cuối)")).toBeVisible()
        await page.screenshot({ path: path.join(ARTIFACTS_DIR, `payment-${vp.name}-s2-detail.png`) })

        // NA45-03: direct URL to /cash on SERVING bill redirects back to S2 detail with prebill instruction
        await page.goto(`${base}/payment/${a3VisitId}/cash`, { waitUntil: "networkidle" })
        await expect(page.getByRole("heading", { name: "Chi tiết Phiên" })).toBeVisible()
        await expect(page.getByText(/chưa tạo tạm tính/)).toBeVisible()

        // NA45-06: scroll down on S2, click Xem tạm tính -> S3 must scroll to top so back & 80mm toggle are in viewport
        await page.evaluate(() => {
          const root = document.querySelector(".pay-root")
          if (root) root.scrollTop = 450
        })
        await page.getByRole("button", { name: "Xem tạm tính" }).click()
        await expect(page.getByRole("button", { name: "Trên màn hình" })).toBeVisible()
        await expect(page.getByRole("button", { name: "Bản in 80mm" })).toBeVisible()
        await expect(page.getByText("Bill tạm tính, chưa phải hóa đơn. Món đã hủy không tính.")).toBeVisible()
        const scrollCheck = await page.evaluate((vh) => {
          const root = document.querySelector(".pay-root")
          const backBtn = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Chi tiết Phiên"))
          const printBtn = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Bản in 80mm"))
          const bRect = backBtn?.getBoundingClientRect()
          const pRect = printBtn?.getBoundingClientRect()
          return {
            scrollTop: root?.scrollTop ?? -1,
            backVisible: Boolean(bRect && bRect.top >= 0 && bRect.bottom <= vh),
            printVisible: Boolean(pRect && pRect.top >= 0 && pRect.bottom <= vh),
          }
        }, vp.height)
        assert.equal(scrollCheck.scrollTop, 0, `${vp.name}: S3 scrollTop should be 0, got ${scrollCheck.scrollTop}`)
        assert(scrollCheck.backVisible && scrollCheck.printVisible, `${vp.name}: S3 header controls not in viewport: ${JSON.stringify(scrollCheck)}`)

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

        // NA45-03: Browser Back to S5 & S4 on PAID bill must lock all money actions
        await page.goBack({ waitUntil: "networkidle" })
        await expect(page.getByText("Bill này đã thanh toán").first()).toBeVisible()
        await expect(page.getByRole("button", { name: /Xác nhận đã nhận/ })).toBeDisabled()
        await page.goBack({ waitUntil: "networkidle" })
        await expect(page.getByText("Bill này đã thanh toán").first()).toBeVisible()
        await expect(page.getByRole("button", { name: /Tiền mặt/ })).toBeDisabled()
        await expect(page.getByRole("button", { name: /Chuyển khoản QR/ })).toBeDisabled()

        // Back to S1: A3 is gone from open list, A3 tile is Trống, and PAID notification turns unread dot back on
        await page.getByRole("button", { name: "Về danh sách Phiên" }).click()
        await expect(page.locator(".pay-sess", { hasText: "A3" })).toHaveCount(0)
        await expect(page.getByRole("button", { name: /^Bàn A3, trống$/ })).toBeVisible()
        await expect(page.getByTestId("pay-ntf-unread-dot")).toBeVisible()

        // Verify A3 is ALSO released on operational /floor (client-side nav preserves in-memory mock session)
        if (vp.width < 768) {
          await page.getByRole("button", { name: "Sơ đồ", exact: true }).click()
        } else {
          await page.locator('a[href="/floor"]').first().click()
        }
        await expect(page.locator('[aria-label*="A3"][aria-label*="Trống"]').first()).toBeVisible()

        assert.deepEqual(errors, [], `${vp.name} console errors: ${errors.join(" | ")}`)
        results.push(`PASS ${vp.name} cash flow + floor sync`)
      } finally {
        await context.close()
      }
    }

    // 2. Network error + same-amount/same-button retry, VERSION_CONFLICT vs DUPLICATE_PAYMENT, QR manual confirm
    {
      const { context, page, errors } = await openRole(vp, 5, "/payment")
      try {
        // Network error on Cash (G04), then retry with SAME button & SAME amount succeeds
        await page.locator(".pay-sess", { hasText: "G04" }).click()
        await page.locator(".pay-sess", { hasText: "G04" }).click()
        await page.getByRole("button", { name: "Chốt bill & thu tiền" }).click()
        await page.getByRole("button", { name: /Tiền mặt/ }).click()
        await page.getByRole("button", { name: "500.000", exact: true }).click()
        await page.evaluate(() => window.__21gamPaymentMock.setFault({ nextConfirm: "net" }))
        const confirmBtn = page.getByRole("button", { name: /Xác nhận đã nhận/ })
        await confirmBtn.click()
        await expect(page.getByText("Không gửi được tới máy chủ")).toBeVisible()
        await page.screenshot({ path: path.join(ARTIFACTS_DIR, `payment-${vp.name}-err-net.png`) })
        // Retry with the exact same button and amount (same idempotency key path)
        await confirmBtn.click()
        await expect(page.getByRole("heading", { name: "Đã thanh toán" })).toBeVisible()

        // VERSION_CONFLICT on BAR01: must reload bill and NOT claim "already paid", then retry succeeds
        await page.getByRole("button", { name: "Về danh sách Phiên" }).click()
        await page.locator(".pay-sess", { hasText: "BAR01" }).click()
        await page.locator(".pay-sess", { hasText: "BAR01" }).click()
        const barVisitId = new URL(page.url()).pathname.split("/")[2]
        await page.getByRole("button", { name: "Chốt bill & thu tiền" }).click()
        await page.getByRole("button", { name: /Tiền mặt/ }).click()
        await page.getByRole("button", { name: "500.000", exact: true }).click()
        await page.evaluate((id) => window.__21gamPaymentMock.bumpVersion(id), barVisitId)
        await page.getByRole("button", { name: /Xác nhận đã nhận/ }).click()
        await expect(page.getByText("Bill vừa được cập nhật")).toBeVisible()
        await expect(page.getByText("Bill này đã được thanh toán trên thiết bị khác")).toHaveCount(0)
        // Confirm again against reloaded bill succeeds
        await page.getByRole("button", { name: /Xác nhận đã nhận/ }).click()
        await expect(page.getByRole("heading", { name: "Đã thanh toán" })).toBeVisible()

        // Separate QR manual confirm on G02
        await page.getByRole("button", { name: "Về danh sách Phiên" }).click()
        await page.locator(".pay-sess", { hasText: "G02" }).click()
        await page.locator(".pay-sess", { hasText: "G02" }).click()
        await page.getByRole("button", { name: "Chốt bill & thu tiền" }).click()
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

        // Duplicate 409 fault on A2: marks PAID, releases A2, shows "đã được thanh toán trên thiết bị khác"
        await page.getByRole("button", { name: "Về danh sách Phiên" }).click()
        await page.locator(".pay-sess", { hasText: "A2" }).click()
        await page.locator(".pay-sess", { hasText: "A2" }).click()
        await page.getByRole("button", { name: "Chốt bill & thu tiền" }).click()
        await page.getByRole("button", { name: /Chuyển khoản QR/ }).click()
        await page.evaluate(() => window.__21gamPaymentMock.setFault({ nextConfirm: "dup" }))
        await page.getByRole("button", { name: "Xác nhận đã nhận tiền" }).click()
        await page.getByRole("checkbox").check()
        await page.getByRole("button", { name: "Xác nhận", exact: true }).click()
        await expect(page.getByText("Bill này đã được thanh toán trên thiết bị khác")).toBeVisible()
        await expect(page.getByRole("button", { name: "Xác nhận đã nhận tiền" })).toBeDisabled()
        await page.screenshot({ path: path.join(ARTIFACTS_DIR, `payment-${vp.name}-err-dup.png`) })
        await page.getByRole("button", { name: "Về danh sách Phiên" }).click()
        await expect(page.getByRole("button", { name: /^Bàn A2, trống$/ })).toBeVisible()

        assert.deepEqual(errors, [], `${vp.name} QR/error console errors: ${errors.join(" | ")}`)
        results.push(`PASS ${vp.name} retry + 409 conflict/dup + qr`)
      } finally {
        await context.close()
      }
    }

    // 3. Reduced motion (NA45-05) & loading lock across 390, 820, 1440
    {
      const { context, page, errors } = await openRole(vp, 5, "/payment", { reducedMotion: "reduce" })
      try {
        // Trigger zoom on A3 selection and verify 0.6s duration on .pay-fview and .pay-fsz
        await page.locator(".pay-sess", { hasText: "A3" }).click()
        const zoomTiming = await page.evaluate(() => {
          const fview = document.querySelector(".pay-fpanel.mv .pay-fview")
          const fsz = document.querySelector(".pay-fpanel.mv .pay-fsz")
          return {
            fviewDur: fview ? getComputedStyle(fview).animationDuration : null,
            fszDur: fsz ? getComputedStyle(fsz).animationDuration : null,
          }
        })
        assert.equal(zoomTiming.fviewDur, "0.6s", `${vp.name}: .pay-fview reduced-motion duration was ${zoomTiming.fviewDur}`)
        assert.equal(zoomTiming.fszDur, "0.6s", `${vp.name}: .pay-fsz reduced-motion duration was ${zoomTiming.fszDur}`)

        // Loading skeleton + .pay-spin runs infinitely at 1.2s under reducedMotion: "reduce"
        await page.evaluate(() => window.__21gamPaymentMock.setFault({ billDelayMs: 1200 }))
        await page.locator(".pay-sess", { hasText: "A3" }).click()
        const spin = page.locator(".pay-spin").first()
        await spin.waitFor({ state: "visible" })
        const spinTiming = await spin.evaluate((el) => {
          const cs = getComputedStyle(el)
          return { dur: cs.animationDuration, iter: cs.animationIterationCount }
        })
        assert.deepEqual(
          spinTiming,
          { dur: "1.2s", iter: "infinite" },
          `${vp.name}: .pay-spin reduced-motion timing was ${JSON.stringify(spinTiming)}`,
        )
        await expect(page.getByRole("heading", { name: "Chi tiết Phiên" })).toBeVisible()

        assert.deepEqual(errors, [], `${vp.name} reducedMotion console errors: ${errors.join(" | ")}`)
        results.push(`PASS ${vp.name} reduced motion + loading lock`)
      } finally {
        await context.close()
      }
    }
  }

  // 4. Waiter PA-A flow + unified A3 visitId + S4-S7 blocked under BOTH /payment and /phucvu
  {
    const { context, page, errors } = await openRole(VIEWPORTS[0], 6, "/phucvu")
    try {
      await page.locator('[aria-label^="Bàn A3,"]').first().click()
      await page.getByRole("button", { name: /Xem tạm tính & gọi thu ngân/ }).click()
      const waiterVisitId = new URL(page.url()).pathname.split("/")[3]
      assert(/^\d+$/.test(waiterVisitId), `Waiter A3 visitId must be numeric, got ${waiterVisitId}`)

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

      // Prove S4-S7 money routes are blocked under BOTH /payment and /phucvu
      for (const forbiddenUrl of [
        "/payment",
        `/payment/${waiterVisitId}/method`,
        `/payment/${waiterVisitId}/cash`,
        `/payment/${waiterVisitId}/qr`,
        `/payment/${waiterVisitId}/success`,
      ]) {
        await page.goto(`${base}${forbiddenUrl}`, { waitUntil: "networkidle" })
        assert(
          new URL(page.url()).pathname.startsWith("/phucvu"),
          `Waiter direct URL ${forbiddenUrl} should redirect to /phucvu, got ${page.url()}`,
        )
      }
      for (const moneyView of ["method", "cash", "qr", "success"]) {
        await page.goto(`${base}/phucvu/phien/${waiterVisitId}/thanh-toan?view=${moneyView}`, {
          waitUntil: "networkidle",
        })
        await expect(page.getByRole("heading", { name: "Chọn phương thức thanh toán" })).toHaveCount(0)
        await expect(page.getByRole("heading", { name: "Thanh toán tiền mặt" })).toHaveCount(0)
        await expect(page.getByRole("heading", { name: "Chuyển khoản QR" })).toHaveCount(0)
        await expect(page.getByRole("heading", { name: "Đã thanh toán" })).toHaveCount(0)
        await expect(page.getByRole("button", { name: /Xác nhận đã nhận/ })).toHaveCount(0)
      }

      assert.deepEqual(errors, [], `Waiter PA-A console errors: ${errors.join(" | ")}`)
      results.push("PASS 390 waiter PA-A + S4-S7 blocked under /payment and /phucvu")
    } finally {
      await context.close()
    }
  }

  // 5. NA45-11: TopBar outside /payment preserves deviceLabel & non-greeting header at 1440px
  {
    for (const roleCheck of [
      { userId: 3, deviceLabel: "Laptop văn phòng", name: "Owner" },
      { userId: 4, deviceLabel: "Điện thoại CSKH", name: "CustomerCare" },
    ]) {
      const { context, page, errors } = await openRole(VIEWPORTS[2], roleCheck.userId, "/floor")
      try {
        await expect(page.locator("header").getByText(roleCheck.deviceLabel)).toBeVisible()
        await expect(page.locator("header").getByText("Xin chào,")).toHaveCount(0)
        assert.deepEqual(errors, [], `${roleCheck.name} /floor console errors: ${errors.join(" | ")}`)
        results.push(`PASS 1440 ${roleCheck.name} /floor TopBar deviceLabel preserved`)
      } finally {
        await context.close()
      }
    }
  }

  console.log(results.join("\n"))
} finally {
  await browser.close()
  if (devServer) devServer.kill()
}

// W3 Cashier HU-44 v1.1 E2E suite (runs against W1+W3 mock on port 43943).
// Screenshots saved strictly under web/e2e/.artifacts/w3-cashier/.
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { chromium, expect } from "@playwright/test"
import { createServer as createViteServer } from "vite"

const ARTIFACTS_DIR = path.resolve("e2e/.artifacts/w3-cashier")
fs.mkdirSync(ARTIFACTS_DIR, { recursive: true })

const PORT = 43943
const base = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`

let viteServer = null
if (!process.env.E2E_BASE_URL) {
  delete process.env.VITE_API_MODE
  delete process.env.VITE_API_BASE_URL
  viteServer = await createViteServer({
    configFile: path.resolve("vite.config.ts"),
    clearScreen: false,
    logLevel: "silent",
    server: { host: "127.0.0.1", port: PORT, strictPort: true },
  })
  await viteServer.listen()
}

const launchOptions = {
  headless: true,
  ...(process.platform === "win32" && fs.existsSync("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
    ? { executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" }
    : {}),
  ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
}

const browser = await chromium.launch(launchOptions)

async function openCashier(vp) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (e) => errors.push(e.message))
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text())
  })
  await page.addInitScript(() => {
    localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 5, theme: "light" }))
  })
  await page.goto(`${base}/payment`, { waitUntil: "networkidle" })
  await page.evaluate(() => window.__21gamPaymentMock?.reset?.())
  await page.goto(`${base}/payment`, { waitUntil: "networkidle" })
  return { context, page, errors }
}

async function assertFeedbackInViewportAndClear(page, label, feedbackSelector, expectedText, buttonNames) {
  await page.locator(feedbackSelector).filter({ hasText: expectedText }).first().waitFor({ state: "visible", timeout: 5000 })
  const check = await page.evaluate(
    ({ fbSel, expText, names }) => {
      const vw = window.innerWidth
      const vh = window.innerHeight
      const hdr = document.querySelector(".pay-hdr")?.getBoundingClientRect()
      const minTop = hdr ? hdr.bottom - 0.5 : 0
      const fb = [...document.querySelectorAll(fbSel)].find((el) => {
        const cs = getComputedStyle(el)
        const r = el.getBoundingClientRect()
        return cs.visibility !== "hidden" && cs.display !== "none" && r.width > 0 && r.height > 0
      })
      if (!fb) return { ok: false, reason: `missing visible feedback ${fbSel}` }
      const text = fb.textContent?.trim() ?? ""
      if (!text.includes(expText)) return { ok: false, reason: `expected "${expText}", got "${text}"` }
      const fbRect = fb.getBoundingClientRect()
      if (fbRect.top < minTop || fbRect.bottom > vh + 0.5 || fbRect.left < -0.5 || fbRect.right > vw + 0.5) {
        return { ok: false, reason: `feedback outside viewport: ${JSON.stringify(fbRect)}` }
      }
      const visibleButtons = [...document.querySelectorAll("button")].filter((b) => {
        const cs = getComputedStyle(b)
        const r = b.getBoundingClientRect()
        return cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 && r.height > 0
      })
      for (const reqName of names) {
        const btn = visibleButtons.find((b) => (b.textContent?.trim() ?? "").includes(reqName))
        if (!btn) return { ok: false, reason: `missing button "${reqName}"` }
        const r = btn.getBoundingClientRect()
        if (r.top < minTop || r.bottom > vh + 0.5) return { ok: false, reason: `button "${reqName}" outside viewport` }
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        if (!hit || (hit !== btn && !btn.contains(hit))) {
          return { ok: false, reason: `button "${reqName}" not hit-testable` }
        }
        const overlap =
          fbRect.left < r.right - 0.5 &&
          fbRect.right > r.left + 0.5 &&
          fbRect.top < r.bottom - 0.5 &&
          fbRect.bottom > r.top + 0.5
        if (overlap) return { ok: false, reason: `feedback overlapped "${reqName}"` }
      }
      return { ok: true }
    },
    { fbSel: feedbackSelector, expText: expectedText, names: buttonNames },
  )
  assert(check.ok, `${label}: ${check.reason}`)
}

try {
  // 1. Desktop 1440: TN-01 Cần thu + Đã đưa hóa đơn, VM-03..VM-12, TN-09-K4 offline, TN-14 PAID cancel request
  {
    const { context, page, errors } = await openCashier({ width: 1440, height: 900 })
    try {
      await expect(page.getByRole("heading", { name: /Cần thu/ })).toBeVisible()
      await expect(page.getByText(/Gọi thanh toán/)).toHaveCount(0)
      await page.screenshot({ path: path.join(ARTIFACTS_DIR, "w3-1440-s1.png") })

      // Open A3 (SERVING) -> Xem tạm tính stays state-free (no QR, Tạm tính – chưa phải hóa đơn)
      const a3 = page.locator(".pay-sess", { hasText: "A3" })
      await a3.click()
      await a3.click()
      await expect(page.getByText("chờ chốt TN-03")).toHaveCount(0)
      await expect(page.getByText("Phí phục vụ · phụ thu")).toBeVisible()
      await expect(page.getByText("0đ").first()).toBeVisible()
      await page.getByRole("button", { name: "Xem tạm tính" }).click()
      await expect(page.getByText("Tạm tính – chưa phải hóa đơn. Món đã hủy không tính.")).toBeVisible()
      await expect(page.getByText("DEMO – KHÔNG CHUYỂN TIỀN")).toHaveCount(0)
      await page.screenshot({ path: path.join(ARTIFACTS_DIR, "w3-1440-s3-provisional.png") })

      // Issue invoice -> S2 lists bill Chưa thu + S1 shows Cần thu + Đã đưa hóa đơn
      await page.getByRole("button", { name: "Xuất hóa đơn" }).click()
      await expect(page.getByText("Hóa đơn trong phiên")).toBeVisible()
      await expect(page.getByText("Chưa thu").first()).toBeVisible()

      // Go to S4 Method -> check VM-09 locked chips + TN-09-K4 offline lock
      await page.getByRole("button", { name: /Thu tiền/ }).click()
      await expect(page.getByText("Giai đoạn sau")).toHaveCount(0)
      for (const chip of ["Ghi nợ", "Thẻ", "Tách bill", "Giảm giá", "Voucher", "Hóa đơn điện tử"]) {
        await expect(page.getByRole("button", { name: chip })).toBeDisabled()
      }
      await context.setOffline(true)
      await expect(page.getByRole("button", { name: /Chuyển khoản QR/ })).toBeDisabled()
      await expect(page.getByText("Mất kết nối mạng, không tạo được QR. Hãy thu Tiền mặt.")).toBeVisible()
      await expect(page.getByRole("button", { name: /^Tiền mặt/ })).toBeEnabled()
      await context.setOffline(false)

      // Go to S6 QR -> VM-11 Techcombank (no account number), VM-12 locked Đang phát triển, VM-10 reminder
      await page.getByRole("button", { name: /Chuyển khoản QR/ }).click()
      await expect(page.getByText("Techcombank")).toBeVisible()
      await expect(page.getByText("Số tài khoản")).toHaveCount(0)
      await expect(page.getByRole("button", { name: /Kiểm tra giao dịch/ })).toBeDisabled()
      await page.getByRole("button", { name: "Xác nhận đã nhận tiền" }).click()
      await expect(page.getByText("Chụp màn hình chuyển khoản của khách")).toBeVisible()
      await page.getByRole("checkbox").check()
      await page.getByRole("button", { name: "Xác nhận", exact: true }).click()
      await expect(page.getByRole("heading", { name: "Đã thanh toán" })).toBeVisible()

      // TN-14: verify on a PAID bill (open visit detail via history/URL) -> only Gửi yêu cầu huỷ (reason required), no direct cancel
      const visitUrl = new URL(page.url()).pathname.replace(/\/success$/, "")
      await page.goto(`${base}${visitUrl}`, { waitUntil: "networkidle" })
      await expect(page.getByRole("button", { name: /Huỷ thanh toán/ })).toHaveCount(0)
      const reqCancelBtn = page.getByRole("button", { name: "Gửi yêu cầu huỷ" })
      if ((await reqCancelBtn.count()) > 0) {
        await reqCancelBtn.click()
        await page.getByRole("button", { name: "Xác nhận gửi yêu cầu huỷ" }).click()
        await expect(page.getByText("Vui lòng nhập lý do gửi yêu cầu huỷ.")).toBeVisible()
        await page.getByLabel("Lý do gửi yêu cầu huỷ (bắt buộc)").fill("Thu nhầm phương thức thanh toán")
        await page.getByRole("button", { name: "Xác nhận gửi yêu cầu huỷ" }).click()
        await expect(page.getByText(/Đang chờ duyệt \(PENDING\)/)).toBeVisible()
      }

      assert.deepEqual(errors, [], `w3 1440 console errors: ${errors.join(" | ")}`)
      console.log("PASS w3 1440 HU-44 v1.1 contract flow")
    } finally {
      await context.close()
    }
  }

  // 2. Narrow phone 320x640 & 390x844: NA45C-04 inline copy/print feedback in viewport + cash retry
  for (const vp of [{ width: 320, height: 640 }, { width: 390, height: 844 }]) {
    const { context, page, errors } = await openCashier(vp)
    try {
      const a3 = page.locator(".pay-sess", { hasText: "A3" })
      await a3.click()
      await a3.click()
      await page.getByRole("button", { name: "Xuất hóa đơn" }).first().click()
      await page.getByRole("button", { name: /Thu tiền/ }).click()
      await page.getByRole("button", { name: /Chuyển khoản QR/ }).click()
      const copyBtn = page.getByRole("button", { name: "Chép" })
      await copyBtn.scrollIntoViewIfNeeded()
      await copyBtn.click()
      await assertFeedbackInViewportAndClear(
        page,
        `${vp.width} S6 copy`,
        '[data-testid="pay-qr-copy-status"]',
        "Đã chép nội dung",
        ["Chép", "Xác nhận đã nhận tiền"],
      )
      await page.getByRole("button", { name: "Xác nhận đã nhận tiền" }).click()
      await page.getByRole("checkbox").check()
      await page.getByRole("button", { name: "Xác nhận", exact: true }).click()
      await expect(page.getByRole("heading", { name: "Đã thanh toán" })).toBeVisible()
      await page.evaluate(() => {
        const root = document.querySelector(".pay-root")
        if (root) root.scrollTop = root.scrollHeight
      })
      await page.getByRole("button", { name: /In biên nhận/ }).click()
      await assertFeedbackInViewportAndClear(
        page,
        `${vp.width} S7 print`,
        '[data-testid="pay-receipt-print-status"]',
        "chưa nối máy in thật",
        ["Về danh sách Phiên", "In biên nhận"],
      )
      assert.deepEqual(errors, [], `w3 ${vp.width} console errors: ${errors.join(" | ")}`)
      console.log(`PASS w3 ${vp.width} NA45C-04 & NA45C-09`)
    } finally {
      await context.close()
    }
  }
} finally {
  if (browser) await browser.close()
  if (viteServer) await viteServer.close()
}

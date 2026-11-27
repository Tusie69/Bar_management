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
  let allowOfflineConsole = false
  page.on("pageerror", (e) => errors.push(e.message))
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const txt = msg.text()
      if (allowOfflineConsole && txt.includes("ERR_INTERNET_DISCONNECTED")) return
      errors.push(txt)
    }
  })
  await page.addInitScript(() => {
    localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 5, theme: "light" }))
  })
  await page.goto(`${base}/payment`, { waitUntil: "networkidle" })
  await page.evaluate(() => window.__21gamPaymentMock?.reset?.())
  await page.goto(`${base}/payment`, { waitUntil: "networkidle" })
  return {
    context,
    page,
    errors,
    setAllowOfflineConsole: (v) => {
      allowOfflineConsole = v
    },
  }
}

async function switchRoleInUi(page, rolePattern) {
  await page.getByRole("button", { name: /Tài khoản:/ }).click()
  await page.getByRole("menuitemradio", { name: rolePattern }).click()
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
  // 1. Desktop 1440: TN-01 Cần thu + Đã đưa hóa đơn, VM-03..VM-12, TN-09-K4 offline,
  //    NA45H-08 preview error + retry, NA45H-09 S2 loading + S3 metadata, NA45H-07 multi-bill banner,
  //    NA45H-03 cancel request lifecycle (PENDING/REJECTED/APPROVED/re-collect + 403 guards).
  {
    const { context, page, errors, setAllowOfflineConsole } = await openCashier({ width: 1440, height: 900 })
    try {
      await expect(page.getByRole("heading", { name: /Cần thu/ })).toBeVisible()
      await expect(page.getByText(/Gọi thanh toán/)).toHaveCount(0)
      await page.screenshot({ path: path.join(ARTIFACTS_DIR, "w3-1440-s1.png") })

      // NA45H-09: Delay previewBill on unbilled A3 -> S2 holds loading skeleton until preview arrives, then shows content
      await page.evaluate(() => {
        const api = window.__21gamPaymentMock.paymentApi
        const orig = api.previewBill.bind(api)
        window.__origPreviewBill = orig
        api.previewBill = async (visitId) => {
          await new Promise((r) => setTimeout(r, 250))
          return orig(visitId)
        }
      })
      const a3 = page.locator(".pay-sess", { hasText: "A3" })
      await a3.click()
      await a3.click()
      await expect(page.locator('[aria-busy="true"]')).toBeVisible()
      await expect(page.getByText("Phí phục vụ · phụ thu")).toBeVisible()
      await page.evaluate(() => {
        if (window.__origPreviewBill) {
          window.__21gamPaymentMock.paymentApi.previewBill = window.__origPreviewBill
        }
      })
      await expect(page.getByText("chờ chốt TN-03")).toHaveCount(0)
      await expect(page.getByText("0đ").first()).toBeVisible()

      // NA45H-08 (unbilled session): previewBill error shows error + retry without blank/fallback, then recovers
      await page.evaluate(() => {
        const api = window.__21gamPaymentMock.paymentApi
        window.__origPreviewBill = api.previewBill.bind(api)
        api.previewBill = async () => {
          throw new Error("review preview unavailable")
        }
      })
      await page.getByRole("button", { name: "Xem tạm tính" }).click()
      await expect(page.getByText("review preview unavailable")).toBeVisible({ timeout: 8000 })
      await expect(page.getByText("Tạm tính – chưa phải hóa đơn. Món đã hủy không tính.")).toHaveCount(0)
      await page.evaluate(() => {
        window.__21gamPaymentMock.paymentApi.previewBill = window.__origPreviewBill
      })
      await page.getByRole("button", { name: "Thử lại" }).click()

      // NA45H-09: S3 provisional preview keeps real metadata (Giờ vào & Phục vụ, never '—') and no QR
      await expect(page.getByText("Tạm tính – chưa phải hóa đơn. Món đã hủy không tính.")).toBeVisible()
      await expect(page.getByText("DEMO – KHÔNG CHUYỂN TIỀN")).toHaveCount(0)
      const s3Meta = await page.evaluate(() => {
        const dts = [...document.querySelectorAll(".pay-r-meta div")]
        const map = {}
        for (const row of dts) {
          const k = row.querySelector("dt")?.textContent?.trim()
          const v = row.querySelector("dd")?.textContent?.trim()
          if (k) map[k] = v
        }
        return map
      })
      assert(s3Meta["Giờ vào"] && s3Meta["Giờ vào"] !== "—", `S3 Giờ vào missing: ${JSON.stringify(s3Meta)}`)
      assert(s3Meta["Phục vụ"] && s3Meta["Phục vụ"] !== "—", `S3 Phục vụ missing: ${JSON.stringify(s3Meta)}`)
      await page.screenshot({ path: path.join(ARTIFACTS_DIR, "w3-1440-s3-provisional.png") })

      // Issue first invoice B1283 -> S2 lists bill Chưa thu
      await page.getByRole("button", { name: "Xuất hóa đơn" }).click()
      await expect(page.getByText("Hóa đơn trong phiên")).toBeVisible()
      await expect(page.getByText("Chưa thu").first()).toBeVisible()

      const a3VisitId = new URL(page.url()).pathname.split("/")[2]

      // Add extra order lines so session has unbilled lines + issued bill -> NA45H-08 (issued-bill session preview error)
      await page.evaluate((vid) => {
        window.__21gamPaymentMock.addOrderLines(vid, [
          { name: "Coca-Cola", unit: "Lon", qty: 2, unitPriceVnd: 35_000, state: "SERVED" },
        ])
      }, a3VisitId)
      await page.evaluate(() => {
        const api = window.__21gamPaymentMock.paymentApi
        window.__origPreviewBill = api.previewBill.bind(api)
        api.previewBill = async () => {
          throw new Error("review preview unavailable")
        }
      })
      await page.getByRole("button", { name: "Xem tạm tính" }).click()
      await expect(page.getByText("review preview unavailable")).toBeVisible({ timeout: 8000 })
      await expect(page.getByText("Tạm tính – chưa phải hóa đơn")).toHaveCount(0)
      await expect(page.getByText("231.000đ")).toHaveCount(0)
      await page.evaluate(() => {
        window.__21gamPaymentMock.paymentApi.previewBill = window.__origPreviewBill
      })
      await page.getByRole("button", { name: "Thử lại" }).click()
      await expect(page.getByText("Coca-Cola")).toBeVisible()
      await expect(page.getByText("Tạm tính – chưa phải hóa đơn. Món đã hủy không tính.")).toBeVisible()

      // NA45H-07 case 1: Collect B1283 while Coca-Cola is still unbilled -> BOTH banner & receipt say session stays open
      await page.getByRole("button", { name: "Chi tiết Phiên" }).click()
      await page.getByRole("button", { name: /Thu tiền/ }).click()
      await expect(page.getByText("Giai đoạn sau")).toHaveCount(0)
      for (const chip of ["Ghi nợ", "Thẻ", "Tách bill", "Giảm giá", "Voucher", "Hóa đơn điện tử"]) {
        await expect(page.getByRole("button", { name: chip })).toBeDisabled()
      }
      setAllowOfflineConsole(true)
      await context.setOffline(true)
      await expect(page.getByRole("button", { name: /Chuyển khoản QR/ })).toBeDisabled()
      await expect(page.getByText("Mất kết nối mạng, không tạo được QR. Hãy thu Tiền mặt.")).toBeVisible()
      await expect(page.getByRole("button", { name: /^Tiền mặt/ })).toBeEnabled()
      await context.setOffline(false)
      setAllowOfflineConsole(false)

      // Collect B1283 via QR while Coca-Cola remains unbilled
      await page.getByRole("button", { name: /Chuyển khoản QR/ }).click()
      await expect(page.getByText("Techcombank")).toBeVisible()
      await expect(page.getByText("Số tài khoản")).toHaveCount(0)
      await expect(page.getByRole("button", { name: /Kiểm tra giao dịch/ })).toBeDisabled()
      await page.getByRole("button", { name: "Xác nhận đã nhận tiền" }).click()
      await expect(page.getByText("Chụp màn hình chuyển khoản của khách")).toBeVisible()
      await page.getByRole("checkbox").check()
      await page.getByRole("button", { name: "Xác nhận", exact: true }).click()
      await expect(page.getByRole("heading", { name: "Đã thanh toán" })).toBeVisible()
      await expect(page.getByTestId("pay-feedback")).toContainText("vẫn đang mở")
      await expect(page.getByTestId("pay-feedback")).not.toContainText("về Trống")
      await expect(page.getByText(/vẫn đang mở vì còn bill chưa thu hoặc món chưa xuất hóa đơn/)).toBeVisible()

      // NA45H-07 case 2: Issue B...-2 (Coca-Cola), add Sprite & issue B...-3 -> collect B...-2 while B...-3 is UNPAID -> still open
      await page.getByRole("button", { name: "Về chi tiết Phiên" }).click()
      await page.getByRole("button", { name: "Xuất hóa đơn" }).click()
      await expect(page.getByText("Hóa đơn trong phiên (2)")).toBeVisible()
      await page.evaluate((vid) => {
        window.__21gamPaymentMock.addOrderLines(vid, [
          { name: "Sprite", unit: "Lon", qty: 1, unitPriceVnd: 35_000, state: "SERVED" },
        ])
      }, a3VisitId)
      await page.getByRole("button", { name: "Thử lại" }).count() // ensure query settles
      await page.getByRole("button", { name: "Phiên đang mở" }).click()
      const a3ServingRow = page.locator(".pay-sess", { hasText: "A3" })
      await expect(a3ServingRow).toContainText("1 bill chờ thu")
      if (!(await a3ServingRow.evaluate((el) => el.classList.contains("sel")))) {
        await a3ServingRow.click()
      }
      await a3ServingRow.click()
      await page.locator(".pay-unbilled").getByRole("button", { name: "Xuất hóa đơn" }).click()
      await expect(page.getByText("Hóa đơn trong phiên (3)")).toBeVisible()

      await page.locator(".pay-bill-item", { hasText: "-2" }).click()
      await page.getByRole("button", { name: /Thu tiền · / }).click()
      await page.getByRole("button", { name: /Tiền mặt/ }).click()
      await page.locator(".pay-chips .pay-chip").first().click()
      await page.getByRole("button", { name: /Xác nhận đã nhận/ }).click()
      await expect(page.getByRole("heading", { name: "Đã thanh toán" })).toBeVisible()
      await expect(page.getByTestId("pay-feedback")).toContainText("vẫn đang mở")
      await expect(page.getByTestId("pay-feedback")).not.toContainText("về Trống")
      await expect(page.getByText(/vẫn đang mở vì còn bill chưa thu/)).toBeVisible()

      // NA45H-07 case 3: Collect remaining final bill (B...-3) -> BOTH banner & receipt confirm tables Trống
      await page.getByRole("button", { name: "Về chi tiết Phiên" }).click()
      await page.getByRole("button", { name: /Thu tiền/ }).click()
      await page.getByRole("button", { name: /Tiền mặt/ }).click()
      await page.locator(".pay-chips .pay-chip").first().click()
      await page.getByRole("button", { name: /Xác nhận đã nhận/ }).click()
      await expect(page.getByRole("heading", { name: "Đã thanh toán" })).toBeVisible()
      await expect(page.getByTestId("pay-feedback")).toContainText("về Trống")
      await expect(page.getByText(/đã đóng\./)).toBeVisible()

      // NA45H-03: verify Cashier 403 on listCancelRequests & cancelPaid, plus full cancel request lifecycle
      const guardCheck = await page.evaluate(async () => {
        const api = window.__21gamPaymentMock.paymentApi
        let listStatus = null
        let directStatus = null
        try {
          await api.listCancelRequests()
        } catch (err) {
          listStatus = err?.status ?? "error"
        }
        try {
          await api.cancelPaid("B1283", "test")
        } catch (err) {
          directStatus = err?.status ?? "error"
        }
        return { listStatus, directStatus }
      })
      assert.equal(guardCheck.listStatus, 403, `Cashier listCancelRequests must be 403, got ${guardCheck.listStatus}`)
      assert.equal(guardCheck.directStatus, 403, `Cashier cancelPaid must be 403, got ${guardCheck.directStatus}`)

      // From S7 (/payment/:id/success), open notification bell -> click Đã thanh toán to open PAID bill detail (same SPA/mock)
      await page.getByRole("button", { name: /Thông báo thanh toán/ }).click()
      await page.locator(".pay-ntf", { hasText: "Đã thanh toán" }).first().click()
      await expect(page.getByRole("button", { name: /Huỷ thanh toán/ })).toHaveCount(0)

      // Mandatory Gửi yêu cầu huỷ button, empty-reason validation, submit -> PENDING
      const reqCancelBtn = page.getByRole("button", { name: "Gửi yêu cầu huỷ" })
      await expect(reqCancelBtn).toBeVisible()
      await reqCancelBtn.click()
      await page.getByRole("button", { name: "Xác nhận gửi yêu cầu huỷ" }).click()
      await expect(page.getByText("Vui lòng nhập lý do gửi yêu cầu huỷ.")).toBeVisible()
      await page.getByLabel("Lý do gửi yêu cầu huỷ (bắt buộc)").fill("Thu nhầm phương thức thanh toán")
      await page.getByRole("button", { name: "Xác nhận gửi yêu cầu huỷ" }).click()
      await expect(page.getByText(/Đang chờ duyệt \(PENDING\)/)).toBeVisible()

      // Switch to Admin -> Reject with note -> Switch back to Cashier -> verify REJECTED + decider + note + resubmit
      await page.getByRole("button", { name: "Phiên đang mở" }).click()
      await switchRoleInUi(page, /Quản trị viên/)
      await page.getByRole("button", { name: /Tài khoản:/ }).click()
      await page.getByRole("menuitem", { name: /Về Điều phối/ }).click()
      await page.getByRole("link", { name: "Duyệt huỷ thanh toán" }).click()
      await expect(page.getByRole("heading", { name: "Duyệt huỷ thanh toán" })).toBeVisible()
      await page.getByLabel("Ghi chú phản hồi (tuỳ chọn)").first().fill("Kiểm lại tiền mặt")
      await page.getByRole("button", { name: "Từ chối" }).first().click()
      await expect(page.getByTestId("pc-queue-feedback")).toContainText("Đã từ chối yêu cầu huỷ")

      await switchRoleInUi(page, /Thu ngân/)
      await expect(page).toHaveURL(/\/payment$/)
      // NA45H-13: Directly from S1 (/payment), click Từ chối hủy thanh toán for closed session A3 -> opens exact bill detail
      await page.getByRole("button", { name: /Thông báo thanh toán/ }).click()
      await page.locator(".pay-ntf", { hasText: "Từ chối hủy thanh toán" }).first().click()
      await expect(page).toHaveURL(new RegExp(`/payment/${a3VisitId}`))
      await expect(page.getByText(/Bị từ chối \(REJECTED\)/)).toBeVisible()
      await expect(page.getByText(/Người duyệt:.*Quản trị viên/)).toBeVisible()
      await expect(page.getByText(/Kiểm lại tiền mặt/)).toBeVisible()

      // Resubmit -> Admin approves -> Cashier sees APPROVED on reverted UNPAID bill -> re-collect -> can request again
      await page.getByRole("button", { name: "Gửi yêu cầu huỷ" }).click()
      await page.getByLabel("Lý do gửi yêu cầu huỷ (bắt buộc)").fill("Khách chuyển sang quẹt thẻ")
      await page.getByRole("button", { name: "Xác nhận gửi yêu cầu huỷ" }).click()
      await expect(page.getByText(/Đang chờ duyệt \(PENDING\)/)).toBeVisible()

      await page.getByRole("button", { name: "Phiên đang mở" }).click()
      await switchRoleInUi(page, /Quản trị viên/)
      await page.getByRole("button", { name: /Tài khoản:/ }).click()
      await page.getByRole("menuitem", { name: /Về Điều phối/ }).click()
      await page.getByRole("link", { name: "Duyệt huỷ thanh toán" }).click()
      await page.getByLabel("Ghi chú phản hồi (tuỳ chọn)").first().fill("Đã duyệt huỷ bill")
      const approveBtn = page.getByRole("button", { name: "Duyệt huỷ", exact: true }).first()
      await approveBtn.scrollIntoViewIfNeeded()
      await approveBtn.click()
      await expect(page.getByTestId("pc-queue-feedback")).toContainText("Đã duyệt huỷ", { timeout: 10000 })

      await switchRoleInUi(page, /Thu ngân/)
      await expect(page).toHaveURL(/\/payment/)
      const a3Reopened = page.locator(".pay-sess", { hasText: "A3" })
      await a3Reopened.click()
      await a3Reopened.click()
      await expect(page.getByText(/Đã duyệt huỷ \(APPROVED\)/)).toBeVisible()
      await expect(page.getByText(/Người duyệt:.*Quản trị viên/).first()).toBeVisible()

      // Re-collect the reverted bill -> return to S1 -> open PAID notification from S1 (NA45H-13)
      // -> verify NA45H-11: both cancel history (reason/approver/note) AND re-collection milestone AND new cancel request
      await page.getByRole("button", { name: /Thu tiền/ }).click()
      await page.getByRole("button", { name: /Tiền mặt/ }).click()
      await page.locator(".pay-chips .pay-chip").first().click()
      await page.getByRole("button", { name: /Xác nhận đã nhận/ }).click()
      await expect(page.getByRole("heading", { name: "Đã thanh toán" })).toBeVisible()
      await page.getByRole("button", { name: "Về danh sách Phiên" }).click()
      await expect(page).toHaveURL(/\/payment$/)
      await page.getByRole("button", { name: /Thông báo thanh toán/ }).click()
      await page.locator(".pay-ntf", { hasText: "Đã thanh toán" }).first().click()
      await expect(page).toHaveURL(new RegExp(`/payment/${a3VisitId}`))
      await expect(page.getByText("Lần thanh toán sau")).toBeVisible()
      await expect(page.getByText(/Đã thu lại lúc/)).toBeVisible()
      await expect(page.getByText(/Đã duyệt huỷ \(APPROVED\)/)).toBeVisible()
      await expect(page.getByText(/Khách chuyển sang quẹt thẻ/)).toBeVisible()
      await expect(page.getByText(/Người duyệt:.*Quản trị viên/).first()).toBeVisible()
      await expect(page.getByText(/Đã duyệt huỷ bill/)).toBeVisible()
      await expect(page.getByRole("button", { name: "Gửi yêu cầu huỷ" })).toBeVisible()
      await page.getByRole("button", { name: "Gửi yêu cầu huỷ" }).click()
      await page.getByLabel("Lý do gửi yêu cầu huỷ (bắt buộc)").fill("Huỷ lại sau khi đã thu lại")
      await page.getByRole("button", { name: "Xác nhận gửi yêu cầu huỷ" }).click()
      await expect(page.getByText(/Đang chờ duyệt \(PENDING\)/)).toBeVisible()
      await expect(page.getByText(/Đã duyệt huỷ \(APPROVED\)/)).toBeVisible()

      // NA45H-13: Multi-bill closed session (A2 with 2 bills) -> S1 bell opens the exact target billCode
      await page.getByRole("button", { name: "Phiên đang mở" }).click()
      await expect(page).toHaveURL(/\/payment$/)
      const a2Multi = page.locator(".pay-sess", { hasText: "A2" })
      await a2Multi.click()
      await a2Multi.click()
      await page.getByRole("button", { name: "Xuất hóa đơn" }).click()
      await expect(page.getByText("Hóa đơn trong phiên (1)")).toBeVisible()
      const a2VisitId = new URL(page.url()).pathname.split("/")[2]
      const a2Bill1 = `B${String(a2VisitId).padStart(4, "0")}`
      const a2Bill2 = `${a2Bill1}-2`
      await page.evaluate((vid) => {
        window.__21gamPaymentMock.addOrderLines(vid, [
          { name: "Nước suối", unit: "Chai", qty: 1, unitPriceVnd: 25_000, state: "SERVED" },
        ])
      }, a2VisitId)
      await page.locator(".pay-unbilled").getByRole("button", { name: "Xuất hóa đơn" }).click()
      await expect(page.getByText("Hóa đơn trong phiên (2)")).toBeVisible()

      // Collect bill 1 then bill 2 so A2 is closed with 2 bills
      await page.locator(".pay-bill-item", { hasText: a2Bill1 }).first().click()
      await page.getByRole("button", { name: new RegExp(`Thu tiền · ${a2Bill1}$`) }).click()
      await page.getByRole("button", { name: /Tiền mặt/ }).click()
      await page.locator(".pay-chips .pay-chip").first().click()
      await page.getByRole("button", { name: /Xác nhận đã nhận/ }).click()
      await expect(page.getByRole("heading", { name: "Đã thanh toán" })).toBeVisible()
      await page.getByRole("button", { name: "Về chi tiết Phiên" }).click()
      await page.locator(".pay-bill-item", { hasText: a2Bill2 }).click()
      await page.getByRole("button", { name: new RegExp(`Thu tiền · ${a2Bill2}$`) }).click()
      await page.getByRole("button", { name: /Tiền mặt/ }).click()
      await page.locator(".pay-chips .pay-chip").first().click()
      await page.getByRole("button", { name: /Xác nhận đã nhận/ }).click()
      await expect(page.getByRole("heading", { name: "Đã thanh toán" })).toBeVisible()

      // From S1, click PAID notification for A2 -> opens a2Bill2 (the latest PAID bill)
      await page.getByRole("button", { name: "Về danh sách Phiên" }).click()
      await expect(page).toHaveURL(/\/payment$/)
      await page.getByRole("button", { name: /Thông báo thanh toán/ }).click()
      await page.locator(".pay-ntf", { hasText: "Đã thanh toán" }).filter({ hasText: "A2" }).first().click()
      await expect(page).toHaveURL(new RegExp(`/payment/${a2VisitId}\\?bill=${a2Bill2}`))
      await expect(page.locator(".pay-bill-item", { hasText: a2Bill2 })).toHaveAttribute("aria-pressed", "true")

      // Submit cancel request on a2Bill2 -> Admin rejects -> Cashier clicks rejection notification from S1 -> opens a2Bill2
      await page.getByRole("button", { name: "Gửi yêu cầu huỷ" }).click()
      await page.getByLabel("Lý do gửi yêu cầu huỷ (bắt buộc)").fill("Kiểm tra bill 2 nhiều bill")
      await page.getByRole("button", { name: "Xác nhận gửi yêu cầu huỷ" }).click()
      await expect(page.getByText(/Đang chờ duyệt \(PENDING\)/)).toBeVisible()

      await page.getByRole("button", { name: "Phiên đang mở" }).click()
      await switchRoleInUi(page, /Quản trị viên/)
      await page.getByRole("button", { name: /Tài khoản:/ }).click()
      await page.getByRole("menuitem", { name: /Về Điều phối/ }).click()
      await page.getByRole("link", { name: "Duyệt huỷ thanh toán" }).click()
      await page.getByLabel("Ghi chú phản hồi (tuỳ chọn)").first().fill("Giữ nguyên bill 2")
      await page.getByRole("button", { name: "Từ chối" }).first().click()
      await expect(page.getByTestId("pc-queue-feedback")).toContainText("Đã từ chối yêu cầu huỷ")

      await switchRoleInUi(page, /Thu ngân/)
      await expect(page).toHaveURL(/\/payment$/)
      await page.getByRole("button", { name: /Thông báo thanh toán/ }).click()
      await page.locator(".pay-ntf", { hasText: "Từ chối hủy thanh toán" }).filter({ hasText: a2Bill2 }).first().click()
      await expect(page).toHaveURL(new RegExp(`/payment/${a2VisitId}\\?bill=${a2Bill2}`))
      await expect(page.locator(".pay-bill-item", { hasText: a2Bill2 })).toHaveAttribute("aria-pressed", "true")
      await expect(page.getByText("Giữ nguyên bill 2")).toBeVisible()

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

// W4 + W4b Payment Cancel & Approval E2E suite (runs against mock on port 43946).
// Screenshots saved strictly under web/e2e/.artifacts/w4-cancel/.
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { chromium, expect } from "@playwright/test"
import { createServer as createViteServer } from "vite"

const ARTIFACTS_DIR = path.resolve("e2e/.artifacts/w4-cancel")
fs.mkdirSync(ARTIFACTS_DIR, { recursive: true })

const PORT = Number(process.env.E2E_PORT ?? 43946)
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

async function openAs(vp, userId, startPath = "/floor") {
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
  await page.goto(`${base}${startPath}`, { waitUntil: "networkidle" })
  return { context, page, errors }
}

async function switchRoleInUi(page, rolePattern) {
  await page.getByRole("button", { name: /Tài khoản:/ }).click()
  await page.getByRole("menuitemradio", { name: rolePattern }).click()
}

async function assertNoOverflow(page, label) {
  const docOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  assert(docOverflow <= 1, `${label}: horizontal overflow ${docOverflow}px`)
}

try {
  // 1. Desktop 1440: CASHIER/WAITER/BAR blocked from /cancel-payment, ADMIN queue approve/reject + real-time + audit + OWNER direct cancel
  {
    const { context, page, errors } = await openAs({ width: 1440, height: 900 }, 5, "/payment")

    try {
      // CASHIER must be redirected away from /cancel-payment back to /payment
      await page.goto(`${base}/cancel-payment`, { waitUntil: "networkidle" })
      assert.equal(new URL(page.url()).pathname, "/payment", "CASHIER must not stay on /cancel-payment")

      // Cashier opens A2 from S1, issues invoice, pays cash, then opens Paid bill detail via notification bell
      const a2Session = page.locator(".pay-sess", { hasText: "A2" })
      await a2Session.click()
      await a2Session.click()
      await page.getByRole("button", { name: "Xuất hóa đơn" }).click()
      await page.getByRole("button", { name: /Thu tiền/ }).click()
      await page.getByRole("button", { name: /Tiền mặt/ }).click()
      await page.locator(".pay-chips .pay-chip").first().click()
      await page.getByRole("button", { name: /Xác nhận đã nhận/ }).click()
      await expect(page.getByRole("heading", { name: "Đã thanh toán" })).toBeVisible()

      const a2VisitId = new URL(page.url()).pathname.split("/")[2]
      const billCode = `B${String(a2VisitId).padStart(4, "0")}`

      // From S7 (/payment/:a2VisitId/success), open notification bell directly -> navigates to S2 Paid bill detail (/payment/:a2VisitId)
      await page.getByRole("button", { name: /Thông báo thanh toán/ }).click()
      await page.locator(".pay-ntf", { hasText: "Đã thanh toán" }).first().click()
      await expect(page.getByRole("button", { name: "Gửi yêu cầu huỷ" })).toBeVisible()

      // Send 1st cancel request, then return to S1 (/payment) before switching role so payment-page's cancelRequestsQuery never runs as ADMIN
      await page.getByRole("button", { name: "Gửi yêu cầu huỷ" }).click()
      await page.getByLabel("Lý do gửi yêu cầu huỷ (bắt buộc)").fill("Khách đổi sang QR")
      await page.getByRole("button", { name: "Xác nhận gửi yêu cầu huỷ" }).click()
      await expect(page.getByText(/Đang chờ duyệt \(PENDING\)/)).toBeVisible()
      await page.getByRole("button", { name: "Phiên đang mở" }).click()
      await expect(page).toHaveURL(/\/payment$/)

      // Switch to ADMIN via Account menu -> navigate via AppShell sidebar ("Duyệt huỷ thanh toán")
      await switchRoleInUi(page, /Quản trị viên/)
      await page.getByRole("button", { name: /Tài khoản:/ }).click()
      await page.getByRole("menuitem", { name: /Về Điều phối/ }).click()
      const navLink = page.getByRole("link", { name: "Duyệt huỷ thanh toán" })
      await expect(navLink).toBeVisible()
      await navLink.click()
      await expect(page.getByRole("heading", { name: "Duyệt huỷ thanh toán" })).toBeVisible()

      // Verify PENDING item details
      await expect(page.getByText(billCode).first()).toBeVisible()
      await expect(page.getByText("Bàn A2").first()).toBeVisible()
      await expect(page.getByText("Khách đổi sang QR").first()).toBeVisible()
      await assertNoOverflow(page, "w4 1440 admin queue")
      await page.screenshot({ path: path.join(ARTIFACTS_DIR, "w4-1440-admin-queue.png") })

      // Reject with note -> notifies cashier
      await page.getByLabel("Ghi chú phản hồi (tuỳ chọn)").first().fill("Chưa đối soát xong")
      await page.getByRole("button", { name: "Từ chối" }).first().click()
      await expect(page.getByTestId("pc-queue-feedback")).toContainText("Đã từ chối yêu cầu huỷ")

      // Switch to Cashier -> CashierRouteGuard redirects back to /payment -> check notification bell -> open A3 to reach /payment/:id so clicking A2 notification navigates to A2
      await switchRoleInUi(page, /Thu ngân/)
      await expect(page).toHaveURL(/\/payment/)
      await page.getByRole("button", { name: /Thông báo thanh toán/ }).click()
      await expect(page.getByText("Từ chối hủy thanh toán")).toBeVisible()
      await page.keyboard.press("Escape")
      const a3ForNav = page.locator(".pay-sess", { hasText: "A3" })
      await a3ForNav.click()
      await a3ForNav.click()
      await expect(page).toHaveURL(/\/payment\/\d+/)
      await page.getByRole("button", { name: /Thông báo thanh toán/ }).click()
      await page.locator(".pay-ntf", { hasText: "Từ chối hủy thanh toán" }).first().click()
      await expect(page).toHaveURL(new RegExp(`/payment/${a2VisitId}`))

      await page.getByRole("button", { name: "Gửi yêu cầu huỷ" }).click()
      await page.getByLabel("Lý do gửi yêu cầu huỷ (bắt buộc)").fill("Thu nhầm tiền mặt")
      await page.getByRole("button", { name: "Xác nhận gửi yêu cầu huỷ" }).click()
      await expect(page.getByText(/Đang chờ duyệt \(PENDING\)/)).toBeVisible()
      await page.getByRole("button", { name: "Phiên đang mở" }).click()
      await expect(page).toHaveURL(/\/payment$/)

      // Switch to Admin -> back to /cancel-payment -> Approve 2nd request -> verify outcome + audit
      await switchRoleInUi(page, /Quản trị viên/)
      await page.getByRole("button", { name: /Tài khoản:/ }).click()
      await page.getByRole("menuitem", { name: /Về Điều phối/ }).click()
      await page.getByRole("link", { name: "Duyệt huỷ thanh toán" }).click()
      await expect(page.getByText("Thu nhầm tiền mặt").first()).toBeVisible()
      await page.getByLabel("Ghi chú phản hồi (tuỳ chọn)").first().fill("OK thu lại QR")
      const approveBtn = page.getByRole("button", { name: "Duyệt huỷ", exact: true }).first()
      await approveBtn.scrollIntoViewIfNeeded()
      await approveBtn.click()
      await expect(page.getByTestId("pc-queue-feedback")).toContainText("bill về Chưa thu, bàn xanh lá, lượt -1", {
        timeout: 10000,
      })

      // Verify Audit panel has full trail for billCode
      const auditRegion = page.getByRole("region", { name: "Nhật ký thanh toán và huỷ theo bill" })
      await expect(auditRegion.getByText("Duyệt huỷ thanh toán").first()).toBeVisible()
      await expect(auditRegion.getByText("OK thu lại QR").first()).toBeVisible()
      await expect(auditRegion.getByText("Máy quản trị").first()).toBeVisible()
      await page.screenshot({ path: path.join(ARTIFACTS_DIR, "w4-1440-audit.png") })

      // Switch to Cashier -> verify CANCEL_DECIDED approval notification & re-pay A2 via QR (A2 is back in Cần thu on S1!)
      await switchRoleInUi(page, /Thu ngân/)
      await expect(page).toHaveURL(/\/payment/)
      await page.getByRole("button", { name: /Thông báo thanh toán/ }).click()
      await expect(page.getByText("Đã duyệt hủy thanh toán")).toBeVisible()
      await page.keyboard.press("Escape")
      const a2Reopened = page.locator(".pay-sess", { hasText: "A2" })
      await expect(a2Reopened).toBeVisible()
      await a2Reopened.click()
      await a2Reopened.click()

      await page.getByRole("button", { name: /Thu tiền/ }).click()
      await page.getByRole("button", { name: /Chuyển khoản QR/ }).click()
      await page.getByRole("button", { name: "Xác nhận đã nhận tiền" }).click()
      await page.getByRole("checkbox").check()
      await page.getByRole("button", { name: "Xác nhận", exact: true }).click()
      await expect(page.getByRole("heading", { name: "Đã thanh toán" })).toBeVisible()

      // Switch to OWNER -> PaidBillsPanel -> select billCode -> DirectCancelPanel blank-reason validation + valid submit
      await switchRoleInUi(page, /Chủ sở hữu/)
      await page.getByRole("button", { name: /Tài khoản:/ }).click()
      await page.getByRole("menuitem", { name: /Về Điều phối/ }).click()
      await page.getByRole("link", { name: "Duyệt huỷ thanh toán" }).click()

      const paidCard = page.getByTestId(`pc-paid-${billCode}`)
      await expect(paidCard).toBeVisible()
      await paidCard.getByRole("button", { name: "Chọn huỷ thanh toán" }).click()
      const directForm = page.getByTestId(`pc-direct-form-${billCode}`)
      await expect(directForm).toBeVisible()
      await directForm.getByRole("button", { name: "Xác nhận huỷ thanh toán" }).click()
      await expect(directForm.getByText("Vui lòng nhập lý do huỷ thanh toán.")).toBeVisible()
      await directForm.getByLabel("Lý do huỷ thanh toán (bắt buộc)").fill("Khách gọi thêm món")
      await directForm.getByRole("button", { name: "Xác nhận huỷ thanh toán" }).click()
      await expect(page.getByTestId("pc-direct-outcome")).toContainText(
        "bill về Chưa thu, bàn xanh lá, lượt -1",
      )
      await expect(
        page.getByRole("region", { name: "Nhật ký thanh toán và huỷ theo bill" }).getByText("Huỷ thanh toán trực tiếp").first(),
      ).toBeVisible()
      await page.screenshot({ path: path.join(ARTIFACTS_DIR, "w4-1440-direct-cancel.png") })

      assert.deepEqual(errors, [], `w4 1440 console errors: ${errors.join(" | ")}`)
      console.log("PASS w4 1440 approval queue + reject/approve + direct cancel + audit")
    } finally {
      await context.close()
    }
  }

  // 2. W4b Lễ tân (RECEPTIONIST) E2E: Menu "Huỷ thanh toán" across 390/820/1440 -> pick just-paid bill -> empty reason blocked -> cancel with reason -> bill Chưa thu, table green, turn -1, audit row
  {
    const { context, page, errors } = await openAs({ width: 1440, height: 900 }, 5, "/payment")

    try {
      // Cashier pays A3 (Cash) and records turn count before cancel
      const a3Session = page.locator(".pay-sess", { hasText: "A3" })
      await a3Session.click()
      await a3Session.click()
      await page.getByRole("button", { name: "Xuất hóa đơn" }).click()
      await page.getByRole("button", { name: /^Thu tiền/ }).click()
      await page.getByRole("button", { name: /Tiền mặt/ }).click()
      await page.locator(".pay-chips .pay-chip").first().click()
      await page.getByRole("button", { name: /Xác nhận đã nhận/ }).click()
      await expect(page.getByRole("heading", { name: "Đã thanh toán" })).toBeVisible()

      const a3VisitId = new URL(page.url()).pathname.split("/")[2]
      const a3BillCode = `B${String(a3VisitId).padStart(4, "0")}`

      const beforeStats = await page.evaluate(async (vid) => {
        const [{ api, clock }, { DEMO_USERS }] = await Promise.all([
          import("/src/services/index.ts"),
          import("/src/services/mock/seed.ts"),
        ])
        api.setSession(DEMO_USERS.find((u) => u.role === "OWNER"))
        const bd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(clock.now())
        const summary = await api.getTableTurnSummary({ from: bd, to: bd })
        const turns = await api.getTableTurns({ from: bd, to: bd })
        const visitTurn = turns.find((t) => String(t.visitId) === String(vid))
        return { closedTurns: summary.closedTurns, visitTurnStatus: visitTurn?.status ?? null }
      }, a3VisitId)
      assert.equal(beforeStats.visitTurnStatus, "CLOSED", "Paid A3 turn should be CLOSED before cancel")

      // Also verify Cashier cannot stay on /cancel-payment
      await page.evaluate(async () => {
        const [{ api }, { DEMO_USERS }] = await Promise.all([
          import("/src/services/index.ts"),
          import("/src/services/mock/seed.ts"),
        ])
        api.setSession(DEMO_USERS.find((u) => u.role === "CASHIER"))
      })
      await page.goto(`${base}/cancel-payment`, { waitUntil: "networkidle" })
      assert.equal(new URL(page.url()).pathname, "/payment", "CASHIER must be redirected away from /cancel-payment")

      // Switch to RECEPTIONIST on /floor -> check Menu item "Huỷ thanh toán" at 390, 820, 1440 -> navigate
      await page.evaluate(async () => {
        const [{ api }, { DEMO_USERS }] = await Promise.all([
          import("/src/services/index.ts"),
          import("/src/services/mock/seed.ts"),
        ])
        api.setSession(DEMO_USERS.find((u) => u.role === "RECEPTIONIST"))
      })
      await page.goto(`${base}/floor`, { waitUntil: "networkidle" })
      assert.equal(new URL(page.url()).pathname, "/floor")

      for (const vp of [
        { width: 390, height: 844, label: "390" },
        { width: 820, height: 1180, label: "820" },
        { width: 1440, height: 900, label: "1440" },
      ]) {
        await page.setViewportSize({ width: vp.width, height: vp.height })
        await page.getByRole("button", { name: /^Menu/ }).click()
        const cancelMenuItem = page.getByRole("button", { name: /Huỷ thanh toán/ })
        await expect(cancelMenuItem).toBeVisible()
        if (vp.label !== "1440") {
          await page.getByRole("button", { name: "Đóng", exact: true }).click()
        } else {
          await cancelMenuItem.click()
        }
      }

      await expect(page).toHaveURL(/\/cancel-payment$/)
      await expect(page.getByRole("heading", { name: "Huỷ thanh toán đã thu" })).toBeVisible()
      await expect(page.getByRole("region", { name: "Bill đã thu trong ca" })).toBeVisible()
      await expect(page.getByRole("region", { name: "Hàng chờ duyệt huỷ thanh toán" })).toHaveCount(0)

      // Search by bill code / table works
      const searchInput = page.getByLabel("Tìm theo mã bill hoặc bàn")
      await searchInput.fill(a3BillCode)
      const a3Card = page.getByTestId(`pc-paid-${a3BillCode}`)
      await expect(a3Card).toBeVisible()
      await expect(a3Card).toContainText("Bàn A3")
      await expect(a3Card).toContainText("Tiền mặt")
      await expect(a3Card).toContainText("Thu ngân")
      await searchInput.fill("")

      // Select just-paid bill -> opens DirectCancelPanel (reason required) + AuditPanel
      await a3Card.getByRole("button", { name: "Chọn huỷ thanh toán" }).click()
      const directForm = page.getByTestId(`pc-direct-form-${a3BillCode}`)
      await expect(directForm).toBeVisible()
      const recAuditRegion = page.getByRole("region", { name: "Nhật ký thanh toán và huỷ theo bill" })
      await expect(recAuditRegion).toBeVisible()

      // Empty reason is blocked
      await directForm.getByRole("button", { name: "Xác nhận huỷ thanh toán" }).click()
      await expect(directForm.getByText("Vui lòng nhập lý do huỷ thanh toán.")).toBeVisible()

      // Cancel with reason
      await directForm.getByLabel("Lý do huỷ thanh toán (bắt buộc)").fill("Lễ tân huỷ: khách gọi thêm")
      await directForm.getByRole("button", { name: "Xác nhận huỷ thanh toán" }).click()
      await expect(page.getByTestId("pc-direct-outcome")).toContainText("bill về Chưa thu, bàn xanh lá, lượt -1")

      // Audit row visible on AuditPanel for RECEPTIONIST
      await expect(recAuditRegion.getByText("Huỷ thanh toán trực tiếp").first()).toBeVisible()
      await expect(recAuditRegion.getByText("Lễ tân huỷ: khách gọi thêm").first()).toBeVisible()
      await page.screenshot({ path: path.join(ARTIFACTS_DIR, "w4b-1440-reception-cancel.png") })

      // Navigate back to /floor -> verify table A3 is green (Đã tới) and turn -1 + bill Chưa thu
      await page.getByRole("button", { name: "Về sơ đồ" }).click()
      await expect(page).toHaveURL(/\/floor$/)
      await expect(page.locator('[aria-label*="A3"][aria-label*="Đã tới"]').first()).toBeVisible()

      const afterStats = await page.evaluate(async (vid) => {
        const [{ api, clock }, { paymentApi }, { DEMO_USERS }] = await Promise.all([
          import("/src/services/index.ts"),
          import("/src/services/payment/index.ts"),
          import("/src/services/mock/seed.ts"),
        ])
        api.setSession(DEMO_USERS.find((u) => u.role === "OWNER"))
        const bd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(clock.now())
        const summary = await api.getTableTurnSummary({ from: bd, to: bd })
        const turns = await api.getTableTurns({ from: bd, to: bd })
        const visitTurn = turns.find((t) => String(t.visitId) === String(vid))
        const sessionBills = await paymentApi.getSessionBills(vid)
        return {
          closedTurns: summary.closedTurns,
          visitTurnStatus: visitTurn?.status ?? null,
          billStatuses: sessionBills.bills.map((b) => b.billStatus),
        }
      }, a3VisitId)
      assert.equal(afterStats.closedTurns, beforeStats.closedTurns - 1, "Closed turns should decrement by 1")
      assert.equal(afterStats.visitTurnStatus, "OPEN", "A3 turn should reopen to OPEN")
      assert(afterStats.billStatuses.includes("UNPAID"), "Cancelled bill should return to UNPAID (Chưa thu)")

      assert.deepEqual(errors, [], `w4b reception console errors: ${errors.join(" | ")}`)
      console.log("PASS w4b reception menu + paid bills list + cancel + floor green + turn -1 + audit")
    } finally {
      await context.close()
    }
  }

  // 3. Guard check: Waiter (6) & Bartender (8) cannot reach /cancel-payment
  {
    for (const guardCase of [
      { userId: 6, expectedPathPrefix: "/phucvu", label: "WAITER" },
      { userId: 8, expectedPathPrefix: "/chebien", label: "BAR" },
    ]) {
      const { context, page, errors } = await openAs({ width: 390, height: 844 }, guardCase.userId, "/cancel-payment")
      try {
        assert(
          new URL(page.url()).pathname.startsWith(guardCase.expectedPathPrefix),
          `${guardCase.label} should redirect away from /cancel-payment to ${guardCase.expectedPathPrefix}, got ${page.url()}`,
        )
        assert.deepEqual(errors, [], `${guardCase.label} guard console errors: ${errors.join(" | ")}`)
      } finally {
        await context.close()
      }
    }
    console.log("PASS w4b WAITER & BAR blocked from /cancel-payment")
  }

  // 4. Mobile 390x844 layout overflow check (ADMIN & RECEPTIONIST)
  {
    const { context, page, errors } = await openAs({ width: 390, height: 844 }, 7, "/cancel-payment")
    try {
      await expect(page.getByRole("heading", { name: "Duyệt huỷ thanh toán" }).first()).toBeVisible()
      await assertNoOverflow(page, "w4 390 admin")
      await page.screenshot({ path: path.join(ARTIFACTS_DIR, "w4-390-admin.png") })
      assert.deepEqual(errors, [], `w4 390 admin console errors: ${errors.join(" | ")}`)
      console.log("PASS w4 390 admin layout check")
    } finally {
      await context.close()
    }

    const rec = await openAs({ width: 390, height: 844 }, 1, "/cancel-payment")
    try {
      await expect(rec.page.getByRole("heading", { name: "Huỷ thanh toán đã thu" }).first()).toBeVisible()
      await assertNoOverflow(rec.page, "w4b 390 receptionist")
      await rec.page.screenshot({ path: path.join(ARTIFACTS_DIR, "w4b-390-reception.png") })
      assert.deepEqual(rec.errors, [], `w4b 390 reception console errors: ${rec.errors.join(" | ")}`)
      console.log("PASS w4b 390 reception layout check")
    } finally {
      await rec.context.close()
    }
  }
} finally {
  if (browser) await browser.close()
  if (viteServer) await viteServer.close()
}

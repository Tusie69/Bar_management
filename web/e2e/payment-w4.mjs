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
      await expect(page.getByTestId("pc-direct-outcome")).toContainText("bill về Chưa thu, bàn xanh lá, lượt -1")
      await expect(
        page
          .getByRole("region", { name: "Nhật ký thanh toán và huỷ theo bill" })
          .getByText("Huỷ thanh toán trực tiếp")
          .first(),
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
        const [{ api, clock }, { businessDateOf }, { DEMO_USERS }] = await Promise.all([
          import("/src/services/index.ts"),
          import("/src/lib/time.ts"),
          import("/src/services/mock/seed.ts"),
        ])
        api.setSession(DEMO_USERS.find((u) => u.role === "OWNER"))
        const bd = businessDateOf(clock.now())
        const res = await api.getTableTurns({ from: bd, to: bd, includeUncounted: true })
        const visitTurn = res.turns.find((t) => String(t.visitId) === String(vid))
        const closedTurns = res.turns.filter((t) => t.status === "CLOSED").length
        return { closedTurns, visitTurnStatus: visitTurn?.status ?? null }
      }, a3VisitId)
      assert.equal(beforeStats.visitTurnStatus, "CLOSED", "Paid A3 turn should be CLOSED before cancel")

      // Switch to RECEPTIONIST via Account menu (preserves in-memory MockGamApi state and redirects /payment -> /floor)
      await page.getByRole("button", { name: "Về danh sách Phiên" }).click()
      await expect(page).toHaveURL(/\/payment$/)
      await switchRoleInUi(page, /Lễ tân 1/)
      await expect(page).toHaveURL(/\/floor$/)

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
          await page.getByRole("button", { name: "Đóng", exact: true }).first().click()
        } else {
          await cancelMenuItem.click()
        }
      }

      await expect(page).toHaveURL(/\/cancel-payment$/)
      for (const vp of [
        { width: 390, height: 844, label: "390" },
        { width: 820, height: 1180, label: "820" },
        { width: 1440, height: 900, label: "1440" },
      ]) {
        await page.setViewportSize({ width: vp.width, height: vp.height })
        await expect(page.locator("header.gm-glass-chrome h1")).toHaveText("Huỷ thanh toán")
        await expect(page.getByRole("heading", { name: "Huỷ thanh toán đã thu" })).toBeVisible()
        await assertNoOverflow(page, `w4b ${vp.label} reception cancel`)
      }
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

      // Navigate back to /floor -> verify table A3 is green (Đã tới) and turn -1 + bill Chưa thu + menu item still reachable
      await page.getByRole("button", { name: "Về sơ đồ" }).click()
      await expect(page).toHaveURL(/\/floor$/)
      await page.getByRole("button", { name: /^Menu/ }).click()
      await expect(page.getByRole("button", { name: /Huỷ thanh toán/ })).toBeVisible()
      await page.getByRole("button", { name: "Đóng", exact: true }).first().click()
      await expect(page.locator('[aria-label*="A3"][aria-label*="Đã tới"]').first()).toBeVisible()

      const afterStats = await page.evaluate(async (vid) => {
        const [{ api, clock }, { businessDateOf }, { paymentApi }, { DEMO_USERS }] = await Promise.all([
          import("/src/services/index.ts"),
          import("/src/lib/time.ts"),
          import("/src/services/payment/index.ts"),
          import("/src/services/mock/seed.ts"),
        ])
        api.setSession(DEMO_USERS.find((u) => u.role === "OWNER"))
        const bd = businessDateOf(clock.now())
        const res = await api.getTableTurns({ from: bd, to: bd, includeUncounted: true })
        const visitTurn = res.turns.find((t) => String(t.visitId) === String(vid))
        const closedTurns = res.turns.filter((t) => t.status === "CLOSED").length
        const sessionBills = await paymentApi.getSessionBills(vid)
        return {
          closedTurns,
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
      await expect(rec.page.locator("header.gm-glass-chrome h1")).toHaveText("Huỷ thanh toán")
      await expect(rec.page.getByRole("heading", { name: "Huỷ thanh toán đã thu" }).first()).toBeVisible()
      await assertNoOverflow(rec.page, "w4b 390 reception")
      await rec.page.screenshot({ path: path.join(ARTIFACTS_DIR, "w4b-390-reception.png") })
      assert.deepEqual(rec.errors, [], `w4b 390 reception console errors: ${rec.errors.join(" | ")}`)
      console.log("PASS w4b 390 reception layout check")
    } finally {
      await rec.context.close()
    }
  }

  // 5. NA45H-12: Open multi-bill session cancel (both Queue Approve & Direct Cancel) must NOT report turn -1 and must keep closed turns unchanged
  {
    const { context, page, errors } = await openAs({ width: 1440, height: 900 }, 5, "/payment")
    try {
      const a3Session = page.locator(".pay-sess", { hasText: "A3" })
      await a3Session.click()
      await a3Session.click()
      await expect(page).toHaveURL(/\/payment\/\d+/)
      const a3VisitId = new URL(page.url()).pathname.split("/")[2]

      // Issue bill 1, then add extra order round so session stays open with bill 2 / unbilled items
      await page.getByRole("button", { name: "Xuất hóa đơn" }).click()
      await expect(page.getByRole("button", { name: /^Thu tiền/ })).toBeVisible()
      const bill1Code = await page.evaluate(async (vid) => {
        const mock = window.__21gamPaymentMock
        await mock.addOrderLines(vid, [{ name: "Coca", unit: "Lon", qty: 1, unitPriceVnd: 45_000, state: "SERVED" }])
        const sb = await mock.paymentApi.getSessionBills(vid)
        return sb.bills[0].billCode
      }, a3VisitId)
      const p2 = await page.evaluate(async (vid) => {
        const mock = window.__21gamPaymentMock
        const prev = await mock.paymentApi.previewBill(vid)
        return mock.paymentApi.issueInvoice(vid, prev.version, "w4-na45h12-inv2")
      }, a3VisitId)
      const bill2Code = p2.billCode

      // Stay on S2; issueInvoice emitted PAYMENT_INVOICE_ISSUED so both bill pills appear automatically
      await expect(page.locator("button", { hasText: bill2Code }).first()).toBeVisible()
      await page.locator("button", { hasText: bill1Code }).first().click()
      await page.getByRole("button", { name: new RegExp(`Thu tiền · ${bill1Code}`) }).click()
      await page.getByRole("button", { name: /Tiền mặt/ }).click()
      await page.locator(".pay-chips .pay-chip").first().click()
      await page.getByRole("button", { name: /Xác nhận đã nhận/ }).click()

      const turnsBefore = await page.evaluate(async () => {
        const [{ api, clock }, { businessDateOf }, { DEMO_USERS }] = await Promise.all([
          import("/src/services/index.ts"),
          import("/src/lib/time.ts"),
          import("/src/services/mock/seed.ts"),
        ])
        api.setSession(DEMO_USERS.find((u) => u.role === "OWNER"))
        const bd = businessDateOf(clock.now())
        const res = await api.getTableTurns({ from: bd, to: bd, includeUncounted: true })
        return res.turns.filter((t) => t.status === "CLOSED").length
      })

      // Cashier requests cancel on bill 1 while bill 2 is still UNPAID
      await page.evaluate(async (b1) => {
        const [{ api }, { DEMO_USERS }] = await Promise.all([
          import("/src/services/index.ts"),
          import("/src/services/mock/seed.ts"),
        ])
        api.setSession(DEMO_USERS.find((u) => u.role === "CASHIER"))
        await window.__21gamPaymentMock.paymentApi.requestCancel(b1, "Tách lại món")
      }, bill1Code)

      await page.getByRole("button", { name: "Về chi tiết Phiên" }).click()
      await page.getByRole("button", { name: "Phiên đang mở" }).click()
      await expect(page).toHaveURL(/\/payment$/)
      await switchRoleInUi(page, /Quản trị viên/)
      await page.getByRole("button", { name: /Tài khoản:/ }).click()
      await page.getByRole("menuitem", { name: /Về Điều phối/ }).click()
      await page.getByRole("link", { name: "Duyệt huỷ thanh toán" }).click()

      await page.getByRole("button", { name: "Duyệt huỷ", exact: true }).first().click()
      const queueFeedback = page.getByTestId("pc-queue-feedback")
      await expect(queueFeedback).toContainText("bill về Chưa thu, phiên vẫn đang mở (không đổi lượt)")
      assert(!(await queueFeedback.innerText()).includes("lượt -1"), "Open session approve must not say lượt -1")

      // Re-pay bill 1, then test Receptionist Direct Cancel on open session
      await page.evaluate(
        async ({ vid, b1 }) => {
          const [{ api }, { DEMO_USERS }] = await Promise.all([
            import("/src/services/index.ts"),
            import("/src/services/mock/seed.ts"),
          ])
          api.setSession(DEMO_USERS.find((u) => u.role === "CASHIER"))
          const sb = await window.__21gamPaymentMock.paymentApi.getSessionBills(vid)
          const target = sb.bills.find((b) => b.billCode === b1)
          await window.__21gamPaymentMock.paymentApi.confirmCash(vid, target.dueVnd, sb.version, "w4-na45h12-repay", b1)
        },
        { vid: a3VisitId, b1: bill1Code },
      )

      await switchRoleInUi(page, /Lễ tân 1/)
      await expect(page.getByRole("heading", { name: "Huỷ thanh toán đã thu" })).toBeVisible()
      await page.getByRole("button", { name: "Làm mới tất cả" }).click()
      await page.getByTestId(`pc-paid-${bill1Code}`).getByRole("button", { name: "Chọn huỷ thanh toán" }).click()
      const directForm = page.getByTestId(`pc-direct-form-${bill1Code}`)
      await directForm.getByLabel("Lý do huỷ thanh toán (bắt buộc)").fill("Huỷ bill 1 phiên đang mở")
      await directForm.getByRole("button", { name: "Xác nhận huỷ thanh toán" }).click()

      const directOutcome = page.getByTestId("pc-direct-outcome")
      await expect(directOutcome).toContainText("bill về Chưa thu, phiên vẫn đang mở (không đổi lượt)")
      assert(!(await directOutcome.innerText()).includes("lượt -1"), "Open session direct cancel must not say lượt -1")

      const checkAfter = await page.evaluate(async (vid) => {
        const [{ api, clock }, { businessDateOf }, { DEMO_USERS }] = await Promise.all([
          import("/src/services/index.ts"),
          import("/src/lib/time.ts"),
          import("/src/services/mock/seed.ts"),
        ])
        api.setSession(DEMO_USERS.find((u) => u.role === "OWNER"))
        const bd = businessDateOf(clock.now())
        const res = await api.getTableTurns({ from: bd, to: bd, includeUncounted: true })
        const sb = await window.__21gamPaymentMock.paymentApi.getSessionBills(vid)
        const floor = await api.getFloorState(clock.now())
        return {
          closedTurns: res.turns.filter((t) => t.status === "CLOSED").length,
          sessionStatus: sb.status,
          bills: sb.bills.map((b) => ({ billCode: b.billCode, billStatus: b.billStatus })),
          a3Open: floor.tables.some((t) => String(t.claim?.visitId ?? "") === String(vid)),
        }
      }, a3VisitId)

      assert.equal(checkAfter.closedTurns, turnsBefore, "Open session cancel must keep closed turn count unchanged")
      assert.equal(checkAfter.sessionStatus, "AWAITING_PAYMENT")
      assert.equal(checkAfter.a3Open, true)
      assert(
        checkAfter.bills.every((b) => b.billStatus === "UNPAID"),
        `Both ${bill1Code} and ${bill2Code} should be UNPAID`,
      )
      assert.deepEqual(errors, [], `NA45H-12 console errors: ${errors.join(" | ")}`)
      console.log("PASS NA45H-12 open multi-bill session cancel impact (approve & direct)")
    } finally {
      await context.close()
    }
  }

  // 6. NA45H-15: PaidBillsPanel keeps API timestamp order across midnight (00:30 before 23:50), including search and refresh
  {
    const { context, page, errors } = await openAs({ width: 1440, height: 900 }, 5, "/payment")
    try {
      const codes = await page.evaluate(async () => {
        const [{ api, clock }, { DEMO_USERS }] = await Promise.all([
          import("/src/services/index.ts"),
          import("/src/services/mock/seed.ts"),
        ])
        const pay = window.__21gamPaymentMock.paymentApi
        api.setSession(DEMO_USERS.find((u) => u.role === "CASHIER"))

        // Advance from 21:30 -> 23:50 and pay A2
        clock.advance(140)
        const a2Id = await window.__21gamPaymentMock.visitIdForTable("A2")
        const a2Bill0 = await pay.getBill(a2Id)
        const a2Bill = await pay.issueInvoice(a2Id, a2Bill0.version, "w4-na45h15-a2")
        await pay.confirmCash(a2Id, a2Bill.dueVnd, a2Bill.version, "w4-na45h15-pay-a2", a2Bill.billCode)

        // Advance from 23:50 -> 00:30 (same business day) and pay A3
        clock.advance(40)
        const a3Id = await window.__21gamPaymentMock.visitIdForTable("A3")
        const a3Bill0 = await pay.getBill(a3Id)
        const a3Bill = await pay.issueInvoice(a3Id, a3Bill0.version, "w4-na45h15-a3")
        await pay.confirmCash(a3Id, a3Bill.dueVnd, a3Bill.version, "w4-na45h15-pay-a3", a3Bill.billCode)

        return { b2350: a2Bill.billCode, b0030: a3Bill.billCode }
      })

      await switchRoleInUi(page, /Lễ tân 1/)
      await page.getByRole("button", { name: /^Menu/ }).click()
      await page.getByRole("button", { name: /Huỷ thanh toán/ }).click()

      const paidRegion = page.getByRole("region", { name: "Bill đã thu trong ca" })
      await expect(paidRegion.getByTestId(`pc-paid-${codes.b0030}`)).toBeVisible()
      await expect(paidRegion.getByTestId(`pc-paid-${codes.b2350}`)).toBeVisible()
      const readOrder = async () =>
        paidRegion
          .locator("[data-testid^='pc-paid-']")
          .evaluateAll((els) => els.map((el) => el.getAttribute("data-testid") ?? ""))

      const initialOrder = await readOrder()
      assert(
        initialOrder.indexOf(`pc-paid-${codes.b0030}`) < initialOrder.indexOf(`pc-paid-${codes.b2350}`),
        `Expected 00:30 (${codes.b0030}) before 23:50 (${codes.b2350}), got ${initialOrder.join(",")}`,
      )

      await page.getByLabel("Tìm theo mã bill hoặc bàn").fill("A")
      const searchOrder = await readOrder()
      assert(
        searchOrder.indexOf(`pc-paid-${codes.b0030}`) < searchOrder.indexOf(`pc-paid-${codes.b2350}`),
        `Expected search order 00:30 before 23:50, got ${searchOrder.join(",")}`,
      )

      await page.getByLabel("Tìm theo mã bill hoặc bàn").fill("")
      await paidRegion.getByRole("button", { name: "Làm mới danh sách bill đã thu" }).click()
      const refreshOrder = await readOrder()
      assert(
        refreshOrder.indexOf(`pc-paid-${codes.b0030}`) < refreshOrder.indexOf(`pc-paid-${codes.b2350}`),
        `Expected refresh order 00:30 before 23:50, got ${refreshOrder.join(",")}`,
      )

      assert.deepEqual(errors, [], `NA45H-15 console errors: ${errors.join(" | ")}`)
      console.log("PASS NA45H-15 across-midnight order (00:30 before 23:50) + search + refresh")
    } finally {
      await context.close()
    }
  }

  // 7. NA45H-10 & NA45H-14: Two independent browser windows at the same origin (Admin /cancel-payment + Cashier /payment)
  // Real-time queue + decision sync without reload, role switch, refresh click, or clock advance, plus separate audit reason & decisionNote
  {
    const syncContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    try {
      const adminPage = await syncContext.newPage()
      const cashierPage = await syncContext.newPage()
      const syncErrors = []
      for (const p of [adminPage, cashierPage]) {
        p.on("pageerror", (e) => syncErrors.push(e.message))
        p.on("console", (msg) => {
          if (msg.type() === "error") syncErrors.push(msg.text())
        })
      }

      await adminPage.addInitScript(() => {
        localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 7, theme: "light" }))
      })
      await adminPage.goto(`${base}/cancel-payment`, { waitUntil: "networkidle" })
      await expect(adminPage.getByRole("heading", { name: "Duyệt huỷ thanh toán" }).first()).toBeVisible()
      await expect(adminPage.getByText("Chờ duyệt (0)")).toBeVisible()

      await cashierPage.addInitScript(() => {
        localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 5, theme: "light" }))
      })
      await cashierPage.goto(`${base}/payment`, { waitUntil: "networkidle" })

      const a2Session = cashierPage.locator(".pay-sess", { hasText: "A2" })
      await a2Session.click()
      await a2Session.click()
      await cashierPage.getByRole("button", { name: "Xuất hóa đơn" }).click()
      await cashierPage.getByRole("button", { name: /^Thu tiền/ }).click()
      await cashierPage.getByRole("button", { name: /Tiền mặt/ }).click()
      await cashierPage.locator(".pay-chips .pay-chip").first().click()
      await cashierPage.getByRole("button", { name: /Xác nhận đã nhận/ }).click()
      await expect(cashierPage.getByRole("heading", { name: "Đã thanh toán" })).toBeVisible()

      await cashierPage.getByRole("button", { name: /Thông báo thanh toán/ }).click()
      await cashierPage.locator(".pay-ntf", { hasText: "Đã thanh toán" }).first().click()
      await cashierPage.getByRole("button", { name: "Gửi yêu cầu huỷ" }).click()
      await cashierPage.getByLabel("Lý do gửi yêu cầu huỷ (bắt buộc)").fill("Khách đổi QR sang tiền mặt")
      await cashierPage.getByRole("button", { name: "Xác nhận gửi yêu cầu huỷ" }).click()
      await expect(cashierPage.getByText(/Đang chờ duyệt \(PENDING\)/)).toBeVisible()

      // Admin window sees request automatically without reload, role switch, refresh, or clock advance
      await expect(adminPage.getByText("Chờ duyệt (1)")).toBeVisible({ timeout: 3000 })
      await expect(adminPage.getByText("Khách đổi QR sang tiền mặt").first()).toBeVisible({ timeout: 3000 })

      // Reject with decisionNote -> Cashier sees REJECTED + note automatically; AuditPanel separates reason & decisionNote
      await adminPage.getByLabel("Ghi chú phản hồi (tuỳ chọn)").first().fill("Chưa khớp sao kê")
      await adminPage.getByRole("button", { name: "Từ chối" }).first().click()
      await expect(cashierPage.getByText(/Bị từ chối \(REJECTED\)/)).toBeVisible({ timeout: 3000 })
      await expect(cashierPage.getByText(/Chưa khớp sao kê/)).toBeVisible({ timeout: 3000 })

      const auditRegion = adminPage.getByRole("region", { name: "Nhật ký thanh toán và huỷ theo bill" })
      await expect(auditRegion.getByText("Khách đổi QR sang tiền mặt").first()).toBeVisible()
      await expect(auditRegion.getByText("Chưa khớp sao kê").first()).toBeVisible()

      // 2nd request -> Admin approves with distinct note -> Cashier sees APPROVED automatically & AuditPanel keeps both fields
      await cashierPage.getByRole("button", { name: "Gửi yêu cầu huỷ" }).click()
      await cashierPage.getByLabel("Lý do gửi yêu cầu huỷ (bắt buộc)").fill("Thu nhầm tiền mặt")
      await cashierPage.getByRole("button", { name: "Xác nhận gửi yêu cầu huỷ" }).click()
      await expect(adminPage.getByText("Chờ duyệt (1)")).toBeVisible({ timeout: 3000 })

      await adminPage.getByLabel("Ghi chú phản hồi (tuỳ chọn)").first().fill("Duyệt thu lại QR")
      await adminPage.getByRole("button", { name: "Duyệt huỷ", exact: true }).first().click()
      await expect(adminPage.getByTestId("pc-queue-feedback")).toContainText("bill về Chưa thu, bàn xanh lá, lượt -1")
      await expect(cashierPage.getByText(/Đã duyệt huỷ \(APPROVED\)/)).toBeVisible({ timeout: 3000 })
      await expect(cashierPage.getByText(/Duyệt thu lại QR/)).toBeVisible({ timeout: 3000 })
      await expect(auditRegion.getByText("Thu nhầm tiền mặt").first()).toBeVisible()
      await expect(auditRegion.getByText("Duyệt thu lại QR").first()).toBeVisible()

      assert.deepEqual(syncErrors, [], `NA45H-10 cross-window console errors: ${syncErrors.join(" | ")}`)
      console.log("PASS NA45H-10 & NA45H-14 two-window real-time sync (reject & approve) + separate audit fields")
    } finally {
      await syncContext.close()
    }
  }

  // 8. NA45H-12 interleaved last-bill collection: Cashier closes session between form/queue view and cancel mutation (Direct Cancel & Queue Approve)
  {
    const interleaveContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    try {
      const cashierPage = await interleaveContext.newPage()
      const receptionPage = await interleaveContext.newPage()
      const adminPage = await interleaveContext.newPage()
      const interleaveErrors = []
      for (const p of [cashierPage, receptionPage, adminPage]) {
        p.on("pageerror", (e) => interleaveErrors.push(e.message))
        p.on("console", (msg) => {
          if (msg.type() === "error") interleaveErrors.push(msg.text())
        })
      }

      await cashierPage.addInitScript(() => {
        localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 5, theme: "light" }))
      })
      await receptionPage.addInitScript(() => {
        localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 1, theme: "light" }))
      })
      await adminPage.addInitScript(() => {
        localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 7, theme: "light" }))
      })

      await cashierPage.goto(`${base}/payment`, { waitUntil: "networkidle" })
      await receptionPage.goto(`${base}/cancel-payment`, { waitUntil: "networkidle" })
      await adminPage.goto(`${base}/cancel-payment`, { waitUntil: "networkidle" })

      // Prepare A3 with 2 bills: bill1 PAID, bill2 UNPAID (session OPEN)
      const a3Session = cashierPage.locator(".pay-sess", { hasText: "A3" })
      await a3Session.click()
      await a3Session.click()
      await expect(cashierPage).toHaveURL(/\/payment\/\d+/)
      const a3VisitId = new URL(cashierPage.url()).pathname.split("/")[2]

      await cashierPage.getByRole("button", { name: "Xuất hóa đơn" }).click()
      await expect(cashierPage.getByRole("button", { name: /^Thu tiền/ })).toBeVisible()
      const { bill1Code, bill2Code } = await cashierPage.evaluate(async (vid) => {
        const mock = window.__21gamPaymentMock
        const sb1 = await mock.paymentApi.getSessionBills(vid)
        await mock.addOrderLines(vid, [{ name: "Coca", unit: "Lon", qty: 1, unitPriceVnd: 45_000, state: "SERVED" }])
        const prev = await mock.paymentApi.previewBill(vid)
        const b2 = await mock.paymentApi.issueInvoice(vid, prev.version, "w4-na45h12-interleave-b2")
        return { bill1Code: sb1.bills[0].billCode, bill2Code: b2.billCode }
      }, a3VisitId)

      await expect(cashierPage.locator("button", { hasText: bill2Code }).first()).toBeVisible()
      await cashierPage.locator("button", { hasText: bill1Code }).first().click()
      await cashierPage.getByRole("button", { name: new RegExp(`Thu tiền · ${bill1Code}`) }).click()
      await cashierPage.getByRole("button", { name: /Tiền mặt/ }).click()
      await cashierPage.locator(".pay-chips .pay-chip").first().click()
      await cashierPage.getByRole("button", { name: /Xác nhận đã nhận/ }).click()
      await expect(cashierPage.getByRole("heading", { name: "Đã thanh toán" })).toBeVisible()

      const readTurnSnapshot = async (vid) =>
        adminPage.evaluate(async (visitId) => {
          const [{ api, clock }, { businessDateOf }] = await Promise.all([
            import("/src/services/index.ts"),
            import("/src/lib/time.ts"),
          ])
          const bd = businessDateOf(clock.now())
          const res = await api.getTableTurns({ from: bd, to: bd, includeUncounted: true })
          const visitTurn = res.turns.find((t) => String(t.visitId) === String(visitId))
          const floor = await api.getFloorState(clock.now())
          return {
            closedTurns: res.turns.filter((t) => t.status === "CLOSED").length,
            visitTurnStatus: visitTurn?.status ?? null,
            a3Open: floor.tables.some((t) => String(t.claim?.visitId ?? "") === String(visitId)),
          }
        }, vid)

      const turnsWhileOpen = await readTurnSnapshot(a3VisitId)
      assert.equal(turnsWhileOpen.visitTurnStatus, "OPEN")
      assert.equal(turnsWhileOpen.a3Open, true)

      // A) Direct Cancel interleaved with Cashier closing session by paying bill2
      await expect(receptionPage.getByTestId(`pc-paid-${bill1Code}`)).toBeVisible({ timeout: 5000 })
      await receptionPage
        .getByTestId(`pc-paid-${bill1Code}`)
        .getByRole("button", { name: "Chọn huỷ thanh toán" })
        .click()
      const directForm = receptionPage.getByTestId(`pc-direct-form-${bill1Code}`)
      await expect(directForm).toBeVisible()
      await directForm.getByLabel("Lý do huỷ thanh toán (bắt buộc)").fill("Xen kẽ thu bill cuối - huỷ trực tiếp")

      // Cashier now collects the last unpaid bill (bill2) -> A3 transitions OPEN -> CLOSED
      await cashierPage.getByRole("button", { name: "Về chi tiết Phiên" }).click()
      await cashierPage.locator("button", { hasText: bill2Code }).first().click()
      await cashierPage.getByRole("button", { name: new RegExp(`Thu tiền · ${bill2Code}`) }).click()
      await cashierPage.getByRole("button", { name: /Tiền mặt/ }).click()
      await cashierPage.locator(".pay-chips .pay-chip").first().click()
      await cashierPage.getByRole("button", { name: /Xác nhận đã nhận/ }).click()
      await expect(cashierPage.getByRole("heading", { name: "Đã thanh toán" })).toBeVisible()

      await expect
        .poll(() => readTurnSnapshot(a3VisitId), { timeout: 5000 })
        .toMatchObject({
          visitTurnStatus: "CLOSED",
          closedTurns: turnsWhileOpen.closedTurns + 1,
        })

      // Receptionist clicks confirm WITHOUT refreshing -> banner must reflect reopened session + turn -1
      await directForm.getByRole("button", { name: "Xác nhận huỷ thanh toán" }).click()
      await expect(receptionPage.getByTestId("pc-direct-outcome")).toContainText(
        "bill về Chưa thu, bàn xanh lá, lượt -1",
      )

      await expect
        .poll(() => readTurnSnapshot(a3VisitId), { timeout: 5000 })
        .toMatchObject({
          visitTurnStatus: "OPEN",
          a3Open: true,
          closedTurns: turnsWhileOpen.closedTurns,
        })

      // B) Approve Cancel Request interleaved with Cashier closing session by paying bill2
      // Re-pay bill1 only (bill2 remains UNPAID -> A3 stays OPEN), then Cashier requests cancel on bill1
      await cashierPage.evaluate(
        async ({ vid, b1 }) => {
          const [{ api }, { DEMO_USERS }] = await Promise.all([
            import("/src/services/index.ts"),
            import("/src/services/mock/seed.ts"),
          ])
          api.setSession(DEMO_USERS.find((u) => u.role === "CASHIER"))
          const mock = window.__21gamPaymentMock
          const sb = await mock.paymentApi.getSessionBills(vid)
          const target = sb.bills.find((b) => b.billCode === b1)
          await mock.paymentApi.confirmCash(vid, target.dueVnd, sb.version, "w4-na45h12-interleave-repay-b1", b1)
          await mock.paymentApi.requestCancel(b1, "Xen kẽ thu bill cuối - duyệt huỷ")
        },
        { vid: a3VisitId, b1: bill1Code },
      )

      await expect(adminPage.getByText("Xen kẽ thu bill cuối - duyệt huỷ").first()).toBeVisible({ timeout: 5000 })

      // Cashier now collects bill2 -> A3 transitions OPEN -> CLOSED before Admin clicks Approve
      await cashierPage.evaluate(
        async ({ vid, b2 }) => {
          const [{ api }, { DEMO_USERS }] = await Promise.all([
            import("/src/services/index.ts"),
            import("/src/services/mock/seed.ts"),
          ])
          api.setSession(DEMO_USERS.find((u) => u.role === "CASHIER"))
          const mock = window.__21gamPaymentMock
          const sb = await mock.paymentApi.getSessionBills(vid)
          const target = sb.bills.find((b) => b.billCode === b2)
          await mock.paymentApi.confirmCash(vid, target.dueVnd, sb.version, "w4-na45h12-interleave-pay-b2-again", b2)
        },
        { vid: a3VisitId, b2: bill2Code },
      )

      await expect
        .poll(() => readTurnSnapshot(a3VisitId), { timeout: 5000 })
        .toMatchObject({
          visitTurnStatus: "CLOSED",
          closedTurns: turnsWhileOpen.closedTurns + 1,
        })

      // Admin clicks Approve WITHOUT refreshing -> banner must reflect reopened session + turn -1
      await adminPage.getByRole("button", { name: "Duyệt huỷ", exact: true }).first().click()
      await expect(adminPage.getByTestId("pc-queue-feedback")).toContainText("bill về Chưa thu, bàn xanh lá, lượt -1")

      await expect
        .poll(() => readTurnSnapshot(a3VisitId), { timeout: 5000 })
        .toMatchObject({
          visitTurnStatus: "OPEN",
          a3Open: true,
          closedTurns: turnsWhileOpen.closedTurns,
        })

      assert.deepEqual(interleaveErrors, [], `NA45H-12 interleaved console errors: ${interleaveErrors.join(" | ")}`)
      console.log("PASS NA45H-12 interleaved last-bill collection before Direct Cancel & Approve")
    } finally {
      await interleaveContext.close()
    }
  }
} finally {
  if (browser) await browser.close()
  if (viteServer) await viteServer.close()
}

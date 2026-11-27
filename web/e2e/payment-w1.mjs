// E2E verification for W1 (HU-44 v1.1 mock backend behavior, D1 Bartender permissions, V12 multi-bill, D2 cancel & audit).
// Runs programmatic Vite on port 43941 without touching dev server on 5173.
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { chromium, expect } from "@playwright/test"
import { createServer as createViteServer } from "vite"

const PORT = 43941
const BASE_URL = `http://127.0.0.1:${PORT}`

async function startOwnedVite(port) {
  const prevMode = process.env.VITE_API_MODE
  const prevUrl = process.env.VITE_API_BASE_URL
  delete process.env.VITE_API_MODE
  delete process.env.VITE_API_BASE_URL
  try {
    const server = await createViteServer({
      configFile: path.resolve("vite.config.ts"),
      clearScreen: false,
      logLevel: "silent",
      server: { host: "127.0.0.1", port, strictPort: true },
    })
    await server.listen()
    return server
  } finally {
    if (prevMode === undefined) delete process.env.VITE_API_MODE
    else process.env.VITE_API_MODE = prevMode
    if (prevUrl === undefined) delete process.env.VITE_API_BASE_URL
    else process.env.VITE_API_BASE_URL = prevUrl
  }
}

const launchOptions = {
  headless: true,
  ...(process.platform === "win32" && fs.existsSync("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
    ? { executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" }
    : {}),
  ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
}

let viteServer = null
let browser = null

try {
  viteServer = await startOwnedVite(PORT)
  browser = await chromium.launch(launchOptions)
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.addInitScript(() => {
    // Cashier id=5 in DEMO_USERS
    localStorage.setItem("gam.mock.userId", "5")
  })
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`))
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`)
  })

  await page.goto(`${BASE_URL}/payment`, { waitUntil: "networkidle" })

  const result = await page.evaluate(async () => {
    const [{ api, clock, demo }, { paymentApi }, { roleCan }, { DEMO_USERS }] = await Promise.all([
      import("/src/services/index.ts"),
      import("/src/services/payment/index.ts"),
      import("/src/domain/access.ts"),
      import("/src/services/mock/seed.ts"),
    ])

    const mockCtrl = window.__21gamPaymentMock
    if (!mockCtrl) throw new Error("Missing window.__21gamPaymentMock in mock mode")

    demo.reset()
    clock.resetToScenario()

    const byRole = (role) => DEMO_USERS.find((u) => u.role === role)
    const waiter = byRole("WAITER")
    const bar = byRole("BAR")
    const cashier = byRole("CASHIER")
    const admin = byRole("ADMIN")

    // D1 check
    const barCanRead = roleCan("BAR", "order.read")
    const barCanCollect = roleCan("BAR", "payment.collect")
    if (!barCanRead || barCanCollect) {
      throw new Error(`Unexpected BAR permissions: order.read=${barCanRead}, payment.collect=${barCanCollect}`)
    }

    // NA45H-06: Bartender previews and issues invoice on BAR01, blocked on A3 & cash confirm
    api.setSession(bar)
    const barOpen = await paymentApi.listOpen()
    const barSummary = barOpen.find((b) => b.code === "BAR01")
    if (!barSummary) throw new Error("BAR01 missing from open bills")
    if (barOpen.some((b) => b.code === "A3")) throw new Error("BAR listOpen must exclude A3")
    const barPreview = await paymentApi.previewBill(barSummary.visitId)
    if ("billCode" in barPreview) throw new Error("previewBill must not include billCode")
    const barIssued = await paymentApi.issueInvoice(barSummary.visitId, barPreview.version, "e2e-w1-bar-inv")
    let barBlocked = false
    try {
      await paymentApi.confirmCash(
        barSummary.visitId,
        barIssued.dueVnd,
        barIssued.version,
        "e2e-w1-bar-pay",
        barIssued.billCode,
      )
    } catch (e) {
      barBlocked = e?.code === "PERMISSION_DENIED" && e?.status === 403
    }
    if (!barBlocked) throw new Error("BAR was not blocked 403 from confirmCash")

    const a3VisitId = await mockCtrl.visitIdForTable("A3")
    let barA3Blocked = false
    try {
      await paymentApi.previewBill(a3VisitId)
    } catch (e) {
      barA3Blocked = e?.code === "PERMISSION_DENIED" && e?.status === 403
    }
    if (!barA3Blocked) throw new Error("BAR was not blocked 403 from A3 previewBill")

    // V12 + NA45H-05 multi-bill on A3: issue bill 1 -> order round 2 (returns to SERVING) -> issue bill 2 -> pay bill 1 -> table stays seated -> pay bill 2 -> table free
    api.setSession(waiter)
    const a3Serving = await paymentApi.getBill(a3VisitId)
    const a3Bill1 = await paymentApi.issueInvoice(a3VisitId, a3Serving.version, "e2e-w1-a3-inv1")
    const afterRound2 = mockCtrl.addOrderLines(a3VisitId, [
      { name: "Mojito", unit: "Ly", qty: 1, unitPriceVnd: 100_000 },
    ])
    if (afterRound2.status !== "SERVING")
      throw new Error(`Expected A3 back to SERVING after order round 2, got ${afterRound2.status}`)
    const a3Preview2 = await paymentApi.previewBill(a3VisitId)
    if (a3Preview2.dueVnd !== 110_000) throw new Error(`Expected round 2 preview 110000, got ${a3Preview2.dueVnd}`)
    const a3Bill2 = await paymentApi.issueInvoice(a3VisitId, a3Preview2.version, "e2e-w1-a3-inv2")

    api.setSession(cashier)
    const catalog = await api.getCatalog()
    const tableIdOf = (code) => catalog.tables.find((t) => t.code === code).id

    await paymentApi.confirmCash(a3VisitId, a3Bill1.dueVnd, a3Bill2.version, "e2e-w1-a3-pay1", a3Bill1.billCode)
    const midSession = await paymentApi.getSessionBills(a3VisitId)
    const midFloorA3 = (await api.getFloorState(clock.now())).tables.find((t) => t.tableId === tableIdOf("A3")).state
    if (midSession.status !== "AWAITING_PAYMENT" || midFloorA3 !== "seated") {
      throw new Error(
        `Expected A3 still AWAITING_PAYMENT/seated after bill 1 pay, got ${midSession.status}/${midFloorA3}`,
      )
    }
    await paymentApi.confirmTransfer(a3VisitId, false, midSession.version, "e2e-w1-a3-pay2", a3Bill2.billCode)
    const endFloorA3 = (await api.getFloorState(clock.now())).tables.find((t) => t.tableId === tableIdOf("A3")).state
    if (endFloorA3 !== "free") throw new Error(`Expected A3 free after all bills paid, got ${endFloorA3}`)

    // NA45H-01 + NA45H-12 + NA45H-11: cancelPaid on A3 succeeds even with seeded future bd+2 HOLD,
    // returns CancelEffect, and populates cancelHistory with recollectedAt on re-collection
    const receptionist = byRole("RECEPTIONIST")
    api.setSession(receptionist)
    const paidBills = await paymentApi.listPaidBills()
    if (!paidBills.some((b) => b.billCode === a3Bill2.billCode)) {
      throw new Error("listPaidBills missing A3 bill2")
    }
    const a3DirectEffect = await paymentApi.cancelPaid(a3Bill2.billCode, "E2E NA45H-01 reopen A3 despite future HOLD")
    if (!a3DirectEffect.sessionReopened || a3DirectEffect.closedTurnsDelta !== -1) {
      throw new Error(`Expected reopen CancelEffect on A3, got ${JSON.stringify(a3DirectEffect)}`)
    }
    const reopenedFloorA3 = (await api.getFloorState(clock.now())).tables.find(
      (t) => t.tableId === tableIdOf("A3"),
    ).state
    if (reopenedFloorA3 !== "seated") throw new Error(`Expected A3 reopened to seated, got ${reopenedFloorA3}`)
    api.setSession(cashier)
    const a3AfterDirect = await paymentApi.getSessionBills(a3VisitId)
    const a3Bill2Unpaid = a3AfterDirect.bills.find((b) => b.billCode === a3Bill2.billCode)
    if (a3Bill2Unpaid?.cancelHistory?.[0]?.kind !== "DIRECT" || a3Bill2Unpaid?.cancelHistory?.[0]?.recollectedAt) {
      throw new Error(`Unexpected cancelHistory after direct cancel: ${JSON.stringify(a3Bill2Unpaid?.cancelHistory)}`)
    }
    await paymentApi.confirmCash(a3VisitId, a3Bill2.dueVnd, a3AfterDirect.version, "e2e-w1-a3-repay2", a3Bill2.billCode)
    const a3Bill2Repaid = (await paymentApi.getSessionBills(a3VisitId)).bills.find(
      (b) => b.billCode === a3Bill2.billCode,
    )
    if (!a3Bill2Repaid?.cancelHistory?.[0]?.recollectedAt) {
      throw new Error(
        `Missing recollectedAt on A3 bill2 after re-collection: ${JSON.stringify(a3Bill2Repaid?.cancelHistory)}`,
      )
    }

    // D2 + NA45H-02 + NA45H-03 + NA45H-04 cancel flow on A2
    api.setSession(cashier)
    const a2VisitId = await mockCtrl.visitIdForTable("A2")
    const a2Serving = await paymentApi.getBill(a2VisitId)
    const a2Bill = await paymentApi.issueInvoice(a2VisitId, a2Serving.version, "e2e-w1-a2-inv")
    await paymentApi.confirmCash(a2VisitId, a2Bill.dueVnd, a2Bill.version, "e2e-w1-a2-pay", a2Bill.billCode)

    let cashierDirectDenied = false
    try {
      await paymentApi.cancelPaid(a2Bill.billCode, "Test block")
    } catch (e) {
      cashierDirectDenied = e?.code === "PERMISSION_DENIED" && e?.status === 403
    }
    if (!cashierDirectDenied) throw new Error("Cashier cancelPaid was not denied with 403")

    const events = []
    const unsub = api.subscribe((ev) => events.push(ev.action))
    const cancelReq = await paymentApi.requestCancel(a2Bill.billCode, "Khách đổi sang QR")
    const myReqs = await paymentApi.listMyCancelRequests(a2Bill.billCode)
    if (myReqs[0]?.status !== "PENDING") throw new Error("Cashier listMyCancelRequests missing PENDING")
    api.setSession(admin)
    const adminQueue = await paymentApi.listCancelRequests()
    if (!adminQueue.some((r) => r.id === cancelReq.id && r.status === "PENDING")) {
      throw new Error("Admin queue missing PENDING cancel request")
    }
    const approved = await paymentApi.decideCancel(cancelReq.id, true, "Duyệt hủy")
    unsub()
    if (!approved.effect?.sessionReopened || approved.effect?.closedTurnsDelta !== -1) {
      throw new Error(`Expected approved CancelEffect on A2, got ${JSON.stringify(approved.effect)}`)
    }
    if (!events.includes("PAYMENT_CANCEL_REQUESTED") || !events.includes("PAYMENT_CANCELLED")) {
      throw new Error(`Missing cancel change events: ${events.join(",")}`)
    }
    api.setSession(cashier)
    const myApproved = await paymentApi.listMyCancelRequests(a2Bill.billCode)
    if (myApproved[0]?.status !== "APPROVED") throw new Error("Cashier listMyCancelRequests missing APPROVED")
    const a2ReopenedBill = await paymentApi.getBill(a2VisitId)
    if (
      a2ReopenedBill.cancelHistory?.[0]?.kind !== "APPROVED" ||
      a2ReopenedBill.cancelHistory?.[0]?.decisionNote !== "Duyệt hủy"
    ) {
      throw new Error(`Missing APPROVED cancelHistory on A2: ${JSON.stringify(a2ReopenedBill.cancelHistory)}`)
    }
    const a2ReopenedFloor = (await api.getFloorState(clock.now())).tables.find(
      (t) => t.tableId === tableIdOf("A2"),
    ).state
    const audit = await paymentApi.listAudit(a2Bill.billCode)
    const approvedAudit = audit.find((e) => e.action === "CANCEL_APPROVED")
    if (!approvedAudit || approvedAudit.reason !== "Khách đổi sang QR" || approvedAudit.decisionNote !== "Duyệt hủy") {
      throw new Error(`Unexpected CANCEL_APPROVED audit entry: ${JSON.stringify(approvedAudit)}`)
    }
    const syncBytes = localStorage.getItem("21gam.mock.sync.v1")?.length ?? 0

    return {
      barBillCode: barIssued.billCode,
      a3BillCodes: [a3Bill1.billCode, a3Bill2.billCode],
      a2CancelStatus: approved.status,
      a2ReopenedFloor,
      auditCount: audit.length,
      syncBytes,
    }
  })

  assert.equal(result.a2CancelStatus, "APPROVED")
  assert.equal(result.a2ReopenedFloor, "seated")
  assert.equal(result.a3BillCodes.length, 2)
  assert.ok(result.auditCount >= 4)
  assert.ok(result.syncBytes > 0, "Expected mock sync snapshot persisted in localStorage")
  assert.deepEqual(errors, [])

  // NA45H-10 cross-window real-time sync check: two separate pages at the same origin
  // Page A = Admin on /cancel-payment, Page B = Cashier on /payment
  const syncContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  try {
    const adminPage = await syncContext.newPage()
    const cashierPage = await syncContext.newPage()
    const syncErrors = []
    for (const p of [adminPage, cashierPage]) {
      p.on("pageerror", (err) => syncErrors.push(`pageerror: ${err.message}`))
      p.on("console", (msg) => {
        if (msg.type() === "error") syncErrors.push(`console.error: ${msg.text()}`)
      })
    }

    await adminPage.addInitScript(() => {
      localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 7, theme: "light" }))
    })
    await adminPage.goto(`${BASE_URL}/cancel-payment`, { waitUntil: "networkidle" })
    await expect(adminPage.getByRole("heading", { name: "Duyệt huỷ thanh toán" }).first()).toBeVisible()
    await expect(adminPage.getByText("Chờ duyệt (0)")).toBeVisible()

    await cashierPage.addInitScript(() => {
      localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 5, theme: "light" }))
    })
    await cashierPage.goto(`${BASE_URL}/payment`, { waitUntil: "networkidle" })

    const a2Session = cashierPage.locator(".pay-sess", { hasText: "A2" })
    await a2Session.click()
    await a2Session.click()
    await cashierPage.getByRole("button", { name: "Xuất hóa đơn" }).click()
    await cashierPage.getByRole("button", { name: /^Thu tiền/ }).click()
    await cashierPage.getByRole("button", { name: /Tiền mặt/ }).click()
    await cashierPage.locator(".pay-chips .pay-chip").first().click()
    await cashierPage.getByRole("button", { name: /Xác nhận đã nhận/ }).click()
    await expect(cashierPage.getByRole("heading", { name: "Đã thanh toán" })).toBeVisible()

    // Open A2 paid bill detail in Cashier window & submit cancel request
    await cashierPage.getByRole("button", { name: /Thông báo thanh toán/ }).click()
    await cashierPage.locator(".pay-ntf", { hasText: "Đã thanh toán" }).first().click()
    await cashierPage.getByRole("button", { name: "Gửi yêu cầu huỷ" }).click()
    await cashierPage.getByLabel("Lý do gửi yêu cầu huỷ (bắt buộc)").fill("Cross-window sync test")
    await cashierPage.getByRole("button", { name: "Xác nhận gửi yêu cầu huỷ" }).click()
    await expect(cashierPage.getByText(/Đang chờ duyệt \(PENDING\)/)).toBeVisible()

    // Admin window receives request automatically WITHOUT reload, refresh, or role switch
    await expect(adminPage.getByText("Chờ duyệt (1)")).toBeVisible({ timeout: 3000 })
    await expect(adminPage.getByText("Cross-window sync test").first()).toBeVisible({ timeout: 3000 })

    // Admin approves -> Cashier window receives APPROVED decision automatically WITHOUT reload
    await adminPage.getByLabel("Ghi chú phản hồi (tuỳ chọn)").first().fill("Admin duyệt sync")
    await adminPage.getByRole("button", { name: "Duyệt huỷ", exact: true }).first().click()
    await expect(cashierPage.getByText(/Đã duyệt huỷ \(APPROVED\)/)).toBeVisible({ timeout: 3000 })
    await expect(cashierPage.getByText(/Admin duyệt sync/)).toBeVisible({ timeout: 3000 })
    assert.deepEqual(syncErrors, [])
  } finally {
    await syncContext.close()
  }

  // NA45H-17 Boss "Kiểm lại" interleaving: two concurrent Cashier windows at same origin
  // + open Admin window + newly opened Admin window, plus same-bill single-PENDING verification.
  const raceContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  try {
    const cashierPageA = await raceContext.newPage()
    const cashierPageB = await raceContext.newPage()
    const adminOpenPage = await raceContext.newPage()
    const raceErrors = []
    for (const p of [cashierPageA, cashierPageB, adminOpenPage]) {
      p.on("pageerror", (err) => raceErrors.push(`pageerror: ${err.message}`))
      p.on("console", (msg) => {
        if (msg.type() === "error") raceErrors.push(`console.error: ${msg.text()}`)
      })
    }

    await adminOpenPage.addInitScript(() => {
      localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 7, theme: "light" }))
    })
    await adminOpenPage.goto(`${BASE_URL}/cancel-payment`, { waitUntil: "networkidle" })
    await expect(adminOpenPage.getByText("Chờ duyệt (0)")).toBeVisible()

    await cashierPageA.addInitScript(() => {
      localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 5, theme: "light" }))
    })
    await cashierPageA.goto(`${BASE_URL}/payment`, { waitUntil: "networkidle" })
    const setupBills = await cashierPageA.evaluate(async () => {
      const [{ clock, demo }, { paymentApi }] = await Promise.all([
        import("/src/services/index.ts"),
        import("/src/services/payment/index.ts"),
      ])
      demo.reset()
      clock.resetToScenario()
      const open = await paymentApi.listOpen()
      const visitIdOf = (code) => {
        const hit = open.find((b) => b.code === code)
        if (!hit) throw new Error(`Missing open visit for ${code}`)
        return hit.visitId
      }
      const a2Id = visitIdOf("A2")
      const a3Id = visitIdOf("A3")
      const g05Id = visitIdOf("G05")
      const payTable = async (visitId, tag) => {
        const cur = await paymentApi.getBill(visitId)
        const issued = await paymentApi.issueInvoice(visitId, cur.version, `na45h17-${tag}-inv`)
        await paymentApi.confirmCash(visitId, issued.dueVnd, issued.version, `na45h17-${tag}-pay`, issued.billCode)
        return issued.billCode
      }
      const billA2 = await payTable(a2Id, "a2")
      const billA3 = await payTable(a3Id, "a3")
      const billG05 = await payTable(g05Id, "g05")
      return { billA2, billA3, billG05, a2Id, a3Id }
    })

    await cashierPageB.addInitScript(() => {
      localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 5, theme: "light" }))
    })
    await cashierPageB.goto(`${BASE_URL}/payment`, { waitUntil: "networkidle" })

    // Ensure Cashier B also has an older snapshot loaded before both concurrently request cancel
    await cashierPageB.evaluate(async (visitId) => {
      const { paymentApi } = await import("/src/services/payment/index.ts")
      await paymentApi.getBill(visitId)
    }, setupBills.a3Id)

    // Interleave two concurrent requestCancel calls on two different bills across two Cashier windows
    // while holding Cashier A's Web Lock briefly so Cashier B genuinely contends on the cross-tab lock.
    const [resA, resB] = await Promise.all([
      cashierPageA.evaluate(async (billCode) => {
        const origRequest = navigator.locks.request.bind(navigator.locks)
        navigator.locks.request = (name, ...args) => {
          const cb = args[args.length - 1]
          const opts = args.length > 1 ? args[0] : undefined
          const wrapped = async (lock) => {
            const out = await cb(lock)
            await new Promise((r) => setTimeout(r, 150))
            return out
          }
          return opts ? origRequest(name, opts, wrapped) : origRequest(name, wrapped)
        }
        try {
          const { paymentApi } = await import("/src/services/payment/index.ts")
          return await paymentApi.requestCancel(billCode, "Concurrent cancel A2")
        } finally {
          navigator.locks.request = origRequest
        }
      }, setupBills.billA2),
      cashierPageB.evaluate(async (billCode) => {
        const { paymentApi } = await import("/src/services/payment/index.ts")
        return await paymentApi.requestCancel(billCode, "Concurrent cancel A3")
      }, setupBills.billA3),
    ])

    assert.equal(resA.status, "PENDING")
    assert.equal(resB.status, "PENDING")
    assert.notEqual(resA.id, resB.id, "Two concurrent requests must allocate distinct IDs")

    // Open Admin window sees both PENDING requests without reload
    await expect(adminOpenPage.getByText("Chờ duyệt (2)")).toBeVisible({ timeout: 3000 })
    await expect(adminOpenPage.getByText("Concurrent cancel A2").first()).toBeVisible({ timeout: 3000 })
    await expect(adminOpenPage.getByText("Concurrent cancel A3").first()).toBeVisible({ timeout: 3000 })

    // Newly opened Admin window reads storage and sees both requests + both audit rows
    const adminNewPage = await raceContext.newPage()
    adminNewPage.on("pageerror", (err) => raceErrors.push(`pageerror: ${err.message}`))
    adminNewPage.on("console", (msg) => {
      if (msg.type() === "error") raceErrors.push(`console.error: ${msg.text()}`)
    })
    await adminNewPage.addInitScript(() => {
      localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 7, theme: "light" }))
    })
    await adminNewPage.goto(`${BASE_URL}/cancel-payment`, { waitUntil: "networkidle" })
    await expect(adminNewPage.getByText("Chờ duyệt (2)")).toBeVisible({ timeout: 3000 })

    const newAdminData = await adminNewPage.evaluate(async () => {
      const { paymentApi } = await import("/src/services/payment/index.ts")
      const [queue, audit] = await Promise.all([paymentApi.listCancelRequests(), paymentApi.listAudit()])
      return {
        pendingIds: queue.filter((r) => r.status === "PENDING").map((r) => r.id),
        cancelReqAuditBills: audit.filter((e) => e.action === "CANCEL_REQUESTED").map((e) => e.billCode),
      }
    })
    assert.equal(newAdminData.pendingIds.length, 2)
    assert.ok(newAdminData.pendingIds.includes(resA.id) && newAdminData.pendingIds.includes(resB.id))
    assert.equal(newAdminData.cancelReqAuditBills.length, 2)
    assert.ok(
      newAdminData.cancelReqAuditBills.includes(setupBills.billA2) &&
        newAdminData.cancelReqAuditBills.includes(setupBills.billA3),
    )

    // Same-bill control: two windows concurrently request cancel for the same bill -> only one PENDING
    const sameBillCalls = await Promise.all([
      cashierPageA.evaluate(async (billCode) => {
        const { paymentApi } = await import("/src/services/payment/index.ts")
        try {
          const req = await paymentApi.requestCancel(billCode, "Same bill A")
          return { ok: true, id: req.id, status: req.status }
        } catch (err) {
          return { ok: false, code: err?.code, status: err?.status }
        }
      }, setupBills.billG05),
      cashierPageB.evaluate(async (billCode) => {
        const { paymentApi } = await import("/src/services/payment/index.ts")
        try {
          const req = await paymentApi.requestCancel(billCode, "Same bill B")
          return { ok: true, id: req.id, status: req.status }
        } catch (err) {
          return { ok: false, code: err?.code, status: err?.status }
        }
      }, setupBills.billG05),
    ])
    const sameOk = sameBillCalls.filter((x) => x.ok)
    const sameErr = sameBillCalls.filter((x) => !x.ok)
    assert.equal(sameOk.length, 1, `Expected 1 success for same bill, got ${JSON.stringify(sameBillCalls)}`)
    assert.equal(sameErr.length, 1)
    assert.equal(sameErr[0].code, "INVALID_STATE")
    assert.equal(sameErr[0].status, 409)
    await expect(adminNewPage.getByText("Chờ duyệt (3)")).toBeVisible({ timeout: 3000 })
    assert.deepEqual(raceErrors, [])
  } finally {
    await raceContext.close()
  }

  console.log("payment-w1 PASS:", JSON.stringify(result))
} finally {
  await browser?.close()
  await viteServer?.close()
}

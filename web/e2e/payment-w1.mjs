// E2E verification for W1 (HU-44 v1.1 mock backend behavior, D1 Bartender permissions, V12 multi-bill, D2 cancel & audit).
// Runs programmatic Vite on port 43941 without touching dev server on 5173.
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { chromium } from "@playwright/test"
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

    // Bartender previews and issues invoice on BAR01, blocked on cash confirm
    api.setSession(bar)
    const barOpen = await paymentApi.listOpen()
    const barSummary = barOpen.find((b) => b.code === "BAR01")
    if (!barSummary) throw new Error("BAR01 missing from open bills")
    const barPreview = await paymentApi.previewBill(barSummary.visitId)
    if ("billCode" in barPreview) throw new Error("previewBill must not include billCode")
    const barIssued = await paymentApi.issueInvoice(barSummary.visitId, barPreview.version, "e2e-w1-bar-inv")
    let barBlocked = false
    try {
      await paymentApi.confirmCash(barSummary.visitId, barIssued.dueVnd, barIssued.version, "e2e-w1-bar-pay", barIssued.billCode)
    } catch (e) {
      barBlocked = e?.code === "PERMISSION_DENIED" && e?.status === 403
    }
    if (!barBlocked) throw new Error("BAR was not blocked 403 from confirmCash")

    // V12 multi-bill on A3: issue bill 1 -> order round 2 -> issue bill 2 -> pay bill 1 -> table stays seated -> pay bill 2 -> table free
    api.setSession(waiter)
    const a3VisitId = await mockCtrl.visitIdForTable("A3")
    const a3Serving = await paymentApi.getBill(a3VisitId)
    const a3Bill1 = await paymentApi.issueInvoice(a3VisitId, a3Serving.version, "e2e-w1-a3-inv1")
    mockCtrl.addOrderLines(a3VisitId, [{ name: "Mojito", unit: "Ly", qty: 1, unitPriceVnd: 100_000 }])
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
      throw new Error(`Expected A3 still AWAITING_PAYMENT/seated after bill 1 pay, got ${midSession.status}/${midFloorA3}`)
    }
    await paymentApi.confirmTransfer(a3VisitId, false, midSession.version, "e2e-w1-a3-pay2", a3Bill2.billCode)
    const endFloorA3 = (await api.getFloorState(clock.now())).tables.find((t) => t.tableId === tableIdOf("A3")).state
    if (endFloorA3 !== "free") throw new Error(`Expected A3 free after all bills paid, got ${endFloorA3}`)

    // D2 cancel flow on A2
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

    const cancelReq = await paymentApi.requestCancel(a2Bill.billCode, "Khách đổi sang QR")
    api.setSession(admin)
    const adminQueue = await paymentApi.listCancelRequests()
    if (!adminQueue.some((r) => r.id === cancelReq.id && r.status === "PENDING")) {
      throw new Error("Admin queue missing PENDING cancel request")
    }
    const approved = await paymentApi.decideCancel(cancelReq.id, true, "Duyệt hủy")
    const a2ReopenedFloor = (await api.getFloorState(clock.now())).tables.find((t) => t.tableId === tableIdOf("A2")).state
    const audit = await paymentApi.listAudit(a2Bill.billCode)

    return {
      barBillCode: barIssued.billCode,
      a3BillCodes: [a3Bill1.billCode, a3Bill2.billCode],
      a2CancelStatus: approved.status,
      a2ReopenedFloor,
      auditCount: audit.length,
    }
  })

  assert.equal(result.a2CancelStatus, "APPROVED")
  assert.equal(result.a2ReopenedFloor, "seated")
  assert.equal(result.a3BillCodes.length, 2)
  assert.ok(result.auditCount >= 4)
  assert.deepEqual(errors, [])

  console.log("payment-w1 PASS:", JSON.stringify(result))
} finally {
  await browser?.close()
  await viteServer?.close()
}

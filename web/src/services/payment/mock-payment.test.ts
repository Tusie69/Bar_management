import { beforeEach, describe, expect, it } from "vitest"
import { addDays, businessDateOf } from "@/lib/time"
import { api, clock, demo } from "@/services"
import type { MockDb } from "@/services/mock/db"
import { createInMemoryMockSyncTransport } from "@/services/mock/mock-sync"
import { DEMO_USERS } from "@/services/mock/seed"
import { MockGamApi } from "@/services/mock/server"
import { isPaymentAvailable, paymentApi } from "./index"
import { addPaymentOrderLines, setPaymentMockFault } from "./mock-payment"

const receptionist = DEMO_USERS.find((u) => u.role === "RECEPTIONIST")!
const cashier = DEMO_USERS.find((u) => u.role === "CASHIER")!
const waiter = DEMO_USERS.find((u) => u.role === "WAITER")!
const bar = DEMO_USERS.find((u) => u.role === "BAR")!
const admin = DEMO_USERS.find((u) => u.role === "ADMIN")!
const owner = DEMO_USERS.find((u) => u.role === "OWNER")!
const customerCare = DEMO_USERS.find((u) => u.role === "CUSTOMER_CARE")!

async function visitIdByCode(code: string): Promise<string> {
  const list = await paymentApi.listOpen()
  const hit = list.find((b) => b.code === code)
  if (!hit) throw new Error(`Missing open bill for ${code}`)
  return hit.visitId
}

async function turnsForVisit(visitId: string, restoreTo = cashier) {
  const today = businessDateOf(clock.now())
  api.setSession(admin)
  const turns = await api.getTableTurns({ from: today, to: today, includeUncounted: true })
  api.setSession(restoreTo)
  return turns.turns.find((t) => t.visitId === Number(visitId))
}

describe("mockPaymentApi", () => {
  beforeEach(() => {
    clock.resetToScenario()
    demo?.reset()
    api.setSession(cashier)
  })

  it("exports availability flag true in mock mode and binds 1:1 to real floor visit IDs", async () => {
    expect(isPaymentAvailable).toBe(true)

    const list = await paymentApi.listOpen()
    // G02 (AWAITING_PAYMENT) first, G04 (requestedAt) second, then SERVING visits in seed order
    expect(list.map((x) => x.code)).toEqual(["G02", "G04", "A3", "G05", "A2", "G06", "BAR01"])
    expect(list[0].clusterCode).toBe("G02")
    expect(list[0].tables).toEqual(["B11", "B12"])
    expect(list[0].dueVnd).toBe(3_044_000)

    // Verify A3 uses the exact same numeric visitId as floorState / Waiter
    const catalog = await api.getCatalog()
    const a3TableId = catalog.tables.find((t) => t.code === "A3")!.id
    const floor = await api.getFloorState(clock.now())
    const a3Claim = floor.tables.find((t) => t.tableId === a3TableId)?.claim
    const a3Bill = list.find((b) => b.code === "A3")!
    expect(a3Bill.visitId).toBe(String(a3Claim?.visitId))
    expect(Number.isSafeInteger(Number(a3Bill.visitId))).toBe(true)
  })

  it("shows honest empty lines and hasOrderLines=false for seeded or newly created visits without mock order lines", async () => {
    const list = await paymentApi.listOpen()
    expect(list.find((b) => b.code === "A3")?.hasOrderLines).toBe(true)
    expect(list.find((b) => b.code === "G06")?.hasOrderLines).toBe(false)

    const g06Id = await visitIdByCode("G06")
    const g06Bill = await paymentApi.getBill(g06Id)
    expect(g06Bill.lines).toEqual([])
    expect(g06Bill.dueVnd).toBe(0)

    api.setSession(receptionist)
    const catalog = await api.getCatalog()
    const c1 = catalog.tables.find((t) => t.code === "C1")!
    const seated = await api.seatWalkIn({ tableIds: [c1.id], guestCount: 2, contactName: "Khách mới" })
    api.setSession(cashier)
    const newBill = await paymentApi.getBill(String(seated.visitId))
    expect(newBill.lines).toEqual([])
    expect(newBill.dueVnd).toBe(0)
    const afterList = await paymentApi.listOpen()
    expect(afterList.find((b) => b.visitId === String(seated.visitId))?.hasOrderLines).toBe(false)
  })

  it("transitions SERVING -> AWAITING_PAYMENT on createPrebill without recording money", async () => {
    const a3Id = await visitIdByCode("A3")
    const before = await paymentApi.getBill(a3Id)
    expect(before.status).toBe("SERVING")
    const after = await paymentApi.createPrebill(a3Id, before.version)
    expect(after.status).toBe("AWAITING_PAYMENT")
    expect(after.version).toBe(before.version + 1)
  })

  it("allows WAITER (PA-A) to request payment on the same visit and rejects Cash & Transfer with 403", async () => {
    const a3Id = await visitIdByCode("A3")
    api.setSession(waiter)
    await paymentApi.requestPayment(a3Id)

    api.setSession(cashier)
    const bill = await paymentApi.getBill(a3Id)
    expect(bill.requestedAt).toBeTruthy()
    expect(bill.status).toBe("AWAITING_PAYMENT")

    api.setSession(waiter)
    await expect(paymentApi.confirmCash(a3Id, bill.dueVnd, bill.version, "k-waiter-cash")).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      status: 403,
    })
    await expect(paymentApi.confirmTransfer(a3Id, true, bill.version, "k-waiter-qr")).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      status: 403,
    })
  })

  it("blocks RECEPTIONIST from payment reads/writes", async () => {
    api.setSession(receptionist)
    await expect(paymentApi.listOpen()).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      status: 403,
    })
  })

  it("requires prebill (AWAITING_PAYMENT) before confirming and handles VERSION_CONFLICT without marking PAID", async () => {
    const a3Id = await visitIdByCode("A3")
    const serving = await paymentApi.getBill(a3Id)
    expect(serving.status).toBe("SERVING")

    await expect(paymentApi.confirmCash(a3Id, serving.dueVnd, serving.version, "k-no-prebill")).rejects.toMatchObject({
      code: "INVALID_STATE",
      status: 409,
    })

    const prebill = await paymentApi.createPrebill(a3Id, serving.version)
    expect(prebill.status).toBe("AWAITING_PAYMENT")

    // Stale version fails with VERSION_CONFLICT and keeps bill AWAITING_PAYMENT
    await expect(paymentApi.confirmCash(a3Id, prebill.dueVnd, serving.version, "k-stale-ver")).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
      status: 409,
    })
    const stillWaiting = await paymentApi.getBill(a3Id)
    expect(stillWaiting.status).toBe("AWAITING_PAYMENT")
  })

  it("enforces idempotency replay vs IDEMPOTENCY_CONFLICT and releases floor table on confirm", async () => {
    const g04Id = await visitIdByCode("G04")
    const serving = await paymentApi.getBill(g04Id)
    const bill = await paymentApi.createPrebill(g04Id, serving.version)
    const rc1 = await paymentApi.confirmCash(g04Id, 400_000, bill.version, "cash-key-1")
    expect(rc1.method).toBe("CASH")
    expect(rc1.givenVnd).toBe(400_000)
    expect(rc1.changeVnd).toBe(400_000 - 351_000)

    // Exact same parameters replay same receipt
    const replay = await paymentApi.confirmCash(g04Id, 400_000, bill.version, "cash-key-1")
    expect(replay).toEqual(rc1)

    // Same key with different payload throws IDEMPOTENCY_CONFLICT and does not mutate any other bill
    const a3Id = await visitIdByCode("A3")
    await expect(paymentApi.confirmCash(g04Id, 500_000, bill.version, "cash-key-1")).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
      status: 409,
    })
    await expect(paymentApi.confirmTransfer(g04Id, true, bill.version, "cash-key-1")).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
      status: 409,
    })
    await expect(paymentApi.confirmCash(a3Id, 400_000, 1, "cash-key-1")).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
      status: 409,
    })
    expect((await paymentApi.getBill(a3Id)).status).toBe("SERVING")

    // New key on already paid bill throws DUPLICATE_PAYMENT
    await expect(paymentApi.confirmCash(g04Id, 400_000, bill.version + 1, "cash-key-2")).rejects.toMatchObject({
      code: "DUPLICATE_PAYMENT",
      status: 409,
    })

    // Both payment open list and floor state show tables released
    const open = await paymentApi.listOpen()
    expect(open.find((x) => x.visitId === g04Id)).toBeUndefined()
    const catalog = await api.getCatalog()
    const idOf = (code: string) => catalog.tables.find((t) => t.code === code)!.id
    const floor = await api.getFloorState(clock.now())
    expect(floor.tables.find((t) => t.tableId === idOf("B6"))?.state).toBe("free")
    expect(floor.tables.find((t) => t.tableId === idOf("B8"))?.state).toBe("spare")

    const ntfs = await paymentApi.listNotifications()
    expect(ntfs.filter((n) => n.type === "PAID" && n.visitId === g04Id)).toHaveLength(1)
  })

  it("treats a visit released without payment as CLOSED_UNPAID (never PAID or DUPLICATE_PAYMENT)", async () => {
    const a3Id = await visitIdByCode("A3")
    const a3 = await paymentApi.getBill(a3Id)

    api.setSession(receptionist)
    await api.endVisit(Number(a3Id), a3.version)

    api.setSession(cashier)
    const closed = await paymentApi.getBill(a3Id)
    expect(closed.status).toBe("CLOSED_UNPAID")
    expect(closed.paidAt).toBeUndefined()
    expect(closed.paidBy).toBeUndefined()

    const open = await paymentApi.listOpen()
    expect(open.find((x) => x.visitId === a3Id)).toBeUndefined()

    await expect(paymentApi.createPrebill(a3Id, closed.version)).rejects.toMatchObject({
      code: "INVALID_STATE",
      status: 409,
    })
    await expect(paymentApi.confirmCash(a3Id, closed.dueVnd, closed.version, "k-unpaid-1")).rejects.toMatchObject({
      code: "INVALID_STATE",
      status: 409,
    })
    await expect(paymentApi.confirmTransfer(a3Id, true, closed.version, "k-unpaid-2")).rejects.toMatchObject({
      code: "INVALID_STATE",
      status: 409,
    })

    const ntfs = await paymentApi.listNotifications()
    expect(ntfs.some((n) => n.type === "PAID" && n.visitId === a3Id)).toBe(false)
  })

  it("restores a released visit to SERVING after undo and back to CLOSED_UNPAID after redo even if its bill was opened while closed (NA45-14)", async () => {
    api.setSession(receptionist)
    const catalog = await api.getCatalog()
    const c1 = catalog.tables.find((t) => t.code === "C1")!
    const seated = await api.seatWalkIn({ tableIds: [c1.id], guestCount: 2, contactName: "Khách hoàn tác" })
    const visitId = String(seated.visitId)
    const seatedFloor = await api.getFloorState(clock.now())
    const visitVersion = seatedFloor.tables.find((t) => t.tableId === c1.id)!.claim!.version

    // Release WITHOUT opening the bill first, then open the bill while closed.
    const ended = await api.endVisit(seated.visitId, visitVersion)
    api.setSession(cashier)
    const closed = await paymentApi.getBill(visitId)
    expect(closed.status).toBe("CLOSED_UNPAID")
    expect((await paymentApi.listOpen()).find((x) => x.visitId === visitId)).toBeUndefined()

    // Undo restores the live visit on floor and in S1/getBill.
    api.setSession(receptionist)
    const undone = await api.undo(ended.operationId!)
    const floorAfterUndo = await api.getFloorState(clock.now())
    expect(floorAfterUndo.tables.find((t) => t.tableId === c1.id)?.state).toBe("seated")

    api.setSession(cashier)
    const openAfterUndo = await paymentApi.listOpen()
    expect(openAfterUndo.find((x) => x.visitId === visitId)).toMatchObject({
      code: "C1",
      status: "SERVING",
      hasOrderLines: false,
    })
    expect((await paymentApi.getBill(visitId)).status).toBe("SERVING")

    // Redo hides the visit from S1 and derives CLOSED_UNPAID again.
    api.setSession(receptionist)
    await api.redo(undone.operationId!)
    api.setSession(cashier)
    expect((await paymentApi.listOpen()).find((x) => x.visitId === visitId)).toBeUndefined()
    expect((await paymentApi.getBill(visitId)).status).toBe("CLOSED_UNPAID")
  })

  it("does not allow dup fault to finalize a SERVING bill before prebill/version/line guards", async () => {
    const a2Id = await visitIdByCode("A2")
    const serving = await paymentApi.getBill(a2Id)
    expect(serving.status).toBe("SERVING")

    setPaymentMockFault({ nextConfirm: "dup" })
    await expect(paymentApi.confirmCash(a2Id, serving.dueVnd, serving.version, "k-dup-serving")).rejects.toMatchObject({
      code: "INVALID_STATE",
      status: 409,
    })

    const stillServing = await paymentApi.getBill(a2Id)
    expect(stillServing.status).toBe("SERVING")
    const catalog = await api.getCatalog()
    const a2TableId = catalog.tables.find((t) => t.code === "A2")!.id
    const floor = await api.getFloorState(clock.now())
    expect(floor.tables.find((t) => t.tableId === a2TableId)?.state).toBe("seated")
    const ntfs = await paymentApi.listNotifications()
    expect(ntfs.some((n) => n.type === "PAID" && n.visitId === a2Id)).toBe(false)

    // After prebill, dup fault does finalize and return DUPLICATE_PAYMENT
    const prebill = await paymentApi.createPrebill(a2Id, stillServing.version)
    setPaymentMockFault({ nextConfirm: "dup" })
    await expect(paymentApi.confirmTransfer(a2Id, true, prebill.version, "k-dup-after-prebill")).rejects.toMatchObject({
      code: "DUPLICATE_PAYMENT",
      status: 409,
    })
    expect((await paymentApi.getBill(a2Id)).status).toBe("PAID")
  })

  it("simulates network error without recording money and dup 409 fault with full finalization + table release", async () => {
    const barId = await visitIdByCode("BAR01")
    const serving = await paymentApi.getBill(barId)
    const bill = await paymentApi.createPrebill(barId, serving.version)

    setPaymentMockFault({ nextConfirm: "net" })
    await expect(paymentApi.confirmCash(barId, bill.dueVnd, bill.version, "k-net-1")).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    })
    const stillOpen = await paymentApi.getBill(barId)
    expect(stillOpen.status).toBe("AWAITING_PAYMENT")

    setPaymentMockFault({ nextConfirm: "dup" })
    await expect(paymentApi.confirmTransfer(barId, true, bill.version, "k-dup-1")).rejects.toMatchObject({
      code: "DUPLICATE_PAYMENT",
      status: 409,
    })
    const nowPaid = await paymentApi.getBill(barId)
    expect(nowPaid.status).toBe("PAID")

    // Dup fault also released BAR01 on the floor and recorded exactly 1 PAID notification
    const catalog = await api.getCatalog()
    const bar1Id = catalog.tables.find((t) => t.code === "BAR01")!.id
    const floor = await api.getFloorState(clock.now())
    expect(floor.tables.find((t) => t.tableId === bar1Id)?.state).toBe("free")
    const ntfs = await paymentApi.listNotifications()
    expect(ntfs.filter((n) => n.type === "PAID" && n.visitId === barId)).toHaveLength(1)
  })

  it("sorts notifications chronologically across midnight (00:01 before 23:59)", async () => {
    const a2Id = await visitIdByCode("A2")
    const a3Id = await visitIdByCode("A3")
    const a2 = await paymentApi.createPrebill(a2Id, (await paymentApi.getBill(a2Id)).version)
    const a3 = await paymentApi.createPrebill(a3Id, (await paymentApi.getBill(a3Id)).version)

    // Clock starts at 21:30 -> +149m = 23:59, then +2m = 00:01 next calendar day
    clock.advance(149)
    await paymentApi.confirmCash(a2Id, a2.dueVnd, a2.version, "k-mid-1")

    clock.advance(2)
    await paymentApi.confirmCash(a3Id, a3.dueVnd, a3.version, "k-mid-2")

    const ntfs = await paymentApi.listNotifications()
    const paidNtfs = ntfs.filter((n) => n.type === "PAID")
    expect(paidNtfs.map((n) => [n.visitId, n.time])).toEqual([
      [a3Id, "00:01"],
      [a2Id, "23:59"],
    ])
  })

  it("TN-02-K3 / VM-04: previewBill computes unbilled totals with no state change or billCode", async () => {
    const a3Id = await visitIdByCode("A3")
    const beforeBill = await paymentApi.getBill(a3Id)
    const beforeNtfs = await paymentApi.listNotifications()

    const preview = await paymentApi.previewBill(a3Id)
    expect(preview).not.toHaveProperty("billCode")
    expect(preview.visitId).toBe(a3Id)
    expect(preview.dueVnd).toBe(beforeBill.dueVnd)
    expect(preview.version).toBe(beforeBill.version)
    expect(preview.lines).toHaveLength(4)

    const afterBill = await paymentApi.getBill(a3Id)
    expect(afterBill.status).toBe("SERVING")
    expect(afterBill.version).toBe(beforeBill.version)
    expect(await paymentApi.listNotifications()).toEqual(beforeNtfs)
    expect(await paymentApi.listAudit()).toHaveLength(0)
  })

  it("TN-01-K6 / D1: issueInvoice (chot bill) supports WAITER, BAR, CASHIER, OWNER, ADMIN, is idempotent, records audit/notification, and never records money", async () => {
    const a3Id = await visitIdByCode("A3")
    const barId = await visitIdByCode("BAR01")

    // RECEPTIONIST and CUSTOMER_CARE are denied issueInvoice
    const a3Serving = await paymentApi.getBill(a3Id)
    api.setSession(receptionist)
    await expect(paymentApi.issueInvoice(a3Id, a3Serving.version, "inv-rec-1")).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      status: 403,
    })
    api.setSession(customerCare)
    await expect(paymentApi.issueInvoice(a3Id, a3Serving.version, "inv-cc-1")).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      status: 403,
    })

    // D1: BAR reads bar bill & issues invoice without having payment.collect
    api.setSession(bar)
    const barOpen = await paymentApi.listOpen()
    expect(barOpen.some((b) => b.visitId === barId)).toBe(true)
    const barPreview = await paymentApi.previewBill(barId)
    expect(barPreview.dueVnd).toBeGreaterThan(0)

    const barIssued = await paymentApi.issueInvoice(barId, barPreview.version, "inv-bar-1")
    expect(barIssued.billStatus).toBe("UNPAID")
    expect(barIssued.status).toBe("AWAITING_PAYMENT")
    expect(barIssued.issuedBy).toBe(bar.displayName)
    expect(barIssued.issuedByRole).toBe("BAR")
    expect(barIssued.paidAt).toBeUndefined()
    expect(barIssued.paidBy).toBeUndefined()

    // Idempotent replay vs conflict
    const barReplay = await paymentApi.issueInvoice(barId, barPreview.version, "inv-bar-1")
    expect(barReplay).toEqual(barIssued)
    await expect(paymentApi.issueInvoice(barId, barPreview.version + 9, "inv-bar-1")).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
      status: 409,
    })

    // BAR still cannot collect money
    await expect(
      paymentApi.confirmCash(barId, barIssued.dueVnd, barIssued.version, "bar-pay-denied", barIssued.billCode),
    ).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      status: 403,
    })

    // Check notification & listOpen metadata & audit as CASHIER
    api.setSession(cashier)
    const ntfs = await paymentApi.listNotifications()
    const invNtf = ntfs.find((n) => n.type === "INVOICE_ISSUED" && n.visitId === barId)
    expect(invNtf).toBeDefined()
    expect(invNtf?.billCode).toBe(barIssued.billCode)
    expect(invNtf?.text).toContain(`Đã đưa hóa đơn · ${bar.displayName} · ${barIssued.issuedAt}`)
    expect(ntfs.some((n) => n.type === "PAID" && n.visitId === barId)).toBe(false)

    const summary = (await paymentApi.listOpen()).find((s) => s.visitId === barId)!
    expect(summary.issuedBy).toBe(bar.displayName)
    expect(summary.issuedAt).toBe(barIssued.issuedAt)
    expect(summary.unpaidBillCount).toBe(1)

    const audit = await paymentApi.listAudit(barIssued.billCode)
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({
      action: "INVOICE_ISSUED",
      billCode: barIssued.billCode,
      visitId: barId,
    })

    // OWNER & ADMIN & WAITER can also issue invoices
    api.setSession(waiter)
    const a2Id = await visitIdByCode("A2")
    const a2Bill = await paymentApi.getBill(a2Id)
    expect((await paymentApi.issueInvoice(a2Id, a2Bill.version, "inv-w-1")).issuedByRole).toBe("WAITER")
  })

  it("V12 / TN-13-K1..K4: supports multiple bills per visit, isolates old bills, keeps tables seated until ALL bills are PAID and no unbilled lines remain", async () => {
    const a3Id = await visitIdByCode("A3")
    const catalog = await api.getCatalog()
    const a3TableId = catalog.tables.find((t) => t.code === "A3")!.id

    expect((await turnsForVisit(a3Id))?.status).toBe("OPEN")

    // Issue Bill 1 as WAITER
    const s0 = await paymentApi.getBill(a3Id)
    api.setSession(waiter)
    const bill1 = await paymentApi.issueInvoice(a3Id, s0.version, "v12-inv-1")
    expect(bill1.billCode).toBe(`B${a3Id.padStart(4, "0")}`)

    // Guest orders extra round after Bill 1 was issued -> NA45H-05: session returns to SERVING while old bill stays UNPAID
    const afterAdd = addPaymentOrderLines(a3Id, [
      { name: "Gin Tonic", unit: "Ly", qty: 2, unitPriceVnd: 150_000, state: "SERVED" },
    ])
    expect(afterAdd.status).toBe("SERVING")
    expect(afterAdd.unbilledLineCount).toBe(1)
    expect(afterAdd.bills).toHaveLength(1)
    expect(afterAdd.bills[0].dueVnd).toBe(bill1.dueVnd)
    const openWhileServing = (await paymentApi.listOpen()).find((s) => s.visitId === a3Id)!
    expect(openWhileServing.status).toBe("SERVING")
    expect(openWhileServing.unpaidBillCount).toBe(1)

    // Preview sees ONLY the new unbilled round
    api.setSession(cashier)
    const round2Preview = await paymentApi.previewBill(a3Id)
    expect(round2Preview.lines).toHaveLength(1)
    expect(round2Preview.lines[0].name).toBe("Gin Tonic")
    expect(round2Preview.dueVnd).toBe(330_000) // 300k + 10% VAT

    // Issue Bill 2 for the new round
    const bill2 = await paymentApi.issueInvoice(a3Id, round2Preview.version, "v12-inv-2")
    expect(bill2.billCode).toBe(`${bill1.billCode}-2`)
    expect(bill2.dueVnd).toBe(330_000)

    const sessionTwoBills = await paymentApi.getSessionBills(a3Id)
    expect(sessionTwoBills.status).toBe("AWAITING_PAYMENT")
    expect(sessionTwoBills.unbilledLineCount).toBe(0)
    expect(sessionTwoBills.bills).toHaveLength(2)
    expect(sessionTwoBills.bills[0].dueVnd).toBe(bill1.dueVnd)
    expect(sessionTwoBills.bills[1].dueVnd).toBe(330_000)

    const openSummaryTwo = (await paymentApi.listOpen()).find((s) => s.visitId === a3Id)!
    expect(openSummaryTwo.unpaidBillCount).toBe(2)

    // Pay Bill 1 (cash): Bill 1 PAID, Bill 2 STILL UNPAID -> visit/table remains seated, no closed turn yet
    const rc1 = await paymentApi.confirmCash(a3Id, bill1.dueVnd, sessionTwoBills.version, "v12-pay-1", bill1.billCode)
    expect(rc1.billCode).toBe(bill1.billCode)

    const midSession = await paymentApi.getSessionBills(a3Id)
    expect(midSession.status).toBe("AWAITING_PAYMENT")
    expect(midSession.bills.map((b) => [b.billCode, b.billStatus])).toEqual([
      [bill1.billCode, "PAID"],
      [bill2.billCode, "UNPAID"],
    ])
    expect((await api.getFloorState(clock.now())).tables.find((t) => t.tableId === a3TableId)?.state).toBe("seated")
    expect((await turnsForVisit(a3Id))?.status).toBe("OPEN")

    // Pay Bill 2 while a new unbilled Round 3 exists: visit STILL remains SERVING and seated!
    addPaymentOrderLines(a3Id, [{ name: "Negroni", unit: "Ly", qty: 1, unitPriceVnd: 180_000, state: "SERVED" }])
    const midWithUnbilled = await paymentApi.getSessionBills(a3Id)
    expect(midWithUnbilled.unbilledLineCount).toBe(1)
    const rc2 = await paymentApi.confirmTransfer(a3Id, false, midWithUnbilled.version, "v12-pay-2")
    expect(rc2.billCode).toBe(bill2.billCode)
    const stillServing = await paymentApi.getSessionBills(a3Id)
    expect(stillServing.status).toBe("SERVING")
    expect(stillServing.bills.every((b) => b.billStatus === "PAID")).toBe(true)
    expect((await api.getFloorState(clock.now())).tables.find((t) => t.tableId === a3TableId)?.state).toBe("seated")

    // Issue & pay Bill 3 -> now all bills PAID AND 0 unbilled lines -> visit closes & floor returns to free
    const bill3Preview = await paymentApi.previewBill(a3Id)
    expect(bill3Preview.dueVnd).toBe(198_000)
    const bill3 = await paymentApi.issueInvoice(a3Id, bill3Preview.version, "v12-inv-3")
    expect(bill3.billCode).toBe(`${bill1.billCode}-3`)
    const rc3 = await paymentApi.confirmCash(a3Id, bill3.dueVnd, bill3.version, "v12-pay-3", bill3.billCode)
    expect(rc3.billCode).toBe(bill3.billCode)

    const doneSession = await paymentApi.getSessionBills(a3Id)
    expect(doneSession.status).toBe("PAID")
    expect(doneSession.bills.every((b) => b.billStatus === "PAID")).toBe(true)
    expect((await paymentApi.listOpen()).find((s) => s.visitId === a3Id)).toBeUndefined()
    expect((await api.getFloorState(clock.now())).tables.find((t) => t.tableId === a3TableId)?.state).toBe("free")

    expect((await turnsForVisit(a3Id))?.status).toBe("CLOSED")
  })

  it("TN-14-K1..K3 / D2: enforces Cashier cancel request -> Admin approve/reject & Receptionist/Admin direct cancel + floor/turn reversal + audit log", async () => {
    const a2Id = await visitIdByCode("A2")
    const catalog = await api.getCatalog()
    const a2TableId = catalog.tables.find((t) => t.code === "A2")!.id

    const initial = await paymentApi.getBill(a2Id)
    const bill = await paymentApi.issueInvoice(a2Id, initial.version, "tn14-inv-1")
    await paymentApi.confirmCash(a2Id, bill.dueVnd, bill.version, "tn14-pay-1", bill.billCode)

    expect((await api.getFloorState(clock.now())).tables.find((t) => t.tableId === a2TableId)?.state).toBe("free")
    expect((await turnsForVisit(a2Id))?.status).toBe("CLOSED")

    // TN-14-K2: CASHIER cannot call cancelPaid (403)
    await expect(paymentApi.cancelPaid(bill.billCode, "Thử hủy trực tiếp")).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      status: 403,
    })

    // Reason is required
    await expect(paymentApi.requestCancel(bill.billCode, "   ")).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      status: 400,
    })

    // CASHIER requests cancel -> PENDING & cancelPending=true
    const req1 = await paymentApi.requestCancel(bill.billCode, "Khách đổi sang chuyển khoản")
    expect(req1.status).toBe("PENDING")
    expect((await paymentApi.getBill(a2Id)).cancelPending).toBe(true)

    // CASHIER cannot decide or read admin cancel request queue
    await expect(paymentApi.listCancelRequests()).rejects.toMatchObject({ code: "PERMISSION_DENIED", status: 403 })
    await expect(paymentApi.decideCancel(req1.id, true)).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      status: 403,
    })

    // ADMIN rejects first -> bill stays PAID & cancelPending cleared
    api.setSession(admin)
    const queue = await paymentApi.listCancelRequests()
    expect(queue.some((r) => r.id === req1.id && r.status === "PENDING")).toBe(true)
    const rejected = await paymentApi.decideCancel(req1.id, false, "Đã đối soát cuối ca")
    expect(rejected.status).toBe("REJECTED")
    const afterReject = await paymentApi.getBill(a2Id)
    expect(afterReject.billStatus).toBe("PAID")
    expect(afterReject.cancelPending).toBe(false)

    // Second request -> ADMIN approves -> bill UNPAID, visit reopens, floor seated, closed turn -1
    api.setSession(cashier)
    const req2 = await paymentApi.requestCancel(bill.billCode, "Nhập nhầm tiền mặt")
    api.setSession(admin)
    const approved = await paymentApi.decideCancel(req2.id, true, "OK hủy thu lại QR")
    expect(approved.status).toBe("APPROVED")

    const reopened = await paymentApi.getBill(a2Id)
    expect(reopened.billStatus).toBe("UNPAID")
    expect(reopened.status).toBe("AWAITING_PAYMENT")
    expect(reopened.cancelPending).toBe(false)
    expect((await paymentApi.listOpen()).some((s) => s.visitId === a2Id)).toBe(true)
    expect((await api.getFloorState(clock.now())).tables.find((t) => t.tableId === a2TableId)?.state).toBe("seated")
    expect((await turnsForVisit(a2Id, admin))?.status).toBe("OPEN")

    // Re-pay then test RECEPTIONIST direct cancelPaid
    api.setSession(cashier)
    await paymentApi.confirmTransfer(a2Id, false, reopened.version, "tn14-repay-qr", bill.billCode)
    expect((await api.getFloorState(clock.now())).tables.find((t) => t.tableId === a2TableId)?.state).toBe("free")

    api.setSession(receptionist)
    await paymentApi.cancelPaid(bill.billCode, "Khách quay lại gọi thêm")
    expect((await api.getFloorState(clock.now())).tables.find((t) => t.tableId === a2TableId)?.state).toBe("seated")

    // OWNER also allowed for cancelPaid; TN-14-K3 check complete audit log
    api.setSession(owner)
    const audit = await paymentApi.listAudit(bill.billCode)
    expect(audit.map((e) => e.action)).toContain("CANCELLED_DIRECT")
    expect(audit.map((e) => e.action)).toContain("CANCEL_APPROVED")
    expect(audit.map((e) => e.action)).toContain("CANCEL_REJECTED")
    expect(audit.map((e) => e.action)).toContain("CANCEL_REQUESTED")
    expect(audit.map((e) => e.action)).toContain("PAID")
    expect(audit.map((e) => e.action)).toContain("INVOICE_ISSUED")
    const rejectedEntry = audit.find((e) => e.action === "CANCEL_REJECTED")!
    expect(rejectedEntry.actor).toContain("Thu ngân")
    expect(rejectedEntry.approver).toContain("Quản trị viên")
    expect(rejectedEntry.reason).toBe("Khách đổi sang chuyển khoản")
    expect(rejectedEntry.decisionNote).toBe("Đã đối soát cuối ca")

    const approvedEntry = audit.find((e) => e.action === "CANCEL_APPROVED")!
    expect(approvedEntry.actor).toContain("Thu ngân")
    expect(approvedEntry.approver).toContain("Quản trị viên")
    expect(approvedEntry.reason).toBe("Nhập nhầm tiền mặt")
    expect(approvedEntry.decisionNote).toBe("OK hủy thu lại QR")
    expect(approvedEntry.at).toBeTruthy()
    expect(approvedEntry.device).toBeTruthy()
  })

  it("NA45H-01: future HOLD does not block reopening a paid visit (A3), while new USAGE still returns 409", async () => {
    const bd = businessDateOf(clock.now())
    const a3Id = await visitIdByCode("A3")
    const catalog = await api.getCatalog()
    const a3TableId = catalog.tables.find((t) => t.code === "A3")!.id

    // Verify seeded future bd+2 HOLD exists on A3
    api.setSession(receptionist)
    const futureRes = await api.listReservations({ businessDate: addDays(bd, 2) })
    expect(futureRes.some((r) => r.tableIds.includes(a3TableId))).toBe(true)

    api.setSession(cashier)
    const s0 = await paymentApi.getBill(a3Id)
    const bill = await paymentApi.issueInvoice(a3Id, s0.version, "na45h01-inv")
    await paymentApi.confirmCash(a3Id, bill.dueVnd, bill.version, "na45h01-pay1", bill.billCode)
    expect((await api.getFloorState(clock.now())).tables.find((t) => t.tableId === a3TableId)?.state).toBe("free")

    // 1) Direct cancel on A3 succeeds despite future bd+2 HOLD
    api.setSession(admin)
    await paymentApi.cancelPaid(bill.billCode, "Hủy thẳng A3")
    const reopened = await paymentApi.getBill(a3Id)
    expect(reopened.billStatus).toBe("UNPAID")
    expect(reopened.status).toBe("AWAITING_PAYMENT")
    expect((await api.getFloorState(clock.now())).tables.find((t) => t.tableId === a3TableId)?.state).toBe("seated")

    // Re-pay then test approved cancel request on A3 despite bd+2 HOLD
    api.setSession(cashier)
    await paymentApi.confirmTransfer(a3Id, false, reopened.version, "na45h01-pay2", bill.billCode)
    const req = await paymentApi.requestCancel(bill.billCode, "Duyệt hủy A3")
    api.setSession(admin)
    const approved = await paymentApi.decideCancel(req.id, true, "Duyệt")
    expect(approved.status).toBe("APPROVED")
    expect((await api.getFloorState(clock.now())).tables.find((t) => t.tableId === a3TableId)?.state).toBe("seated")
    // Future reservation on bd+2 is still intact
    expect(
      (await api.listReservations({ businessDate: addDays(bd, 2) })).some((r) => r.tableIds.includes(a3TableId)),
    ).toBe(true)

    // 2) Re-pay A3, seat a new walk-in USAGE on A3 -> cancelPaid and approve must reject 409 without corrupting state
    api.setSession(cashier)
    const repaidSource = await paymentApi.getBill(a3Id)
    await paymentApi.confirmCash(a3Id, repaidSource.dueVnd, repaidSource.version, "na45h01-pay3", bill.billCode)
    const reqBlocked = await paymentApi.requestCancel(bill.billCode, "Thử hủy khi có khách mới")

    api.setSession(receptionist)
    await api.seatWalkIn({ tableIds: [a3TableId], guestCount: 2, contactName: "Khách mới A3" })
    await expect(paymentApi.cancelPaid(bill.billCode, "Hủy khi có khách mới")).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
    })

    api.setSession(admin)
    await expect(paymentApi.decideCancel(reqBlocked.id, true, "Duyệt khi có khách mới")).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
    })
    const stillPaid = await paymentApi.getBill(a3Id)
    expect(stillPaid.billStatus).toBe("PAID")
    expect((await paymentApi.listCancelRequests()).find((r) => r.id === reqBlocked.id)?.status).toBe("PENDING")
    expect((await turnsForVisit(a3Id, admin))?.status).toBe("CLOSED")
  })

  it("NA45H-02: updates turn openTotal & closed count (completedTotal - openTotal) on final bill pay and cancel", async () => {
    const bd = businessDateOf(clock.now())
    const a3Id = await visitIdByCode("A3")
    api.setSession(admin)
    const beforeSummary = await api.getTableTurnSummary({ from: bd, to: bd })
    const beforeClosed = beforeSummary.completedTotal - beforeSummary.openTotal

    // Multi-bill A3: pay bill 1 while bill 2 exists -> closed count unchanged
    api.setSession(waiter)
    const s0 = await paymentApi.getBill(a3Id)
    const bill1 = await paymentApi.issueInvoice(a3Id, s0.version, "na45h02-inv1")
    addPaymentOrderLines(a3Id, [{ name: "Coca", unit: "Lon", qty: 2, unitPriceVnd: 45_000, state: "SERVED" }])
    const p2 = await paymentApi.previewBill(a3Id)
    const bill2 = await paymentApi.issueInvoice(a3Id, p2.version, "na45h02-inv2")

    api.setSession(cashier)
    await paymentApi.confirmCash(a3Id, bill1.dueVnd, bill2.version, "na45h02-pay1", bill1.billCode)
    api.setSession(admin)
    const afterBill1 = await api.getTableTurnSummary({ from: bd, to: bd })
    expect(afterBill1.openTotal).toBe(beforeSummary.openTotal)
    expect(afterBill1.completedTotal - afterBill1.openTotal).toBe(beforeClosed)
    expect((await turnsForVisit(a3Id, admin))?.status).toBe("OPEN")

    // Pay final bill 2 -> visit closes, openTotal -1, closed count +1
    api.setSession(cashier)
    const s2 = await paymentApi.getSessionBills(a3Id)
    await paymentApi.confirmCash(a3Id, bill2.dueVnd, s2.version, "na45h02-pay2", bill2.billCode)
    api.setSession(admin)
    const afterFinal = await api.getTableTurnSummary({ from: bd, to: bd })
    expect(afterFinal.openTotal).toBe(beforeSummary.openTotal - 1)
    expect(afterFinal.completedTotal - afterFinal.openTotal).toBe(beforeClosed + 1)
    expect((await turnsForVisit(a3Id, admin))?.status).toBe("CLOSED")

    // Cancel bill 2 -> visit reopens, openTotal +1, closed count -1
    await paymentApi.cancelPaid(bill2.billCode, "Hoàn tác bill cuối")
    const afterCancel = await api.getTableTurnSummary({ from: bd, to: bd })
    expect(afterCancel.openTotal).toBe(beforeSummary.openTotal)
    expect(afterCancel.completedTotal - afterCancel.openTotal).toBe(beforeClosed)
    expect((await turnsForVisit(a3Id, admin))?.status).toBe("OPEN")
  })

  it("NA45H-03 & NA45H-04: restricts requestCancel to CASHIER, lets cashier read own decisions via listMyCancelRequests, and emits change events after state/audit/notifications", async () => {
    const a2Id = await visitIdByCode("A2")
    const s0 = await paymentApi.getBill(a2Id)
    const bill = await paymentApi.issueInvoice(a2Id, s0.version, "na45h03-inv")
    await paymentApi.confirmCash(a2Id, bill.dueVnd, bill.version, "na45h03-pay", bill.billCode)

    // Non-cashier roles (including OWNER, ADMIN, WAITER) cannot submit requestCancel
    for (const nonCashier of [owner, admin, receptionist, waiter, bar]) {
      api.setSession(nonCashier)
      await expect(paymentApi.requestCancel(bill.billCode, "Thử gửi sai vai")).rejects.toMatchObject({
        code: "PERMISSION_DENIED",
        status: 403,
      })
    }

    // Track change events from api.subscribe and verify read consistency at emission time
    const observed: { action: string; latestSeq: number }[] = []
    const unsub = api.subscribe((ev) => {
      observed.push({ action: ev.action, latestSeq: ev.latestSeq })
    })
    try {
      // 1) Cashier requests cancel
      api.setSession(cashier)
      const req1 = await paymentApi.requestCancel(bill.billCode, "Khách đổi sang chuyển khoản")
      expect(observed.at(-1)?.action).toBe("PAYMENT_CANCEL_REQUESTED")
      expect(await paymentApi.listMyCancelRequests?.(bill.billCode)).toMatchObject([
        { id: req1.id, status: "PENDING", billCode: bill.billCode },
      ])
      // Waiter / Bar / Receptionist cannot call listMyCancelRequests
      api.setSession(waiter)
      await expect(paymentApi.listMyCancelRequests?.()).rejects.toMatchObject({
        code: "PERMISSION_DENIED",
        status: 403,
      })
      api.setSession(receptionist)
      await expect(paymentApi.listMyCancelRequests?.()).rejects.toMatchObject({
        code: "PERMISSION_DENIED",
        status: 403,
      })

      // 2) Admin rejects -> event emitted AFTER request/audit/notification updated
      api.setSession(admin)
      await paymentApi.decideCancel(req1.id, false, "Đã khóa ca")
      expect(observed.at(-1)?.action).toBe("PAYMENT_CANCEL_REJECTED")
      expect((await paymentApi.listAudit(bill.billCode))[0]?.action).toBe("CANCEL_REJECTED")

      // Cashier reads own decision without audit.read
      api.setSession(cashier)
      await expect(paymentApi.listCancelRequests()).rejects.toMatchObject({ code: "PERMISSION_DENIED", status: 403 })
      const myAfterReject = await paymentApi.listMyCancelRequests?.(bill.billCode)
      expect(myAfterReject?.[0]).toMatchObject({
        id: req1.id,
        status: "REJECTED",
        decisionNote: "Đã khóa ca",
      })
      expect(myAfterReject?.[0]?.decidedBy).toContain("Quản trị viên")

      // 3) Cashier submits 2nd request -> Admin approves -> event emitted AFTER state/request/audit/notification updated
      const req2 = await paymentApi.requestCancel(bill.billCode, "Gửi lại lần 2")
      expect(observed.at(-1)?.action).toBe("PAYMENT_CANCEL_REQUESTED")
      api.setSession(admin)
      await paymentApi.decideCancel(req2.id, true, "OK duyệt")
      expect(observed.at(-1)?.action).toBe("PAYMENT_CANCELLED")
      expect((await paymentApi.listAudit(bill.billCode))[0]?.action).toBe("CANCEL_APPROVED")

      api.setSession(cashier)
      const myAfterApprove = await paymentApi.listMyCancelRequests?.(bill.billCode)
      expect(myAfterApprove?.[0]).toMatchObject({ id: req2.id, status: "APPROVED", decisionNote: "OK duyệt" })
      const ntfsAfterApprove = await paymentApi.listNotifications()
      expect(ntfsAfterApprove.find((n) => n.type === "PAID" && n.visitId === a2Id)?.billCode).toBe(bill.billCode)
      expect(ntfsAfterApprove.find((n) => n.type === "CANCEL_DECIDED" && n.visitId === a2Id)?.billCode).toBe(
        bill.billCode,
      )

      // Re-collect then submit a 3rd request -> Receptionist direct cancel emits PAYMENT_CANCELLED and resolves pending request
      const unpaid = await paymentApi.getBill(a2Id)
      await paymentApi.confirmTransfer(a2Id, false, unpaid.version, "na45h03-repay", bill.billCode)
      const req3 = await paymentApi.requestCancel(bill.billCode, "Gửi sau khi thu lại")
      expect(req3.status).toBe("PENDING")

      api.setSession(receptionist)
      await paymentApi.cancelPaid(bill.billCode, "Lễ tân hủy trực tiếp")
      expect(observed.at(-1)?.action).toBe("PAYMENT_CANCELLED")
      expect((await paymentApi.listAudit(bill.billCode))[0]?.action).toBe("CANCELLED_DIRECT")
      // Strictly increasing latestSeq across all cancel/decision events
      for (let i = 1; i < observed.length; i++) {
        expect(observed[i]!.latestSeq).toBeGreaterThan(observed[i - 1]!.latestSeq)
      }
    } finally {
      unsub()
    }
  })

  it("NA45H-06: restricts BAR role listOpen/getBill/previewBill/issueInvoice/getSessionBills to pure bar-area sessions", async () => {
    const a3Id = await visitIdByCode("A3")
    const barId = await visitIdByCode("BAR01")

    // Create a pure bar-seat cluster and a mixed cluster using currently free seats/tables
    api.setSession(receptionist)
    const [catalog, floor] = await Promise.all([api.getCatalog(), api.getFloorState(clock.now())])
    const freeIds = new Set(floor.tables.filter((t) => t.state === "free").map((t) => t.tableId))
    const freeBarTables = catalog.tables.filter((t) => t.kind === "BAR_SEAT" && freeIds.has(t.id))
    const freeMainTables = catalog.tables.filter((t) => t.kind === "TABLE" && !t.isSpare && freeIds.has(t.id))
    expect(freeBarTables.length).toBeGreaterThanOrEqual(3)
    expect(freeMainTables.length).toBeGreaterThanOrEqual(1)
    const barPair = await api.seatWalkIn({ tableIds: [freeBarTables[0]!.id, freeBarTables[1]!.id], guestCount: 2 })
    addPaymentOrderLines(String(barPair.visitId), [{ name: "Gin Fizz", unit: "Ly", qty: 1, unitPriceVnd: 160_000 }])
    const mixed = await api.seatWalkIn({ tableIds: [freeMainTables[0]!.id, freeBarTables[2]!.id], guestCount: 3 })
    addPaymentOrderLines(String(mixed.visitId), [{ name: "Whisky", unit: "Ly", qty: 1, unitPriceVnd: 220_000 }])

    api.setSession(bar)
    const barOpen = await paymentApi.listOpen()
    expect(barOpen.some((s) => s.visitId === barId)).toBe(true)
    expect(barOpen.some((s) => s.visitId === String(barPair.visitId))).toBe(true)
    expect(barOpen.some((s) => s.visitId === a3Id)).toBe(false)
    expect(barOpen.some((s) => s.visitId === String(mixed.visitId))).toBe(false)

    // Pure bar cluster preview & invoice succeed
    const pairPreview = await paymentApi.previewBill(String(barPair.visitId))
    expect(pairPreview.dueVnd).toBe(176_000)
    const pairIssued = await paymentApi.issueInvoice(String(barPair.visitId), pairPreview.version, "na45h06-bar-pair")
    expect(pairIssued.issuedByRole).toBe("BAR")

    // Non-bar (A3) and mixed (C4 + BAR05) sessions are refused 403 on all read/preview/issue endpoints
    for (const forbiddenVisitId of [a3Id, String(mixed.visitId)]) {
      await expect(paymentApi.getBill(forbiddenVisitId)).rejects.toMatchObject({
        code: "PERMISSION_DENIED",
        status: 403,
      })
      await expect(paymentApi.previewBill(forbiddenVisitId)).rejects.toMatchObject({
        code: "PERMISSION_DENIED",
        status: 403,
      })
      await expect(paymentApi.getSessionBills(forbiddenVisitId)).rejects.toMatchObject({
        code: "PERMISSION_DENIED",
        status: 403,
      })
      await expect(
        paymentApi.issueInvoice(forbiddenVisitId, 1, `na45h06-forbid-${forbiddenVisitId}`),
      ).rejects.toMatchObject({ code: "PERMISSION_DENIED", status: 403 })
    }

    // NA45H-06 OR predicate: { code: "BAR99", zone: MAIN } AND { code: "QUAY99", zone: BAR } both qualify
    const db = (api as unknown as { db: MockDb }).db
    const mainZone = [...db.zones.values()].find((z) => z.code !== "BAR")!
    const barZone = [...db.zones.values()].find((z) => z.code === "BAR")!
    const bar99Id = db.nextId.tables++
    const quay99Id = db.nextId.tables++
    const mainTemplate = [...db.tables.values()].find((t) => t.kind === "TABLE" && !t.isSpare)!
    const barTemplate = [...db.tables.values()].find((t) => t.kind === "BAR_SEAT")!
    db.tables.set(bar99Id, {
      ...mainTemplate,
      id: bar99Id,
      zoneId: mainZone.id,
      code: "BAR99",
      kind: "TABLE",
      isSpare: false,
      status: "ACTIVE",
    })
    db.tables.set(quay99Id, {
      ...barTemplate,
      id: quay99Id,
      zoneId: barZone.id,
      code: "QUAY99",
      kind: "BAR_SEAT",
      isSpare: false,
      status: "ACTIVE",
    })

    api.setSession(receptionist)
    const bar99Visit = await api.seatWalkIn({ tableIds: [bar99Id], guestCount: 2 })
    addPaymentOrderLines(String(bar99Visit.visitId), [{ name: "Mojito", unit: "Ly", qty: 1, unitPriceVnd: 110_000 }])
    const quay99Visit = await api.seatWalkIn({ tableIds: [quay99Id], guestCount: 1 })
    addPaymentOrderLines(String(quay99Visit.visitId), [{ name: "Daiquiri", unit: "Ly", qty: 1, unitPriceVnd: 120_000 }])
    const freeNow = new Set(
      (await api.getFloorState(clock.now())).tables.filter((t) => t.state === "free").map((t) => t.tableId),
    )
    const mainTableForMix = catalog.tables.find(
      (t) => t.kind === "TABLE" && !t.isSpare && freeNow.has(t.id) && !/^BAR/i.test(t.code),
    )!
    const barSeatForMix = catalog.tables.find((t) => t.kind === "BAR_SEAT" && freeNow.has(t.id))!
    const mixed2 = await api.seatWalkIn({ tableIds: [mainTableForMix.id, barSeatForMix.id], guestCount: 2 })
    addPaymentOrderLines(String(mixed2.visitId), [{ name: "Whisky Sour", unit: "Ly", qty: 1, unitPriceVnd: 150_000 }])

    api.setSession(bar)
    const barOpen2 = await paymentApi.listOpen()
    expect(barOpen2.some((s) => s.visitId === String(bar99Visit.visitId))).toBe(true)
    expect(barOpen2.some((s) => s.visitId === String(quay99Visit.visitId))).toBe(true)
    expect(barOpen2.some((s) => s.visitId === String(mixed2.visitId))).toBe(false)

    const bar99Preview = await paymentApi.previewBill(String(bar99Visit.visitId))
    expect(bar99Preview.dueVnd).toBe(121_000)
    const quay99Preview = await paymentApi.previewBill(String(quay99Visit.visitId))
    expect(quay99Preview.dueVnd).toBe(132_000)
    const quay99Bill = await paymentApi.issueInvoice(
      String(quay99Visit.visitId),
      quay99Preview.version,
      "na45h06-quay99",
    )
    await expect(paymentApi.getBill(String(mixed2.visitId))).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      status: 403,
    })

    // Closed/paid QUAY99 session (no active allocations) still passes isBarAreaVisit for BAR
    api.setSession(cashier)
    await paymentApi.confirmCash(
      String(quay99Visit.visitId),
      quay99Bill.dueVnd,
      quay99Bill.version,
      "na45h06-quay99-pay",
      quay99Bill.billCode,
    )
    api.setSession(bar)
    expect((await paymentApi.getBill(String(quay99Visit.visitId))).billStatus).toBe("PAID")
  })

  it("NA45H-10 & NA45H-14: shares mock state & change events across independent MockGamApi instances while keeping per-instance session and separate audit reason/decisionNote", async () => {
    const transport = createInMemoryMockSyncTransport()
    const cashierApi = new MockGamApi({ businessDayWorkerEnabled: false, syncTransport: transport })
    const adminApi = new MockGamApi({ businessDayWorkerEnabled: false, syncTransport: transport })
    try {
      cashierApi.setSession(cashier)
      adminApi.setSession(admin)

      const adminEvents: string[] = []
      const cashierEvents: string[] = []
      const unsubAdmin = adminApi.subscribe((ev) => adminEvents.push(ev.action))
      const unsubCashier = cashierApi.subscribe((ev) => cashierEvents.push(ev.action))

      try {
        const a2 = (await cashierApi.listPaymentOpen()).find((s) => s.code === "A2")!
        const issued = await cashierApi.issuePaymentInvoice(a2.visitId, a2.version, "sync-inv-1")
        await cashierApi.confirmPaymentCash(a2.visitId, issued.dueVnd, issued.version, "sync-pay-1", issued.billCode)

        const req = await cashierApi.requestPaymentCancel(issued.billCode, "Thu nhầm tiền mặt")
        expect(adminEvents).toContain("PAYMENT_CANCEL_REQUESTED")

        // Admin instance sees the Cashier's PENDING request without changing its own session
        const adminQueue = await adminApi.listPaymentCancelRequests()
        expect(adminQueue.some((r) => r.id === req.id && r.status === "PENDING")).toBe(true)

        // Admin approves with a note distinct from the request reason
        const approved = await adminApi.decidePaymentCancel(req.id, true, "OK thu lại QR")
        expect(approved.status).toBe("APPROVED")
        expect(cashierEvents).toContain("PAYMENT_CANCELLED")

        // Cashier instance sees decision immediately and keeps its CASHIER session
        const myReqs = await cashierApi.listMyPaymentCancelRequests(issued.billCode)
        expect(myReqs[0]).toMatchObject({ id: req.id, status: "APPROVED", decisionNote: "OK thu lại QR" })

        // NA45H-14: audit entry keeps request reason and decision note in separate fields
        const audit = await adminApi.listPaymentAudit(issued.billCode)
        const approvedAudit = audit.find((e) => e.action === "CANCEL_APPROVED")!
        expect(approvedAudit.reason).toBe("Thu nhầm tiền mặt")
        expect(approvedAudit.decisionNote).toBe("OK thu lại QR")

        // Also verify without a decision note: reason stays intact, decisionNote omitted
        await cashierApi.confirmPaymentTransfer(
          a2.visitId,
          false,
          (await cashierApi.getPaymentBill(a2.visitId)).version,
          "sync-pay-2",
          issued.billCode,
        )
        const req2 = await cashierApi.requestPaymentCancel(issued.billCode, "Khách đổi ý")
        await adminApi.decidePaymentCancel(req2.id, false)
        const rejectedNoNote = (await adminApi.listPaymentAudit(issued.billCode)).find(
          (e) => e.action === "CANCEL_REJECTED",
        )!
        expect(rejectedNoNote.reason).toBe("Khách đổi ý")
        expect(rejectedNoNote.decisionNote).toBeUndefined()
      } finally {
        unsubAdmin()
        unsubCashier()
      }
    } finally {
      cashierApi.dispose()
      adminApi.dispose()
    }
  })

  it("listPaidBills & Receptionist audit access: returns current-shift PAID bills newest-first for RECEPTIONIST/ADMIN/OWNER and blocks CASHIER/WAITER/BAR", async () => {
    const a2Id = await visitIdByCode("A2")
    const a3Id = await visitIdByCode("A3")

    const a2Bill = await paymentApi.issueInvoice(a2Id, (await paymentApi.getBill(a2Id)).version, "paid-list-a2")
    await paymentApi.confirmCash(a2Id, a2Bill.dueVnd, a2Bill.version, "paid-list-pay-a2", a2Bill.billCode)

    const a3Bill = await paymentApi.issueInvoice(a3Id, (await paymentApi.getBill(a3Id)).version, "paid-list-a3")
    await paymentApi.confirmTransfer(a3Id, true, a3Bill.version, "paid-list-pay-a3", a3Bill.billCode)

    // CASHIER / WAITER / BAR cannot call listPaidBills
    for (const denied of [cashier, waiter, bar]) {
      api.setSession(denied)
      await expect(paymentApi.listPaidBills?.()).rejects.toMatchObject({ code: "PERMISSION_DENIED", status: 403 })
    }

    // RECEPTIONIST, ADMIN, OWNER can read listPaidBills + listAudit
    for (const allowed of [receptionist, admin, owner]) {
      api.setSession(allowed)
      const list = (await paymentApi.listPaidBills?.()) ?? []
      expect(list.map((b) => b.billCode)).toContain(a2Bill.billCode)
      expect(list.map((b) => b.billCode)).toContain(a3Bill.billCode)
      const first = list.find((b) => b.billCode === a3Bill.billCode)!
      expect(first).toMatchObject({
        billCode: a3Bill.billCode,
        visitId: a3Id,
        code: "A3",
        tables: ["A3"],
        dueVnd: a3Bill.dueVnd,
        method: "TRANSFER",
      })
      expect(first.paidAt).toBeTruthy()
      expect(first.paidBy).toContain("Thu ngân")
      expect(list.findIndex((b) => b.billCode === a3Bill.billCode)).toBeLessThan(
        list.findIndex((b) => b.billCode === a2Bill.billCode),
      )
      expect((await paymentApi.listAudit(a3Bill.billCode)).length).toBeGreaterThan(0)
    }

    // Cancelling removes bill from listPaidBills
    api.setSession(receptionist)
    await paymentApi.cancelPaid(a3Bill.billCode, "Hủy trên danh sách đã thu")
    const afterCancel = (await paymentApi.listPaidBills?.()) ?? []
    expect(afterCancel.some((b) => b.billCode === a3Bill.billCode)).toBe(false)
    expect(afterCancel.some((b) => b.billCode === a2Bill.billCode)).toBe(true)
  })

  it("NA45H-12: returns CancelEffect from cancelPaid and decideCancel inside the transaction (including concurrent last-bill pay)", async () => {
    const a3Id = await visitIdByCode("A3")

    // Multi-bill A3: Bill 1 + Bill 2
    api.setSession(waiter)
    const s0 = await paymentApi.getBill(a3Id)
    const bill1 = await paymentApi.issueInvoice(a3Id, s0.version, "na45h12-inv1")
    addPaymentOrderLines(a3Id, [{ name: "Mojito", unit: "Ly", qty: 1, unitPriceVnd: 110_000, state: "SERVED" }])
    const p2 = await paymentApi.previewBill(a3Id)
    const bill2 = await paymentApi.issueInvoice(a3Id, p2.version, "na45h12-inv2")

    // Pay Bill 1 while Bill 2 is still UNPAID -> direct cancel keeps session open (delta 0)
    api.setSession(cashier)
    await paymentApi.confirmCash(a3Id, bill1.dueVnd, bill2.version, "na45h12-pay1", bill1.billCode)
    api.setSession(receptionist)
    const partialEffect = await paymentApi.cancelPaid(bill1.billCode, "Huỷ khi còn bill 2 chưa thu")
    expect(partialEffect).toEqual({ sessionReopened: false, closedTurnsDelta: 0 })

    // Re-pay Bill 1, then pay Bill 2 so visit closes -> direct cancel on Bill 1 now reopens session (delta -1)
    api.setSession(cashier)
    const sMid = await paymentApi.getSessionBills(a3Id)
    await paymentApi.confirmCash(a3Id, bill1.dueVnd, sMid.version, "na45h12-repay1", bill1.billCode)
    const sBeforeFinal = await paymentApi.getSessionBills(a3Id)
    await paymentApi.confirmCash(a3Id, bill2.dueVnd, sBeforeFinal.version, "na45h12-pay2", bill2.billCode)

    api.setSession(receptionist)
    const reopenEffect = await paymentApi.cancelPaid(bill1.billCode, "Huỷ sau khi bill 2 đã đóng phiên")
    expect(reopenEffect).toEqual({ sessionReopened: true, closedTurnsDelta: -1 })

    // Re-pay Bill 1 -> visit closes again -> Cashier request + Admin approve returns effect, reject omits effect
    api.setSession(cashier)
    const sReopen = await paymentApi.getSessionBills(a3Id)
    await paymentApi.confirmTransfer(a3Id, false, sReopen.version, "na45h12-repay1b", bill1.billCode)
    const reqReject = await paymentApi.requestCancel(bill1.billCode, "Thử từ chối")
    api.setSession(admin)
    const rejected = await paymentApi.decideCancel(reqReject.id, false, "Không duyệt")
    expect(rejected.effect).toBeUndefined()

    api.setSession(cashier)
    const reqApprove = await paymentApi.requestCancel(bill1.billCode, "Duyệt mở lại phiên")
    api.setSession(admin)
    const approved = await paymentApi.decideCancel(reqApprove.id, true, "OK mở lại")
    expect(approved.effect).toEqual({ sessionReopened: true, closedTurnsDelta: -1 })
  })

  it("NA45H-11: populates PayBill.cancelHistory for DIRECT and APPROVED cancels and sets recollectedAt on re-collection", async () => {
    const a2Id = await visitIdByCode("A2")
    const s0 = await paymentApi.getBill(a2Id)
    const bill = await paymentApi.issueInvoice(a2Id, s0.version, "na45h11-inv")
    await paymentApi.confirmCash(a2Id, bill.dueVnd, bill.version, "na45h11-pay1", bill.billCode)

    // 1) Receptionist direct cancel without any pending Cashier request
    api.setSession(receptionist)
    await paymentApi.cancelPaid(bill.billCode, "Khách gọi thêm món (huỷ trực tiếp)")

    // Cashier reads PayBill while unpaid and after re-collection
    api.setSession(cashier)
    const unpaidAfterDirect = await paymentApi.getBill(a2Id)
    expect(unpaidAfterDirect.cancelHistory).toHaveLength(1)
    expect(unpaidAfterDirect.cancelHistory?.[0]).toMatchObject({
      kind: "DIRECT",
      reason: "Khách gọi thêm món (huỷ trực tiếp)",
    })
    expect(unpaidAfterDirect.cancelHistory?.[0]?.actor).toContain("Lễ tân")
    expect(unpaidAfterDirect.cancelHistory?.[0]?.at).toBeTruthy()
    expect(unpaidAfterDirect.cancelHistory?.[0]?.recollectedAt).toBeUndefined()

    clock.advance(5)
    await paymentApi.confirmTransfer(a2Id, false, unpaidAfterDirect.version, "na45h11-repay1", bill.billCode)
    const repaidAfterDirect = await paymentApi.getBill(a2Id)
    expect(repaidAfterDirect.cancelHistory?.[0]).toMatchObject({
      kind: "DIRECT",
      reason: "Khách gọi thêm món (huỷ trực tiếp)",
    })
    expect(repaidAfterDirect.cancelHistory?.[0]?.recollectedAt).toBeTruthy()
    expect(repaidAfterDirect.cancelPending).toBe(false)

    // Cashier still cannot read global cancel queue, and can still submit a new cancel request
    await expect(paymentApi.listCancelRequests()).rejects.toMatchObject({ code: "PERMISSION_DENIED", status: 403 })
    const req2 = await paymentApi.requestCancel(bill.billCode, "Thu lại nhầm kênh")
    api.setSession(admin)
    await paymentApi.decideCancel(req2.id, true, "Duyệt lần 2")

    api.setSession(cashier)
    clock.advance(5)
    const unpaidAfterApprove = await paymentApi.getBill(a2Id)
    await paymentApi.confirmCash(a2Id, bill.dueVnd, unpaidAfterApprove.version, "na45h11-repay2", bill.billCode)
    const sessionAfterSecond = await paymentApi.getSessionBills(a2Id)
    const billDetail = sessionAfterSecond.bills.find((b) => b.billCode === bill.billCode)!
    expect(billDetail.cancelHistory).toHaveLength(2)
    expect(billDetail.cancelHistory?.[0]).toMatchObject({
      kind: "APPROVED",
      reason: "Thu lại nhầm kênh",
      decisionNote: "Duyệt lần 2",
    })
    expect(billDetail.cancelHistory?.[0]?.approver).toContain("Quản trị viên")
    expect(billDetail.cancelHistory?.[0]?.recollectedAt).toBeTruthy()
    expect(billDetail.cancelHistory?.[1]?.kind).toBe("DIRECT")
    expect(billDetail.cancelHistory?.[1]?.recollectedAt).toBeTruthy()
    expect(billDetail.cancelHistory?.[0]?.recollectedAt).not.toBe(billDetail.cancelHistory?.[1]?.recollectedAt)
  })

  it("NA45H-17: serializes concurrent mutations across instances, assigns distinct IDs for different bills, and rejects duplicate PENDING on same bill", async () => {
    const baseTransport = createInMemoryMockSyncTransport()
    let readCount = 0
    let pauseFirstRead = true
    let releaseReadBarrier!: () => void
    const firstReadPaused = new Promise<void>((resolve) => {
      releaseReadBarrier = resolve
    })
    // Wrap transport to verify lock still serializes even if readLatest is observed/contended
    const transport = {
      ...baseTransport,
      readLatest() {
        readCount += 1
        const res = baseTransport.readLatest()
        if (pauseFirstRead && readCount > 0 && res) {
          pauseFirstRead = false
          releaseReadBarrier()
        }
        return res
      },
    }

    const cashierApiA = new MockGamApi({ businessDayWorkerEnabled: false, syncTransport: transport })
    const cashierApiB = new MockGamApi({ businessDayWorkerEnabled: false, syncTransport: transport })
    const adminApi = new MockGamApi({ businessDayWorkerEnabled: false, syncTransport: transport })
    try {
      cashierApiA.setSession(cashier)
      cashierApiB.setSession(cashier)
      adminApi.setSession(admin)

      const open = await cashierApiA.listPaymentOpen()
      const a2 = open.find((s) => s.code === "A2")!
      const a3 = open.find((s) => s.code === "A3")!
      const a2Bill = await cashierApiA.issuePaymentInvoice(a2.visitId, a2.version, "na45h17-inv-a2")
      await cashierApiA.confirmPaymentCash(a2.visitId, a2Bill.dueVnd, a2Bill.version, "na45h17-pay-a2", a2Bill.billCode)
      const a3Bill = await cashierApiA.issuePaymentInvoice(a3.visitId, a3.version, "na45h17-inv-a3")
      await cashierApiA.confirmPaymentCash(a3.visitId, a3Bill.dueVnd, a3Bill.version, "na45h17-pay-a3", a3Bill.billCode)

      // Concurrent cancel requests for two different bills from two tabs
      const [reqA, reqB] = await Promise.all([
        cashierApiA.requestPaymentCancel(a2Bill.billCode, "Hủy đồng thời A2"),
        cashierApiB.requestPaymentCancel(a3Bill.billCode, "Hủy đồng thời A3"),
      ])
      await firstReadPaused

      expect(reqA.status).toBe("PENDING")
      expect(reqB.status).toBe("PENDING")
      expect(reqA.id).not.toBe(reqB.id)

      const openAdminQueue = await adminApi.listPaymentCancelRequests()
      expect(openAdminQueue.filter((r) => r.status === "PENDING")).toHaveLength(2)
      expect(openAdminQueue.map((r) => r.id).sort()).toEqual([reqA.id, reqB.id].sort())

      const audit = await adminApi.listPaymentAudit()
      const cancelReqAudits = audit.filter((e) => e.action === "CANCEL_REQUESTED")
      expect(cancelReqAudits).toHaveLength(2)

      // Newly opened Admin instance sees both requests & audit rows
      const lateAdminApi = new MockGamApi({ businessDayWorkerEnabled: false, syncTransport: transport })
      try {
        lateAdminApi.setSession(admin)
        const lateQueue = await lateAdminApi.listPaymentCancelRequests()
        expect(lateQueue.filter((r) => r.status === "PENDING")).toHaveLength(2)
        expect((await lateAdminApi.listPaymentAudit()).filter((e) => e.action === "CANCEL_REQUESTED")).toHaveLength(2)
      } finally {
        lateAdminApi.dispose()
      }

      // Same-bill concurrent requests: exactly one succeeds, one fails 409 INVALID_STATE
      const g05 = (await cashierApiA.listPaymentOpen()).find((s) => s.code === "G05")!
      const g05Bill = await cashierApiA.issuePaymentInvoice(g05.visitId, g05.version, "na45h17-inv-g05")
      await cashierApiA.confirmPaymentCash(
        g05.visitId,
        g05Bill.dueVnd,
        g05Bill.version,
        "na45h17-pay-g05",
        g05Bill.billCode,
      )

      const sameBillResults = await Promise.allSettled([
        cashierApiA.requestPaymentCancel(g05Bill.billCode, "Trùng A"),
        cashierApiB.requestPaymentCancel(g05Bill.billCode, "Trùng B"),
      ])
      const fulfilled = sameBillResults.filter((r) => r.status === "fulfilled")
      const rejected = sameBillResults.filter((r) => r.status === "rejected")
      expect(fulfilled).toHaveLength(1)
      expect(rejected).toHaveLength(1)
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: "INVALID_STATE", status: 409 })
      expect(
        (await adminApi.listPaymentCancelRequests()).filter(
          (r) => r.billCode === g05Bill.billCode && r.status === "PENDING",
        ),
      ).toHaveLength(1)
    } finally {
      cashierApiA.dispose()
      cashierApiB.dispose()
      adminApi.dispose()
    }
  })
})

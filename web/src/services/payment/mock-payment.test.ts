import { beforeEach, describe, expect, it } from "vitest"
import { businessDateOf } from "@/lib/time"
import { api, clock, demo } from "@/services"
import { DEMO_USERS } from "@/services/mock/seed"
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

    // Guest orders extra round after Bill 1 was issued
    const afterAdd = addPaymentOrderLines(a3Id, [
      { name: "Gin Tonic", unit: "Ly", qty: 2, unitPriceVnd: 150_000, state: "SERVED" },
    ])
    expect(afterAdd.unbilledLineCount).toBe(1)
    expect(afterAdd.bills).toHaveLength(1)
    expect(afterAdd.bills[0].dueVnd).toBe(bill1.dueVnd)

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
    const rc1 = await paymentApi.confirmCash(
      a3Id,
      bill1.dueVnd,
      sessionTwoBills.version,
      "v12-pay-1",
      bill1.billCode,
    )
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
    addPaymentOrderLines(a3Id, [
      { name: "Negroni", unit: "Ly", qty: 1, unitPriceVnd: 180_000, state: "SERVED" },
    ])
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
    await expect(paymentApi.decideCancel(req1.id, true)).rejects.toMatchObject({ code: "PERMISSION_DENIED", status: 403 })

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
    const approvedEntry = audit.find((e) => e.action === "CANCEL_APPROVED")!
    expect(approvedEntry.actor).toContain("Thu ngân")
    expect(approvedEntry.approver).toContain("Quản trị viên")
    expect(approvedEntry.reason).toBe("OK hủy thu lại QR")
    expect(approvedEntry.at).toBeTruthy()
    expect(approvedEntry.device).toBeTruthy()
  })
})

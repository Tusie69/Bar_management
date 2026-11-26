import { beforeEach, describe, expect, it } from "vitest"
import { api, clock, demo } from "@/services"
import { DEMO_USERS } from "@/services/mock/seed"
import { isPaymentAvailable, paymentApi } from "./index"
import { setPaymentMockFault } from "./mock-payment"

const receptionist = DEMO_USERS.find((u) => u.role === "RECEPTIONIST")!
const cashier = DEMO_USERS.find((u) => u.role === "CASHIER")!
const waiter = DEMO_USERS.find((u) => u.role === "WAITER")!

async function visitIdByCode(code: string): Promise<string> {
  const list = await paymentApi.listOpen()
  const hit = list.find((b) => b.code === code)
  if (!hit) throw new Error(`Missing open bill for ${code}`)
  return hit.visitId
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
})

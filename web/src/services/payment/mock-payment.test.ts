import { beforeEach, describe, expect, it } from "vitest"
import { ApiError, api, demo } from "@/services"
import { DEMO_USERS } from "@/services/mock/seed"
import { paymentApi } from "./index"
import { setPaymentMockFault } from "./mock-payment"

const cashier = DEMO_USERS.find((u) => u.role === "CASHIER")!
const waiter = DEMO_USERS.find((u) => u.role === "WAITER")!
const receptionist = DEMO_USERS.find((u) => u.role === "RECEPTIONIST")!

describe("mockPaymentApi", () => {
  beforeEach(() => {
    demo?.reset()
    api.setSession(cashier)
  })

  it("lists open sessions sorted with AWAITING_PAYMENT first, then requested, then SERVING", async () => {
    const list = await paymentApi.listOpen()
    expect(list.map((x) => x.visitId)).toEqual(["s408", "s419", "s412", "s415", "s421"])
    expect(list[0].clusterCode).toBe("G01")
    expect(list[0].code).toBe("G01")
    expect(list[0].dueVnd).toBe(3_044_000)
  })

  it("transitions SERVING -> AWAITING_PAYMENT on createPrebill without recording money", async () => {
    const before = await paymentApi.getBill("s412")
    expect(before.status).toBe("SERVING")
    const after = await paymentApi.createPrebill("s412", before.version)
    expect(after.status).toBe("AWAITING_PAYMENT")
    expect(after.version).toBe(before.version + 1)
  })

  it("allows WAITER (PA-A) to request payment but blocks WAITER from collecting payment", async () => {
    api.setSession(waiter)
    await paymentApi.requestPayment("s412")
    const bill = await paymentApi.getBill("s412")
    expect(bill.requestedAt).toBeTruthy()
    expect(bill.status).toBe("AWAITING_PAYMENT")

    await expect(paymentApi.confirmCash("s412", bill.dueVnd, bill.version, "k-waiter-1")).rejects.toThrow(ApiError)
  })

  it("blocks RECEPTIONIST from payment reads/writes", async () => {
    api.setSession(receptionist)
    await expect(paymentApi.listOpen()).rejects.toThrow(ApiError)
  })

  it("confirms cash payment, replays same idempotencyKey, and rejects duplicate confirm with new key", async () => {
    const bill = await paymentApi.getBill("s419")
    const rc1 = await paymentApi.confirmCash("s419", 400_000, bill.version, "cash-key-1")
    expect(rc1.method).toBe("CASH")
    expect(rc1.givenVnd).toBe(400_000)
    expect(rc1.changeVnd).toBe(400_000 - 351_000)

    const replay = await paymentApi.confirmCash("s419", 400_000, bill.version, "cash-key-1")
    expect(replay).toEqual(rc1)

    await expect(paymentApi.confirmCash("s419", 400_000, bill.version + 1, "cash-key-2")).rejects.toMatchObject({
      code: "DUPLICATE_PAYMENT",
      status: 409,
    })

    const open = await paymentApi.listOpen()
    expect(open.find((x) => x.visitId === "s419")).toBeUndefined()

    const ntfs = await paymentApi.listNotifications()
    expect(ntfs.some((n) => n.type === "PAID" && n.visitId === "s419")).toBe(true)
  })

  it("simulates network error without recording money and duplicate device 409 fault", async () => {
    const bill = await paymentApi.getBill("s415")
    setPaymentMockFault({ nextConfirm: "net" })
    await expect(paymentApi.confirmCash("s415", bill.dueVnd, bill.version, "k-net-1")).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    })
    const stillOpen = await paymentApi.getBill("s415")
    expect(stillOpen.status).toBe("SERVING")

    setPaymentMockFault({ nextConfirm: "dup" })
    await expect(paymentApi.confirmTransfer("s415", true, bill.version, "k-dup-1")).rejects.toMatchObject({
      code: "DUPLICATE_PAYMENT",
      status: 409,
    })
    const nowPaid = await paymentApi.getBill("s415")
    expect(nowPaid.status).toBe("PAID")
  })
})

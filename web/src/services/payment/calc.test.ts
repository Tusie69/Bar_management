import { describe, expect, it } from "vitest"
import type { PayBillSummary, PayLine } from "./contracts"
import {
  calcBillTotals,
  evaluateCashInput,
  formatCompactVnd,
  formatVnd,
  groupActiveRounds,
  parseCashInputDigits,
  quickCashAmounts,
  roundDueVnd,
  sortOpenBills,
} from "./calc"

const line = (overrides: Partial<PayLine> = {}): PayLine => ({
  orderRound: 1,
  name: "Tiger Crystal",
  unit: "Chai 330ml",
  qty: 1,
  unitPriceVnd: 42_800,
  lineTotalVnd: 42_800,
  state: "SERVED",
  ...overrides,
})

describe("payment rounding & VND formatting", () => {
  it("rounds preRoundVnd up to nearest 1.000đ integer", () => {
    expect(roundDueVnd(0)).toBe(0)
    expect(roundDueVnd(220_000)).toBe(220_000)
    expect(roundDueVnd(230_560)).toBe(231_000)
    expect(roundDueVnd(230_001)).toBe(231_000)
    expect(roundDueVnd(3_043_700)).toBe(3_044_000)
  })

  it("formats VND and compact tile amounts as integers", () => {
    expect(formatVnd(1_234_000)).toBe("1.234.000đ")
    expect(formatVnd(0)).toBe("0đ")
    expect(formatCompactVnd(389_000)).toBe("389k")
    expect(formatCompactVnd(3_044_000)).toBe("3,04tr")
    expect(formatCompactVnd(2_000_000)).toBe("2tr")
  })
})

describe("cancelled-item exclusion & round grouping", () => {
  it("excludes CANCELLED lines from subtotal, VAT, itemCount, and dueVnd while keeping MAKING items", () => {
    const totals = calcBillTotals([
      line({ orderRound: 1, qty: 2, unitPriceVnd: 42_800, lineTotalVnd: 85_600, state: "SERVED" }),
      line({ orderRound: 1, name: "Khoai tây", qty: 1, unitPriceVnd: 69_000, lineTotalVnd: 69_000, state: "SERVED" }),
      line({ orderRound: 2, name: "Mojito", qty: 1, unitPriceVnd: 55_000, lineTotalVnd: 55_000, state: "MAKING" }),
      line({ orderRound: 2, name: "Margarita", qty: 1, unitPriceVnd: 120_000, lineTotalVnd: 120_000, state: "CANCELLED" }),
    ])

    expect(totals.subtotalVnd).toBe(209_600)
    expect(totals.vatVnd).toBe(20_960)
    expect(totals.preRoundVnd).toBe(230_560)
    expect(totals.roundingVnd).toBe(440)
    expect(totals.dueVnd).toBe(231_000)
    expect(totals.itemCount).toBe(4)
    expect(totals.makingCount).toBe(1)
    expect(totals.cancelledCount).toBe(1)
  })

  it("hides cancelled items and omits rounds that have only cancelled items", () => {
    const rounds = groupActiveRounds([
      line({ orderRound: 1, name: "Tiger", state: "SERVED", roundTime: "19:08", roundBy: "Minh" }),
      line({ orderRound: 2, name: "Bia tháp", state: "CANCELLED", roundTime: "19:30", roundBy: "Minh" }),
      line({ orderRound: 3, name: "Mojito", state: "MAKING", roundTime: "20:15", roundBy: "Hà" }),
    ])

    expect(rounds).toHaveLength(2)
    expect(rounds.map((r) => r.orderRound)).toEqual([1, 3])
    expect(rounds[0].items.map((i) => i.name)).toEqual(["Tiger"])
    expect(rounds[1].items.map((i) => i.name)).toEqual(["Mojito"])
  })
})

describe("session list sorting", () => {
  const s = (visitId: string, status: PayBillSummary["status"], requestedAt?: string): PayBillSummary => ({
    visitId,
    billCode: `B${visitId}`,
    sessionCode: `S-${visitId}`,
    code: visitId,
    tables: [visitId],
    status,
    openedAt: "19:00",
    requestedAt,
    waiterName: "Minh",
    guests: 2,
    dueVnd: 200_000,
    version: 1,
  })

  it("sorts AWAITING_PAYMENT first, then waiter-requested, then remaining SERVING", () => {
    const sorted = sortOpenBills([
      s("A3", "SERVING"),
      s("B4", "SERVING", "21:38"),
      s("G01", "AWAITING_PAYMENT"),
      s("Bar1", "SERVING"),
    ])
    expect(sorted.map((x) => x.visitId)).toEqual(["G01", "B4", "A3", "Bar1"])
  })
})

describe("cash result states & quick chips", () => {
  it("evaluates idle, short, exact, and change states cleanly", () => {
    expect(evaluateCashInput(351_000, null)).toEqual({ state: "idle" })
    expect(evaluateCashInput(351_000, 300_000)).toEqual({ state: "short", shortVnd: 51_000 })
    expect(evaluateCashInput(351_000, 351_000)).toEqual({ state: "exact" })
    expect(evaluateCashInput(351_000, 500_000)).toEqual({ state: "change", changeVnd: 149_000, givenVnd: 500_000 })
  })

  it("computes up to 6 sorted quick cash amounts starting with exact due", () => {
    expect(quickCashAmounts(231_000)).toEqual([231_000, 250_000, 300_000, 400_000, 500_000, 1_000_000])
    expect(quickCashAmounts(3_044_000)).toEqual([3_044_000, 3_050_000, 3_100_000, 3_200_000, 3_500_000, 4_000_000])
  })

  it("parses numeric digit strings safely", () => {
    expect(parseCashInputDigits("")).toBeNull()
    expect(parseCashInputDigits("0")).toBe(0)
    expect(parseCashInputDigits("500.000đ")).toBe(500_000)
  })
})

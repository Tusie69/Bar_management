import type { PayBillSummary, PayLine } from "./contracts"

/**
 * VAT 10% is still "theo cấu hình · chờ chốt TN-03" per Module 6 decision table.
 * Kept in one config constant so changing it does not touch screens.
 */
export const PAYMENT_VAT_CONFIG = {
  ratePercent: 10,
  label: "VAT 10%",
  pendingNote: "theo cấu hình · chờ chốt TN-03",
} as const

export interface BillTotals {
  subtotalVnd: number
  vatVnd: number
  preRoundVnd: number
  roundingVnd: number
  dueVnd: number
  itemCount: number
  makingCount: number
  cancelledCount: number
}

export interface ActiveBillRound {
  orderRound: number
  label: string
  meta: string
  items: PayLine[]
}

export type CashResult =
  | { state: "idle" }
  | { state: "short"; shortVnd: number }
  | { state: "exact" }
  | { state: "change"; changeVnd: number; givenVnd: number }

export function assertIntVnd(value: number, label = "amountVnd"): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} phải là số nguyên VND không âm`)
  }
  return value
}

/**
 * Module 6 fixed final rounding rule:
 * due = ceil(preRoundVnd / 1000) * 1000 using integer arithmetic only.
 */
export function roundDueVnd(preRoundVnd: number): number {
  assertIntVnd(preRoundVnd, "preRoundVnd")
  const rem = preRoundVnd % 1000
  return rem === 0 ? preRoundVnd : preRoundVnd + (1000 - rem)
}

/** Integer half-up VAT calculation without floating point. */
export function calcVatVnd(subtotalVnd: number): number {
  assertIntVnd(subtotalVnd, "subtotalVnd")
  return Math.floor((subtotalVnd * PAYMENT_VAT_CONFIG.ratePercent + 50) / 100)
}

/**
 * Counts active (non-cancelled) items and making items without computing money totals.
 */
export function countActiveLines(lines: readonly PayLine[]): {
  itemCount: number
  makingCount: number
  cancelledCount: number
} {
  let itemCount = 0
  let makingCount = 0
  let cancelledCount = 0
  for (const line of lines) {
    if (line.state === "CANCELLED") {
      cancelledCount += 1
      continue
    }
    itemCount += line.qty
    if (line.state === "MAKING") makingCount += 1
  }
  return { itemCount, makingCount, cancelledCount }
}

/**
 * Computes bill totals in integer VND.
 * Cancelled lines are completely excluded from subtotal, VAT, item count, and due.
 */
export function calcBillTotals(lines: readonly PayLine[]): BillTotals {
  let subtotalVnd = 0
  let itemCount = 0
  let makingCount = 0
  let cancelledCount = 0

  for (const line of lines) {
    if (line.state === "CANCELLED") {
      cancelledCount += 1
      continue
    }
    const lineTotal = assertIntVnd(line.lineTotalVnd, "lineTotalVnd")
    subtotalVnd += lineTotal
    itemCount += line.qty
    if (line.state === "MAKING") makingCount += 1
  }

  const vatVnd = calcVatVnd(subtotalVnd)
  const preRoundVnd = subtotalVnd + vatVnd
  const dueVnd = roundDueVnd(preRoundVnd)
  const roundingVnd = dueVnd - preRoundVnd

  return {
    subtotalVnd,
    vatVnd,
    preRoundVnd,
    roundingVnd,
    dueVnd,
    itemCount,
    makingCount,
    cancelledCount,
  }
}

/**
 * Groups bill lines by orderRound, hiding cancelled items completely and
 * omitting any round that contains only cancelled items.
 */
export function groupActiveRounds(lines: readonly PayLine[]): ActiveBillRound[] {
  const byRound = new Map<number, PayLine[]>()
  for (const line of lines) {
    if (line.state === "CANCELLED") continue
    const list = byRound.get(line.orderRound)
    if (list) list.push(line)
    else byRound.set(line.orderRound, [line])
  }

  return [...byRound.entries()]
    .sort(([a], [b]) => a - b)
    .map(([orderRound, items]) => {
      const first = items[0]
      const metaParts = [first?.roundTime, first?.roundBy].filter(Boolean)
      return {
        orderRound,
        label: `Đợt ${orderRound}`,
        meta: metaParts.join(" · "),
        items,
      }
    })
}

/**
 * S1 session list sort order:
 * 1. AWAITING_PAYMENT first
 * 2. Sessions where waiter requested payment (requestedAt set)
 * 3. Remaining open sessions
 */
export function sortOpenBills<
  T extends Pick<PayBillSummary, "status" | "requestedAt">,
>(bills: readonly T[]): T[] {
  const rank = (b: T) => (b.status === "AWAITING_PAYMENT" ? 0 : b.requestedAt ? 1 : 2)
  return bills
    .map((item, idx) => ({ item, idx }))
    .sort((a, b) => rank(a.item) - rank(b.item) || a.idx - b.idx)
    .map((x) => x.item)
}

export function formatNumberVnd(amountVnd: number): string {
  const int = Math.trunc(amountVnd)
  const sign = int < 0 ? "-" : ""
  const digits = String(Math.abs(int)).replace(/\B(?=(\d{3})+(?!\d))/g, ".")
  return `${sign}${digits}`
}

export function formatVnd(amountVnd: number): string {
  return `${formatNumberVnd(amountVnd)}đ`
}

/** Compact tile badge amount: e.g. 389k, 3,04tr (integer math only). */
export function formatCompactVnd(amountVnd: number): string {
  const v = Math.max(0, Math.trunc(amountVnd))
  if (v >= 1_000_000) {
    const hundredths = Math.floor((v + 5_000) / 10_000)
    const whole = Math.floor(hundredths / 100)
    const dec = hundredths % 100
    if (dec === 0) return `${whole}tr`
    const decStr = String(dec).padStart(2, "0").replace(/0+$/, "")
    return `${whole},${decStr}tr`
  }
  return `${Math.floor((v + 500) / 1000)}k`
}

/** Quick cash denominator chips: exact due first, then rounded steps up to 6 values. */
export function quickCashAmounts(dueVnd: number): number[] {
  assertIntVnd(dueVnd, "dueVnd")
  if (dueVnd === 0) return [0]
  const out = [dueVnd]
  const steps = [50_000, 100_000, 200_000, 500_000, 1_000_000]
  for (const step of steps) {
    const rem = dueVnd % step
    const v = rem === 0 ? dueVnd : dueVnd + (step - rem)
    if (v > dueVnd && !out.includes(v)) out.push(v)
  }
  if (out.length < 6) {
    const millionFloor = Math.floor((dueVnd + 999_999) / 1_000_000)
    const nextMillion = (millionFloor + 1) * 1_000_000
    if (!out.includes(nextMillion)) out.push(nextMillion)
  }
  return out.sort((a, b) => a - b).slice(0, 6)
}

export function evaluateCashInput(dueVnd: number, givenVnd: number | null): CashResult {
  assertIntVnd(dueVnd, "dueVnd")
  if (givenVnd === null) return { state: "idle" }
  assertIntVnd(givenVnd, "givenVnd")
  if (givenVnd < dueVnd) return { state: "short", shortVnd: dueVnd - givenVnd }
  if (givenVnd === dueVnd) return { state: "exact" }
  return { state: "change", changeVnd: givenVnd - dueVnd, givenVnd }
}

export function parseCashInputDigits(raw: string): number | null {
  const digits = raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 9)
  if (!digits) return null
  const n = Number(digits)
  return Number.isSafeInteger(n) ? n : null
}

/** Deterministic 29x29 demo QR grid matching the approved mockup. */
export function buildDemoQrGrid(seedInit = 21042): boolean[] {
  const n = 29
  const cells: boolean[] = []
  const finder = (r: number, c: number) => {
    const spots: [number, number][] = [
      [0, 0],
      [0, n - 7],
      [n - 7, 0],
    ]
    for (const [fr, fc] of spots) {
      if (r >= fr && r < fr + 7 && c >= fc && c < fc + 7) {
        const y = r - fr
        const x = c - fc
        return y === 0 || y === 6 || x === 0 || x === 6 || (y >= 2 && y <= 4 && x >= 2 && x <= 4) ? 1 : 0
      }
      if (r >= fr - 1 && r <= fr + 7 && c >= fc - 1 && c <= fc + 7) return 0
    }
    return -1
  }

  let seed = seedInit
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      const f = finder(r, c)
      let on: boolean
      if (f >= 0) on = f === 1
      else if (r === 6 || c === 6) on = (r + c) % 2 === 0
      else {
        seed = (seed * 1103515245 + 12345) % 2147483648
        on = seed % 7 < 3
      }
      cells.push(on)
    }
  }
  return cells
}

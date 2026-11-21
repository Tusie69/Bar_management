import { describe, expect, it } from "vitest"
import type { ClaimView, FloorTableState, WaiterVisitPhase } from "@/domain/models"
import { WAITER_PHASE_ORDER, WAITER_PHASE_TONE, waiterCellTones, waiterPhaseCounts } from "./waiter-phase"

function claim(visitId: number | null): ClaimView {
  return {
    kind: "visit",
    visitId,
    reservationId: null,
    waitlistEntryId: null,
    holdId: null,
    displayName: "",
    phoneLast3: null,
    partySize: 4,
    startsAt: new Date("2026-11-22T13:00:00.000Z"),
    deadlineAt: null,
    paid: false,
    origin: null,
    tableIds: [],
    groupId: null,
    symbolNo: null,
    groupDisplayCode: null,
    turnNo: null,
    flags: [],
    warning: null,
    minutesLate: 0,
    sourceCode: null,
    note: null,
    version: 1,
    lateConfirmedAt: null,
    canCall: false,
  }
}

function table(
  tableId: number,
  waiterPhase: WaiterVisitPhase | null,
  visitId: number | null = tableId,
): FloorTableState {
  return {
    tableId,
    state: waiterPhase === null ? "free" : "seated",
    claim: waiterPhase === null ? null : claim(visitId),
    staleFromPreviousDay: false,
    waiterPhase,
  }
}

function floor(...tables: FloorTableState[]): Map<number, FloorTableState> {
  return new Map(tables.map((entry) => [entry.tableId, entry]))
}

describe("waiterCellTones", () => {
  it("chỉ ô bàn có khách mới có tông riêng", () => {
    const tones = waiterCellTones(floor(table(1, "DINING"), table(2, null), table(3, "AWAITING_FOOD")))
    expect(tones.get(1)).toBe(WAITER_PHASE_TONE.DINING)
    expect(tones.get(3)).toBe(WAITER_PHASE_TONE.AWAITING_FOOD)
    expect(tones.has(2)).toBe(false)
  })

  it("sơ đồ không có khách nào thì không có tông nào", () => {
    expect(waiterCellTones(floor(table(1, null), table(2, null))).size).toBe(0)
  })
})

describe("waiterPhaseCounts", () => {
  /**
   * Con số trong chú giải trả lời đúng một câu: tối nay còn mấy bàn phải để
   * mắt tới. Một cụm bốn bàn ghép là MỘT đoàn khách, nên đếm theo ô bàn sẽ
   * báo 4 cho một câu trả lời đúng là 1.
   */
  it("cụm bàn ghép đếm một lần, không đếm theo số ô bàn", () => {
    const counts = waiterPhaseCounts(
      floor(table(11, "DINING", 9001), table(12, "DINING", 9001), table(13, "DINING", 9002)),
    )
    expect(counts.DINING).toBe(2)
  })

  it("đếm riêng từng trạng thái và bỏ qua bàn trống", () => {
    const counts = waiterPhaseCounts(
      floor(table(1, "ARRIVED"), table(2, "ORDERING"), table(3, "PAYMENT"), table(4, null)),
    )
    expect(counts).toEqual({ ARRIVED: 1, ORDERING: 1, AWAITING_FOOD: 0, DINING: 0, PAYMENT: 1, CHECKED_OUT: 0 })
  })

  it("bàn có khách nhưng chưa có visitId vẫn được đếm theo ô bàn", () => {
    const counts = waiterPhaseCounts(floor(table(1, "ARRIVED", null), table(2, "ARRIVED", null)))
    expect(counts.ARRIVED).toBe(2)
  })
})

describe("bảng màu sáu trạng thái", () => {
  it("đủ sáu trạng thái, không trùng màu", () => {
    expect(WAITER_PHASE_ORDER).toHaveLength(6)
    const colors = new Set(WAITER_PHASE_ORDER.map((phase) => WAITER_PHASE_TONE[phase].color))
    expect(colors.size).toBe(6)
  })

  /**
   * Nhãn ngắn in trong ô bàn rộng chừng 56px. Dài hơn là chữ tràn ra ngoài
   * viền, và lúc đó không đọc được cái nào cả.
   */
  it("nhãn ngắn vừa bề ngang một ô bàn", () => {
    for (const phase of WAITER_PHASE_ORDER) {
      expect(WAITER_PHASE_TONE[phase].short.length).toBeLessThanOrEqual(11)
    }
  })
})

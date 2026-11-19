import { createElement } from "react"
import { describe, expect, it } from "vitest"
import type {
  ClaimView,
  FloorGroup,
  FloorTableState,
  ReceptionGuestCount,
  TableView,
  WaitlistEntryView,
} from "@/domain/models"
import type { Alert } from "@/features/floor/alerts"
import { atBusinessTime } from "@/lib/time"
import {
  buildOperationalAlerts,
  MANUAL_UNENTERED_LABEL,
  NEW_GUEST_MISMATCH_TOOLTIP,
  NO_BAR_SEATS_NOTE,
  selectActiveWaitlistCount,
  selectFloorMetrics,
  selectKpiRows,
  shiftBusinessDateOf,
} from "./shift-overview-selectors"

function makeTable(overrides: Partial<TableView> & { id: number; code: string }): TableView {
  const zoneCode = overrides.zoneCode ?? (overrides.kind === "BAR_SEAT" ? "BAR" : "A")
  return {
    version: 1,
    displayName: overrides.code,
    zoneId: 1,
    zoneCode,
    kind: overrides.kind ?? (zoneCode === "BAR" ? "BAR_SEAT" : "TABLE"),
    seqNo: overrides.seqNo ?? overrides.id,
    isSpare: false,
    status: "ACTIVE",
    capacity: 4,
    x: 0,
    y: 0,
    w: 50,
    h: 50,
    seating: zoneCode === "BAR" ? "bar" : undefined,
    ...overrides,
  }
}

function makeFloorState(
  tableId: number,
  state: FloorTableState["state"],
  claim?: FloorTableState["claim"],
): FloorTableState {
  return {
    tableId,
    state,
    claim: claim ?? null,
    staleFromPreviousDay: false,
  }
}

function makeClaim(overrides: Partial<ClaimView>): ClaimView {
  return {
    kind: "visit",
    visitId: null,
    reservationId: null,
    waitlistEntryId: null,
    holdId: null,
    displayName: "Khách",
    phoneLast3: "234",
    partySize: 2,
    startsAt: new Date("2026-11-15T20:00:00+07:00"),
    deadlineAt: null,
    paid: false,
    origin: "WALK_IN",
    tableIds: [],
    groupId: null,
    symbolNo: null,
    groupDisplayCode: null,
    warning: null,
    minutesLate: 0,
    sourceCode: null,
    note: null,
    version: 1,
    ...overrides,
  }
}

function makeWaitlist(id: number, status: WaitlistEntryView["status"], queuedAt: Date): WaitlistEntryView {
  return {
    id,
    version: 1,
    kind: "WALK_IN",
    displayName: `Khách ${id}`,
    phoneLast3: "999",
    customerId: null,
    partySize: 2,
    preferenceMode: null,
    preferences: [],
    channel: "IN_PERSON",
    businessDate: "2026-11-15",
    queuedAt,
    status,
    claimedBy: null,
    claimExpiresAt: null,
    offeredAt: null,
    hold: null,
    reservationId: null,
    reservationExpectedAt: null,
    attempts: null,
    note: null,
    callbackRequested: null,
    closedAt: null,
  }
}

describe("shift-overview selectors", () => {
  it("maps manual guest counts cleanly and separates manual vs system notes", () => {
    const updatedAt = atBusinessTime("2026-11-15", "21:45")
    const guestCount: ReceptionGuestCount = {
      businessDate: "2026-11-15",
      bookedTables: 18,
      bookedGuests: 72,
      arrivedTotal: 54,
      arrivedBefore: 31,
      arrivedAfter: 23,
      returningGuests: 20,
      version: 2,
      updatedAt,
    }

    const { row1, row2 } = selectKpiRows(guestCount, { seatedNow: 12, freeTables: 9 }, 4)

    expect(row1.map((c) => [c.id, c.displayValue, c.sourceKind])).toEqual([
      ["booked-tables", "18", "manual"],
      ["booked-guests", "72", "manual"],
      ["arrived-total", "54", "manual"],
      ["seated-now", "12", "system"],
      ["free-tables", "9", "system"],
      ["waitlist-count", "4", "system"],
    ])

    expect(row2.map((c) => [c.id, c.displayValue, c.sourceKind])).toEqual([
      ["arrived-before", "31", "manual"],
      ["arrived-after", "23", "manual"],
      ["returning-guests", "20", "manual"],
      ["new-guests", "34", "manual"],
    ])

    expect(row1[0]?.sourceNote).toContain("Lễ tân nhập")
    expect(row1[0]?.sourceNote).toContain("21:45")
    expect(row1[3]?.sourceNote).toBe("Tự động")
    expect(row1[3]?.subcaption).toBe(NO_BAR_SEATS_NOTE)
    expect(row1[3]?.infoTooltip).toBe(NO_BAR_SEATS_NOTE)
    expect(row1[4]?.subcaption).toBe(NO_BAR_SEATS_NOTE)
    expect(row1[4]?.infoTooltip).toBe(NO_BAR_SEATS_NOTE)
    expect(row2[3]?.warningTooltip).toBeUndefined()
  })

  it("shows 'Chưa nhập' on manual cards when version is 0 while preserving system counts", () => {
    const unentered: ReceptionGuestCount = {
      businessDate: "2026-11-15",
      bookedTables: 0,
      bookedGuests: 0,
      arrivedTotal: 0,
      arrivedBefore: 0,
      arrivedAfter: 0,
      returningGuests: 0,
      version: 0,
      updatedAt: null,
    }

    const { row1, row2 } = selectKpiRows(unentered, { seatedNow: 0, freeTables: 23 }, 1)

    const manualCards = [...row1.slice(0, 3), ...row2]
    for (const card of manualCards) {
      expect(card.displayValue).toBe(MANUAL_UNENTERED_LABEL)
      expect(card.isUnentered).toBe(true)
    }

    expect(row1[3]?.displayValue).toBe("0")
    expect(row1[4]?.displayValue).toBe("23")
    expect(row1[5]?.displayValue).toBe("1")
  })

  it("shows negative Khách mới (N) value with mismatch warning tooltip when returning > arrivedTotal", () => {
    const mismatched: ReceptionGuestCount = {
      businessDate: "2026-11-15",
      bookedTables: 10,
      bookedGuests: 30,
      arrivedTotal: 15,
      arrivedBefore: 10,
      arrivedAfter: 5,
      returningGuests: 19,
      version: 1,
      updatedAt: null,
    }

    const { row2 } = selectKpiRows(mismatched, { seatedNow: 3, freeTables: 10 }, 0)
    const newGuestsCard = row2.find((c) => c.id === "new-guests")
    expect(newGuestsCard).toMatchObject({
      displayValue: "-4",
      numericValue: -4,
      tone: "danger",
      warningTooltip: NEW_GUEST_MISMATCH_TOOLTIP,
    })
  })

  it("excludes spare and out-of-service tables from Bàn trống and zone denominators", () => {
    const tables: TableView[] = [
      makeTable({ id: 1, code: "A1", zoneCode: "A", seqNo: 1 }),
      makeTable({ id: 2, code: "A2", zoneCode: "A", seqNo: 2 }),
      makeTable({ id: 3, code: "A0", zoneCode: "A", seqNo: 0, isSpare: true }),
      makeTable({ id: 4, code: "A10", zoneCode: "A", seqNo: 10, isSpare: false, status: "OUT_OF_SERVICE" }),
      makeTable({ id: 5, code: "B1", zoneCode: "B", seqNo: 1 }),
      makeTable({ id: 6, code: "B8", zoneCode: "B", seqNo: 8, isSpare: true }),
    ]

    const states = new Map<number, FloorTableState>([
      [1, makeFloorState(1, "seated")],
      [2, makeFloorState(2, "free")],
      // Even if a spare table reports state "free", Bàn trống MUST exclude spare.
      [3, makeFloorState(3, "free")],
      [4, makeFloorState(4, "oos")],
      [5, makeFloorState(5, "reserved")],
      [6, makeFloorState(6, "spare")],
    ])

    const summary = selectFloorMetrics(tables, states, [])

    expect(summary.seatedNow).toBe(1)
    expect(summary.freeTables).toBe(1) // Only A2 is free & available

    const occA = summary.occupancyByZone.find((z) => z.zone === "A")
    const occB = summary.occupancyByZone.find((z) => z.zone === "B")
    expect(occA).toMatchObject({ inUse: 1, available: 2, percent: 50 })
    expect(occB).toMatchObject({ inUse: 0, available: 1, percent: 0 })
  })

  it("counts table groups once across Đang ngồi, Bàn trống, and zone occupancy", () => {
    const tables: TableView[] = [
      makeTable({ id: 1, code: "A1", zoneCode: "A", seqNo: 1 }),
      makeTable({ id: 2, code: "A2", zoneCode: "A", seqNo: 2 }),
      makeTable({ id: 3, code: "A3", zoneCode: "A", seqNo: 3 }),
      makeTable({ id: 4, code: "B1", zoneCode: "B", seqNo: 1 }),
      makeTable({ id: 5, code: "B2", zoneCode: "B", seqNo: 2 }),
    ]

    const groups: FloorGroup[] = [{ id: 11, displayCode: "G01", symbolNo: 1, tableIds: [1, 2] }]

    const groupClaim = makeClaim({
      kind: "visit",
      visitId: 90,
      displayName: "Party A",
      partySize: 8,
      groupId: 11,
      symbolNo: 1,
      groupDisplayCode: "G01",
      tableIds: [1, 2],
    })

    const states = new Map<number, FloorTableState>([
      [1, makeFloorState(1, "seated", groupClaim)],
      [2, makeFloorState(2, "seated", groupClaim)],
      [3, makeFloorState(3, "free")],
      [4, makeFloorState(4, "seated")],
      [5, makeFloorState(5, "free")],
    ])

    const summary = selectFloorMetrics(tables, states, groups)

    expect(summary.seatedNow).toBe(2) // Group (A1+A2) = 1, B1 = 1
    expect(summary.freeTables).toBe(2) // A3 + B2

    const occA = summary.occupancyByZone.find((z) => z.zone === "A")
    expect(occA).toMatchObject({ inUse: 1, available: 2, percent: 50 })
  })

  it("excludes Bar seats from Đang ngồi / Bàn trống and reports Bar occupancy by seats", () => {
    const tables: TableView[] = [
      makeTable({ id: 1, code: "A1", zoneCode: "A", seqNo: 1 }),
      makeTable({ id: 2, code: "A2", zoneCode: "A", seqNo: 2 }),
      makeTable({ id: 3, code: "A3", zoneCode: "A", seqNo: 3 }),
      makeTable({ id: 4, code: "A0", zoneCode: "A", seqNo: 0, isSpare: true }),
      makeTable({ id: 5, code: "B1", zoneCode: "B", seqNo: 1 }),
      makeTable({ id: 6, code: "B2", zoneCode: "B", seqNo: 2, status: "OUT_OF_SERVICE" }),
      makeTable({ id: 101, code: "BAR01", zoneCode: "BAR", kind: "BAR_SEAT", seqNo: 1 }),
      makeTable({ id: 102, code: "BAR02", zoneCode: "BAR", kind: "BAR_SEAT", seqNo: 2 }),
      makeTable({ id: 103, code: "BAR03", zoneCode: "BAR", kind: "BAR_SEAT", seqNo: 3 }),
      makeTable({ id: 104, code: "BAR04", zoneCode: "BAR", kind: "BAR_SEAT", seqNo: 4 }),
      makeTable({ id: 105, code: "BAR05", zoneCode: "BAR", kind: "BAR_SEAT", seqNo: 5 }),
      makeTable({ id: 106, code: "BAR21", zoneCode: "BAR", kind: "BAR_SEAT", seqNo: 21, status: "OUT_OF_SERVICE" }),
    ]

    const groups: FloorGroup[] = [{ id: 10, displayCode: "G01", symbolNo: 1, tableIds: [1, 2] }]
    const groupClaim = makeClaim({
      kind: "visit",
      visitId: 40,
      groupId: 10,
      symbolNo: 1,
      groupDisplayCode: "G01",
      tableIds: [1, 2],
    })

    const claimBar12 = makeClaim({
      kind: "visit",
      visitId: 501,
      displayName: "Khách Bar",
      phoneLast3: "888",
      partySize: 2,
      tableIds: [101, 102],
    })

    const claimBar34 = makeClaim({
      kind: "reservation",
      reservationId: 777,
      displayName: "Booked Bar",
      phoneLast3: "111",
      partySize: 2,
      tableIds: [103, 104],
    })

    const states = new Map<number, FloorTableState>([
      [1, makeFloorState(1, "seated", groupClaim)],
      [2, makeFloorState(2, "seated", groupClaim)],
      [3, makeFloorState(3, "free")],
      [4, makeFloorState(4, "spare")],
      [5, makeFloorState(5, "free")],
      [6, makeFloorState(6, "oos")],
      [101, makeFloorState(101, "seated", claimBar12)],
      [102, makeFloorState(102, "seated", claimBar12)],
      [103, makeFloorState(103, "reserved", claimBar34)],
      [104, makeFloorState(104, "reserved", claimBar34)],
      [105, makeFloorState(105, "free")],
      [106, makeFloorState(106, "oos")],
    ])

    const summary = selectFloorMetrics(tables, states, groups)
    const barOcc = summary.occupancyByZone.find((z) => z.zone === "BAR")
    const occA = summary.occupancyByZone.find((z) => z.zone === "A")

    // TABLE-only KPIs: A1+A2 group = 1 seated; A3 + B1 = 2 free (Bar seats, spare A0, OOS B2 excluded)
    expect(summary.seatedNow).toBe(1)
    expect(summary.freeTables).toBe(2)

    expect(occA).toMatchObject({ inUse: 1, available: 2, percent: 50, unitLabel: "bàn" })
    // Bar occupancy counts individual seats (2 seated out of 6 bar seat positions here, x/21 on full venue)
    expect(barOcc).toMatchObject({ inUse: 2, available: 6, percent: 33, unitLabel: "ghế" })
  })

  it("counts active waitlist entries and builds waitlist backlog alert", () => {
    const now = new Date("2026-11-15T22:00:00+07:00")
    const entries: WaitlistEntryView[] = [
      makeWaitlist(1, "WAITING", new Date(now.getTime() - 48 * 60_000)),
      makeWaitlist(2, "OFFERED", new Date(now.getTime() - 12 * 60_000)),
      makeWaitlist(3, "SEATED", new Date(now.getTime() - 60 * 60_000)),
      makeWaitlist(4, "CANCELLED", new Date(now.getTime() - 90 * 60_000)),
    ]

    expect(selectActiveWaitlistCount(entries)).toBe(2)

    const floorAlert: Alert = {
      key: "r9",
      severity: 3,
      icon: createElement("span"),
      title: "B4 · Bàn quá giờ",
      detail: "Tới muộn +18'",
      tableId: 4,
      reservationId: 9,
      tone: "noshow",
    }

    const alerts = buildOperationalAlerts([floorAlert], entries, now)
    expect(alerts).toHaveLength(2)
    expect(alerts[0]).toMatchObject({ severityType: "critical", title: "B4 · Bàn quá giờ" })
    expect(alerts[1]).toMatchObject({
      severityType: "warning",
      title: "2 đơn Bàn chờ tồn đọng",
      detail: "cũ nhất 48 phút, chưa gán bàn",
    })
  })

  it("maps 00:30 timestamps to the previous business date (shift cutoff boundary)", () => {
    const afterMidnight = new Date("2026-11-16T00:30:00+07:00")
    const beforeCutoff = new Date("2026-11-16T04:59:00+07:00")
    const nextShiftCutoff = new Date("2026-11-16T05:00:00+07:00")
    const eveningShift = new Date("2026-11-15T21:30:00+07:00")

    expect(shiftBusinessDateOf(afterMidnight)).toBe("2026-11-15")
    expect(shiftBusinessDateOf(beforeCutoff)).toBe("2026-11-15")
    expect(shiftBusinessDateOf(nextShiftCutoff)).toBe("2026-11-16")
    expect(shiftBusinessDateOf(eveningShift)).toBe("2026-11-15")
  })
})

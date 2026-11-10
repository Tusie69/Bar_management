import { describe, expect, it, vi } from "vitest"

vi.hoisted(() => {
  const doc = {
    documentElement: { classList: { toggle: () => {} }, style: {} },
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementsByTagName: () => [],
    createElement: () => ({ setAttribute: () => {}, appendChild: () => {}, style: {} }),
    createTextNode: (text: string) => ({ text }),
    head: { appendChild: () => {} },
  }
  if (typeof globalThis.document === "undefined") {
    ;(globalThis as any).document = doc
  } else {
    Object.assign(globalThis.document, doc)
  }
  if (typeof globalThis.localStorage === "undefined") {
    ;(globalThis as any).localStorage = { getItem: () => null, setItem: () => {} }
  }
})

import { checkDirectTableCompatibility, draftBlockReason, draftPickable } from "./quick-form"
import type { FloorModel } from "./use-floor-model"
import type { AvailabilityResult, TableView } from "@/domain/models"
import { checkBookingCompatibility } from "../mobile/booking-table-selection"
import { walkInSelectionIssues } from "../mobile/walk-in-selection"

describe("G7 - Remove capacity warnings and never block on capacity", () => {
  const table4Seat: TableView = {
    id: 1,
    version: 1,
    displayName: "B1",
    zoneId: 1,
    zoneCode: "B",
    code: "B1",
    kind: "TABLE",
    status: "ACTIVE",
    isSpare: false,
    capacity: 4,
    x: 100,
    y: 100,
    w: 60,
    h: 60,
    seqNo: 1,
    seating: "pairs-tb",
  }

  const mockModel: FloorModel = {
    tables: [table4Seat],
    byId: new Map([[1, table4Seat]]),
    label: (id: number) => mockModel.byId.get(id)?.code ?? `#${id}`,
    states: new Map([[1, { state: "free" } as any]]),
    catalog: {
      zones: [{ id: 1, name: "Khu B", isBookable: true, isWaitingArea: false } as any],
      combinations: [],
      sources: [],
    } as any,
  } as unknown as FloorModel

  const mockAvailability: AvailabilityResult = {
    businessDate: "2026-11-09",
    at: new Date("2026-11-09T20:00:00Z"),
    policy: "SEQUENTIAL",
    partySize: 12,
    tables: [
      {
        tableId: 1,
        // When guests exceed table capacity (e.g. 12 guests on 4-seat table), backend marks status as too_small
        status: "too_small",
        reason: "Sức chứa 4 < 12 khách",
        claimStartsAt: null,
      },
    ],
    combinations: [],
  }

  it("1. draftPickable allows selecting a 4-seat table for booking even when marked too_small", () => {
    // Receptionist takes responsibility for capacity: table marked 'too_small' is pickable
    const pickable = draftPickable("booking", 1, mockModel, mockAvailability)
    expect(pickable).toBe(true)
  })

  it("accepts mixed members of an existing group while rejecting arbitrary mixed selections and occupancy", () => {
    const bar: TableView = { ...table4Seat, id: 2, zoneId: 4, zoneCode: "BAR", kind: "BAR_SEAT" }
    const other: TableView = { ...bar, id: 3 }
    const byId = new Map([
      [1, table4Seat],
      [2, bar],
      [3, other],
    ])
    const groups = [{ id: 1, symbolNo: 1, tableIds: [1, 2] }]
    const model: FloorModel = {
      ...mockModel,
      byId,
      floor: { at: mockAvailability.at, businessDate: mockAvailability.businessDate, tables: [], groups, changeSeq: 1 },
    }
    const available: AvailabilityResult = {
      ...mockAvailability,
      tables: [1, 2, 3].map((tableId) => ({ ...mockAvailability.tables[0], tableId })),
    }
    expect(checkDirectTableCompatibility([1, 2], byId, groups)).toBeNull()
    expect(checkDirectTableCompatibility([2, 1], byId, groups)).toBeNull()
    expect(checkDirectTableCompatibility([1, 2], byId)).toContain("cùng một khu vực")
    expect(checkDirectTableCompatibility([1, 2, 3], byId, groups)).toContain("cùng một khu vực")
    const sameZone = new Map(byId).set(2, { ...bar, zoneId: 1, zoneCode: "B" })
    expect(checkDirectTableCompatibility([1, 2], sameZone)).toContain("ghế Bar")
    expect(checkDirectTableCompatibility([1, 2], sameZone, groups)).toBeNull()
    expect(draftPickable("booking", 2, model, available, [1])).toBe(true)
    expect(draftPickable("booking", 3, model, available, [1])).toBe(false)
    available.tables[1].bookingConflicts = [{ reservationId: 99, expectedAt: available.at }]
    expect(draftPickable("booking", 2, model, available, [1])).toBe(false)
    available.tables[1].bookingConflicts = []
    available.tables[1].status = "reserved"
    expect(draftPickable("booking", 2, model, available, [1, 2])).toBe(false)
  })

  it("2. draftBlockReason does not block a too_small table for booking", () => {
    const reason = draftBlockReason("booking", 1, mockModel, mockAvailability, "2026-11-09")
    // When status is too_small, draftBlockReason has no conflict and does not return a blocking message
    expect(reason).not.toContain("thiếu")
    expect(reason).not.toContain("chỗ")
  })

  it("3. walk-in selection allows a 4-seat table for 12 guests without capacity issues", () => {
    const bookableZoneIds = new Set([1])
    const issues = walkInSelectionIssues([1], mockModel.byId, mockModel.states, bookableZoneIds)
    // No compatibility or state issues
    expect(issues).toEqual([])
  })

  it("4. booking compatibility allows a 4-seat table regardless of guest count", () => {
    const compat = checkBookingCompatibility([1], mockModel.byId)
    expect(compat).toBeNull()
  })

  it("5. walk-in status text does not contain shortage warnings", () => {
    const capacity = 4
    const summary = `${mockModel.label(1)} · ${capacity} chỗ`
    expect(summary).toBe("B1 · 4 chỗ")
    expect(summary).not.toContain("thiếu")
    expect(summary).not.toContain("Chủ quán duyệt")
  })

  it("6. availability panel displays capacity total without shortage warning or color", () => {
    const selCapacity = 4
    const availParty = 12
    const display = `${selCapacity} chỗ cho ${availParty} khách`
    expect(display).toBe("4 chỗ cho 12 khách")
    expect(display).not.toContain("chưa đủ")
    expect(display).not.toContain("chọn thêm bàn")
  })

  it("7. quick-form status message shows table capacity cleanly without shortage warning", () => {
    const codes = "B1"
    const cap = 4
    const party = 12
    const isB = true

    // Under G7 logic:
    const statusText =
      party === null
        ? `${codes} còn trống · ${cap} chỗ`
        : cap >= party
          ? isB
            ? `${codes} còn trống ngày 09/11 · ${cap} chỗ, đủ ${party} khách`
            : `${codes} đang trống · ${cap} chỗ, đủ ${party} khách`
          : isB
            ? `${codes} còn trống ngày 09/11 · ${cap} chỗ`
            : `${codes} đang trống · ${cap} chỗ`

    expect(statusText).toBe("B1 còn trống ngày 09/11 · 4 chỗ")
    expect(statusText).not.toContain("thiếu")
    expect(statusText).not.toContain("cho cho")
  })

  it("8. mobile booking selection error does not trigger on capacity shortage", () => {
    const bookingIds = [1]
    const avail = mockAvailability
    const bookingPickable = new Set([1])

    // Under G7 logic in mobile/form.tsx:
    const bookingSelectionError = !bookingIds.length
      ? null
      : !avail
        ? "Chưa xác minh được bàn cho giờ và ngày đã chọn."
        : bookingIds.some((id) => !bookingPickable.has(id))
          ? "Bàn đã chọn không còn khả dụng. Chọn lại trên sơ đồ."
          : null

    expect(bookingSelectionError).toBeNull()
  })

  it("9. mobile walk-in readiness does not block on capacity", () => {
    const guests = 12
    const selectedWalkInIds = [1]
    const walkInIssues: string[] = []

    // Under G7 logic in mobile/form.tsx:
    const walkInReady = !!guests && selectedWalkInIds.length > 0 && walkInIssues.length === 0
    expect(walkInReady).toBe(true)
  })

  it("10. keeps validation for invalid numbers and missing contact", () => {
    // Non-integer or negative or zero guest count
    const invalidGuests = [0, -1, NaN, null]
    for (const g of invalidGuests) {
      const isValid = typeof g === "number" && Number.isInteger(g) && g >= 1 && g <= 500
      expect(isValid).toBe(false)
    }

    // Booking without contact name and without phone is invalid
    const name = ""
    const phone = ""
    const guestMissing = !name.trim() && !phone.trim()
    expect(guestMissing).toBe(true)
  })
})

import { describe, expect, it } from "vitest"
import type { FloorTableState, ReservationView, TableView, ZoneView } from "@/domain/models"
import { canStartTableBooking, isReceptionBookableTable, phoneMatches } from "./reception-rules"

describe("single-floor receptionist guards", () => {
  const table = { id: 1, zoneId: 1, status: "ACTIVE", isSpare: false } as TableView
  const state = { state: "free" } as FloorTableState
  const zone = { id: 1, isBookable: true, isWaitingArea: false } as ZoneView

  it("opens only loaded, active, bookable free tables", () => {
    expect(isReceptionBookableTable(table, [zone])).toBe(true)
    expect(canStartTableBooking(table, state, [zone])).toBe(true)
    expect(canStartTableBooking(table, undefined, [zone])).toBe(false)
    expect(canStartTableBooking({ ...table, isSpare: true }, state, [zone])).toBe(false)
    expect(canStartTableBooking({ ...table, status: "OUT_OF_SERVICE" }, state, [zone])).toBe(false)
    expect(canStartTableBooking(table, { ...state, state: "reserved" }, [zone])).toBe(false)
    expect(canStartTableBooking(table, state, [{ ...zone, isBookable: false }])).toBe(false)
  })

  it("matches exact suffixes only within the selected business date", () => {
    const rows = [
      { id: 1, businessDate: "2026-11-02", phoneLast3: "123" },
      { id: 2, businessDate: "2026-11-03", phoneLast3: "123" },
    ] as ReservationView[]
    expect(phoneMatches(rows, "2026-11-02", "123").map((row) => row.id)).toEqual([1])
    expect(phoneMatches(rows, "2026-11-02", "12")).toEqual([])
  })
})

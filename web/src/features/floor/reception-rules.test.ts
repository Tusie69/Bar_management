import { describe, expect, it } from "vitest"
import type { FloorTableState, ReservationView, TableView, ZoneView } from "@/domain/models"
import { canStartTableBooking, isReceptionBookableTable, phoneMatches } from "./reception-rules"

describe("single-floor receptionist guards", () => {
  const table = { id: 1, zoneId: 1, status: "ACTIVE", isSpare: false } as TableView
  const state = { state: "free" } as FloorTableState
  const zone = { id: 1, isBookable: true, isWaitingArea: false } as ZoneView
  it("opens only loaded, active, bookable free tables", () => {
    expect(canStartTableBooking(table, state, [zone])).toBe(true)
    expect(canStartTableBooking(table, undefined, [zone])).toBe(false)
    expect(canStartTableBooking({ ...table, isSpare: true }, state, [zone])).toBe(false)
    expect(canStartTableBooking({ ...table, status: "OUT_OF_SERVICE" }, state, [zone])).toBe(false)
    expect(canStartTableBooking(table, { ...state, state: "reserved" }, [zone])).toBe(false)
    expect(canStartTableBooking(table, state, [{ ...zone, isBookable: false }])).toBe(false)
    expect(canStartTableBooking(table, state, [{ ...zone, isWaitingArea: true }])).toBe(false)
    expect(canStartTableBooking(undefined, state, [zone])).toBe(false)
    expect(canStartTableBooking(table, { ...state, state: "spare" }, [zone])).toBe(false)
    expect(canStartTableBooking(table, { ...state, state: "oos" }, [zone])).toBe(false)
  })
  it("retains a valid existing booking table for reassignment, without granting spare overrides", () => {
    expect(isReceptionBookableTable(table, [zone])).toBe(true)
    expect(canStartTableBooking(table, { ...state, state: "reserved" }, [zone])).toBe(false)
    expect(isReceptionBookableTable({ ...table, isSpare: true }, [zone])).toBe(false)
  })
  it("matches every exact phone suffix in the selected business date, never numeric names", () => {
    const rows = [
      { id: 1, businessDate: "2026-11-02", phoneLast3: "123", displayName: "First" },
      { id: 2, businessDate: "2026-11-02", phoneLast3: "123", displayName: "Second" },
      { id: 3, businessDate: "2026-11-03", phoneLast3: "123" },
      { id: 4, businessDate: "2026-11-02", phoneLast3: "999", displayName: "Guest 123" },
    ] as ReservationView[]
    expect(phoneMatches(rows, "2026-11-02", "123").map((row) => row.id)).toEqual([1, 2])
    expect(phoneMatches(rows, "2026-11-02", "12")).toEqual([])
    expect(phoneMatches(rows, "2026-11-02", "1234")).toEqual([])
  })
})

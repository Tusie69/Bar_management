import { describe, expect, it } from "vitest"
import type { TableAvailability, TableView } from "@/domain/models"
import { bookingTableCanSelect } from "./booking-table-selection"

const table = { id: 1, status: "ACTIVE", isSpare: false, zoneId: 1, kind: "TABLE" } as TableView
const row = (status: TableAvailability["status"]) => ({ status }) as TableAvailability

describe("booking map selection", () => {
  it.each(["available", "too_small"] as const)("allows %s tables so parties can combine capacity", (status) => {
    expect(bookingTableCanSelect(table, row(status), table)).toBe(true)
  })

  it.each(["reserved", "occupied_unknown_end", "oos", "spare", "not_bookable"] as const)("blocks %s", (status) => {
    expect(bookingTableCanSelect(table, row(status))).toBe(false)
  })

  it("requires a verified snapshot and preserves the direct booking grouping rules", () => {
    expect(bookingTableCanSelect(table)).toBe(false)
    expect(bookingTableCanSelect(table, row("available"), { ...table, zoneId: 2 })).toBe(false)
    expect(bookingTableCanSelect(table, row("available"), { ...table, kind: "BAR_SEAT" })).toBe(false)
  })
})

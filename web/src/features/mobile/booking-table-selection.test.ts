import { describe, expect, it } from "vitest"
import type { FloorTableState, TableAvailability, TableView } from "@/domain/models"
import {
  bookingSelectionIssues,
  bookingTableBadge,
  bookingTableBlockReason,
  isTableAvailableForBooking,
} from "./booking-table-selection"

const createTable = (patch: Partial<TableView> & Pick<TableView, "id" | "code">): TableView =>
  ({
    version: 1,
    displayName: patch.code,
    zoneId: 1,
    zoneCode: "A",
    kind: "TABLE",
    capacity: 4,
    seqNo: null,
    isSpare: false,
    status: "ACTIVE",
    x: 0,
    y: 0,
    w: 40,
    h: 30,
    seating: "four-sides",
    ...patch,
  }) as TableView

const createLiveState = (
  state: FloorTableState["state"],
  patch?: Partial<FloorTableState>,
): FloorTableState =>
  ({
    tableId: 1,
    state,
    claim: null,
    staleFromPreviousDay: false,
    ...patch,
  }) as FloorTableState

const createAvail = (
  status: TableAvailability["status"],
  patch?: Partial<TableAvailability>,
): TableAvailability =>
  ({
    tableId: 1,
    status,
    reason: "",
    claimStartsAt: null,
    ...patch,
  }) as TableAvailability

/** Simulates HEAD options computation: unconditionally unshifts preset into options without status check */
function computeOptionsHEAD(
  preset: number[],
  tables: TableView[],
  fitsIds: number[],
) {
  const list = tables
    .filter((t) => fitsIds.includes(t.id))
    .map((t) => ({ key: `t${t.id}`, ids: [t.id], label: t.code, sub: "4 chỗ" }))
  if (preset.length && !list.some((o) => o.ids.join() === preset.join())) {
    list.unshift({ key: "preset", ids: preset, label: `Table ${preset.join()}`, sub: "Chọn từ sơ đồ" })
  }
  return list
}

/** Simulates Fixed options computation: only unshifts preset if it is truly free/available */
function computeOptionsFixed(
  preset: number[],
  tables: TableView[],
  fitsIds: number[],
  isPresetFree: boolean,
) {
  const list = tables
    .filter((t) => fitsIds.includes(t.id))
    .map((t) => ({ key: `t${t.id}`, ids: [t.id], label: t.code, sub: "4 chỗ" }))
  if (preset.length && isPresetFree && !list.some((o) => o.ids.join() === preset.join())) {
    list.unshift({ key: "preset", ids: preset, label: `Table ${preset.join()}`, sub: "Chọn từ sơ đồ" })
  }
  return list
}

describe("S2 G4 - booking table selection & preset availability", () => {
  const bookableZones = new Set([1])

  it("1. free selectable: active, bookable, free table is available and offered", () => {
    const table = createTable({ id: 1, code: "B5", capacity: 4 })
    const live = createLiveState("free")
    const avail = createAvail("available")

    expect(isTableAvailableForBooking(table, live, avail, bookableZones, true, 4)).toBe(true)
    expect(bookingTableBlockReason(table, live, avail, bookableZones, true, 4)).toBeNull()

    const issues = bookingSelectionIssues(
      [1],
      new Map([[1, table]]),
      new Map([[1, live]]),
      new Map([[1, avail]]),
      bookableZones,
      true,
      4,
    )
    expect(issues).toEqual([])
  })

  it("2. reserved, held, upcoming, late_confirmed, noshow, occupied not offered as free", () => {
    const table = createTable({ id: 1, code: "B5", capacity: 4 })
    const blockedStates: Array<{
      state: FloorTableState["state"]
      expectedBadge: string
      expectedReasonRegex: RegExp
    }> = [
      { state: "reserved", expectedBadge: "Đã được giữ", expectedReasonRegex: /đã được giữ/ },
      { state: "hold", expectedBadge: "Đang được giữ", expectedReasonRegex: /đang được giữ/ },
      { state: "upcoming", expectedBadge: "Sắp đến", expectedReasonRegex: /sắp đến/ },
      { state: "late_confirmed", expectedBadge: "Trễ có xác nhận", expectedReasonRegex: /đã xác nhận/ },
      { state: "noshow", expectedBadge: "Không tới", expectedReasonRegex: /không tới/ },
      { state: "seated", expectedBadge: "Đang có khách", expectedReasonRegex: /đang có khách/ },
    ]

    for (const { state, expectedBadge, expectedReasonRegex } of blockedStates) {
      const live = createLiveState(state)
      const avail = createAvail(state === "seated" ? "occupied_unknown_end" : "reserved")

      // Not available for booking
      expect(isTableAvailableForBooking(table, live, avail, bookableZones, true, 4)).toBe(false)

      // Reason explains why
      const reason = bookingTableBlockReason(table, live, avail, bookableZones, true, 4)
      expect(reason).not.toBeNull()
      expect(reason).toMatch(expectedReasonRegex)

      // Badge matches standard
      expect(bookingTableBadge(table, live, avail, true)).toBe(expectedBadge)

      // Selection issues block saving
      const issues = bookingSelectionIssues(
        [1],
        new Map([[1, table]]),
        new Map([[1, live]]),
        new Map([[1, avail]]),
        bookableZones,
        true,
        4,
      )
      expect(issues.length).toBeGreaterThan(0)
      expect(issues[0]).toMatch(expectedReasonRegex)

      // HEAD regression comparison:
      // On HEAD, preset with this blocked state WAS erroneously included in options!
      const headOptions = computeOptionsHEAD([1], [table], [])
      expect(headOptions.some((o) => o.key === "preset")).toBe(true)

      // On Fixed, it is NOT included!
      const fixedOptions = computeOptionsFixed([1], [table], [], false)
      expect(fixedOptions.some((o) => o.key === "preset")).toBe(false)
    }
  })

  it("3. spare per current rules: spare tables are not offered for direct booking", () => {
    const spareTable = createTable({ id: 2, code: "A10", isSpare: true })
    const live = createLiveState("spare", { tableId: 2 })
    const avail = createAvail("spare", { tableId: 2 })

    expect(isTableAvailableForBooking(spareTable, live, avail, bookableZones, true, 4)).toBe(false)
    expect(bookingTableBadge(spareTable, live, avail, true)).toBe("Bàn sơ cua")

    const reason = bookingTableBlockReason(spareTable, live, avail, bookableZones, true, 4)
    expect(reason).toMatch(/bàn sơ cua/)

    const issues = bookingSelectionIssues(
      [2],
      new Map([[2, spareTable]]),
      new Map([[2, live]]),
      new Map([[2, avail]]),
      bookableZones,
      true,
      4,
    )
    expect(issues[0]).toMatch(/bàn sơ cua/)
  })

  it("4. preset still shown when truly free", () => {
    const table = createTable({ id: 1, code: "B5", capacity: 4 })
    const live = createLiveState("free")
    const avail = createAvail("available")

    const isFree = isTableAvailableForBooking(table, live, avail, bookableZones, true, 4)
    expect(isFree).toBe(true)

    const fixedOptions = computeOptionsFixed([1], [table], [], isFree)
    expect(fixedOptions.some((o) => o.key === "preset")).toBe(true)
    expect(fixedOptions[0].sub).toBe("Chọn từ sơ đồ")
  })

  it("5. state changing while the form is open: table becomes held, stops submit and leaves options", () => {
    const tableB5 = createTable({ id: 5, code: "B5", capacity: 4 })
    const tableB6 = createTable({ id: 6, code: "B6", capacity: 4 })
    const byId = new Map([
      [5, tableB5],
      [6, tableB6],
    ])

    // Step 1: Initial state - B5 is free
    let liveB5 = createLiveState("free", { tableId: 5 })
    let availB5 = createAvail("available", { tableId: 5 })
    let liveMap = new Map([
      [5, liveB5],
      [6, createLiveState("free", { tableId: 6 })],
    ])
    let availMap = new Map([
      [5, availB5],
      [6, createAvail("available", { tableId: 6 })],
    ])

    expect(isTableAvailableForBooking(tableB5, liveB5, availB5, bookableZones, true, 4)).toBe(true)
    let options = computeOptionsFixed(
      [5],
      [tableB5, tableB6],
      [6],
      isTableAvailableForBooking(tableB5, liveB5, availB5, bookableZones, true, 4),
    )
    expect(options.some((o) => o.ids.includes(5))).toBe(true)

    // Step 2: While form is open, B5 is taken (e.g. someone holds/books B5 at 23:00)
    liveB5 = createLiveState("reserved", { tableId: 5 })
    availB5 = createAvail("reserved", { tableId: 5, reason: "Đã giữ cho booking 23:00" })
    liveMap = new Map([
      [5, liveB5],
      [6, createLiveState("free", { tableId: 6 })],
    ])
    availMap = new Map([
      [5, availB5],
      [6, createAvail("available", { tableId: 6 })],
    ])

    // Fixed options no longer offers B5 under "Bàn trống"
    const isFreeAfterChange = isTableAvailableForBooking(tableB5, liveB5, availB5, bookableZones, true, 4)
    expect(isFreeAfterChange).toBe(false)

    options = computeOptionsFixed([5], [tableB5, tableB6], [6], isFreeAfterChange)
    expect(options.some((o) => o.ids.includes(5))).toBe(false)
    // Other free tables (B6) are still offered
    expect(options.some((o) => o.ids.includes(6))).toBe(true)

    // Attempting to submit B5 reports issue and stops save
    const issues = bookingSelectionIssues([5], byId, liveMap, availMap, bookableZones, true, 4)
    expect(issues.length).toBeGreaterThan(0)
    expect(issues[0]).toMatch(/đã được giữ|Đã giữ cho booking 23:00/)

    // Switching choice to free table B6 allows save
    const issuesB6 = bookingSelectionIssues([6], byId, liveMap, availMap, bookableZones, true, 4)
    expect(issuesB6).toEqual([])
  })

  it("6. date boundary isolation: table occupied today stays selectable tomorrow if availability allows", () => {
    // Today A3 is occupied with customers
    const tableA3 = createTable({ id: 3, code: "A3", capacity: 4 })
    const liveToday = createLiveState("seated", { tableId: 3 })
    // Tomorrow at 19:00, server availability query says A3 is available
    const availTomorrow = createAvail("available", { tableId: 3 })

    // For a booking on tomorrow (isSameBusinessDate === false):
    // Today's live seated state must NOT block tomorrow's booking!
    const availableTomorrow = isTableAvailableForBooking(
      tableA3,
      liveToday,
      availTomorrow,
      bookableZones,
      false, // booking date is tomorrow, not same business date
      4,
    )
    expect(availableTomorrow).toBe(true)

    const issues = bookingSelectionIssues(
      [3],
      new Map([[3, tableA3]]),
      new Map([[3, liveToday]]),
      new Map([[3, availTomorrow]]),
      bookableZones,
      false,
      4,
    )
    expect(issues).toEqual([])
  })

  it("7. date boundary isolation: table free today but unavailable tomorrow per availability is not offered as free", () => {
    // Today B3 is free on the live floor
    const tableB3 = createTable({ id: 33, code: "B3", capacity: 4 })
    const liveToday = createLiveState("free", { tableId: 33 })
    // Tomorrow, availability query says B3 is already reserved
    const availTomorrow = createAvail("reserved", {
      tableId: 33,
      reason: "Đã giữ cho booking ngày mai",
    })

    // For a booking on tomorrow (isSameBusinessDate === false):
    // Today's free status must NOT prove it free for tomorrow!
    const availableTomorrow = isTableAvailableForBooking(
      tableB3,
      liveToday,
      availTomorrow,
      bookableZones,
      false, // booking date is tomorrow, not same business date
      4,
    )
    expect(availableTomorrow).toBe(false)

    const reason = bookingTableBlockReason(
      tableB3,
      liveToday,
      availTomorrow,
      bookableZones,
      false,
      4,
    )
    expect(reason).toMatch(/Đã giữ cho booking ngày mai/)

    const issues = bookingSelectionIssues(
      [33],
      new Map([[33, tableB3]]),
      new Map([[33, liveToday]]),
      new Map([[33, availTomorrow]]),
      bookableZones,
      false,
      4,
    )
    expect(issues.length).toBeGreaterThan(0)
    expect(issues[0]).toMatch(/Đã giữ cho booking ngày mai/)
  })
})

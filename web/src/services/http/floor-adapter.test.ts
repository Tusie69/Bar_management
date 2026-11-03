import { describe, expect, it } from "vitest"
import { ApiError } from "../contracts"
import { deriveAvailability } from "./canonical-adapter"
import {
  mapCatalog,
  mapFloorProjection,
  mapFloorState,
  projectionState,
  type BackendBooking,
  type BackendCatalog,
  type BackendFloorProjection,
  type BackendFloorTableProjection,
  type BackendTableState,
} from "./floor-adapter"

const catalogPayload: BackendCatalog = {
  venue: {
    id: 1,
    version: 2,
    name: "21GAM",
    timezone: "Asia/Ho_Chi_Minh",
    businessDayStartLocal: "17:00:00",
    businessDayCutoffLocal: "05:00:00",
    upcomingWarningMinutes: 10,
    lateWarningMinutes: 15,
    noShowWarningMinutes: 30,
    waitlistHoldDefaultMinutes: 30,
    waitlistClaimLeaseSeconds: 300,
    reservationHoldPolicy: "SEQUENTIAL",
    reservationWindowMinutes: null,
    groupSymbolCount: 12,
    changeSeq: 8,
  },
  zones: [{ id: 1, version: 1, code: "A", name: "Khu A", isBookable: true, isWaitingArea: false }],
  tables: [
    {
      id: 1,
      version: 1,
      code: "A1",
      displayName: "Bàn A1",
      zoneId: 1,
      zoneCode: "A",
      kind: "TABLE",
      capacity: 4,
      seqNo: null,
      isSpare: false,
      status: "ACTIVE",
      x: 80,
      y: 654,
      width: 46,
      height: 32,
    },
    {
      id: 2,
      version: 3,
      code: "A10",
      displayName: "Bàn A10",
      zoneId: 1,
      zoneCode: "A",
      kind: "TABLE",
      capacity: 4,
      seqNo: null,
      isSpare: true,
      status: "ACTIVE",
      x: 231,
      y: 685,
      width: 38,
      height: 38,
    },
    {
      id: 3,
      version: 1,
      code: "A2",
      displayName: "Bàn A2",
      zoneId: 1,
      zoneCode: "A",
      kind: "TABLE",
      capacity: 4,
      seqNo: null,
      isSpare: false,
      status: "OUT_OF_SERVICE",
      x: 80,
      y: 609,
      width: 46,
      height: 32,
    },
  ],
  combinations: [],
}

const sources = [{ code: "HOTLINE", name: "Hotline" }]

function backendTable(
  overrides: Partial<BackendTableState> & Pick<BackendTableState, "id" | "code">,
): BackendTableState {
  return {
    state: "AVAILABLE",
    isBackup: false,
    activeVisit: null,
    ...overrides,
  }
}

describe("Phase 2A floor adapter", () => {
  it("maps every server display state and keeps spare independent from occupancy", () => {
    const projected = (displayState: BackendFloorTableProjection["displayState"], isSpare = false) =>
      projectionState({ displayState, isSpare, claim: null } as BackendFloorTableProjection)

    expect(projected("EMPTY")).toBe("free")
    expect(projected("EMPTY", true)).toBe("spare")
    expect(projected("BOOKED", true)).toBe("reserved")
    expect(projected("UPCOMING")).toBe("upcoming")
    expect(projected("LATE")).toBe("late")
    expect(projected("LATE_CONFIRMED")).toBe("late_confirmed")
    expect(projected("NO_SHOW")).toBe("noshow")
    expect(projected("IN_USE")).toBe("seated")
    expect(projected("OUT_OF_SERVICE")).toBe("oos")
  })

  it("maps the atomic NO_SHOW group projection without browser timing or private fields", () => {
    const catalog = mapCatalog(catalogPayload, sources)
    const claim = {
      kind: "RESERVATION" as const,
      reservationId: 11,
      visitId: null,
      waitlistEntryId: null,
      holdId: 41,
      guestName: "Khách đặt",
      phoneLast3: "123",
      partySize: 6,
      turnNo: null,
      flags: ["RETURNING" as const],
      groupId: 9,
      groupDisplayCode: "◆AA",
      groupMemberTableIds: [1, 2],
      startsAt: new Date("2026-10-28T12:30:00.000Z"),
      deadlineAt: null,
      holdOverdue: false,
      paid: false,
      origin: null,
      sourceCode: "HOTLINE",
      version: 3,
      phoneNumber: "+84901234123",
      note: "must not cross the adapter",
    }
    const projection: BackendFloorProjection = {
      businessDate: "2026-10-28",
      serverNow: "2026-10-28T13:00:00.000Z",
      changeSeq: "12",
      groups: [{ id: 9, symbolNo: 27, displayCode: "◆AA", tableIds: [1, 2] }],
      tables: [1, 2].map((tableId) => ({
        tableId,
        tableCode: tableId === 1 ? "A1" : "A10",
        catalogStatus: "ACTIVE",
        isSpare: false,
        displayState: "NO_SHOW",
        arrivalPhase: "NO_SHOW",
        arrivalTime: claim.startsAt,
        minutesLate: 30,
        claim,
        groupId: 9,
        groupDisplayCode: "◆AA",
        groupMemberTableIds: [1, 2],
        staleFromPreviousDay: false,
      })),
    }
    const floor = mapFloorProjection(projection, catalog)
    expect(floor.at).toEqual(new Date(projection.serverNow))
    expect(floor.changeSeq).toBe(12)
    expect(floor.tables.map((table) => table.state)).toEqual(["noshow", "noshow"])
    expect(floor.tables[0]?.claim).toMatchObject({
      reservationId: 11,
      phoneLast3: "123",
      tableIds: [1, 2],
      symbolNo: 27,
      groupDisplayCode: "◆AA",
      flags: ["RETURNING"],
      note: null,
    })
    expect(floor.tables[0]?.claim).not.toHaveProperty("phoneNumber")
  })

  it("keeps an overdue waitlist hold occupied without mapping it to NO_SHOW", () => {
    const catalog = mapCatalog(catalogPayload, sources)
    const projection: BackendFloorProjection = {
      businessDate: "2026-10-28",
      serverNow: "2026-10-28T13:00:00.000Z",
      changeSeq: "13",
      groups: [],
      tables: [
        {
          tableId: 1,
          tableCode: "A1",
          catalogStatus: "ACTIVE",
          isSpare: false,
          displayState: "BOOKED",
          arrivalPhase: null,
          arrivalTime: null,
          minutesLate: 0,
          claim: {
            kind: "WAITLIST_HOLD",
            reservationId: null,
            visitId: null,
            waitlistEntryId: 22,
            holdId: 42,
            guestName: "Khách chờ",
            phoneLast3: null,
            partySize: 2,
            turnNo: null,
            flags: [],
            groupId: null,
            groupDisplayCode: null,
            groupMemberTableIds: [],
            startsAt: new Date("2026-10-28T12:30:00.000Z"),
            deadlineAt: new Date("2026-10-28T12:45:00.000Z"),
            holdOverdue: true,
            paid: false,
            origin: null,
            sourceCode: null,
            version: 1,
          },
          groupId: null,
          groupDisplayCode: null,
          groupMemberTableIds: [],
          staleFromPreviousDay: false,
        },
      ],
    }
    expect(mapFloorProjection(projection, catalog).tables[0]).toMatchObject({
      state: "hold_overdue",
      claim: { kind: "waitlist_hold", waitlistEntryId: 22 },
    })
  })
  it("maps persisted catalog geometry, source codes, spare and out-of-service configuration", () => {
    const catalog = mapCatalog(catalogPayload, sources)

    expect(catalog.venue.name).toBe("21GAM")
    expect(catalog.sources).toEqual([{ id: null, code: "HOTLINE", name: "Hotline" }])
    expect(catalog.tables.find((table) => table.code === "A10")?.isSpare).toBe(true)
    expect(catalog.tables.find((table) => table.code === "A2")?.status).toBe("OUT_OF_SERVICE")
    expect(catalog.tables[0]).toMatchObject({ x: 80, y: 654, w: 46, h: 32 })
  })

  it("fails closed when database geometry is missing instead of inventing coordinates", () => {
    const payload = structuredClone(catalogPayload)
    payload.tables[0]!.x = null

    expect(() => mapCatalog(payload, sources)).toThrowError(ApiError)
    expect(() => mapCatalog(payload, sources)).toThrowError(/thiếu vị trí hoặc kích thước/)
  })

  it("maps available, spare, reserved, occupied and out-of-service states from backend", () => {
    const catalog = mapCatalog(catalogPayload, sources)
    const expectedAt = new Date("2026-10-28T12:30:00.000Z")
    const booking: BackendBooking = {
      id: 11,
      guestName: "Khách đặt",
      phoneLast3: "123",
      partySize: 4,
      expectedAt,
      businessDate: "2026-10-28",
      status: "BOOKED",
      sourceCode: "HOTLINE",
      tableCodes: ["A1"],
      note: null,
      version: 2,
      displayStatus: "LATE",
      minutesLate: 20,
    }
    const tables: BackendTableState[] = [
      backendTable({ id: 1, code: "A1", state: "RESERVED" }),
      backendTable({ id: 2, code: "A10", isBackup: true }),
      backendTable({ id: 3, code: "A2", state: "OUT_OF_SERVICE" }),
      backendTable({
        id: 4,
        code: "A3",
        state: "IN_USE",
        activeVisit: {
          id: 21,
          version: 4,
          tableCodes: ["A3"],
          displayName: "Khách walk-in",
          phoneLast3: null,
          guestCount: 3,
          startedAt: new Date("2026-10-28T12:00:00.000Z"),
          origin: "WALK_IN",
          paid: false,
          note: null,
        },
      }),
    ]

    const floor = mapFloorState(new Date("2026-10-28T13:00:00.000Z"), "2026-10-28", tables, [booking], catalog)

    expect(floor.tables.map(({ tableId, state }) => [tableId, state])).toEqual([
      [1, "late"],
      [2, "spare"],
      [3, "oos"],
      [4, "seated"],
    ])
    expect(floor.tables[0]?.claim).toMatchObject({ reservationId: 11, displayName: "Khách đặt" })
    expect(floor.tables[3]?.claim).toMatchObject({ visitId: 21, displayName: "Khách walk-in" })
  })

  it("does not treat the spare flag as occupancy", () => {
    const catalog = mapCatalog(catalogPayload, sources)
    const floor = mapFloorState(
      new Date("2026-10-28T13:00:00.000Z"),
      "2026-10-28",
      [backendTable({ id: 2, code: "A10", isBackup: true })],
      [],
      catalog,
    )

    expect(floor.tables[0]).toMatchObject({ state: "spare", claim: null })
  })

  it("preserves stale holds and groups and excludes them from available tables", () => {
    const catalog = mapCatalog(catalogPayload, sources)
    const at = new Date("2026-10-30T13:00:00.000Z")
    const groups = [{ id: 9, symbolNo: 2, tableIds: [1, 2] }]
    const floor = mapFloorState(
      at,
      "2026-10-30",
      [
        backendTable({
          id: 1,
          code: "A1",
          state: "RESERVED",
          staleFromPreviousDay: true,
          allocationBusinessDate: "2026-10-29",
        }),
        backendTable({
          id: 2,
          code: "A10",
          state: "RESERVED",
          isBackup: true,
          staleFromPreviousDay: true,
          allocationBusinessDate: "2026-10-29",
        }),
      ],
      [],
      catalog,
      groups,
    )

    expect(floor.tables).toEqual([
      { tableId: 1, state: "reserved", staleFromPreviousDay: true, claim: null },
      { tableId: 2, state: "reserved", staleFromPreviousDay: true, claim: null },
    ])
    expect(floor.groups).toEqual(groups)
    expect(
      deriveAvailability(at, 2, floor, [], catalog)
        .tables.slice(0, 2)
        .map((table) => table.status),
    ).toEqual(["reserved", "reserved"])
  })

  it("uses allocation business dates for stale visits instead of inferring from startedAt", () => {
    const catalog = mapCatalog(catalogPayload, sources)
    const at = new Date("2026-10-30T13:00:00.000Z")
    const floor = mapFloorState(
      at,
      "2026-10-30",
      [
        backendTable({
          id: 1,
          code: "A1",
          state: "IN_USE",
          staleFromPreviousDay: true,
          allocationBusinessDate: "2026-10-29",
          activeVisit: {
            id: 20,
            version: 1,
            tableCodes: ["A1"],
            displayName: "Prior shift",
            phoneLast3: null,
            guestCount: 2,
            startedAt: at,
            origin: "WALK_IN",
            paid: false,
            note: null,
          },
        }),
      ],
      [],
      catalog,
    )

    expect(floor.tables[0]).toMatchObject({ state: "seated", staleFromPreviousDay: true, claim: { visitId: 20 } })
    expect(deriveAvailability(at, 2, floor, [], catalog).tables[0]?.status).toBe("occupied_unknown_end")
  })

  it("does not mark same-day allocations or released tables stale", () => {
    const catalog = mapCatalog(catalogPayload, sources)
    const floor = mapFloorState(
      new Date("2026-10-30T13:00:00.000Z"),
      "2026-10-30",
      [
        backendTable({
          id: 1,
          code: "A1",
          state: "RESERVED",
          staleFromPreviousDay: false,
          allocationBusinessDate: "2026-10-30",
        }),
        backendTable({ id: 2, code: "A10", staleFromPreviousDay: false, allocationBusinessDate: null }),
      ],
      [],
      catalog,
    )
    expect(floor.tables.map((table) => table.staleFromPreviousDay)).toEqual([false, false])
    expect(floor.tables[1]?.state).toBe("free")
  })
})

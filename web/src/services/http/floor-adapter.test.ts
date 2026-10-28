import { describe, expect, it } from "vitest"
import { ApiError } from "../contracts"
import {
  mapCatalog,
  mapFloorState,
  type BackendBooking,
  type BackendCatalog,
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
  it("maps persisted catalog geometry, source codes, spare and out-of-service configuration", () => {
    const catalog = mapCatalog(catalogPayload, sources)

    expect(catalog.venue.name).toBe("21GAM")
    expect(catalog.sources).toEqual([{ code: "HOTLINE", name: "Hotline" }])
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
})

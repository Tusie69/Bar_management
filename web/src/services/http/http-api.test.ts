import { afterEach, describe, expect, it, vi } from "vitest"
import { createHttpApi } from "./http-api"
import { HttpClient } from "./http-client"

const json = (value: unknown) =>
  new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } })

const catalog = {
  venue: {
    id: 1,
    version: 1,
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
    changeSeq: 4,
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
  ],
  combinations: [],
}

afterEach(() => vi.unstubAllGlobals())

describe("Phase 2A HTTP API", () => {
  it("uses only real read endpoints for catalog and floor state", async () => {
    const requested: string[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input.toString()
        requested.push(url)
        const parsed = new URL(url)
        if (parsed.pathname === "/api/v1/tables/catalog") return json(catalog)
        if (parsed.pathname === "/api/v1/bookings/sources") {
          return json({ sources: [{ code: "HOTLINE", name: "Hotline" }] })
        }
        if (parsed.pathname === "/api/v1/tables") {
          return json({
            businessDate: parsed.searchParams.get("date"),
            tables: [{ id: 1, code: "A1", state: "AVAILABLE", isBackup: false, activeVisit: null }],
          })
        }
        if (parsed.pathname === "/api/v1/bookings") {
          return json({ businessDate: parsed.searchParams.get("date"), bookings: [] })
        }
        return new Response(null, { status: 404 })
      }),
    )

    const api = createHttpApi(new HttpClient("http://api.test"), 1)
    const result = await api.getFloorState(new Date("2026-10-28T13:00:00.000Z"))

    expect(result.businessDate).toBe("2026-10-28")
    expect(result.tables).toEqual([{ tableId: 1, state: "free", claim: null }])
    expect(requested.map((url) => new URL(url).pathname).sort()).toEqual([
      "/api/v1/bookings",
      "/api/v1/bookings/sources",
      "/api/v1/tables",
      "/api/v1/tables/catalog",
    ])
    expect(requested.some((url) => url.includes("mock"))).toBe(false)
  })
})

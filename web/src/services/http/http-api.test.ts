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

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

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
    expect(result.tables).toEqual([{ tableId: 1, state: "free", claim: null, staleFromPreviousDay: false }])
    expect(requested.map((url) => new URL(url).pathname).sort()).toEqual([
      "/api/v1/bookings",
      "/api/v1/bookings/sources",
      "/api/v1/tables",
      "/api/v1/tables/catalog",
    ])
    expect(requested.some((url) => url.includes("mock"))).toBe(false)
  })
})

function cacheFixture() {
  const payload = structuredClone(catalog)
  const paths: string[] = []
  let failCatalog = false
  let failMutation = false
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit) => {
      const url = new URL(input)
      paths.push(url.pathname.replace("/api/v1", ""))
      if (url.pathname.endsWith("/configuration")) {
        if (failMutation) return new Response(null, { status: 503 })
        Object.assign(payload.tables[0], JSON.parse(init.body as string))
        return json({})
      }
      if (url.pathname.endsWith("/tables/catalog")) {
        if (failCatalog) return new Response(null, { status: 503 })
        return json(payload)
      }
      if (url.pathname.endsWith("/bookings/sources")) return json({ sources: [{ code: "HOTLINE", name: "Hotline" }] })
      if (url.pathname.endsWith("/tables")) return json({ businessDate: url.searchParams.get("date"), tables: [] })
      if (url.pathname.endsWith("/bookings")) return json({ businessDate: url.searchParams.get("date"), bookings: [] })
      if (url.pathname.endsWith("/waitlist")) return json({ businessDate: url.searchParams.get("date"), entries: [] })
      return new Response(null, { status: 404 })
    }),
  )
  return {
    api: createHttpApi(new HttpClient("http://api.test"), 1),
    paths,
    payload,
    failCatalog: (value: boolean) => {
      failCatalog = value
    },
    failMutation: () => {
      failMutation = true
    },
  }
}

describe("HTTP catalog cache", () => {
  it("shares concurrent catalog loads across floor, bookings and overview", async () => {
    const { api, paths } = cacheFixture()
    await Promise.all([
      api.getCatalog(),
      api.getFloorState(new Date()),
      api.listReservations({ businessDate: "2026-10-30" }),
      api.getShiftOverview(),
    ])
    expect(paths.filter((path) => path === "/tables/catalog")).toHaveLength(1)
    expect(paths.filter((path) => path === "/bookings/sources")).toHaveLength(1)
  })

  it("refreshes externally changed configuration at the 60 second boundary", async () => {
    vi.useFakeTimers()
    const { api, paths, payload } = cacheFixture()
    await api.getCatalog()
    payload.tables[0]!.isSpare = true
    vi.advanceTimersByTime(59_999)
    expect((await api.getCatalog()).tables[0]!.isSpare).toBe(false)
    vi.advanceTimersByTime(1)
    expect((await api.getCatalog()).tables[0]!.isSpare).toBe(true)
    expect(paths.filter((path) => path === "/tables/catalog")).toHaveLength(2)
  })

  it.each([
    { status: "OUT_OF_SERVICE" as const, reason: "Repair" },
    { status: "ACTIVE" as const, reason: "Reopen" },
    { isSpare: true },
  ])("invalidates after table configuration mutation %j", async (patch) => {
    const { api, paths, payload } = cacheFixture()
    await api.getCatalog()
    await api.setTableStatus(1, 1, patch)
    expect((await api.getCatalog()).tables[0]).toMatchObject({
      status: payload.tables[0]!.status,
      isSpare: payload.tables[0]!.isSpare,
    })
    expect(paths.filter((path) => path === "/tables/catalog")).toHaveLength(2)
  })

  it("rechecks the catalog after a mutation with an uncertain server outcome", async () => {
    const fixture = cacheFixture()
    await fixture.api.getCatalog()
    fixture.failMutation()
    await expect(fixture.api.setTableStatus(1, 1, { isSpare: true })).rejects.toMatchObject({ status: 503 })
    await fixture.api.getCatalog()
    expect(fixture.paths.filter((path) => path === "/tables/catalog")).toHaveLength(2)
  })

  it("retries failed loads instead of caching a rejected promise", async () => {
    const fixture = cacheFixture()
    fixture.failCatalog(true)
    await expect(fixture.api.getCatalog()).rejects.toMatchObject({ status: 503 })
    fixture.failCatalog(false)
    await expect(fixture.api.getCatalog()).resolves.toHaveProperty("tables")
  })

  it("does not share cache between adapter instances or across session changes", async () => {
    const { api, paths } = cacheFixture()
    await api.getCatalog()
    const other = createHttpApi(new HttpClient("http://api.test"), 2)
    await other.getCatalog()
    api.setSession({ id: 2, displayName: "Another user", role: "OWNER_ADMIN", deviceLabel: "test" })
    await api.getCatalog()
    expect(paths.filter((path) => path === "/tables/catalog")).toHaveLength(3)
  })

  it("does not let a late load from the previous session repopulate the cache", async () => {
    const client = new HttpClient("http://api.test")
    let resolveOld!: (value: typeof catalog) => void
    const old = new Promise<typeof catalog>((resolve) => {
      resolveOld = resolve
    })
    const get = vi.spyOn(client, "get").mockImplementation(async (path) => {
      if (path === "/bookings/sources") return { sources: [] }
      return get.mock.calls.filter(([p]) => p === "/tables/catalog").length === 1 ? old : structuredClone(catalog)
    })
    const api = createHttpApi(client, 1)
    const pending = api.getCatalog()
    api.setSession({ id: 2, displayName: "Another user", role: "OWNER_ADMIN", deviceLabel: "test" })
    await api.getCatalog()
    resolveOld({ ...catalog, tables: [] })
    await pending
    expect((await api.getCatalog()).tables).toHaveLength(1)
    expect(get.mock.calls.filter(([path]) => path === "/tables/catalog")).toHaveLength(2)
  })

  it("protects cached data from callers mutating their returned catalog", async () => {
    const { api } = cacheFixture()
    const first = await api.getCatalog()
    first.tables.length = 0
    expect((await api.getCatalog()).tables).toHaveLength(1)
  })

  it("invalidates on the HTTP authentication lifecycle even without setSession", async () => {
    const { paths } = cacheFixture()
    const client = new HttpClient("http://api.test")
    const api = createHttpApi(client, 1)
    await api.getCatalog()
    client.setCsrfToken("new-session")
    await api.getCatalog()
    client.setCsrfToken(null)
    await api.getCatalog()
    expect(paths.filter((path) => path === "/tables/catalog")).toHaveLength(3)
  })

  it("does not let a pre-mutation load overwrite fresh configuration", async () => {
    const client = new HttpClient("http://api.test")
    let resolveOld!: (value: typeof catalog) => void
    const old = new Promise<typeof catalog>((resolve) => {
      resolveOld = resolve
    })
    const get = vi.spyOn(client, "get").mockImplementation(async (path) => {
      if (path === "/bookings/sources") return { sources: [] }
      if (get.mock.calls.filter(([p]) => p === "/tables/catalog").length === 1) return old
      const fresh = structuredClone(catalog)
      fresh.tables[0]!.isSpare = true
      return fresh
    })
    vi.spyOn(client, "patch").mockResolvedValue({})
    const api = createHttpApi(client, 1)
    const pending = api.getCatalog()
    await api.setTableStatus(1, 1, { isSpare: true })
    await api.getCatalog()
    resolveOld(structuredClone(catalog))
    await pending
    expect((await api.getCatalog()).tables[0]!.isSpare).toBe(true)
    expect(get.mock.calls.filter(([path]) => path === "/tables/catalog")).toHaveLength(2)
  })

  it("keeps live reads on each 15 second floor poll while reusing reference data", async () => {
    vi.useFakeTimers()
    const { api, paths } = cacheFixture()
    const poll = () =>
      Promise.all([
        api.getFloorState(new Date()),
        api.getShiftOverview(),
        api.listReservations({ businessDate: "2026-10-30" }),
        api.listWaitlist("2026-10-30"),
      ])
    await poll()
    paths.length = 0
    vi.advanceTimersByTime(15_000)
    await poll()
    expect(paths.sort()).toEqual([
      "/bookings",
      "/bookings",
      "/bookings",
      "/tables",
      "/tables",
      "/waitlist",
      "/waitlist",
    ])
  })
})

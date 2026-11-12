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
    upcomingWarningMinutes: 10,
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

const emptyProjection = (businessDate: string | null, tables: unknown[] = []) => ({
  businessDate,
  serverNow: "2026-10-28T13:00:00.000Z",
  changeSeq: "4",
  tables,
  groups: [],
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("Phase 2A HTTP API", () => {
  it("posts C1 create, add-members and versioned idle split without using the claim version", async () => {
    const calls: { path: string; body: unknown; key: string | null }[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init: RequestInit) => {
        calls.push({
          path: new URL(input).pathname,
          body: JSON.parse(String(init.body)),
          key: new Headers(init.headers).get("Idempotency-Key"),
        })
        return json({ operationId: 10, changeSeq: 42, undoable: false, summary: "ok" })
      }),
    )
    const client = new HttpClient("http://api.test")
    client.setCsrfToken("csrf")
    const api = createHttpApi(client, 1)
    await api.createTableGroup({ tableIds: [1, 2], name: "Cặp bàn", idempotencyKey: "create-group" })
    await api.addTableGroupMembers({ groupId: 9, version: 42, tableIds: [3], idempotencyKey: "add-member" })
    await api.splitGroup({ groupId: 9, version: 43, mode: "ALL_TO_SINGLE", idempotencyKey: "idle-split" })
    await api.splitGroup({ groupId: 9, keepTableIds: [1], idempotencyKey: "ba-021" })
    expect(calls).toEqual([
      { path: "/api/v1/tables/groups", body: { tableIds: [1, 2], name: "Cặp bàn" }, key: "create-group" },
      { path: "/api/v1/tables/groups/9/members", body: { version: 42, tableIds: [3] }, key: "add-member" },
      { path: "/api/v1/tables/groups/9/split", body: { version: 43, mode: "ALL_TO_SINGLE" }, key: "idle-split" },
      { path: "/api/v1/tables/groups/9/split", body: { keepTableIds: [1] }, key: "ba-021" },
    ])
  })
  it.each(["members", "booking"])(
    "refetches the selected floor on a %s group-version conflict without retrying the write",
    async (operation) => {
      let floorReads = 0
      let writes = 0
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string, init: RequestInit) => {
          const url = new URL(input)
          if (url.pathname === "/api/v1/tables/catalog") return json(catalog)
          if (url.pathname === "/api/v1/bookings/sources")
            return json({ sources: [{ code: "HOTLINE", name: "Hotline" }] })
          if (url.pathname === "/api/v1/tables") {
            floorReads++
            expect(url.searchParams.get("date")).toBe("2026-11-11")
            return json({
              ...emptyProjection("2026-11-11"),
              changeSeq: String(floorReads),
              groups: [
                {
                  id: 9,
                  version: floorReads,
                  symbolNo: 1,
                  displayCode: "N1",
                  tableIds: [1, 2],
                  claim: null,
                  displayState: "EMPTY",
                  seatedTurnCount: 0,
                },
              ],
            })
          }
          expect(init.method).toBe("POST")
          writes++
          return new Response(
            JSON.stringify({
              error: {
                code: "TABLE_GROUP_VERSION_CONFLICT",
                message: "stale",
                details: { currentVersion: 2, changeSeq: "2" },
              },
            }),
            { status: 409, headers: { "content-type": "application/json" } },
          )
        }),
      )
      const client = new HttpClient("http://api.test")
      client.setCsrfToken("csrf")
      const api = createHttpApi(client, 1)
      const floor = await api.getFloorState(new Date("2026-11-11T12:00:00Z"), "2026-11-11")
      expect(floor.groups[0]).toMatchObject({ version: 1, seatedTurnCount: 0, claim: null, state: "free" })
      const request =
        operation === "members"
          ? api.addTableGroupMembers({ groupId: 9, version: 1, tableIds: [3] })
          : api.createReservation({
              contactName: "Guest",
              expectedAt: new Date("2026-11-11T12:00:00Z"),
              partySize: 2,
              sourceCode: "HOTLINE",
            })
      await expect(request).rejects.toMatchObject({
        code: "TABLE_GROUP_VERSION_CONFLICT",
        details: { currentVersion: 2, changeSeq: "2" },
        message: expect.stringContaining("tải lại sơ đồ"),
      })
      expect(floorReads).toBe(2)
      expect(writes).toBe(1)
    },
  )
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
          return json(
            emptyProjection(parsed.searchParams.get("date"), [
              {
                tableId: 1,
                tableCode: "A1",
                catalogStatus: "ACTIVE",
                isSpare: false,
                displayState: "EMPTY",
                arrivalPhase: null,
                arrivalTime: null,
                minutesLate: 0,
                claim: null,
                groupId: null,
                groupDisplayCode: null,
                groupMemberTableIds: [],
                staleFromPreviousDay: false,
              },
            ]),
          )
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
      if (url.pathname.endsWith("/tables")) return json(emptyProjection(url.searchParams.get("date")))
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
  it("rejects a stale floor response by changeSeq without recomputing client state", async () => {
    let floorCall = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = new URL(input)
        if (url.pathname.endsWith("/tables/catalog")) return json(catalog)
        if (url.pathname.endsWith("/bookings/sources")) return json({ sources: [{ code: "HOTLINE", name: "Hotline" }] })
        if (url.pathname.endsWith("/tables")) {
          floorCall += 1
          const stale = floorCall === 2
          return json({
            ...emptyProjection(url.searchParams.get("date"), [
              {
                tableId: 1,
                tableCode: "A1",
                catalogStatus: "ACTIVE",
                isSpare: false,
                displayState: stale ? "EMPTY" : "NO_SHOW",
                arrivalPhase: stale ? null : "NO_SHOW",
                arrivalTime: stale ? null : "2026-10-28T12:30:00.000Z",
                minutesLate: stale ? 0 : 30,
                claim: stale
                  ? null
                  : {
                      kind: "RESERVATION",
                      reservationId: 11,
                      visitId: null,
                      waitlistEntryId: null,
                      holdId: 41,
                      guestName: "Khách",
                      phoneLast3: "123",
                      partySize: 2,
                      turnNo: null,
                      flags: [],
                      groupId: null,
                      groupDisplayCode: null,
                      groupMemberTableIds: [],
                      startsAt: "2026-10-28T12:30:00.000Z",
                      deadlineAt: null,
                      holdOverdue: false,
                      paid: false,
                      origin: null,
                      sourceCode: "HOTLINE",
                      version: 1,
                    },
                groupId: null,
                groupDisplayCode: null,
                groupMemberTableIds: [],
                staleFromPreviousDay: false,
              },
            ]),
            serverNow: stale ? "2026-10-28T12:59:00.000Z" : "2026-10-28T13:00:00.000Z",
            changeSeq: stale ? "4" : "5",
          })
        }
        return new Response(null, { status: 404 })
      }),
    )
    const api = createHttpApi(new HttpClient("http://api.test"), 1)
    const first = await api.getFloorState(new Date("2026-10-28T13:00:00Z"), "2026-10-28")
    const second = await api.getFloorState(new Date("2026-10-28T13:01:00Z"), "2026-10-28")
    expect(first.tables[0]?.state).toBe("noshow")
    expect(second).toEqual(first)
  })

  it("accepts a newer serverNow with the same changeSeq so Option A can cross the time threshold", async () => {
    let floorCall = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = new URL(input)
        if (url.pathname.endsWith("/tables/catalog")) return json(catalog)
        if (url.pathname.endsWith("/bookings/sources")) return json({ sources: [{ code: "HOTLINE", name: "Hotline" }] })
        if (url.pathname.endsWith("/tables")) {
          floorCall += 1
          const noShow = floorCall === 2
          return json({
            ...emptyProjection(url.searchParams.get("date"), [
              {
                tableId: 1,
                tableCode: "A1",
                catalogStatus: "ACTIVE",
                isSpare: false,
                displayState: noShow ? "NO_SHOW" : "LATE_CONFIRMED",
                arrivalPhase: noShow ? "NO_SHOW" : "LATE_CONFIRMED",
                arrivalTime: "2026-10-28T12:30:00.000Z",
                minutesLate: noShow ? 30 : 29,
                claim: {
                  kind: "RESERVATION",
                  reservationId: 11,
                  visitId: null,
                  waitlistEntryId: null,
                  holdId: 41,
                  guestName: "Khách",
                  phoneLast3: "123",
                  partySize: 2,
                  turnNo: null,
                  flags: [],
                  groupId: null,
                  groupDisplayCode: null,
                  groupMemberTableIds: [],
                  startsAt: "2026-10-28T12:30:00.000Z",
                  deadlineAt: null,
                  holdOverdue: false,
                  paid: false,
                  origin: null,
                  sourceCode: "HOTLINE",
                  version: 2,
                  lateConfirmedAt: "2026-10-28T12:42:00.000Z",
                },
                groupId: null,
                groupDisplayCode: null,
                groupMemberTableIds: [],
                staleFromPreviousDay: false,
              },
            ]),
            serverNow: noShow ? "2026-10-28T13:00:00.000Z" : "2026-10-28T12:59:59.000Z",
            changeSeq: "5",
          })
        }
        return new Response(null, { status: 404 })
      }),
    )
    const api = createHttpApi(new HttpClient("http://api.test"), 1)
    expect((await api.getFloorState(new Date(), "2026-10-28")).tables[0]?.state).toBe("late_confirmed")
    expect((await api.getFloorState(new Date(), "2026-10-28")).tables[0]?.state).toBe("noshow")
  })

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
    expect(paths.sort()).toEqual(["/bookings", "/bookings", "/tables", "/tables", "/waitlist", "/waitlist"])
  })
})

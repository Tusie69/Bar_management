import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError, isNotSupported, type GamApi } from "../contracts"
import { clock } from "../clock"
import { createHttpApi } from "./http-api"
import { HttpClient } from "./http-client"

const at = new Date("2026-10-30T01:30:00+07:00")
const date = "2026-10-29"
const booking = {
  id: 11,
  version: 3,
  guestName: "An",
  phoneLast3: "123",
  partySize: 4,
  expectedAt: at.toISOString(),
  businessDate: date,
  classification: "UNCLASSIFIED",
  status: "BOOKED",
  source: "Hotline",
  sourceCode: "HOTLINE",
  tableCodes: ["A1"],
  note: "Old note",
  displayStatus: "LATE",
  minutesLate: 20,
  autoNoShowDue: false,
}
const entry = {
  id: 21,
  version: 2,
  kind: "WALK_IN",
  guestName: "Binh",
  partySize: 4,
  businessDate: date,
  queuedAt: at.toISOString(),
  status: "WAITING",
  contactChannel: "IN_PERSON",
  reservationId: null,
  visitId: null,
  note: null,
}
const catalog = {
  venue: {
    id: 1,
    version: 1,
    name: "21GAM",
    timezone: "Asia/Ho_Chi_Minh",
    businessDayStartLocal: "17:00",
    businessDayCutoffLocal: "05:00",
    lateWarningMinutes: 15,
    noShowWarningMinutes: 30,
    waitlistHoldDefaultMinutes: 30,
    waitlistClaimLeaseSeconds: 300,
    reservationHoldPolicy: "SEQUENTIAL",
    reservationWindowMinutes: null,
    groupSymbolCount: 12,
    changeSeq: 0,
  },
  zones: [{ id: 1, version: 1, code: "A", name: "A", isBookable: true, isWaitingArea: false }],
  tables: [1, 2].map((id) => ({
    id,
    version: 4,
    code: `A${id}`,
    displayName: `A${id}`,
    zoneId: 1,
    zoneCode: "A",
    kind: "TABLE",
    capacity: 4,
    seqNo: null,
    isSpare: false,
    status: "ACTIVE",
    x: id * 50,
    y: 50,
    width: 40,
    height: 40,
  })),
  combinations: [{ id: 1, code: "A12", displayName: "A1+A2", memberIds: [1, 2], capacity: 8 }],
}
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } })
type Call = { method: string; path: string; body: unknown }
let calls: Call[]
let api: GamApi
let tableState: "AVAILABLE" | "RESERVED" | "IN_USE"
let failure: { path: string; status: number; code: string } | null

beforeEach(() => {
  calls = []
  tableState = "AVAILABLE"
  failure = null
  vi.spyOn(clock, "now").mockReturnValue(at)
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const parsed = new URL(url)
      const path = parsed.pathname.replace("/api/v1", "") + parsed.search
      const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined
      calls.push({ method: init.method ?? "GET", path, body })
      if (failure?.path === path)
        return json({ error: { code: failure.code, message: "Máy chủ từ chối." } }, failure.status)
      if (path === "/tables/catalog") return json(catalog)
      if (path === "/bookings/sources") return json({ sources: [{ code: "HOTLINE", name: "Hotline" }] })
      if (path.startsWith("/tables?"))
        return json({
          businessDate: parsed.searchParams.get("date"),
          groups: [],
          tables: [1, 2].map((id) => ({
            id,
            code: `A${id}`,
            state: id === 1 ? tableState : "AVAILABLE",
            isBackup: false,
            activeVisit:
              id === 1 && tableState === "IN_USE"
                ? {
                    id: 31,
                    version: 5,
                    tableCodes: ["A1"],
                    displayName: "Visit",
                    phoneLast3: null,
                    guestCount: 4,
                    startedAt: "2026-10-29T13:00:00.000Z",
                    origin: "WALK_IN",
                    paid: false,
                    note: null,
                  }
                : null,
          })),
        })
      if (path.startsWith("/bookings?") || path.startsWith("/bookings/search?"))
        return json({
          businessDate: parsed.searchParams.get("date"),
          bookings: [{ ...booking, businessDate: parsed.searchParams.get("date") }],
        })
      if (path.startsWith("/waitlist?")) return json({ businessDate: date, entries: [entry] })
      if (path === "/bookings/walk-ins") return json({ visitId: 31 })
      if (path.endsWith("phone:reveal")) return json({ phoneNumber: "+84901234123" })
      if (path === "/waitlist" || path.startsWith("/waitlist/")) return json({ entry, reservationId: 11, groupId: 1 })
      if (path.startsWith("/visits/"))
        return json({ visit: { id: 31, version: 6 }, group: { id: 1, symbolNo: 1, tableIds: [1, 2] } })
      if (path.startsWith("/tables/")) return json({ table: { id: 1, version: 5 } })
      if (path === "/bookings" || /^\/bookings\/11(?:\/.*)?$/.test(path))
        return json({
          booking: {
            ...booking,
            ...(path.endsWith("/assign")
              ? { version: 4, tableCodes: body.tableIds.map((id: number) => `A${id}`) }
              : {}),
          },
          group: { id: 1, symbolNo: 1, tableIds: [1, 2] },
        })
      throw new Error(`Unexpected endpoint: ${path}`)
    }),
  )
  api = createHttpApi(new HttpClient("http://api.test"), 1)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
const writes = () => calls.filter((call) => call.method !== "GET")

describe("canonical contract reads", () => {
  it("exposes classification on canonical reservations", async () => {
    expect((await api.listReservations({ businessDate: date }))[0].classification).toBe("UNCLASSIFIED")
  })
  it("exports backend text verbatim through GamApi without a JSON wrapper", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("THỐNG KÊ\nBàn khách quen O: 2\n", {
        headers: { "content-type": "text/plain; charset=utf-8" },
      }),
    )
    expect(await api.exportDailyBookingText(date)).toBe("THỐNG KÊ\nBàn khách quen O: 2\n")
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      `http://api.test/api/v1/bookings/export?date=${date}`,
      expect.objectContaining({ method: "GET", credentials: "include" }),
    )
  })
  it.each(["bookings", "tables", "waitlist"])("rejects a mismatched %s business date", async (resource) => {
    const original = vi.mocked(fetch).getMockImplementation()!
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input).includes(`/${resource}?`))
        return json({ businessDate: "1999-01-01", bookings: [], tables: [], entries: [] })
      return original(input, init)
    })
    await expect(resource === "waitlist" ? api.listWaitlist(date) : api.getFloorState(at, date)).rejects.toMatchObject({
      status: 502,
      code: "BUSINESS_DATE_RESPONSE_MISMATCH",
    })
  })
  it("uses an explicit selected floor date independently of wall-clock time", async () => {
    expect((await api.getFloorState(at, "2026-11-10")).businessDate).toBe("2026-11-10")
    expect(calls.filter((call) => /^(\/tables\?|\/bookings\?)/.test(call.path)).map((call) => call.path)).toEqual([
      "/tables?date=2026-11-10",
      "/bookings?date=2026-11-10",
    ])
  })
  it("maps catalog, bookings/search and waitlist without inventing identities or dates", async () => {
    const data = await api.getCatalog()
    expect(data.sources[0].id).toBeNull()
    expect(data.tables[0]).toHaveProperty("seating", undefined)
    expect(data.combinations[0].pendingConfirmation).toBeNull()
    const rows = await api.listReservations({ businessDate: date, search: " An " })
    expect(calls.some((call) => call.path === `/bookings/search?date=${date}&q=An`)).toBe(true)
    expect(rows[0]).toMatchObject({ id: 11, tableIds: [1], createdAt: null, warning: "late", customerId: null })
    expect(rows[0].expectedAt).toEqual(at)
    expect((await api.listWaitlist(date))[0]).toMatchObject({
      id: 21,
      kind: "WALK_IN",
      displayName: "Binh",
      queuedAt: at,
    })
  })
  it("maps advance reservation identity, appointment time and server priority order", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        businessDate: date,
        entries: [
          { ...entry, id: 22, kind: "ADVANCE_RESERVATION", reservationId: 11, reservationExpectedAt: at.toISOString() },
          { ...entry, reservationExpectedAt: null },
        ],
      }),
    )
    const entries = await api.listWaitlist(date)
    expect(entries.map((row) => row.kind)).toEqual(["ADVANCE_RESERVATION", "WALK_IN"])
    expect(entries[0]).toMatchObject({ reservationId: 11, reservationExpectedAt: at })
    expect(entries[1]).toMatchObject({ reservationId: null, reservationExpectedAt: null })
  })
  it("loads the requested after-midnight business date, with no duration-based availability assumptions", async () => {
    const availability = await api.getAvailability(at, 4)
    expect(availability.businessDate).toBe(date)
    expect(availability.tables[0]).toMatchObject({
      status: "available",
      bookingConflicts: [{ reservationId: 11, expectedAt: at }],
    })
    expect(calls.filter((call) => /^(\/tables\?|\/bookings\?)/.test(call.path)).map((call) => call.path)).toEqual([
      `/tables?date=${date}`,
      `/bookings?date=${date}`,
    ])
    expect(availability.combinations[0].available).toBe(true)
    tableState = "IN_USE"
    expect((await api.getAvailability(at, 4)).tables[0].status).toBe("occupied_unknown_end")
    tableState = "RESERVED"
    expect((await api.getAvailability(at, 4)).tables[0].status).toBe("reserved")
  })
  it("uses the requested future date rather than today's date", async () => {
    const future = new Date("2026-11-10T20:00:00+07:00")
    expect((await api.getAvailability(future, 4)).businessDate).toBe("2026-11-10")
    expect(calls.some((call) => call.path === "/tables?date=2026-11-10")).toBe(true)
  })
  it("derives current counts while leaving unavailable historical totals null", async () => {
    tableState = "IN_USE"
    const overview = await api.getShiftOverview()
    expect(overview).toMatchObject({
      businessDate: date,
      reservationsTotal: 1,
      seatedVisits: 1,
      seatedGuests: 4,
      waitlistWalkIn: 1,
      visitsTonight: null,
      guestsTonight: null,
    })
    expect(overview.byHour.every((hour) => hour.seated === null)).toBe(true)
    expect(calls.some((call) => call.path === `/waitlist?date=${date}`)).toBe(true)
  })
  it("does not subscribe to an invented change feed", () => {
    const off = api.subscribe(vi.fn())
    off()
    expect(calls).toEqual([])
  })
})

describe("canonical contract writes", () => {
  it("keeps classification in both create and update payloads", async () => {
    await api.createReservation({
      contactName: "An",
      partySize: 4,
      expectedAt: at,
      sourceCode: "HOTLINE",
      classification: "RETURNING",
    })
    await api.updateReservation({ id: 11, version: 3, classification: "NEW" })
    expect(writes().map((call) => (call.body as { classification: string }).classification)).toEqual([
      "RETURNING",
      "NEW",
    ])
  })
  it("returns the reservation and group assigned to a waitlist entry", async () => {
    expect(await api.seatWaitlist({ entryId: 21, version: 2, guestCount: 4, tableIds: [1, 2] })).toMatchObject({
      reservationId: 11,
      groupId: 1,
      undoable: false,
    })
    expect(writes()).toEqual([{ method: "POST", path: "/waitlist/21/seat", body: { version: 2, tableIds: [1, 2] } }])
  })
  it("forwards the selected walk-in waitlist date and phone only on create", async () => {
    await api.addWaitlist({
      kind: "WALK_IN",
      businessDate: "2026-11-10",
      contactName: "An",
      phone: "0901234123",
      partySize: 4,
      channel: "IN_PERSON",
      preferenceMode: "ANY",
      preferences: [],
    })
    expect(writes()[0].body).toEqual({
      guestName: "An",
      phoneNumber: "0901234123",
      partySize: 4,
      businessDate: "2026-11-10",
      contactChannel: "IN_PERSON",
    })
  })
  it("creates then assigns with +07:00 and the preceding business date", async () => {
    const created = await api.createReservation({
      contactName: "An",
      phone: "0901234123",
      partySize: 4,
      expectedAt: at,
      sourceCode: "HOTLINE",
      tableIds: [1],
    })
    expect(created).toMatchObject({ reservationId: 11, undoable: false, changeSeq: null })
    expect(writes()).toEqual([
      {
        method: "POST",
        path: "/bookings",
        body: {
          guestName: "An",
          phoneNumber: "0901234123",
          partySize: 4,
          expectedAt: "2026-10-30T01:30:00+07:00",
          businessDate: date,
          sourceCode: "HOTLINE",
        },
      },
      { method: "POST", path: "/bookings/11/assign", body: { version: 3, tableIds: [1] } },
    ])
  })
  it("does not assign a booking created without tables", async () => {
    await api.createReservation({ contactName: "An", partySize: 4, expectedAt: at, sourceCode: "HOTLINE" })
    expect(writes()).toHaveLength(1)
  })
  it("preserves the created booking when assignment fails, with no retry", async () => {
    failure = { path: "/bookings/11/assign", status: 409, code: "RESOURCE_CONFLICT" }
    await expect(
      api.createReservation({ contactName: "An", partySize: 4, expectedAt: at, sourceCode: "HOTLINE", tableIds: [1] }),
    ).rejects.toMatchObject({ status: 409, code: "BOOKING_CREATED_UNASSIGNED", details: { reservationId: 11 } })
    expect(writes()).toHaveLength(2)
  })
  it("updates the complete body with the caller's stale version intact", async () => {
    await api.updateReservation({ id: 11, version: 1, partySize: 5, note: null })
    expect(writes()).toEqual([
      {
        method: "PUT",
        path: "/bookings/11",
        body: {
          version: 1,
          guestName: "An",
          partySize: 5,
          expectedAt: "2026-10-30T01:30:00+07:00",
          businessDate: date,
          sourceCode: "HOTLINE",
          classification: "UNCLASSIFIED",
        },
      },
    ])
  })
  const cases: {
    name: string
    run: (api: GamApi) => Promise<unknown>
    method?: string
    path: string
    body: unknown
  }[] = [
    {
      name: "assign",
      run: (api) => api.assignTables(11, 3, [2]),
      path: "/bookings/11/assign",
      body: { version: 3, tableIds: [2] },
    },
    {
      name: "cancel",
      run: (api) => api.cancelReservation(11, 3, "OTHER", "Cancelled"),
      path: "/bookings/11/cancel",
      body: { version: 3, reasonNote: "Cancelled" },
    },
    { name: "no-show", run: (api) => api.markNoShow(11, 3), path: "/bookings/11/no-show", body: { version: 3 } },
    {
      name: "walk-in",
      run: (api) => api.seatWalkIn({ tableIds: [2], guestCount: 4, contactName: "An" }),
      path: "/bookings/walk-ins",
      body: { tableIds: [2], partySize: 4, guestName: "An", businessDate: date },
    },
    {
      name: "end visit",
      run: (api) => api.endVisit(31, 5),
      path: "/visits/31/close",
      body: { version: 5, mode: "MANUAL", reason: "GUEST_LEFT" },
    },
    {
      name: "table configuration",
      run: (api) => api.setTableStatus(1, 4, { isSpare: true }),
      method: "PATCH",
      path: "/tables/1/configuration",
      body: { version: 4, isSpare: true, reason: "Nhân viên cập nhật cờ bàn sơ cua." },
    },
    {
      name: "table status",
      run: (api) => api.setTableStatus(1, 4, { status: "ACTIVE", reason: "Repair completed" }),
      method: "PATCH",
      path: "/tables/1/configuration",
      body: { version: 4, status: "ACTIVE", reason: "Repair completed" },
    },
    {
      name: "add waitlist",
      run: (api) =>
        api.addWaitlist({
          kind: "WALK_IN",
          contactName: "Binh",
          partySize: 4,
          channel: "PHONE_CALLBACK",
          preferenceMode: "ANY",
          preferences: [],
          note: "Call",
        }),
      path: "/waitlist",
      body: { guestName: "Binh", partySize: 4, businessDate: date, contactChannel: "PHONE_CALLBACK", note: "Call" },
    },
    {
      name: "seat waitlist",
      run: (api) => api.seatWaitlist({ entryId: 21, version: 2, guestCount: 4, tableIds: [2] }),
      path: "/waitlist/21/seat",
      body: { version: 2, tableIds: [2] },
    },
    {
      name: "cancel waitlist",
      run: (api) => api.cancelWaitlist(21, 2, "CUSTOMER_WITHDREW", "Left"),
      path: "/waitlist/21/cancel",
      body: { version: 2, reasonCode: "CUSTOMER_WITHDREW", note: "Left" },
    },
    {
      name: "contact",
      run: (api) =>
        api.recordContact({
          entryId: 21,
          version: 2,
          channel: "PHONE_BY_AUTHORIZED",
          outcome: "CALLBACK_REQUESTED",
          note: "Later",
        }),
      path: "/waitlist/21/contact-attempts",
      body: { version: 2, channel: "PHONE_BY_AUTHORIZED", outcome: "CALLBACK_REQUESTED", note: "Later" },
    },
    {
      name: "phone reveal",
      run: (api) => api.revealPhone(99, "CALLBACK", { reservationId: 11 }),
      path: "/bookings/11/phone:reveal",
      body: {},
    },
  ]
  it.each(cases)("$name uses the contract method/path/body", async ({ run, path, body, method = "POST" }) => {
    await run(api)
    expect(writes()).toEqual([{ method, path, body }])
  })
  it("creates advance entries using the reservation business date without duplicating guest data", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ booking: { ...booking, businessDate: "2030-10-24" } }))
    await api.addWaitlist({
      kind: "ADVANCE_RESERVATION",
      reservationId: 11,
      contactName: "Ignored duplicate",
      partySize: 999,
      channel: "ZALO_THREAD",
      preferenceMode: "ANY",
      preferences: [],
      note: "Waiting for a table",
    })
    expect(writes()).toEqual([
      {
        method: "POST",
        path: "/waitlist",
        body: {
          kind: "ADVANCE_RESERVATION",
          reservationId: 11,
          businessDate: "2030-10-24",
          contactChannel: "ZALO_THREAD",
          note: "Waiting for a table",
        },
      },
    ])
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "http://api.test/api/v1/bookings/11",
      expect.objectContaining({ method: "GET" }),
    )
  })
  it("sends status and spare changes in one configuration write with the observed version and reason", async () => {
    await api.setTableStatus(1, 4, { status: "OUT_OF_SERVICE", isSpare: true, reason: "  Broken chair  " })
    expect(writes()).toEqual([
      {
        method: "PATCH",
        path: "/tables/1/configuration",
        body: {
          version: 4,
          status: "OUT_OF_SERVICE",
          isSpare: true,
          reason: "Broken chair",
        },
      },
    ])
  })
  it.each([undefined, [2]])(
    "rejects changed guest counts before any check-in or assignment write (%j)",
    async (tableIds) => {
      await expect(api.checkIn({ reservationId: 11, version: 3, guestCount: 7, tableIds })).rejects.toMatchObject({
        status: 501,
        code: "NOT_SUPPORTED_BY_BACKEND",
      })
      expect(calls).toEqual([{ method: "GET", path: "/bookings/11", body: undefined }])
      expect(writes()).toEqual([])
    },
  )
  it("checks in an equal guest count without changing the observed version", async () => {
    await api.checkIn({ reservationId: 11, version: 1, guestCount: 4 })
    expect(writes()).toEqual([{ method: "POST", path: "/bookings/11/check-in", body: { version: 1 } }])
  })
  it("assigns changed tables before check-in and uses the returned version", async () => {
    await api.checkIn({ reservationId: 11, version: 3, guestCount: 4, tableIds: [2] })
    expect(writes()).toEqual([
      { method: "POST", path: "/bookings/11/assign", body: { version: 3, tableIds: [2] } },
      { method: "POST", path: "/bookings/11/check-in", body: { version: 4 } },
    ])
  })
  it("checks in unchanged tables without reassigning or replacing a stale version", async () => {
    await api.checkIn({ reservationId: 11, version: 1, guestCount: 4, tableIds: [1] })
    expect(writes()).toEqual([{ method: "POST", path: "/bookings/11/check-in", body: { version: 1 } }])
  })
  it.each(["visit", "reservation"] as const)("moves and combines a %s through its real endpoints", async (kind) => {
    tableState = "IN_USE"
    const claim = kind === "visit" ? { visitId: 31 } : { reservationId: 11 }
    await api.moveClaim({ claim, fromTableId: 1, toTableId: 2 })
    await api.combineTables({ claim, addTableIds: [2] })
    expect(writes()).toEqual([
      {
        method: "POST",
        path: kind === "visit" ? "/visits/31/move" : "/bookings/11/assign",
        body: { version: kind === "visit" ? 5 : 3, tableIds: [2] },
      },
      {
        method: "POST",
        path: kind === "visit" ? "/visits/31/merge" : "/bookings/11/merge",
        body: { version: kind === "visit" ? 5 : 3, tableIds: [1, 2] },
      },
    ])
  })
  it("surfaces backend configuration allocation conflicts without retry", async () => {
    failure = { path: "/tables/1/configuration", status: 409, code: "TABLE_HAS_OPEN_ALLOCATION" }
    await expect(api.setTableStatus(1, 4, { status: "ACTIVE", reason: "Repair completed" })).rejects.toMatchObject({
      status: 409,
      code: "TABLE_HAS_OPEN_ALLOCATION",
    })
    expect(writes()).toHaveLength(1)
  })

  it("preserves observed versions for move/combine and refuses a stale source table", async () => {
    tableState = "IN_USE"
    await api.moveClaim({ claim: { visitId: 31, version: 1 }, fromTableId: 1, toTableId: 2 })
    await api.combineTables({ claim: { reservationId: 11, version: 1 }, addTableIds: [2] })
    expect(writes().map((write) => write.body)).toEqual([
      { version: 1, tableIds: [2] },
      { version: 1, tableIds: [1, 2] },
    ])
    calls = []
    await expect(api.moveClaim({ claim: { visitId: 31 }, fromTableId: 2, toTableId: 1 })).rejects.toMatchObject({
      status: 409,
      code: "TABLE_CONFLICT",
    })
    expect(writes()).toEqual([])
  })
})

describe("unsupported and transport failures", () => {
  const unavailable: { name: string; run: (api: GamApi) => Promise<unknown> }[] = [
    { name: "listVisits", run: (api) => api.listVisits(date) },
    { name: "searchCustomers", run: (api) => api.searchCustomers("An") },
    { name: "getCustomer", run: (api) => api.getCustomer(1) },
    { name: "updateCustomerNotes", run: (api) => api.updateCustomerNotes(1, 1, "x") },
    { name: "listOperations", run: (api) => api.listOperations(10) },
    { name: "listAllocations", run: (api) => api.listAllocations(date) },
    { name: "getReport", run: (api) => api.getReport({ from: date, to: date, zone: "ALL" }) },
    { name: "undo", run: (api) => api.undo(1) },
    { name: "redo", run: (api) => api.redo(1) },
    { name: "updateVenueConfig", run: (api) => api.updateVenueConfig({ version: 1 }) },
    { name: "setZoneFlags", run: (api) => api.setZoneFlags(1, 1, { isBookable: true, isWaitingArea: false }) },
    { name: "setHoldDeadline", run: (api) => api.setHoldDeadline(1, 1, at, "x") },
    { name: "releaseHold", run: (api) => api.releaseHold(1, 1, "OTHER") },
    { name: "splitGroup", run: (api) => api.splitGroup({ groupId: 1, keepTableIds: [1] }) },
    { name: "claimWaitlist", run: (api) => api.claimWaitlist(21, 2) },
    { name: "releaseClaim", run: (api) => api.releaseClaim(21, 2) },
    { name: "markPaid", run: (api) => api.markPaid(31, 5) },
  ]
  it.each(unavailable)("$name rejects 501 without a network request", async ({ run }) => {
    await expect(run(api)).rejects.toMatchObject({ status: 501, code: "NOT_SUPPORTED_BY_BACKEND" })
    expect(calls).toEqual([])
  })
  it("identifies only the explicit unsupported ApiError", () => {
    expect(isNotSupported(new ApiError(501, "NOT_SUPPORTED_BY_BACKEND", "x"))).toBe(true)
    expect(isNotSupported(new ApiError(403, "PERMISSION_DENIED", "x"))).toBe(false)
  })
  it("does not mistake a waitlist customer id for a booking id or cache revealed numbers", async () => {
    await expect(api.revealPhone(99, "CALLBACK", { entryId: 21 })).rejects.toMatchObject({ status: 501 })
    expect(calls).toEqual([])
    await api.revealPhone(11, "CALLBACK", {})
    await api.revealPhone(11, "CALLBACK", {})
    expect(writes().map((write) => write.path)).toEqual(["/bookings/11/phone:reveal", "/bookings/11/phone:reveal"])
  })
  it("surfaces unauthenticated adapter calls as ApiError 401", async () => {
    failure = { path: `/waitlist?date=${date}`, status: 401, code: "AUTHENTICATION_REQUIRED" }
    await expect(api.listWaitlist(date)).rejects.toBeInstanceOf(ApiError)
    await expect(api.listWaitlist(date)).rejects.toMatchObject({ status: 401, code: "AUTHENTICATION_REQUIRED" })
  })
  it("does not silently discard unsupported advance waitlist preferences", async () => {
    await expect(
      api.addWaitlist({
        kind: "ADVANCE_RESERVATION",
        reservationId: 11,
        channel: "IN_PERSON",
        preferenceMode: "PREFERRED_ONLY",
        preferences: [{ tableId: 1 }],
      }),
    ).rejects.toMatchObject({ status: 501 })
    expect(calls).toEqual([])
  })
  it("requires an advance reservation id and a reason for service status changes before sending writes", async () => {
    await expect(
      api.addWaitlist({ kind: "ADVANCE_RESERVATION", channel: "IN_PERSON", preferenceMode: "ANY", preferences: [] }),
    ).rejects.toMatchObject({ status: 400 })
    await expect(api.setTableStatus(1, 4, { status: "OUT_OF_SERVICE" })).rejects.toMatchObject({
      status: 400,
      code: "REASON_REQUIRED",
    })
    await expect(api.setTableStatus(1, 4, { status: "ACTIVE", reason: "  " })).rejects.toMatchObject({
      status: 400,
      code: "REASON_REQUIRED",
    })
    expect(calls).toEqual([])
  })
})

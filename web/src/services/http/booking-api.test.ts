import { afterEach, describe, expect, it, vi } from "vitest"
import { HttpBookingApi } from "./booking-api"
import { HttpClient } from "./http-client"

const booking = {
  id: 7,
  guestName: "Khách API",
  phoneLast3: null,
  partySize: 2,
  expectedAt: "2030-10-24T12:00:00.000Z",
  businessDate: "2030-10-24",
  classification: "UNCLASSIFIED" as const,
  guestType: null,
  isBirthday: false,
  status: "BOOKED",
  source: "Hotline",
  sourceCode: "HOTLINE",
  tableCodes: [],
  note: null,
  version: 1,
  displayStatus: "UPCOMING",
  minutesLate: 0,
  autoNoShowDue: false,
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } })

afterEach(() => vi.unstubAllGlobals())

describe("HTTP booking endpoints", () => {
  it("loads the plain-text daily export from the real backend endpoint", async () => {
    const requests: string[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        requests.push(String(input))
        return new Response("Danh sách bàn đặt 21Gam", {
          headers: { "content-type": "text/plain; charset=utf-8" },
        })
      }),
    )
    const api = new HttpBookingApi(new HttpClient("http://api.test"))
    expect(await api.exportDailyText("2030-10-24")).toBe("Danh sách bàn đặt 21Gam")
    expect(new URL(requests[0]!).pathname).toBe("/api/v1/bookings/export")
    expect(new URL(requests[0]!).searchParams.get("date")).toBe("2030-10-24")
  })

  it("uses list and search endpoints without duplicate fallback requests", async () => {
    const urls: string[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        urls.push(String(input))
        return json({ businessDate: booking.businessDate, bookings: [booking] })
      }),
    )
    const api = new HttpBookingApi(new HttpClient("http://api.test"))
    await api.list("2030-10-24")
    await api.list("2030-10-24", "Khách API")
    expect(urls.map((url) => new URL(url).pathname)).toEqual(["/api/v1/bookings", "/api/v1/bookings/search"])
    expect(new URL(urls[1]!).searchParams.get("q")).toBe("Khách API")
  })

  it("uses exact last3 reception search and preserves waitlist/table identities", async () => {
    let requested = ""
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        requested = String(input)
        return json({
          businessDate: "2030-10-24",
          query: { last3: "123" },
          bookings: [{ id: 7, displayName: "Khách API", phoneLast3: "123", tableIds: [11] }],
          waitlist: [
            {
              id: 9,
              reservationId: null,
              displayName: "Khách chờ",
              phoneLast3: "123",
              tableIds: [],
              status: "WAITING",
            },
          ],
          summary: { bookingCount: 1, waitlistCount: 1, totalCount: 2 },
        })
      }),
    )
    const api = new HttpBookingApi(new HttpClient("http://api.test"))
    const result = await api.searchReception("2030-10-24", { last3: "123" })
    const url = new URL(requested)
    expect(url.searchParams.get("last3")).toBe("123")
    expect(url.searchParams.has("q")).toBe(false)
    expect(result.bookings[0]?.tableIds).toEqual([11])
    expect(result.waitlist[0]?.tableIds).toEqual([])
  })

  it("uses detail, create, atomic direct create, full PUT update and cancel response envelopes", async () => {
    const requests: { url: string; method: string; body: unknown }[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        requests.push({
          url: String(input),
          method: init?.method ?? "GET",
          body: init?.body ? JSON.parse(String(init.body)) : null,
        })
        return json({ booking })
      }),
    )
    const api = new HttpBookingApi(new HttpClient("http://api.test"))
    const current = await api.detail(7)
    await api.create({
      guestName: "Khách API",
      partySize: 2,
      expectedAt: current.expectedAt,
      businessDate: current.businessDate,
      sourceCode: "HOTLINE",
    })
    await api.createAndAssign(
      {
        guestName: "Khách API",
        partySize: 2,
        expectedAt: current.expectedAt,
        businessDate: current.businessDate,
        sourceCode: "HOTLINE",
      },
      [11, 12],
    )
    await api.update(current, { partySize: 3 })
    await api.cancelVersion(current.id, current.version, "Khách gọi hủy")

    expect(requests.map(({ method, url }) => `${method} ${new URL(url).pathname}`)).toEqual([
      "GET /api/v1/bookings/7",
      "POST /api/v1/bookings",
      "POST /api/v1/bookings/direct",
      "PUT /api/v1/bookings/7",
      "POST /api/v1/bookings/7/cancel",
    ])
    expect(requests[2]?.body).toMatchObject({ guestName: "Khách API", partySize: 2, tableIds: [11, 12] })
    expect(requests[3]?.body).toMatchObject({ guestName: "Khách API", partySize: 3, version: 1 })
    expect(requests[4]?.body).toEqual({ version: 1, reasonNote: "Khách gọi hủy" })
  })

  it("assigns through the backend transaction with the supplied booking version", async () => {
    const requests: { url: string; method: string; body: unknown }[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        requests.push({
          url: String(input),
          method: init?.method ?? "GET",
          body: init?.body ? JSON.parse(String(init.body)) : null,
        })
        if (init?.method === "POST") return json({ booking: { ...booking, tableCodes: ["A1"], version: 2 } })
        return json({ booking })
      }),
    )
    const api = new HttpBookingApi(new HttpClient("http://api.test"))
    const current = await api.detail(7)
    const assigned = await api.assignVersion(current.id, current.version, [12])

    expect(assigned).toMatchObject({ tableCodes: ["A1"], version: 2 })
    expect(requests.map(({ method, url }) => `${method} ${new URL(url).pathname}`)).toEqual([
      "GET /api/v1/bookings/7",
      "POST /api/v1/bookings/7/assign",
    ])
    expect(requests.at(-1)).toMatchObject({
      method: "POST",
      body: { version: 1, tableIds: [12] },
    })
  })

  it("checks in with the current booking version", async () => {
    const requests: { url: string; method: string; body: unknown }[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        requests.push({
          url: String(input),
          method: init?.method ?? "GET",
          body: init?.body ? JSON.parse(String(init.body)) : null,
        })
        return json({ booking: { ...booking, status: "CHECKED_IN", displayStatus: "CHECKED_IN", version: 2 } })
      }),
    )
    const api = new HttpBookingApi(new HttpClient("http://api.test"))
    const checkedIn = await api.checkIn({
      ...booking,
      expectedAt: new Date(booking.expectedAt),
      businessDate: "2030-10-24",
      status: "BOOKED",
      sourceCode: "HOTLINE",
      displayStatus: "UPCOMING",
    })

    expect(checkedIn).toMatchObject({ status: "CHECKED_IN", version: 2 })
    expect(requests[0]).toMatchObject({
      method: "POST",
      body: { version: 1 },
    })
    expect(new URL(requests[0]!.url).pathname).toBe("/api/v1/bookings/7/check-in")
  })

  it("reveals the selected booking phone only through the non-cached POST endpoint", async () => {
    const requests: { url: string; method: string; body: unknown }[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        requests.push({
          url: String(input),
          method: init?.method ?? "GET",
          body: init?.body ? JSON.parse(String(init.body)) : null,
        })
        return json({ phoneNumber: "+84987654321" })
      }),
    )
    const api = new HttpBookingApi(new HttpClient("http://api.test"))
    expect(await api.revealPhone(7)).toBe("+84987654321")
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ method: "POST", body: {} })
    expect(new URL(requests[0]!.url).pathname).toBe("/api/v1/bookings/7/phone:reveal")
  })
})

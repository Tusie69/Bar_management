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

  it("uses detail, create, full PUT update and cancel response envelopes", async () => {
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
    await api.update(current, { partySize: 3 })
    await api.cancel(current, "Khách gọi hủy")

    expect(requests.map(({ method, url }) => `${method} ${new URL(url).pathname}`)).toEqual([
      "GET /api/v1/bookings/7",
      "POST /api/v1/bookings",
      "PUT /api/v1/bookings/7",
      "POST /api/v1/bookings/7/cancel",
    ])
    expect(requests[2]?.body).toMatchObject({ guestName: "Khách API", partySize: 3, version: 1 })
    expect(requests[3]?.body).toEqual({ version: 1, reasonNote: "Khách gọi hủy" })
  })

  it("reads table state for the booking date and assigns through the backend transaction", async () => {
    const requests: { url: string; method: string; body: unknown }[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        requests.push({
          url: String(input),
          method: init?.method ?? "GET",
          body: init?.body ? JSON.parse(String(init.body)) : null,
        })
        const path = new URL(String(input)).pathname
        if (path === "/api/v1/tables") {
          return json({ tables: [{ id: 12, code: "A1", state: "AVAILABLE", isBackup: false }] })
        }
        if (init?.method === "POST") return json({ booking: { ...booking, tableCodes: ["A1"], version: 2 } })
        return json({ booking })
      }),
    )
    const api = new HttpBookingApi(new HttpClient("http://api.test"))
    const current = await api.detail(7)
    const tables = await api.assignmentTables("2030-10-24")
    const assigned = await api.assign(current, [12])

    expect(tables).toEqual([{ id: 12, code: "A1", state: "AVAILABLE", isSpare: false }])
    expect(assigned).toMatchObject({ tableCodes: ["A1"], version: 2 })
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

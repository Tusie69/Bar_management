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
  it("uses list and search endpoints without duplicate fallback requests", async () => {
    const urls: string[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        urls.push(String(input))
        return json({ bookings: [booking] })
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
})

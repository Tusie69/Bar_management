import { afterEach, describe, expect, it, vi } from "vitest"
import { HttpClient } from "./http-client"
import { HttpVisitApi } from "./visit-api"

afterEach(() => vi.unstubAllGlobals())

describe("HTTP visit move", () => {
  it("sends one atomic move request with the selected visit version", async () => {
    const calls: Array<{ url: string; method?: string; body?: string | null }> = []
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method, body: init?.body?.toString() })
      return new Response(JSON.stringify({
        visit: { id: 12, businessDate: "2030-01-01", version: 4, previousTables: [], tables: [] },
      }), { status: 200, headers: { "content-type": "application/json" } })
    }))
    const api = new HttpVisitApi(new HttpClient("http://api.test"))
    await api.move(12, 3, [9])
    expect(new URL(calls[0]!.url).pathname).toBe("/api/v1/visits/12/move")
    expect(calls[0]?.method).toBe("POST")
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ version: 3, tableIds: [9] })
  })
})

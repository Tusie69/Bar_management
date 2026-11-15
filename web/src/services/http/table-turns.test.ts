import { afterEach, expect, it, vi } from "vitest"
import { createHttpApi } from "./http-api"
import { HttpClient } from "./http-client"

afterEach(() => vi.unstubAllGlobals())
it("requests ledger/summary filters and preserves the documented ISO timestamp strings", async () => {
  const paths: URL[] = []
  const payload = {
    turns: [
      {
        visitId: 8,
        turnId: null,
        status: "OPEN",
        checkedInByUserId: 5,
        checkedInByDisplayName: "Reception",
        seatedAt: "2030-10-24T13:00:00.000Z",
        releasedAt: null,
      },
    ],
  }
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      paths.push(new URL(input))
      return new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } })
    }),
  )
  const api = createHttpApi(new HttpClient("http://api.test"), 999)
  const filters = {
    from: "2030-10-21",
    to: "2030-10-27",
    closedByUserId: 3,
    checkedInByUserId: 5,
    includeUncounted: false,
  }
  expect(await api.getTableTurns({ ...filters, page: 2, pageSize: 1 })).toEqual(payload)
  await api.getTableTurnSummary({ ...filters, includeUncounted: true })
  expect(paths.map((url) => url.pathname)).toEqual(["/api/v1/visits/turns", "/api/v1/visits/turns/summary"])
  expect(Object.fromEntries(paths[0]!.searchParams)).toEqual({
    from: filters.from,
    to: filters.to,
    closedByUserId: "3",
    checkedInByUserId: "5",
    includeUncounted: "false",
    page: "2",
    pageSize: "1",
  })
  expect(Object.fromEntries(paths[1]!.searchParams)).toEqual({
    from: filters.from,
    to: filters.to,
    closedByUserId: "3",
    checkedInByUserId: "5",
    includeUncounted: "true",
  })
})

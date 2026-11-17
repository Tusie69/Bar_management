import { afterEach, expect, it, vi } from "vitest"
import { createHttpApi } from "./http-api"
import { HttpClient } from "./http-client"
afterEach(() => vi.unstubAllGlobals())
it("sends the NA-34 contract, versions and idempotency keys while preserving ISO timestamps", async () => {
  const calls: Array<{ path: string; init?: RequestInit }> = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ path: new URL(url).pathname + new URL(url).search, init })
      return new Response(JSON.stringify({ seatedAt: "2030-10-24T14:00:00.000Z", maskedPhone: "••• 678" }), {
        headers: { "content-type": "application/json" },
      })
    }),
  )
  const client = new HttpClient("http://api.test")
  client.setCsrfToken("test")
  const api = createHttpApi(client, 999)
  const received = await api.getAnonymousVisits({ from: "2030-10-24", to: "2030-10-25", pageSize: 1 })
  expect(received).toMatchObject({ seatedAt: "2030-10-24T14:00:00.000Z" })
  await api.assignAnonymousVisit({
    visitId: 7,
    version: 2,
    phone: "0901234678",
    displayName: "An",
    idempotencyKey: "na34-key",
  })
  await api.undoAnonymousAssignment({ visitId: 7, version: 3, operationId: 8, previousCustomerId: null })
  await api.getDuplicateCustomers({ page: 2, pageSize: 10 })
  const pair = { sourceCustomerId: 1, targetCustomerId: 2, sourceVersion: 3, targetVersion: 4 }
  await api.mergeDuplicateCustomers(pair)
  await api.dismissDuplicateCustomers(pair)
  expect(calls.map((call) => call.path)).toEqual([
    "/api/v1/visits/anonymous?from=2030-10-24&to=2030-10-25&pageSize=1",
    "/api/v1/visits/7/customer-assignment",
    "/api/v1/visits/7/customer-assignment/undo",
    "/api/v1/customers/duplicates?page=2&pageSize=10",
    "/api/v1/customers/duplicates/merge",
    "/api/v1/customers/duplicates/dismiss",
  ])
  expect(JSON.parse(calls[1]!.init!.body as string)).toEqual({ version: 2, phone: "0901234678", displayName: "An" })
  expect(new Headers(calls[1]!.init!.headers).get("Idempotency-Key")).toBe("na34-key")
  expect(JSON.parse(calls[2]!.init!.body as string)).toEqual({ operationId: 8, version: 3 })
  expect(JSON.parse(calls[4]!.init!.body as string)).toEqual(pair)
})

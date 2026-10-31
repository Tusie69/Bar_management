import { afterEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "../contracts"
import { AuthApi } from "./auth-api"
import { HttpClient } from "./http-client"

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("HttpClient", () => {
  it("uses /api/v1, includes cookies and parses JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ ok: true }))
    vi.stubGlobal("fetch", fetchMock)
    const client = new HttpClient("https://api.example.test/")

    await expect(client.get("/health")).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/api/v1/health",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    )
  })

  it("adds an in-memory CSRF token to writes without claiming idempotency", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", fetchMock)
    const client = new HttpClient("https://api.example.test")
    client.setCsrfToken("csrf-secret")

    await expect(client.post("/auth/logout")).resolves.toBeUndefined()
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(init.headers).toMatchObject({ "x-csrf-token": "csrf-secret" })
    expect(init.headers).not.toHaveProperty("Idempotency-Key")
  })

  it("normalizes the backend error envelope and preserves its code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        json(
          {
            error: { code: "VERSION_CONFLICT", message: "Dữ liệu vừa thay đổi." },
          },
          409,
        ),
      ),
    )
    const client = new HttpClient("https://api.example.test")

    await expect(client.patch("/resource/1", { version: 1 })).rejects.toMatchObject({
      status: 409,
      code: "VERSION_CONFLICT",
      message: "Dữ liệu vừa thay đổi.",
    })
  })

  it("reports network failures without retrying the request", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("offline"))
    vi.stubGlobal("fetch", fetchMock)
    const client = new HttpClient("https://api.example.test")

    await expect(client.get("/health")).rejects.toMatchObject({ code: "NETWORK_ERROR" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("aborts a request that exceeds its timeout", async () => {
    const fetchMock = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))
        }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const client = new HttpClient("https://api.example.test", 5)

    await expect(client.get("/slow")).rejects.toMatchObject({ code: "REQUEST_TIMEOUT" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("returns successful non-JSON responses as text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("export-data", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
      ),
    )
    const client = new HttpClient("https://api.example.test")
    await expect(client.get("/bookings/export")).resolves.toBe("export-data")
  })

  it("notifies the session layer on unauthorized and invalid CSRF responses", async () => {
    const unauthorized = vi.fn()
    const csrfFailure = vi.fn()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ error: { code: "SESSION_INVALID", message: "Hết phiên" } }, 401))
      .mockResolvedValueOnce(json({ error: { code: "CSRF_TOKEN_INVALID", message: "Sai CSRF" } }, 403))
    vi.stubGlobal("fetch", fetchMock)
    const client = new HttpClient("https://api.example.test")
    client.setUnauthorizedHandler(unauthorized)
    client.setCsrfFailureHandler(csrfFailure)

    await expect(client.get("/auth/me")).rejects.toBeInstanceOf(ApiError)
    await expect(client.post("/auth/logout")).rejects.toBeInstanceOf(ApiError)
    expect(unauthorized).toHaveBeenCalledOnce()
    expect(csrfFailure).toHaveBeenCalledOnce()
  })
})

describe("AuthApi", () => {
  it("accepts login/me contracts and sends the returned CSRF token on logout", async () => {
    const session = {
      user: {
        id: 7,
        username: "operator",
        displayName: "Operator",
        organizationId: 1,
        venueId: 1,
        roles: ["OWNER_ADMIN"],
      },
      permissions: ["customer.view_masked"],
      csrfToken: "server-csrf",
      expiresAt: "2026-10-29T00:00:00.000Z",
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(session))
      .mockResolvedValueOnce(json(session))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", fetchMock)
    const client = new HttpClient("https://api.example.test")
    const auth = new AuthApi(client)

    await expect(auth.login("operator", "password")).resolves.toEqual(session)
    await expect(auth.me()).resolves.toEqual(session)
    await expect(auth.logout()).resolves.toBeUndefined()
    const logoutInit = fetchMock.mock.calls[2]?.[1] as RequestInit
    expect(logoutInit.headers).toMatchObject({ "x-csrf-token": "server-csrf" })
  })

  it("rejects a malformed session response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ user: { id: 1 } })))
    const auth = new AuthApi(new HttpClient("https://api.example.test"))
    await expect(auth.me()).rejects.toMatchObject({ code: "INVALID_RESPONSE" })
  })

  it.each([undefined, "OWNER_ADMIN", ["OWNER_ADMIN", 7]])("rejects malformed role codes %j", async (roles) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        json({
          user: { id: 7, username: "operator", displayName: "Operator", organizationId: 1, venueId: 1, roles },
          permissions: [],
          csrfToken: "csrf",
        }),
      ),
    )
    const auth = new AuthApi(new HttpClient("https://api.example.test"))
    await expect(auth.me()).rejects.toMatchObject({ code: "INVALID_RESPONSE" })
  })
})

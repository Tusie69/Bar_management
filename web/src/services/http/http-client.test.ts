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
  it.each([
    ["MERGE_REQUIRES_MULTIPLE_TABLES", "ít nhất hai bàn"],
    ["TABLE_NOT_FOUND", "không tồn tại"],
    ["TABLE_ALREADY_GROUPED", "nhóm khác"],
    ["SPARE_TABLE_NOT_BOOKABLE", "bàn sơ cua"],
    ["TABLE_KIND_MISMATCH", "ghế Bar"],
    ["TABLE_ZONE_MISMATCH", "cùng một khu vực"],
    ["TABLE_GROUP_MIXED_STATE", "bàn trống"],
    ["TABLE_GROUP_MULTIPLE_CLAIMS", "khác nhau"],
    ["INVALID_GROUP_ID", "Mã nhóm"],
    ["TABLES_REQUIRED", "bàn giữ lại"],
    ["INVALID_SPLIT_MODE", "Cách tách nhóm"],
    ["TABLE_GROUP_VERSION_CONFLICT", "tải lại sơ đồ"],
    ["PAYMENT_SOURCE_INVALID", "iPOS"],
    ["PAYMENT_ALREADY_CONFIRMED", "đã được xác nhận"],
    ["VISIT_NOT_OPEN", "đã kết thúc"],
    ["PAYMENT_VERIFICATION_UNAVAILABLE", "Chưa có xác nhận"],
    ["EXPECTED_AT_OFF_SLOT", "bước 5 phút"],
    ["INVALID_PHONE_NUMBER", "độ dài"],
    ["PHONE_NOT_DIALABLE", "không thể dùng để gọi"],
  ])("maps section D code %s to Vietnamese and retains its details", async (code, text) => {
    const details = { conflictingTableIds: [101, 102], currentVersion: 7, changeSeq: "42" }
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json({ error: { code, message: "backend English", details } }, 409)),
    )
    await expect(new HttpClient("https://api.test").get("/tables")).rejects.toMatchObject({
      code,
      message: expect.stringContaining(text),
      details,
    })
  })
  it.each(["TABLE_GROUP_MIXED_STATE", "TABLE_GROUP_MULTIPLE_CLAIMS"])(
    "names the conflicting tables for %s",
    async (code) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(json({ error: { code, details: { conflictingTableIds: [101, 102] } } }, 409)),
      )
      await expect(new HttpClient("https://api.test").get("/tables")).rejects.toMatchObject({
        message: expect.stringContaining("Bàn: #101, #102"),
      })
    },
  )
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

  it("sends the Idempotency-Key header only when a create passes one (FX-04)", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => json({ ok: true }, 201))
    vi.stubGlobal("fetch", fetchMock)
    const client = new HttpClient("https://api.example.test")
    client.setCsrfToken("csrf-secret")

    await client.post("/bookings", { guestName: "A" }, { idempotencyKey: "form-key-0001" })
    await client.get("/bookings?date=2026-11-01", { idempotencyKey: "ignored-on-get" })
    const createInit = fetchMock.mock.calls[0]?.[1] as RequestInit
    const readInit = fetchMock.mock.calls[1]?.[1] as RequestInit
    expect(createInit.headers).toMatchObject({ "Idempotency-Key": "form-key-0001", "x-csrf-token": "csrf-secret" })
    expect(readInit.headers).not.toHaveProperty("Idempotency-Key")
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
      portal: "admin" as const,
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

    await expect(auth.login("operator", "password", "admin")).resolves.toEqual(session)
    await expect(auth.me()).resolves.toEqual(session)
    await expect(auth.logout()).resolves.toBeUndefined()
    const logoutInit = fetchMock.mock.calls[2]?.[1] as RequestInit
    expect(logoutInit.headers).toMatchObject({ "x-csrf-token": "server-csrf" })
    expect(JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body))).toEqual({
      username: "operator",
      password: "password",
      portal: "admin",
    })
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

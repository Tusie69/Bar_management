import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/services/contracts"

const auth = vi.hoisted(() => ({ login: vi.fn(), me: vi.fn(), clear: vi.fn() }))
vi.mock("@/services", () => ({
  ApiError,
  api: { mode: "http", listDemoUsers: () => [] },
  authApi: auth,
  httpClient: { setUnauthorizedHandler: vi.fn(), setCsrfFailureHandler: vi.fn() },
}))

let useSession: (typeof import("./session"))["useSession"]
beforeAll(async () => {
  vi.stubGlobal("document", {
    documentElement: { classList: { toggle: vi.fn() }, style: {} },
    querySelector: () => null,
  })
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() })
  useSession = (await import("./session")).useSession
})
beforeEach(() => {
  vi.clearAllMocks()
  useSession.setState({ principal: null, permissions: [], authStatus: "loading", authError: null })
})
afterAll(() => vi.unstubAllGlobals())

const session = (roles: string[]) => ({
  user: { id: 7, username: "operator", displayName: "Operator", organizationId: 1, venueId: 1, roles },
  permissions: ["customer.view_masked"],
  csrfToken: "csrf",
})

describe("HTTP session role selection", () => {
  it.each([
    [["RECEPTIONIST", "CASHIER", "CUSTOMER_CARE", "OWNER_ADMIN"], "OWNER_ADMIN"],
    [["OWNER_ADMIN", "CUSTOMER_CARE", "CASHIER", "RECEPTIONIST"], "OWNER_ADMIN"],
    [["RECEPTIONIST", "CASHIER", "CUSTOMER_CARE"], "CUSTOMER_CARE"],
    [["RECEPTIONIST", "CASHIER"], "CASHIER"],
    [["RECEPTIONIST"], "RECEPTIONIST"],
  ])("selects the highest privilege role from %j", async (roles, expected) => {
    auth.login.mockResolvedValue(session(roles as string[]))
    await useSession.getState().login("operator", "password")
    expect(useSession.getState().user.role).toBe(expected)
    expect(useSession.getState().principal?.roles).toEqual(roles)
    expect(useSession.getState().permissions).toEqual(["customer.view_masked"])
  })

  it("uses the same role mapping when restoring /auth/me", async () => {
    auth.me.mockResolvedValue(session(["OWNER_ADMIN"]))
    await useSession.getState().bootstrap()
    expect(useSession.getState().user.role).toBe("OWNER_ADMIN")
    expect(useSession.getState().authStatus).toBe("authenticated")
  })

  it("rejects unsupported roles instead of inventing a receptionist identity", async () => {
    auth.login.mockResolvedValue(session(["UNKNOWN_ROLE"]))
    await expect(useSession.getState().login("operator", "password")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    })
    expect(useSession.getState().principal).toBeNull()
  })
})

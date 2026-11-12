import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/services/contracts"
import type { AuthPortal } from "@/domain/auth-portal"

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
  useSession.setState({ principal: null, permissions: [], portal: null, authStatus: "loading", authError: null })
})
afterAll(() => vi.unstubAllGlobals())

const session = (roles: string[], portal: AuthPortal) => ({
  user: { id: 7, username: "operator", displayName: "Operator", organizationId: 1, venueId: 1, roles },
  permissions: ["customer.view_masked"],
  csrfToken: "csrf",
  portal,
})

describe("HTTP portal-bound session role selection", () => {
  it.each([
    [["RECEPTIONIST", "CASHIER", "CUSTOMER_CARE", "OWNER_ADMIN"], "receptionist", "RECEPTIONIST"],
    [["OWNER_ADMIN", "CUSTOMER_CARE", "CASHIER", "RECEPTIONIST"], "admin", "OWNER_ADMIN"],
    [["RECEPTIONIST", "CASHIER", "CUSTOMER_CARE"], "customer-care", "CUSTOMER_CARE"],
    [["RECEPTIONIST", "CASHIER"], "cashier", "CASHIER"],
  ] as const)("selects only the %s portal role", async (roles, portal, expected) => {
    auth.login.mockResolvedValue(session([...roles], portal))
    await useSession.getState().login("operator", "password", portal)
    expect(useSession.getState().user.role).toBe(expected)
    expect(useSession.getState().principal?.roles).toEqual(roles)
    expect(useSession.getState().permissions).toEqual(["customer.view_masked"])
  })

  it("uses the same role mapping when restoring /auth/me", async () => {
    auth.me.mockResolvedValue(session(["OWNER_ADMIN"], "admin"))
    await useSession.getState().bootstrap()
    expect(useSession.getState().user.role).toBe("OWNER_ADMIN")
    expect(useSession.getState().authStatus).toBe("authenticated")
  })

  it("rejects unsupported roles instead of inventing a receptionist identity", async () => {
    auth.login.mockResolvedValue(session(["UNKNOWN_ROLE"], "receptionist"))
    await expect(useSession.getState().login("operator", "password", "receptionist")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    })
    expect(useSession.getState().principal).toBeNull()
  })
})

describe("theme default and persistence (Item 1)", () => {
  it("defaults to light theme when localStorage is empty", () => {
    expect(useSession.getState().theme).toBe("light")
  })

  it("preserves saved theme when set", () => {
    useSession.getState().setTheme("dark")
    expect(useSession.getState().theme).toBe("dark")
    useSession.getState().setTheme("light")
    expect(useSession.getState().theme).toBe("light")
  })

  it("persists theme change to localStorage and updates document element", () => {
    useSession.getState().setTheme("dark")
    expect(useSession.getState().theme).toBe("dark")
    expect(localStorage.setItem).toHaveBeenCalledWith(
      "21gam.session.v1",
      expect.stringContaining('"theme":"dark"'),
    )
    expect(document.documentElement.classList.toggle).toHaveBeenCalledWith("dark", true)

    useSession.getState().setTheme("light")
    expect(useSession.getState().theme).toBe("light")
    expect(localStorage.setItem).toHaveBeenCalledWith(
      "21gam.session.v1",
      expect.stringContaining('"theme":"light"'),
    )
    expect(document.documentElement.classList.toggle).toHaveBeenCalledWith("dark", false)
  })
})

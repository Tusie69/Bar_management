import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/services/contracts"
import type { AuthPortal } from "@/domain/auth-portal"

const auth = vi.hoisted(() => ({ login: vi.fn(), me: vi.fn(), clear: vi.fn(), logout: vi.fn() }))
const replace = vi.hoisted(() => vi.fn())
const sessionStore = vi.hoisted(() => ({ getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() }))
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
  vi.stubGlobal("sessionStorage", sessionStore)
  vi.stubGlobal("window", { location: { replace } })
  useSession = (await import("./session")).useSession
})
beforeEach(() => {
  vi.clearAllMocks()
  useSession.setState({
    principal: null,
    permissions: [],
    portal: null,
    authStatus: "loading",
    authError: null,
    authEndCode: null,
    sessionEndNotice: false,
  })
})
afterAll(() => vi.unstubAllGlobals())

const session = (roles: string[], portal: AuthPortal) => ({
  user: {
    id: 7,
    username: "operator",
    displayName: "Operator",
    organizationId: 1,
    venueId: 1,
    roles,
    accessLevel: roles.includes("ADMIN") ? ("WRITE" as const) : null,
  },
  permissions: ["customer.view_masked"],
  csrfToken: "csrf",
  portal,
})

describe("HTTP portal-bound session role selection", () => {
  it.each([
    [["RECEPTIONIST", "CASHIER", "CUSTOMER_CARE", "OWNER"], "receptionist", "RECEPTIONIST"],
    [["OWNER", "CUSTOMER_CARE", "CASHIER", "RECEPTIONIST"], "admin", "OWNER"],
    [["ADMIN"], "admin", "ADMIN"],
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
    auth.me.mockResolvedValue(session(["OWNER"], "admin"))
    await useSession.getState().bootstrap()
    expect(useSession.getState().user.role).toBe("OWNER")
    expect(useSession.getState().authStatus).toBe("authenticated")
  })

  it("rejects unsupported roles instead of inventing a receptionist identity", async () => {
    auth.login.mockResolvedValue(session(["UNKNOWN_ROLE"], "receptionist"))
    await expect(useSession.getState().login("operator", "password", "receptionist")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    })
    expect(useSession.getState().principal).toBeNull()
  })

  it("clears auth state but stays on screen so the reason can be read", async () => {
    auth.login.mockResolvedValue(session(["OWNER"], "admin"))
    await useSession.getState().login("operator", "password", "admin")

    useSession.getState().expire("Phiên đã bị thay thế.", "SESSION_REPLACED")

    expect(auth.clear).toHaveBeenCalled()
    expect(useSession.getState()).toMatchObject({
      principal: null,
      permissions: [],
      authStatus: "anonymous",
      authError: "Phiên đã bị thay thế.",
      authEndCode: "SESSION_REPLACED",
      sessionEndNotice: true,
      portal: "admin",
    })
    // TU-33: chuyển trang ngay tại đây là lý do câu giải thích không bao giờ
    // kịp hiện ra. Màn báo mới là nơi gọi `leaveToLogin`.
    expect(replace).not.toHaveBeenCalled()
  })

  it("returns to the matching portal login and carries the reason across the reload", async () => {
    auth.login.mockResolvedValue(session(["OWNER"], "admin"))
    await useSession.getState().login("operator", "password", "admin")
    useSession.getState().expire("Phiên đã bị thay thế.", "SESSION_REPLACED")

    useSession.getState().leaveToLogin()

    expect(replace).toHaveBeenCalledWith("/admin/login")
    // Store dựng lại từ đầu sau khi tải trang, nên lý do phải đi qua
    // sessionStorage thì trang đăng nhập mới nói thêm được.
    expect(sessionStore.setItem).toHaveBeenCalledWith("21gam.session-end.v1", "SESSION_REPLACED")
    expect(useSession.getState().sessionEndNotice).toBe(false)
  })

  it("logging out on purpose is not an interrupted session", async () => {
    auth.login.mockResolvedValue(session(["OWNER"], "admin"))
    await useSession.getState().login("operator", "password", "admin")

    await useSession.getState().logout()

    expect(useSession.getState().sessionEndNotice).toBe(false)
    expect(useSession.getState().authEndCode).toBeNull()
    expect(replace).toHaveBeenCalledWith("/admin/login")
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
    expect(localStorage.setItem).toHaveBeenCalledWith("21gam.session.v1", expect.stringContaining('"theme":"dark"'))
    expect(document.documentElement.classList.toggle).toHaveBeenCalledWith("dark", true)

    useSession.getState().setTheme("light")
    expect(useSession.getState().theme).toBe("light")
    expect(localStorage.setItem).toHaveBeenCalledWith("21gam.session.v1", expect.stringContaining('"theme":"light"'))
    expect(document.documentElement.classList.toggle).toHaveBeenCalledWith("dark", false)
  })
})

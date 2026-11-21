/**
 * Nháp giỏ gọi món phải bị dọn trên MỌI đường mất xác thực.
 *
 * Máy Phục vụ là máy dùng chung. Một nháp còn sót lại sau khi phiên chết sẽ
 * được người đăng nhập tiếp theo mở ra và gửi cho sai bàn — và họ không có cách
 * nào biết giỏ đó không phải của mình.
 *
 * `logout` và `expire` đã được kiểm ở đây cùng hai đường còn lại, vốn là hai
 * đường bị bỏ sót: bootstrap trả 401 (mở app khi phiên đã chết) và CSRF token
 * không còn hợp lệ. Cả bốn phải để lại cùng một trạng thái: không `principal`,
 * không `permissions`, không nháp.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/services/contracts"

const auth = vi.hoisted(() => ({ login: vi.fn(), me: vi.fn(), clear: vi.fn(), logout: vi.fn() }))
const handlers = vi.hoisted(() => ({
  unauthorized: null as ((error: ApiError) => void) | null,
  csrf: null as ((error: ApiError) => void) | null,
}))
const drafts = vi.hoisted(() => ({ clearWaiterCartDrafts: vi.fn() }))

vi.mock("@/services", () => ({
  ApiError,
  api: { mode: "http", listDemoUsers: () => [] },
  authApi: auth,
  httpClient: {
    setUnauthorizedHandler: (handler: (error: ApiError) => void) => {
      handlers.unauthorized = handler
    },
    setCsrfFailureHandler: (handler: (error: ApiError) => void) => {
      handlers.csrf = handler
    },
  },
}))
vi.mock("@/domain/waiter-cart-storage", () => drafts)

const signedIn = {
  principal: {
    id: 7,
    username: "phucvu",
    displayName: "Phục vụ",
    organizationId: 1,
    venueId: 1,
    roles: ["WAITER"],
    accessLevel: null,
  },
  permissions: ["order.create", "order.read"],
  portal: "waiter" as const,
  authStatus: "authenticated" as const,
}

let useSession: (typeof import("./session"))["useSession"]
beforeAll(async () => {
  vi.stubGlobal("document", {
    documentElement: { classList: { toggle: vi.fn() }, style: {} },
    querySelector: () => null,
  })
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() })
  vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
  vi.stubGlobal("window", { location: { replace: vi.fn() } })
  useSession = (await import("./session")).useSession
})
afterAll(() => vi.unstubAllGlobals())

beforeEach(() => {
  vi.clearAllMocks()
  useSession.setState({ ...signedIn, authError: null, authEndCode: null, sessionEndNotice: false })
})

function expectSignedOut(): void {
  const state = useSession.getState()
  expect(state.principal).toBeNull()
  expect(state.permissions).toEqual([])
  expect(state.mustChangePassword).toBe(false)
  expect(drafts.clearWaiterCartDrafts).toHaveBeenCalled()
}

describe("dọn nháp giỏ khi mất xác thực", () => {
  it("đăng xuất thành công", async () => {
    auth.logout.mockResolvedValue(undefined)
    await useSession.getState().logout()
    expectSignedOut()
  })

  it("phiên bị thu hồi (expire)", () => {
    useSession.getState().expire("Phiên đã hết hạn.", "AUTH_SESSION_REVOKED")
    expectSignedOut()
    expect(useSession.getState().sessionEndNotice).toBe(true)
  })

  it("bootstrap trả 401: mở app khi phiên đã chết", async () => {
    useSession.setState({ authStatus: "loading", principal: null, permissions: [] })
    auth.me.mockRejectedValue(new ApiError(401, "AUTHENTICATION_REQUIRED", "Chưa đăng nhập."))
    await useSession.getState().bootstrap()
    expect(useSession.getState().authStatus).toBe("anonymous")
    expectSignedOut()
  })

  it("CSRF token không còn hợp lệ", () => {
    expect(handlers.csrf, "session.ts phải đăng ký handler CSRF").not.toBeNull()
    handlers.csrf?.(new ApiError(403, "CSRF_TOKEN_INVALID", "Token không hợp lệ."))
    expect(useSession.getState().authStatus).toBe("error")
    expectSignedOut()
  })

  it("bootstrap lỗi mạng KHÔNG dọn nháp: phiên chưa chắc đã mất", async () => {
    useSession.setState({ authStatus: "loading", principal: null, permissions: [] })
    auth.me.mockRejectedValue(new ApiError(0, "NETWORK_ERROR", "Không kết nối được."))
    await useSession.getState().bootstrap()
    expect(useSession.getState().authStatus).toBe("error")
    // Mạng quán rớt một nhịp không phải là lý do để nhân viên gõ lại cả giỏ.
    expect(drafts.clearWaiterCartDrafts).not.toHaveBeenCalled()
  })
})

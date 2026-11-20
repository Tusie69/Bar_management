/**
 * Authentication/session state.
 *
 * Mock mode preserves the role switcher used by the prototype. HTTP mode is
 * bootstrapped from the server session and authorizes UI controls with the
 * permission list returned by the backend. CSRF stays in the HttpClient's
 * memory only and is never persisted here or in localStorage.
 */
import { create } from "zustand"
import type { Permission } from "@/domain/access"
import { PORTAL_CONFIG, portalLoginPath, type AuthPortal } from "@/domain/auth-portal"
import type { RoleCode } from "@/domain/enums"
import { roleCan } from "@/domain/access"
import { sessionEndMessage } from "@/domain/session-end"
import { clearWaiterCartDrafts } from "@/domain/waiter-cart-storage"
import type { SessionUser } from "@/domain/models"
import { api, ApiError, authApi, httpClient, type AuthSession, type AuthenticatedUser } from "@/services"

export type Theme = "dark" | "light"
export type AuthStatus = "loading" | "authenticated" | "anonymous" | "error"

const STORAGE_KEY = "21gam.session.v1"

function load(): { userId?: number; theme?: Theme } {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}")
  } catch {
    return {}
  }
}

function save(data: { userId: number; theme: Theme }) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    /* storage unavailable: keep presentation settings in memory */
  }
}

/**
 * TU-33 — mang lý do kết thúc phiên qua lần tải lại trang.
 *
 * Về trang đăng nhập là một lần tải tài liệu mới, store dựng lại từ đầu, nên
 * `authEndCode` trong bộ nhớ biến mất và trang đăng nhập không còn gì để nói.
 * Đó là lý do câu "vừa được đăng nhập ở thiết bị khác" trước nay không
 * bao giờ hiện ra: nó được đặt rồi bị xóa ngay trong cùng một nhịp.
 *
 * Dùng `sessionStorage` chứ không `localStorage`: lý do này thuộc về đúng cái
 * tab vừa bị đẩy ra, không phải của mọi tab đang mở trên máy. Đọc là xóa,
 * để lần mở sau không dựng lại một cảnh báo đã cũ.
 */
const END_REASON_KEY = "21gam.session-end.v1"

function rememberSessionEnd(code: string) {
  try {
    sessionStorage.setItem(END_REASON_KEY, code)
  } catch {
    /* storage unavailable: trang đăng nhập sẽ không nói thêm được lý do */
  }
}

function takeSessionEnd(): string | null {
  try {
    const code = sessionStorage.getItem(END_REASON_KEY)
    if (code) sessionStorage.removeItem(END_REASON_KEY)
    return code
  } catch {
    return null
  }
}

function applyTheme(theme: Theme) {
  const root = document.documentElement
  root.classList.toggle("dark", theme === "dark")
  root.style.colorScheme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#0f0e0c" : "#f8f7f2")
}

const users = api.listDemoUsers()
const stored = load()
const initialUser = users.find((user) => user.id === stored.userId) ?? users[0]
const initialTheme: Theme = stored.theme ?? "light"
let carriedEnd = takeSessionEnd()
if (api.mode === "mock" && initialUser) api.setSession(initialUser)
applyTheme(initialTheme)

interface SessionState {
  // Mock-only identity retained for the existing dashboard.
  user: SessionUser
  users: SessionUser[]
  // HTTP identity and server-authoritative permissions.
  principal: AuthenticatedUser | null
  permissions: string[]
  portal: AuthPortal | null
  /** TU-34: phải đổi mật khẩu tạm trước khi dùng được app. */
  mustChangePassword: boolean
  authStatus: AuthStatus
  authError: string | null
  /**
   * TU-33: mã lý do phiên kết thúc, để trang đăng nhập nói thêm được rằng nội
   * dung đang gõ dở đã mất. Chỉ có message thì không phân biệt được "hết hạn
   * bình thường" với "bị đẩy ra giữa lúc đang nhập booking".
   */
  authEndCode: string | null
  /**
   * TU-33: phiên vừa kết thúc NGAY TRÊN MÀN HÌNH NÀY, nên phải dừng lại
   * báo cho người dùng trước khi đưa họ về trang đăng nhập. Khác với một
   * `authEndCode` mang sang từ lần tải trước — cái đó chỉ là ghi chú cho
   * trang đăng nhập, không dựng lại màn thông báo một lần nữa.
   */
  sessionEndNotice: boolean
  theme: Theme
  setUser: (id: number) => void
  setTheme: (theme: Theme) => void
  bootstrap: () => Promise<void>
  login: (username: string, password: string, portal: AuthPortal) => Promise<void>
  logout: () => Promise<void>
  expire: (message?: string, code?: string) => void
  /** Rời màn thông báo kết thúc phiên để về đúng cổng đăng nhập. */
  leaveToLogin: () => void
}

const fallbackMockUser: SessionUser = initialUser ?? {
  id: 0,
  displayName: "Chưa đăng nhập",
  role: "RECEPTIONIST",
  deviceLabel: "",
}

let bootstrapPromise: Promise<void> | null = null

function applyServerSession(session: AuthSession) {
  const role = PORTAL_CONFIG[session.portal].roles.find((candidate) => session.user.roles.includes(candidate)) as
    RoleCode | undefined
  if (!role) {
    throw new ApiError(502, "INVALID_RESPONSE", "Vai trò phiên đăng nhập không khớp cổng đã xác nhận.")
  }
  useSession.setState({
    user: { id: session.user.id, displayName: session.user.displayName, role, deviceLabel: "" },
    principal: session.user,
    permissions: [...session.permissions],
    portal: session.portal,
    mustChangePassword: session.mustChangePassword === true,
    authStatus: "authenticated",
    authError: null,
    authEndCode: null,
    sessionEndNotice: false,
  })
  // Đăng nhập thành công thì lý do cũ hết giá trị.
  carriedEnd = null
}

export const useSession = create<SessionState>((set, get) => ({
  user: fallbackMockUser,
  users,
  principal: null,
  permissions: [],
  portal: null,
  mustChangePassword: false,
  authStatus: api.mode === "mock" ? "authenticated" : "loading",
  authError: carriedEnd ? sessionEndMessage(carriedEnd) : null,
  authEndCode: carriedEnd,
  sessionEndNotice: false,
  theme: initialTheme,
  setUser: (id) => {
    if (api.mode !== "mock") return
    const user = get().users.find((candidate) => candidate.id === id)
    if (!user) return
    api.setSession(user)
    set({ user })
    save({ userId: user.id, theme: get().theme })
  },
  setTheme: (theme) => {
    applyTheme(theme)
    set({ theme })
    save({ userId: get().user.id, theme })
  },
  bootstrap: async () => {
    if (api.mode === "mock" || !authApi || get().authStatus === "authenticated") return
    const currentAuthApi = authApi
    if (bootstrapPromise) return bootstrapPromise
    set({ authStatus: "loading", authError: null, authEndCode: null })
    bootstrapPromise = currentAuthApi
      .me()
      .then(applyServerSession)
      .catch((error: unknown) => {
        currentAuthApi.clear()
        if (error instanceof ApiError && error.status === 401) {
          // Không có phiên nào ở máy chủ, nên mọi nháp giỏ trên tab này thuộc
          // về một phiên đã chết. Giữ lại chúng nghĩa là người đăng nhập tiếp
          // theo trên cùng cái máy mở màn gọi món và thấy giỏ của người trước.
          clearWaiterCartDrafts()
          set({
            principal: null,
            permissions: [],
            mustChangePassword: false,
            authStatus: "anonymous",
            // 401 ở đây nghĩa là thật sự chưa đăng nhập. Nếu lần tải trước vừa
            // bị đẩy ra thì đây chính là lúc trang đăng nhập cần nói lý do.
            authError: carriedEnd ? sessionEndMessage(carriedEnd) : null,
            authEndCode: carriedEnd,
          })
          return
        }
        const message = error instanceof ApiError ? error.message : "Không thể kiểm tra phiên đăng nhập."
        set({ principal: null, permissions: [], mustChangePassword: false, authStatus: "error", authError: message })
      })
      .finally(() => {
        bootstrapPromise = null
      })
    return bootstrapPromise
  },
  login: async (username, password, portal) => {
    if (!authApi) throw new ApiError(0, "AUTH_UNAVAILABLE", "HTTP authentication chưa được cấu hình.")
    set({ authError: null, authEndCode: null })
    const session = await authApi.login(username, password, portal)
    applyServerSession(session)
  },
  logout: async () => {
    if (!authApi) return
    const portal = get().portal
    await authApi.logout()
    // Module Phục vụ 3: nháp giỏ gọi món là của người vừa đăng xuất. Máy Phục
    // vụ là máy dùng chung, nên một giỏ còn sót lại sẽ được người tiếp theo gửi
    // cho sai bàn.
    clearWaiterCartDrafts()
    set({
      principal: null,
      permissions: [],
      mustChangePassword: false,
      authStatus: "anonymous",
      authError: null,
      authEndCode: null,
      sessionEndNotice: false,
      portal,
    })
    carriedEnd = null
    if (portal && typeof window !== "undefined" && window.location?.replace) {
      window.location.replace(portalLoginPath(portal))
    }
  },
  /**
   * TU-33 — phiên bị kết thúc từ phía máy chủ.
   *
   * KHÔNG chuyển trang ngay tại đây. Trước đây hàm này `location.replace`
   * thẳng về cổng đăng nhập, nên nhân viên đang nhập dở bỗng thấy mình ở
   * trang đăng nhập mà không một lời giải thích — câu giải thích cũng nằm
   * trong store và chết theo lần tải lại trang. Giờ chỉ đặt trạng thái;
   * `SessionEndedNotice` hiện màn báo rồi mới gọi `leaveToLogin`.
   *
   * Phiên đã bị thu hồi ở máy chủ trước khi sự kiện này tới đây, nên màn
   * báo là để đọc, không phải để làm nốt việc đang dở.
   */
  expire: (message = "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.", code?: string) => {
    const portal = get().portal
    authApi?.clear()
    // Phiên bị thu hồi cũng là hết quyền với giỏ đang mở: không giữ lại nháp
    // cho người đăng nhập sau trên cùng cái tab.
    clearWaiterCartDrafts()
    set({
      principal: null,
      permissions: [],
      mustChangePassword: false,
      authStatus: "anonymous",
      authError: message,
      authEndCode: code ?? null,
      sessionEndNotice: true,
      portal,
    })
  },
  leaveToLogin: () => {
    const { portal, authEndCode } = get()
    if (authEndCode) rememberSessionEnd(authEndCode)
    set({ sessionEndNotice: false })
    if (typeof window === "undefined" || !window.location?.replace) return
    window.location.replace(portal ? portalLoginPath(portal) : window.location.pathname)
  },
}))

httpClient?.setUnauthorizedHandler((error) => {
  if (useSession.getState().authStatus === "authenticated") {
    useSession.getState().expire(sessionEndMessage(error.code), error.code)
  }
})

/**
 * CSRF token không còn hợp lệ cũng là mất quyền ghi: mọi request tạo/sửa từ
 * đây sẽ bị máy chủ từ chối cho tới khi đăng nhập lại.
 *
 * Trước đây nhánh này chỉ đặt `authStatus` và `authError`, nên `principal` và
 * `permissions` vẫn nằm đó — màn hình tiếp tục bật đủ nút cho một phiên đã
 * không ghi được gì nữa. Giờ nó dọn đúng những thứ mà `logout` và `expire`
 * dọn, cộng nháp giỏ, nên ba đường mất xác thực để lại cùng một trạng thái.
 */
httpClient?.setCsrfFailureHandler(() => {
  authApi?.clear()
  clearWaiterCartDrafts()
  useSession.setState({
    principal: null,
    permissions: [],
    mustChangePassword: false,
    authStatus: "error",
    authError: "Phiên bảo mật không còn hợp lệ. Hãy tải lại phiên trước khi tiếp tục.",
  })
})

export function useCan(permission: Permission): boolean {
  return useSession((state) =>
    api.mode === "http" ? state.permissions.includes(permission) : roleCan(state.user.role, permission),
  )
}

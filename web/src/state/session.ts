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
import { roleCan } from "@/domain/access"
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

function applyTheme(theme: Theme) {
  const root = document.documentElement
  root.classList.toggle("dark", theme === "dark")
  root.style.colorScheme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#0f0e0c" : "#f8f7f2")
}

const users = api.listDemoUsers()
const stored = load()
const initialUser = users.find((user) => user.id === stored.userId) ?? users[0]
const initialTheme: Theme = stored.theme ?? "dark"
if (api.mode === "mock" && initialUser) api.setSession(initialUser)
applyTheme(initialTheme)

interface SessionState {
  // Mock-only identity retained for the existing dashboard.
  user: SessionUser
  users: SessionUser[]
  // HTTP identity and server-authoritative permissions.
  principal: AuthenticatedUser | null
  permissions: string[]
  authStatus: AuthStatus
  authError: string | null
  theme: Theme
  setUser: (id: number) => void
  setTheme: (theme: Theme) => void
  bootstrap: () => Promise<void>
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  expire: (message?: string) => void
}

const fallbackMockUser: SessionUser = initialUser ?? {
  id: 0,
  displayName: "Chưa đăng nhập",
  role: "RECEPTIONIST",
  deviceLabel: "",
}

let bootstrapPromise: Promise<void> | null = null

function applyServerSession(session: AuthSession) {
  useSession.setState({
    principal: session.user,
    permissions: [...session.permissions],
    authStatus: "authenticated",
    authError: null,
  })
}

export const useSession = create<SessionState>((set, get) => ({
  user: fallbackMockUser,
  users,
  principal: null,
  permissions: [],
  authStatus: api.mode === "mock" ? "authenticated" : "loading",
  authError: null,
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
    if (api.mode === "mock" || !authApi) return
    const currentAuthApi = authApi
    if (bootstrapPromise) return bootstrapPromise
    set({ authStatus: "loading", authError: null })
    bootstrapPromise = currentAuthApi
      .me()
      .then(applyServerSession)
      .catch((error: unknown) => {
        currentAuthApi.clear()
        if (error instanceof ApiError && error.status === 401) {
          set({ principal: null, permissions: [], authStatus: "anonymous", authError: null })
          return
        }
        const message = error instanceof ApiError ? error.message : "Không thể kiểm tra phiên đăng nhập."
        set({ principal: null, permissions: [], authStatus: "error", authError: message })
      })
      .finally(() => {
        bootstrapPromise = null
      })
    return bootstrapPromise
  },
  login: async (username, password) => {
    if (!authApi) throw new ApiError(0, "AUTH_UNAVAILABLE", "HTTP authentication chưa được cấu hình.")
    set({ authError: null })
    const session = await authApi.login(username, password)
    applyServerSession(session)
  },
  logout: async () => {
    if (!authApi) return
    await authApi.logout()
    set({ principal: null, permissions: [], authStatus: "anonymous", authError: null })
  },
  expire: (message = "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.") => {
    authApi?.clear()
    set({ principal: null, permissions: [], authStatus: "anonymous", authError: message })
  },
}))

httpClient?.setUnauthorizedHandler(() => {
  if (useSession.getState().authStatus === "authenticated") useSession.getState().expire()
})

httpClient?.setCsrfFailureHandler(() => {
  authApi?.clear()
  useSession.setState({
    authStatus: "error",
    authError: "Phiên bảo mật không còn hợp lệ. Hãy tải lại phiên trước khi tiếp tục.",
  })
})

export function useCan(permission: Permission): boolean {
  return useSession((state) =>
    api.mode === "http" ? state.permissions.includes(permission) : roleCan(state.user.role, permission),
  )
}

/**
 * Client-only session state: demo user/role, theme, density. Persisted per
 * device in localStorage (wrapped: storage may be unavailable).
 */
import { create } from "zustand"
import type { Permission } from "@/domain/access"
import { roleCan } from "@/domain/access"
import type { SessionUser } from "@/domain/models"
import { api } from "@/services"

export type Theme = "dark" | "light"

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
    /* storage unavailable: keep in memory */
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
const initialUser = users.find((u) => u.id === stored.userId) ?? users[0]
const initialTheme: Theme = stored.theme ?? "dark"
api.setSession(initialUser)
applyTheme(initialTheme)

interface SessionState {
  user: SessionUser
  users: SessionUser[]
  theme: Theme
  setUser: (id: number) => void
  setTheme: (theme: Theme) => void
}

export const useSession = create<SessionState>((set, get) => ({
  user: initialUser,
  users,
  theme: initialTheme,
  setUser: (id) => {
    const user = get().users.find((u) => u.id === id)
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
}))

export function useCan(permission: Permission): boolean {
  return useSession((s) => roleCan(s.user.role, permission))
}

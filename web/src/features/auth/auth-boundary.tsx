import { AlertTriangle, LoaderCircle, RotateCcw } from "lucide-react"
import { type ReactNode, useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { api } from "@/services"
import { useSession } from "@/state/session"
import { useUi } from "@/state/ui"
import { LoginPage, PortalUnderConstruction } from "./login-page"
import { PasswordChangeGate } from "./password-change-gate"
import { SessionEndedNotice } from "./session-ended-notice"
import {
  DEFAULT_AUTH_PORTAL,
  canonicalPortalPath,
  portalFromPath,
  unavailablePortalFromPath,
} from "@/domain/auth-portal"

export function AuthBoundary({ children }: { children: ReactNode }) {
  const status = useSession((state) => state.authStatus)
  const mustChangePassword = useSession((state) => state.mustChangePassword)
  const error = useSession((state) => state.authError)
  const bootstrap = useSession((state) => state.bootstrap)
  const sessionPortal = useSession((state) => state.portal)
  const sessionEndNotice = useSession((state) => state.sessionEndNotice)
  const queryClient = useQueryClient()

  useEffect(() => {
    if (api.mode === "http") void bootstrap()
  }, [bootstrap])

  useEffect(() => {
    if (api.mode === "http" && status !== "authenticated") {
      queryClient.clear()
      useUi.getState().clearHistory()
      useUi.getState().selectTable(null)
    }
  }, [queryClient, status])

  if (api.mode === "mock") return children
  // TU-34: mật khẩu tạm chặn toàn app, không riêng một màn. Backend đã chặn
  // bằng 403; đây là cánh cửa để người dùng biết phải làm gì.
  if (status === "authenticated") return mustChangePassword ? <PasswordChangeGate /> : children
  if (status === "anonymous") {
    // TU-33: phiên vừa bị kết thúc ngay trên màn hình này. Nói lý do trước,
    // rồi mới đưa về trang đăng nhập — nếu không thì màn hình đổi đột ngột
    // và nhân viên đọc thành "máy tự thoát".
    if (sessionEndNotice) return <SessionEndedNotice />
    const pathname = typeof window === "undefined" ? "" : window.location.pathname
    const unavailablePortal = unavailablePortalFromPath(pathname)
    if (unavailablePortal) return <PortalUnderConstruction label={unavailablePortal} />
    const routePortal = portalFromPath(pathname)
    // Canonicalize portal aliases without discarding admin deep links.
    const canonical = routePortal ? canonicalPortalPath(pathname) : null
    if (canonical && typeof window !== "undefined") {
      window.location.replace(canonical + window.location.search + window.location.hash)
      return null
    }
    const resolvedPortal = routePortal ?? sessionPortal ?? DEFAULT_AUTH_PORTAL
    if (resolvedPortal === "admin") {
      return (
        <div className="admin-root">
          <LoginPage portal="admin" />
        </div>
      )
    }
    return <LoginPage portal={resolvedPortal} />
  }
  if (status === "error") {
    return (
      <main className="flex min-h-dvh flex-col overflow-y-auto bg-background px-4 py-6">
        <section className="mx-auto my-auto grid w-full max-w-md gap-4 rounded-2xl border border-border bg-surface-1 p-6 text-center shadow-md sm:p-8">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl border border-amber-500/25 bg-amber-500/10">
            <AlertTriangle className="size-6 text-amber-500" aria-hidden="true" />
          </span>
          <div className="grid gap-1.5">
            <h1 className="text-xl font-semibold tracking-[-0.015em]">Không thể khôi phục phiên</h1>
            <p className="text-sm leading-relaxed text-muted-foreground">{error}</p>
          </div>
          <Button onClick={() => void bootstrap()} className="w-full">
            <RotateCcw className="size-4" aria-hidden="true" /> Thử lại
          </Button>
        </section>
      </main>
    )
  }
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-background px-4">
      <div className="flex items-center gap-2.5 rounded-full border border-border bg-surface-1 px-4 py-2.5 text-sm text-muted-foreground shadow-xs">
        <LoaderCircle className="size-4 animate-spin text-primary" aria-hidden="true" />
        <span>Đang kiểm tra phiên đăng nhập…</span>
      </div>
    </main>
  )
}

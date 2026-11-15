import { AlertTriangle, LoaderCircle, RotateCcw } from "lucide-react"
import { type ReactNode, useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { api } from "@/services"
import { useSession } from "@/state/session"
import { useUi } from "@/state/ui"
import { LoginPage, PortalUnderConstruction } from "./login-page"
import { PasswordChangeGate } from "./password-change-gate"
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
    const pathname = typeof window === "undefined" ? "" : window.location.pathname
    const unavailablePortal = unavailablePortalFromPath(pathname)
    if (unavailablePortal) return <PortalUnderConstruction label={unavailablePortal} />
    const routePortal = portalFromPath(pathname)
    // TU-32: URL công bố là tiếng Việt (/letan, /thungan, /phucvu). URL cũ vẫn
    // mở được vì đang nằm trong bookmark nhân viên, nhưng đưa về URL chuẩn để
    // thanh địa chỉ không dạy hai cách gọi cùng một cổng. Dùng replace chứ
    // không push: alias không nên để lại một bước trong lịch sử back.
    const canonical = routePortal ? canonicalPortalPath(pathname) : null
    if (canonical && typeof window !== "undefined") {
      window.location.replace(canonical)
      return null
    }
    return <LoginPage portal={routePortal ?? sessionPortal ?? DEFAULT_AUTH_PORTAL} />
  }
  if (status === "error") {
    return (
      <main className="grid min-h-dvh place-items-center bg-background p-4">
        <section className="grid w-full max-w-md gap-4 rounded-3xl border bg-surface-1 p-6 text-center shadow-xl">
          <AlertTriangle className="mx-auto size-10 text-amber-500" />
          <div>
            <h1 className="text-xl font-semibold">Không thể khôi phục phiên</h1>
            <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          </div>
          <Button onClick={() => void bootstrap()}>
            <RotateCcw /> Thử lại
          </Button>
        </section>
      </main>
    )
  }
  return (
    <main className="grid min-h-dvh place-items-center bg-background">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-5 animate-spin" /> Đang kiểm tra phiên đăng nhập…
      </div>
    </main>
  )
}

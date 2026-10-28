import { CheckCircle2, LogOut, Server } from "lucide-react"
import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { isApiError } from "@/services"
import { useSession } from "@/state/session"
import { useUi } from "@/state/ui"

export function ServerSessionPage() {
  const principal = useSession((state) => state.principal)
  const permissions = useSession((state) => state.permissions)
  const logout = useSession((state) => state.logout)
  const queryClient = useQueryClient()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!principal) return null

  const signOut = async () => {
    setPending(true)
    setError(null)
    try {
      await logout()
      queryClient.clear()
      useUi.getState().clearHistory()
      useUi.getState().selectTable(null)
    } catch (cause) {
      setError(isApiError(cause) ? cause.message : "Không thể đăng xuất. Vui lòng thử lại.")
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-background p-4">
      <section className="grid w-full max-w-2xl gap-6 rounded-3xl border bg-surface-1 p-6 shadow-xl sm:p-8">
        <header className="flex items-start gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground">
            <Server className="size-6" />
          </span>
          <div className="min-w-0">
            <p className="eyebrow">Kết nối backend thật</p>
            <h1 className="mt-1 text-2xl font-semibold">Xin chào, {principal.displayName}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {principal.username} · Venue #{principal.venueId}
            </p>
          </div>
          <CheckCircle2 className="ml-auto size-6 text-emerald-500" aria-label="Đã xác thực" />
        </header>

        <div className="rounded-2xl border bg-surface-2 p-4">
          <p className="font-medium">Phase 1 đã xác thực phiên an toàn.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Các module catalog, sơ đồ bàn, booking và waitlist chưa được nối HTTP trong phase này nên dashboard nghiệp
            vụ chưa được mở. Không có dữ liệu mock nào được hiển thị trong HTTP mode.
          </p>
        </div>

        <div>
          <p className="eyebrow mb-2">Quyền do máy chủ cấp ({permissions.length})</p>
          <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto">
            {permissions.length ? (
              permissions.map((permission) => (
                <span key={permission} className="rounded-lg border bg-background px-2.5 py-1 font-mono text-xs">
                  {permission}
                </span>
              ))
            ) : (
              <span className="text-sm text-muted-foreground">Tài khoản chưa có quyền nghiệp vụ.</span>
            )}
          </div>
        </div>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Button variant="outline" onClick={signOut} disabled={pending}>
          <LogOut /> {pending ? "Đang đăng xuất…" : "Đăng xuất"}
        </Button>
      </section>
    </main>
  )
}

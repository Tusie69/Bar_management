import { CheckCircle2, LogOut, Server } from "lucide-react"
import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Badge } from "@/components/ui/badge"
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
    <main className="flex min-h-dvh flex-col overflow-y-auto bg-background px-4 py-6">
      <section className="mx-auto my-auto grid w-full max-w-2xl gap-5 rounded-2xl border border-border bg-surface-1 p-5 shadow-md sm:gap-6 sm:p-8">
        <header className="flex items-start gap-3.5 sm:gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-xs">
            <Server className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="eyebrow">Kết nối backend thật</p>
            <h1 className="mt-1 text-xl font-semibold tracking-[-0.015em] sm:text-2xl">
              Xin chào, {principal.displayName}
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {principal.username} · Venue #{principal.venueId}
            </p>
          </div>
          <CheckCircle2 className="size-6 shrink-0 text-emerald-500" aria-label="Đã xác thực" />
        </header>

        <div className="rounded-xl border border-border-subtle bg-surface-2/80 p-4">
          <p className="text-sm font-semibold text-foreground">Phase 1 đã xác thực phiên an toàn.</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Các module catalog, sơ đồ bàn, booking và waitlist chưa được nối HTTP trong phase này nên dashboard nghiệp
            vụ chưa được mở. Không có dữ liệu mock nào được hiển thị trong HTTP mode.
          </p>
        </div>

        <div className="grid gap-2">
          <p className="eyebrow">Quyền do máy chủ cấp ({permissions.length})</p>
          <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto rounded-xl border border-border-subtle bg-background/60 p-3">
            {permissions.length ? (
              permissions.map((permission) => (
                <Badge key={permission} variant="outline" className="rounded-md font-mono text-xs">
                  {permission}
                </Badge>
              ))
            ) : (
              <span className="text-sm text-muted-foreground">Tài khoản chưa có quyền nghiệp vụ.</span>
            )}
          </div>
        </div>

        {error ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        ) : null}
        <Button variant="outline" onClick={signOut} disabled={pending} className="justify-self-start">
          <LogOut className="size-4" aria-hidden="true" />
          {pending ? "Đang đăng xuất…" : "Đăng xuất"}
        </Button>
      </section>
    </main>
  )
}

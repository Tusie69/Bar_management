import { AlertTriangle, LoaderCircle, RotateCcw } from "lucide-react"
import { type ReactNode, useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { api } from "@/services"
import { useSession } from "@/state/session"
import { useUi } from "@/state/ui"
import { LoginPage } from "./login-page"
import { HttpFloorPage } from "@/features/floor/http-floor-page"

export function AuthBoundary({ children }: { children: ReactNode }) {
  const status = useSession((state) => state.authStatus)
  const error = useSession((state) => state.authError)
  const bootstrap = useSession((state) => state.bootstrap)
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
  if (status === "authenticated") return <HttpFloorPage />
  if (status === "anonymous") return <LoginPage />
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

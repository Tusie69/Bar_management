import { AlertTriangle, LogOut, RefreshCw, Server, ShieldCheck } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import type { ZoneCode } from "@/domain/venue-layout"
import { useCatalog, useFloorState, useNow } from "@/hooks/use-data"
import { isApiError } from "@/services"
import { useSession } from "@/state/session"
import { FloorCanvas } from "./floor-canvas"
import { useFloorModel } from "./use-floor-model"

export function HttpFloorPage() {
  const principal = useSession((state) => state.principal)
  const permissions = useSession((state) => state.permissions)
  const logout = useSession((state) => state.logout)
  const model = useFloorModel()
  const catalogQuery = useCatalog()
  const floorQuery = useFloorState()
  const now = useNow(30_000)
  const [zone, setZone] = useState<ZoneCode | "ALL">("ALL")
  const [pendingLogout, setPendingLogout] = useState(false)
  const [logoutError, setLogoutError] = useState<string | null>(null)

  if (!principal) return null

  const refresh = () => Promise.all([catalogQuery.refetch(), floorQuery.refetch()])
  const error = catalogQuery.error ?? floorQuery.error
  const empty = !model.loading && !error && model.tables.length === 0

  const signOut = async () => {
    setPendingLogout(true)
    setLogoutError(null)
    try {
      await logout()
    } catch (cause) {
      setLogoutError(isApiError(cause) ? cause.message : "Không thể đăng xuất. Vui lòng thử lại.")
    } finally {
      setPendingLogout(false)
    }
  }

  return (
    <main className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-3 border-b bg-surface-1 px-4 py-3 sm:px-6">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
          <Server className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">21GAM · Floor Map</p>
          <p className="truncate text-xs text-muted-foreground">
            {principal.displayName} · {model.catalog?.venue.name ?? `Venue #${principal.venueId}`}
          </p>
        </div>
        <span className="ml-auto hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs text-muted-foreground sm:flex">
          <ShieldCheck className="size-3.5 text-emerald-500" /> Dữ liệu backend · chỉ đọc
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refresh()}
          disabled={catalogQuery.isFetching || floorQuery.isFetching}
        >
          <RefreshCw className={catalogQuery.isFetching || floorQuery.isFetching ? "animate-spin" : ""} /> Làm mới
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void signOut()} disabled={pendingLogout}>
          <LogOut /> {pendingLogout ? "Đang thoát…" : "Đăng xuất"}
        </Button>
      </header>

      <section className="flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="flex max-w-full gap-1 overflow-x-auto rounded-lg border bg-surface-1 p-1"
            role="tablist"
            aria-label="Lọc khu"
          >
            <Button
              variant={zone === "ALL" ? "secondary" : "ghost"}
              size="sm"
              role="tab"
              aria-selected={zone === "ALL"}
              onClick={() => setZone("ALL")}
            >
              Tất cả
            </Button>
            {(model.catalog?.zones ?? []).map((item) => (
              <Button
                key={item.id}
                variant={zone === item.code ? "secondary" : "ghost"}
                size="sm"
                role="tab"
                aria-selected={zone === item.code}
                onClick={() => setZone(item.code)}
              >
                {item.name}
              </Button>
            ))}
          </div>
          <p className="ml-auto text-xs text-muted-foreground" aria-live="polite">
            {model.floor
              ? `${model.tables.length} vị trí · ${model.counts.seated ?? 0} đang dùng · ${model.counts.reserved ?? 0} đã giữ · ${model.counts.spare ?? 0} sơ cua`
              : "Đang đồng bộ trạng thái bàn"}
          </p>
        </div>

        <div className="relative h-[calc(100dvh-155px)] min-h-[520px] shrink-0 overflow-hidden rounded-xl border bg-surface-1 shadow-sm max-sm:h-[calc(100dvh-220px)] max-sm:min-h-[620px]">
          {model.loading ? (
            <div className="grid h-full min-h-[520px] place-items-center p-5" aria-label="Đang tải sơ đồ bàn">
              <Skeleton className="h-full max-h-[720px] w-full max-w-[620px] rounded-xl" />
            </div>
          ) : error ? (
            <div className="grid h-full min-h-[520px] place-items-center p-6">
              <div className="max-w-md text-center" role="alert">
                <AlertTriangle className="mx-auto size-10 text-amber-500" />
                <h1 className="mt-3 text-lg font-semibold">Không tải được sơ đồ bàn</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  {isApiError(error) ? error.message : "Backend không phản hồi hoặc dữ liệu không đúng contract."}
                </p>
                <Button className="mt-4" onClick={() => void refresh()}>
                  <RefreshCw /> Thử lại
                </Button>
              </div>
            </div>
          ) : empty ? (
            <div className="grid h-full min-h-[520px] place-items-center p-6 text-center">
              <div>
                <h1 className="text-lg font-semibold">Chưa có bàn để hiển thị</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  Catalog backend không trả về bàn hoạt động hoặc ngưng phục vụ.
                </p>
              </div>
            </div>
          ) : model.catalog ? (
            <FloorCanvas
              tables={model.tables}
              zones={model.catalog.zones}
              mode="live"
              states={model.states}
              groups={model.floor?.groups ?? []}
              selectedIds={[]}
              zoneFocus={zone}
              now={now}
              onTableClick={() => undefined}
              ariaLabel="Sơ đồ bàn từ backend"
            />
          ) : null}
        </div>

        {logoutError ? (
          <p className="text-sm text-destructive" role="alert">
            {logoutError}
          </p>
        ) : null}
        {!permissions.includes("customer.view_masked") ? (
          <p className="text-xs text-amber-600">
            Tài khoản không có quyền customer.view_masked; backend sẽ từ chối dữ liệu Floor Map.
          </p>
        ) : null}
      </section>
    </main>
  )
}

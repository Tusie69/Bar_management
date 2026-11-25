import { useQueryClient } from "@tanstack/react-query"
import { Clock4, X } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useNow } from "@/hooks/use-data"
import { clock, httpClient } from "@/services"
import { useSession } from "@/state/session"
import {
  DEV_CLOCK_PRESETS,
  devClockAvailable,
  vnParts,
  type DevClockChange,
  type DevClockState,
} from "@/services/dev-clock-api"

const POLL_MS = 30_000

/**
 * TU-42 — bảng "Đồng hồ Dev" ở góc dưới trái mọi cổng của bản Dev.
 *
 * - Mọi tài khoản thấy giờ đang giả lập (chỉ đọc); chỉ SuperAdmin có nút đổi.
 * - Đổi giờ: server phát `dev-clock-changed` trên kênh /tables/stream → mọi
 *   máy đang mở chép độ lệch mới và tải lại dữ liệu, không cần F5. Kênh đó
 *   lỗi (tài khoản không có quyền xem sơ đồ) thì vẫn còn poll 30 giây.
 */
export function DevClock() {
  const authStatus = useSession((s) => s.authStatus)
  const queryClient = useQueryClient()
  const [state, setState] = useState<DevClockState | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [custom, setCustom] = useState("")
  const now = useNow(1000)
  const enabled = devClockAvailable() && authStatus === "authenticated" && httpClient !== null

  const apply = useCallback(
    (next: DevClockState) => {
      setState(next)
      const before = clock.now().getTime()
      clock.applyServerOffset(next.offsetMs)
      // clock.subscribe đã làm mới các màn dùng useRealtimeSync; màn Admin,
      // Phục vụ, Bar/Bếp có query riêng nên làm mới tất cả ở đây cho chắc.
      if (Math.abs(clock.now().getTime() - before) > 1000) void queryClient.invalidateQueries()
    },
    [queryClient],
  )

  const refresh = useCallback(async () => {
    if (!httpClient) return
    try {
      apply(await httpClient.get<DevClockState>("/dev/clock"))
    } catch {
      // Mất mạng hoặc phiên hết hạn: AuthBoundary lo phần đăng nhập lại.
    }
  }, [apply])

  useEffect(() => {
    if (!enabled) return
    const first = window.setTimeout(() => void refresh(), 0)
    const timer = window.setInterval(() => void refresh(), POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh()
    }
    document.addEventListener("visibilitychange", onVisible)
    let stream: EventSource | null = null
    if (typeof EventSource !== "undefined" && httpClient) {
      stream = new EventSource(`${httpClient.root}/tables/stream`, { withCredentials: true })
      stream.addEventListener("dev-clock-changed", () => void refresh())
      // Tài khoản không có quyền xem sơ đồ nhận 403: đóng hẳn, dựa vào poll,
      // để EventSource không thử lại mãi.
      stream.onerror = () => {
        if (stream?.readyState === EventSource.CLOSED) stream = null
      }
    }
    return () => {
      window.clearTimeout(first)
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisible)
      stream?.close()
    }
  }, [enabled, refresh])

  useEffect(() => {
    // Rời bản Dev / đăng xuất: trả đồng hồ trình duyệt về giờ thật.
    if (!enabled && devClockAvailable()) clock.applyServerOffset(0)
  }, [enabled])

  const change = async (body: DevClockChange) => {
    if (!httpClient) return
    setBusy(true)
    try {
      apply(await httpClient.put<DevClockState>("/dev/clock", body))
      setOpen(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không đổi được giờ giả lập.")
    } finally {
      setBusy(false)
    }
  }

  if (!enabled || !state) return null
  const shown = vnParts(now)

  return (
    <div
      data-testid="dev-clock"
      style={{
        position: "fixed",
        left: "calc(8px + env(safe-area-inset-left))",
        bottom: "calc(8px + env(safe-area-inset-bottom))",
        zIndex: 2147483646,
      }}
    >
      {open ? (
        <div className="mb-2 grid w-72 gap-3 rounded-xl border border-red-300 bg-card p-3 text-sm shadow-float">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-semibold">Đồng hồ Dev</p>
              <p className="text-xs text-muted-foreground">
                {state.simulated ? `Đang giả lập ${shown.time} · ${shown.day}` : "Đang chạy giờ thật"}
                {state.setBy ? ` · ${state.setBy} đổi lúc ${vnParts(new Date(state.setAt ?? state.realNow)).time}` : ""}
              </p>
            </div>
            <Button variant="ghost" size="icon" aria-label="Đóng đồng hồ Dev" onClick={() => setOpen(false)}>
              <X />
            </Button>
          </div>
          {state.canEdit ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                {DEV_CLOCK_PRESETS.map((item) => (
                  <Button
                    key={item.preset}
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    className="h-11 flex-col gap-0 leading-tight"
                    onClick={() => void change({ preset: item.preset })}
                  >
                    <span className="tnum font-semibold">{item.preset}</span>
                    <span className="text-[11px] text-muted-foreground">{item.label}</span>
                  </Button>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  type="datetime-local"
                  aria-label="Ngày giờ giả lập (giờ Việt Nam)"
                  value={custom || shown.input}
                  onChange={(event) => setCustom(event.target.value)}
                  className="h-11"
                />
                <Button
                  size="sm"
                  className="h-11"
                  disabled={busy || !(custom || shown.input)}
                  onClick={() => void change({ at: (custom || shown.input).slice(0, 16) })}
                >
                  Đặt
                </Button>
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="h-11"
                disabled={busy || !state.simulated}
                onClick={() => void change({ mode: "real" })}
              >
                Giờ thật
              </Button>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Chỉ tài khoản SuperAdmin đổi được giờ giả lập.</p>
          )}
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={`Đồng hồ Dev: ${state.simulated ? "giả lập" : "giờ thật"} ${shown.time}. Mở bảng chỉnh giờ`}
        className={
          "tnum flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold shadow-float " +
          (state.simulated ? "border-red-400 bg-red-600 text-white" : "border-red-300 bg-card text-red-700")
        }
      >
        <Clock4 className="size-3.5" />
        {state.simulated ? `Giả lập ${shown.time} · ${shown.day}` : `Giờ thật ${shown.time}`}
      </button>
    </div>
  )
}

import { useEffect } from "react"
import { DEV_BANNER_TEXT, runtimeConfig, shouldShowEnvBanner, type AppEnv } from "@/config/runtime"

/**
 * TU-41: dải băng đỏ báo đang ở bản Dev.
 *
 * Cố định mép trên, cao 20px, `pointer-events: none` nên chạm xuyên qua được:
 * không đẩy bố cục các màn đã chuẩn hoá, chỉ che nhẹ mép trên (Hưng chọn
 * 23/11/2026). Tiêu đề tab cũng mang tiền tố [DEV] để phân biệt khi mở song
 * song hai bản trên cùng máy.
 */
export function EnvBanner({ appEnv = runtimeConfig.appEnv }: { appEnv?: AppEnv }) {
  const show = shouldShowEnvBanner(appEnv)

  useEffect(() => {
    if (!show || document.title.startsWith("[DEV]")) return
    document.title = `[DEV] ${document.title}`
  }, [show])

  if (!show) return null
  return (
    <div
      role="status"
      aria-label={DEV_BANNER_TEXT}
      data-testid="env-banner"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 2147483647,
        height: 20,
        paddingTop: "env(safe-area-inset-top)",
        boxSizing: "content-box",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(220, 38, 38, 0.92)",
        color: "#fff",
        font: "700 11px/20px Arial, sans-serif",
        letterSpacing: "0.04em",
        pointerEvents: "none",
        userSelect: "none",
      }}
    >
      {DEV_BANNER_TEXT}
    </div>
  )
}

import { runtimeConfig } from "@/config/runtime"

/** Phản hồi của GET/PUT /api/v1/dev/clock (api/src/modules/dev). */
export interface DevClockState {
  appEnv: "dev"
  simulated: boolean
  offsetMs: number
  now: string
  realNow: string
  setBy: string | null
  setAt: string | null
  canEdit: boolean
}

export type DevClockChange = { preset: "17:00" | "21:50" | "23:30" | "04:55" } | { at: string } | { mode: "real" }

export const DEV_CLOCK_PRESETS = [
  { preset: "17:00", label: "Mở ca" },
  { preset: "21:50", label: "Sắp tới giờ hẹn" },
  { preset: "23:30", label: "Cao điểm" },
  { preset: "04:55", label: "Cuối ca" },
] as const

/** Bảng đồng hồ chỉ xuất hiện ở bản Dev chạy với máy chủ thật. */
export function devClockAvailable(appEnv = runtimeConfig.appEnv, apiMode = runtimeConfig.apiMode): boolean {
  return appEnv === "dev" && apiMode === "http"
}

const VN_OFFSET_MS = 7 * 3_600_000

export function vnParts(date: Date) {
  const local = new Date(date.getTime() + VN_OFFSET_MS)
  const pad = (n: number) => String(n).padStart(2, "0")
  return {
    time: `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`,
    day: `${pad(local.getUTCDate())}/${pad(local.getUTCMonth() + 1)}`,
    input: `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`,
  }
}

/** TU-43 — POST /api/v1/dev/seed và /dev/reset. */
export type DevScenario = "empty" | "quiet" | "busy"

export const DEV_SCENARIOS: readonly { scenario: DevScenario; label: string; hint: string }[] = [
  { scenario: "empty", label: "Ca trống", hint: "Chỉ mặt bằng, menu, tài khoản" },
  { scenario: "quiet", label: "Ca vắng", hint: "~10 tốp" },
  { scenario: "busy", label: "Ca đông", hint: "~45 tốp, ghép bàn, Bàn chờ, đơn món" },
]

export interface DevDataResult {
  scenario: DevScenario | "reset"
  businessDate: string | null
  simulatedNow: string
  counts: Record<string, number>
  notes: string[]
  durationMs: number
}

/** Câu tóm tắt ngắn cho thông báo sau khi bấm. */
export function summarizeDevData(result: DevDataResult): string {
  if (result.scenario === "reset") return "Đã xoá sạch dữ liệu vận hành trên Dev."
  const c = result.counts
  const parts = [
    `${c.seatedParties ?? 0} tốp đang ngồi`,
    `${(c.bookingsLate ?? 0) + (c.bookingsUpcoming ?? 0) + (c.bookingsUnassigned ?? 0)} đặt trước`,
    `${c.waitlist ?? 0} Bàn chờ`,
    `${c.orders ?? 0} đơn món`,
  ]
  const label = DEV_SCENARIOS.find((item) => item.scenario === result.scenario)?.label ?? result.scenario
  return `${label}: ${parts.join(" · ")} (${Math.round(result.durationMs / 100) / 10} giây)`
}

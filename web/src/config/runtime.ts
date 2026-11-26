export type ApiMode = "mock" | "http"
/** TU-41: bản nào của quán — khớp APP_ENV phía API. */
export type AppEnv = "production" | "dev" | "local"

export interface RuntimeConfig {
  apiMode: ApiMode
  apiBaseUrl: string
  venueId: number
  testFixedNow: Date | null
  appEnv: AppEnv
}

function parseApiMode(): ApiMode {
  const configured = import.meta.env.VITE_API_MODE?.trim()
  const mode = configured || (import.meta.env.PROD ? "" : "mock")

  if (mode !== "mock" && mode !== "http") {
    throw new Error("VITE_API_MODE phải là 'mock' hoặc 'http'.")
  }
  if (import.meta.env.PROD && mode !== "http") {
    throw new Error("Production chỉ được phép sử dụng VITE_API_MODE=http.")
  }
  return mode
}

function parseBaseUrl(mode: ApiMode): string {
  const value = import.meta.env.VITE_API_BASE_URL?.trim() ?? ""
  if (mode === "http" && !value) {
    throw new Error("Thiếu VITE_API_BASE_URL cho HTTP API.")
  }
  if (!value) return ""

  const parsed = new URL(value, "http://runtime.local")
  if (!value.startsWith("/") && !["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("VITE_API_BASE_URL phải là HTTP(S) URL hoặc đường dẫn cùng origin.")
  }
  return value.replace(/\/+$/, "")
}

function parseVenueId(): number {
  const value = Number(import.meta.env.VITE_VENUE_ID ?? 1)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("VITE_VENUE_ID phải là số nguyên dương.")
  }
  return value
}

const apiMode = parseApiMode()
const apiBaseUrl = parseBaseUrl(apiMode)

function parseTestFixedNow(): Date | null {
  const raw = import.meta.env.VITE_E2E_FIXED_NOW?.trim()
  if (!raw) return null
  let apiUrl: URL
  try {
    apiUrl = new URL(apiBaseUrl)
  } catch {
    throw new Error("VITE_E2E_FIXED_NOW yêu cầu API URL loopback tuyệt đối.")
  }
  if (
    import.meta.env.MODE !== "test" ||
    apiMode !== "http" ||
    !["127.0.0.1", "localhost", "::1"].includes(apiUrl.hostname)
  ) {
    throw new Error("VITE_E2E_FIXED_NOW chỉ được phép trong Vite test mode với HTTP API loopback.")
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(raw)) {
    throw new Error("VITE_E2E_FIXED_NOW phải là UTC ISO-8601 có hậu tố Z.")
  }
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) throw new Error("VITE_E2E_FIXED_NOW không hợp lệ.")
  return parsed
}

/**
 * Nhúng lúc build từ web/.env.production. Bản Dev đặt VITE_APP_ENV=dev để hiện
 * dải băng đỏ; bỏ trống thì build production là "production", còn lại "local".
 */
export function parseAppEnv(raw: string | undefined, isProd: boolean): AppEnv {
  const value = raw?.trim() || (isProd ? "production" : "local")
  if (value !== "production" && value !== "dev" && value !== "local") {
    throw new Error("VITE_APP_ENV phải là production, dev hoặc local.")
  }
  return value
}

export const DEV_BANNER_TEXT = "MÔI TRƯỜNG DEV — DỮ LIỆU GIẢ"

/** Có hiện dải băng đỏ hay không. Tách khỏi component để test không cần render. */
export function shouldShowEnvBanner(appEnv: AppEnv): boolean {
  return appEnv === "dev"
}

export const runtimeConfig: RuntimeConfig = {
  apiMode,
  apiBaseUrl,
  venueId: parseVenueId(),
  testFixedNow: parseTestFixedNow(),
  appEnv: parseAppEnv(import.meta.env.VITE_APP_ENV, import.meta.env.PROD),
}

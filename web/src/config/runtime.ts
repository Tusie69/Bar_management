export type ApiMode = "mock" | "http"

export interface RuntimeConfig {
  apiMode: ApiMode
  apiBaseUrl: string
  venueId: number
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

export const runtimeConfig: RuntimeConfig = {
  apiMode,
  apiBaseUrl: parseBaseUrl(apiMode),
  venueId: parseVenueId(),
}

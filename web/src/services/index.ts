/**
 * API implementation selection.
 *
 * Development/test may opt into the in-memory mock. Production is validated
 * at build time and at runtime to use the HTTP backend only.
 */
import { runtimeConfig } from "@/config/runtime"
import type { GamApi } from "./contracts"
import { AuthApi } from "./http/auth-api"
import { HttpClient } from "./http/http-client"
import { createHttpApi } from "./http/http-api"
import type { DemoControls } from "./mock/server"

export const httpClient = runtimeConfig.apiMode === "http" ? new HttpClient(runtimeConfig.apiBaseUrl) : null

export const authApi = httpClient ? new AuthApi(httpClient) : null

let selectedApi: GamApi
let selectedDemo: DemoControls | null = null

if (runtimeConfig.apiMode === "mock") {
  if (import.meta.env.PROD) throw new Error("Mock API bị chặn trong production.")
  const { MockGamApi } = await import("./mock/server")
  const mock = new MockGamApi()
  selectedApi = mock
  selectedDemo = mock
} else {
  if (!httpClient) throw new Error("HTTP client chưa được khởi tạo.")
  selectedApi = createHttpApi(httpClient, runtimeConfig.venueId)
}

export const api = selectedApi
export const demo = selectedDemo

export { clock } from "./clock"
export * from "./contracts"
export type { AuthSession, AuthenticatedUser } from "./http/auth-api"

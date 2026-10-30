/**
 * API implementation selection.
 *
 * Development/test may opt into the in-memory mock. Production is validated
 * at build time and at runtime to use the HTTP backend only.
 */
import { runtimeConfig } from "@/config/runtime"
import type { GamApi } from "./contracts"
import { AuthApi } from "./http/auth-api"
import { HttpBookingApi } from "./http/booking-api"
import { HttpClient } from "./http/http-client"
import { HttpVisitApi } from "./http/visit-api"
import { HttpWaitlistApi } from "./http/waitlist-api"
import { createHttpApi } from "./http/http-api"
import type { DemoControls } from "./mock/server"

export const httpClient = runtimeConfig.apiMode === "http" ? new HttpClient(runtimeConfig.apiBaseUrl) : null

export const authApi = httpClient ? new AuthApi(httpClient) : null
export const bookingApi = httpClient ? new HttpBookingApi(httpClient) : null
export const visitApi = httpClient ? new HttpVisitApi(httpClient) : null
export const waitlistApi = httpClient ? new HttpWaitlistApi(httpClient) : null

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
export type { AssignmentTable, BookingClassification, BookingWriteFields, HttpBooking } from "./http/booking-adapter"
export type { HttpWaitlistEntry, HttpWaitlistStatus } from "./http/waitlist-api"
export { activeWaitlistEntries } from "./http/waitlist-api"
export { createAndAssignDirectBooking } from "./http/direct-booking"

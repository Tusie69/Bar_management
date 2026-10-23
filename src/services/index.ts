/**
 * Picks the API implementation. Default: in-memory mock (no network).
 * Set VITE_API_MODE=http and VITE_API_BASE_URL to point at the Express API.
 */
import type { GamApi } from "./contracts"
import { createHttpApi } from "./http/http-api"
import { MockGamApi, type DemoControls } from "./mock/server"

const mode = import.meta.env.VITE_API_MODE === "http" ? "http" : "mock"

const mock = mode === "mock" ? new MockGamApi() : null

export const api: GamApi =
  mock ?? createHttpApi(import.meta.env.VITE_API_BASE_URL ?? "", Number(import.meta.env.VITE_VENUE_ID ?? 1))

/** Demo-only controls (second device, conflict injection). Null against a real backend. */
export const demo: DemoControls | null = mock

export { clock } from "./clock"
export * from "./contracts"

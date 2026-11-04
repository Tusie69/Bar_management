import { afterEach, describe, expect, it, vi } from "vitest"
import { newIdempotencyKey } from "./idempotency"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("newIdempotencyKey (FX-04)", () => {
  it("creates a different key accepted by the API on every form open", () => {
    const keys = new Set(Array.from({ length: 50 }, () => newIdempotencyKey()))
    expect(keys.size).toBe(50)
    for (const key of keys) expect(key).toMatch(/^[A-Za-z0-9_-]{8,64}$/)
  })

  it("falls back to getRandomValues when randomUUID is unavailable (http over LAN)", () => {
    vi.stubGlobal("crypto", { getRandomValues: (bytes: Uint8Array) => bytes.fill(171) })
    expect(newIdempotencyKey()).toBe("ab".repeat(16))
  })
})

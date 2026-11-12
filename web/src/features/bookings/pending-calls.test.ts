import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const KEY = "gam21.pending-calls"
const HOUR = 60 * 60 * 1000

/** Tests run on node, so localStorage is a plain map stubbed in here. */
const store = new Map<string, string>()

let usePendingCalls: (typeof import("./pending-calls"))["usePendingCalls"]

beforeAll(async () => {
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  })
  usePendingCalls = (await import("./pending-calls")).usePendingCalls
})
afterAll(() => vi.unstubAllGlobals())

beforeEach(() => {
  store.clear()
  usePendingCalls.setState({ calls: {} })
})

const saved = () => JSON.parse(store.get(KEY) ?? "{}")

describe("pending call store", () => {
  it("keeps an unfinished call so closing the table sheet does not lose it", () => {
    usePendingCalls.getState().start(42, 7001)
    expect(usePendingCalls.getState().calls[42]?.callId).toBe(7001)
    // What a remount reads back.
    expect(saved()["42"].callId).toBe(7001)
  })

  it("forgets the call once its outcome is recorded", () => {
    usePendingCalls.getState().start(42, 7001)
    usePendingCalls.getState().clear(42)
    expect(usePendingCalls.getState().calls[42]).toBeUndefined()
    expect(saved()["42"]).toBeUndefined()
  })

  it("holds one call per booking and replaces an older attempt on the same one", () => {
    usePendingCalls.getState().start(42, 7001)
    usePendingCalls.getState().start(43, 7002)
    usePendingCalls.getState().start(42, 7003)
    expect(usePendingCalls.getState().calls[42]?.callId).toBe(7003)
    expect(usePendingCalls.getState().calls[43]?.callId).toBe(7002)
  })

  it("drops a call older than one service night instead of nagging for ever", () => {
    const now = Date.now()
    usePendingCalls.getState().start(42, 7001, now - 11 * HOUR)
    usePendingCalls.getState().start(43, 7002, now)
    expect(usePendingCalls.getState().calls[42]).toBeUndefined()
    expect(usePendingCalls.getState().calls[43]?.callId).toBe(7002)
  })

  it("survives junk in storage rather than throwing on load", () => {
    store.set(KEY, "{not json")
    expect(() => usePendingCalls.getState().start(1, 2)).not.toThrow()
    expect(usePendingCalls.getState().calls[1]?.callId).toBe(2)
  })

  it("never stores anything but the booking id, the call id and the time", () => {
    usePendingCalls.getState().start(42, 7001)
    expect(Object.keys(saved()["42"]).sort()).toEqual(["callId", "startedAt"])
  })
})

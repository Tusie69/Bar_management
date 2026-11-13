import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { CallTarget } from "@/domain/models"

const KEY = "gam21.pending-calls"
const HOUR = 60 * 60 * 1000

const booking = (id: number): CallTarget => ({ kind: "booking", id })
const waitlist = (id: number): CallTarget => ({ kind: "waitlist", id })

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
    usePendingCalls.getState().start(booking(42), 7001)
    expect(usePendingCalls.getState().calls["booking:42"]?.callId).toBe(7001)
    // What a remount reads back.
    expect(saved()["booking:42"].callId).toBe(7001)
  })

  it("forgets the call once its outcome is recorded", () => {
    usePendingCalls.getState().start(booking(42), 7001)
    usePendingCalls.getState().clear(booking(42))
    expect(usePendingCalls.getState().calls["booking:42"]).toBeUndefined()
    expect(saved()["booking:42"]).toBeUndefined()
  })

  it("holds one call per guest and replaces an older attempt on the same one", () => {
    usePendingCalls.getState().start(booking(42), 7001)
    usePendingCalls.getState().start(booking(43), 7002)
    usePendingCalls.getState().start(booking(42), 7003)
    expect(usePendingCalls.getState().calls["booking:42"]?.callId).toBe(7003)
    expect(usePendingCalls.getState().calls["booking:43"]?.callId).toBe(7002)
  })

  it("keeps a booking and a waitlist entry of the same id apart", () => {
    // Ba dãy id độc lập: không có tiền tố loại thì cuộc gọi dở của mục chờ 42
    // sẽ hiện lên ở booking 42.
    usePendingCalls.getState().start(booking(42), 7001)
    usePendingCalls.getState().start(waitlist(42), 7002)
    expect(usePendingCalls.getState().calls["booking:42"]?.callId).toBe(7001)
    expect(usePendingCalls.getState().calls["waitlist:42"]?.callId).toBe(7002)
  })

  it("drops a call older than one service night instead of nagging for ever", () => {
    const now = Date.now()
    usePendingCalls.getState().start(booking(42), 7001, now - 11 * HOUR)
    usePendingCalls.getState().start(booking(43), 7002, now)
    expect(usePendingCalls.getState().calls["booking:42"]).toBeUndefined()
    expect(usePendingCalls.getState().calls["booking:43"]?.callId).toBe(7002)
  })

  it("survives junk in storage rather than throwing on load", () => {
    store.set(KEY, "{not json")
    expect(() => usePendingCalls.getState().start(booking(1), 2)).not.toThrow()
    expect(usePendingCalls.getState().calls["booking:1"]?.callId).toBe(2)
  })

  it("ignores a bare-id key left by the version before call targets", () => {
    store.set(KEY, JSON.stringify({ "42": { callId: 7001, startedAt: Date.now() } }))
    usePendingCalls.setState({ calls: {} })
    usePendingCalls.getState().start(booking(43), 7002)
    expect(usePendingCalls.getState().calls["42"]).toBeUndefined()
  })

  it("never stores anything but the call id and the time", () => {
    usePendingCalls.getState().start(booking(42), 7001)
    expect(Object.keys(saved()["booking:42"]).sort()).toEqual(["callId", "startedAt"])
  })
})

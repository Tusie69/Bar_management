import { beforeEach, describe, expect, it, vi } from "vitest"

import { openFloorStream } from "./floor-stream"

type Listener = (event: MessageEvent<string>) => void

class FakeEventSource {
  static last: FakeEventSource | null = null
  readonly url: string
  readonly withCredentials: boolean
  closed = false
  private readonly listeners = new Map<string, Set<Listener>>()

  constructor(url: string, init?: { withCredentials?: boolean }) {
    this.url = url
    this.withCredentials = init?.withCredentials ?? false
    FakeEventSource.last = this
  }

  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>()
    set.add(listener)
    this.listeners.set(type, set)
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener)
  }

  close(): void {
    this.closed = true
  }

  emit(type: string, data: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data } as MessageEvent<string>)
    }
  }
}

describe("floor change stream (AC09)", () => {
  beforeEach(() => {
    FakeEventSource.last = null
    ;(globalThis as { EventSource?: unknown }).EventSource = FakeEventSource
  })

  it("opens the venue stream on the session cookie, with no token in the URL", () => {
    openFloorStream("https://api.example.com/api/v1", () => {})
    const source = FakeEventSource.last!
    expect(source.url).toBe("https://api.example.com/api/v1/tables/stream")
    expect(source.withCredentials).toBe(true)
    expect(source.url).not.toMatch(/token|session|csrf/i)
  })

  it("reports each newer cursor once and never goes backwards", () => {
    const seen: number[] = []
    openFloorStream("/api/v1", (event) => seen.push(event.latestSeq))
    const source = FakeEventSource.last!

    source.emit("floor-changed", JSON.stringify({ venueId: 1, changeSeq: "7" }))
    source.emit("floor-changed", JSON.stringify({ venueId: 1, changeSeq: "8" }))
    // A replayed or late frame must not make the client re-read older state.
    source.emit("floor-changed", JSON.stringify({ venueId: 1, changeSeq: "8" }))
    source.emit("floor-changed", JSON.stringify({ venueId: 1, changeSeq: "5" }))
    source.emit("floor-changed", JSON.stringify({ venueId: 1, changeSeq: "9" }))

    expect(seen).toEqual([7, 8, 9])
  })

  it("carries no customer data: a frame only says the floor moved", () => {
    const events: Array<Record<string, unknown>> = []
    openFloorStream("/api/v1", (event) => events.push({ ...event }))
    FakeEventSource.last!.emit("floor-changed", JSON.stringify({ venueId: 1, changeSeq: "3" }))

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ action: "FLOOR_CHANGED", actorKind: "SYSTEM", actorUserId: null })
    expect(JSON.stringify(events[0])).not.toMatch(/\d{9,}/)
  })

  it("ignores a hello frame that has no cursor yet, and malformed data", () => {
    const onChange = vi.fn()
    openFloorStream("/api/v1", onChange)
    const source = FakeEventSource.last!

    source.emit("hello", JSON.stringify({ venueId: 1, changeSeq: null }))
    source.emit("floor-changed", "not json")
    source.emit("floor-changed", JSON.stringify({ venueId: 1 }))
    expect(onChange).not.toHaveBeenCalled()

    // A hello frame that does carry a cursor is a reconnect telling the client to resync.
    source.emit("hello", JSON.stringify({ venueId: 1, changeSeq: "12" }))
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it("closes the underlying stream when the subscriber unsubscribes", () => {
    const handle = openFloorStream("/api/v1", () => {})
    handle.close()
    expect(FakeEventSource.last!.closed).toBe(true)
  })

  it("degrades to a no-op where EventSource does not exist, leaving the 15s poll", () => {
    delete (globalThis as { EventSource?: unknown }).EventSource
    const onChange = vi.fn()
    expect(() => openFloorStream("/api/v1", onChange).close()).not.toThrow()
    expect(onChange).not.toHaveBeenCalled()
  })
})

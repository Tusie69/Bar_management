import type { ChangeEvent } from "@/domain/models"

export interface MockSyncPacket {
  rev: number
  senderId: string
  businessDate: string
  snapshot: string
  event: ChangeEvent
}

export interface MockSyncTransport {
  readLatest(): MockSyncPacket | null
  publish(packet: MockSyncPacket): void
  subscribe(listener: (packet: MockSyncPacket) => void): () => void
}

const SYNC_STORAGE_KEY = "21gam.mock.sync.v1"
const SYNC_CHANNEL_NAME = "21gam.mock.sync.v1"

export function stringifyMockSnapshot(state: unknown): string {
  return JSON.stringify(state, function (this: Record<string, unknown>, key: string, val: unknown) {
    const raw = key ? this[key] : val
    if (raw instanceof Date) {
      return { __t: "D", v: Number.isFinite(raw.getTime()) ? raw.toISOString() : null }
    }
    if (raw instanceof Map) {
      return { __t: "M", v: Array.from(raw.entries()) }
    }
    if (raw instanceof Set) {
      return { __t: "S", v: Array.from(raw.values()) }
    }
    return val
  })
}

export function parseMockSnapshot<T>(json: string): T {
  return JSON.parse(json, (_key, val: unknown) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const tagged = val as { __t?: string; v?: unknown }
      if (tagged.__t === "D") return typeof tagged.v === "string" ? new Date(tagged.v) : null
      if (tagged.__t === "M" && Array.isArray(tagged.v)) return new Map(tagged.v as [unknown, unknown][])
      if (tagged.__t === "S" && Array.isArray(tagged.v)) return new Set(tagged.v as unknown[])
    }
    return val
  }) as T
}

function isMockSyncPacket(value: unknown): value is MockSyncPacket {
  if (!value || typeof value !== "object") return false
  const p = value as Partial<MockSyncPacket>
  return (
    typeof p.rev === "number" &&
    Number.isFinite(p.rev) &&
    typeof p.senderId === "string" &&
    typeof p.businessDate === "string" &&
    typeof p.snapshot === "string" &&
    Boolean(p.event && typeof p.event === "object" && typeof p.event.action === "string")
  )
}

function parsePacket(raw: string | null): MockSyncPacket | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return isMockSyncPacket(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Browser same-origin cross-tab/window transport for MockGamApi (NA45H-10).
 * Uses BroadcastChannel for instant push + localStorage for late-opening tabs and backup delivery.
 */
export function createBrowserMockSyncTransport(): MockSyncTransport {
  return {
    readLatest() {
      try {
        return parsePacket(localStorage.getItem(SYNC_STORAGE_KEY))
      } catch {
        return null
      }
    },
    publish(packet) {
      try {
        localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify(packet))
      } catch {
        /* ignore storage quota / private mode failures */
      }
      if (typeof BroadcastChannel !== "undefined") {
        try {
          const ch = new BroadcastChannel(SYNC_CHANNEL_NAME)
          ch.postMessage(packet)
          ch.close()
        } catch {
          /* ignore BroadcastChannel failures */
        }
      }
    },
    subscribe(listener) {
      let channel: BroadcastChannel | null = null
      if (typeof BroadcastChannel !== "undefined") {
        try {
          channel = new BroadcastChannel(SYNC_CHANNEL_NAME)
          channel.onmessage = (ev: MessageEvent<unknown>) => {
            if (isMockSyncPacket(ev.data)) listener(ev.data)
          }
        } catch {
          channel = null
        }
      }
      const onStorage = (ev: StorageEvent) => {
        if (ev.key !== SYNC_STORAGE_KEY) return
        const packet = parsePacket(ev.newValue)
        if (packet) listener(packet)
      }
      if (typeof window !== "undefined") {
        window.addEventListener("storage", onStorage)
      }
      return () => {
        if (channel) {
          try {
            channel.close()
          } catch {
            /* ignore */
          }
        }
        if (typeof window !== "undefined") {
          window.removeEventListener("storage", onStorage)
        }
      }
    },
  }
}

/** In-memory transport for unit testing multi-instance mock sync in Node. */
export function createInMemoryMockSyncTransport(): MockSyncTransport {
  let latest: MockSyncPacket | null = null
  const listeners = new Set<(packet: MockSyncPacket) => void>()
  return {
    readLatest: () => latest,
    publish(packet) {
      latest = packet
      for (const listener of listeners) listener(packet)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

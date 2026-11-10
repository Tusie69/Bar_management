/**
 * §10 — push channel for the floor, so a merge or a split on one device reaches
 * every other open device in well under two seconds without an F5.
 *
 * The frame carries only the venue's change cursor. It says "your snapshot is
 * stale", never what changed, so:
 *   - no customer data travels over the stream (db09),
 *   - an out-of-order or replayed frame cannot overwrite newer state, because the
 *     client refetches the authoritative projection instead of patching,
 *   - a frame older than one already seen is dropped by the cursor check.
 *
 * On reconnect EventSource replays nothing, so the listener fires once with the
 * current cursor and the client re-reads the projection from the server. The
 * 15-second poll in use-data.ts stays as the fallback for a blocked stream.
 */
import type { ChangeEvent } from "@/domain/models"

export interface FloorStreamHandle {
  close: () => void
}

interface FloorFrame {
  venueId?: number
  changeSeq?: string | number | null
}

function parseFrame(data: string): FloorFrame | null {
  try {
    const parsed: unknown = JSON.parse(data)
    return parsed && typeof parsed === "object" ? (parsed as FloorFrame) : null
  } catch {
    return null
  }
}

/**
 * Opens the stream and calls `onChange` once per genuinely newer cursor.
 * `apiRoot` is the same /api/v1 root the HTTP client uses; the session cookie
 * authenticates the stream, so no token is ever put in the URL.
 */
export function openFloorStream(apiRoot: string, onChange: (event: ChangeEvent) => void): FloorStreamHandle {
  if (typeof EventSource === "undefined") return { close: () => undefined }

  let latestSeq = -1
  const source = new EventSource(`${apiRoot}/tables/stream`, { withCredentials: true })

  const handle = (event: MessageEvent<string>): void => {
    const frame = parseFrame(event.data)
    const seq = Number(frame?.changeSeq ?? Number.NaN)
    if (!Number.isFinite(seq)) {
      // A hello frame with no cursor yet: nothing has changed to refetch for.
      return
    }
    if (seq <= latestSeq) return
    latestSeq = seq
    onChange({
      latestSeq: seq,
      action: "FLOOR_CHANGED",
      entityType: "venue",
      actorKind: "SYSTEM",
      actorUserId: null,
      summary: "Sơ đồ bàn vừa thay đổi trên máy khác.",
    })
  }

  source.addEventListener("floor-changed", handle as EventListener)
  source.addEventListener("hello", handle as EventListener)

  return {
    close: () => {
      source.removeEventListener("floor-changed", handle as EventListener)
      source.removeEventListener("hello", handle as EventListener)
      source.close()
    },
  }
}

/**
 * §10 — the floor must reflect a merge or a split on every open device in under
 * two seconds, without an F5.
 *
 * There is no WebSocket or Socket.IO in this project; the clients poll the floor
 * every 15 seconds (web/src/hooks/use-data.ts). Rather than introducing a second
 * realtime stack, this adds the push channel the project was missing, on the
 * transport Express already speaks: Server-Sent Events over the same cookie
 * session, same CSRF-free GET, same trusted-origin middleware.
 *
 * The cursor is venues.change_seq, which every mutation already bumps inside its
 * transaction. The broadcaster re-reads that one column and only emits when it has
 * moved, which is why a rolled-back transaction can never produce an event: the
 * number it would have published was never committed.
 *
 * Clients treat an event as "your snapshot is stale, re-read it", not as data. An
 * event therefore cannot overwrite newer state with older state — the client
 * always refetches the full projection and the monotonic cursor lets it drop a
 * frame that is older than what it already has. On reconnect the client refetches
 * before it trusts anything, so a missed event costs a refetch, not consistency.
 */
import type { Response } from 'express'
import type { RowDataPacket } from 'mysql2/promise'

import { env } from '../../config/env.js'
import { databasePool } from '../../database/pool.js'
import {
  subscribeToSessionRevocations,
  type SessionEndCode,
} from '../../auth/session-lifecycle.js'

export interface FloorChangeEvent {
  venueId: number
  changeSeq: string
}

interface Subscriber {
  organizationId: number
  venueId: number
  authSessionId: number
  userId: number
  authorize: () => Promise<SessionEndCode | null>
  response: Response
  heartbeat?: NodeJS.Timeout
}

const subscribers = new Set<Subscriber>()
const lastSeenByVenue = new Map<string, string>()
let timer: NodeJS.Timeout | null = null

function closeSubscriber(subscriber: Subscriber, code?: SessionEndCode): void {
  if (!subscribers.delete(subscriber)) return
  if (subscriber.heartbeat) clearInterval(subscriber.heartbeat)
  if (code) write(subscriber, 'session-ended', { code })
  try {
    subscriber.response.end()
  } catch {
    // Socket already closed.
  }
  stopBroadcasterWhenIdle()
}

subscribeToSessionRevocations((notice) => {
  const ids = new Set(notice.sessionIds)
  for (const subscriber of [...subscribers]) {
    if (ids.has(subscriber.authSessionId)) closeSubscriber(subscriber, notice.code)
  }
})

function venueKey(organizationId: number, venueId: number): string {
  return `${organizationId}:${venueId}`
}

function write(subscriber: Subscriber, event: string, data: unknown): void {
  try {
    subscriber.response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  } catch {
    // A dead socket is removed by its own close handler; losing one write here is
    // not a reason to fail the broadcast for everyone else.
    subscribers.delete(subscriber)
  }
}

/**
 * Publishes a committed change to every device watching that venue's floor.
 *
 * Monotonic by default: a post-commit announcement that races behind a poll must
 * not rewind what clients were already told. `rebase` is for the one case where
 * the cursor legitimately moves backwards — the venue row restored from a backup —
 * which only the poll against the database can observe. Without it the cached
 * high-water mark would silence the stream until the database caught back up.
 */
export async function publishFloorChange(
  event: FloorChangeEvent & { organizationId: number },
  options: { rebase?: boolean } = {},
): Promise<void> {
  const key = venueKey(event.organizationId, event.venueId)
  const previous = lastSeenByVenue.get(key)
  if (previous !== undefined) {
    const moved = BigInt(event.changeSeq) - BigInt(previous)
    if (moved === 0n) return
    if (moved < 0n && !options.rebase) return
  }
  lastSeenByVenue.set(key, event.changeSeq)
  const matching = [...subscribers].filter((subscriber) =>
    subscriber.organizationId === event.organizationId && subscriber.venueId === event.venueId)
  await Promise.all(matching.map(async (subscriber) => {
    const denied = await subscriber.authorize()
    if (denied) {
      closeSubscriber(subscriber, denied)
      return
    }
    write(subscriber, 'floor-changed', { venueId: event.venueId, changeSeq: event.changeSeq })
  }))
}

/**
 * TU-42: một sự kiện không gắn với cursor (VD bản Dev đổi giờ giả lập) tới mọi
 * máy đang mở stream của venue. Vẫn kiểm phiên từng máy như floor-changed.
 */
export async function broadcastVenueEvent(
  organizationId: number,
  venueId: number,
  event: string,
  data: unknown,
): Promise<void> {
  const matching = [...subscribers].filter((subscriber) =>
    subscriber.organizationId === organizationId && subscriber.venueId === venueId)
  await Promise.all(matching.map(async (subscriber) => {
    const denied = await subscriber.authorize()
    if (denied) {
      closeSubscriber(subscriber, denied)
      return
    }
    write(subscriber, event, data)
  }))
}

/** Reads the cursor on a fresh connection after commit, then emits only that cursor. */
export async function publishCommittedFloorChange(organizationId: number, venueId: number): Promise<void> {
  const [rows] = await databasePool.execute<(RowDataPacket & { change_seq: string | number })[]>(
    'SELECT change_seq FROM venues WHERE organization_id = ? AND id = ?',
    [organizationId, venueId],
  )
  if (rows[0]) {
    await publishFloorChange({ organizationId, venueId, changeSeq: String(rows[0].change_seq) })
  }
}

async function pollOnce(): Promise<void> {
  const venues = new Set<string>()
  for (const subscriber of subscribers) venues.add(venueKey(subscriber.organizationId, subscriber.venueId))
  if (!venues.size) return

  for (const key of venues) {
    const parts = key.split(':')
    const organizationId = Number(parts[0])
    const venueId = Number(parts[1])
    const [rows] = await databasePool.execute<(RowDataPacket & { change_seq: string })[]>(
      'SELECT change_seq FROM venues WHERE organization_id = ? AND id = ?',
      [organizationId, venueId],
    )
    const changeSeq = rows[0]?.change_seq
    if (changeSeq === undefined) continue
    // The database is the truth for this venue's cursor, so a poll may rebase.
    await publishFloorChange({ organizationId, venueId, changeSeq: String(changeSeq) }, { rebase: true })
  }
}

function ensureBroadcaster(): void {
  if (timer || !subscribers.size) return
  let running = false
  timer = setInterval(() => {
    if (running) return
    running = true
    void pollOnce()
      .catch((error: unknown) => {
        console.error('Floor change broadcaster thất bại; client vẫn còn polling 15 giây.', error)
      })
      .finally(() => { running = false })
  }, env.realtime.pollIntervalMs)
  timer.unref()
}

function stopBroadcasterWhenIdle(): void {
  if (subscribers.size || !timer) return
  clearInterval(timer)
  timer = null
}

/**
 * Attaches one device to the venue's floor stream. The caller has already
 * authenticated and resolved the actor, so this never reads a cookie itself.
 */
export function subscribeToFloorChanges(
  options: {
    organizationId: number
    venueId: number
    authSessionId: number
    userId: number
    authorize: () => Promise<SessionEndCode | null>
    response: Response
  },
): () => void {
  const { response } = options
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, private, max-age=0',
    Connection: 'keep-alive',
    // Without this, a buffering reverse proxy holds events back and the two-second
    // budget is lost in nginx rather than in the application.
    'X-Accel-Buffering': 'no',
  })
  // Tell the client to retry on its own if the connection drops.
  response.write(`retry: 2000\n\n`)

  const subscriber: Subscriber = {
    organizationId: options.organizationId,
    venueId: options.venueId,
    authSessionId: options.authSessionId,
    userId: options.userId,
    authorize: options.authorize,
    response,
  }
  subscribers.add(subscriber)
  ensureBroadcaster()

  // The current cursor, so a client that connects after a change still learns it
  // needs a refetch instead of waiting for the next mutation.
  const known = lastSeenByVenue.get(venueKey(options.organizationId, options.venueId))
  write(subscriber, 'hello', { venueId: options.venueId, changeSeq: known ?? null })

  let validating = false
  const heartbeat = setInterval(() => {
    if (validating) return
    validating = true
    void subscriber.authorize().then((denied) => {
      if (denied) {
        closeSubscriber(subscriber, denied)
        return
      }
      response.write(': keep-alive\n\n')
    }).catch(() => closeSubscriber(subscriber, 'SESSION_INVALID')).finally(() => {
      validating = false
    })
  }, env.realtime.heartbeatMs)
  subscriber.heartbeat = heartbeat
  heartbeat.unref()

  const close = (): void => {
    clearInterval(heartbeat)
    subscribers.delete(subscriber)
    stopBroadcasterWhenIdle()
  }
  response.on('close', close)
  return close
}

/** Test seam: the number of attached devices. */
export function floorChangeSubscriberCount(): number {
  return subscribers.size
}

/** Test seam: forget every subscriber and stop the broadcaster. */
export function resetFloorChangeStream(): void {
  for (const subscriber of subscribers) {
    try {
      subscriber.response.end()
    } catch {
      // Already closed.
    }
  }
  subscribers.clear()
  lastSeenByVenue.clear()
  stopBroadcasterWhenIdle()
}

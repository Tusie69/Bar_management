/**
 * Calls that have been started but have no outcome yet.
 *
 * The call id used to live in CallCustomerControl's own state, so closing the
 * table sheet - which the receptionist does constantly - threw it away. The row
 * in booking_call_logs then kept outcome NULL for ever, with no screen able to
 * finish it, and the next attempt created a second orphan row.
 *
 * Only the booking id, the call id and when it started are kept. No phone
 * number ever reaches this store, so nothing sensitive lands in localStorage.
 * Entries are dropped after MAX_AGE_MS: a call nobody closed within a shift is
 * stale, and a stale "Ghi kết quả cuộc gọi" button is worse than none.
 */
import { create } from "zustand"

const STORAGE_KEY = "gam21.pending-calls"
/** One service night, generous: a shift runs 19:00 to 01:00. */
const MAX_AGE_MS = 10 * 60 * 60 * 1000

export interface PendingCall {
  callId: number
  /** Epoch ms, for expiry only. */
  startedAt: number
}

type Store = {
  calls: Record<number, PendingCall>
  start: (bookingId: number, callId: number, startedAt?: number) => void
  clear: (bookingId: number) => void
}

function fresh(calls: Record<number, PendingCall>, now: number): Record<number, PendingCall> {
  const out: Record<number, PendingCall> = {}
  for (const [id, call] of Object.entries(calls)) {
    if (now - call.startedAt <= MAX_AGE_MS) out[Number(id)] = call
  }
  return out
}

function load(now = Date.now()): Record<number, PendingCall> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, PendingCall>
    if (!raw || typeof raw !== "object") return {}
    const parsed: Record<number, PendingCall> = {}
    for (const [id, call] of Object.entries(raw)) {
      const bookingId = Number(id)
      if (!Number.isSafeInteger(bookingId) || bookingId <= 0) continue
      if (!call || typeof call.callId !== "number" || typeof call.startedAt !== "number") continue
      parsed[bookingId] = { callId: call.callId, startedAt: call.startedAt }
    }
    return fresh(parsed, now)
  } catch {
    return {}
  }
}

function save(calls: Record<number, PendingCall>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(calls))
  } catch {
    // Private mode or a full quota: the button simply does not survive a
    // reload, which is still better than losing it on every sheet close.
  }
}

export const usePendingCalls = create<Store>((set, get) => ({
  calls: load(),
  start: (bookingId, callId, startedAt = Date.now()) => {
    const calls = { ...fresh(get().calls, startedAt), [bookingId]: { callId, startedAt } }
    save(calls)
    set({ calls })
  },
  clear: (bookingId) => {
    const calls = { ...get().calls }
    delete calls[bookingId]
    save(calls)
    set({ calls })
  },
}))

/** The unfinished call for one booking, or null. */
export function usePendingCall(bookingId: number): PendingCall | null {
  return usePendingCalls((s) => s.calls[bookingId] ?? null)
}

/**
 * Calls that have been started but have no outcome yet.
 *
 * The call id used to live in CallCustomerControl's own state, so closing the
 * table sheet - which the receptionist does constantly - threw it away. The row
 * in booking_call_logs then kept outcome NULL for ever, with no screen able to
 * finish it, and the next attempt created a second orphan row.
 *
 * Only the target key, the call id and when it started are kept. No phone
 * number ever reaches this store, so nothing sensitive lands in localStorage.
 * Entries are dropped after MAX_AGE_MS: a call nobody closed within a shift is
 * stale, and a stale "Ghi kết quả cuộc gọi" button is worse than none.
 */
import { create } from "zustand"

import { callTargetKey } from "@/domain/call-target"
import type { CallTarget } from "@/domain/models"

const STORAGE_KEY = "gam21.pending-calls"
/** One service night, generous: a shift runs 19:00 to 01:00. */
const MAX_AGE_MS = 10 * 60 * 60 * 1000

export interface PendingCall {
  callId: number
  /** Epoch ms, for expiry only. */
  startedAt: number
}

type Calls = Record<string, PendingCall>

type Store = {
  calls: Calls
  start: (target: CallTarget, callId: number, startedAt?: number) => void
  clear: (target: CallTarget) => void
}

function fresh(calls: Calls, now: number): Calls {
  const out: Calls = {}
  for (const [key, call] of Object.entries(calls)) {
    if (now - call.startedAt <= MAX_AGE_MS) out[key] = call
  }
  return out
}

function load(now = Date.now()): Calls {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, PendingCall>
    if (!raw || typeof raw !== "object") return {}
    const parsed: Calls = {}
    for (const [key, call] of Object.entries(raw)) {
      // Khóa cũ (trước khi gọi được khách chờ) là id booking trần; bỏ qua, một
      // cuộc gọi dở từ ca trước không đáng để đoán xem nó thuộc loại nào.
      if (!/^(booking|waitlist|visit):[1-9][0-9]*$/.test(key)) continue
      if (!call || typeof call.callId !== "number" || typeof call.startedAt !== "number") continue
      parsed[key] = { callId: call.callId, startedAt: call.startedAt }
    }
    return fresh(parsed, now)
  } catch {
    return {}
  }
}

function save(calls: Calls) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(calls))
  } catch {
    // Private mode or a full quota: the button simply does not survive a
    // reload, which is still better than losing it on every sheet close.
  }
}

export const usePendingCalls = create<Store>((set, get) => ({
  calls: load(),
  start: (target, callId, startedAt = Date.now()) => {
    const calls = { ...fresh(get().calls, startedAt), [callTargetKey(target)]: { callId, startedAt } }
    save(calls)
    set({ calls })
  },
  clear: (target) => {
    const calls = { ...get().calls }
    delete calls[callTargetKey(target)]
    save(calls)
    set({ calls })
  },
}))

/** The unfinished call for one guest, or null. */
export function usePendingCall(target: CallTarget): PendingCall | null {
  const key = callTargetKey(target)
  return usePendingCalls((s) => s.calls[key] ?? null)
}

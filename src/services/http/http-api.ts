/**
 * REST implementation sketch of GamApi for the Express + MySQL backend.
 *
 * Not wired by default (VITE_API_MODE=mock). It documents, in code, how each
 * call maps to REST_ENDPOINTS, how Idempotency-Key and versions are sent, and
 * how error payloads become ApiError. Endpoints marked PROPOSED in
 * contracts.ts must be agreed with the backend team before use.
 */
import type { ChangeEvent, SessionUser } from "@/domain/models"
import { ApiError, type ApiErrorCode, type GamApi } from "../contracts"

const DATE_KEYS = /At$|^at$|Date$/

function revive(_key: string, value: unknown) {
  if (typeof value === "string" && DATE_KEYS.test(_key) && /^\d{4}-\d{2}-\d{2}T/.test(value)) return new Date(value)
  return value
}

export function createHttpApi(baseUrl: string, venueId: number): GamApi {
  let session: SessionUser | null = null
  let lastSeq = 0

  async function request<T>(method: string, path: string, body?: unknown, idempotent = false): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    if (idempotent) headers["Idempotency-Key"] = crypto.randomUUID()
    const res = await fetch(`${baseUrl}${path.replace(":venueId", String(venueId))}`, {
      method,
      headers,
      credentials: "include",
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    const data = text ? JSON.parse(text, revive) : null
    if (!res.ok) {
      throw new ApiError(
        res.status,
        (data?.code ?? "VALIDATION_FAILED") as ApiErrorCode,
        data?.message ?? res.statusText,
        data?.details ?? {},
      )
    }
    return data as T
  }

  const get = <T>(path: string) => request<T>("GET", path)
  const post = <T>(path: string, body?: unknown) => request<T>("POST", path, body, true)

  return {
    mode: "http",
    setSession(user) {
      session = user
    },
    listDemoUsers: () => (session ? [session] : []),
    subscribe(listener: (e: ChangeEvent) => void) {
      // db09: poll the change feed every 2.5s (WebSocket push can replace this).
      const timer = setInterval(async () => {
        try {
          const feed = await get<{
            latestSeq: number
            events: { action: string; entityType: string }[]
            truncated: boolean
          }>(`/api/venues/:venueId/changes?since=${lastSeq}&limit=200`)
          if (feed.latestSeq !== lastSeq) {
            lastSeq = feed.latestSeq
            listener({
              latestSeq: feed.latestSeq,
              action: feed.truncated ? "RESYNC" : "CHANGES",
              entityType: "venue",
              actorKind: "USER",
              actorUserId: null,
              summary: "",
            })
          }
        } catch {
          /* offline: keep last state, next poll retries */
        }
      }, 2500)
      return () => clearInterval(timer)
    },
    getCatalog: () => get("/api/venues/:venueId/catalog"),
    getFloorState: (at) => get(`/api/venues/:venueId/floor-state?at=${at.toISOString()}`),
    getAvailability: (at, party) => get(`/api/venues/:venueId/availability?at=${at.toISOString()}&party=${party}`),
    getShiftOverview: () => get("/api/venues/:venueId/shift-overview"),
    listReservations: (q) =>
      get(`/api/venues/:venueId/reservations?date=${q.businessDate}&q=${encodeURIComponent(q.search ?? "")}`),
    listVisits: (bd) => get(`/api/venues/:venueId/visits?date=${bd}`),
    listWaitlist: (bd) => get(`/api/venues/:venueId/waitlist?date=${bd}`),
    searchCustomers: (q) => get(`/api/customers?q=${encodeURIComponent(q)}`),
    getCustomer: (id) => get(`/api/customers/${id}`),
    listOperations: (limit) => get(`/api/venues/:venueId/operations?limit=${limit}`),
    listAllocations: (bd, tableId) =>
      get(`/api/venues/:venueId/allocations?date=${bd}${tableId ? `&table=${tableId}` : ""}`),
    getReport: (q) => get(`/api/venues/:venueId/reports/usage?from=${q.from}&to=${q.to}&zone=${q.zone}`),
    createReservation: (input) => post("/api/venues/:venueId/reservations", input),
    updateReservation: (input) => request("PATCH", `/api/reservations/${input.id}`, input, true),
    assignTables: (id, version, tableIds, overrideReason) =>
      post(`/api/reservations/${id}/assign`, { version, tableIds, overrideReason }),
    cancelReservation: (id, version, reasonCode, note) =>
      post(`/api/reservations/${id}/cancel`, { version, reasonCode, note }),
    markNoShow: (id, version) => post(`/api/reservations/${id}/no-show`, { version }),
    checkIn: (input) => post(`/api/reservations/${input.reservationId}/check-in`, input),
    seatWalkIn: (input) => post("/api/venues/:venueId/walk-ins", input),
    moveClaim: (input) => post("/api/floor/move", input),
    combineTables: (input) => post("/api/floor/combine", input),
    splitGroup: (input) => post(`/api/table-groups/${input.groupId}/split`, input),
    endVisit: (id, version) => post(`/api/visits/${id}/end`, { version }),
    markPaid: (id, version) => post(`/api/visits/${id}/paid`, { version }),
    setTableStatus: (id, version, patch) => request("PATCH", `/api/tables/${id}`, { version, ...patch }, true),
    addWaitlist: (input) => post("/api/venues/:venueId/waitlist", input),
    claimWaitlist: (id, version) => post(`/api/waitlist/${id}/claim`, { version }),
    releaseClaim: (id, version) => post(`/api/waitlist/${id}/release-claim`, { version }),
    recordContact: (input) => post(`/api/waitlist/${input.entryId}/contact-attempts`, input),
    seatWaitlist: (input) => post(`/api/waitlist/${input.entryId}/seat`, input),
    cancelWaitlist: (id, version, reasonCode, note) =>
      post(`/api/waitlist/${id}/cancel`, { version, reasonCode, note }),
    setHoldDeadline: (id, version, deadlineAt, reason) =>
      post(`/api/holds/${id}/deadline`, { version, deadlineAt, reason }),
    releaseHold: (id, version, reasonCode, note) => post(`/api/holds/${id}/release`, { version, reasonCode, note }),
    revealPhone: (id, reasonCode, context) =>
      post(`/api/customers/${id}/phone:reveal`, { reason_code: reasonCode, context }),
    updateCustomerNotes: (id, version, notes) => request("PATCH", `/api/customers/${id}`, { version, notes }, true),
    undo: (id) => post(`/api/operations/${id}/undo`),
    redo: (id) => post(`/api/operations/${id}/redo`),
    updateVenueConfig: (patch) => request("PATCH", "/api/venues/:venueId", patch, true),
    setZoneFlags: (id, version, flags) => request("PATCH", `/api/zones/${id}`, { version, ...flags }, true),
  }
}

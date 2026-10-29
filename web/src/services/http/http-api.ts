/**
 * REST implementation sketch of GamApi for the Express + MySQL backend.
 *
 * Not wired by default (VITE_API_MODE=mock). It documents, in code, how each
 * call maps to REST_ENDPOINTS and how entity versions are sent. The backend
 * does not yet enforce Idempotency-Key, so this client does not pretend that
 * mutations are safe to retry. Endpoints marked PROPOSED in
 * contracts.ts must be agreed with the backend team before use.
 */
import type { SessionUser } from "@/domain/models"
import { businessDateOf } from "@/lib/time"
import type { GamApi } from "../contracts"
import {
  mapCatalog,
  mapFloorState,
  type BackendBooking,
  type BackendCatalog,
  type BackendFloorGroup,
  type BackendSource,
  type BackendTableState,
} from "./floor-adapter"
import type { HttpClient } from "./http-client"

const DATE_KEYS = /At$|^at$|Date$/

function revive(_key: string, value: unknown) {
  if (typeof value === "string" && DATE_KEYS.test(_key) && /^\d{4}-\d{2}-\d{2}T/.test(value)) return new Date(value)
  return value
}

export function createHttpApi(client: HttpClient, venueId: number): GamApi {
  let session: SessionUser | null = null

  const pathForVenue = (path: string) => path.replace(":venueId", String(venueId))
  const options = { reviver: revive }
  const get = <T>(path: string) => client.get<T>(pathForVenue(path), options)
  const post = <T>(path: string, body?: unknown) => client.post<T>(pathForVenue(path), body, options)
  const request = <T>(method: "PUT" | "PATCH" | "DELETE", path: string, body?: unknown) =>
    client.request<T>(method, pathForVenue(path), body, options)

  let catalogPromise: ReturnType<GamApi["getCatalog"]> | null = null
  const loadCatalog = () => {
    if (!catalogPromise) {
      catalogPromise = Promise.all([
        get<BackendCatalog>("/tables/catalog"),
        get<{ sources: BackendSource[] }>("/bookings/sources"),
      ])
        .then(([catalog, sourceResponse]) => mapCatalog(catalog, sourceResponse.sources))
        .catch((error: unknown) => {
          catalogPromise = null
          throw error
        })
    }
    return catalogPromise
  }

  return {
    mode: "http",
    setSession(user) {
      session = user
    },
    listDemoUsers: () => (session ? [session] : []),
    subscribe() {
      // The current backend does not expose a change-feed route. Floor State owns one
      // bounded 15-second polling loop instead of issuing a second stream of silent 404s.
      return () => undefined
    },
    getCatalog: loadCatalog,
    getFloorState: async (at) => {
      const businessDate = businessDateOf(at)
      const [catalog, tableResponse, bookingResponse] = await Promise.all([
        loadCatalog(),
        get<{ businessDate: string; tables: BackendTableState[]; groups: BackendFloorGroup[] }>(`/tables?date=${businessDate}`),
        get<{ businessDate: string; bookings: BackendBooking[] }>(`/bookings?date=${businessDate}`),
      ])
      return mapFloorState(
        at,
        tableResponse.businessDate,
        tableResponse.tables,
        bookingResponse.bookings,
        catalog,
        tableResponse.groups,
      )
    },
    getAvailability: (at, party) => get(`/venues/:venueId/availability?at=${at.toISOString()}&party=${party}`),
    getShiftOverview: () => get("/venues/:venueId/shift-overview"),
    listReservations: (q) =>
      get(`/venues/:venueId/reservations?date=${q.businessDate}&q=${encodeURIComponent(q.search ?? "")}`),
    listVisits: (bd) => get(`/venues/:venueId/visits?date=${bd}`),
    listWaitlist: (bd) => get(`/venues/:venueId/waitlist?date=${bd}`),
    searchCustomers: (q) => get(`/customers?q=${encodeURIComponent(q)}`),
    getCustomer: (id) => get(`/customers/${id}`),
    listOperations: (limit) => get(`/venues/:venueId/operations?limit=${limit}`),
    listAllocations: (bd, tableId) =>
      get(`/venues/:venueId/allocations?date=${bd}${tableId ? `&table=${tableId}` : ""}`),
    getReport: (q) => get(`/venues/:venueId/reports/usage?from=${q.from}&to=${q.to}&zone=${q.zone}`),
    createReservation: (input) => post("/venues/:venueId/reservations", input),
    updateReservation: (input) => request("PATCH", `/reservations/${input.id}`, input),
    assignTables: (id, version, tableIds, overrideReason) =>
      post(`/reservations/${id}/assign`, { version, tableIds, overrideReason }),
    cancelReservation: (id, version, reasonCode, note) =>
      post(`/reservations/${id}/cancel`, { version, reasonCode, note }),
    markNoShow: (id, version) => post(`/reservations/${id}/no-show`, { version }),
    checkIn: (input) => post(`/reservations/${input.reservationId}/check-in`, input),
    seatWalkIn: (input) => post("/venues/:venueId/walk-ins", input),
    moveClaim: (input) => post("/floor/move", input),
    combineTables: (input) => post("/floor/combine", input),
    splitGroup: (input) => post(`/table-groups/${input.groupId}/split`, input),
    endVisit: (id, version) => post(`/visits/${id}/end`, { version }),
    markPaid: (id, version) => post(`/visits/${id}/paid`, { version }),
    setTableStatus: (id, version, patch) => request("PATCH", `/tables/${id}`, { version, ...patch }),
    addWaitlist: (input) => post("/venues/:venueId/waitlist", input),
    claimWaitlist: (id, version) => post(`/waitlist/${id}/claim`, { version }),
    releaseClaim: (id, version) => post(`/waitlist/${id}/release-claim`, { version }),
    recordContact: (input) => post(`/waitlist/${input.entryId}/contact-attempts`, input),
    seatWaitlist: (input) => post(`/waitlist/${input.entryId}/seat`, input),
    cancelWaitlist: (id, version, reasonCode, note) => post(`/waitlist/${id}/cancel`, { version, reasonCode, note }),
    setHoldDeadline: (id, version, deadlineAt, reason) =>
      post(`/holds/${id}/deadline`, { version, deadlineAt, reason }),
    releaseHold: (id, version, reasonCode, note) => post(`/holds/${id}/release`, { version, reasonCode, note }),
    revealPhone: (id, reasonCode, context) =>
      post(`/customers/${id}/phone:reveal`, { reason_code: reasonCode, context }),
    updateCustomerNotes: (id, version, notes) => request("PATCH", `/customers/${id}`, { version, notes }),
    undo: (id) => post(`/operations/${id}/undo`),
    redo: (id) => post(`/operations/${id}/redo`),
    updateVenueConfig: (patch) => request("PATCH", "/venues/:venueId", patch),
    setZoneFlags: (id, version, flags) => request("PATCH", `/zones/${id}`, { version, ...flags }),
  }
}

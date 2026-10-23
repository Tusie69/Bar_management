/**
 * API contract between the 21GAM frontend and the Express/MySQL backend.
 *
 * The UI only talks to `GamApi`. Today it is backed by an in-memory mock
 * (src/services/mock); `src/services/http/http-api.ts` shows how the same
 * interface maps onto REST. Endpoint paths follow database/09 and db08 where
 * those docs name them; the rest are PROPOSED and need sign-off by Nam/Tú.
 *
 * Conventions expected from the backend:
 * - Every mutation carries `Idempotency-Key` (one UUID per user intent).
 * - Writes send the entity `version` for optimistic locking.
 * - Errors: { status, code, message, details } with codes below.
 */
import type { BusinessDate } from "@/lib/time"
import type {
  BookingSourceCode,
  ContactAttemptChannel,
  ContactOutcome,
  HoldReleaseReason,
  ReservationCloseReason,
  RoleCode,
  WaitlistChannel,
  WaitlistCloseReason,
  WaitlistKind,
  WaitlistPreferenceMode,
} from "@/domain/enums"
import type {
  AvailabilityResult,
  Catalog,
  ChangeEvent,
  CustomerProfile,
  CustomerSummary,
  FloorState,
  MutationResult,
  AllocationView,
  OperationView,
  PhoneReveal,
  ReportQuery,
  ReportResult,
  ReservationView,
  SessionUser,
  ShiftOverview,
  VenueConfig,
  VisitView,
  WaitlistEntryView,
} from "@/domain/models"
import type { ZoneCode } from "@/domain/venue-layout"

export type ApiErrorCode =
  | "VALIDATION_FAILED"
  | "PERMISSION_DENIED"
  | "NOT_FOUND"
  | "VERSION_CONFLICT"
  | "TABLE_CONFLICT"
  | "ENTRY_ALREADY_CLAIMED"
  | "NO_SYMBOL_AVAILABLE"
  | "UNDO_CONFLICT_MODIFIED"
  | "NOT_UNDOABLE"
  | "IDEMPOTENCY_KEY_REUSED"
  | "INVALID_STATE"
  | "OVERRIDE_REQUIRED"

export class ApiError extends Error {
  readonly status: number
  readonly code: ApiErrorCode
  readonly details: Record<string, unknown>

  constructor(status: number, code: ApiErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError

/* ---------------- Inputs ---------------- */

export interface CreateReservationInput {
  contactName?: string
  /** Sent once on create; the API stores ciphertext + last3 and never echoes it. */
  phone?: string
  partySize: number
  expectedAt: Date
  sourceCode: BookingSourceCode
  note?: string
  tableIds?: number[]
  overrideReason?: string
}

export interface UpdateReservationInput {
  id: number
  version: number
  contactName?: string
  partySize?: number
  expectedAt?: Date
  sourceCode?: BookingSourceCode
  note?: string | null
}

export interface WalkInInput {
  tableIds: number[]
  guestCount: number
  contactName?: string
  overrideReason?: string
}

export interface CheckInInput {
  reservationId: number
  version: number
  guestCount: number
  tableIds?: number[]
  overrideReason?: string
}

export interface MoveInput {
  /** Visit or reservation whose claim moves. */
  claim: { visitId?: number; reservationId?: number; waitlistEntryId?: number }
  fromTableId: number
  toTableId: number
  overrideReason?: string
}

export interface CombineInput {
  claim: { visitId?: number; reservationId?: number }
  addTableIds: number[]
  overrideReason?: string
}

export interface SplitInput {
  groupId: number
  /** Tables that stay with the party. Others are released (SPLIT). */
  keepTableIds: number[]
}

export interface AddWaitlistInput {
  kind: WaitlistKind
  reservationId?: number
  contactName?: string
  partySize?: number
  channel: WaitlistChannel
  preferenceMode: WaitlistPreferenceMode
  preferences: { tableId?: number; combinationId?: number; zoneCode?: ZoneCode }[]
  note?: string
}

export interface RecordContactInput {
  entryId: number
  version: number
  channel: ContactAttemptChannel
  outcome: ContactOutcome
  offeredTableIds?: number[]
  note?: string
  overrideReason?: string
}

export interface SeatWaitlistInput {
  entryId: number
  version: number
  guestCount: number
  tableIds?: number[]
  overrideReason?: string
}

export interface VenueConfigPatch {
  version: number
  lateWarningMinutes?: number
  noShowWarningMinutes?: number
  waitlistHoldDefaultMinutes?: number
  waitlistClaimLeaseSeconds?: number
  reservationHoldPolicy?: "SEQUENTIAL" | "WINDOWED"
  reservationWindowMinutes?: number | null
  groupSymbolCount?: number
}

export interface ReservationQuery {
  businessDate: BusinessDate
  search?: string
}

/* ---------------- Interface ---------------- */

export interface GamApi {
  readonly mode: "mock" | "http"

  setSession(user: SessionUser): void
  listDemoUsers(): SessionUser[]
  subscribe(listener: (event: ChangeEvent) => void): () => void

  // Queries
  getCatalog(): Promise<Catalog>
  getFloorState(at: Date): Promise<FloorState>
  getAvailability(at: Date, partySize: number): Promise<AvailabilityResult>
  getShiftOverview(): Promise<ShiftOverview>
  listReservations(q: ReservationQuery): Promise<ReservationView[]>
  listVisits(businessDate: BusinessDate): Promise<VisitView[]>
  listWaitlist(businessDate: BusinessDate): Promise<WaitlistEntryView[]>
  searchCustomers(query: string): Promise<CustomerSummary[]>
  getCustomer(id: number): Promise<CustomerProfile>
  listOperations(limit: number): Promise<OperationView[]>
  /** table_allocations of a business date, optionally for one table (history + timeline). */
  listAllocations(businessDate: BusinessDate, tableId?: number): Promise<AllocationView[]>
  getReport(q: ReportQuery): Promise<ReportResult>

  // Reservations
  createReservation(input: CreateReservationInput): Promise<MutationResult & { reservationId: number }>
  updateReservation(input: UpdateReservationInput): Promise<MutationResult>
  assignTables(
    reservationId: number,
    version: number,
    tableIds: number[],
    overrideReason?: string,
  ): Promise<MutationResult>
  cancelReservation(id: number, version: number, reason: ReservationCloseReason, note?: string): Promise<MutationResult>
  markNoShow(id: number, version: number): Promise<MutationResult>
  checkIn(input: CheckInInput): Promise<MutationResult>

  // Floor
  seatWalkIn(input: WalkInInput): Promise<MutationResult & { visitId: number }>
  moveClaim(input: MoveInput): Promise<MutationResult>
  combineTables(input: CombineInput): Promise<MutationResult>
  splitGroup(input: SplitInput): Promise<MutationResult>
  endVisit(visitId: number, version: number): Promise<MutationResult>
  markPaid(visitId: number, version: number): Promise<MutationResult>
  setTableStatus(
    tableId: number,
    version: number,
    patch: { status?: "ACTIVE" | "OUT_OF_SERVICE"; isSpare?: boolean },
  ): Promise<MutationResult>

  // Waitlist
  addWaitlist(input: AddWaitlistInput): Promise<MutationResult & { entryId: number }>
  claimWaitlist(entryId: number, version: number): Promise<MutationResult>
  releaseClaim(entryId: number, version: number): Promise<MutationResult>
  recordContact(input: RecordContactInput): Promise<MutationResult>
  seatWaitlist(input: SeatWaitlistInput): Promise<MutationResult>
  cancelWaitlist(entryId: number, version: number, reason: WaitlistCloseReason, note?: string): Promise<MutationResult>
  setHoldDeadline(holdId: number, version: number, deadlineAt: Date, reason: string): Promise<MutationResult>
  releaseHold(holdId: number, version: number, reason: HoldReleaseReason, note?: string): Promise<MutationResult>

  // Customers
  revealPhone(
    customerId: number,
    reasonCode: string,
    context: { reservationId?: number; entryId?: number },
  ): Promise<PhoneReveal>
  updateCustomerNotes(customerId: number, version: number, notes: string): Promise<MutationResult>

  // Undo / config
  undo(operationId: number): Promise<MutationResult>
  redo(undoOperationId: number): Promise<MutationResult>
  updateVenueConfig(patch: VenueConfigPatch): Promise<MutationResult & { venue: VenueConfig }>
  setZoneFlags(
    zoneId: number,
    version: number,
    flags: { isBookable: boolean; isWaitingArea: boolean },
  ): Promise<MutationResult>
}

/**
 * Proposed REST mapping (documentation; consumed by http-api.ts).
 * PROPOSED = not yet in the database docs, to be agreed with backend.
 */
export const REST_ENDPOINTS = {
  catalog: "GET /api/venues/:venueId/catalog", // PROPOSED
  floorState: "GET /api/venues/:venueId/floor-state?at=ISO", // db09
  availability: "GET /api/venues/:venueId/availability?at=ISO&party=N", // PROPOSED
  changes: "GET /api/venues/:venueId/changes?since=SEQ&limit=200", // db09
  overview: "GET /api/venues/:venueId/shift-overview?date=YYYY-MM-DD", // PROPOSED
  reservations: "GET /api/venues/:venueId/reservations?date=YYYY-MM-DD&q=", // PROPOSED
  createReservation: "POST /api/venues/:venueId/reservations",
  updateReservation: "PATCH /api/reservations/:id",
  assignTables: "POST /api/reservations/:id/assign",
  cancelReservation: "POST /api/reservations/:id/cancel",
  markNoShow: "POST /api/reservations/:id/no-show",
  checkIn: "POST /api/reservations/:id/check-in",
  walkIn: "POST /api/venues/:venueId/walk-ins",
  move: "POST /api/floor/move",
  combine: "POST /api/floor/combine",
  split: "POST /api/table-groups/:id/split",
  endVisit: "POST /api/visits/:id/end",
  markPaid: "POST /api/visits/:id/paid",
  waitlist: "GET /api/venues/:venueId/waitlist?date=YYYY-MM-DD",
  addWaitlist: "POST /api/venues/:venueId/waitlist",
  claim: "POST /api/waitlist/:id/claim",
  releaseClaim: "POST /api/waitlist/:id/release-claim",
  contact: "POST /api/waitlist/:id/contact-attempts",
  seatWaitlist: "POST /api/waitlist/:id/seat",
  cancelWaitlist: "POST /api/waitlist/:id/cancel",
  holdDeadline: "POST /api/holds/:id/deadline",
  releaseHold: "POST /api/holds/:id/release",
  customers: "GET /api/customers?q=",
  customer: "GET /api/customers/:id",
  revealPhone: "POST /api/customers/:id/phone:reveal", // db08, Cache-Control: no-store
  undo: "POST /api/operations/:id/undo", // db09
  redo: "POST /api/operations/:id/redo", // db09
  operations: "GET /api/venues/:venueId/operations?limit=N",
  allocations: "GET /api/venues/:venueId/allocations?date=YYYY-MM-DD&table=ID", // PROPOSED
  report: "GET /api/venues/:venueId/reports/usage?from=&to=&zone=",
  venueConfig: "PATCH /api/venues/:venueId",
} as const

export const DEMO_ROLE_ORDER: RoleCode[] = ["RECEPTIONIST", "OWNER_ADMIN", "CUSTOMER_CARE", "CASHIER"]

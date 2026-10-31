/**
 * API contract between the 21GAM frontend and the Express/MySQL backend.
 *
 * The UI talks to `GamApi`, selected as HTTP or development mock at runtime.
 * The frozen integration contract defines the implemented backend capabilities.
 *
 * Transport: /api/v1, HttpOnly session cookie, memory-only CSRF token.
 * Existing-entity writes carry a version and are never automatically retried.
 * The backend does not enforce idempotency keys. Unsupported capabilities reject 501.
 */
import type { BusinessDate } from "@/lib/time"
import type {
  BookingSourceCode,
  BookingClassification,
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

export type KnownApiErrorCode =
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
  | "NOT_SUPPORTED_BY_BACKEND"

export type ApiErrorCode = KnownApiErrorCode | (string & {})

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
export const isNotSupported = (error: unknown): error is ApiError =>
  isApiError(error) && error.status === 501 && error.code === "NOT_SUPPORTED_BY_BACKEND"

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
  classification?: BookingClassification
}

export interface UpdateReservationInput {
  id: number
  version: number
  contactName?: string
  partySize?: number
  expectedAt?: Date
  sourceCode?: BookingSourceCode
  note?: string | null
  classification?: BookingClassification
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
  claim: { visitId?: number; reservationId?: number; waitlistEntryId?: number; version?: number }
  fromTableId: number
  toTableId: number
  overrideReason?: string
}

export interface CombineInput {
  claim: { visitId?: number; reservationId?: number; version?: number }
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
  businessDate?: BusinessDate
  phone?: string
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
  getFloorState(at: Date, businessDate?: BusinessDate): Promise<FloorState>
  getAvailability(at: Date, partySize: number): Promise<AvailabilityResult>
  getShiftOverview(): Promise<ShiftOverview>
  listReservations(q: ReservationQuery): Promise<ReservationView[]>
  exportDailyBookingText(businessDate: BusinessDate): Promise<string>
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
    patch: { status?: "ACTIVE" | "OUT_OF_SERVICE"; isSpare?: boolean; reason?: string },
  ): Promise<MutationResult>

  // Waitlist
  addWaitlist(input: AddWaitlistInput): Promise<MutationResult & { entryId: number }>
  claimWaitlist(entryId: number, version: number): Promise<MutationResult>
  releaseClaim(entryId: number, version: number): Promise<MutationResult>
  recordContact(input: RecordContactInput): Promise<MutationResult>
  /** Target backend assigns a reservation hold, with a group for multiple tables. */
  seatWaitlist(input: SeatWaitlistInput): Promise<MutationResult & { reservationId: number; groupId: number | null }>
  cancelWaitlist(entryId: number, version: number, reason: WaitlistCloseReason, note?: string): Promise<MutationResult>
  setHoldDeadline(holdId: number, version: number, deadlineAt: Date, reason: string): Promise<MutationResult>
  releaseHold(holdId: number, version: number, reason: HoldReleaseReason, note?: string): Promise<MutationResult>

  // Customers
  revealPhone(
    /** In HTTP mode this is the booking id; mock mode uses the customer id. */
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

/** Implemented backend paths, relative to /api/v1. */
export const REST_ENDPOINTS = {
  catalog: "GET /tables/catalog",
  sources: "GET /bookings/sources",
  floorState: "GET /tables?date=YYYY-MM-DD",
  reservations: "GET /bookings?date=YYYY-MM-DD",
  exportDailyBookingText: "GET /bookings/export?date=YYYY-MM-DD",
  createReservation: "POST /bookings",
  updateReservation: "PUT /bookings/:id",
  assignTables: "POST /bookings/:id/assign",
  cancelReservation: "POST /bookings/:id/cancel",
  markNoShow: "POST /bookings/:id/no-show",
  checkIn: "POST /bookings/:id/check-in",
  walkIn: "POST /bookings/walk-ins",
  move: "POST /visits/:id/move",
  combine: "POST /visits/:id/merge",
  endVisit: "POST /visits/:id/close",
  waitlist: "GET /waitlist?date=YYYY-MM-DD",
  addWaitlist: "POST /waitlist",
  contact: "POST /waitlist/:id/contact-attempts",
  seatWaitlist: "POST /waitlist/:id/seat",
  cancelWaitlist: "POST /waitlist/:id/cancel",
  revealPhone: "POST /bookings/:id/phone:reveal",
} as const

export const DEMO_ROLE_ORDER: RoleCode[] = ["RECEPTIONIST", "OWNER_ADMIN", "CUSTOMER_CARE", "CASHIER"]

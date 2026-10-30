/**
 * View models returned by the API layer (what the UI renders).
 * They are derived from the DDL rows, never contain raw phone numbers, and
 * map 1:1 to the REST payloads proposed in src/services/contracts.ts.
 */
import type { BusinessDate } from "@/lib/time"
import type {
  BookingSourceCode,
  BookingClassification,
  ContactAttemptChannel,
  ContactOutcome,
  DeadlineBasis,
  ReservationCloseReason,
  ReservationHoldPolicy,
  ReservationStatus,
  RoleCode,
  TableKind,
  TableStatus,
  VisitEndReason,
  VisitOrigin,
  WaitlistChannel,
  WaitlistKind,
  WaitlistPreferenceMode,
  WaitlistStatus,
} from "./enums"
import type { SeatingStyle, ZoneCode } from "./venue-layout"

export interface SessionUser {
  id: number
  displayName: string
  role: RoleCode
  deviceLabel: string
}

export interface VenueConfig {
  id: number
  version: number
  name: string
  timezone: string
  businessDayStartLocal: string
  businessDayCutoffLocal: string
  lateWarningMinutes: number
  noShowWarningMinutes: number
  waitlistHoldDefaultMinutes: number
  waitlistClaimLeaseSeconds: number
  reservationHoldPolicy: ReservationHoldPolicy
  reservationWindowMinutes: number | null
  groupSymbolCount: number
  changeSeq: number
}

export interface ZoneView {
  id: number
  version: number
  code: ZoneCode
  name: string
  isBookable: boolean
  isWaitingArea: boolean
}

export interface TableView {
  id: number
  version: number
  code: string
  displayName: string
  zoneId: number
  zoneCode: ZoneCode
  kind: TableKind
  capacity: number
  seqNo: number | null
  isSpare: boolean
  status: TableStatus
  x: number
  y: number
  w: number
  h: number
  /** Optional because the current database stores geometry, but not chair orientation. */
  seating?: SeatingStyle | "bar"
}

export interface CombinationView {
  id: number
  code: string
  displayName: string
  memberIds: number[]
  capacity: number
  /** Mock/product-review metadata; absent when the database has no equivalent field. */
  pendingConfirmation?: boolean
}

export interface BookingSourceView {
  /** The current read API exposes the stable code/name pair, not its internal database id. */
  id?: number
  code: BookingSourceCode
  name: string
}

export interface Catalog {
  venue: VenueConfig
  zones: ZoneView[]
  tables: TableView[]
  combinations: CombinationView[]
  sources: BookingSourceView[]
}

/* ---------------- Floor ---------------- */

export type TableLiveState =
  "free" | "reserved" | "late" | "noshow" | "seated" | "hold" | "hold_overdue" | "oos" | "spare"

export type BookingWarning = "late" | "noshow" | null

export interface ClaimView {
  kind: "visit" | "reservation" | "waitlist_hold"
  visitId: number | null
  reservationId: number | null
  waitlistEntryId: number | null
  holdId: number | null
  displayName: string
  phoneLast3: string | null
  partySize: number
  /** Visit start, reservation expected time, or hold confirmation time. */
  startsAt: Date
  deadlineAt: Date | null
  paid: boolean
  origin: VisitOrigin | null
  tableIds: number[]
  groupId: number | null
  symbolNo: number | null
  warning: BookingWarning
  minutesLate: number
  sourceCode: BookingSourceCode | null
  note: string | null
  version: number
}

export interface FloorTableState {
  tableId: number
  state: TableLiveState
  claim: ClaimView | null
  /** Seated but the business day already rolled over: "bàn chưa nhả từ hôm trước". */
  /** Absent when the backend read model cannot determine carry-over occupancy. */
  staleFromPreviousDay?: boolean
}

/** One row of table_allocations, resolved for display (history + timeline). */
export interface AllocationView {
  allocationId: number
  tableId: number
  kind: "HOLD" | "USAGE"
  holdKind: "RESERVATION" | "WAITLIST_OFFER" | null
  reservationId: number | null
  visitId: number | null
  waitlistEntryId: number | null
  /** Claim start: seating time for usage, expected time for a booking hold, confirmation time for a waitlist hold. */
  startsAt: Date
  /** Deadline of a waitlist hold. */
  deadlineAt: Date | null
  releasedAt: Date | null
  releaseReason: string | null
  name: string
  partySize: number | null
  symbolNo: number | null
  warning: BookingWarning
}

export interface FloorGroup {
  id: number
  symbolNo: number
  tableIds: number[]
}

export interface FloorState {
  at: Date
  businessDate: BusinessDate
  tables: FloorTableState[]
  groups: FloorGroup[]
  changeSeq: number
}

export type AvailabilityStatus =
  "available" | "too_small" | "reserved" | "occupied_unknown_end" | "spare" | "oos" | "not_bookable" | "past"

export interface TableAvailability {
  tableId: number
  status: AvailabilityStatus
  reason: string
  claimStartsAt: Date | null
}

export interface CombinationAvailability {
  combinationId: number
  available: boolean
  capacity: number
  reason: string
}

export interface AvailabilityResult {
  at: Date
  businessDate: BusinessDate
  partySize: number
  policy: ReservationHoldPolicy
  tables: TableAvailability[]
  combinations: CombinationAvailability[]
}

/* ---------------- Reservations / visits ---------------- */

export type BookedSubState = "CHO_PHAN_BAN" | "CHO_BAN" | "DANG_GIU_BAN"

export interface ReservationView {
  id: number
  version: number
  customerId: number | null
  displayName: string
  phoneLast3: string | null
  partySize: number
  expectedAt: Date
  businessDate: BusinessDate
  classification: BookingClassification
  status: ReservationStatus
  sourceCode: BookingSourceCode
  note: string | null
  tableIds: number[]
  holdId: number | null
  symbolNo: number | null
  subState: BookedSubState | null
  warning: BookingWarning
  minutesLate: number
  waitlistEntryId: number | null
  visitId: number | null
  checkedInAt: Date | null
  closedAt: Date | null
  closeReasonCode: ReservationCloseReason | null
  closeReasonNote: string | null
  createdAt: Date
  createdByName: string
}

export interface VisitView {
  id: number
  version: number
  origin: VisitOrigin
  customerId: number | null
  displayName: string
  phoneLast3: string | null
  guestCount: number
  startedAt: Date
  endedAt: Date | null
  endReason: VisitEndReason | null
  paidMarkedAt: Date | null
  tableIds: number[]
  groupId: number | null
  symbolNo: number | null
  reservationId: number | null
  businessDate: BusinessDate
  note: string | null
}

/* ---------------- Waitlist ---------------- */

export interface WaitlistPreferenceView {
  rank: number
  tableId: number | null
  combinationId: number | null
  zoneCode: ZoneCode | null
  label: string
}

export interface ContactAttemptView {
  id: number
  attemptNo: number
  byName: string
  channel: ContactAttemptChannel
  startedAt: Date
  outcome: ContactOutcome
  offeredTableIds: number[]
  note: string | null
}

export interface WaitlistHoldView {
  id: number
  version: number
  tableIds: number[]
  confirmedAt: Date
  deadlineAt: Date
  basis: DeadlineBasis
  overdue: boolean
}

export interface WaitlistEntryView {
  id: number
  version: number
  kind: WaitlistKind
  displayName: string
  phoneLast3: string | null
  customerId: number | null
  partySize: number
  preferenceMode: WaitlistPreferenceMode
  preferences: WaitlistPreferenceView[]
  channel: WaitlistChannel
  businessDate: BusinessDate
  queuedAt: Date
  status: WaitlistStatus
  claimedBy: { userId: number; name: string } | null
  claimExpiresAt: Date | null
  offeredAt: Date | null
  hold: WaitlistHoldView | null
  reservationId: number | null
  reservationExpectedAt: Date | null
  attempts: ContactAttemptView[]
  note: string | null
  callbackRequested: boolean
  closedAt: Date | null
}

/* ---------------- Customers ---------------- */

export interface CustomerSummary {
  id: number
  displayName: string
  phoneLast3: string | null
  /** Server-masked, e.g. "*******789". The raw number is never sent. */
  phoneMasked: string | null
  visitCount: number
  lastVisitAt: Date | null
}

export interface CustomerProfile extends CustomerSummary {
  version: number
  notes: string | null
  createdAt: Date
  visits30d: number
  visits90d: number
  averageParty: number | null
  visitsByMonth: { month: string; count: number }[]
  visits: VisitView[]
  reservations: ReservationView[]
}

export interface PhoneReveal {
  customerId: number
  phoneE164: string
  revealedAt: Date
}

/* ---------------- Operations / realtime ---------------- */

export interface OperationView {
  id: number
  occurredAt: Date
  actorKind: "USER" | "SYSTEM"
  actorName: string
  deviceLabel: string | null
  action: string
  actionLabel: string
  entityType: string
  entityId: number
  summary: string
  isUndoable: boolean
  compensatesOperationId: number | null
  compensatedBy: number | null
  mine: boolean
  reasonCode: string | null
  businessDate: BusinessDate
}

export interface MutationResult {
  operationId: number | null
  changeSeq: number
  summary: string
  undoable: boolean
}

export interface ChangeEvent {
  latestSeq: number
  action: string
  entityType: string
  actorKind: "USER" | "SYSTEM"
  actorUserId: number | null
  /** Table codes only. Events carry no personal data (db09). */
  summary: string
}

/* ---------------- Overview / reports ---------------- */

export interface ShiftOverview {
  businessDate: BusinessDate
  reservationsTotal: number
  reservationsUpcoming60: number
  reservationsUnassigned: number
  checkedInReservations: number
  seatedGuests: number
  seatedVisits: number
  visitsTonight: number
  guestsTonight: number
  tablesInUse: number
  tablesTotal: number
  barSeatsInUse: number
  barSeatsTotal: number
  attention: number
  waitlistAdvance: number
  waitlistWalkIn: number
  byHour: { hour: string; expected: number; seated: number }[]
  byZone: { zone: ZoneCode; name: string; inUse: number; total: number }[]
}

export interface ReportQuery {
  from: BusinessDate
  to: BusinessDate
  zone: ZoneCode | "ALL"
}

export interface ReportResult {
  query: ReportQuery
  visits: number
  guests: number
  tableTurns: number
  combines: number
  moves: number
  splits: number
  releases: number
  byDate: { date: BusinessDate; visits: number; guests: number; turns: number }[]
  byTable: { tableId: number; code: string; zone: ZoneCode; turns: number }[]
}

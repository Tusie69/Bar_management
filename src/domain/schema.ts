/**
 * Row types mirroring database/verification/ddl_draft.sql (26 tables).
 *
 * - snake_case columns -> camelCase fields, DATETIME(3) UTC -> Date, DATE -> "YYYY-MM-DD".
 * - Secrets never leave the backend: `phone_ciphertext`, `phone_hmac`,
 *   `password_hash`, `token_hash`, `request_hash` are intentionally absent from
 *   these client-side types. The mock server keeps its own private copy.
 * - This file documents the draft; it does NOT create or change any schema.
 */
import type { BusinessDate } from "@/lib/time"
import type {
  AllocationKind,
  AllocationReleaseReason,
  ContactAttemptChannel,
  ContactOutcome,
  CustomerStatus,
  DeadlineBasis,
  HoldKind,
  HoldReleaseReason,
  HoldStatus,
  ReservationCloseReason,
  ReservationHoldPolicy,
  ReservationStatus,
  RoleCode,
  TableKind,
  TableStatus,
  VisitEndReason,
  VisitOrigin,
  WaitlistChannel,
  WaitlistCloseReason,
  WaitlistKind,
  WaitlistPreferenceMode,
  WaitlistStatus,
} from "./enums"

type Id = number
type Versioned = { version: number }

/* ---------------- Identity ---------------- */

export interface OrganizationRow extends Versioned {
  id: Id
  code: string
  name: string
  status: "ACTIVE" | "SUSPENDED" | "CLOSED"
  createdAt: Date
  updatedAt: Date
}

export interface UserRow extends Versioned {
  id: Id
  username: string
  displayName: string
  status: "ACTIVE" | "DISABLED"
  lastLoginAt: Date | null
}

export interface MembershipRow extends Versioned {
  id: Id
  organizationId: Id
  userId: Id
  status: "ACTIVE" | "SUSPENDED" | "ENDED"
  joinedAt: Date
  endedAt: Date | null
}

export interface RoleRow {
  id: Id
  code: RoleCode
  name: string
  isSystem: boolean
}

export interface PermissionRow {
  id: Id
  code: string
  description: string
  isSensitive: boolean
}

export interface RolePermissionRow {
  roleId: Id
  permissionId: Id
}

export interface MembershipRoleRow {
  id: Id
  organizationId: Id
  membershipId: Id
  roleId: Id
  venueId: Id | null // null = all venues of the organization
  grantedByUserId: Id | null
  grantedAt: Date
  revokedByUserId: Id | null
  revokedAt: Date | null
}

export interface AuthSessionRow {
  id: Id
  organizationId: Id
  membershipId: Id
  userId: Id
  deviceLabel: string | null
  createdAt: Date
  lastSeenAt: Date | null
  expiresAt: Date
  revokedAt: Date | null
  revokeReason: string | null
}

/* ---------------- Venue / floorplan ---------------- */

export interface VenueRow extends Versioned {
  id: Id
  organizationId: Id
  code: string
  name: string
  status: "ACTIVE" | "INACTIVE"
  timezone: string
  businessDayStartLocal: string // "17:00:00"
  businessDayCutoffLocal: string // "05:00:00"
  lateWarningMinutes: number
  noShowWarningMinutes: number
  waitlistHoldDefaultMinutes: number
  waitlistClaimLeaseSeconds: number
  reservationHoldPolicy: ReservationHoldPolicy
  reservationWindowMinutes: number | null
  groupSymbolCount: number
  changeSeq: number
}

export interface FloorRow extends Versioned {
  id: Id
  organizationId: Id
  venueId: Id
  code: string
  name: string
  sortOrder: number
  isActive: boolean
}

export interface ZoneRow extends Versioned {
  id: Id
  organizationId: Id
  venueId: Id
  floorId: Id | null
  code: string
  name: string
  isBookable: boolean
  isWaitingArea: boolean
  sortOrder: number
  isActive: boolean
}

export interface DiningTableRow extends Versioned {
  id: Id
  organizationId: Id
  venueId: Id
  zoneId: Id
  code: string
  displayName: string
  kind: TableKind
  capacity: number
  seqNo: number | null
  isSpare: boolean
  status: TableStatus
  posX: number | null
  posY: number | null
  width: number | null
  height: number | null
  rotationDeg: number
}

export interface TableCombinationRow extends Versioned {
  id: Id
  organizationId: Id
  venueId: Id
  code: string
  displayName: string
  isActive: boolean
}

export interface TableCombinationMemberRow {
  venueId: Id
  combinationId: Id
  tableId: Id
}

/* ---------------- Customer / booking ---------------- */

export interface CustomerRow extends Versioned {
  id: Id
  organizationId: Id
  displayName: string | null
  nameSearch: string | null
  phoneLast3: string | null
  status: CustomerStatus
  mergedIntoCustomerId: Id | null
  anonymizedAt: Date | null
  createdAt: Date
}

export interface BookingSourceRow {
  id: Id
  organizationId: Id
  code: string
  name: string
  isActive: boolean
  sortOrder: number
}

export interface ReservationRow extends Versioned {
  id: Id
  organizationId: Id
  venueId: Id
  customerId: Id | null
  contactName: string | null
  contactNameSearch: string | null
  sourceId: Id
  partySize: number
  expectedAt: Date
  businessDate: BusinessDate
  status: ReservationStatus
  note: string | null
  visitId: Id | null
  checkedInAt: Date | null
  checkedInByUserId: Id | null
  closedAt: Date | null
  closedByUserId: Id | null
  closeReasonCode: ReservationCloseReason | null
  closeReasonNote: string | null
  lateWarnedAt: Date | null
  noShowWarnedAt: Date | null
  createdByUserId: Id
  createdAt: Date
  updatedByUserId: Id | null
  updatedAt: Date
}

export interface VisitRow extends Versioned {
  id: Id
  organizationId: Id
  venueId: Id
  origin: VisitOrigin
  customerId: Id | null
  contactName: string | null
  guestCount: number
  startedAt: Date
  businessDate: BusinessDate
  endedAt: Date | null
  endedByUserId: Id | null
  endReason: VisitEndReason | null
  mergedIntoVisitId: Id | null
  paidMarkedAt: Date | null
  paidMarkedByUserId: Id | null
  note: string | null
  createdByUserId: Id
  createdAt: Date
}

/* ---------------- Waitlist ---------------- */

export interface WaitlistEntryRow extends Versioned {
  id: Id
  organizationId: Id
  venueId: Id
  kind: WaitlistKind
  priorityClass: 1 | 2 // generated: ADVANCE_RESERVATION = 1, WALK_IN = 2
  reservationId: Id | null
  customerId: Id | null
  contactName: string | null
  partySize: number | null
  preferenceMode: WaitlistPreferenceMode
  contactChannel: WaitlistChannel
  businessDate: BusinessDate
  queuedAt: Date
  status: WaitlistStatus
  claimedByUserId: Id | null
  claimedAt: Date | null
  claimExpiresAt: Date | null
  offeredAt: Date | null
  visitId: Id | null
  closedAt: Date | null
  closedByUserId: Id | null
  closeReasonCode: WaitlistCloseReason | null
  closeReasonNote: string | null
  note: string | null
  createdByUserId: Id
  createdAt: Date
}

export interface WaitlistTablePreferenceRow {
  id: Id
  organizationId: Id
  venueId: Id
  entryId: Id
  prefRank: number // 1..20
  tableId: Id | null
  combinationId: Id | null
  zoneId: Id | null
}

export interface WaitlistContactAttemptRow {
  id: Id
  organizationId: Id
  venueId: Id
  entryId: Id
  attemptNo: number
  attemptedByUserId: Id
  channel: ContactAttemptChannel
  startedAt: Date
  endedAt: Date | null
  outcome: ContactOutcome
  offeredTableIds: Id[] | null
  note: string | null
}

/* ---------------- Floor operations ---------------- */

export interface TableHoldRow extends Versioned {
  id: Id
  organizationId: Id
  venueId: Id
  holdKind: HoldKind
  reservationId: Id | null
  waitlistEntryId: Id | null
  status: HoldStatus
  startsAt: Date
  customerConfirmedAt: Date | null
  deadlineAt: Date | null
  deadlineBasis: DeadlineBasis | null
  defaultMinutesSnapshot: number | null
  deadlineSetByUserId: Id | null
  deadlineReason: string | null
  deadlineWarnedAt: Date | null
  convertedAt: Date | null
  convertedVisitId: Id | null
  releasedAt: Date | null
  releasedByUserId: Id | null
  releaseReasonCode: HoldReleaseReason | null
  releaseReasonNote: string | null
  createdByUserId: Id
  createdAt: Date
}

export interface TableGroupRow {
  id: Id
  organizationId: Id
  venueId: Id
  businessDate: BusinessDate
  symbolNo: number // 1..group_symbol_count, unique among undissolved groups
  formedAt: Date
  formedByUserId: Id
  dissolvedAt: Date | null
  dissolvedByUserId: Id | null
}

/** Append-only. A row is never updated except to set released_* once. */
export interface TableAllocationRow {
  id: Id
  organizationId: Id
  venueId: Id
  tableId: Id
  kind: AllocationKind
  holdId: Id | null
  visitId: Id | null
  groupId: Id | null
  startsAt: Date
  plannedUntil: Date | null // NULL under SEQUENTIAL policy = open claim
  businessDate: BusinessDate
  releasedAt: Date | null
  releasedByUserId: Id | null
  releaseReason: AllocationReleaseReason | null
  createdByUserId: Id
  createdAt: Date
}

/* ---------------- Platform ---------------- */

export interface OperationLogRow {
  id: Id
  organizationId: Id
  venueId: Id | null
  changeSeq: number | null
  occurredAt: Date
  actorKind: "USER" | "SYSTEM"
  actorUserId: Id | null
  actorMembershipId: Id | null
  authSessionId: Id | null
  requestId: string | null
  idempotencyKey: string | null
  action: string
  entityType: string
  entityId: Id
  entityVersionBefore: number | null
  entityVersionAfter: number | null
  changes: unknown[] | null
  reasonCode: string | null
  reasonNote: string | null
  isUndoable: boolean
  compensatesOperationId: Id | null
}

export interface IdempotencyKeyRow {
  organizationId: Id
  idemKey: string
  userId: Id
  endpoint: string
  responseStatus: number | null
  operationId: Id | null
  createdAt: Date
  expiresAt: Date // created_at + 48h
}

/** The 26 tables of the draft, for documentation and integration checklists. */
export const DDL_TABLES = [
  "organizations",
  "users",
  "memberships",
  "roles",
  "permissions",
  "role_permissions",
  "membership_roles",
  "auth_sessions",
  "venues",
  "floors",
  "zones",
  "dining_tables",
  "table_combinations",
  "table_combination_members",
  "customers",
  "booking_sources",
  "reservations",
  "visits",
  "waitlist_entries",
  "waitlist_table_preferences",
  "waitlist_contact_attempts",
  "table_holds",
  "table_groups",
  "table_allocations",
  "operation_log",
  "idempotency_keys",
] as const

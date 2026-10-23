/**
 * In-memory database for the mock backend. Shapes follow the DDL rows in
 * src/domain/schema.ts. Fields that only exist server-side (full phone) live
 * here and are never returned by the API except through phone:reveal.
 *
 * Everything is SYNTHETIC demo data (names, phones, history).
 */
import type {
  BookingSourceRow,
  CustomerRow,
  DiningTableRow,
  OperationLogRow,
  ReservationRow,
  TableAllocationRow,
  TableCombinationRow,
  TableGroupRow,
  TableHoldRow,
  VenueRow,
  VisitRow,
  WaitlistContactAttemptRow,
  WaitlistEntryRow,
  WaitlistTablePreferenceRow,
  ZoneRow,
} from "@/domain/schema"
import type { RoleCode } from "@/domain/enums"
import type { SeatingStyle } from "@/domain/venue-layout"

export interface MockUser {
  id: number
  displayName: string
  role: RoleCode
  deviceLabel: string
}

export type MockTable = DiningTableRow & { seating: SeatingStyle | "bar" }
export type MockCombination = TableCombinationRow & { members: number[]; pendingConfirmation: boolean }
export type MockCustomer = CustomerRow & { phoneE164: string | null; notes: string | null }
export type MockGroup = TableGroupRow & { version: number }
export type MockAllocation = TableAllocationRow & { version: number }
export type MockAttempt = WaitlistContactAttemptRow & { version: number }
export type MockPref = WaitlistTablePreferenceRow & { version: number }

export interface UndoEntry {
  col: CollectionName
  id: number
  before: unknown | undefined
  afterVersion: number
}

export interface MockOperation extends OperationLogRow {
  summary: string
  businessDate: string
  undo: UndoEntry[]
  compensatedBy: number | null
}

export interface Collections {
  venue: Map<number, VenueRow>
  zones: Map<number, ZoneRow>
  tables: Map<number, MockTable>
  combinations: Map<number, MockCombination>
  sources: Map<number, BookingSourceRow>
  customers: Map<number, MockCustomer>
  reservations: Map<number, ReservationRow>
  visits: Map<number, VisitRow>
  waitlist: Map<number, WaitlistEntryRow>
  prefs: Map<number, MockPref>
  attempts: Map<number, MockAttempt>
  holds: Map<number, TableHoldRow>
  groups: Map<number, MockGroup>
  allocations: Map<number, MockAllocation>
}

export type CollectionName = keyof Collections

export interface MockDb extends Collections {
  users: Map<number, MockUser>
  ops: MockOperation[]
  nextId: Record<CollectionName | "ops", number>
  revealLog: { userId: number; at: number }[]
}

export const ORG_ID = 1
export const VENUE_ID = 1
export const SYSTEM_USER_ID = 0

export function emptyDb(): MockDb {
  return {
    venue: new Map(),
    zones: new Map(),
    tables: new Map(),
    combinations: new Map(),
    sources: new Map(),
    customers: new Map(),
    reservations: new Map(),
    visits: new Map(),
    waitlist: new Map(),
    prefs: new Map(),
    attempts: new Map(),
    holds: new Map(),
    groups: new Map(),
    allocations: new Map(),
    users: new Map(),
    ops: [],
    nextId: {
      venue: 2,
      zones: 1,
      tables: 1,
      combinations: 1,
      sources: 1,
      customers: 1,
      reservations: 1,
      visits: 1,
      waitlist: 1,
      prefs: 1,
      attempts: 1,
      holds: 1,
      groups: 1,
      allocations: 1,
      ops: 1,
    },
    revealLog: [],
  }
}

export function allocId(db: MockDb, col: CollectionName | "ops"): number {
  const id = db.nextId[col]
  db.nextId[col] = id + 1
  return id
}

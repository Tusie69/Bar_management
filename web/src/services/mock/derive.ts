/**
 * Pure read-side derivations over the mock DB. These are the rules the real
 * backend must implement server-side (db05 §6.1 derived table state, db05 §2.1
 * BOOKED sub-states, availability per requested date/time, report counting).
 */
import { foldVietnamese } from "@/lib/text"
import { addDays, atBusinessTime, businessDateOf, fmtTime, MS, type BusinessDate } from "@/lib/time"
import type { BookingSourceCode } from "@/domain/enums"
import type {
  AllocationView,
  AvailabilityResult,
  AvailabilityStatus,
  BookedSubState,
  BookingWarning,
  Catalog,
  ClaimView,
  ContactAttemptView,
  CustomerProfile,
  CustomerSummary,
  FloorState,
  FloorTableState,
  OperationView,
  ReportQuery,
  ReportResult,
  ReservationView,
  ShiftOverview,
  TableLiveState,
  TableView,
  VenueConfig,
  VisitView,
  WaitlistEntryView,
} from "@/domain/models"
import type { ReservationRow, TableHoldRow, VenueRow, VisitRow, WaitlistEntryRow } from "@/domain/schema"
import type { ZoneCode } from "@/domain/venue-layout"
import { VENUE_ID, type MockAllocation, type MockCustomer, type MockDb, type MockOperation, type MockTable } from "./db"

export const venueOf = (db: MockDb): VenueRow => db.venue.get(VENUE_ID)!

export function venueConfig(db: MockDb): VenueConfig {
  const v = venueOf(db)
  return {
    id: v.id,
    version: v.version,
    name: v.name,
    timezone: v.timezone,
    businessDayStartLocal: v.businessDayStartLocal,
    businessDayCutoffLocal: v.businessDayCutoffLocal,
    lateWarningMinutes: v.lateWarningMinutes,
    noShowWarningMinutes: v.noShowWarningMinutes,
    waitlistHoldDefaultMinutes: v.waitlistHoldDefaultMinutes,
    waitlistClaimLeaseSeconds: v.waitlistClaimLeaseSeconds,
    reservationHoldPolicy: v.reservationHoldPolicy,
    reservationWindowMinutes: v.reservationWindowMinutes,
    groupSymbolCount: v.groupSymbolCount,
    changeSeq: v.changeSeq,
  }
}

export function zoneCodeOf(db: MockDb, t: MockTable): ZoneCode {
  return (db.zones.get(t.zoneId)?.code ?? "A") as ZoneCode
}

export function tableView(db: MockDb, t: MockTable): TableView {
  return {
    id: t.id,
    version: t.version,
    code: t.code,
    displayName: t.displayName,
    zoneId: t.zoneId,
    zoneCode: zoneCodeOf(db, t),
    kind: t.kind,
    capacity: t.capacity,
    seqNo: t.seqNo,
    isSpare: t.isSpare,
    status: t.status,
    x: t.posX ?? 0,
    y: t.posY ?? 0,
    w: t.width ?? 20,
    h: t.height ?? 20,
    seating: t.seating,
  }
}

export function catalog(db: MockDb): Catalog {
  return {
    venue: venueConfig(db),
    zones: [...db.zones.values()].map((z) => ({
      id: z.id,
      version: z.version,
      code: z.code as ZoneCode,
      name: z.name,
      isBookable: z.isBookable,
      isWaitingArea: z.isWaitingArea,
    })),
    tables: [...db.tables.values()].filter((t) => t.status !== "RETIRED").map((t) => tableView(db, t)),
    combinations: [...db.combinations.values()]
      .filter((c) => c.isActive)
      .map((c) => ({
        id: c.id,
        code: c.code,
        displayName: c.displayName,
        memberIds: c.members,
        capacity: c.members.reduce((sum, id) => sum + (db.tables.get(id)?.capacity ?? 0), 0),
        pendingConfirmation: c.pendingConfirmation,
      })),
    sources: [...db.sources.values()]
      .filter((s) => s.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((s) => ({ id: s.id, code: s.code as BookingSourceCode, name: s.name })),
  }
}

/* ---------------- claims ---------------- */

export const activeAllocations = (db: MockDb) => [...db.allocations.values()].filter((a) => a.releasedAt === null)

/** Allocations that block a table on business date `bd` (stale usage from earlier days included). */
export function blockingAllocations(
  db: MockDb,
  tableId: number,
  bd: BusinessDate,
  includeStale = true,
): MockAllocation[] {
  return activeAllocations(db).filter(
    (a) =>
      a.tableId === tableId && (a.businessDate === bd || (includeStale && a.kind === "USAGE" && a.businessDate < bd)),
  )
}

export function holdTableIds(db: MockDb, holdId: number): number[] {
  return activeAllocations(db)
    .filter((a) => a.holdId === holdId)
    .map((a) => a.tableId)
}

export function visitTableIds(db: MockDb, visitId: number): number[] {
  return activeAllocations(db)
    .filter((a) => a.visitId === visitId && a.kind === "USAGE")
    .map((a) => a.tableId)
}

export function groupSymbolNo(db: MockDb, groupId: number | null): number | null {
  if (!groupId) return null
  const g = db.groups.get(groupId)
  return g && !g.dissolvedAt ? g.symbolNo : null
}

export function activeReservationHold(db: MockDb, reservationId: number): TableHoldRow | null {
  for (const h of db.holds.values()) {
    if (h.status === "ACTIVE" && h.holdKind === "RESERVATION" && h.reservationId === reservationId) return h
  }
  return null
}

export function activeEntryForReservation(db: MockDb, reservationId: number): WaitlistEntryRow | null {
  for (const e of db.waitlist.values()) {
    if (e.reservationId === reservationId && ["WAITING", "CONTACTING", "OFFERED", "HOLD_ACTIVE"].includes(e.status))
      return e
  }
  return null
}

export function activeHoldForEntry(db: MockDb, entryId: number): TableHoldRow | null {
  for (const h of db.holds.values()) {
    if (h.status === "ACTIVE" && h.holdKind === "WAITLIST_OFFER" && h.waitlistEntryId === entryId) return h
  }
  return null
}

export function reservationWarning(
  venue: VenueRow,
  r: ReservationRow,
  now: Date,
): { warning: BookingWarning; minutesLate: number } {
  if (r.status !== "BOOKED") return { warning: null, minutesLate: 0 }
  const late = Math.floor((now.getTime() - r.expectedAt.getTime()) / MS.MIN)
  if (late >= venue.noShowWarningMinutes) return { warning: "noshow", minutesLate: late }
  if (late >= venue.lateWarningMinutes) return { warning: "late", minutesLate: late }
  return { warning: null, minutesLate: Math.max(0, late) }
}

const customerOf = (db: MockDb, id: number | null): MockCustomer | null => (id ? (db.customers.get(id) ?? null) : null)

function personName(db: MockDb, contactName: string | null, customerId: number | null, fallback: string) {
  return contactName ?? customerOf(db, customerId)?.displayName ?? fallback
}

function sourceCode(db: MockDb, sourceId: number): BookingSourceCode {
  return (db.sources.get(sourceId)?.code ?? "OTHER") as BookingSourceCode
}

/* ---------------- floor ---------------- */

export function floorState(db: MockDb, now: Date, selectedBusinessDate?: BusinessDate): FloorState {
  const venue = venueOf(db)
  const bd = selectedBusinessDate ?? businessDateOf(now)
  const tables: FloorTableState[] = []
  for (const t of db.tables.values()) {
    if (t.status === "RETIRED") continue
    const blocking = blockingAllocations(db, t.id, bd, false)
    const usage = blocking.find((a) => a.kind === "USAGE")
    let state: TableLiveState = t.status === "OUT_OF_SERVICE" ? "oos" : t.isSpare ? "spare" : "free"
    let claim: ClaimView | null = null
    let stale = false

    if (usage && usage.visitId) {
      const v = db.visits.get(usage.visitId)!
      state = "seated"
      stale = false
      claim = {
        kind: "visit",
        visitId: v.id,
        reservationId: findReservationForVisit(db, v.id),
        waitlistEntryId: null,
        holdId: null,
        displayName: personName(db, v.contactName, v.customerId, "Khách Walk-in"),
        phoneLast3: customerOf(db, v.customerId)?.phoneLast3 ?? null,
        partySize: v.guestCount,
        startsAt: v.startedAt,
        deadlineAt: null,
        paid: !!v.paidMarkedAt,
        origin: v.origin,
        tableIds: visitTableIds(db, v.id),
        groupId: usage.groupId,
        symbolNo: groupSymbolNo(db, usage.groupId),
        warning: null,
        minutesLate: 0,
        sourceCode: null,
        note: v.note,
        version: v.version,
      }
    } else {
      const holdAlloc = blocking.find((a) => a.kind === "HOLD" && a.businessDate === bd)
      const hold = holdAlloc?.holdId ? db.holds.get(holdAlloc.holdId) : undefined
      if (holdAlloc && hold && hold.status === "ACTIVE") {
        if (hold.holdKind === "WAITLIST_OFFER") {
          const e = db.waitlist.get(hold.waitlistEntryId!)!
          const overdue = !!hold.deadlineAt && now > hold.deadlineAt
          state = overdue ? "hold_overdue" : "hold"
          const res = e.reservationId ? db.reservations.get(e.reservationId) : undefined
          claim = {
            kind: "waitlist_hold",
            visitId: null,
            reservationId: e.reservationId,
            waitlistEntryId: e.id,
            holdId: hold.id,
            displayName: personName(
              db,
              res?.contactName ?? e.contactName,
              res?.customerId ?? e.customerId,
              "Khách chờ",
            ),
            phoneLast3: customerOf(db, res?.customerId ?? e.customerId)?.phoneLast3 ?? null,
            partySize: res?.partySize ?? e.partySize ?? 0,
            startsAt: hold.customerConfirmedAt ?? hold.startsAt,
            deadlineAt: hold.deadlineAt,
            paid: false,
            origin: null,
            tableIds: holdTableIds(db, hold.id),
            groupId: holdAlloc.groupId,
            symbolNo: groupSymbolNo(db, holdAlloc.groupId),
            warning: res ? reservationWarning(venue, res, now).warning : null,
            minutesLate: 0,
            sourceCode: null,
            note: e.note,
            version: hold.version,
          }
        } else if (hold.reservationId) {
          const r = db.reservations.get(hold.reservationId)!
          const w = reservationWarning(venue, r, now)
          state = w.warning === "noshow" ? "noshow" : w.warning === "late" ? "late" : "reserved"
          claim = {
            kind: "reservation",
            visitId: null,
            reservationId: r.id,
            waitlistEntryId: null,
            holdId: hold.id,
            displayName: personName(db, r.contactName, r.customerId, "Khách đặt"),
            phoneLast3: customerOf(db, r.customerId)?.phoneLast3 ?? null,
            partySize: r.partySize,
            startsAt: r.expectedAt,
            deadlineAt: null,
            paid: false,
            origin: null,
            tableIds: holdTableIds(db, hold.id),
            groupId: holdAlloc.groupId,
            symbolNo: groupSymbolNo(db, holdAlloc.groupId),
            warning: w.warning,
            minutesLate: w.minutesLate,
            sourceCode: sourceCode(db, r.sourceId),
            note: r.note,
            version: r.version,
          }
        }
      }
    }
    if (t.status === "OUT_OF_SERVICE") state = "oos"
    tables.push({ tableId: t.id, state, claim, staleFromPreviousDay: stale })
  }
  const live = activeAllocations(db).filter((a) => a.businessDate === bd)
  const groups = [...db.groups.values()]
    .filter((g) => !g.dissolvedAt)
    .map((g) => ({
      id: g.id,
      symbolNo: g.symbolNo,
      tableIds: live.filter((a) => a.groupId === g.id).map((a) => a.tableId),
    }))
    .filter((g) => g.tableIds.length > 1)
  return { at: now, businessDate: bd, tables, groups, changeSeq: venueOf(db).changeSeq }
}

function findReservationForVisit(db: MockDb, visitId: number): number | null {
  for (const r of db.reservations.values()) if (r.visitId === visitId) return r.id
  return null
}

/** Describe what holds a table, for conflict messages and availability reasons. */
export function describeAllocation(db: MockDb, a: MockAllocation): string {
  if (a.kind === "USAGE") return "đang có khách"
  const h = a.holdId ? db.holds.get(a.holdId) : undefined
  if (h?.holdKind === "WAITLIST_OFFER") return `đang giữ cho khách chờ (hạn ${fmtTime(h.deadlineAt)})`
  if (h?.reservationId) {
    const r = db.reservations.get(h.reservationId)
    return `đã giữ cho booking ${fmtTime(r?.expectedAt)}`
  }
  return "đang được giữ"
}

export function allocationWindow(db: MockDb, a: MockAllocation): { start: Date; end: Date | null } {
  if (a.kind === "USAGE") return { start: a.startsAt, end: null }
  const h = a.holdId ? db.holds.get(a.holdId) : undefined
  return { start: h?.startsAt ?? a.startsAt, end: a.plannedUntil }
}

export function blocksAt(db: MockDb, a: MockAllocation, at: Date): boolean {
  const venue = venueOf(db)
  if (venue.reservationHoldPolicy === "SEQUENTIAL") return true
  const win = (venue.reservationWindowMinutes ?? 120) * MS.MIN
  const { start, end } = allocationWindow(db, a)
  const reqStart = at.getTime()
  const reqEnd = reqStart + win
  const claimEnd = end ? end.getTime() : Number.POSITIVE_INFINITY
  return reqStart < claimEnd && start.getTime() < reqEnd
}

export function availability(db: MockDb, now: Date, at: Date, partySize: number): AvailabilityResult {
  const venue = venueOf(db)
  const bd = businessDateOf(at)
  const isPast = at.getTime() < now.getTime() - 5 * MS.MIN
  const statusOf = new Map<number, { status: AvailabilityStatus; reason: string; claimStartsAt: Date | null }>()
  for (const t of db.tables.values()) {
    if (t.status === "RETIRED") continue
    const zone = db.zones.get(t.zoneId)!
    let status: AvailabilityStatus = "available"
    let reason = "Trống tại thời điểm này"
    let claimStartsAt: Date | null = null
    // Future dates only see their own claims: current occupancy says nothing about tomorrow.
    const blocking = blockingAllocations(db, t.id, bd, bd === businessDateOf(now)).filter((a) => blocksAt(db, a, at))
    if (isPast) {
      status = "past"
      reason = "Thời điểm đã qua"
    } else if (t.status === "OUT_OF_SERVICE") {
      status = "oos"
      reason = "Ngưng phục vụ"
    } else if (!zone.isBookable) {
      status = "not_bookable"
      reason = `${zone.name} là khu chờ, không nhận đặt`
    } else if (blocking.length > 0) {
      const a = blocking[0]
      if (a.kind === "USAGE") {
        status = "occupied_unknown_end"
        reason = "Đang có khách, chưa rõ giờ rời"
        claimStartsAt = a.startsAt
      } else {
        status = "reserved"
        reason = `Đã ${describeAllocation(db, a).replace(/^đã /, "")}`
        claimStartsAt = allocationWindow(db, a).start
      }
    } else if (t.isSpare) {
      status = "spare"
      reason = "Bàn sơ cua, cần Chủ quán duyệt"
    } else if (t.capacity < partySize) {
      status = "too_small"
      reason = `Sức chứa ${t.capacity} < ${partySize} khách`
    }
    statusOf.set(t.id, { status, reason, claimStartsAt })
  }
  const combinations = [...db.combinations.values()]
    .filter((c) => c.isActive)
    .map((c) => {
      const capacity = c.members.reduce((s, id) => s + (db.tables.get(id)?.capacity ?? 0), 0)
      const blocked = c.members
        .map((id) => statusOf.get(id))
        .find((s) => s && s.status !== "available" && s.status !== "too_small")
      const available = !blocked && capacity >= partySize
      return {
        combinationId: c.id,
        capacity,
        available,
        reason: blocked
          ? blocked.reason
          : capacity < partySize
            ? `Sức chứa ${capacity} < ${partySize}`
            : `Đủ ${capacity} chỗ`,
      }
    })
  return {
    at,
    businessDate: bd,
    partySize,
    policy: venue.reservationHoldPolicy,
    tables: [...statusOf.entries()].map(([tableId, s]) => ({ tableId, ...s })),
    combinations,
  }
}

export function allocationViews(db: MockDb, bd: BusinessDate, now: Date, tableId?: number): AllocationView[] {
  const venue = venueOf(db)
  return [...db.allocations.values()]
    .filter((a) => a.businessDate === bd && (tableId === undefined || a.tableId === tableId))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id - b.id)
    .map((a) => {
      const g = a.groupId ? db.groups.get(a.groupId) : undefined
      const base = {
        allocationId: a.id,
        tableId: a.tableId,
        kind: a.kind,
        releasedAt: a.releasedAt,
        releaseReason: a.releaseReason,
        symbolNo: g?.symbolNo ?? null,
      }
      if (a.visitId) {
        const v = db.visits.get(a.visitId)
        return {
          ...base,
          holdKind: null,
          reservationId: v ? findReservationForVisit(db, v.id) : null,
          visitId: a.visitId,
          waitlistEntryId: null,
          startsAt: a.startsAt,
          deadlineAt: null,
          name: v ? personName(db, v.contactName, v.customerId, "Khách Walk-in") : "Khách",
          partySize: v?.guestCount ?? null,
          warning: null,
        }
      }
      const h = a.holdId ? db.holds.get(a.holdId) : undefined
      if (h?.holdKind === "WAITLIST_OFFER") {
        const e = db.waitlist.get(h.waitlistEntryId!)
        const r = e?.reservationId ? db.reservations.get(e.reservationId) : undefined
        return {
          ...base,
          holdKind: "WAITLIST_OFFER" as const,
          reservationId: e?.reservationId ?? null,
          visitId: null,
          waitlistEntryId: e?.id ?? null,
          startsAt: h.customerConfirmedAt ?? h.startsAt,
          deadlineAt: h.deadlineAt,
          name: personName(
            db,
            r?.contactName ?? e?.contactName ?? null,
            r?.customerId ?? e?.customerId ?? null,
            "Khách chờ",
          ),
          partySize: r?.partySize ?? e?.partySize ?? null,
          warning: null,
        }
      }
      const r = h?.reservationId ? db.reservations.get(h.reservationId) : undefined
      return {
        ...base,
        holdKind: "RESERVATION" as const,
        reservationId: r?.id ?? null,
        visitId: null,
        waitlistEntryId: null,
        startsAt: h?.startsAt ?? a.startsAt,
        deadlineAt: null,
        name: personName(db, r?.contactName ?? null, r?.customerId ?? null, "Khách đặt"),
        partySize: r?.partySize ?? null,
        warning: r && a.releasedAt === null ? reservationWarning(venue, r, now).warning : null,
      }
    })
}

/* ---------------- views ---------------- */

export function reservationView(db: MockDb, r: ReservationRow, now: Date): ReservationView {
  const venue = venueOf(db)
  const hold = activeReservationHold(db, r.id)
  const entry = activeEntryForReservation(db, r.id)
  const offerHold = entry ? activeHoldForEntry(db, entry.id) : null
  const effectiveHold = hold ?? offerHold
  const tableIds = effectiveHold ? holdTableIds(db, effectiveHold.id) : r.visitId ? visitTableIds(db, r.visitId) : []
  const groupAlloc = effectiveHold
    ? activeAllocations(db).find((a) => a.holdId === effectiveHold.id && a.groupId)
    : r.visitId
      ? activeAllocations(db).find((a) => a.visitId === r.visitId && a.groupId)
      : undefined
  let subState: BookedSubState | null = null
  if (r.status === "BOOKED") subState = effectiveHold ? "DANG_GIU_BAN" : entry ? "CHO_BAN" : "CHO_PHAN_BAN"
  const w = reservationWarning(venue, r, now)
  const creator = db.users.get(r.createdByUserId)
  return {
    id: r.id,
    version: r.version,
    customerId: r.customerId,
    displayName: personName(db, r.contactName, r.customerId, "Khách đặt"),
    phoneLast3: customerOf(db, r.customerId)?.phoneLast3 ?? null,
    partySize: r.partySize,
    expectedAt: r.expectedAt,
    businessDate: r.businessDate,
    status: r.status,
    sourceCode: sourceCode(db, r.sourceId),
    note: r.note,
    tableIds,
    holdId: effectiveHold?.id ?? null,
    symbolNo: groupSymbolNo(db, groupAlloc?.groupId ?? null),
    subState,
    warning: w.warning,
    minutesLate: w.minutesLate,
    waitlistEntryId: entry?.id ?? null,
    visitId: r.visitId,
    checkedInAt: r.checkedInAt,
    closedAt: r.closedAt,
    closeReasonCode: r.closeReasonCode,
    closeReasonNote: r.closeReasonNote,
    createdAt: r.createdAt,
    createdByName: creator?.displayName ?? "Hệ thống",
  }
}

export function visitView(db: MockDb, v: VisitRow): VisitView {
  const allocs = [...db.allocations.values()].filter((a) => a.visitId === v.id)
  const active = allocs.filter((a) => a.releasedAt === null)
  const lastTables = active.length ? active : allocs.filter((a) => a.releaseReason === "GUEST_LEFT")
  const groupId = active.find((a) => a.groupId)?.groupId ?? null
  return {
    id: v.id,
    version: v.version,
    origin: v.origin,
    customerId: v.customerId,
    displayName: personName(db, v.contactName, v.customerId, "Khách Walk-in"),
    phoneLast3: customerOf(db, v.customerId)?.phoneLast3 ?? null,
    guestCount: v.guestCount,
    startedAt: v.startedAt,
    endedAt: v.endedAt,
    endReason: v.endReason,
    paidMarkedAt: v.paidMarkedAt,
    tableIds: [...new Set(lastTables.map((a) => a.tableId))],
    groupId,
    symbolNo: groupSymbolNo(db, groupId),
    reservationId: findReservationForVisit(db, v.id),
    businessDate: v.businessDate,
    note: v.note,
  }
}

export function waitlistView(db: MockDb, e: WaitlistEntryRow, now: Date): WaitlistEntryView {
  const res = e.reservationId ? db.reservations.get(e.reservationId) : undefined
  const hold = activeHoldForEntry(db, e.id)
  const attempts: ContactAttemptView[] = [...db.attempts.values()]
    .filter((a) => a.entryId === e.id)
    .sort((a, b) => a.attemptNo - b.attemptNo)
    .map((a) => ({
      id: a.id,
      attemptNo: a.attemptNo,
      byName: db.users.get(a.attemptedByUserId)?.displayName ?? "?",
      channel: a.channel,
      startedAt: a.startedAt,
      outcome: a.outcome,
      offeredTableIds: a.offeredTableIds ?? [],
      note: a.note,
    }))
  const prefs = [...db.prefs.values()]
    .filter((p) => p.entryId === e.id)
    .sort((a, b) => a.prefRank - b.prefRank)
    .map((p) => {
      const t = p.tableId ? db.tables.get(p.tableId) : undefined
      const z = p.zoneId ? db.zones.get(p.zoneId) : undefined
      const c = p.combinationId ? db.combinations.get(p.combinationId) : undefined
      return {
        rank: p.prefRank,
        tableId: p.tableId,
        combinationId: p.combinationId,
        zoneCode: (z?.code ?? null) as ZoneCode | null,
        label: t ? t.code : z ? z.name : c ? c.code : "?",
      }
    })
  const claimValid = e.status === "CONTACTING" && e.claimExpiresAt && e.claimExpiresAt > now
  const lastAttempt = attempts[attempts.length - 1]
  return {
    id: e.id,
    version: e.version,
    kind: e.kind,
    displayName: personName(db, res?.contactName ?? e.contactName, res?.customerId ?? e.customerId, "Khách chờ"),
    phoneLast3: customerOf(db, res?.customerId ?? e.customerId)?.phoneLast3 ?? null,
    customerId: res?.customerId ?? e.customerId,
    partySize: res?.partySize ?? e.partySize ?? 0,
    preferenceMode: e.preferenceMode,
    preferences: prefs,
    channel: e.contactChannel,
    businessDate: e.businessDate,
    queuedAt: e.queuedAt,
    status: e.status,
    claimedBy:
      claimValid && e.claimedByUserId
        ? { userId: e.claimedByUserId, name: db.users.get(e.claimedByUserId)?.displayName ?? "?" }
        : null,
    claimExpiresAt: claimValid ? e.claimExpiresAt : null,
    offeredAt: e.offeredAt,
    hold: hold
      ? {
          id: hold.id,
          version: hold.version,
          tableIds: holdTableIds(db, hold.id),
          confirmedAt: hold.customerConfirmedAt ?? hold.startsAt,
          deadlineAt: hold.deadlineAt!,
          basis: hold.deadlineBasis ?? "DEFAULT",
          overdue: !!hold.deadlineAt && now > hold.deadlineAt,
        }
      : null,
    reservationId: e.reservationId,
    reservationExpectedAt: res?.expectedAt ?? null,
    attempts,
    note: e.note,
    callbackRequested: lastAttempt?.outcome === "CALLBACK_REQUESTED" && ["WAITING", "CONTACTING"].includes(e.status),
    closedAt: e.closedAt,
  }
}

export function maskPhone(last3: string | null): string | null {
  return last3 ? `*******${last3}` : null
}

export function customerSummary(db: MockDb, c: MockCustomer): CustomerSummary {
  const visits = [...db.visits.values()].filter((v) => v.customerId === c.id)
  const last = visits.reduce<Date | null>((acc, v) => (!acc || v.startedAt > acc ? v.startedAt : acc), null)
  return {
    id: c.id,
    displayName: c.displayName ?? "Khách ẩn danh",
    phoneLast3: c.phoneLast3,
    phoneMasked: maskPhone(c.phoneLast3),
    visitCount: visits.length,
    lastVisitAt: last,
  }
}

export function customerProfile(db: MockDb, c: MockCustomer, now: Date): CustomerProfile {
  const summary = customerSummary(db, c)
  const visits = [...db.visits.values()]
    .filter((v) => v.customerId === c.id)
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
  const reservations = [...db.reservations.values()]
    .filter((r) => r.customerId === c.id)
    .sort((a, b) => b.expectedAt.getTime() - a.expectedAt.getTime())
  const bdNow = businessDateOf(now)
  const within = (days: number) => visits.filter((v) => v.businessDate > addDays(bdNow, -days)).length
  const months: { month: string; count: number }[] = []
  const nowParts = bdNow.split("-").map(Number)
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(nowParts[0], nowParts[1] - 1 - i, 1))
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
    months.push({ month: key, count: visits.filter((v) => v.businessDate.startsWith(key)).length })
  }
  return {
    ...summary,
    version: c.version,
    notes: c.notes,
    createdAt: c.createdAt,
    visits30d: within(30),
    visits90d: within(90),
    averageParty: visits.length
      ? Math.round((visits.reduce((s, v) => s + v.guestCount, 0) / visits.length) * 10) / 10
      : null,
    visitsByMonth: months,
    visits: visits.slice(0, 25).map((v) => visitView(db, v)),
    reservations: reservations.slice(0, 25).map((r) => reservationView(db, r, now)),
  }
}

export function searchMatches(db: MockDb, q: string) {
  const query = q.trim()
  const digits = /^\d{3}$/.test(query)
  const folded = foldVietnamese(query)
  return {
    customer: (c: MockCustomer) => (digits ? c.phoneLast3 === query : !!c.nameSearch?.includes(folded)),
    reservation: (r: ReservationRow) =>
      digits ? customerOf(db, r.customerId)?.phoneLast3 === query : !!(r.contactNameSearch ?? "").includes(folded),
    digits,
  }
}

/* ---------------- operations ---------------- */

const ACTION_LABEL: Record<string, string> = {
  RESERVATION_CREATED: "Tạo booking",
  RESERVATION_UPDATED: "Sửa booking",
  TABLE_ASSIGNED: "Phân bàn",
  RESERVATION_CANCELLED: "Hủy booking",
  RESERVATION_NO_SHOW: "Xác nhận không đến",
  RESERVATION_LATE_WARNING: "Cảnh báo đến muộn",
  RESERVATION_NO_SHOW_WARNING: "Cảnh báo không đến",
  WAITLIST_ADDED: "Thêm danh sách chờ",
  WAITLIST_CLAIMED: "Nhận liên hệ",
  WAITLIST_CLAIM_RELEASED: "Thả liên hệ",
  WAITLIST_CONTACT_RECORDED: "Ghi kết quả liên hệ",
  WAITLIST_CANCELLED: "Hủy mục chờ",
  WAITLIST_SEATED: "Khách chờ nhận bàn",
  HOLD_ACCEPTED: "Giữ bàn cho khách chờ",
  HOLD_DEADLINE_SET: "Gia hạn giữ bàn",
  HOLD_DEADLINE_WARNING: "Quá hạn giữ bàn",
  HOLD_RELEASED: "Nhả giữ bàn",
  TABLE_MOVED: "Đổi bàn",
  CHECKED_IN: "Check-in",
  WALKIN_SEATED: "Nhận Walk-in",
  VISIT_ENDED: "Nhả bàn",
  VISIT_MARKED_PAID: "Đã thanh toán",
  VISIT_UPDATED: "Cập nhật lượt ghé",
  TABLES_COMBINED: "Ghép bàn",
  TABLES_SPLIT: "Tách bàn",
  UNDO_APPLIED: "Hoàn tác",
  REDO_APPLIED: "Làm lại",
  VENUE_CONFIG_UPDATED: "Cấu hình quán",
  TABLE_CONFIG_UPDATED: "Cấu hình bàn",
  ZONE_CONFIG_UPDATED: "Cấu hình khu",
  CUSTOMER_PHONE_REVEALED: "Xem SĐT đầy đủ",
  CUSTOMER_NOTES_UPDATED: "Sửa ghi chú khách",
}

export function operationView(db: MockDb, op: MockOperation, sessionUserId: number): OperationView {
  const user = op.actorUserId ? db.users.get(op.actorUserId) : undefined
  return {
    id: op.id,
    occurredAt: op.occurredAt,
    actorKind: op.actorKind,
    actorName: user?.displayName ?? "Hệ thống",
    deviceLabel: user?.deviceLabel ?? null,
    action: op.action,
    actionLabel: ACTION_LABEL[op.action] ?? op.action,
    entityType: op.entityType,
    entityId: op.entityId,
    summary: op.summary,
    isUndoable: op.isUndoable,
    compensatesOperationId: op.compensatesOperationId,
    compensatedBy: op.compensatedBy,
    mine: op.actorUserId === sessionUserId,
    reasonCode: op.reasonCode,
    businessDate: op.businessDate,
  }
}

/* ---------------- overview & reports ---------------- */

export function shiftOverview(db: MockDb, now: Date): ShiftOverview {
  const bd = businessDateOf(now)
  const floor = floorState(db, now)
  const reservations = [...db.reservations.values()].filter((r) => r.businessDate === bd)
  const views = reservations.map((r) => reservationView(db, r, now))
  const activeVisits = [...db.visits.values()].filter((v) => v.endedAt === null)
  const visitsTonight = [...db.visits.values()].filter((v) => v.businessDate === bd)
  const stateOf = (id: number) => floor.tables.find((t) => t.tableId === id)?.state
  const tables = [...db.tables.values()].filter((t) => t.status !== "RETIRED")
  const inUse = (t: MockTable) => stateOf(t.id) === "seated"
  const waitActive = [...db.waitlist.values()].filter(
    (e) => e.businessDate === bd && ["WAITING", "CONTACTING", "OFFERED", "HOLD_ACTIVE"].includes(e.status),
  )
  const hours = ["17", "18", "19", "20", "21", "22", "23", "00", "01", "02", "03", "04"]
  const byHour = hours.map((h) => {
    const start = atBusinessTime(bd, `${h}:00`).getTime()
    const end = start + MS.HOUR
    return {
      hour: h,
      expected: reservations
        .filter((r) => r.status !== "CANCELLED" && r.expectedAt.getTime() >= start && r.expectedAt.getTime() < end)
        .reduce((s, r) => s + r.partySize, 0),
      seated: visitsTonight
        .filter((v) => v.startedAt.getTime() >= start && v.startedAt.getTime() < end)
        .reduce((s, v) => s + v.guestCount, 0),
    }
  })
  const zoneCodes: ZoneCode[] = ["A", "B", "C", "BAR"]
  return {
    businessDate: bd,
    reservationsTotal: reservations.filter((r) => r.status !== "CANCELLED").length,
    reservationsUpcoming60: reservations.filter(
      (r) => r.status === "BOOKED" && r.expectedAt >= now && r.expectedAt.getTime() <= now.getTime() + MS.HOUR,
    ).length,
    reservationsUnassigned: views.filter((v) => v.subState === "CHO_PHAN_BAN" || v.subState === "CHO_BAN").length,
    checkedInReservations: reservations.filter((r) => r.status === "CHECKED_IN").length,
    seatedGuests: activeVisits.reduce((s, v) => s + v.guestCount, 0),
    seatedVisits: activeVisits.length,
    visitsTonight: visitsTonight.length,
    guestsTonight: visitsTonight.reduce((s, v) => s + v.guestCount, 0),
    tablesInUse: tables.filter((t) => t.kind === "TABLE" && inUse(t)).length,
    tablesTotal: tables.filter((t) => t.kind === "TABLE").length,
    barSeatsInUse: tables.filter((t) => t.kind === "BAR_SEAT" && inUse(t)).length,
    barSeatsTotal: tables.filter((t) => t.kind === "BAR_SEAT").length,
    attention:
      floor.tables.filter((t) => ["late", "noshow", "hold_overdue"].includes(t.state) || t.staleFromPreviousDay)
        .length + views.filter((v) => v.status === "BOOKED" && v.warning && v.tableIds.length === 0).length,
    waitlistAdvance: waitActive.filter((e) => e.kind === "ADVANCE_RESERVATION").length,
    waitlistWalkIn: waitActive.filter((e) => e.kind === "WALK_IN").length,
    byHour,
    byZone: zoneCodes.map((code) => {
      const zone = [...db.zones.values()].find((z) => z.code === code)!
      const zt = tables.filter((t) => t.zoneId === zone.id)
      return { zone: code, name: zone.name, inUse: zt.filter(inUse).length, total: zt.length }
    }),
  }
}

/**
 * Counting rules (TH §4, db05 §8):
 * - Visits and guests come only from `visits` (a party on 3 tables is 1 visit, 8 guests).
 * - Table turns = distinct (visit, table) pairs from USAGE allocations.
 * - Combines / moves / splits / releases come from allocation & visit history.
 */
export function report(db: MockDb, q: ReportQuery): ReportResult {
  const inRange = (bd: BusinessDate) => bd >= q.from && bd <= q.to
  const tableInZone = (tableId: number) => {
    if (q.zone === "ALL") return true
    const t = db.tables.get(tableId)
    return !!t && zoneCodeOf(db, t) === q.zone
  }
  const usage = [...db.allocations.values()].filter(
    (a) => a.kind === "USAGE" && a.visitId && inRange(a.businessDate) && tableInZone(a.tableId),
  )
  const visitIds = new Set(usage.map((a) => a.visitId!))
  const visits = [...visitIds].map((id) => db.visits.get(id)!).filter(Boolean)
  const pairs = new Set(usage.map((a) => `${a.visitId}:${a.tableId}`))
  const byDateMap = new Map<BusinessDate, { visits: number; guests: number; turns: Set<string> }>()
  for (let d = q.from; d <= q.to; d = addDays(d, 1)) byDateMap.set(d, { visits: 0, guests: 0, turns: new Set() })
  for (const v of visits) {
    const row = byDateMap.get(v.businessDate)
    if (row) {
      row.visits += 1
      row.guests += v.guestCount
    }
  }
  for (const a of usage) byDateMap.get(a.businessDate)?.turns.add(`${a.visitId}:${a.tableId}`)
  const byTableMap = new Map<number, Set<number>>()
  for (const a of usage) {
    if (!byTableMap.has(a.tableId)) byTableMap.set(a.tableId, new Set())
    byTableMap.get(a.tableId)!.add(a.visitId!)
  }
  const released = [...db.allocations.values()].filter(
    (a) => a.releasedAt && inRange(a.businessDate) && tableInZone(a.tableId),
  )
  const groups = [...db.groups.values()].filter(
    (g) =>
      inRange(g.businessDate) &&
      [...db.allocations.values()].some((a) => a.groupId === g.id && a.kind === "USAGE" && tableInZone(a.tableId)),
  )
  return {
    query: q,
    visits: visits.length,
    guests: visits.reduce((s, v) => s + v.guestCount, 0),
    tableTurns: pairs.size,
    combines: groups.length,
    moves: released.filter((a) => a.releaseReason === "MOVED").length,
    splits: released.filter((a) => a.releaseReason === "SPLIT").length,
    releases: visits.filter((v) => v.endReason === "GUEST_LEFT").length,
    byDate: [...byDateMap.entries()].map(([date, r]) => ({
      date,
      visits: r.visits,
      guests: r.guests,
      turns: r.turns.size,
    })),
    byTable: [...byTableMap.entries()]
      .map(([tableId, set]) => {
        const t = db.tables.get(tableId)!
        return { tableId, code: t.code, zone: zoneCodeOf(db, t), turns: set.size }
      })
      .sort((a, b) => b.turns - a.turns),
  }
}

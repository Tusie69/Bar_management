/**
 * MockGamApi: an in-memory implementation of GamApi that enforces the
 * business rules from database/05, 06, 07, 08, 09 so the prototype behaves
 * like the planned backend. Nothing here talks to a network or to MySQL.
 *
 * What is simulated (and labelled as such in the UI):
 * - latency, the change feed / realtime push, a second device ("iPad cửa"),
 *   the 30-second system job that raises late / no-show / hold warnings.
 */
import { foldVietnamese, NOTE_PHONE_ERROR, noteHasPhoneNumber, normalizePhone } from "@/lib/text"
import { addDays, businessDateOf, fmtTime, MS, type BusinessDate } from "@/lib/time"
import { roleCan, PERMISSION_LABEL, type Permission } from "@/domain/access"
import {
  ROLE_LABEL,
  type AllocationReleaseReason,
  type HoldReleaseReason,
  type ReservationCloseReason,
  type WaitlistCloseReason,
} from "@/domain/enums"
import type {
  ChangeEvent,
  CustomerSummary,
  MutationResult,
  PhoneReveal,
  ReportQuery,
  ReservationView,
  SessionUser,
} from "@/domain/models"
import type { ReservationRow, TableHoldRow, VisitRow, WaitlistEntryRow } from "@/domain/schema"
import { symbolByNo } from "@/domain/symbols"
import { clock } from "../clock"
import {
  ApiError,
  type AddWaitlistInput,
  type CheckInInput,
  type CombineInput,
  type CreateReservationInput,
  type GamApi,
  type MoveInput,
  type RecordContactInput,
  type ReservationQuery,
  type SeatWaitlistInput,
  type SplitInput,
  type UpdateReservationInput,
  type VenueConfigPatch,
  type WalkInInput,
} from "../contracts"
import { ORG_ID, VENUE_ID, type CollectionName, type MockAllocation, type MockDb, type MockOperation } from "./db"
import {
  activeAllocations,
  activeEntryForReservation,
  activeHoldForEntry,
  activeReservationHold,
  availability,
  blockingAllocations,
  blocksAt,
  catalog,
  customerProfile,
  customerSummary,
  describeAllocation,
  floorState,
  holdTableIds,
  operationView,
  report,
  reservationView,
  reservationWarning,
  searchMatches,
  shiftOverview,
  allocationViews,
  venueConfig,
  venueOf,
  visitTableIds,
  visitView,
  waitlistView,
} from "./derive"
import { DEMO_USERS, REMOTE_USER_ID, seedDb } from "./seed"
import { Tx } from "./tx"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const ACTIVE_ENTRY = ["WAITING", "CONTACTING", "OFFERED", "HOLD_ACTIVE"] as const

interface CommitMeta {
  action: string
  entityType: string
  undoable: boolean
  actorUserId?: number
  reasonCode?: string | null
  reasonNote?: string | null
  compensates?: number | null
}

interface CommitOut<T> {
  entityId: number
  summary: string
  extra?: T
}

export interface DemoControls {
  simulateRemoteActivity(): Promise<string>
  armConflictOnce(): void
  readonly conflictArmed: boolean
  reset(): void
}

export class MockGamApi implements GamApi, DemoControls {
  readonly mode = "mock" as const
  private db: MockDb
  private session: SessionUser
  private seq: number
  private listeners = new Set<(event: ChangeEvent) => void>()
  private armed = false

  constructor() {
    this.db = seedDb(clock.now())
    this.seq = venueOf(this.db).changeSeq
    const first = DEMO_USERS[0]
    this.session = { ...first }
    setInterval(() => this.tick(), 5_000)
    clock.subscribe(() => this.tick())
  }

  /* ================= infrastructure ================= */

  private get now() {
    return clock.now()
  }

  private get venue() {
    return venueOf(this.db)
  }

  private async latency(kind: "q" | "m") {
    const [min, max] = kind === "q" ? [50, 130] : [140, 320]
    await sleep(min + Math.random() * (max - min))
  }

  private require(p: Permission) {
    if (!roleCan(this.session.role, p)) {
      throw new ApiError(
        403,
        "PERMISSION_DENIED",
        `${ROLE_LABEL[this.session.role]} không có quyền "${PERMISSION_LABEL[p]}".`,
        { permission: p },
      )
    }
  }

  private fail(message: string, code: "VALIDATION_FAILED" | "INVALID_STATE" = "VALIDATION_FAILED"): never {
    throw new ApiError(422, code, message)
  }

  private lastTouch(col: CollectionName, id: number, afterOpId = 0): MockOperation | null {
    for (let i = this.db.ops.length - 1; i >= 0; i--) {
      const op = this.db.ops[i]
      if (op.id <= afterOpId) break
      if (op.undo.some((e) => e.col === col && e.id === id)) return op
    }
    return null
  }

  private actorText(op: MockOperation | null) {
    if (!op) return "thiết bị khác"
    const u = op.actorUserId ? this.db.users.get(op.actorUserId) : undefined
    return u
      ? `${u.displayName} (${u.deviceLabel}) lúc ${fmtTime(op.occurredAt)}`
      : `hệ thống lúc ${fmtTime(op.occurredAt)}`
  }

  private checkVersion(col: CollectionName, row: { id: number; version: number }, version: number, label: string) {
    if (row.version !== version) {
      const op = this.lastTouch(col, row.id)
      throw new ApiError(
        409,
        "VERSION_CONFLICT",
        `${label} vừa được ${this.actorText(op)} thay đổi. Màn hình đã tải lại bản mới, vui lòng kiểm tra rồi thao tác lại.`,
        { by: this.actorText(op) },
      )
    }
  }

  private codes(ids: number[]) {
    return ids.map((id) => this.db.tables.get(id)?.code ?? `#${id}`).join(" + ")
  }

  private emit(event: ChangeEvent) {
    this.listeners.forEach((l) => l(event))
  }

  private commit<T = object>(meta: CommitMeta, fn: (tx: Tx) => CommitOut<T>): MutationResult & T {
    const tx = new Tx(this.db)
    let out: CommitOut<T>
    try {
      out = fn(tx)
    } catch (e) {
      tx.rollback()
      throw e
    }
    const actorId = meta.actorUserId ?? this.session.id
    this.seq += 1
    this.venue.changeSeq = this.seq
    const op: MockOperation = {
      id: this.db.nextId.ops++,
      organizationId: ORG_ID,
      venueId: VENUE_ID,
      changeSeq: this.seq,
      occurredAt: this.now,
      actorKind: actorId === 0 ? "SYSTEM" : "USER",
      actorUserId: actorId === 0 ? null : actorId,
      actorMembershipId: null,
      authSessionId: null,
      requestId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      action: meta.action,
      entityType: meta.entityType,
      entityId: out.entityId,
      entityVersionBefore: null,
      entityVersionAfter: null,
      changes: null,
      reasonCode: meta.reasonCode ?? null,
      reasonNote: meta.reasonNote ?? null,
      isUndoable: meta.undoable,
      compensatesOperationId: meta.compensates ?? null,
      summary: out.summary,
      businessDate: businessDateOf(this.now),
      undo: tx.entries(),
      compensatedBy: null,
    }
    this.db.ops.push(op)
    this.emit({
      latestSeq: this.seq,
      action: meta.action,
      entityType: meta.entityType,
      actorKind: op.actorKind,
      actorUserId: op.actorUserId,
      summary: out.summary,
    })
    return {
      ...(out.extra as T),
      operationId: op.id,
      changeSeq: this.seq,
      summary: out.summary,
      undoable: meta.undoable,
    }
  }

  private systemLog(action: string, entityType: string, entityId: number, summary: string) {
    this.seq += 1
    this.venue.changeSeq = this.seq
    this.db.ops.push({
      id: this.db.nextId.ops++,
      organizationId: ORG_ID,
      venueId: VENUE_ID,
      changeSeq: this.seq,
      occurredAt: this.now,
      actorKind: "SYSTEM",
      actorUserId: null,
      actorMembershipId: null,
      authSessionId: null,
      requestId: null,
      idempotencyKey: null,
      action,
      entityType,
      entityId,
      entityVersionBefore: null,
      entityVersionAfter: null,
      changes: null,
      reasonCode: null,
      reasonNote: null,
      isUndoable: false,
      compensatesOperationId: null,
      summary,
      businessDate: businessDateOf(this.now),
      undo: [],
      compensatedBy: null,
    })
    this.emit({ latestSeq: this.seq, action, entityType, actorKind: "SYSTEM", actorUserId: null, summary })
  }

  /* ================= claim helpers ================= */

  private assertClaimable(
    tableIds: number[],
    o: {
      bd: BusinessDate
      at: Date
      partySize?: number
      ignore?: (a: MockAllocation) => boolean
      overrideReason?: string
    },
  ) {
    if (tableIds.length === 0) this.fail("Chọn ít nhất một bàn.")
    if (new Set(tableIds).size !== tableIds.length) this.fail("Danh sách bàn bị trùng.")
    const spare: string[] = []
    let capacity = 0
    for (const id of tableIds) {
      const t = this.db.tables.get(id)
      if (!t || t.status === "RETIRED") throw new ApiError(404, "NOT_FOUND", `Không tìm thấy bàn #${id}`)
      if (t.status !== "ACTIVE")
        throw new ApiError(409, "TABLE_CONFLICT", `${t.code} đang ngưng phục vụ.`, { tableCode: t.code })
      const zone = this.db.zones.get(t.zoneId)!
      if (!zone.isBookable)
        this.fail(`${zone.name} đang cấu hình là khu chờ, chưa nhận khách ngồi. Đổi ở Cài đặt nếu PO duyệt.`)
      const blocking = blockingAllocations(this.db, id, o.bd, o.bd === businessDateOf(this.now))
        .filter((a) => !o.ignore?.(a))
        .filter((a) => blocksAt(this.db, a, o.at))
      if (blocking.length > 0) {
        const by = this.actorText(this.lastTouch("allocations", blocking[0].id))
        const policy =
          this.venue.reservationHoldPolicy === "SEQUENTIAL"
            ? " Chính sách giữ bàn hiện tại: SEQUENTIAL (chờ PO duyệt)."
            : ""
        throw new ApiError(409, "TABLE_CONFLICT", `${t.code} ${describeAllocation(this.db, blocking[0])}.${policy}`, {
          tableCode: t.code,
          by,
        })
      }
      if (t.isSpare) spare.push(t.code)
      capacity += t.capacity
    }
    const needs: string[] = []
    if (spare.length) needs.push(`dùng bàn sơ cua ${spare.join(", ")}`)
    if (o.partySize && capacity < o.partySize) needs.push(`xếp ${o.partySize} khách vào ${capacity} chỗ`)
    if (needs.length) {
      if (!roleCan(this.session.role, "table.assign_override")) {
        throw new ApiError(403, "PERMISSION_DENIED", `Cần Chủ quán duyệt để ${needs.join(" và ")}.`, {
          permission: "table.assign_override",
          needs,
        })
      }
      if (!o.overrideReason?.trim()) {
        throw new ApiError(409, "OVERRIDE_REQUIRED", `Cần ghi lý do để ${needs.join(" và ")}.`, { needs })
      }
    }
  }

  private newAllocation(
    tx: Tx,
    p: {
      tableId: number
      kind: "HOLD" | "USAGE"
      holdId?: number | null
      visitId?: number | null
      groupId?: number | null
      startsAt: Date
      bd: BusinessDate
      holdStart?: Date
    },
  ) {
    const v = this.venue
    const plannedUntil =
      v.reservationHoldPolicy === "WINDOWED" && p.kind === "HOLD"
        ? new Date((p.holdStart ?? p.startsAt).getTime() + (v.reservationWindowMinutes ?? 120) * MS.MIN)
        : null
    return tx.insert("allocations", {
      organizationId: ORG_ID,
      venueId: VENUE_ID,
      tableId: p.tableId,
      kind: p.kind,
      holdId: p.holdId ?? null,
      visitId: p.visitId ?? null,
      groupId: p.groupId ?? null,
      startsAt: p.startsAt,
      plannedUntil,
      businessDate: p.bd,
      releasedAt: null,
      releasedByUserId: null,
      releaseReason: null,
      createdByUserId: this.session.id,
      createdAt: this.now,
    })
  }

  private release(tx: Tx, a: MockAllocation, reason: AllocationReleaseReason) {
    const row = tx.edit("allocations", a.id)
    row.releasedAt = this.now
    row.releasedByUserId = this.session.id
    row.releaseReason = reason
  }

  private newGroup(tx: Tx, bd: BusinessDate): number {
    const used = new Set(
      [...this.db.groups.values()].filter((g) => g.businessDate === bd && !g.dissolvedAt).map((g) => g.symbolNo),
    )
    for (let s = 1; s <= this.venue.groupSymbolCount; s++) {
      if (!used.has(s)) {
        return tx.insert("groups", {
          organizationId: ORG_ID,
          venueId: VENUE_ID,
          businessDate: bd,
          symbolNo: s,
          formedAt: this.now,
          formedByUserId: this.session.id,
          dissolvedAt: null,
          dissolvedByUserId: null,
        }).id
      }
    }
    throw new ApiError(
      409,
      "NO_SYMBOL_AVAILABLE",
      `Đã dùng hết ${this.venue.groupSymbolCount} ký hiệu ghép trong ca. Tách một nhóm trước hoặc tăng số ký hiệu ở Cài đặt.`,
    )
  }

  private dissolveOrphanGroups(tx: Tx, groupIds: (number | null)[]) {
    for (const gid of new Set(groupIds)) {
      if (!gid) continue
      const stillUsed = activeAllocations(this.db).some((a) => a.groupId === gid)
      const g = this.db.groups.get(gid)
      if (!stillUsed && g && !g.dissolvedAt) {
        const row = tx.edit("groups", gid)
        row.dissolvedAt = this.now
        row.dissolvedByUserId = this.session.id
      }
    }
  }

  private createHoldForReservation(tx: Tx, r: ReservationRow, tableIds: number[]) {
    const hold = tx.insert("holds", {
      organizationId: ORG_ID,
      venueId: VENUE_ID,
      holdKind: "RESERVATION",
      reservationId: r.id,
      waitlistEntryId: null,
      status: "ACTIVE",
      startsAt: r.expectedAt,
      customerConfirmedAt: null,
      deadlineAt: null,
      deadlineBasis: null,
      defaultMinutesSnapshot: null,
      deadlineSetByUserId: null,
      deadlineReason: null,
      deadlineWarnedAt: null,
      convertedAt: null,
      convertedVisitId: null,
      releasedAt: null,
      releasedByUserId: null,
      releaseReasonCode: null,
      releaseReasonNote: null,
      createdByUserId: this.session.id,
      createdAt: this.now,
    })
    const groupId = tableIds.length > 1 ? this.newGroup(tx, r.businessDate) : null
    tableIds.forEach((tableId) =>
      this.newAllocation(tx, {
        tableId,
        kind: "HOLD",
        holdId: hold.id,
        groupId,
        startsAt: this.now,
        bd: r.businessDate,
        holdStart: r.expectedAt,
      }),
    )
    return hold
  }

  private releaseHoldInternal(
    tx: Tx,
    hold: TableHoldRow,
    reason: HoldReleaseReason,
    allocReason: AllocationReleaseReason,
    note?: string,
  ) {
    const h = tx.edit("holds", hold.id)
    h.status = "RELEASED"
    h.releasedAt = this.now
    h.releasedByUserId = this.session.id
    h.releaseReasonCode = reason
    h.releaseReasonNote = note ?? null
    const allocs = activeAllocations(this.db).filter((a) => a.holdId === hold.id)
    allocs.forEach((a) => this.release(tx, a, allocReason))
    this.dissolveOrphanGroups(
      tx,
      allocs.map((a) => a.groupId),
    )
  }

  private upsertCustomer(tx: Tx, name: string | undefined, phone: string | undefined): number | null {
    if (!phone) return null
    let e164 = normalizePhone(phone)
    if (e164.startsWith("0")) e164 = `+84${e164.slice(1)}`
    if (!/^\+84\d{9}$/.test(e164)) this.fail("Số điện thoại không hợp lệ (10 số, bắt đầu bằng 0).")
    for (const c of this.db.customers.values()) {
      if (c.phoneE164 === e164 && c.status === "ACTIVE") return c.id
    }
    return tx.insert("customers", {
      organizationId: ORG_ID,
      displayName: name ?? null,
      nameSearch: name ? foldVietnamese(name) : null,
      phoneLast3: e164.slice(-3),
      status: "ACTIVE",
      mergedIntoCustomerId: null,
      anonymizedAt: null,
      createdAt: this.now,
      phoneE164: e164,
      notes: null,
    }).id
  }

  private res(id: number): ReservationRow {
    const r = this.db.reservations.get(id)
    if (!r) throw new ApiError(404, "NOT_FOUND", "Không tìm thấy booking.")
    return r
  }

  private visit(id: number): VisitRow {
    const v = this.db.visits.get(id)
    if (!v) throw new ApiError(404, "NOT_FOUND", "Không tìm thấy lượt ghé.")
    return v
  }

  private entry(id: number): WaitlistEntryRow {
    const e = this.db.waitlist.get(id)
    if (!e) throw new ApiError(404, "NOT_FOUND", "Không tìm thấy mục chờ.")
    return e
  }

  private hold(id: number): TableHoldRow {
    const h = this.db.holds.get(id)
    if (!h) throw new ApiError(404, "NOT_FOUND", "Không tìm thấy giữ bàn.")
    return h
  }

  /** Demo: a second device grabs the table right before our confirm. */
  private maybeTriggerConflict(tableId: number, bd: BusinessDate, at: Date) {
    if (!this.armed) return
    this.armed = false
    const t = this.db.tables.get(tableId)
    if (!t || blockingAllocations(this.db, tableId, bd).some((a) => blocksAt(this.db, a, at))) return
    const today = businessDateOf(this.now)
    const remote = this.db.users.get(REMOTE_USER_ID)!
    if (bd === today) {
      this.commit({ action: "WALKIN_SEATED", entityType: "visit", undoable: false, actorUserId: remote.id }, (tx) => {
        const v = tx.insert("visits", {
          organizationId: ORG_ID,
          venueId: VENUE_ID,
          origin: "WALK_IN",
          customerId: null,
          contactName: null,
          guestCount: 2,
          startedAt: this.now,
          businessDate: today,
          endedAt: null,
          endedByUserId: null,
          endReason: null,
          mergedIntoVisitId: null,
          paidMarkedAt: null,
          paidMarkedByUserId: null,
          note: null,
          createdByUserId: remote.id,
          createdAt: this.now,
        })
        this.newAllocation(tx, { tableId, kind: "USAGE", visitId: v.id, startsAt: this.now, bd: today })
        return { entityId: v.id, summary: `Walk-in ${t.code} · 2 khách` }
      })
    } else {
      this.commit(
        { action: "RESERVATION_CREATED", entityType: "reservation", undoable: false, actorUserId: remote.id },
        (tx) => {
          const r = tx.insert("reservations", {
            organizationId: ORG_ID,
            venueId: VENUE_ID,
            customerId: null,
            contactName: "Khách qua Fanpage",
            contactNameSearch: "khach qua fanpage",
            sourceId: [...this.db.sources.values()].find((s) => s.code === "FANPAGE")!.id,
            partySize: 2,
            expectedAt: at,
            businessDate: bd,
            status: "BOOKED",
            note: null,
            visitId: null,
            checkedInAt: null,
            checkedInByUserId: null,
            closedAt: null,
            closedByUserId: null,
            closeReasonCode: null,
            closeReasonNote: null,
            lateWarnedAt: null,
            noShowWarnedAt: null,
            createdByUserId: remote.id,
            createdAt: this.now,
            updatedByUserId: null,
            updatedAt: this.now,
          })
          this.createHoldForReservation(tx, r, [tableId])
          return { entityId: r.id, summary: `Booking ${fmtTime(at)} · ${t.code}` }
        },
      )
    }
  }

  /* ================= session & subscription ================= */

  setSession(user: SessionUser) {
    this.session = { ...user }
  }

  listDemoUsers(): SessionUser[] {
    return DEMO_USERS.filter((u) => u.id !== REMOTE_USER_ID).map((u) => ({ ...u }))
  }

  subscribe(listener: (event: ChangeEvent) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /* ================= queries ================= */

  async getCatalog() {
    await this.latency("q")
    return catalog(this.db)
  }

  async getFloorState(at: Date, businessDate?: BusinessDate) {
    await this.latency("q")
    return floorState(this.db, at, businessDate)
  }

  async getAvailability(at: Date, partySize: number) {
    await this.latency("q")
    return availability(this.db, this.now, at, partySize)
  }

  async getShiftOverview() {
    await this.latency("q")
    return shiftOverview(this.db, this.now)
  }

  async listReservations(q: ReservationQuery): Promise<ReservationView[]> {
    await this.latency("q")
    const search = q.search?.trim()
    let rows = [...this.db.reservations.values()]
    if (search) {
      const m = searchMatches(this.db, search)
      const from = addDays(q.businessDate, -7)
      const to = addDays(q.businessDate, 7)
      rows = rows
        .filter((r) => r.businessDate >= from && r.businessDate <= to && m.reservation(r))
        .slice(0, m.digits ? 20 : 50)
    } else {
      rows = rows.filter((r) => r.businessDate === q.businessDate)
    }
    return rows
      .sort((a, b) => a.expectedAt.getTime() - b.expectedAt.getTime())
      .map((r) => reservationView(this.db, r, this.now))
  }

  async listVisits(bd: BusinessDate) {
    await this.latency("q")
    return [...this.db.visits.values()]
      .filter((v) => v.businessDate === bd || (v.endedAt === null && v.businessDate < bd))
      .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
      .map((v) => visitView(this.db, v))
  }

  async listWaitlist(bd: BusinessDate) {
    await this.latency("q")
    return [...this.db.waitlist.values()]
      .filter((e) => e.businessDate === bd)
      .sort((a, b) => a.queuedAt.getTime() - b.queuedAt.getTime() || a.id - b.id)
      .map((e) => waitlistView(this.db, e, this.now))
  }

  async searchCustomers(query: string): Promise<CustomerSummary[]> {
    await this.latency("q")
    this.require("customer.view_masked")
    const q = query.trim()
    let list = [...this.db.customers.values()].filter((c) => c.status === "ACTIVE")
    if (q) {
      const m = searchMatches(this.db, q)
      list = list.filter(m.customer)
    }
    return list
      .map((c) => customerSummary(this.db, c))
      .sort((a, b) => (b.lastVisitAt?.getTime() ?? 0) - (a.lastVisitAt?.getTime() ?? 0))
      .slice(0, 60)
  }

  async getCustomer(id: number) {
    await this.latency("q")
    this.require("customer.view_masked")
    const c = this.db.customers.get(id)
    if (!c) throw new ApiError(404, "NOT_FOUND", "Không tìm thấy khách.")
    return customerProfile(this.db, c, this.now)
  }

  async listOperations(limit: number) {
    await this.latency("q")
    return this.db.ops
      .slice(-limit)
      .reverse()
      .map((op) => operationView(this.db, op, this.session.id))
  }

  async listAllocations(bd: BusinessDate, tableId?: number) {
    await this.latency("q")
    return allocationViews(this.db, bd, this.now, tableId)
  }

  async getReport(q: ReportQuery) {
    await this.latency("q")
    this.require("report.read")
    return report(this.db, q)
  }

  /* ================= reservations ================= */

  async createReservation(input: CreateReservationInput) {
    await this.latency("m")
    this.require("reservation.create")
    const name = input.contactName?.trim() || undefined
    const phone = input.phone?.trim() || undefined
    if (!name && !phone) this.fail("Đặt trước cần ít nhất tên hoặc số điện thoại.")
    if (!Number.isInteger(input.partySize) || input.partySize < 1 || input.partySize > 500)
      this.fail("Số khách phải từ 1 đến 500.")
    if (input.note && noteHasPhoneNumber(input.note)) this.fail(NOTE_PHONE_ERROR)
    if (input.expectedAt.getTime() < this.now.getTime() - 5 * MS.MIN) this.fail("Giờ đến đã qua.")
    const bd = businessDateOf(input.expectedAt)
    const tableIds = input.tableIds ?? []
    if (tableIds.length) this.maybeTriggerConflict(tableIds[0], bd, input.expectedAt)
    return this.commit<{ reservationId: number }>(
      { action: "RESERVATION_CREATED", entityType: "reservation", undoable: true },
      (tx) => {
        const customerId = this.upsertCustomer(tx, name, phone)
        const source = [...this.db.sources.values()].find((s) => s.code === input.sourceCode)
        if (!source) this.fail("Nguồn đặt không hợp lệ.")
        const contactName = name ?? this.db.customers.get(customerId ?? 0)?.displayName ?? null
        const r = tx.insert("reservations", {
          organizationId: ORG_ID,
          venueId: VENUE_ID,
          customerId,
          contactName,
          contactNameSearch: contactName ? foldVietnamese(contactName) : null,
          sourceId: source.id,
          partySize: input.partySize,
          expectedAt: input.expectedAt,
          businessDate: bd,
          status: "BOOKED",
          note: input.note?.trim() || null,
          visitId: null,
          checkedInAt: null,
          checkedInByUserId: null,
          closedAt: null,
          closedByUserId: null,
          closeReasonCode: null,
          closeReasonNote: null,
          lateWarnedAt: null,
          noShowWarnedAt: null,
          createdByUserId: this.session.id,
          createdAt: this.now,
          updatedByUserId: null,
          updatedAt: this.now,
        })
        let summary = `Booking ${fmtTime(input.expectedAt)} · ${input.partySize} khách`
        if (tableIds.length) {
          this.assertClaimable(tableIds, {
            bd,
            at: input.expectedAt,
            partySize: input.partySize,
            overrideReason: input.overrideReason,
          })
          this.createHoldForReservation(tx, r, tableIds)
          summary += ` · giữ ${this.codes(tableIds)}`
        } else {
          summary += " · chờ phân bàn"
        }
        return { entityId: r.id, summary, extra: { reservationId: r.id } }
      },
    )
  }

  async updateReservation(input: UpdateReservationInput) {
    await this.latency("m")
    this.require("reservation.update")
    const r = this.res(input.id)
    this.checkVersion("reservations", r, input.version, "Booking")
    if (r.status !== "BOOKED") this.fail("Chỉ sửa được booking đang ở trạng thái Đã đặt.", "INVALID_STATE")
    if (input.note && noteHasPhoneNumber(input.note)) this.fail(NOTE_PHONE_ERROR)
    if (input.partySize !== undefined && (input.partySize < 1 || input.partySize > 500))
      this.fail("Số khách phải từ 1 đến 500.")
    if (input.contactName !== undefined && !input.contactName.trim() && !r.customerId)
      this.fail("Cần ít nhất tên hoặc số điện thoại.")
    return this.commit({ action: "RESERVATION_UPDATED", entityType: "reservation", undoable: true }, (tx) => {
      const row = tx.edit("reservations", r.id)
      const notes: string[] = []
      if (input.contactName !== undefined) {
        row.contactName = input.contactName.trim() || null
        row.contactNameSearch = row.contactName ? foldVietnamese(row.contactName) : null
      }
      if (input.partySize !== undefined && input.partySize !== row.partySize) {
        notes.push(`${row.partySize} → ${input.partySize} khách`)
        row.partySize = input.partySize
      }
      if (input.sourceCode)
        row.sourceId = [...this.db.sources.values()].find((s) => s.code === input.sourceCode)?.id ?? row.sourceId
      if (input.note !== undefined) row.note = input.note?.trim() || null
      if (input.expectedAt && input.expectedAt.getTime() !== row.expectedAt.getTime()) {
        const newBd = businessDateOf(input.expectedAt)
        notes.push(`giờ ${fmtTime(row.expectedAt)} → ${fmtTime(input.expectedAt)}`)
        const hold = activeReservationHold(this.db, r.id)
        if (hold && newBd !== row.businessDate) {
          this.releaseHoldInternal(tx, hold, "STAFF_REASSIGNED", "MOVED", "Đổi ngày")
          notes.push("đã nhả bàn cũ (khác ngày)")
        } else if (hold) {
          const h = tx.edit("holds", hold.id)
          h.startsAt = input.expectedAt
        }
        row.expectedAt = input.expectedAt
        row.businessDate = newBd
      }
      row.updatedByUserId = this.session.id
      row.updatedAt = this.now
      return {
        entityId: r.id,
        summary: `Sửa booking ${row.contactName ?? ""}${notes.length ? ` · ${notes.join(", ")}` : ""}`,
      }
    })
  }

  async assignTables(reservationId: number, version: number, tableIds: number[], overrideReason?: string) {
    await this.latency("m")
    this.require("table.assign")
    const r = this.res(reservationId)
    this.checkVersion("reservations", r, version, "Booking")
    if (r.status !== "BOOKED") this.fail("Chỉ phân bàn cho booking Đã đặt.", "INVALID_STATE")
    if (tableIds.length) this.maybeTriggerConflict(tableIds[0], r.businessDate, r.expectedAt)
    return this.commit({ action: "TABLE_ASSIGNED", entityType: "reservation", undoable: true }, (tx) => {
      const hold = activeReservationHold(this.db, r.id)
      this.assertClaimable(tableIds, {
        bd: r.businessDate,
        at: r.expectedAt,
        partySize: r.partySize,
        ignore: (a) => !!hold && a.holdId === hold.id,
        overrideReason,
      })
      if (hold) {
        const old = activeAllocations(this.db).filter((a) => a.holdId === hold.id)
        old.forEach((a) => this.release(tx, a, "MOVED"))
        this.dissolveOrphanGroups(
          tx,
          old.map((a) => a.groupId),
        )
        const groupId = tableIds.length > 1 ? this.newGroup(tx, r.businessDate) : null
        tableIds.forEach((tableId) =>
          this.newAllocation(tx, {
            tableId,
            kind: "HOLD",
            holdId: hold.id,
            groupId,
            startsAt: this.now,
            bd: r.businessDate,
            holdStart: r.expectedAt,
          }),
        )
      } else {
        this.createHoldForReservation(tx, r, tableIds)
      }
      const entry = activeEntryForReservation(this.db, r.id)
      if (entry && entry.status !== "HOLD_ACTIVE") {
        const e = tx.edit("waitlist", entry.id)
        e.status = "CANCELLED"
        e.closedAt = this.now
        e.closedByUserId = this.session.id
        e.closeReasonCode = "OTHER"
        e.closeReasonNote = "Đã phân bàn trực tiếp"
        e.claimedByUserId = null
        e.claimedAt = null
        e.claimExpiresAt = null
      }
      const row = tx.edit("reservations", r.id)
      row.updatedByUserId = this.session.id
      row.updatedAt = this.now
      return { entityId: r.id, summary: `Phân bàn ${this.codes(tableIds)} cho booking ${fmtTime(r.expectedAt)}` }
    })
  }

  async cancelReservation(id: number, version: number, reason: ReservationCloseReason, note?: string) {
    await this.latency("m")
    this.require("reservation.cancel")
    const r = this.res(id)
    this.checkVersion("reservations", r, version, "Booking")
    if (r.status !== "BOOKED") this.fail("Booking không còn ở trạng thái Đã đặt.", "INVALID_STATE")
    if (reason === "NO_SHOW_CONFIRMED") this.fail("Dùng thao tác Xác nhận không đến.")
    if (reason === "OTHER" && !note?.trim()) this.fail("Ghi rõ lý do khác.")
    if (note && noteHasPhoneNumber(note)) this.fail(NOTE_PHONE_ERROR)
    return this.commit(
      {
        action: "RESERVATION_CANCELLED",
        entityType: "reservation",
        undoable: true,
        reasonCode: reason,
        reasonNote: note,
      },
      (tx) => {
        const tables = this.closeReservationClaims(tx, r, "RESERVATION_CANCELLED", "RESERVATION_CANCELLED")
        const row = tx.edit("reservations", r.id)
        row.status = "CANCELLED"
        row.closedAt = this.now
        row.closedByUserId = this.session.id
        row.closeReasonCode = reason
        row.closeReasonNote = note?.trim() || null
        return {
          entityId: r.id,
          summary: `Hủy booking ${fmtTime(r.expectedAt)}${tables.length ? ` · nhả ${this.codes(tables)}` : ""}`,
        }
      },
    )
  }

  private closeReservationClaims(
    tx: Tx,
    r: ReservationRow,
    holdReason: HoldReleaseReason,
    allocReason: AllocationReleaseReason,
  ): number[] {
    const tables: number[] = []
    const hold = activeReservationHold(this.db, r.id)
    if (hold) {
      tables.push(...holdTableIds(this.db, hold.id))
      this.releaseHoldInternal(tx, hold, holdReason, allocReason)
    }
    const entry = activeEntryForReservation(this.db, r.id)
    if (entry) {
      const offer = activeHoldForEntry(this.db, entry.id)
      if (offer) {
        tables.push(...holdTableIds(this.db, offer.id))
        this.releaseHoldInternal(tx, offer, "RESERVATION_CANCELLED", allocReason)
      }
      const e = tx.edit("waitlist", entry.id)
      e.status = "CANCELLED"
      e.closedAt = this.now
      e.closedByUserId = this.session.id
      e.closeReasonCode = "RESERVATION_CANCELLED"
      e.claimedByUserId = null
      e.claimedAt = null
      e.claimExpiresAt = null
    }
    return tables
  }

  async markNoShow(id: number, version: number) {
    await this.latency("m")
    this.require("reservation.mark_no_show")
    const r = this.res(id)
    this.checkVersion("reservations", r, version, "Booking")
    if (r.status !== "BOOKED") this.fail("Booking không còn ở trạng thái Đã đặt.", "INVALID_STATE")
    const { minutesLate } = reservationWarning(this.venue, r, this.now)
    if (minutesLate < this.venue.noShowWarningMinutes) {
      this.fail(
        `Chỉ xác nhận không đến sau ${this.venue.noShowWarningMinutes} phút (hiện trễ ${minutesLate}'). Trước mốc này, nếu khách báo hủy hãy dùng Hủy booking.`,
        "INVALID_STATE",
      )
    }
    return this.commit(
      { action: "RESERVATION_NO_SHOW", entityType: "reservation", undoable: true, reasonCode: "NO_SHOW_CONFIRMED" },
      (tx) => {
        const tables = this.closeReservationClaims(tx, r, "CUSTOMER_NO_SHOW", "NO_SHOW")
        const row = tx.edit("reservations", r.id)
        row.status = "NO_SHOW"
        row.closedAt = this.now
        row.closedByUserId = this.session.id
        row.closeReasonCode = "NO_SHOW_CONFIRMED"
        return {
          entityId: r.id,
          summary: `Xác nhận không đến · booking ${fmtTime(r.expectedAt)}${tables.length ? ` · nhả ${this.codes(tables)}` : ""}`,
        }
      },
    )
  }

  async checkIn(input: CheckInInput) {
    await this.latency("m")
    this.require("visit.checkin")
    const r = this.res(input.reservationId)
    this.checkVersion("reservations", r, input.version, "Booking")
    if (r.status !== "BOOKED") this.fail("Booking không còn ở trạng thái Đã đặt.", "INVALID_STATE")
    if (input.guestCount < 1 || input.guestCount > 500) this.fail("Số khách phải từ 1 đến 500.")
    const bd = businessDateOf(this.now)
    if (r.businessDate !== bd)
      this.fail(`Booking thuộc ngày ${r.businessDate}, không phải ca hiện tại.`, "INVALID_STATE")
    const entry = activeEntryForReservation(this.db, r.id)
    const hold = activeReservationHold(this.db, r.id) ?? (entry ? activeHoldForEntry(this.db, entry.id) : null)
    const holdTables = hold ? holdTableIds(this.db, hold.id) : []
    const target = input.tableIds?.length ? input.tableIds : holdTables
    if (!target.length) this.fail("Booking chưa có bàn. Chọn bàn để check-in.")
    const sameTables = target.length === holdTables.length && target.every((t) => holdTables.includes(t))
    if (!sameTables)
      this.maybeTriggerConflict(
        target.find((t) => !holdTables.includes(t))!,
        bd,
        this.now,
      )
    return this.commit({ action: "CHECKED_IN", entityType: "reservation", undoable: true }, (tx) => {
      this.assertClaimable(target, {
        bd,
        at: this.now,
        ignore: (a) => !!hold && a.holdId === hold.id,
        overrideReason: input.overrideReason,
      })
      const v = tx.insert("visits", {
        organizationId: ORG_ID,
        venueId: VENUE_ID,
        origin: entry ? "WAITLIST" : "RESERVATION",
        customerId: r.customerId,
        contactName: r.contactName,
        guestCount: input.guestCount,
        startedAt: this.now,
        businessDate: bd,
        endedAt: null,
        endedByUserId: null,
        endReason: null,
        mergedIntoVisitId: null,
        paidMarkedAt: null,
        paidMarkedByUserId: null,
        note: r.note,
        createdByUserId: this.session.id,
        createdAt: this.now,
      })
      this.convertHold(tx, hold, v.id, target, sameTables, bd)
      const row = tx.edit("reservations", r.id)
      row.status = "CHECKED_IN"
      row.visitId = v.id
      row.checkedInAt = this.now
      row.checkedInByUserId = this.session.id
      if (entry) this.closeEntrySeated(tx, entry.id, v.id)
      return { entityId: r.id, summary: `Check-in ${this.codes(target)} · ${input.guestCount} khách` }
    })
  }

  /** HOLD -> USAGE on check-in / seating (T-06). Keeps the group when tables are unchanged. */
  private convertHold(
    tx: Tx,
    hold: TableHoldRow | null,
    visitId: number,
    target: number[],
    sameTables: boolean,
    bd: BusinessDate,
  ) {
    let groupId: number | null = null
    if (hold) {
      const allocs = activeAllocations(this.db).filter((a) => a.holdId === hold.id)
      if (sameTables) groupId = allocs.find((a) => a.groupId)?.groupId ?? null
      allocs.forEach((a) => this.release(tx, a, "CONVERTED_TO_USAGE"))
      if (!sameTables)
        this.dissolveOrphanGroups(
          tx,
          allocs.map((a) => a.groupId),
        )
      const h = tx.edit("holds", hold.id)
      h.status = "CONVERTED"
      h.convertedAt = this.now
      h.convertedVisitId = visitId
    }
    if (!groupId && target.length > 1) groupId = this.newGroup(tx, bd)
    target.forEach((tableId) =>
      this.newAllocation(tx, { tableId, kind: "USAGE", visitId, groupId, startsAt: this.now, bd }),
    )
  }

  private closeEntrySeated(tx: Tx, entryId: number, visitId: number) {
    const e = tx.edit("waitlist", entryId)
    e.status = "SEATED"
    e.visitId = visitId
    e.closedAt = this.now
    e.closedByUserId = this.session.id
    e.claimedByUserId = null
    e.claimedAt = null
    e.claimExpiresAt = null
  }

  /* ================= floor ================= */

  async seatWalkIn(input: WalkInInput) {
    await this.latency("m")
    this.require("visit.walkin")
    if (!Number.isInteger(input.guestCount) || input.guestCount < 1 || input.guestCount > 500)
      this.fail("Số khách phải từ 1 đến 500.")
    if (input.contactName && noteHasPhoneNumber(input.contactName)) this.fail("Không nhập số điện thoại vào ô tên.")
    const bd = businessDateOf(this.now)
    if (input.tableIds.length) this.maybeTriggerConflict(input.tableIds[0], bd, this.now)
    return this.commit<{ visitId: number }>({ action: "WALKIN_SEATED", entityType: "visit", undoable: true }, (tx) => {
      this.assertClaimable(input.tableIds, {
        bd,
        at: this.now,
        partySize: input.guestCount,
        overrideReason: input.overrideReason,
      })
      const v = tx.insert("visits", {
        organizationId: ORG_ID,
        venueId: VENUE_ID,
        origin: "WALK_IN",
        customerId: null,
        contactName: input.contactName?.trim() || null,
        guestCount: input.guestCount,
        startedAt: this.now,
        businessDate: bd,
        endedAt: null,
        endedByUserId: null,
        endReason: null,
        mergedIntoVisitId: null,
        paidMarkedAt: null,
        paidMarkedByUserId: null,
        note: null,
        createdByUserId: this.session.id,
        createdAt: this.now,
      })
      const groupId = input.tableIds.length > 1 ? this.newGroup(tx, bd) : null
      input.tableIds.forEach((tableId) =>
        this.newAllocation(tx, { tableId, kind: "USAGE", visitId: v.id, groupId, startsAt: this.now, bd }),
      )
      const sym = groupId ? symbolByNo(this.db.groups.get(groupId)?.symbolNo)?.name : null
      return {
        entityId: v.id,
        summary: `Walk-in ${this.codes(input.tableIds)} · ${input.guestCount} khách${sym ? ` · ký hiệu ${sym}` : ""}`,
        extra: { visitId: v.id },
      }
    })
  }

  private claimAllocations(claim: MoveInput["claim"]): {
    allocs: MockAllocation[]
    entity: { col: CollectionName; id: number }
    at: Date
    party: number
  } {
    if (claim.visitId) {
      const v = this.visit(claim.visitId)
      if (v.endedAt) this.fail("Lượt ghé đã kết thúc.", "INVALID_STATE")
      return {
        allocs: activeAllocations(this.db).filter((a) => a.visitId === v.id && a.kind === "USAGE"),
        entity: { col: "visits", id: v.id },
        at: this.now,
        party: v.guestCount,
      }
    }
    if (claim.reservationId) {
      const r = this.res(claim.reservationId)
      const hold = activeReservationHold(this.db, r.id)
      if (!hold) this.fail("Booking chưa có bàn.", "INVALID_STATE")
      return {
        allocs: activeAllocations(this.db).filter((a) => a.holdId === hold.id),
        entity: { col: "reservations", id: r.id },
        at: r.expectedAt,
        party: r.partySize,
      }
    }
    if (claim.waitlistEntryId) {
      const e = this.entry(claim.waitlistEntryId)
      const hold = activeHoldForEntry(this.db, e.id)
      if (!hold) this.fail("Mục chờ không giữ bàn.", "INVALID_STATE")
      return {
        allocs: activeAllocations(this.db).filter((a) => a.holdId === hold.id),
        entity: { col: "holds", id: hold.id },
        at: this.now,
        party: e.partySize ?? 1,
      }
    }
    return this.fail("Thiếu đối tượng cần đổi bàn.")
  }

  async moveClaim(input: MoveInput) {
    await this.latency("m")
    this.require(input.claim.visitId ? "visit.move" : "table.assign")
    const { allocs, entity, at } = this.claimAllocations(input.claim)
    const from = allocs.find((a) => a.tableId === input.fromTableId)
    if (!from) this.fail("Bàn nguồn không thuộc nhóm khách này.")
    if (allocs.some((a) => a.tableId === input.toTableId)) this.fail("Bàn đích đã thuộc nhóm khách này.")
    this.maybeTriggerConflict(input.toTableId, from.businessDate, at)
    return this.commit(
      {
        action: "TABLE_MOVED",
        entityType: entity.col === "visits" ? "visit" : entity.col === "holds" ? "table_hold" : "reservation",
        undoable: true,
      },
      (tx) => {
        this.assertClaimable([input.toTableId], { bd: from.businessDate, at, overrideReason: input.overrideReason })
        this.release(tx, from, "MOVED")
        this.newAllocation(tx, {
          tableId: input.toTableId,
          kind: from.kind,
          holdId: from.holdId,
          visitId: from.visitId,
          groupId: from.groupId,
          startsAt: this.now,
          bd: from.businessDate,
          holdStart: at,
        })
        tx.edit(entity.col, entity.id)
        return {
          entityId: entity.id,
          summary: `Đổi bàn ${this.codes([input.fromTableId])} → ${this.codes([input.toTableId])}`,
        }
      },
    )
  }

  async combineTables(input: CombineInput) {
    await this.latency("m")
    this.require("visit.combine")
    const { allocs, entity, at } = this.claimAllocations(input.claim)
    if (!allocs.length) this.fail("Không có bàn để ghép.")
    if (!input.addTableIds.length) this.fail("Chọn bàn cần ghép thêm.")
    const bd = allocs[0].businessDate
    this.maybeTriggerConflict(input.addTableIds[0], bd, at)
    return this.commit(
      { action: "TABLES_COMBINED", entityType: entity.col === "visits" ? "visit" : "reservation", undoable: true },
      (tx) => {
        this.assertClaimable(input.addTableIds, { bd, at, overrideReason: input.overrideReason })
        let groupId = allocs.find((a) => a.groupId)?.groupId ?? null
        if (!groupId) {
          groupId = this.newGroup(tx, bd)
          allocs.forEach((a) => {
            this.release(tx, a, "REGROUPED")
            this.newAllocation(tx, {
              tableId: a.tableId,
              kind: a.kind,
              holdId: a.holdId,
              visitId: a.visitId,
              groupId,
              startsAt: this.now,
              bd,
              holdStart: at,
            })
          })
        }
        input.addTableIds.forEach((tableId) =>
          this.newAllocation(tx, {
            tableId,
            kind: allocs[0].kind,
            holdId: allocs[0].holdId,
            visitId: allocs[0].visitId,
            groupId,
            startsAt: this.now,
            bd,
            holdStart: at,
          }),
        )
        tx.edit(entity.col, entity.id)
        const sym = symbolByNo(this.db.groups.get(groupId)?.symbolNo)
        const all = [...allocs.map((a) => a.tableId), ...input.addTableIds]
        return { entityId: entity.id, summary: `Ghép ${this.codes(all)} · ký hiệu ${sym?.name ?? "?"}` }
      },
    )
  }

  async splitGroup(input: SplitInput) {
    await this.latency("m")
    this.require("visit.split")
    const g = this.db.groups.get(input.groupId)
    if (!g || g.dissolvedAt) throw new ApiError(404, "NOT_FOUND", "Nhóm ghép không còn tồn tại.")
    const allocs = activeAllocations(this.db).filter((a) => a.groupId === g.id)
    const tables = allocs.map((a) => a.tableId)
    if (!input.keepTableIds.length)
      this.fail("Giữ lại ít nhất một bàn cho đoàn khách. Muốn trả hết bàn hãy dùng Nhả bàn.")
    if (input.keepTableIds.some((t) => !tables.includes(t))) this.fail("Bàn giữ lại không thuộc nhóm.")
    return this.commit({ action: "TABLES_SPLIT", entityType: "table_group", undoable: true }, (tx) => {
      allocs.forEach((a) => this.release(tx, a, "SPLIT"))
      const gr = tx.edit("groups", g.id)
      gr.dissolvedAt = this.now
      gr.dissolvedByUserId = this.session.id
      const keep = allocs.filter((a) => input.keepTableIds.includes(a.tableId))
      const newGroupId = keep.length > 1 ? this.newGroup(tx, g.businessDate) : null
      keep.forEach((a) =>
        this.newAllocation(tx, {
          tableId: a.tableId,
          kind: a.kind,
          holdId: a.holdId,
          visitId: a.visitId,
          groupId: newGroupId,
          startsAt: this.now,
          bd: a.businessDate,
        }),
      )
      const owner = allocs[0]
      if (owner.visitId) tx.edit("visits", owner.visitId)
      else if (owner.holdId) tx.edit("holds", owner.holdId)
      const detached = tables.filter((t) => !input.keepTableIds.includes(t))
      return {
        entityId: g.id,
        summary: `Tách nhóm ${this.codes(tables)} · giữ ${this.codes(input.keepTableIds)}${detached.length ? ` · nhả ${this.codes(detached)}` : ""}`,
      }
    })
  }

  async endVisit(visitId: number, version: number) {
    await this.latency("m")
    this.require("visit.end")
    const v = this.visit(visitId)
    this.checkVersion("visits", v, version, "Lượt ghé")
    if (v.endedAt) this.fail("Lượt ghé đã kết thúc.", "INVALID_STATE")
    return this.commit({ action: "VISIT_ENDED", entityType: "visit", undoable: true }, (tx) => {
      const allocs = activeAllocations(this.db).filter((a) => a.visitId === v.id)
      allocs.forEach((a) => this.release(tx, a, "GUEST_LEFT"))
      this.dissolveOrphanGroups(
        tx,
        allocs.map((a) => a.groupId),
      )
      const row = tx.edit("visits", v.id)
      row.endedAt = this.now
      row.endedByUserId = this.session.id
      row.endReason = "GUEST_LEFT"
      return {
        entityId: v.id,
        summary: `Nhả bàn ${this.codes(allocs.map((a) => a.tableId))} · ${v.guestCount} khách rời`,
      }
    })
  }

  async markPaid(visitId: number, version: number) {
    await this.latency("m")
    this.require("visit.mark_paid")
    const v = this.visit(visitId)
    this.checkVersion("visits", v, version, "Lượt ghé")
    if (v.endedAt) this.fail("Lượt ghé đã kết thúc.", "INVALID_STATE")
    if (v.paidMarkedAt) this.fail("Đã đánh dấu thanh toán trước đó.", "INVALID_STATE")
    return this.commit({ action: "VISIT_MARKED_PAID", entityType: "visit", undoable: true }, (tx) => {
      const row = tx.edit("visits", v.id)
      row.paidMarkedAt = this.now
      row.paidMarkedByUserId = this.session.id
      return {
        entityId: v.id,
        summary: `Đã thanh toán ${this.codes(visitTableIds(this.db, v.id))} · bàn vẫn đang sử dụng`,
      }
    })
  }

  async setTableStatus(
    tableId: number,
    version: number,
    patch: { status?: "ACTIVE" | "OUT_OF_SERVICE"; isSpare?: boolean },
  ) {
    await this.latency("m")
    this.require("venue.configure")
    const t = this.db.tables.get(tableId)
    if (!t) throw new ApiError(404, "NOT_FOUND", "Không tìm thấy bàn.")
    this.checkVersion("tables", t, version, `Bàn ${t.code}`)
    if (patch.status === "OUT_OF_SERVICE" && activeAllocations(this.db).some((a) => a.tableId === tableId)) {
      throw new ApiError(409, "TABLE_CONFLICT", `${t.code} đang có khách hoặc đang giữ chỗ, không thể ngưng phục vụ.`)
    }
    return this.commit({ action: "TABLE_CONFIG_UPDATED", entityType: "dining_table", undoable: true }, (tx) => {
      const row = tx.edit("tables", t.id)
      if (patch.status) row.status = patch.status
      if (patch.isSpare !== undefined) row.isSpare = patch.isSpare
      const parts = [
        patch.status ? (patch.status === "ACTIVE" ? "mở lại" : "ngưng phục vụ") : null,
        patch.isSpare !== undefined ? (patch.isSpare ? "đặt làm sơ cua" : "bỏ sơ cua") : null,
      ].filter(Boolean)
      return { entityId: t.id, summary: `${t.code}: ${parts.join(", ")}` }
    })
  }

  /* ================= waitlist ================= */

  async addWaitlist(input: AddWaitlistInput) {
    await this.latency("m")
    this.require("waitlist.create")
    if (input.note && noteHasPhoneNumber(input.note)) this.fail(NOTE_PHONE_ERROR)
    if (input.preferences.length > 20) this.fail("Tối đa 20 lựa chọn ưu tiên.")
    if (input.preferenceMode !== "ANY" && input.preferences.length === 0)
      this.fail("Chọn ít nhất một khu/bàn mong muốn.")
    let bd = businessDateOf(this.now)
    let label = ""
    if (input.kind === "ADVANCE_RESERVATION") {
      const r = this.res(input.reservationId ?? 0)
      if (r.status !== "BOOKED") this.fail("Booking không còn ở trạng thái Đã đặt.", "INVALID_STATE")
      if (activeReservationHold(this.db, r.id))
        this.fail("Booking đã có bàn, không cần vào danh sách chờ.", "INVALID_STATE")
      if (activeEntryForReservation(this.db, r.id)) this.fail("Booking đã có trong danh sách chờ.", "INVALID_STATE")
      bd = r.businessDate
      label = `Đặt trước ${fmtTime(r.expectedAt)} · ${r.partySize} khách`
    } else {
      if (!input.partySize || input.partySize < 1) this.fail("Nhập số khách.")
      if (!input.contactName?.trim()) this.fail("Nhập tên hoặc đặc điểm nhận dạng (ví dụ: nhóm áo xanh).")
      if (noteHasPhoneNumber(input.contactName)) this.fail("Không nhập số điện thoại vào ô tên.")
      label = `Walk-in · ${input.partySize} khách`
    }
    return this.commit<{ entryId: number }>(
      { action: "WAITLIST_ADDED", entityType: "waitlist_entry", undoable: true },
      (tx) => {
        const e = tx.insert("waitlist", {
          organizationId: ORG_ID,
          venueId: VENUE_ID,
          kind: input.kind,
          priorityClass: input.kind === "ADVANCE_RESERVATION" ? 1 : 2,
          reservationId: input.kind === "ADVANCE_RESERVATION" ? input.reservationId! : null,
          customerId: null,
          contactName: input.kind === "WALK_IN" ? input.contactName!.trim() : null,
          partySize: input.kind === "WALK_IN" ? input.partySize! : null,
          preferenceMode: input.preferenceMode,
          contactChannel: input.channel,
          businessDate: bd,
          queuedAt: this.now,
          status: "WAITING",
          claimedByUserId: null,
          claimedAt: null,
          claimExpiresAt: null,
          offeredAt: null,
          visitId: null,
          closedAt: null,
          closedByUserId: null,
          closeReasonCode: null,
          closeReasonNote: null,
          note: input.note?.trim() || null,
          createdByUserId: this.session.id,
          createdAt: this.now,
        })
        input.preferences.forEach((p, i) => {
          const zone = p.zoneCode ? [...this.db.zones.values()].find((z) => z.code === p.zoneCode) : undefined
          tx.insert("prefs", {
            organizationId: ORG_ID,
            venueId: VENUE_ID,
            entryId: e.id,
            prefRank: i + 1,
            tableId: p.tableId ?? null,
            combinationId: p.combinationId ?? null,
            zoneId: zone?.id ?? null,
          })
        })
        return { entityId: e.id, summary: `Thêm danh sách chờ · ${label}`, extra: { entryId: e.id } }
      },
    )
  }

  async claimWaitlist(entryId: number, version: number) {
    await this.latency("m")
    this.require("waitlist.claim")
    const e = this.entry(entryId)
    const now = this.now
    if (
      e.status === "CONTACTING" &&
      e.claimExpiresAt &&
      e.claimExpiresAt > now &&
      e.claimedByUserId !== this.session.id
    ) {
      const who = this.db.users.get(e.claimedByUserId ?? 0)
      const left = Math.ceil((e.claimExpiresAt.getTime() - now.getTime()) / 1000)
      throw new ApiError(
        409,
        "ENTRY_ALREADY_CLAIMED",
        `${who?.displayName ?? "Người khác"} (${who?.deviceLabel ?? ""}) đang liên hệ khách này, còn ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}.`,
      )
    }
    this.checkVersion("waitlist", e, version, "Mục chờ")
    if (!["WAITING", "OFFERED", "CONTACTING"].includes(e.status))
      this.fail("Mục chờ không ở trạng thái cần liên hệ.", "INVALID_STATE")
    return this.commit({ action: "WAITLIST_CLAIMED", entityType: "waitlist_entry", undoable: false }, (tx) => {
      const row = tx.edit("waitlist", e.id)
      row.status = "CONTACTING"
      row.claimedByUserId = this.session.id
      row.claimedAt = now
      row.claimExpiresAt = new Date(now.getTime() + this.venue.waitlistClaimLeaseSeconds * 1000)
      return { entityId: e.id, summary: `Nhận liên hệ mục chờ #${e.id}` }
    })
  }

  async releaseClaim(entryId: number, version: number) {
    await this.latency("m")
    this.require("waitlist.claim")
    const e = this.entry(entryId)
    this.checkVersion("waitlist", e, version, "Mục chờ")
    if (e.status !== "CONTACTING") this.fail("Mục chờ không ở trạng thái đang liên hệ.", "INVALID_STATE")
    return this.commit({ action: "WAITLIST_CLAIM_RELEASED", entityType: "waitlist_entry", undoable: false }, (tx) => {
      const row = tx.edit("waitlist", e.id)
      row.status = row.offeredAt ? "OFFERED" : "WAITING"
      row.claimedByUserId = null
      row.claimedAt = null
      row.claimExpiresAt = null
      return { entityId: e.id, summary: `Thả liên hệ mục chờ #${e.id}` }
    })
  }

  async recordContact(input: RecordContactInput) {
    await this.latency("m")
    this.require("waitlist.record_contact")
    const e = this.entry(input.entryId)
    this.checkVersion("waitlist", e, input.version, "Mục chờ")
    const now = this.now
    if (
      e.status !== "CONTACTING" ||
      e.claimedByUserId !== this.session.id ||
      !e.claimExpiresAt ||
      e.claimExpiresAt < now
    ) {
      this.fail("Nhận liên hệ (claim) trước khi ghi kết quả. Phiên liên hệ có thể đã hết hạn.", "INVALID_STATE")
    }
    if (input.channel === "PHONE_BY_AUTHORIZED" && !roleCan(this.session.role, "customer.phone.reveal")) {
      throw new ApiError(
        403,
        "PERMISSION_DENIED",
        'Lễ tân không gọi trực tiếp số của khách. Dùng "Chuyển Chủ quán gọi" hoặc kênh Zalo/Fanpage.',
        { permission: "customer.phone.reveal" },
      )
    }
    if (input.note && noteHasPhoneNumber(input.note)) this.fail(NOTE_PHONE_ERROR)
    const accepted = input.outcome === "ACCEPTED"
    if (accepted) this.require("waitlist.accept_offer")
    const offered = input.offeredTableIds ?? []
    if ((accepted || input.outcome === "OFFER_PENDING") && offered.length === 0)
      this.fail("Chọn bàn đề nghị cho khách.")
    const res = e.reservationId ? this.db.reservations.get(e.reservationId) : undefined
    const party = res?.partySize ?? e.partySize ?? 1
    if (accepted) this.maybeTriggerConflict(offered[0], e.businessDate, now)
    return this.commit(
      {
        action: accepted ? "HOLD_ACCEPTED" : "WAITLIST_CONTACT_RECORDED",
        entityType: "waitlist_entry",
        undoable: false,
      },
      (tx) => {
        const attemptNo = [...this.db.attempts.values()].filter((a) => a.entryId === e.id).length + 1
        tx.insert("attempts", {
          organizationId: ORG_ID,
          venueId: VENUE_ID,
          entryId: e.id,
          attemptNo,
          attemptedByUserId: this.session.id,
          channel: input.channel,
          startedAt: e.claimedAt ?? now,
          endedAt: now,
          outcome: input.outcome,
          offeredTableIds: offered.length ? offered : null,
          note: input.note?.trim() || null,
        })
        const row = tx.edit("waitlist", e.id)
        row.claimedByUserId = null
        row.claimedAt = null
        row.claimExpiresAt = null
        let summary = `Liên hệ lần ${attemptNo}`
        if (accepted) {
          this.assertClaimable(offered, {
            bd: e.businessDate,
            at: now,
            partySize: party,
            overrideReason: input.overrideReason,
          })
          const minutes = this.venue.waitlistHoldDefaultMinutes
          const hold = tx.insert("holds", {
            organizationId: ORG_ID,
            venueId: VENUE_ID,
            holdKind: "WAITLIST_OFFER",
            reservationId: null,
            waitlistEntryId: e.id,
            status: "ACTIVE",
            startsAt: now,
            customerConfirmedAt: now,
            deadlineAt: new Date(now.getTime() + minutes * MS.MIN),
            deadlineBasis: "DEFAULT",
            defaultMinutesSnapshot: minutes,
            deadlineSetByUserId: null,
            deadlineReason: null,
            deadlineWarnedAt: null,
            convertedAt: null,
            convertedVisitId: null,
            releasedAt: null,
            releasedByUserId: null,
            releaseReasonCode: null,
            releaseReasonNote: null,
            createdByUserId: this.session.id,
            createdAt: now,
          })
          const groupId = offered.length > 1 ? this.newGroup(tx, e.businessDate) : null
          offered.forEach((tableId) =>
            this.newAllocation(tx, {
              tableId,
              kind: "HOLD",
              holdId: hold.id,
              groupId,
              startsAt: now,
              bd: e.businessDate,
              holdStart: now,
            }),
          )
          row.status = "HOLD_ACTIVE"
          row.offeredAt = row.offeredAt ?? now
          summary = `Khách chờ nhận bàn ${this.codes(offered)} · giữ ${minutes}'`
        } else if (input.outcome === "OFFER_PENDING") {
          row.status = "OFFERED"
          row.offeredAt = now
          summary = `Đề nghị ${this.codes(offered)}, chờ khách trả lời`
        } else if (input.outcome === "WITHDREW") {
          row.status = "DECLINED"
          row.closedAt = now
          row.closedByUserId = this.session.id
          row.closeReasonCode = "CUSTOMER_WITHDREW"
          summary = "Khách rút khỏi danh sách chờ"
        } else {
          row.status = "WAITING"
        }
        return { entityId: e.id, summary }
      },
    )
  }

  async seatWaitlist(input: SeatWaitlistInput) {
    await this.latency("m")
    const e = this.entry(input.entryId)
    this.require(e.kind === "ADVANCE_RESERVATION" ? "visit.checkin" : "visit.walkin")
    this.checkVersion("waitlist", e, input.version, "Mục chờ")
    if (!(ACTIVE_ENTRY as readonly string[]).includes(e.status)) this.fail("Mục chờ đã đóng.", "INVALID_STATE")
    if (input.guestCount < 1) this.fail("Số khách phải từ 1.")
    const bd = businessDateOf(this.now)
    const hold = activeHoldForEntry(this.db, e.id)
    const holdTables = hold ? holdTableIds(this.db, hold.id) : []
    const target = input.tableIds?.length ? input.tableIds : holdTables
    if (!target.length) this.fail("Chọn bàn cho khách.")
    const sameTables = target.length === holdTables.length && target.every((t) => holdTables.includes(t))
    const res = e.reservationId ? this.db.reservations.get(e.reservationId) : undefined
    return this.commit({ action: "WAITLIST_SEATED", entityType: "waitlist_entry", undoable: true }, (tx) => {
      this.assertClaimable(target, {
        bd,
        at: this.now,
        ignore: (a) => !!hold && a.holdId === hold.id,
        overrideReason: input.overrideReason,
      })
      const v = tx.insert("visits", {
        organizationId: ORG_ID,
        venueId: VENUE_ID,
        origin: "WAITLIST",
        customerId: res?.customerId ?? e.customerId,
        contactName: res?.contactName ?? e.contactName,
        guestCount: input.guestCount,
        startedAt: this.now,
        businessDate: bd,
        endedAt: null,
        endedByUserId: null,
        endReason: null,
        mergedIntoVisitId: null,
        paidMarkedAt: null,
        paidMarkedByUserId: null,
        note: e.note,
        createdByUserId: this.session.id,
        createdAt: this.now,
      })
      this.convertHold(tx, hold, v.id, target, sameTables, bd)
      this.closeEntrySeated(tx, e.id, v.id)
      if (res && res.status === "BOOKED") {
        const r = tx.edit("reservations", res.id)
        r.status = "CHECKED_IN"
        r.visitId = v.id
        r.checkedInAt = this.now
        r.checkedInByUserId = this.session.id
      }
      return { entityId: e.id, summary: `Khách chờ nhận bàn ${this.codes(target)} · ${input.guestCount} khách` }
    })
  }

  async cancelWaitlist(entryId: number, version: number, reason: WaitlistCloseReason, note?: string) {
    await this.latency("m")
    this.require("waitlist.cancel")
    const e = this.entry(entryId)
    this.checkVersion("waitlist", e, version, "Mục chờ")
    if (!(ACTIVE_ENTRY as readonly string[]).includes(e.status)) this.fail("Mục chờ đã đóng.", "INVALID_STATE")
    if (note && noteHasPhoneNumber(note)) this.fail(NOTE_PHONE_ERROR)
    return this.commit(
      { action: "WAITLIST_CANCELLED", entityType: "waitlist_entry", undoable: true, reasonCode: reason },
      (tx) => {
        const hold = activeHoldForEntry(this.db, e.id)
        if (hold) this.releaseHoldInternal(tx, hold, "CUSTOMER_CANCELLED", "HOLD_RELEASED")
        const row = tx.edit("waitlist", e.id)
        row.status = "CANCELLED"
        row.closedAt = this.now
        row.closedByUserId = this.session.id
        row.closeReasonCode = reason
        row.closeReasonNote = note?.trim() || null
        row.claimedByUserId = null
        row.claimedAt = null
        row.claimExpiresAt = null
        return { entityId: e.id, summary: `Hủy mục chờ #${e.id}` }
      },
    )
  }

  async setHoldDeadline(holdId: number, version: number, deadlineAt: Date, reason: string) {
    await this.latency("m")
    this.require("hold.set_deadline")
    const h = this.hold(holdId)
    this.checkVersion("holds", h, version, "Giữ bàn")
    if (h.status !== "ACTIVE" || h.holdKind !== "WAITLIST_OFFER")
      this.fail("Chỉ gia hạn giữ bàn cho khách chờ đang hiệu lực.", "INVALID_STATE")
    if (!reason.trim()) this.fail("Ghi lý do gia hạn.")
    if (deadlineAt <= (h.customerConfirmedAt ?? h.startsAt)) this.fail("Hạn mới phải sau thời điểm khách xác nhận.")
    return this.commit(
      { action: "HOLD_DEADLINE_SET", entityType: "table_hold", undoable: true, reasonNote: reason },
      (tx) => {
        const row = tx.edit("holds", h.id)
        row.deadlineAt = deadlineAt
        row.deadlineBasis = "NEGOTIATED"
        row.deadlineSetByUserId = this.session.id
        row.deadlineReason = reason.trim()
        row.deadlineWarnedAt = null
        return {
          entityId: h.id,
          summary: `Gia hạn giữ ${this.codes(holdTableIds(this.db, h.id))} đến ${fmtTime(deadlineAt)}`,
        }
      },
    )
  }

  async releaseHold(holdId: number, version: number, reason: HoldReleaseReason, note?: string) {
    await this.latency("m")
    this.require("hold.release")
    const h = this.hold(holdId)
    this.checkVersion("holds", h, version, "Giữ bàn")
    if (h.status !== "ACTIVE") this.fail("Giữ bàn không còn hiệu lực.", "INVALID_STATE")
    if (reason === "OTHER" && !note?.trim()) this.fail("Ghi rõ lý do.")
    const tables = holdTableIds(this.db, h.id)
    return this.commit(
      { action: "HOLD_RELEASED", entityType: "table_hold", undoable: true, reasonCode: reason, reasonNote: note },
      (tx) => {
        this.releaseHoldInternal(tx, h, reason, "HOLD_RELEASED", note)
        if (h.waitlistEntryId) {
          const e = tx.edit("waitlist", h.waitlistEntryId)
          if (reason === "CUSTOMER_NO_SHOW") {
            e.status = "CANCELLED"
            e.closedAt = this.now
            e.closedByUserId = this.session.id
            e.closeReasonCode = "NO_SHOW_AFTER_ACCEPT"
          } else {
            e.status = "WAITING"
          }
        }
        if (h.reservationId) tx.edit("reservations", h.reservationId)
        return { entityId: h.id, summary: `Nhả giữ ${this.codes(tables)}` }
      },
    )
  }

  /* ================= customers ================= */

  async revealPhone(
    customerId: number,
    reasonCode: string,
    context: { reservationId?: number; entryId?: number },
  ): Promise<PhoneReveal> {
    await this.latency("m")
    this.require("customer.phone.reveal")
    if (!reasonCode.trim()) this.fail("Chọn lý do xem số.")
    const hourAgo = Date.now() - MS.HOUR
    this.db.revealLog = this.db.revealLog.filter((r) => r.at > hourAgo)
    if (this.db.revealLog.filter((r) => r.userId === this.session.id).length >= 30) {
      throw new ApiError(429 as number, "VALIDATION_FAILED", "Đã xem quá 30 số trong 1 giờ. Thử lại sau.")
    }
    const c = this.db.customers.get(customerId)
    if (!c || !c.phoneE164) throw new ApiError(404, "NOT_FOUND", "Khách không có số điện thoại.")
    this.db.revealLog.push({ userId: this.session.id, at: Date.now() })
    const ctx = context.reservationId
      ? ` · booking #${context.reservationId}`
      : context.entryId
        ? ` · mục chờ #${context.entryId}`
        : ""
    this.commit({ action: "CUSTOMER_PHONE_REVEALED", entityType: "customer", undoable: false, reasonCode }, () => ({
      entityId: c.id,
      summary: `Xem SĐT khách #${c.id}${ctx} · lý do: ${reasonCode}`,
    }))
    return { customerId: c.id, phoneE164: c.phoneE164, revealedAt: this.now }
  }

  async updateCustomerNotes(customerId: number, version: number, notes: string) {
    await this.latency("m")
    if (this.session.role === "CASHIER") this.require("reservation.update")
    const c = this.db.customers.get(customerId)
    if (!c) throw new ApiError(404, "NOT_FOUND", "Không tìm thấy khách.")
    this.checkVersion("customers", c, version, "Hồ sơ khách")
    if (noteHasPhoneNumber(notes)) this.fail(NOTE_PHONE_ERROR)
    if (notes.length > 500) this.fail("Ghi chú tối đa 500 ký tự.")
    return this.commit({ action: "CUSTOMER_NOTES_UPDATED", entityType: "customer", undoable: true }, (tx) => {
      const row = tx.edit("customers", c.id)
      row.notes = notes.trim() || null
      return { entityId: c.id, summary: `Sửa ghi chú khách #${c.id}` }
    })
  }

  /* ================= undo / redo ================= */

  private applyCompensation(opId: number, kind: "UNDO_APPLIED" | "REDO_APPLIED") {
    const op = this.db.ops.find((o) => o.id === opId)
    if (!op) throw new ApiError(404, "NOT_FOUND", "Không tìm thấy thao tác.")
    if (!op.isUndoable)
      throw new ApiError(
        422,
        "NOT_UNDOABLE",
        "Thao tác này không hoàn tác được (liên hệ khách, xem SĐT, cảnh báo hệ thống).",
      )
    if (op.compensatedBy) throw new ApiError(422, "NOT_UNDOABLE", "Thao tác đã được hoàn tác trước đó.")
    if (this.session.role !== "OWNER_ADMIN" && op.actorUserId !== this.session.id) {
      throw new ApiError(403, "PERMISSION_DENIED", "Lễ tân chỉ hoàn tác thao tác của chính mình.")
    }
    if (op.businessDate !== businessDateOf(this.now))
      throw new ApiError(422, "NOT_UNDOABLE", "Chỉ hoàn tác trong cùng ngày kinh doanh.")
    for (const entry of op.undo) {
      const current = (this.db[entry.col] as unknown as Map<number, { version: number }>).get(entry.id)
      const curVersion = current?.version ?? 0
      if (curVersion !== entry.afterVersion) {
        const later = this.lastTouch(entry.col, entry.id, op.id)
        throw new ApiError(
          409,
          "UNDO_CONFLICT_MODIFIED",
          `Không thể ${kind === "UNDO_APPLIED" ? "hoàn tác" : "làm lại"} "${op.summary}": dữ liệu đã được ${this.actorText(later)} thay đổi sau đó.`,
          {
            by: this.actorText(later),
            laterSummary: later?.summary ?? null,
          },
        )
      }
    }
    const result = this.commit(
      { action: kind, entityType: op.entityType, undoable: true, compensates: op.id },
      (tx) => {
        for (const entry of [...op.undo].reverse()) tx.restore(entry.col, entry.id, entry.before)
        this.assertNoDoubleBooking(op)
        return { entityId: op.entityId, summary: `${kind === "UNDO_APPLIED" ? "Hoàn tác" : "Làm lại"}: ${op.summary}` }
      },
    )
    op.compensatedBy = result.operationId
    return result
  }

  private assertNoDoubleBooking(op: MockOperation) {
    const touchedTables = new Set<number>()
    for (const e of op.undo) {
      if (e.col === "allocations") {
        const a = this.db.allocations.get(e.id) ?? (e.before as MockAllocation | undefined)
        if (a) touchedTables.add(a.tableId)
      }
    }
    const active = activeAllocations(this.db)
    for (const tableId of touchedTables) {
      const claims = active.filter((a) => a.tableId === tableId)
      const byDate = new Map<string, Set<string>>()
      for (const a of claims) {
        const key = a.visitId ? `v${a.visitId}` : `h${a.holdId}`
        if (!byDate.has(a.businessDate)) byDate.set(a.businessDate, new Set())
        byDate.get(a.businessDate)!.add(key)
      }
      for (const owners of byDate.values()) {
        if (owners.size > 1) {
          throw new ApiError(
            409,
            "TABLE_CONFLICT",
            `Không thể hoàn tác: ${this.codes([tableId])} hiện đã có khách hoặc giữ chỗ khác. Hoàn tác sẽ gây trùng bàn.`,
          )
        }
      }
    }
  }

  async undo(operationId: number) {
    await this.latency("m")
    this.require("operation.undo")
    return this.applyCompensation(operationId, "UNDO_APPLIED")
  }

  async redo(undoOperationId: number) {
    await this.latency("m")
    this.require("operation.undo")
    return this.applyCompensation(undoOperationId, "REDO_APPLIED")
  }

  /* ================= configuration ================= */

  async updateVenueConfig(patch: VenueConfigPatch) {
    await this.latency("m")
    this.require("venue.configure")
    const v = this.venue
    this.checkVersion("venue", v, patch.version, "Cấu hình quán")
    const next = { ...v, ...Object.fromEntries(Object.entries(patch).filter(([, val]) => val !== undefined)) }
    if (next.lateWarningMinutes < 1) this.fail("Mốc đến muộn phải từ 1 phút.")
    if (next.noShowWarningMinutes <= next.lateWarningMinutes) this.fail("Mốc không đến phải lớn hơn mốc đến muộn.")
    if (next.waitlistHoldDefaultMinutes < 1 || next.waitlistHoldDefaultMinutes > 240)
      this.fail("Thời gian giữ bàn từ 1 đến 240 phút.")
    if (next.waitlistClaimLeaseSeconds < 30 || next.waitlistClaimLeaseSeconds > 3600)
      this.fail("Phiên liên hệ từ 30 đến 3600 giây.")
    if (
      next.reservationHoldPolicy === "WINDOWED" &&
      !(next.reservationWindowMinutes && next.reservationWindowMinutes >= 15 && next.reservationWindowMinutes <= 720)
    ) {
      this.fail("Chính sách WINDOWED cần khung giữ bàn 15 đến 720 phút.")
    }
    const maxUsed = Math.max(0, ...[...this.db.groups.values()].filter((g) => !g.dissolvedAt).map((g) => g.symbolNo))
    if (next.groupSymbolCount < 1 || next.groupSymbolCount > 12)
      this.fail("Số ký hiệu ghép từ 1 đến 12 (bộ ký hiệu hiện có).")
    if (next.groupSymbolCount < maxUsed) this.fail(`Đang dùng ký hiệu số ${maxUsed}, không giảm thấp hơn.`)
    const result = this.commit({ action: "VENUE_CONFIG_UPDATED", entityType: "venue", undoable: true }, (tx) => {
      const row = tx.edit("venue", v.id)
      row.lateWarningMinutes = next.lateWarningMinutes
      row.noShowWarningMinutes = next.noShowWarningMinutes
      row.waitlistHoldDefaultMinutes = next.waitlistHoldDefaultMinutes
      row.waitlistClaimLeaseSeconds = next.waitlistClaimLeaseSeconds
      row.reservationHoldPolicy = next.reservationHoldPolicy
      row.reservationWindowMinutes = next.reservationHoldPolicy === "SEQUENTIAL" ? null : next.reservationWindowMinutes
      row.groupSymbolCount = next.groupSymbolCount
      return { entityId: v.id, summary: "Cập nhật cấu hình quán" }
    })
    return { ...result, venue: venueConfig(this.db) }
  }

  async setZoneFlags(zoneId: number, version: number, flags: { isBookable: boolean; isWaitingArea: boolean }) {
    await this.latency("m")
    this.require("venue.configure")
    const z = this.db.zones.get(zoneId)
    if (!z) throw new ApiError(404, "NOT_FOUND", "Không tìm thấy khu.")
    this.checkVersion("zones", z, version, z.name)
    if (flags.isBookable && flags.isWaitingArea) this.fail("Khu chờ không thể đồng thời nhận đặt bàn.")
    return this.commit({ action: "ZONE_CONFIG_UPDATED", entityType: "zone", undoable: true }, (tx) => {
      const row = tx.edit("zones", z.id)
      row.isBookable = flags.isBookable
      row.isWaitingArea = flags.isWaitingArea
      return {
        entityId: z.id,
        summary: `${z.name}: ${flags.isBookable ? "nhận khách" : flags.isWaitingArea ? "khu chờ" : "tạm đóng"}`,
      }
    })
  }

  /* ================= system job (simulated 30s backend worker) ================= */

  private tick() {
    const now = this.now
    const bd = businessDateOf(now)
    const venue = this.venue
    for (const r of this.db.reservations.values()) {
      if (r.status !== "BOOKED" || r.businessDate !== bd) continue
      const w = reservationWarning(venue, r, now)
      const hold = activeReservationHold(this.db, r.id)
      const where = hold ? this.codes(holdTableIds(this.db, hold.id)) : "Chưa có bàn"
      if (w.warning && !r.lateWarnedAt) {
        r.lateWarnedAt = now
        this.systemLog(
          "RESERVATION_LATE_WARNING",
          "reservation",
          r.id,
          `${where} · booking ${fmtTime(r.expectedAt)} đến muộn ${venue.lateWarningMinutes}'`,
        )
      }
      if (w.warning === "noshow" && !r.noShowWarnedAt) {
        r.noShowWarnedAt = now
        this.systemLog(
          "RESERVATION_NO_SHOW_WARNING",
          "reservation",
          r.id,
          `${where} · booking ${fmtTime(r.expectedAt)} chưa đến sau ${venue.noShowWarningMinutes}'`,
        )
      }
    }
    for (const h of this.db.holds.values()) {
      if (
        h.status === "ACTIVE" &&
        h.holdKind === "WAITLIST_OFFER" &&
        h.deadlineAt &&
        h.deadlineAt < now &&
        !h.deadlineWarnedAt
      ) {
        h.deadlineWarnedAt = now
        this.systemLog(
          "HOLD_DEADLINE_WARNING",
          "table_hold",
          h.id,
          `${this.codes(holdTableIds(this.db, h.id))} · quá hạn giữ cho khách chờ`,
        )
      }
    }
    for (const e of this.db.waitlist.values()) {
      if (e.status === "CONTACTING" && e.claimExpiresAt && e.claimExpiresAt < now) {
        e.status = e.offeredAt ? "OFFERED" : "WAITING"
        e.claimedByUserId = null
        e.claimedAt = null
        e.claimExpiresAt = null
        e.version += 1
        this.systemLog("WAITLIST_CLAIM_RELEASED", "waitlist_entry", e.id, `Hết phiên liên hệ mục chờ #${e.id}`)
      }
    }
  }

  /* ================= demo controls ================= */

  get conflictArmed() {
    return this.armed
  }

  armConflictOnce() {
    this.armed = true
  }

  reset() {
    this.db = seedDb(clock.now())
    this.seq = venueOf(this.db).changeSeq
    this.emit({
      latestSeq: this.seq,
      action: "RESET",
      entityType: "venue",
      actorKind: "SYSTEM",
      actorUserId: null,
      summary: "Đã nạp lại dữ liệu mẫu",
    })
  }

  async simulateRemoteActivity(): Promise<string> {
    await this.latency("m")
    const remote = this.db.users.get(REMOTE_USER_ID)!
    const mine = [...this.db.ops]
      .reverse()
      .find((o) => o.actorUserId === this.session.id && o.isUndoable && !o.compensatedBy)
    const target = mine?.undo.find(
      (e) => (e.col === "reservations" || e.col === "visits") && (this.db[e.col] as Map<number, unknown>).has(e.id),
    )
    if (mine && target) {
      const label = target.col === "reservations" ? "booking" : "lượt ghé"
      this.commit(
        {
          action: target.col === "reservations" ? "RESERVATION_UPDATED" : "VISIT_UPDATED",
          entityType: target.col === "reservations" ? "reservation" : "visit",
          undoable: false,
          actorUserId: remote.id,
        },
        (tx) => {
          const row = tx.edit(target.col as "reservations" | "visits", target.id)
          row.note = `${row.note ? `${row.note} · ` : ""}Đã xác nhận lại với khách (${remote.deviceLabel})`
          return { entityId: target.id, summary: `Cập nhật ghi chú ${label}` }
        },
      )
      return `${remote.displayName} (${remote.deviceLabel}) vừa sửa ${label} liên quan tới "${mine.summary}". Thử Hoàn tác để xem cảnh báo xung đột.`
    }
    const bd = businessDateOf(this.now)
    const free = [...this.db.tables.values()].filter((t) => {
      const zone = this.db.zones.get(t.zoneId)!
      return (
        t.kind === "TABLE" &&
        t.status === "ACTIVE" &&
        !t.isSpare &&
        zone.isBookable &&
        blockingAllocations(this.db, t.id, bd).length === 0
      )
    })
    if (!free.length) return `${remote.displayName}: không còn bàn trống để mô phỏng.`
    const t = free[Math.floor(Math.random() * free.length)]
    this.commit({ action: "WALKIN_SEATED", entityType: "visit", undoable: false, actorUserId: remote.id }, (tx) => {
      const v = tx.insert("visits", {
        organizationId: ORG_ID,
        venueId: VENUE_ID,
        origin: "WALK_IN",
        customerId: null,
        contactName: null,
        guestCount: 2,
        startedAt: this.now,
        businessDate: bd,
        endedAt: null,
        endedByUserId: null,
        endReason: null,
        mergedIntoVisitId: null,
        paidMarkedAt: null,
        paidMarkedByUserId: null,
        note: null,
        createdByUserId: remote.id,
        createdAt: this.now,
      })
      this.newAllocation(tx, { tableId: t.id, kind: "USAGE", visitId: v.id, startsAt: this.now, bd })
      return { entityId: v.id, summary: `Walk-in ${t.code} · 2 khách` }
    })
    return `${remote.displayName} (${remote.deviceLabel}) vừa nhận Walk-in vào ${t.code}.`
  }
}

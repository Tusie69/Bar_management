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
import { MockCustomerHistory } from "./customer-history"
import { addDays, atBusinessTime, businessDateOf, fmtTime, fromVenueLocal, MS, type BusinessDate } from "@/lib/time"
import { roleCan, PERMISSION_LABEL, type Permission } from "@/domain/access"
import {
  BOOKING_MINUTE_STEP,
  isShiftBoundary,
  isWithinBookingReceptionWindow,
  normalizeShiftBoundary,
  shiftServesBookingWindow,
} from "@/domain/booking-rules"
import {
  ROLE_LABEL,
  type RoleCode,
  type AllocationReleaseReason,
  type HoldReleaseReason,
  type ReservationCloseReason,
  type WaitlistCloseReason,
} from "@/domain/enums"
import { callTargetKey } from "@/domain/call-target"
import { redactFloorForWaiter } from "@/domain/waiter-privacy"
import type {
  CallOutcome,
  CallTarget,
  ChangeEvent,
  CustomerSummary,
  MutationResult,
  PhoneReveal,
  ReceptionGuestCount,
  ReceptionGuestCountValues,
  ReportQuery,
  ReservationView,
  SessionUser,
  TableTurnQuery,
  TableTurnsParams,
} from "@/domain/models"
import type { ReservationRow, TableHoldRow, VisitRow, WaitlistEntryRow } from "@/domain/schema"
import { GROUP_SYMBOL_COUNT_MAX, symbolByNo } from "@/domain/symbols"
import { groupCodeFromSymbol } from "@/domain/group-code"
import { clock } from "../clock"
import {
  ApiError,
  type AddWaitlistInput,
  type CheckInInput,
  type CombineInput,
  type CreateTableGroupInput,
  type DissolveTableGroupInput,
  type AddTableGroupMembersInput,
  type CreateReservationInput,
  type GamApi,
  type MoveInput,
  type RecordContactInput,
  type ReservationQuery,
  type SeatWaitlistInput,
  type SplitInput,
  type UpdateReservationInput,
  type VenueConfigPatch,
  type VenueSettingsUpdate,
  type WaiterVisitTablesInput,
  type WalkInInput,
} from "../contracts"
import {
  ORG_ID,
  VENUE_ID,
  type CollectionName,
  type MockAllocation,
  type MockDb,
  type MockOperation,
  type MockReservation,
} from "./db"
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
  groupSymbolNo,
  holdTableIds,
  operationView,
  projectTableTurns,
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
import {
  DEMO_USERS,
  REMOTE_USER_ID,
  paymentTableSignature,
  seedDb,
  seedPaymentBills,
  type SeededPaymentBillInput,
} from "./seed"
import { mockTableTurns, mockTableTurnSummary } from "./table-turns"
import { Tx } from "./tx"
import { formatDailyBookingText } from "./booking-export"
import { apiErrorMessage } from "../error-messages"
import { calcBillTotals, formatVnd, sortOpenBills } from "../payment/calc"
import type {
  BillPayStatus,
  CancelRequest,
  PaidBillSummary,
  PayBill,
  PayBillSummary,
  PayLine,
  PaymentAuditAction,
  PaymentAuditEntry,
  PaymentMethod,
  PaymentNotification,
  PaymentNotificationType,
  PreviewBill,
  Receipt,
  SessionBills,
  VisitPayStatus,
} from "../payment/contracts"

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
  silent?: boolean
}

interface CommitOut<T> {
  entityId: number
  summary: string
  extra?: T
}

type InvoiceIssuerRole = "WAITER" | "BAR" | "CASHIER" | "OWNER" | "ADMIN"

interface IssuedBillRecord {
  billCode: string
  billStatus: BillPayStatus
  lines: PayLine[]
  issuedAt: string
  issuedAtDate: Date
  issuedBy: string
  issuedByRole: InvoiceIssuerRole
  pendingAt?: string
  pendingAtDate?: Date
  paidAt?: string
  paidAtDate?: Date
  paidMethod?: PaymentMethod
  paidBy?: string
  manualConfirm?: boolean
  cancelPending?: boolean
}

interface PaymentVisitMeta {
  /** Mon goi chua chot vao hoa don (V12: preview/order round tiep theo). */
  unbilledLines: PayLine[]
  /** Cac hoa don da chot theo thu tu thoi gian cu -> moi. */
  bills: IssuedBillRecord[]
  nextBillSeq: number
  requestedAt?: string
  requestedAtDate?: Date
  waiterName: string
  versionOffset: number
  closedTables?: string[]
  closedClusterCode?: string
  lastClosedAllocIds?: number[]
}

interface CancelRequestInternal extends CancelRequest {
  requestedByUserId: number
}

export interface DemoControls {
  simulateRemoteActivity(): Promise<string>
  armConflictOnce(): void
  readonly conflictArmed: boolean
  reset(): void
}

export class MockGamApi implements GamApi, DemoControls {
  readonly mode = "mock" as const
  private history = this.createCustomerHistory()
  private createCustomerHistory() {
    return new MockCustomerHistory(
      () => this.db,
      () => this.session,
      () => this.now,
      (action, entity, id, before, after) => {
        this.systemLog(action, entity, id, action, this.session.id)
        const op = this.db.ops[this.db.ops.length - 1]
        op.actorKind = "USER"
        op.actorUserId = this.session.id
        op.actorMembershipId = this.session.id
        op.changes = [{ type: entity, id, before, after }]
        op.entityVersionBefore = typeof before.version === "number" ? before.version : null
        op.entityVersionAfter = typeof after.version === "number" ? after.version : null
        return op.id
      },
    )
  }
  getAnonymousVisits: GamApi["getAnonymousVisits"] = (query) => this.history.getAnonymousVisits(query)
  assignAnonymousVisit: GamApi["assignAnonymousVisit"] = (input) => this.history.assignAnonymousVisit(input)
  undoAnonymousAssignment: GamApi["undoAnonymousAssignment"] = (input) => this.history.undoAnonymousAssignment(input)
  getDuplicateCustomers: GamApi["getDuplicateCustomers"] = (query) => this.history.getDuplicateCustomers(query)
  mergeDuplicateCustomers: GamApi["mergeDuplicateCustomers"] = (input) => this.history.mergeDuplicateCustomers(input)
  dismissDuplicateCustomers: GamApi["dismissDuplicateCustomers"] = (input) =>
    this.history.dismissDuplicateCustomers(input)
  private db: MockDb
  private session: SessionUser
  private seq: number
  private listeners = new Set<(event: ChangeEvent) => void>()
  private armed = false
  private guestCounts = new Map<BusinessDate, ReceptionGuestCount>()
  private quickTimes = ["21:00", "21:30", "22:00", "22:30"]
  /** In-memory stand-in for booking_call_logs, so the history panel has data. */
  private callLog: {
    callId: number
    /** `booking:11`, `waitlist:4`, `visit:9` - ba không gian id riêng. */
    targetKey: string
    initiatedAt: Date
    initiatedBy: string
    outcome: "CONTACTED" | "NO_ANSWER" | "LATE_CONFIRMED" | null
    outcomeAt: Date | null
    outcomeBy: string | null
  }[] = []
  private readonly businessDayWorkerEnabled: boolean
  private paymentMeta = new Map<number, PaymentVisitMeta>()
  private paymentPaidLog: PaymentNotification[] = []
  private paymentEventLog: PaymentNotification[] = []
  private paymentIdempotency = new Map<string, { fingerprint: string; receipt: Receipt }>()
  private paymentIssueIdempotency = new Map<string, { fingerprint: string; bill: PayBill }>()
  private cancelRequests: CancelRequestInternal[] = []
  private cancelRequestSeq = 1
  private paymentAuditLog: PaymentAuditEntry[] = []
  private paymentAuditSeq = 1
  private paymentAttemptKeys: string[] = []
  private paymentFault: { nextConfirm?: "net" | "dup"; qrFound?: boolean; billDelayMs?: number } = {}

  constructor(options: { businessDayWorkerEnabled?: boolean } = {}) {
    this.businessDayWorkerEnabled = options.businessDayWorkerEnabled ?? true
    this.db = seedDb(clock.now())
    this.initPaymentBills()
    this.seq = venueOf(this.db).changeSeq
    setInterval(() => this.tick(), 5_000)
    clock.subscribe(() => this.tick())
    const first = DEMO_USERS[0]
    this.session = { ...first }
  }

  /* ================= infrastructure ================= */

  private get now() {
    return clock.now()
  }

  async getTableTurns(params: TableTurnsParams) {
    await this.latency("q")
    this.require("report.read")
    return mockTableTurns(projectTableTurns(this.db), params)
  }

  async getTableTurnSummary(params: TableTurnQuery) {
    await this.latency("q")
    this.require("report.read")
    return mockTableTurnSummary(projectTableTurns(this.db), params, this.scopeInventory())
  }

  /**
   * TU-38 — the countable scopes the averages divide by. The mock floor has no fixed
   * cluster, so a scope is an ACTIVE non-spare table, exactly as the API computes it from
   * `dining_tables` minus the tables a LAYOUT cluster owns.
   */
  private scopeInventory() {
    const venueId = this.venue.id
    const tables = [...this.db.tables.values()].filter(
      (table) => table.venueId === venueId && table.status === "ACTIVE" && !table.isSpare,
    )
    return {
      scopes: tables.map((table) => ({
        scope: "TABLE" as const,
        tableId: table.id,
        groupId: null,
        label: table.code,
      })),
      physicalTableTotal: tables.length,
    }
  }

  private get venue() {
    return venueOf(this.db)
  }

  private async latency(kind: "q" | "m") {
    const [min, max] = kind === "q" ? [50, 130] : [140, 320]
    await sleep(min + Math.random() * (max - min))
  }

  async getReceptionGuestCount(businessDate: BusinessDate): Promise<ReceptionGuestCount> {
    await this.latency("q")
    this.require("customer.view_masked")
    const stored = this.guestCounts.get(businessDate)
    return stored
      ? structuredClone(stored)
      : {
          businessDate,
          arrivedBefore: 0,
          arrivedAfter: 0,
          arrivedTotal: 0,
          bookedTables: 0,
          bookedGuests: 0,
          returningGuests: 0,
          version: 0,
          updatedAt: null,
        }
  }

  async updateReceptionGuestCount(
    input: ReceptionGuestCountValues & { businessDate: BusinessDate; version: number },
  ): Promise<ReceptionGuestCount> {
    await this.latency("m")
    this.require("reservation.update")
    const current = await this.getReceptionGuestCount(input.businessDate)
    if (input.version !== current.version) {
      throw new ApiError(409, "GUEST_COUNT_VERSION_CONFLICT", "Bộ đếm khách vừa được cập nhật trên máy khác.")
    }
    const saved: ReceptionGuestCount = {
      ...input,
      version: current.version + 1,
      updatedAt: this.now,
    }
    this.guestCounts.set(input.businessDate, structuredClone(saved))
    this.seq += 1
    this.venue.changeSeq = this.seq
    this.emit({
      latestSeq: this.seq,
      action: "RECEPTION_GUEST_COUNT_UPDATED",
      entityType: "guest_count",
      actorKind: "USER",
      actorUserId: this.session.id,
      summary: "Đã cập nhật bộ đếm khách",
    })
    return structuredClone(saved)
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
    if (!meta.silent) {
      this.emit({
        latestSeq: this.seq,
        action: meta.action,
        entityType: meta.entityType,
        actorKind: op.actorKind,
        actorUserId: op.actorUserId,
        summary: out.summary,
      })
    }
    return {
      ...(out.extra as T),
      operationId: op.id,
      changeSeq: this.seq,
      summary: out.summary,
      undoable: meta.undoable,
    }
  }

  private systemLog(
    action: string,
    entityType: string,
    entityId: number,
    summary: string,
    actorUserId: number | null = null,
  ) {
    this.seq += 1
    this.venue.changeSeq = this.seq
    this.db.ops.push({
      id: this.db.nextId.ops++,
      organizationId: ORG_ID,
      venueId: VENUE_ID,
      changeSeq: this.seq,
      occurredAt: this.now,
      actorKind: actorUserId === null ? "SYSTEM" : "USER",
      actorUserId,
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
    this.emit({
      latestSeq: this.seq,
      action,
      entityType,
      actorKind: actorUserId === null ? "SYSTEM" : "USER",
      actorUserId,
      summary,
    })
  }

  /* ================= claim helpers ================= */

  private assertBookingSlot(at: Date) {
    const minute = Number(fmtTime(at).slice(3))
    if (minute % BOOKING_MINUTE_STEP !== 0 || at.getSeconds() !== 0 || at.getMilliseconds() !== 0)
      throw new ApiError(400, "EXPECTED_AT_OFF_SLOT", `Giờ đến phải theo bước ${BOOKING_MINUTE_STEP} phút.`)
  }

  /** Booking endpoints and visit moves do not accept the demo walk-in overrides. */
  private assertBookingTables(tableIds: number[], _partySize: number, _sameZone = false) {
    if (!tableIds.length) throw new ApiError(400, "TABLE_REQUIRED", "Cần chọn ít nhất một bàn.")
    this.layoutGroupFor(tableIds)
    const tables = tableIds.map((id) => this.db.tables.get(id))
    if (tables.some((table) => !table || table.status !== "ACTIVE")) {
      throw new ApiError(400, "TABLE_NOT_FOUND", "Có bàn không tồn tại hoặc ngừng hoạt động.")
    }
    const selected = tables.filter((table) => table !== undefined)
    const nonBookable = selected.find((table) => !this.db.zones.get(table.zoneId)?.isBookable)
    if (nonBookable) throw new ApiError(409, "ZONE_NOT_BOOKABLE", `Khu của bàn ${nonBookable.code} không nhận khách.`)
    const spare = selected.find((table) => table.isSpare)
    if (spare) throw new ApiError(409, "SPARE_TABLE_NOT_BOOKABLE", `Bàn ${spare.code} là bàn sơ cua.`)
    // Mock-only pending Tu (K1 Section 5): allow cross-zone and table+bar combinations so the UI can be reviewed.
    // The server on HTTP still limits this (returning TABLE_ZONE_MISMATCH / TABLE_KIND_MISMATCH).
  }

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
    this.layoutGroupFor(tableIds)
    if (new Set(tableIds).size !== tableIds.length) this.fail("Danh sách bàn bị trùng.")
    const spare: string[] = []
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
    }
    const needs: string[] = []
    if (spare.length) needs.push(`dùng bàn sơ cua ${spare.join(", ")}`)
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
      [...this.db.groups.values()]
        .filter((g) => (g.businessDate === bd || g.layoutTableIds) && !g.dissolvedAt)
        .map((g) => g.symbolNo),
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
      if (!stillUsed && g && !g.dissolvedAt && !g.layoutTableIds) {
        const row = tx.edit("groups", gid)
        row.dissolvedAt = this.now
        row.dissolvedByUserId = this.session.id
      }
    }
  }

  // Mock-only C1: booking targets the whole independent layout; allocation release never destroys it.
  private expandLayoutTables(tableIds: number[]) {
    if (new Set(tableIds).size !== tableIds.length) this.fail("Danh sách bàn bị trùng.")
    return [
      ...new Set(
        tableIds.flatMap(
          (id) =>
            [...this.db.groups.values()].find((g) => !g.dissolvedAt && g.layoutTableIds?.includes(id))
              ?.layoutTableIds ?? [id],
        ),
      ),
    ]
  }

  private layoutGroupFor(tableIds: number[]) {
    const groups = [...this.db.groups.values()].filter(
      (g) => !g.dissolvedAt && g.layoutTableIds?.some((id) => tableIds.includes(id)),
    )
    if (!groups.length) return null
    const g = groups[0]
    if (
      groups.length > 1 ||
      g.layoutTableIds!.length !== tableIds.length ||
      g.layoutTableIds!.some((id) => !tableIds.includes(id))
    )
      this.fail("Chọn toàn bộ nhóm mặt bằng, hoặc tách nhóm trước khi đổi thành viên.")
    return g.id
  }

  private createHoldForReservation(
    tx: Tx,
    r: ReservationRow,
    tableIds: number[],
    existingGroupId: number | null = null,
  ) {
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
    const groupId =
      tableIds.length > 1
        ? (existingGroupId ?? this.layoutGroupFor(tableIds) ?? this.newGroup(tx, r.businessDate))
        : null
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

  private res(id: number): MockReservation {
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
            customerClassification: "UNCLASSIFIED",
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
            lateConfirmedAt: null,
            lateConfirmedByUserId: null,
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

  /**
   * BA-022: the demo server has no account store. It lists its demo users so the
   * admin account screen renders, and refuses the mutations, which only the real
   * backend performs.
   */
  async listAccounts() {
    await this.latency("q")
    this.require("user.read")
    return {
      accounts: DEMO_USERS.filter((u) => u.id !== REMOTE_USER_ID).map((u) => ({
        id: u.id,
        username: u.displayName.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
        displayName: u.displayName,
        status: "ACTIVE" as const,
        membershipStatus: "ACTIVE",
        roles: [u.role],
        accessLevel: u.role === "ADMIN" ? ("WRITE" as const) : null,
        lastLoginAt: null,
        version: 1,
      })),
      roles: (Object.keys(ROLE_LABEL) as RoleCode[]).map((code) => ({ code, name: ROLE_LABEL[code] })),
    }
  }

  /**
   * TU-35: chế độ demo không có nhật ký thật.
   *
   * Trả về đúng bộ nhóm lọc và một trang rỗng, thay vì bịa vài dòng mẫu: một
   * nhật ký giả trông y như thật là thứ nguy hiểm nhất trong màn này — nó
   * được dùng để truy trách nhiệm.
   */
  async getAuditFilters() {
    await this.latency("q")
    this.require("audit.read")
    return {
      filters: [
        { type: "booking_cancel", label: "Hủy booking", supported: true },
        { type: "table_move", label: "Đổi bàn", supported: true },
        { type: "phone_reveal", label: "Xem SĐT đầy đủ", supported: true },
        {
          type: "discount",
          label: "Giảm giá / hủy món",
          supported: false,
          note: "Chưa có module gọi món và thanh toán nên chưa có thao tác nào thuộc nhóm này.",
        },
        { type: "login", label: "Đăng nhập", supported: true },
        { type: "permission", label: "Đổi quyền", supported: true },
        { type: "account", label: "Tài khoản", supported: true },
      ],
      retentionDays: 90,
      canExport: false,
    }
  }

  async listAuditEntries() {
    await this.latency("q")
    this.require("audit.read")
    return {
      entries: [],
      hasMore: false,
      nextCursor: null,
      retentionDays: 90,
      windowStart: new Date(Date.now() - 90 * 86_400_000).toISOString(),
    }
  }

  async exportAuditCsv(): Promise<never> {
    await this.latency("q")
    this.require("audit.read")
    return this.fail("Chế độ demo không có nhật ký để xuất. Dùng máy chủ thật.")
  }

  /**
   * TU-34: bảng checkbox ở chế độ demo được suy từ ma trận vai trò, không có
   * override. Đủ để xem layout; mọi thay đổi vẫn phải làm trên máy chủ thật.
   */
  async getAccountPermissions(userId: number) {
    await this.latency("q")
    this.require("user.read")
    const account = (await this.listAccounts()).accounts.find((item) => item.id === userId)
    if (!account) return this.fail("Không tìm thấy tài khoản trong dữ liệu mẫu.")
    const role = (account.roles[0] ?? "RECEPTIONIST") as RoleCode
    return {
      account,
      permissions: (Object.keys(PERMISSION_LABEL) as Permission[]).sort().map((code) => {
        const grantedByRole = roleCan(role, code)
        // Demo không có override: trần = mọi quyền trừ việc riêng của OWNER.
        const grantable = code !== "venue.configure" && code !== "customer.anonymize"
        return { code, grantedByRole, enabled: grantedByRole, overridden: false, editable: grantable, grantable }
      }),
    }
  }

  async updateAccountPermissions(): Promise<never> {
    await this.latency("q")
    this.require("user.manage")
    return this.fail("Chế độ demo không lưu được quyền. Dùng máy chủ thật để đổi quyền tài khoản.")
  }

  async createAccount(): Promise<never> {
    await this.latency("q")
    this.require("user.manage")
    return this.fail("Chế độ demo không tạo được tài khoản. Dùng máy chủ thật để quản lý tài khoản.")
  }

  async setAccountStatus(): Promise<never> {
    await this.latency("q")
    this.require("user.manage")
    return this.fail("Chế độ demo không khóa/mở được tài khoản. Dùng máy chủ thật để quản lý tài khoản.")
  }

  async setAdminAccessLevel(): Promise<never> {
    await this.latency("q")
    this.require("user.manage")
    return this.fail("Chế độ demo không đổi được cấp truy cập. Dùng máy chủ thật để quản lý tài khoản.")
  }

  async resetAccountPassword(): Promise<never> {
    await this.latency("q")
    this.require("user.manage")
    return this.fail("Chế độ demo không đặt lại được mật khẩu. Dùng máy chủ thật để quản lý tài khoản.")
  }

  async changeOwnPassword(): Promise<never> {
    await this.latency("q")
    return this.fail("Chế độ demo không đổi được mật khẩu. Dùng máy chủ thật để quản lý tài khoản.")
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

  async getVenueSettings() {
    await this.latency("q")
    return {
      quickTimes: [...this.quickTimes],
      upcomingMinutes: this.venue.upcomingWarningMinutes,
      noShowMinutes: this.venue.noShowWarningMinutes,
      businessDayStartLocal: this.venue.businessDayStartLocal,
      businessDayCutoffLocal: this.venue.businessDayCutoffLocal,
    }
  }

  async getFloorState(at: Date, businessDate?: BusinessDate) {
    await this.latency("q")
    return floorState(this.db, at, businessDate, businessDateOf(this.now))
  }

  /**
   * Module Phục vụ 1 — sơ đồ cho vai WAITER.
   *
   * Ở chế độ HTTP việc lược dữ liệu khách do máy chủ làm. Mock không có máy
   * chủ, nên nó phải tự lược ngay tại đây: nếu không, bản demo sẽ hiện tên
   * khách trên màn Phục vụ và người xem demo sẽ tin đó là thiết kế.
   */
  async getWaiterFloor(businessDate: BusinessDate) {
    await this.latency("q")
    return {
      catalog: catalog(this.db),
      floor: redactFloorForWaiter(floorState(this.db, this.now, businessDate, businessDateOf(this.now))),
    }
  }

  /** Module Phục vụ 1: mock không có quyền nên catalog hai vai giống nhau. */
  async getWaiterCatalog() {
    await this.latency("q")
    return catalog(this.db)
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
      rows = rows.filter((r) => r.businessDate === q.businessDate && m.reservation(r)).slice(0, m.digits ? 20 : 50)
    } else {
      rows = rows.filter((r) => r.businessDate === q.businessDate)
    }
    return rows
      .sort((a, b) => a.expectedAt.getTime() - b.expectedAt.getTime())
      .map((r) => reservationView(this.db, r, this.now))
  }

  async searchReception(businessDate: BusinessDate, query: { last3?: string; name?: string }) {
    const needle = query.last3 ?? query.name ?? ""
    const matches = searchMatches(this.db, needle)
    const bookings = [...this.db.reservations.values()]
      .filter((row) => row.businessDate === businessDate && matches.reservation(row))
      .map((row) => {
        const view = reservationView(this.db, row, this.now)
        return { id: view.id, displayName: view.displayName, phoneLast3: view.phoneLast3, tableIds: view.tableIds }
      })
    const waitlist = [...this.db.waitlist.values()]
      .filter(
        (row) =>
          row.businessDate === businessDate && ["WAITING", "CONTACTING", "OFFERED", "HOLD_ACTIVE"].includes(row.status),
      )
      .filter((row) => {
        const reservation = row.reservationId ? this.db.reservations.get(row.reservationId) : undefined
        if (reservation) return matches.reservation(reservation)
        const customer = row.customerId ? this.db.customers.get(row.customerId) : undefined
        return query.last3
          ? customer?.phoneLast3 === query.last3
          : foldVietnamese(customer?.displayName ?? row.contactName ?? "").includes(foldVietnamese(query.name ?? ""))
      })
      .map((row) => {
        const reservation = row.reservationId ? this.db.reservations.get(row.reservationId) : undefined
        const customer = row.customerId ? this.db.customers.get(row.customerId) : undefined
        return {
          id: row.id,
          reservationId: row.reservationId,
          displayName: customer?.displayName ?? reservation?.contactName ?? row.contactName ?? "Khách chờ",
          phoneLast3:
            customer?.phoneLast3 ?? (reservation ? reservationView(this.db, reservation, this.now).phoneLast3 : null),
          tableIds: holdTableIds(
            this.db,
            activeHoldForEntry(this.db, row.id)?.id ?? activeReservationHold(this.db, reservation?.id ?? 0)?.id ?? 0,
          ),
          status: row.status,
        }
      })
    const ids = new Set(bookings.map((row) => row.id))
    const linked = waitlist.filter((row) => row.reservationId !== null && ids.has(row.reservationId)).length
    return {
      businessDate,
      query,
      bookings,
      waitlist,
      summary: {
        bookingCount: bookings.length,
        waitlistCount: waitlist.length,
        totalCount: bookings.length + waitlist.length - linked,
      },
    }
  }

  async exportDailyBookingText(bd: BusinessDate): Promise<string> {
    this.require("customer.view_masked")
    const reservations = await this.listReservations({ businessDate: bd })
    const cat = catalog(this.db)
    const tableInfo = (table: (typeof cat.tables)[number]) => ({
      code: table.code,
      zoneCode: table.zoneCode,
      zoneName: cat.zones.find((zone) => zone.id === table.zoneId)?.name ?? table.zoneCode,
    })
    return formatDailyBookingText({
      businessDate: bd,
      bookings: reservations.map((row) => ({
        id: row.id,
        guestName: row.displayName,
        partySize: row.partySize,
        expectedAt: row.expectedAt,
        checkedInAt: row.checkedInAt,
        status: row.status,
        sourceCode: row.sourceCode,
        socialPlatform: row.socialPlatform ?? null,
        honorific: row.honorific ?? null,
        tables: cat.tables.filter((table) => row.tableIds.includes(table.id)).map(tableInfo),
        // Round has no persisted field yet; the other flags come from the reservation.
        metadata: {
          bossTable: row.iconKeys?.includes("star") ?? false,
          designated: row.iconKeys?.includes("pin") ?? false,
          birthday: row.isBirthday,
          round: null,
          returningCustomer: row.classification === "RETURNING" ? true : row.classification === "NEW" ? false : null,
        },
      })),
      waitlistCount: [...this.db.waitlist.values()].filter(
        (entry) => entry.businessDate === bd && ["WAITING", "CONTACTING", "OFFERED"].includes(entry.status),
      ).length,
      outTables: cat.tables.filter((table) => table.status === "OUT_OF_SERVICE").map(tableInfo),
      arrivalCutoff: { hour: 21, minute: 30, basis: "EXPECTED_AT", atCutoff: "BEFORE" },
    })
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

  async getUndoState() {
    return { undo: null, redo: null }
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
    input = { ...input, tableIds: this.expandLayoutTables(input.tableIds ?? []) }
    const name = input.contactName?.trim() || undefined
    const phone = input.phone?.trim() || undefined
    if (!name && !phone) this.fail("Đặt trước cần ít nhất tên hoặc số điện thoại.")
    if (!Number.isInteger(input.partySize) || input.partySize < 1 || input.partySize > 500)
      this.fail("Số khách phải từ 1 đến 500.")
    if (input.note && noteHasPhoneNumber(input.note)) this.fail(NOTE_PHONE_ERROR)
    if (input.expectedAt.getTime() < this.now.getTime() - 5 * MS.MIN) this.fail("Giờ đến đã qua.")
    if (!isWithinBookingReceptionWindow(fmtTime(input.expectedAt))) {
      throw new ApiError(
        400,
        "EXPECTED_AT_OUTSIDE_BOOKING_WINDOW",
        "Giờ nhận booking chỉ từ 19:00 đến 01:00 sáng hôm sau.",
      )
    }
    this.assertBookingSlot(input.expectedAt)
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
          // Mock-only booking form metadata.
          socialPlatform: input.sourceCode === "SOCIAL" ? (input.socialPlatform ?? null) : null,
          iconKeys: [...(input.iconKeys ?? [])],
          honorific: input.honorific ?? null,
          partySize: input.partySize,
          expectedAt: input.expectedAt,
          businessDate: bd,
          customerClassification: input.classification ?? "UNCLASSIFIED",
          guestType:
            input.guestType ??
            (input.classification === "RETURNING" ? "REGULAR" : input.classification === "NEW" ? "NEW" : null),
          isBirthday: input.isBirthday ?? false,
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
          lateConfirmedAt: null,
          lateConfirmedByUserId: null,
          noShowWarnedAt: null,
          createdByUserId: this.session.id,
          createdAt: this.now,
          updatedByUserId: null,
          updatedAt: this.now,
        })
        let summary = `Booking ${fmtTime(input.expectedAt)} · ${input.partySize} khách`
        if (tableIds.length) {
          this.assertBookingTables(tableIds, input.partySize, true)
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
    if (
      input.partySize !== undefined &&
      (!Number.isInteger(input.partySize) || input.partySize < 1 || input.partySize > 500)
    )
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
      // Mock-only booking form metadata follows the effective source.
      if (this.db.sources.get(row.sourceId)?.code !== "SOCIAL") row.socialPlatform = null
      else if (input.socialPlatform !== undefined) row.socialPlatform = input.socialPlatform
      if (input.iconKeys !== undefined) row.iconKeys = [...input.iconKeys]
      if (input.honorific !== undefined) row.honorific = input.honorific
      if (input.note !== undefined) row.note = input.note?.trim() || null
      if (input.classification !== undefined) row.customerClassification = input.classification
      if (input.guestType !== undefined) row.guestType = input.guestType
      else if (input.classification !== undefined)
        row.guestType = input.classification === "RETURNING" ? "REGULAR" : input.classification === "NEW" ? "NEW" : null
      if (input.isBirthday !== undefined) row.isBirthday = input.isBirthday
      if (input.expectedAt && input.expectedAt.getTime() !== row.expectedAt.getTime()) {
        this.assertBookingSlot(input.expectedAt)
        if (!isWithinBookingReceptionWindow(fmtTime(input.expectedAt))) {
          throw new ApiError(
            400,
            "EXPECTED_AT_OUTSIDE_BOOKING_WINDOW",
            "Giờ nhận booking chỉ từ 19:00 đến 01:00 sáng hôm sau.",
          )
        }
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
    tableIds = this.expandLayoutTables(tableIds)
    const r = this.res(reservationId)
    this.checkVersion("reservations", r, version, "Booking")
    if (r.status !== "BOOKED") this.fail("Chỉ phân bàn cho booking Đã đặt.", "INVALID_STATE")
    if (tableIds.length) this.maybeTriggerConflict(tableIds[0], r.businessDate, r.expectedAt)
    return this.commit({ action: "TABLE_ASSIGNED", entityType: "reservation", undoable: true }, (tx) => {
      const hold = activeReservationHold(this.db, r.id)
      this.assertBookingTables(tableIds, r.partySize)
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
        const groupId =
          tableIds.length > 1 ? (this.layoutGroupFor(tableIds) ?? this.newGroup(tx, r.businessDate)) : null
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
    if (reason === "NO_SHOW_CONFIRMED") this.fail("Dùng thao tác Xác nhận không tới.")
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
        `Chỉ xác nhận không tới sau ${this.venue.noShowWarningMinutes} phút (hiện trễ ${minutesLate}'). Trước mốc này, nếu khách báo hủy hãy dùng Hủy booking.`,
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
          summary: `Xác nhận không tới · booking ${fmtTime(r.expectedAt)}${tables.length ? ` · nhả ${this.codes(tables)}` : ""}`,
        }
      },
    )
  }

  async confirmLate(id: number, version: number) {
    await this.latency("m")
    this.require("reservation.update")
    const r = this.res(id)
    if (r.status !== "BOOKED" || r.visitId) this.fail("Booking không còn ở trạng thái chờ khách.", "INVALID_STATE")
    if (r.businessDate !== businessDateOf(this.now)) this.fail("Booking không thuộc ca hiện tại.", "INVALID_STATE")
    if (!activeReservationHold(this.db, r.id)) this.fail("Booking không còn giữ bàn hợp lệ.", "INVALID_STATE")
    if (r.lateConfirmedAt) {
      if (version !== r.version - 1) this.checkVersion("reservations", r, version, "Booking")
      return { operationId: null, changeSeq: null, undoable: false, summary: "Khách đã được ghi nhận tới muộn." }
    }
    this.checkVersion("reservations", r, version, "Booking")
    const elapsed = this.now.getTime() - r.expectedAt.getTime()
    if (elapsed < 0) this.fail("Chỉ xác nhận tới muộn sau giờ hẹn.", "INVALID_STATE")
    if (elapsed >= this.venue.noShowWarningMinutes * 60_000)
      this.fail("Cách xử lý sau ngưỡng không tới đang chờ phê duyệt.", "INVALID_STATE")
    return this.commit(
      {
        action: "RESERVATION_LATE_CONFIRMED",
        entityType: "reservation",
        undoable: false,
        reasonCode: "CUSTOMER_CONFIRMED_LATE",
      },
      (tx) => {
        const row = tx.edit("reservations", r.id)
        row.lateConfirmedAt = this.now
        row.lateConfirmedByUserId = this.session.id
        row.updatedByUserId = this.session.id
        row.updatedAt = this.now
        return { entityId: r.id, summary: `Đã ghi nhận ${r.contactName ?? "khách"} sẽ tới muộn` }
      },
    )
  }

  /**
   * Số điện thoại của người đang được gọi.
   *
   * Khách chờ và lượt ghé đều chỉ giữ customerId, y như server; một đơn chờ
   * gắn booking hoặc một lượt ghé check-in từ booking thì lấy số của booking
   * trước, giống thứ tự COALESCE bên contact-call.repository.ts.
   */
  private callPhone(target: CallTarget): string | null {
    const ofCustomer = (customerId: number | null | undefined) =>
      customerId ? (this.db.customers.get(customerId)?.phoneE164 ?? null) : null
    if (target.kind === "booking") return ofCustomer(this.res(target.id).customerId)
    if (target.kind === "waitlist") {
      const entry = this.entry(target.id)
      const viaBooking = entry.reservationId ? ofCustomer(this.res(entry.reservationId).customerId) : null
      return viaBooking ?? ofCustomer(entry.customerId)
    }
    const visit = this.visit(target.id)
    const booking = [...this.db.reservations.values()].find((r) => r.visitId === visit.id)
    return (booking ? ofCustomer(booking.customerId) : null) ?? ofCustomer(visit.customerId)
  }

  async startCall(target: CallTarget) {
    await this.latency("q")
    this.require("booking.phone.call")
    const phone = this.callPhone(target)
    if (!phone) this.fail("Khách này chưa có số điện thoại hợp lệ.", "VALIDATION_FAILED")
    const callId = Date.now()
    const initiatedAt = new Date(this.now)
    // Mock keeps the log in memory so the history panel has something real to
    // show; the server writes it to booking_call_logs.
    this.callLog.push({
      callId,
      targetKey: callTargetKey(target),
      initiatedAt,
      initiatedBy: this.session.displayName,
      outcome: null,
      outcomeAt: null,
      outcomeBy: null,
    })
    return { callId, initiatedAt, telUri: `tel:${phone}` }
  }

  async listCalls(target: CallTarget) {
    await this.latency("q")
    this.require("booking.phone.call")
    const key = callTargetKey(target)
    return this.callLog
      .filter((c) => c.targetKey === key)
      .slice()
      .sort((a, b) => b.initiatedAt.getTime() - a.initiatedAt.getTime())
      .map((c) => ({
        callId: c.callId,
        initiatedAt: c.initiatedAt,
        initiatedBy: c.initiatedBy,
        outcome: c.outcome,
        outcomeAt: c.outcomeAt,
        outcomeBy: c.outcomeBy,
      }))
  }

  async recordCallOutcome(target: CallTarget, _callId: number, outcome: CallOutcome, bookingVersion?: number) {
    if (outcome === "LATE_CONFIRMED") {
      if (target.kind !== "booking") this.fail("Kết quả cuộc gọi không hợp lệ.", "VALIDATION_FAILED")
      const reservation = this.res(target.id)
      if (reservation.lateConfirmedAt && bookingVersion === reservation.version) {
        return { operationId: null, changeSeq: null, undoable: false, summary: "Khách đã được ghi nhận tới muộn." }
      }
      return this.confirmLate(target.id, bookingVersion ?? 0)
    }
    await this.latency("q")
    this.require("booking.phone.call")
    const key = callTargetKey(target)
    const entry = this.callLog.find((c) => c.callId === _callId && c.targetKey === key)
    if (entry && entry.outcome === null) {
      entry.outcome = outcome
      entry.outcomeAt = new Date(this.now)
      entry.outcomeBy = this.session.displayName
    }
    return { operationId: null, changeSeq: null, undoable: false, summary: "Đã ghi kết quả cuộc gọi." }
  }

  async checkIn(input: CheckInInput) {
    await this.latency("m")
    this.require("visit.checkin")
    const r = this.res(input.reservationId)
    this.checkVersion("reservations", r, input.version, "Booking")
    if (r.status !== "BOOKED") this.fail("Booking không còn ở trạng thái Đã đặt.", "INVALID_STATE")
    if (!Number.isInteger(input.guestCount) || input.guestCount < 1 || input.guestCount > 500)
      this.fail("Số khách phải từ 1 đến 500.")
    const bd = businessDateOf(this.now)
    if (r.businessDate !== bd)
      this.fail(`Booking thuộc ngày ${r.businessDate}, không phải ca hiện tại.`, "INVALID_STATE")
    const entry = activeEntryForReservation(this.db, r.id)
    const hold = activeReservationHold(this.db, r.id) ?? (entry ? activeHoldForEntry(this.db, entry.id) : null)
    const holdTables = hold ? holdTableIds(this.db, hold.id) : []
    const target = this.expandLayoutTables(input.tableIds?.length ? input.tableIds : holdTables)
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
    if (!groupId && target.length > 1) groupId = this.layoutGroupFor(target) ?? this.newGroup(tx, bd)
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
    input = { ...input, tableIds: this.expandLayoutTables(input.tableIds) }
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
      const customerId = this.upsertCustomer(tx, input.contactName, input.phone)
      const v = tx.insert("visits", {
        organizationId: ORG_ID,
        venueId: VENUE_ID,
        origin: "WALK_IN",
        customerId,
        contactName: customerId === null ? input.contactName?.trim() || null : null,
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
      const groupId = input.tableIds.length > 1 ? (this.layoutGroupFor(input.tableIds) ?? this.newGroup(tx, bd)) : null
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

  /**
   * Module Phục vụ 1 — đổi / ghép bàn từ màn `/phucvu`.
   *
   * Chuyển về đúng hai hàm đã có, nên luật nghiệp vụ của mock chỉ tồn tại ở
   * một chỗ. `tableIds` là bộ bàn cuối cùng (giống hợp đồng HTTP), nên chế độ
   * MERGE tự suy ra phần thêm vào thay vì để màn hình gửi hai nghĩa khác nhau.
   */
  async updateWaiterVisitTables(input: WaiterVisitTablesInput) {
    const claim = { visitId: input.visitId, version: input.version }
    const confirmations =
      input.capacityOverrideConfirmed === undefined
        ? {}
        : { capacityOverrideConfirmed: input.capacityOverrideConfirmed }
    if (input.mode === "MOVE") {
      return this.moveClaim({ claim, tableIds: [...input.tableIds], ...confirmations })
    }
    const current = new Set(
      [...this.db.allocations.values()]
        .filter((allocation) => allocation.visitId === input.visitId && !allocation.releasedAt)
        .map((allocation) => allocation.tableId),
    )
    const addTableIds = input.tableIds.filter((id) => !current.has(id))
    if (!addTableIds.length) this.fail("Cần chọn ít nhất một bàn để ghép.", "INVALID_STATE")
    return this.combineTables({ claim, addTableIds, ...confirmations })
  }

  async moveClaim(input: MoveInput) {
    await this.latency("m")
    this.require(input.claim.visitId ? "visit.move" : "table.assign")
    const { allocs, entity, at, party } = this.claimAllocations(input.claim)
    if (input.claim.version !== undefined) {
      const current = (this.db[entity.col] as Map<number, { id: number; version: number }>).get(entity.id)!
      this.checkVersion(entity.col, current, input.claim.version, "Bàn")
    }
    if (!allocs.length) this.fail("Không có bàn để đổi.", "INVALID_STATE")
    if (!input.tableIds) {
      if (!allocs.some((a) => a.tableId === input.fromTableId)) this.fail("Bàn nguồn không thuộc nhóm khách này.")
      if (allocs.some((a) => a.tableId === input.toTableId)) this.fail("Bàn đích đã thuộc nhóm khách này.")
    }
    const targetIds = this.expandLayoutTables([
      ...new Set(input.tableIds ?? allocs.map((a) => (a.tableId === input.fromTableId ? input.toTableId : a.tableId))),
    ])
    const first = allocs[0]
    if (targetIds.length) this.maybeTriggerConflict(targetIds[0], first.businessDate, at)
    return this.commit(
      {
        action: "TABLE_MOVED",
        entityType: entity.col === "visits" ? "visit" : entity.col === "holds" ? "table_hold" : "reservation",
        undoable: true,
      },
      (tx) => {
        if (input.claim.visitId || input.claim.reservationId) this.assertBookingTables(targetIds, party)
        this.assertClaimable(targetIds, {
          bd: first.businessDate,
          at,
          partySize: party,
          ignore: (allocation) => allocs.some((a) => a.id === allocation.id),
          overrideReason: input.overrideReason,
        })
        // Mock-only pending Tu (K1 Section 5): allow table+bar combinations in moveClaim
        // if (new Set(targetIds.map((id) => this.db.tables.get(id)!.kind)).size > 1)
        //   throw new ApiError(409, "TABLE_KIND_MISMATCH", "Không thể ghép bàn thường với ghế Bar.")
        const previousGroup = this.db.groups.get(allocs.find((a) => a.groupId)?.groupId ?? 0)
        const groupId =
          targetIds.length > 1
            ? (this.layoutGroupFor(targetIds) ??
              (previousGroup?.layoutTableIds ? null : previousGroup?.id) ??
              this.newGroup(tx, first.businessDate))
            : null
        allocs.forEach((allocation) => this.release(tx, allocation, "MOVED"))
        for (const tableId of targetIds) {
          this.newAllocation(tx, {
            tableId,
            kind: first.kind,
            holdId: first.holdId,
            visitId: first.visitId,
            groupId,
            startsAt: this.now,
            bd: first.businessDate,
            holdStart: at,
          })
        }
        this.dissolveOrphanGroups(
          tx,
          allocs.map((a) => a.groupId),
        )
        tx.edit(entity.col, entity.id)
        return {
          entityId: entity.id,
          summary: `Đổi bàn ${this.codes(allocs.map((a) => a.tableId))} -> ${this.codes(targetIds)}`,
        }
      },
    )
  }

  private requireGroupManage() {
    if (this.session.role !== "OWNER" && this.session.role !== "ADMIN" && this.session.role !== "RECEPTIONIST")
      throw new ApiError(403, "PERMISSION_DENIED", "Bạn không có quyền quản lý nhóm bàn.", {
        permission: "table.group.manage",
      })
  }

  private groupVersion(groupId: number, version: number) {
    const group = this.db.groups.get(groupId)
    if (!group || group.dissolvedAt)
      throw new ApiError(400, "INVALID_GROUP_ID", apiErrorMessage("INVALID_GROUP_ID", ""))
    if (group.version !== version)
      throw new ApiError(409, "TABLE_GROUP_VERSION_CONFLICT", apiErrorMessage("TABLE_GROUP_VERSION_CONFLICT", ""), {
        currentVersion: group.version,
        changeSeq: String(this.seq),
      })
    return group
  }

  private assertGroupTables(ids: number[], ownGroupId?: number, spareOverrideConfirmed?: boolean) {
    const reject = (code: string, conflictingTableIds?: number[]): never => {
      const details = conflictingTableIds ? { conflictingTableIds } : {}
      throw new ApiError(
        code === "MERGE_REQUIRES_MULTIPLE_TABLES" || code === "TABLE_NOT_FOUND" ? 400 : 409,
        code,
        apiErrorMessage(code, "Không thể ghép bàn.", details),
        details,
      )
    }
    if (ids.length < 2) reject("MERGE_REQUIRES_MULTIPLE_TABLES")
    if (new Set(ids).size !== ids.length) this.fail("Danh sách bàn bị trùng.")
    const tables = ids.map((id) => this.db.tables.get(id))
    if (tables.some((t) => !t || t.status !== "ACTIVE")) reject("TABLE_NOT_FOUND")
    // A spare table may join a cluster, but only once someone confirms the warning.
    const spare = tables.filter((t) => t!.isSpare)
    if (spare.length && !spareOverrideConfirmed) {
      const details = { spareTableIds: spare.map((t) => t!.id), spareTableCodes: spare.map((t) => t!.code) }
      throw new ApiError(
        409,
        "SPARE_TABLE_OVERRIDE_REQUIRED",
        apiErrorMessage(
          "SPARE_TABLE_OVERRIDE_REQUIRED",
          `Bàn ${spare.map((t) => t!.code).join(", ")} là bàn sơ cua.`,
          details,
        ),
        details,
      )
    }
    // Mock-only pending Tu (K1 Section 5): allow cross-zone and table+bar combinations in table groups
    // if (new Set(tables.map((t) => t!.kind)).size > 1) reject("TABLE_KIND_MISMATCH")
    // if (new Set(tables.map((t) => t!.zoneId)).size > 1) reject("TABLE_ZONE_MISMATCH")
    const live = activeAllocations(this.db)
    const grouped = [...this.db.groups.values()].some(
      (g) =>
        !g.dissolvedAt &&
        g.id !== ownGroupId &&
        (g.layoutTableIds ?? live.filter((a) => a.groupId === g.id).map((a) => a.tableId)).some((id) =>
          ids.includes(id),
        ),
    )
    if (grouped) reject("TABLE_ALREADY_GROUPED")
    const claims = live.filter((a) => ids.includes(a.tableId))
    if (new Set(claims.map((a) => (a.visitId ? `v${a.visitId}` : `h${a.holdId}`))).size > 1)
      reject("TABLE_GROUP_MULTIPLE_CLAIMS", [...new Set(claims.map((a) => a.tableId))])
    if (claims.length && ids.some((id) => !claims.some((a) => a.tableId === id))) reject("TABLE_GROUP_MIXED_STATE", ids)
    return claims
  }

  async createTableGroup(input: CreateTableGroupInput) {
    await this.latency("m")
    this.requireGroupManage()
    const claims = this.assertGroupTables(input.tableIds, undefined, input.spareOverrideConfirmed)
    return this.commit({ action: "TABLES_COMBINED", entityType: "table_group", undoable: true }, (tx) => {
      const gid = this.newGroup(tx, businessDateOf(this.now))
      const row = tx.edit("groups", gid)
      row.layoutTableIds = [...input.tableIds]
      row.name = input.name?.trim() || undefined
      claims.forEach((a) => {
        tx.edit("allocations", a.id).groupId = gid
      })
      return { entityId: gid, summary: `Ghép mặt bằng ${this.codes(input.tableIds)} (mô phỏng C1)` }
    })
  }

  async addTableGroupMembers(input: AddTableGroupMembersInput) {
    await this.latency("m")
    this.requireGroupManage()
    const group = this.groupVersion(input.groupId, input.version)
    if (!input.tableIds.length) this.fail("Chọn bàn cần thêm vào nhóm.")
    const members =
      group.layoutTableIds ??
      activeAllocations(this.db)
        .filter((a) => a.groupId === group.id)
        .map((a) => a.tableId)
    const ids = [...members, ...input.tableIds]
    const claims = this.assertGroupTables(ids, group.id, input.spareOverrideConfirmed)
    return this.commit({ action: "TABLES_COMBINED", entityType: "table_group", undoable: true }, (tx) => {
      tx.edit("groups", group.id).layoutTableIds = ids
      claims.forEach((a) => {
        if (a.groupId !== group.id) tx.edit("allocations", a.id).groupId = group.id
      })
      return { entityId: group.id, summary: `Thêm ${this.codes(input.tableIds)} vào nhóm bàn` }
    })
  }

  async combineTables(input: CombineInput) {
    if (!input.claim.visitId && !input.claim.reservationId) {
      const group = [...this.db.groups.values()].find(
        (g) => !g.dissolvedAt && g.layoutTableIds?.some((id) => input.addTableIds.includes(id)),
      )
      return group
        ? this.addTableGroupMembers({
            groupId: group.id,
            version: group.version,
            tableIds: input.addTableIds.filter((id) => !group.layoutTableIds!.includes(id)),
          })
        : this.createTableGroup({ tableIds: input.addTableIds })
    }
    await this.latency("m")
    this.require("visit.combine")
    const { allocs, entity, at } = this.claimAllocations(input.claim)
    if (input.claim.version !== undefined) {
      const current = (this.db[entity.col] as Map<number, { id: number; version: number }>).get(entity.id)!
      this.checkVersion(entity.col, current, input.claim.version, "Bàn")
    }
    if (!allocs.length) this.fail("Không có bàn để ghép.")
    if (!input.addTableIds.length) this.fail("Chọn bàn cần ghép thêm.")
    const bd = allocs[0].businessDate
    this.assertBookingTables([...allocs.map((a) => a.tableId), ...input.addTableIds], 1, true)
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
        // KHÔNG cập nhật `layoutTableIds`: máy chủ thật cũng không chèn vào
        // `table_group_members` ở đường này. Ghép thêm bàn cho khách là thao
        // tác thuộc vòng đời USAGE, không được âm thầm sửa cụm LAYOUT mà lễ
        // tân đã dựng. Bản mock từng tự đồng bộ nên lỗi hai khung viền lồng
        // nhau không bao giờ lộ ra ở chế độ demo.
        tx.edit(entity.col, entity.id)
        const sym = symbolByNo(this.db.groups.get(groupId)?.symbolNo)
        const all = [...allocs.map((a) => a.tableId), ...input.addTableIds]
        return { entityId: entity.id, summary: `Ghép ${this.codes(all)} · ký hiệu ${sym?.name ?? "?"}` }
      },
    )
  }

  /** Tách bàn: the same operation as splitGroup with mode ALL_TO_SINGLE. */
  async dissolveTableGroup(input: DissolveTableGroupInput) {
    return this.splitGroup({ groupId: input.groupId, version: input.version, mode: "ALL_TO_SINGLE" })
  }

  async splitGroup(input: SplitInput) {
    await this.latency("m")
    if (input.mode === "ALL_TO_SINGLE") {
      this.requireGroupManage()
      const group = this.groupVersion(input.groupId, input.version)
      const claims = activeAllocations(this.db).filter((a) => a.groupId === group.id)
      if (claims.length)
        throw new ApiError(409, "TABLE_GROUP_MIXED_STATE", "Nhóm đang có khách. Dùng Tách bàn và chọn bàn giữ lại.", {
          conflictingTableIds: claims.map((a) => a.tableId),
        })
      return this.commit({ action: "TABLES_SPLIT", entityType: "table_group", undoable: true }, (tx) => {
        const row = tx.edit("groups", group.id)
        row.dissolvedAt = this.now
        row.dissolvedByUserId = this.session.id
        return { entityId: group.id, summary: "Đã tách nhóm trống thành bàn đơn (mô phỏng C1)" }
      })
    }
    this.require("visit.split")
    if (!Array.isArray(input.keepTableIds))
      throw new ApiError(400, "INVALID_SPLIT_MODE", apiErrorMessage("INVALID_SPLIT_MODE", ""))
    const g = this.db.groups.get(input.groupId)
    if (!g || g.dissolvedAt) throw new ApiError(404, "NOT_FOUND", "Nhóm ghép không còn tồn tại.")
    const allocs = activeAllocations(this.db).filter((a) => a.groupId === g.id)
    const tables = allocs.map((a) => a.tableId)
    if (!input.keepTableIds.length) throw new ApiError(400, "TABLES_REQUIRED", apiErrorMessage("TABLES_REQUIRED", ""))
    if (input.keepTableIds.some((t) => !tables.includes(t))) this.fail("Bàn giữ lại không thuộc nhóm.")
    // SPL-02 (PO 07/11/2026): a Split must release at least one table.
    if (input.keepTableIds.length === tables.length)
      this.fail("Tách bàn phải nhả ít nhất một bàn. Nhóm ghép giữ nguyên.")
    return this.commit({ action: "TABLES_SPLIT", entityType: "table_group", undoable: true }, (tx) => {
      allocs.forEach((a) => this.release(tx, a, "SPLIT"))
      const gr = tx.edit("groups", g.id)
      gr.dissolvedAt = this.now
      gr.dissolvedByUserId = this.session.id
      const keep = allocs.filter((a) => input.keepTableIds.includes(a.tableId))
      const newGroupId = keep.length > 1 ? this.newGroup(tx, g.businessDate) : null
      if (newGroupId && g.layoutTableIds) tx.edit("groups", newGroupId).layoutTableIds = [...input.keepTableIds]
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
    if (patch.status) this.require("venue.configure")
    if (patch.isSpare !== undefined) this.require("table.spare.configure")
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
    let bd = input.businessDate ?? businessDateOf(this.now)
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
          customerId: input.kind === "WALK_IN" ? this.upsertCustomer(tx, input.contactName, input.phone) : null,
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
    this.require("waitlist.accept_offer")
    this.require("reservation.create")
    this.require("table.assign")
    const entry = this.entry(input.entryId)
    this.checkVersion("waitlist", entry, input.version, "Mục chờ")
    const offer = activeHoldForEntry(this.db, entry.id)
    const allowed =
      entry.kind === "WALK_IN" ? ["WAITING", "HOLD_ACTIVE"] : ["WAITING", "CONTACTING", "OFFERED", "HOLD_ACTIVE"]
    if (!allowed.includes(entry.status) || (entry.status === "HOLD_ACTIVE" && !offer))
      throw new ApiError(409, "WAITLIST_NOT_SEATABLE", "Khách chờ không thể được gán bàn trực tiếp.")
    const linked = entry.reservationId ? this.res(entry.reservationId) : null
    if (linked && (linked.status !== "BOOKED" || linked.businessDate !== entry.businessDate))
      throw new ApiError(409, "BUSINESS_DATE_MISMATCH", "Booking đã đổi. Vui lòng tải lại danh sách chờ.")
    if (linked && activeReservationHold(this.db, linked.id))
      throw new ApiError(409, "BOOKING_ALREADY_ASSIGNED", "Booking đã có bàn.")
    const target = [...new Set(input.tableIds ?? (offer ? holdTableIds(this.db, offer.id) : []))]
    const partySize = linked?.partySize ?? entry.partySize ?? 0
    if (!partySize) throw new ApiError(409, "WAITLIST_DATA_INCOMPLETE", "Thiếu số khách trong mục chờ.")
    if (new Set(target.map((id) => this.db.tables.get(id)?.zoneId)).size > 1)
      throw new ApiError(409, "TABLE_ZONE_MISMATCH", "Các bàn cho khách chờ phải thuộc cùng một khu.")
    return this.commit<{ reservationId: number; groupId: number | null }>(
      { action: "WAITLIST_ASSIGNED_TO_RESERVATION", entityType: "waitlist_entry", undoable: false },
      (tx) => {
        this.assertClaimable(target, {
          bd: entry.businessDate,
          at: linked?.expectedAt ?? this.now,
          partySize,
          ignore: (a) => !!offer && a.holdId === offer.id,
        })
        const source = [...this.db.sources.values()].find((row) => row.code === "OTHER")
        if (!source) throw new ApiError(409, "WAITLIST_BOOKING_SOURCE_MISSING", "Cần cấu hình nguồn booking OTHER.")
        const reservation =
          linked ??
          tx.insert("reservations", {
            organizationId: ORG_ID,
            venueId: VENUE_ID,
            customerId: entry.customerId,
            contactName: entry.contactName,
            contactNameSearch: entry.contactName ? foldVietnamese(entry.contactName) : null,
            sourceId: source.id,
            partySize,
            expectedAt: this.now,
            businessDate: entry.businessDate,
            customerClassification: "UNCLASSIFIED",
            status: "BOOKED",
            note: entry.note,
            visitId: null,
            checkedInAt: null,
            checkedInByUserId: null,
            closedAt: null,
            closedByUserId: null,
            closeReasonCode: null,
            closeReasonNote: null,
            lateWarnedAt: null,
            lateConfirmedAt: null,
            lateConfirmedByUserId: null,
            noShowWarnedAt: null,
            createdByUserId: this.session.id,
            createdAt: this.now,
            updatedByUserId: null,
            updatedAt: this.now,
          })
        const offerGroupId = offer
          ? (activeAllocations(this.db).find((a) => a.holdId === offer.id && a.groupId)?.groupId ?? null)
          : null
        // Create the replacement first so releasing the offer keeps its group alive.
        const hold = this.createHoldForReservation(tx, reservation, target, offerGroupId)
        if (offer) this.releaseHoldInternal(tx, offer, "STAFF_REASSIGNED", "HOLD_RELEASED")
        const groupId = activeAllocations(this.db).find((row) => row.holdId === hold.id)?.groupId ?? null
        const row = tx.edit("waitlist", entry.id)
        row.kind = "ADVANCE_RESERVATION"
        row.reservationId = reservation.id
        row.customerId = null
        row.contactName = null
        row.partySize = null
        row.status = "HOLD_ACTIVE"
        row.claimedByUserId = null
        row.claimedAt = null
        row.claimExpiresAt = null
        return {
          entityId: entry.id,
          summary: `Đã gán bàn ${this.codes(target)} cho khách chờ`,
          extra: { reservationId: reservation.id, groupId },
        }
      },
    )
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
    if (this.session.role !== "OWNER" && this.session.role !== "ADMIN" && op.actorUserId !== this.session.id) {
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
    if (next.upcomingWarningMinutes < 1 || next.upcomingWarningMinutes > 240)
      this.fail("Mốc sắp đến phải từ 1 đến 240 phút.")
    if (next.lateWarningMinutes < 1) this.fail("Mốc đến muộn phải từ 1 phút.")
    if (next.noShowWarningMinutes <= next.lateWarningMinutes) this.fail("Mốc không tới phải lớn hơn mốc đến muộn.")
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
    if (next.groupSymbolCount < 1 || next.groupSymbolCount > GROUP_SYMBOL_COUNT_MAX)
      this.fail(`Số ký hiệu ghép từ 1 đến ${GROUP_SYMBOL_COUNT_MAX}.`)
    if (next.groupSymbolCount < maxUsed) this.fail(`Đang dùng ký hiệu số ${maxUsed}, không giảm thấp hơn.`)
    const result = this.commit({ action: "VENUE_CONFIG_UPDATED", entityType: "venue", undoable: true }, (tx) => {
      const row = tx.edit("venue", v.id)
      row.upcomingWarningMinutes = next.upcomingWarningMinutes
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

  async updateVenueSettings(input: VenueSettingsUpdate) {
    await this.latency("m")
    this.require("venue.configure")
    if (
      input.quickTimes.length < 1 ||
      input.quickTimes.length > 24 ||
      new Set(input.quickTimes).size !== input.quickTimes.length ||
      input.quickTimes.some(
        (time) => !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) || !isWithinBookingReceptionWindow(time),
      )
    )
      this.fail("Cần 1–24 giờ nhanh HH:mm không trùng trong cửa sổ 19:00–01:00.")
    if (input.upcomingMinutes < 1 || input.upcomingMinutes > 240) this.fail("Mốc sắp đến phải từ 1 đến 240 phút.")
    if (input.noShowMinutes <= this.venue.lateWarningMinutes) this.fail("Mốc không tới phải lớn hơn mốc đến muộn.")

    // TU-38: the operating shift, validated exactly as the API does so the mock cannot accept
    // a shift the server would refuse.
    const hasStart = input.businessDayStartLocal !== undefined
    const hasCutoff = input.businessDayCutoffLocal !== undefined
    if (hasStart !== hasCutoff) this.fail("Phải gửi cả giờ mở ca và mốc cắt ca.")
    const startLocal = hasStart
      ? normalizeShiftBoundary(input.businessDayStartLocal!)
      : this.venue.businessDayStartLocal
    const cutoffLocal = hasCutoff
      ? normalizeShiftBoundary(input.businessDayCutoffLocal!)
      : this.venue.businessDayCutoffLocal
    const shiftChanged =
      startLocal !== this.venue.businessDayStartLocal || cutoffLocal !== this.venue.businessDayCutoffLocal
    if (hasStart && (!isShiftBoundary(input.businessDayStartLocal!) || !isShiftBoundary(input.businessDayCutoffLocal!)))
      this.fail("Giờ mở ca và mốc cắt ca phải có dạng HH:mm hoặc HH:mm:ss.")
    if (shiftChanged) {
      if (!shiftServesBookingWindow(startLocal, cutoffLocal))
        this.fail("Ca vận hành phải bao trọn cửa sổ nhận booking 19:00–01:00.")
      const open = [...this.db.visits.values()].filter(
        (visit) => visit.venueId === this.venue.id && visit.endedAt === null,
      ).length
      if (open > 0) this.fail(`Còn ${open} lượt khách đang ngồi. Chỉ đổi ca vận hành khi quán không còn lượt nào mở.`)
    }

    this.quickTimes = [...input.quickTimes]
    this.commit({ action: "VENUE_SETTINGS_UPDATED", entityType: "venue", undoable: false }, (tx) => {
      const row = tx.edit("venue", this.venue.id)
      row.upcomingWarningMinutes = input.upcomingMinutes
      row.noShowWarningMinutes = input.noShowMinutes
      row.businessDayStartLocal = startLocal
      row.businessDayCutoffLocal = cutoffLocal
      return { entityId: row.id, summary: "Cập nhật cấu hình quán" }
    })
    return this.getVenueSettings()
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
    for (const visit of this.businessDayWorkerEnabled ? this.db.visits.values() : []) {
      const cutoff = fromVenueLocal(addDays(visit.businessDate, 1), venue.businessDayCutoffLocal)
      cutoff.setUTCSeconds(Number(venue.businessDayCutoffLocal.split(":")[2] ?? 0))
      if (visit.endedAt || cutoff > now) continue
      this.commit(
        {
          action: "VISIT_AUTO_CLOSED_BUSINESS_DAY",
          entityType: "visit",
          undoable: false,
          actorUserId: 0,
          reasonCode: "BUSINESS_DAY_END",
        },
        (tx) => {
          const allocations = activeAllocations(this.db).filter((a) => a.kind === "USAGE" && a.visitId === visit.id)
          for (const allocation of allocations) {
            const row = tx.edit("allocations", allocation.id)
            row.releasedAt = now
            row.releasedByUserId = null
            row.releaseReason = "BUSINESS_DAY_END"
          }
          for (const groupId of new Set(allocations.map((a) => a.groupId))) {
            if (!groupId || activeAllocations(this.db).some((a) => a.groupId === groupId)) continue
            const group = this.db.groups.get(groupId)
            if (group && !group.dissolvedAt && !group.layoutTableIds) {
              const row = tx.edit("groups", groupId)
              row.dissolvedAt = now
              row.dissolvedByUserId = null
            }
          }
          const row = tx.edit("visits", visit.id)
          row.endedAt = now
          row.endedByUserId = null
          row.endReason = "BUSINESS_DAY_END"
          return { entityId: visit.id, summary: `Tự đóng lượt #${visit.id} cuối ngày kinh doanh` }
        },
      )
    }
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
    this.history = this.createCustomerHistory()
    this.guestCounts.clear()
    this.quickTimes = ["21:00", "21:30", "22:00", "22:30"]
    this.initPaymentBills()
    this.paymentPaidLog = []
    this.paymentEventLog = []
    this.paymentIdempotency.clear()
    this.paymentIssueIdempotency.clear()
    this.cancelRequests = []
    this.cancelRequestSeq = 1
    this.paymentAuditLog = []
    this.paymentAuditSeq = 1
    this.paymentAttemptKeys = []
    this.paymentFault = {}
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

  /* ================= temporary payment mock (NA-45/46, swap for TU-45/46) ================= */

  private toPayLines(input: SeededPaymentBillInput["lines"]): PayLine[] {
    return input.map((l) => ({
      orderRound: l.orderRound,
      roundTime: l.roundTime,
      roundBy: l.roundBy,
      name: l.name,
      unit: l.unit,
      qty: l.qty,
      unitPriceVnd: l.unitPriceVnd,
      lineTotalVnd: l.qty * l.unitPriceVnd,
      state: l.state,
      ...(l.note ? { note: l.note } : {}),
    }))
  }

  private initPaymentBills() {
    this.paymentMeta.clear()
    const bySignature = new Map(seedPaymentBills().map((b) => [b.tableSignature, b]))
    for (const visit of this.db.visits.values()) {
      if (visit.endedAt || visit.paidMarkedAt) continue
      const tableCodes = visitTableIds(this.db, visit.id).map((id) => this.db.tables.get(id)?.code ?? `#${id}`)
      if (tableCodes.length === 0) continue
      const seed = bySignature.get(paymentTableSignature(tableCodes))
      if (!seed) continue
      const baseCode = `B${String(visit.id).padStart(4, "0")}`
      if (seed.status === "AWAITING_PAYMENT") {
        const issuedAt = seed.pendingAt ?? "21:31"
        const issuedAtDate = atBusinessTime(visit.businessDate, issuedAt)
        this.paymentMeta.set(visit.id, {
          unbilledLines: [],
          bills: [
            {
              billCode: baseCode,
              billStatus: "UNPAID",
              lines: this.toPayLines(seed.lines),
              issuedAt,
              issuedAtDate,
              issuedBy: seed.waiterName,
              issuedByRole: "WAITER",
              ...(seed.pendingAt ? { pendingAt: seed.pendingAt, pendingAtDate: issuedAtDate } : {}),
            },
          ],
          nextBillSeq: 2,
          ...(seed.requestedAt
            ? { requestedAt: seed.requestedAt, requestedAtDate: atBusinessTime(visit.businessDate, seed.requestedAt) }
            : {}),
          waiterName: seed.waiterName,
          versionOffset: 0,
        })
      } else {
        this.paymentMeta.set(visit.id, {
          unbilledLines: this.toPayLines(seed.lines),
          bills: [],
          nextBillSeq: 1,
          ...(seed.pendingAt
            ? { pendingAt: seed.pendingAt, pendingAtDate: atBusinessTime(visit.businessDate, seed.pendingAt) }
            : {}),
          ...(seed.requestedAt
            ? { requestedAt: seed.requestedAt, requestedAtDate: atBusinessTime(visit.businessDate, seed.requestedAt) }
            : {}),
          waiterName: seed.waiterName,
          versionOffset: 0,
        })
      }
    }
  }

  private ensurePaymentMeta(visit: VisitRow): PaymentVisitMeta {
    const existing = this.paymentMeta.get(visit.id)
    if (existing) return existing
    const created: PaymentVisitMeta = {
      unbilledLines: [],
      bills: [],
      nextBillSeq: 1,
      waiterName: "Phục vụ",
      versionOffset: 0,
    }
    this.paymentMeta.set(visit.id, created)
    return created
  }

  private paymentVersion(visit: VisitRow, meta: PaymentVisitMeta): number {
    return visit.version + meta.versionOffset
  }

  private hasActiveUnbilledLines(meta: PaymentVisitMeta): boolean {
    return meta.unbilledLines.some((l) => l.state !== "CANCELLED" && l.qty > 0)
  }

  private countActiveUnbilledLines(meta: PaymentVisitMeta): number {
    return meta.unbilledLines.filter((l) => l.state !== "CANCELLED" && l.qty > 0).length
  }

  private deriveSessionStatus(visit: VisitRow, meta: PaymentVisitMeta): VisitPayStatus {
    const hasBills = meta.bills.length > 0
    const hasUnpaidBill = meta.bills.some((b) => b.billStatus === "UNPAID")
    const hasActiveUnbilled = this.hasActiveUnbilledLines(meta)
    if ((hasBills && !hasUnpaidBill && !hasActiveUnbilled) || (visit.paidMarkedAt && !hasUnpaidBill && !hasActiveUnbilled)) {
      return "PAID"
    }
    // Derive CLOSED_UNPAID from live visit.endedAt; never cache it on meta.
    if (visit.endedAt) return "CLOSED_UNPAID"
    if (hasActiveUnbilled) return "SERVING"
    if (hasUnpaidBill) return "AWAITING_PAYMENT"
    return "SERVING"
  }

  private isBarAreaVisit(visit: VisitRow, meta: PaymentVisitMeta): boolean {
    const tableIds = visitTableIds(this.db, visit.id)
    if (tableIds.length > 0) {
      return tableIds.every((id) => {
        const table = this.db.tables.get(id)
        if (!table) return false
        const zone = this.db.zones.get(table.zoneId)
        return zone ? zone.code === "BAR" : /^BAR/i.test(table.code)
      })
    }
    const info = this.resolveVisitTableInfo(visit, meta)
    return info.tables.length > 0 && info.tables.every((code) => /^BAR/i.test(code))
  }

  private assertBarScope(visit: VisitRow, meta: PaymentVisitMeta) {
    if (this.session.role === "BAR" && !this.isBarAreaVisit(visit, meta)) {
      throw new ApiError(
        403,
        "PERMISSION_DENIED",
        "Bartender chỉ được xem và xuất hóa đơn cho phiên thuộc khu vực quầy Bar.",
      )
    }
  }

  private toCancelRequest(req: CancelRequestInternal): CancelRequest {
    const { requestedByUserId: _omit, ...rest } = req
    return structuredClone(rest)
  }

  private resolveVisitTableInfo(
    visit: VisitRow,
    meta: PaymentVisitMeta,
  ): { tables: string[]; clusterCode?: string } {
    const activeTableIds = visitTableIds(this.db, visit.id)
    const liveTableCodes = activeTableIds.map((id) => this.db.tables.get(id)?.code ?? `#${id}`)
    const viewTableCodes =
      liveTableCodes.length > 0
        ? liveTableCodes
        : meta.closedTables && meta.closedTables.length > 0
          ? meta.closedTables
          : visitView(this.db, visit).tableIds.map((id) => this.db.tables.get(id)?.code ?? `#${id}`)
    const tables = viewTableCodes.length > 0 ? viewTableCodes : [`#${visit.id}`]
    const alloc = activeAllocations(this.db).find((a) => a.visitId === visit.id && a.kind === "USAGE")
    const liveGroupCode = alloc?.groupId
      ? (groupCodeFromSymbol(groupSymbolNo(this.db, alloc.groupId)) ?? undefined)
      : undefined
    const clusterCode = tables.length > 1 ? (liveGroupCode ?? meta.closedClusterCode) : undefined
    return { tables, ...(clusterCode ? { clusterCode } : {}) }
  }

  private buildIssuedPayBill(
    visit: VisitRow,
    meta: PaymentVisitMeta,
    record: IssuedBillRecord,
    tableInfo = this.resolveVisitTableInfo(visit, meta),
  ): PayBill {
    const totals = calcBillTotals(record.lines)
    const roundCount = new Set(record.lines.map((l) => l.orderRound)).size
    const status: VisitPayStatus =
      record.billStatus === "PAID" ? "PAID" : visit.endedAt ? "CLOSED_UNPAID" : "AWAITING_PAYMENT"

    return {
      billCode: record.billCode,
      visitId: String(visit.id),
      sessionCode: `S-${String(visit.id).padStart(4, "0")}`,
      code: tableInfo.clusterCode ?? tableInfo.tables[0],
      tables: [...tableInfo.tables],
      ...(tableInfo.clusterCode ? { clusterCode: tableInfo.clusterCode } : {}),
      status,
      billStatus: record.billStatus,
      lines: structuredClone(record.lines),
      subtotalVnd: totals.subtotalVnd,
      vatVnd: totals.vatVnd,
      preRoundVnd: totals.preRoundVnd,
      roundingVnd: totals.roundingVnd,
      dueVnd: totals.dueVnd,
      version: this.paymentVersion(visit, meta),
      openedAt: fmtTime(visit.startedAt),
      ...(record.pendingAt ? { pendingAt: record.pendingAt } : {}),
      ...(meta.requestedAt ? { requestedAt: meta.requestedAt } : {}),
      issuedAt: record.issuedAt,
      issuedBy: record.issuedBy,
      issuedByRole: record.issuedByRole,
      waiterName: meta.waiterName,
      guests: visit.guestCount,
      roundCount,
      ...(record.paidAt ? { paidAt: record.paidAt } : {}),
      ...(record.paidBy ? { paidBy: record.paidBy } : {}),
      ...(record.manualConfirm !== undefined ? { manualConfirm: record.manualConfirm } : {}),
      ...(record.cancelPending !== undefined ? { cancelPending: record.cancelPending } : {}),
    }
  }

  private buildUnbilledPayBill(
    visit: VisitRow,
    meta: PaymentVisitMeta,
    tableInfo = this.resolveVisitTableInfo(visit, meta),
  ): PayBill {
    const totals = calcBillTotals(meta.unbilledLines)
    const roundCount = new Set(meta.unbilledLines.map((l) => l.orderRound)).size
    const status = this.deriveSessionStatus(visit, meta)
    return {
      billCode: `B${String(visit.id).padStart(4, "0")}`,
      visitId: String(visit.id),
      sessionCode: `S-${String(visit.id).padStart(4, "0")}`,
      code: tableInfo.clusterCode ?? tableInfo.tables[0],
      tables: [...tableInfo.tables],
      ...(tableInfo.clusterCode ? { clusterCode: tableInfo.clusterCode } : {}),
      status,
      lines: structuredClone(meta.unbilledLines),
      subtotalVnd: totals.subtotalVnd,
      vatVnd: totals.vatVnd,
      preRoundVnd: totals.preRoundVnd,
      roundingVnd: totals.roundingVnd,
      dueVnd: totals.dueVnd,
      version: this.paymentVersion(visit, meta),
      openedAt: fmtTime(visit.startedAt),
      ...(meta.requestedAt ? { requestedAt: meta.requestedAt } : {}),
      waiterName: meta.waiterName,
      guests: visit.guestCount,
      roundCount,
    }
  }

  private buildPayBill(visit: VisitRow): PayBill {
    const meta = this.ensurePaymentMeta(visit)
    const tableInfo = this.resolveVisitTableInfo(visit, meta)
    const oldestUnpaid = meta.bills.find((b) => b.billStatus === "UNPAID")
    if (oldestUnpaid) return this.buildIssuedPayBill(visit, meta, oldestUnpaid, tableInfo)
    if (meta.bills.length > 0 && !this.hasActiveUnbilledLines(meta)) {
      const latestPaid = meta.bills[meta.bills.length - 1]
      return this.buildIssuedPayBill(visit, meta, latestPaid, tableInfo)
    }
    return this.buildUnbilledPayBill(visit, meta, tableInfo)
  }

  private nextBillCode(visitId: number, meta: PaymentVisitMeta): string {
    const seq = meta.nextBillSeq
    meta.nextBillSeq += 1
    const base = `B${String(visitId).padStart(4, "0")}`
    return seq <= 1 ? base : `${base}-${seq}`
  }

  private lockUnbilledIntoBill(
    visit: VisitRow,
    meta: PaymentVisitMeta,
    issuedBy: string,
    issuedByRole: InvoiceIssuerRole,
  ): IssuedBillRecord {
    const nowTime = fmtTime(this.now)
    const nowDate = new Date(this.now.getTime())
    const record: IssuedBillRecord = {
      billCode: this.nextBillCode(visit.id, meta),
      billStatus: "UNPAID",
      lines: structuredClone(meta.unbilledLines),
      issuedAt: nowTime,
      issuedAtDate: nowDate,
      issuedBy,
      issuedByRole,
      pendingAt: nowTime,
      pendingAtDate: nowDate,
    }
    meta.bills.push(record)
    meta.unbilledLines = []
    meta.versionOffset += 1
    return record
  }

  private recordPaymentAudit(
    action: PaymentAuditAction,
    billCode: string,
    visitId: number,
    opts?: { actor?: string; approver?: string; reason?: string },
  ) {
    const defaultActor = `${this.session.displayName} · ${ROLE_LABEL[this.session.role]}`
    this.paymentAuditLog.unshift({
      id: `aud-${this.paymentAuditSeq++}`,
      action,
      billCode,
      visitId: String(visitId),
      actor: opts?.actor ?? defaultActor,
      ...(opts?.approver ? { approver: opts.approver } : {}),
      ...(opts?.reason ? { reason: opts.reason } : {}),
      at: this.now.toISOString(),
      device: this.session.deviceLabel,
    })
  }

  private pushPaymentEvent(
    type: PaymentNotificationType,
    title: string,
    text: string,
    visitId: number,
    prefix: string,
    billCode?: string,
  ) {
    this.paymentEventLog.unshift({
      id: `${prefix}-${this.seq + 1}-${this.paymentEventLog.length + 1}`,
      type,
      title,
      text,
      time: fmtTime(this.now),
      occurredAt: this.now.toISOString(),
      visitId: String(visitId),
      ...(billCode ? { billCode } : {}),
    })
  }

  private resolvePaymentVisit(visitId: string): { visit: VisitRow; bill: PayBill } {
    const numericId = Number(visitId)
    if (!Number.isSafeInteger(numericId) || numericId <= 0) {
      throw new ApiError(404, "NOT_FOUND", "Không tìm thấy phiên thanh toán.")
    }
    const visit = this.db.visits.get(numericId)
    if (!visit) {
      throw new ApiError(404, "NOT_FOUND", "Không tìm thấy phiên thanh toán.")
    }
    return { visit, bill: this.buildPayBill(visit) }
  }

  private locateIssuedBill(
    billCode: string,
  ): { visit: VisitRow; meta: PaymentVisitMeta; record: IssuedBillRecord } {
    for (const [visitIdNum, meta] of this.paymentMeta.entries()) {
      const record = meta.bills.find((b) => b.billCode === billCode)
      if (!record) continue
      const visit = this.db.visits.get(visitIdNum)
      if (visit) return { visit, meta, record }
    }
    throw new ApiError(404, "NOT_FOUND", `Không tìm thấy hóa đơn ${billCode}.`)
  }

  private requirePaymentRead() {
    if (!roleCan(this.session.role, "payment.collect") && !roleCan(this.session.role, "order.read")) {
      throw new ApiError(403, "PERMISSION_DENIED", "Tài khoản không có quyền xem thanh toán.")
    }
  }

  private requireInvoiceIssuer() {
    const allowed: RoleCode[] = ["WAITER", "BAR", "CASHIER", "OWNER", "ADMIN"]
    if (!allowed.includes(this.session.role) || !roleCan(this.session.role, "order.read")) {
      throw new ApiError(403, "PERMISSION_DENIED", "Tài khoản không có quyền xuất hóa đơn.")
    }
  }

  setPaymentTestFault(patch: { nextConfirm?: "net" | "dup" | null; qrFound?: boolean; billDelayMs?: number }) {
    if (patch.nextConfirm === null) delete this.paymentFault.nextConfirm
    else if (patch.nextConfirm !== undefined) this.paymentFault.nextConfirm = patch.nextConfirm
    if (patch.qrFound !== undefined) this.paymentFault.qrFound = patch.qrFound
    if (patch.billDelayMs !== undefined) this.paymentFault.billDelayMs = patch.billDelayMs
  }

  simulatePaymentVersionBump(visitId: string) {
    const { visit } = this.resolvePaymentVisit(visitId)
    const meta = this.ensurePaymentMeta(visit)
    meta.versionOffset += 1
  }

  getPaymentAttemptKeys(): string[] {
    return [...this.paymentAttemptKeys]
  }

  addPaymentOrderRound(
    visitId: string,
    lines: {
      name: string
      unit: string
      qty: number
      unitPriceVnd: number
      state?: PayLine["state"]
      note?: string
      roundTime?: string
      roundBy?: string
    }[],
  ): SessionBills {
    const { visit } = this.resolvePaymentVisit(visitId)
    if (visit.endedAt) {
      throw new ApiError(409, "INVALID_STATE", "Phiên đã kết thúc, không thể gọi thêm món.")
    }
    const meta = this.ensurePaymentMeta(visit)
    const allExistingRounds = [
      ...meta.bills.flatMap((b) => b.lines.map((l) => l.orderRound)),
      ...meta.unbilledLines.map((l) => l.orderRound),
    ]
    const nextRound = (allExistingRounds.length > 0 ? Math.max(...allExistingRounds) : 0) + 1
    const roundTime = fmtTime(this.now)
    const roundBy = this.session.displayName
    for (const l of lines) {
      meta.unbilledLines.push({
        orderRound: nextRound,
        roundTime: l.roundTime ?? roundTime,
        roundBy: l.roundBy ?? roundBy,
        name: l.name,
        unit: l.unit,
        qty: l.qty,
        unitPriceVnd: l.unitPriceVnd,
        lineTotalVnd: l.qty * l.unitPriceVnd,
        state: l.state ?? "SERVED",
        ...(l.note ? { note: l.note } : {}),
      })
    }
    meta.versionOffset += 1
    const tableInfo = this.resolveVisitTableInfo(visit, meta)
    this.seq += 1
    this.emit({
      latestSeq: this.seq,
      action: "PAYMENT_ORDER_ADDED",
      entityType: "visit",
      actorKind: "USER",
      actorUserId: this.session.id,
      summary: `${tableInfo.clusterCode ?? tableInfo.tables[0]} · gọi thêm món`,
    })
    return {
      visitId: String(visit.id),
      sessionCode: `S-${String(visit.id).padStart(4, "0")}`,
      code: tableInfo.clusterCode ?? tableInfo.tables[0],
      tables: [...tableInfo.tables],
      ...(tableInfo.clusterCode ? { clusterCode: tableInfo.clusterCode } : {}),
      status: this.deriveSessionStatus(visit, meta),
      unbilledLineCount: this.countActiveUnbilledLines(meta),
      bills: meta.bills.map((r) => this.buildIssuedPayBill(visit, meta, r, tableInfo)),
      version: this.paymentVersion(visit, meta),
    }
  }

  async listPaymentOpen(): Promise<PayBillSummary[]> {
    await this.latency("q")
    this.requirePaymentRead()
    const open: PayBillSummary[] = []
    for (const visit of this.db.visits.values()) {
      if (visit.endedAt) continue
      const meta = this.ensurePaymentMeta(visit)
      if (this.session.role === "BAR" && !this.isBarAreaVisit(visit, meta)) continue
      const sessionStatus = this.deriveSessionStatus(visit, meta)
      if (sessionStatus === "PAID" || sessionStatus === "CLOSED_UNPAID") continue
      const tableInfo = this.resolveVisitTableInfo(visit, meta)
      const unpaidBills = meta.bills.filter((b) => b.billStatus === "UNPAID")
      const primaryUnpaid = unpaidBills[0]
      const dueVnd =
        unpaidBills.length > 0
          ? unpaidBills.reduce((sum, b) => sum + calcBillTotals(b.lines).dueVnd, 0) +
            calcBillTotals(meta.unbilledLines).dueVnd
          : calcBillTotals(meta.unbilledLines).dueVnd
      const hasOrderLines = unpaidBills.some((b) => b.lines.length > 0) || meta.unbilledLines.length > 0
      open.push({
        visitId: String(visit.id),
        billCode: primaryUnpaid?.billCode ?? `B${String(visit.id).padStart(4, "0")}`,
        sessionCode: `S-${String(visit.id).padStart(4, "0")}`,
        code: tableInfo.clusterCode ?? tableInfo.tables[0],
        tables: [...tableInfo.tables],
        ...(tableInfo.clusterCode ? { clusterCode: tableInfo.clusterCode } : {}),
        status: sessionStatus,
        openedAt: fmtTime(visit.startedAt),
        ...(primaryUnpaid?.pendingAt ? { pendingAt: primaryUnpaid.pendingAt } : {}),
        ...(meta.requestedAt ? { requestedAt: meta.requestedAt } : {}),
        ...(primaryUnpaid?.issuedAt ? { issuedAt: primaryUnpaid.issuedAt } : {}),
        ...(primaryUnpaid?.issuedBy ? { issuedBy: primaryUnpaid.issuedBy } : {}),
        unpaidBillCount: unpaidBills.length,
        waiterName: meta.waiterName,
        guests: visit.guestCount,
        dueVnd,
        hasOrderLines,
        version: this.paymentVersion(visit, meta),
      })
    }
    return sortOpenBills(open)
  }

  async getPaymentBill(visitId: string): Promise<PayBill> {
    if (this.paymentFault.billDelayMs && this.paymentFault.billDelayMs > 0) {
      await sleep(this.paymentFault.billDelayMs)
    } else {
      await this.latency("q")
    }
    this.requirePaymentRead()
    const { visit, bill } = this.resolvePaymentVisit(visitId)
    this.assertBarScope(visit, this.ensurePaymentMeta(visit))
    return bill
  }

  async previewPaymentBill(visitId: string): Promise<PreviewBill> {
    await this.latency("q")
    this.requirePaymentRead()
    const { visit } = this.resolvePaymentVisit(visitId)
    const meta = this.ensurePaymentMeta(visit)
    this.assertBarScope(visit, meta)
    const tableInfo = this.resolveVisitTableInfo(visit, meta)
    const totals = calcBillTotals(meta.unbilledLines)
    return {
      visitId: String(visit.id),
      sessionCode: `S-${String(visit.id).padStart(4, "0")}`,
      code: tableInfo.clusterCode ?? tableInfo.tables[0],
      tables: [...tableInfo.tables],
      ...(tableInfo.clusterCode ? { clusterCode: tableInfo.clusterCode } : {}),
      lines: structuredClone(meta.unbilledLines),
      subtotalVnd: totals.subtotalVnd,
      vatVnd: totals.vatVnd,
      preRoundVnd: totals.preRoundVnd,
      roundingVnd: totals.roundingVnd,
      dueVnd: totals.dueVnd,
      version: this.paymentVersion(visit, meta),
    }
  }

  async issuePaymentInvoice(visitId: string, version: number, idempotencyKey: string): Promise<PayBill> {
    await this.latency("m")
    this.requireInvoiceIssuer()
    const { visit } = this.resolvePaymentVisit(visitId)
    const meta = this.ensurePaymentMeta(visit)
    this.assertBarScope(visit, meta)
    const fingerprint = `${visitId}:${version}:ISSUE`
    const existing = this.paymentIssueIdempotency.get(idempotencyKey)
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "Khóa idempotency đã được sử dụng cho lần xuất hóa đơn khác.")
      }
      return structuredClone(existing.bill)
    }

    const sessionStatus = this.deriveSessionStatus(visit, meta)
    if (sessionStatus === "CLOSED_UNPAID" || visit.endedAt) {
      throw new ApiError(409, "INVALID_STATE", "Phiên đã kết thúc, không thể xuất hóa đơn.")
    }
    if (this.paymentVersion(visit, meta) !== version) {
      throw new ApiError(409, "VERSION_CONFLICT", "Phiên vừa được cập nhật trên thiết bị khác.")
    }
    if (!this.hasActiveUnbilledLines(meta)) {
      throw new ApiError(409, "INVALID_STATE", "Không có món mới chưa chốt bill để xuất hóa đơn.")
    }

    const issuerRole = this.session.role as InvoiceIssuerRole
    const record = this.lockUnbilledIntoBill(visit, meta, this.session.displayName, issuerRole)
    const tableInfo = this.resolveVisitTableInfo(visit, meta)
    const issuedBill = this.buildIssuedPayBill(visit, meta, record, tableInfo)
    this.paymentIssueIdempotency.set(idempotencyKey, { fingerprint, bill: issuedBill })

    this.seq += 1
    this.pushPaymentEvent(
      "INVOICE_ISSUED",
      "Đã đưa hóa đơn",
      `${issuedBill.code} · Đã đưa hóa đơn · ${record.issuedBy} · ${record.issuedAt}`,
      visit.id,
      "inv",
      record.billCode,
    )
    this.recordPaymentAudit("INVOICE_ISSUED", record.billCode, visit.id)
    this.emit({
      latestSeq: this.seq,
      action: "PAYMENT_INVOICE_ISSUED",
      entityType: "visit",
      actorKind: "USER",
      actorUserId: this.session.id,
      summary: `${issuedBill.code} · đã đưa hóa đơn (${record.billCode})`,
    })
    return structuredClone(issuedBill)
  }

  async getPaymentSessionBills(visitId: string): Promise<SessionBills> {
    await this.latency("q")
    this.requirePaymentRead()
    const { visit } = this.resolvePaymentVisit(visitId)
    const meta = this.ensurePaymentMeta(visit)
    this.assertBarScope(visit, meta)
    const tableInfo = this.resolveVisitTableInfo(visit, meta)
    return {
      visitId: String(visit.id),
      sessionCode: `S-${String(visit.id).padStart(4, "0")}`,
      code: tableInfo.clusterCode ?? tableInfo.tables[0],
      tables: [...tableInfo.tables],
      ...(tableInfo.clusterCode ? { clusterCode: tableInfo.clusterCode } : {}),
      status: this.deriveSessionStatus(visit, meta),
      unbilledLineCount: this.countActiveUnbilledLines(meta),
      bills: meta.bills.map((r) => this.buildIssuedPayBill(visit, meta, r, tableInfo)),
      version: this.paymentVersion(visit, meta),
    }
  }

  async createPaymentPrebill(visitId: string, version: number): Promise<PayBill> {
    await this.latency("m")
    this.requirePaymentRead()
    const { visit, bill } = this.resolvePaymentVisit(visitId)
    const meta = this.ensurePaymentMeta(visit)
    const sessionStatus = this.deriveSessionStatus(visit, meta)
    if (sessionStatus === "PAID") {
      throw new ApiError(409, "INVALID_STATE", "Bill này đã được thanh toán.")
    }
    if (sessionStatus === "CLOSED_UNPAID") {
      throw new ApiError(409, "INVALID_STATE", "Phiên đã kết thúc (đã trả bàn) nhưng chưa ghi nhận thu tiền.")
    }
    if (this.paymentVersion(visit, meta) !== version) {
      throw new ApiError(409, "VERSION_CONFLICT", "Bill vừa được cập nhật trên thiết bị khác.")
    }
    if (sessionStatus === "SERVING") {
      const issuerRole: InvoiceIssuerRole = roleCan(this.session.role, "order.read")
        ? (this.session.role as InvoiceIssuerRole)
        : "CASHIER"
      const record = this.lockUnbilledIntoBill(visit, meta, this.session.displayName, issuerRole)
      this.seq += 1
      this.emit({
        latestSeq: this.seq,
        action: "PAYMENT_PREBILL_CREATED",
        entityType: "visit",
        actorKind: "USER",
        actorUserId: this.session.id,
        summary: `${bill.code} · tạo tạm tính`,
      })
      return this.buildIssuedPayBill(visit, meta, record)
    }
    return this.buildPayBill(visit)
  }

  async requestPayment(visitId: string): Promise<void> {
    await this.latency("m")
    this.require("order.read")
    const { visit, bill } = this.resolvePaymentVisit(visitId)
    const meta = this.ensurePaymentMeta(visit)
    const sessionStatus = this.deriveSessionStatus(visit, meta)
    if (sessionStatus === "PAID") {
      throw new ApiError(409, "INVALID_STATE", "Bill này đã được thanh toán.")
    }
    if (sessionStatus === "CLOSED_UNPAID") {
      throw new ApiError(409, "INVALID_STATE", "Phiên đã kết thúc (đã trả bàn) nhưng chưa ghi nhận thu tiền.")
    }
    const nowTime = fmtTime(this.now)
    const nowDate = new Date(this.now.getTime())
    if (!meta.requestedAt) {
      meta.requestedAt = nowTime
      meta.requestedAtDate = nowDate
    }
    if (sessionStatus === "SERVING" && meta.bills.length === 0) {
      const issuerRole = this.session.role as InvoiceIssuerRole
      this.lockUnbilledIntoBill(visit, meta, this.session.displayName, issuerRole)
    } else {
      meta.versionOffset += 1
    }
    this.seq += 1
    this.emit({
      latestSeq: this.seq,
      action: "PAYMENT_REQUESTED",
      entityType: "visit",
      actorKind: "USER",
      actorUserId: this.session.id,
      summary: `${bill.code} · gửi yêu cầu thanh toán`,
    })
  }

  private finalizePaidBill(
    visit: VisitRow,
    meta: PaymentVisitMeta,
    record: IssuedBillRecord,
    billView: PayBill,
    method: "CASH" | "TRANSFER",
    manual: boolean,
    staff: string,
    confirmedAt: string,
  ) {
    record.billStatus = "PAID"
    record.paidAt = confirmedAt
    record.paidAtDate = new Date(this.now.getTime())
    record.paidMethod = method
    record.paidBy = staff
    record.manualConfirm = manual
    record.cancelPending = false

    const allBillsPaid = meta.bills.length > 0 && meta.bills.every((b) => b.billStatus === "PAID")
    const shouldCloseVisit = allBillsPaid && !this.hasActiveUnbilledLines(meta)

    if (shouldCloseVisit && !visit.endedAt) {
      meta.closedTables = [...billView.tables]
      meta.closedClusterCode = billView.clusterCode
      this.commit({ action: "VISIT_ENDED", entityType: "visit", undoable: false, silent: true }, (tx) => {
        const allocs = activeAllocations(this.db).filter((a) => a.visitId === visit.id)
        meta.lastClosedAllocIds = allocs.map((a) => a.id)
        allocs.forEach((a) => this.release(tx, a, "GUEST_LEFT"))
        this.dissolveOrphanGroups(
          tx,
          allocs.map((a) => a.groupId),
        )
        const row = tx.edit("visits", visit.id)
        if (!row.paidMarkedAt) {
          row.paidMarkedAt = this.now
          row.paidMarkedByUserId = this.session.id
        }
        row.endedAt = this.now
        row.endedByUserId = this.session.id
        row.endReason = "GUEST_LEFT"
        return { entityId: visit.id, summary: `Thanh toán ${billView.code} · bàn về Trống` }
      })
    } else {
      meta.versionOffset += 1
    }

    this.paymentPaidLog.unshift({
      id: `paid-${record.billCode}-${this.seq + 1}-${this.paymentPaidLog.length + 1}`,
      type: "PAID",
      title: "Đã thanh toán",
      text: `${billView.code} · ${formatVnd(billView.dueVnd)} · ${method === "CASH" ? "Tiền mặt" : "Chuyển khoản QR"}`,
      time: confirmedAt,
      occurredAt: this.now.toISOString(),
      visitId: billView.visitId,
      billCode: record.billCode,
    })
  }

  private commitPayment(
    visitId: string,
    method: "CASH" | "TRANSFER",
    manual: boolean,
    givenVnd: number,
    version: number,
    idempotencyKey: string,
    billCode?: string,
  ): Receipt {
    this.require("payment.collect")
    this.paymentAttemptKeys.push(idempotencyKey)
    const fingerprint = `${visitId}:${billCode ?? ""}:${method}:${manual ? 1 : 0}:${method === "CASH" ? givenVnd : 0}:${version}`
    const existing = this.paymentIdempotency.get(idempotencyKey)
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "Khóa idempotency đã được sử dụng cho một thao tác khác.")
      }
      return structuredClone(existing.receipt)
    }

    if (this.paymentFault.nextConfirm === "net") {
      this.paymentFault.nextConfirm = undefined
      throw new ApiError(0, "NETWORK_ERROR", "Không gửi được tới máy chủ")
    }

    const { visit } = this.resolvePaymentVisit(visitId)
    const meta = this.ensurePaymentMeta(visit)
    const sessionStatus = this.deriveSessionStatus(visit, meta)

    let targetRecord: IssuedBillRecord | undefined
    if (billCode !== undefined) {
      targetRecord = meta.bills.find((b) => b.billCode === billCode)
      if (!targetRecord) {
        throw new ApiError(404, "NOT_FOUND", `Không tìm thấy hóa đơn ${billCode} trong phiên.`)
      }
    } else {
      targetRecord = meta.bills.find((b) => b.billStatus === "UNPAID")
      if (!targetRecord) {
        if (sessionStatus === "PAID") {
          if (this.paymentFault.nextConfirm === "dup") this.paymentFault.nextConfirm = undefined
          const lastPaid = meta.bills[meta.bills.length - 1]
          throw new ApiError(409, "DUPLICATE_PAYMENT", "Bill này đã được thanh toán trên thiết bị khác", {
            confirmedBy: lastPaid?.paidBy ?? "Thu ngân khác",
            confirmedAt: lastPaid?.paidAt ?? fmtTime(this.now),
          })
        }
        if (sessionStatus === "CLOSED_UNPAID" || visit.endedAt) {
          throw new ApiError(409, "INVALID_STATE", "Phiên đã kết thúc (đã trả bàn) nhưng chưa ghi nhận thu tiền.")
        }
        throw new ApiError(
          409,
          "INVALID_STATE",
          "Phiên chưa tạo tạm tính (Chờ thanh toán), chưa thể xác nhận thu tiền.",
        )
      }
    }

    if (targetRecord.billStatus === "PAID") {
      if (this.paymentFault.nextConfirm === "dup") this.paymentFault.nextConfirm = undefined
      throw new ApiError(409, "DUPLICATE_PAYMENT", "Bill này đã được thanh toán trên thiết bị khác", {
        confirmedBy: targetRecord.paidBy ?? "Thu ngân khác",
        confirmedAt: targetRecord.paidAt ?? fmtTime(this.now),
      })
    }
    if (visit.endedAt) {
      throw new ApiError(409, "INVALID_STATE", "Phiên đã kết thúc (đã trả bàn) nhưng chưa ghi nhận thu tiền.")
    }
    if (this.paymentVersion(visit, meta) !== version) {
      throw new ApiError(409, "VERSION_CONFLICT", "Bill vừa được cập nhật, vui lòng tải lại.")
    }

    const billView = this.buildIssuedPayBill(visit, meta, targetRecord)
    if (billView.lines.length === 0) {
      throw new ApiError(409, "INVALID_STATE", "Phiên chưa có dữ liệu món trong bản mô phỏng.")
    }
    if (method === "CASH" && (!Number.isSafeInteger(givenVnd) || givenVnd < billView.dueVnd)) {
      throw new ApiError(400, "VALIDATION_FAILED", "Số tiền khách đưa chưa đủ.")
    }

    if (this.paymentFault.nextConfirm === "dup") {
      this.paymentFault.nextConfirm = undefined
      const dupAt = fmtTime(this.now)
      this.finalizePaidBill(visit, meta, targetRecord, billView, method, manual, "Hà · Thu ngân", dupAt)
      throw new ApiError(409, "DUPLICATE_PAYMENT", "Bill này đã được thanh toán trên thiết bị khác", {
        confirmedBy: "Thu ngân Hà",
        confirmedAt: dupAt,
      })
    }

    const confirmedAt = fmtTime(this.now)
    const staff = `${this.session.displayName} · ${ROLE_LABEL[this.session.role]}`
    const receipt: Receipt = {
      billCode: billView.billCode,
      visitId: billView.visitId,
      sessionCode: billView.sessionCode,
      code: billView.code,
      tables: [...billView.tables],
      ...(billView.clusterCode ? { clusterCode: billView.clusterCode } : {}),
      method,
      manual,
      givenVnd: method === "CASH" ? givenVnd : billView.dueVnd,
      changeVnd: method === "CASH" ? givenVnd - billView.dueVnd : 0,
      preRoundVnd: billView.preRoundVnd,
      dueVnd: billView.dueVnd,
      confirmedAt,
      confirmedBy: staff,
    }

    this.finalizePaidBill(visit, meta, targetRecord, billView, method, manual, staff, confirmedAt)
    this.paymentIdempotency.set(idempotencyKey, { fingerprint, receipt })
    this.recordPaymentAudit("PAID", billView.billCode, visit.id)

    this.seq += 1
    this.emit({
      latestSeq: this.seq,
      action: "PAYMENT_CONFIRMED",
      entityType: "visit",
      actorKind: "USER",
      actorUserId: this.session.id,
      summary: `Đã ghi nhận thanh toán ${billView.code}`,
    })
    return structuredClone(receipt)
  }

  async confirmPaymentCash(
    visitId: string,
    givenVnd: number,
    version: number,
    idempotencyKey: string,
    billCode?: string,
  ): Promise<Receipt> {
    await this.latency("m")
    return this.commitPayment(visitId, "CASH", false, givenVnd, version, idempotencyKey, billCode)
  }

  async confirmPaymentTransfer(
    visitId: string,
    manual: boolean,
    version: number,
    idempotencyKey: string,
    billCode?: string,
  ): Promise<Receipt> {
    await this.latency("m")
    return this.commitPayment(visitId, "TRANSFER", manual, 0, version, idempotencyKey, billCode)
  }

  private hasReopenConflict(tableId: number, visitBd: BusinessDate): boolean {
    const currentBd = businessDateOf(this.now)
    if (blockingAllocations(this.db, tableId, visitBd).length > 0) return true
    if (currentBd !== visitBd && blockingAllocations(this.db, tableId, currentBd).length > 0) return true
    return activeAllocations(this.db).some((a) => a.tableId === tableId && a.kind === "USAGE")
  }

  private revertPaidBillToUnpaid(visit: VisitRow, meta: PaymentVisitMeta, record: IssuedBillRecord) {
    if (visit.endedAt !== null) {
      const tracked = meta.lastClosedAllocIds?.length
        ? meta.lastClosedAllocIds
            .map((id) => this.db.allocations.get(id))
            .filter((a): a is NonNullable<typeof a> => Boolean(a && a.releasedAt !== null && a.releaseReason === "GUEST_LEFT"))
        : []
      const releasedAllocs =
        tracked.length > 0
          ? tracked
          : [...this.db.allocations.values()].filter(
              (a) => a.visitId === visit.id && a.kind === "USAGE" && a.releaseReason === "GUEST_LEFT",
            )
      if (releasedAllocs.some((a) => this.hasReopenConflict(a.tableId, visit.businessDate))) {
        throw new ApiError(409, "CONFLICT", "Bàn đang có khách khác sử dụng, không thể mở lại phiên.")
      }
      this.commit({ action: "PAYMENT_CANCELLED", entityType: "visit", undoable: false, silent: true }, (tx) => {
        for (const alloc of releasedAllocs) {
          const aRow = tx.edit("allocations", alloc.id)
          aRow.releasedAt = null
          aRow.releasedByUserId = null
          aRow.releaseReason = null
          if (alloc.groupId !== null) {
            const grp = this.db.groups.get(alloc.groupId)
            if (grp && grp.dissolvedAt && !grp.layoutTableIds) {
              const gRow = tx.edit("groups", grp.id)
              gRow.dissolvedAt = null
              gRow.dissolvedByUserId = null
            }
          }
        }
        const vRow = tx.edit("visits", visit.id)
        vRow.endedAt = null
        vRow.endedByUserId = null
        vRow.endReason = null
        vRow.paidMarkedAt = null
        vRow.paidMarkedByUserId = null
        return { entityId: visit.id, summary: `Mở lại phiên sau khi hủy ${record.billCode}` }
      })
      meta.lastClosedAllocIds = undefined
    } else {
      this.seq += 1
    }

    record.billStatus = "UNPAID"
    record.paidAt = undefined
    record.paidAtDate = undefined
    record.paidMethod = undefined
    record.paidBy = undefined
    record.manualConfirm = undefined
    record.cancelPending = false
    meta.versionOffset += 1
  }

  async requestPaymentCancel(billCode: string, reason: string): Promise<CancelRequest> {
    await this.latency("m")
    if (this.session.role !== "CASHIER") {
      throw new ApiError(403, "PERMISSION_DENIED", "Chỉ Thu ngân mới được gửi yêu cầu hủy thanh toán.")
    }
    const trimmed = reason.trim()
    if (!trimmed) {
      throw new ApiError(400, "VALIDATION_FAILED", "Vui lòng nhập lý do yêu cầu hủy thanh toán.")
    }
    const { visit, meta, record } = this.locateIssuedBill(billCode)
    if (record.billStatus !== "PAID") {
      throw new ApiError(409, "INVALID_STATE", "Chỉ có thể yêu cầu hủy bill đã thanh toán.")
    }
    if (record.cancelPending || this.cancelRequests.some((r) => r.billCode === billCode && r.status === "PENDING")) {
      throw new ApiError(409, "INVALID_STATE", "Bill này đang có yêu cầu hủy chờ duyệt.")
    }
    const billView = this.buildIssuedPayBill(visit, meta, record)
    const req: CancelRequestInternal = {
      id: `cr-${this.cancelRequestSeq++}`,
      billCode,
      visitId: String(visit.id),
      code: billView.code,
      dueVnd: billView.dueVnd,
      reason: trimmed,
      requestedBy: `${this.session.displayName} · ${ROLE_LABEL[this.session.role]}`,
      requestedByUserId: this.session.id,
      requestedAt: this.now.toISOString(),
      status: "PENDING",
    }
    this.cancelRequests.unshift(req)
    record.cancelPending = true
    meta.versionOffset += 1
    this.seq += 1
    this.pushPaymentEvent(
      "CANCEL_REQUESTED",
      "Yêu cầu hủy bill",
      `${billView.code} (${billCode}) · ${trimmed}`,
      visit.id,
      "creq",
      billCode,
    )
    this.recordPaymentAudit("CANCEL_REQUESTED", billCode, visit.id, {
      actor: req.requestedBy,
      reason: trimmed,
    })
    this.emit({
      latestSeq: this.seq,
      action: "PAYMENT_CANCEL_REQUESTED",
      entityType: "visit",
      actorKind: "USER",
      actorUserId: this.session.id,
      summary: `${billView.code} (${billCode}) · yêu cầu hủy thanh toán`,
    })
    return this.toCancelRequest(req)
  }

  async listMyPaymentCancelRequests(billCode?: string): Promise<CancelRequest[]> {
    await this.latency("q")
    this.require("payment.collect")
    return this.cancelRequests
      .filter((r) => r.requestedByUserId === this.session.id && (!billCode || r.billCode === billCode))
      .map((r) => this.toCancelRequest(r))
  }

  async listPaymentCancelRequests(): Promise<CancelRequest[]> {
    await this.latency("q")
    this.require("audit.read")
    return this.cancelRequests.map((r) => this.toCancelRequest(r))
  }

  async decidePaymentCancel(requestId: string, approve: boolean, note?: string): Promise<CancelRequest> {
    await this.latency("m")
    this.require("audit.read")
    const req = this.cancelRequests.find((r) => r.id === requestId)
    if (!req) {
      throw new ApiError(404, "NOT_FOUND", "Không tìm thấy yêu cầu hủy thanh toán.")
    }
    if (req.status !== "PENDING") {
      throw new ApiError(409, "INVALID_STATE", "Yêu cầu hủy này đã được xử lý trước đó.")
    }
    const { visit, meta, record } = this.locateIssuedBill(req.billCode)
    const decider = `${this.session.displayName} · ${ROLE_LABEL[this.session.role]}`
    const trimmedNote = note?.trim() || undefined

    if (approve) {
      if (record.billStatus !== "PAID") {
        throw new ApiError(409, "INVALID_STATE", "Bill không còn ở trạng thái Đã thanh toán.")
      }
      this.revertPaidBillToUnpaid(visit, meta, record)
      req.status = "APPROVED"
      req.decidedBy = decider
      req.decidedAt = this.now.toISOString()
      if (trimmedNote) req.decisionNote = trimmedNote
      this.pushPaymentEvent(
        "CANCEL_DECIDED",
        "Đã duyệt hủy thanh toán",
        `${req.code} (${req.billCode}) · quay lại Chờ thanh toán`,
        visit.id,
        "cdec",
        req.billCode,
      )
      this.recordPaymentAudit("CANCEL_APPROVED", req.billCode, visit.id, {
        actor: req.requestedBy,
        approver: decider,
        reason: trimmedNote ?? req.reason,
      })
      this.emit({
        latestSeq: this.seq,
        action: "PAYMENT_CANCELLED",
        entityType: "visit",
        actorKind: "USER",
        actorUserId: this.session.id,
        summary: `Đã duyệt hủy thanh toán ${req.code} (${req.billCode})`,
      })
    } else {
      req.status = "REJECTED"
      req.decidedBy = decider
      req.decidedAt = this.now.toISOString()
      if (trimmedNote) req.decisionNote = trimmedNote
      record.cancelPending = false
      meta.versionOffset += 1
      this.seq += 1
      this.pushPaymentEvent(
        "CANCEL_DECIDED",
        "Từ chối hủy thanh toán",
        `${req.code} (${req.billCode}) · giữ Đã thanh toán`,
        visit.id,
        "cdec",
        req.billCode,
      )
      this.recordPaymentAudit("CANCEL_REJECTED", req.billCode, visit.id, {
        actor: req.requestedBy,
        approver: decider,
        reason: trimmedNote ?? req.reason,
      })
      this.emit({
        latestSeq: this.seq,
        action: "PAYMENT_CANCEL_REJECTED",
        entityType: "visit",
        actorKind: "USER",
        actorUserId: this.session.id,
        summary: `Từ chối hủy thanh toán ${req.code} (${req.billCode})`,
      })
    }
    return this.toCancelRequest(req)
  }

  async cancelPaidBill(billCode: string, reason: string): Promise<void> {
    await this.latency("m")
    const allowed: RoleCode[] = ["RECEPTIONIST", "ADMIN", "OWNER"]
    if (!allowed.includes(this.session.role)) {
      throw new ApiError(403, "PERMISSION_DENIED", "Chỉ Lễ tân / Quản trị mới được hủy bill đã thanh toán trực tiếp.")
    }
    const trimmed = reason.trim()
    if (!trimmed) {
      throw new ApiError(400, "VALIDATION_FAILED", "Vui lòng nhập lý do hủy thanh toán.")
    }
    const { visit, meta, record } = this.locateIssuedBill(billCode)
    if (record.billStatus !== "PAID") {
      throw new ApiError(409, "INVALID_STATE", "Chỉ có thể hủy bill đã thanh toán.")
    }
    const billView = this.buildIssuedPayBill(visit, meta, record)
    this.revertPaidBillToUnpaid(visit, meta, record)
    const pendingReq = this.cancelRequests.find((r) => r.billCode === billCode && r.status === "PENDING")
    if (pendingReq) {
      pendingReq.status = "APPROVED"
      pendingReq.decidedBy = `${this.session.displayName} · ${ROLE_LABEL[this.session.role]}`
      pendingReq.decidedAt = this.now.toISOString()
      pendingReq.decisionNote = trimmed
    }
    this.pushPaymentEvent(
      "CANCEL_DECIDED",
      "Đã hủy thanh toán",
      `${billView.code} (${billCode}) · ${trimmed}`,
      visit.id,
      "cdir",
      billCode,
    )
    this.recordPaymentAudit("CANCELLED_DIRECT", billCode, visit.id, { reason: trimmed })
    this.emit({
      latestSeq: this.seq,
      action: "PAYMENT_CANCELLED",
      entityType: "visit",
      actorKind: "USER",
      actorUserId: this.session.id,
      summary: `Hủy thanh toán ${billView.code} (${billCode})`,
    })
  }

  async listPaidPaymentBills(): Promise<PaidBillSummary[]> {
    await this.latency("q")
    const allowed: RoleCode[] = ["RECEPTIONIST", "ADMIN", "OWNER"]
    if (!allowed.includes(this.session.role)) {
      throw new ApiError(403, "PERMISSION_DENIED", "Chỉ Lễ tân / Quản trị mới được xem danh sách bill đã thu.")
    }
    const currentBd = businessDateOf(this.now)
    const paid: { summary: PaidBillSummary; paidAtMs: number }[] = []
    for (const [visitIdNum, meta] of this.paymentMeta.entries()) {
      const visit = this.db.visits.get(visitIdNum)
      if (!visit) continue
      const tableInfo = this.resolveVisitTableInfo(visit, meta)
      for (const record of meta.bills) {
        if (record.billStatus !== "PAID") continue
        const shiftBd = record.paidAtDate ? businessDateOf(record.paidAtDate) : visit.businessDate
        if (shiftBd !== currentBd) continue
        paid.push({
          paidAtMs: record.paidAtDate?.getTime() ?? 0,
          summary: {
            billCode: record.billCode,
            visitId: String(visit.id),
            code: tableInfo.clusterCode ?? tableInfo.tables[0],
            tables: [...tableInfo.tables],
            ...(tableInfo.clusterCode ? { clusterCode: tableInfo.clusterCode } : {}),
            dueVnd: calcBillTotals(record.lines).dueVnd,
            method: record.paidMethod ?? "CASH",
            paidAt: record.paidAt ?? "",
            paidBy: record.paidBy ?? "",
          },
        })
      }
    }
    paid.sort((a, b) => b.paidAtMs - a.paidAtMs || b.summary.billCode.localeCompare(a.summary.billCode))
    return paid.map((item) => item.summary)
  }

  async listPaymentAudit(billCode?: string): Promise<PaymentAuditEntry[]> {
    await this.latency("q")
    if (!roleCan(this.session.role, "payment.collect") && this.session.role !== "RECEPTIONIST") {
      throw new ApiError(403, "PERMISSION_DENIED", "Tài khoản không có quyền xem nhật ký thanh toán.")
    }
    const list = billCode
      ? this.paymentAuditLog.filter((entry) => entry.billCode === billCode)
      : this.paymentAuditLog
    return structuredClone(list)
  }

  async listPaymentNotifications(): Promise<PaymentNotification[]> {
    await this.latency("q")
    this.requirePaymentRead()
    const items: PaymentNotification[] = []
    for (const [visitIdNum, meta] of this.paymentMeta.entries()) {
      const visit = this.db.visits.get(visitIdNum)
      if (!visit) continue
      const tableInfo = this.resolveVisitTableInfo(visit, meta)
      const displayCode = tableInfo.clusterCode ?? tableInfo.tables[0]
      const sessionStatus = this.deriveSessionStatus(visit, meta)

      const allLines: { scope: string; line: PayLine; index: number }[] = [
        ...meta.unbilledLines.map((line, index) => ({ scope: `u-${visit.id}`, line, index })),
        ...meta.bills.flatMap((b) => b.lines.map((line, index) => ({ scope: b.billCode, line, index }))),
      ]
      for (const { scope, line, index } of allLines) {
        if (line.state === "CANCELLED") {
          const timeStr = line.roundTime ?? fmtTime(visit.startedAt)
          items.push({
            id: `cancel-${scope}-${index}`,
            type: "CANCELLED_ITEM",
            title: "Đã hủy món",
            text: `${displayCode} · ${line.qty}× ${line.name}${line.note ? ` · ${line.note}` : ""}`,
            time: timeStr,
            occurredAt: atBusinessTime(visit.businessDate, timeStr).toISOString(),
            visitId: String(visit.id),
          })
        }
      }

      if (sessionStatus !== "PAID" && sessionStatus !== "CLOSED_UNPAID") {
        if (meta.requestedAt) {
          const reqDate = meta.requestedAtDate ?? atBusinessTime(visit.businessDate, meta.requestedAt)
          items.push({
            id: `req-B${String(visit.id).padStart(4, "0")}`,
            type: "PAYMENT_REQUEST",
            title: "Gọi thanh toán",
            text: `${displayCode} · PV ${meta.waiterName} gửi yêu cầu`,
            time: meta.requestedAt,
            occurredAt: reqDate.toISOString(),
            visitId: String(visit.id),
          })
        }
        for (const record of meta.bills) {
          if (record.billStatus === "UNPAID" && record.pendingAt) {
            const pendDate = record.pendingAtDate ?? atBusinessTime(visit.businessDate, record.pendingAt)
            const totals = calcBillTotals(record.lines)
            items.push({
              id: `pend-${record.billCode}`,
              type: "AWAITING_PAYMENT",
              title: "Chờ thanh toán",
              text: `${displayCode} · đã tạm tính ${formatVnd(totals.dueVnd)}`,
              time: record.pendingAt,
              occurredAt: pendDate.toISOString(),
              visitId: String(visit.id),
              billCode: record.billCode,
            })
          }
        }
      }
    }
    items.push(...this.paymentPaidLog, ...this.paymentEventLog)
    return items.sort((a, b) => (b.occurredAt ?? b.time).localeCompare(a.occurredAt ?? a.time))
  }

  async checkPaymentTransfer(visitId: string): Promise<{ found: boolean }> {
    await this.latency("m")
    this.require("payment.collect")
    this.resolvePaymentVisit(visitId)
    return { found: Boolean(this.paymentFault.qrFound) }
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

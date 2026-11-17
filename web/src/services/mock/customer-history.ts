import type {
  AnonymousVisitQuery,
  AssignAnonymousVisitInput,
  AssignmentUndo,
  DuplicateDecisionInput,
  SessionUser,
} from "@/domain/models"
import { foldVietnamese, isPlausibleVnPhone, noteHasPhoneNumber } from "@/lib/text"
import { ApiError } from "../contracts"
import { ORG_ID, VENUE_ID, type MockCustomer, type MockDb } from "./db"
import { projectTableTurns } from "./derive"
import { Tx } from "./tx"

type Audit = (
  action: string,
  entity: "visit" | "customer",
  id: number,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
) => number
export class MockCustomerHistory {
  private dismissed = new Set<string>()
  private replays = new Map<string, { userId: number; hash: string; result: unknown; expiresAt: number }>()
  private dbOf: () => MockDb
  private userOf: () => SessionUser
  private now: () => Date
  private audit: Audit
  constructor(dbOf: () => MockDb, userOf: () => SessionUser, now: () => Date, audit: Audit) {
    this.dbOf = dbOf
    this.userOf = userOf
    this.now = now
    this.audit = audit
  }
  private access(write = false, orgWide = false) {
    const user = this.userOf()
    if (
      !["OWNER", "ADMIN"].includes(user.role) ||
      (write && user.role === "ADMIN" && user.accessLevel === "READ_ONLY")
    ) {
      throw new ApiError(403, "PERMISSION_DENIED", "Tài khoản không có quyền thực hiện thao tác này.")
    }
    const global = user.role === "OWNER" || user.adminScope !== "VENUE"
    const canMerge = global && (user.role === "OWNER" || user.accessLevel !== "READ_ONLY")
    if (orgWide && !canMerge)
      throw new ApiError(403, "CUSTOMER_ORG_WRITE_REQUIRED", "Cần quyền quản trị ghi toàn tổ chức.")
    return { orgWide: global, canMerge }
  }
  private async replay<T>(key: string | undefined, path: string, body: unknown, run: () => T): Promise<T> {
    if (key === undefined) return run()
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(key))
      throw new ApiError(400, "INVALID_IDEMPOTENCY_KEY", "Mã chống trùng không hợp lệ.")
    const userId = this.userOf().id
    const fingerprint = new TextEncoder().encode(`customer-history:${path}@venue:${VENUE_ID}\n${JSON.stringify(body)}`)
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", fingerprint)), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("")
    const stored = this.replays.get(key)
    if (stored && stored.expiresAt > Date.now()) {
      if (stored.userId !== userId || stored.hash !== hash)
        throw new ApiError(422, "IDEMPOTENCY_KEY_REUSED", "Mã chống trùng đã được dùng cho một yêu cầu khác.")
      return structuredClone(stored.result) as T
    }
    const result = run()
    this.replays.set(key, { userId, hash, result: structuredClone(result), expiresAt: Date.now() + 86400000 })
    return result
  }
  private page(query: { page?: number; pageSize?: number }) {
    const page = query.page ?? 1,
      pageSize = query.pageSize ?? 20
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 50 ||
      !Number.isSafeInteger(page * pageSize)
    ) {
      throw new ApiError(422, "VALIDATION_FAILED", "Phân trang không hợp lệ.")
    }
    return { page, pageSize }
  }
  private view(customer: MockCustomer, orgWide = true) {
    const db = this.dbOf()
    const relevant = (row: { customerId: number | null; organizationId: number; venueId: number }) =>
      row.customerId === customer.id &&
      row.organizationId === customer.organizationId &&
      (orgWide || row.venueId === VENUE_ID)
    return {
      id: customer.id,
      displayName: customer.displayName && noteHasPhoneNumber(customer.displayName) ? "Khách" : customer.displayName,
      maskedPhone: customer.phoneLast3 ? `••• ${customer.phoneLast3}` : null,
      version: customer.version,
      visitCount: [...db.visits.values()].filter(relevant).length,
      bookingCount: [...db.reservations.values()].filter(relevant).length,
    }
  }
  async getAnonymousVisits(query: AnonymousVisitQuery) {
    this.access()
    for (const date of [query.from, query.to]) {
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        Number.isNaN(Date.parse(date)) ||
        new Date(date).toISOString().slice(0, 10) !== date
      ) {
        throw new ApiError(422, "INVALID_BUSINESS_DATE", "Ngày không hợp lệ.")
      }
    }
    if (query.from > query.to || Date.parse(query.to) - Date.parse(query.from) > 366 * 86400000)
      throw new ApiError(422, "INVALID_DATE_RANGE", "Khoảng ngày không hợp lệ.")
    const { page, pageSize } = this.page(query),
      db = this.dbOf()
    const rows = projectTableTurns(db)
      .filter(
        (turn) =>
          turn.counted &&
          turn.businessDate >= query.from &&
          turn.businessDate <= query.to &&
          db.visits.get(turn.visitId)?.customerId === null &&
          db.visits.get(turn.visitId)?.venueId === VENUE_ID,
      )
      .sort((a, b) => Date.parse(b.seatedAt) - Date.parse(a.seatedAt) || b.visitId - a.visitId)
    return {
      page,
      pageSize,
      hasMore: rows.length > page * pageSize,
      visits: rows.slice((page - 1) * pageSize, page * pageSize).map((turn) => ({
        visitId: turn.visitId,
        displayCode: `L-${turn.visitId}`,
        tableLabel: turn.groupCode || turn.tableCodes.join(" + "),
        guestCount: turn.guestCount,
        seatedAt: turn.seatedAt,
        businessDate: turn.businessDate,
        version: db.visits.get(turn.visitId)!.version,
      })),
    }
  }
  private visit(id: number, version: number) {
    const visit = this.dbOf().visits.get(id)
    if (!visit || visit.organizationId !== ORG_ID || visit.venueId !== VENUE_ID)
      throw new ApiError(404, "VISIT_NOT_FOUND", "Không tìm thấy lượt.")
    if (visit.version !== version) throw new ApiError(409, "VERSION_CONFLICT", "Lượt vừa thay đổi.")
    return visit
  }
  async assignAnonymousVisit(input: AssignAnonymousVisitInput) {
    this.access(true)
    const { visitId, idempotencyKey, ...body } = input
    return this.replay(idempotencyKey, `/visits/${visitId}/customer-assignment`, body, () => {
      const db = this.dbOf(),
        visit = this.visit(input.visitId, input.version)
      if (visit.customerId !== null) throw new ApiError(409, "VISIT_ALREADY_ASSIGNED", "Lượt đã được gán.")
      if (!projectTableTurns(db).some((turn) => turn.visitId === visit.id && turn.counted))
        throw new ApiError(409, "VISIT_NOT_COUNTED", "Lượt không được tính.")
      if (!isPlausibleVnPhone(input.phone))
        throw new ApiError(422, "INVALID_PHONE_NUMBER", "Số điện thoại không hợp lệ.")
      const phone = `+84${input.phone.replace(/\D/g, "").slice(1)}`
      let customer = [...db.customers.values()].find(
        (row) => row.organizationId === visit.organizationId && row.phoneE164 === phone,
      )
      if (customer && customer.status !== "ACTIVE")
        throw new ApiError(409, "CUSTOMER_INACTIVE", "Hồ sơ không còn hoạt động.")
      const customerCreated = !customer,
        name = input.displayName?.trim()
      if (!customer && (!name || name.length > 120))
        throw new ApiError(422, "CUSTOMER_NAME_REQUIRED", "Cần nhập tên khách (1-120 ký tự).")
      if (!customer && noteHasPhoneNumber(name!))
        throw new ApiError(422, "PHONE_IN_NOTE_FORBIDDEN", "Tên không được chứa số điện thoại.")
      const tx = new Tx(db)
      try {
        customer ??= tx.insert("customers", {
          organizationId: visit.organizationId,
          displayName: name!,
          nameSearch: foldVietnamese(name!),
          phoneE164: phone,
          phoneLast3: phone.slice(-3),
          status: "ACTIVE",
          mergedIntoCustomerId: null,
          anonymizedAt: null,
          createdAt: this.now(),
          notes: null,
        })
        tx.edit("visits", visit.id).customerId = customer.id
        const operationId = this.audit(
          "VISIT_CUSTOMER_ASSIGNED",
          "visit",
          visit.id,
          { customerId: null, version: input.version },
          { customerId: customer.id, customerCreated, version: visit.version },
        )
        return {
          visitId: visit.id,
          version: visit.version,
          customer: this.view(customer, false),
          customerCreated,
          undo: { operationId, visitId: visit.id, version: visit.version, previousCustomerId: null },
        }
      } catch (error) {
        tx.rollback()
        throw error
      }
    })
  }
  async undoAnonymousAssignment(input: AssignmentUndo) {
    this.access(true)
    const db = this.dbOf(),
      visit = this.visit(input.visitId, input.version)
    const op = db.ops.find(
      (row) => row.id === input.operationId && row.action === "VISIT_CUSTOMER_ASSIGNED" && row.entityId === visit.id,
    )
    if (!op) throw new ApiError(404, "ASSIGNMENT_NOT_FOUND", "Không tìm thấy thao tác.")
    const changes = op.changes as Array<{ after: { customerId: number; version: number } }>
    if (
      changes[0]?.after.version !== visit.version ||
      changes[0]?.after.customerId !== visit.customerId ||
      op.compensatedBy
    ) {
      throw new ApiError(409, "UNDO_CONFLICT_MODIFIED", "Lượt đã thay đổi sau khi gán.")
    }
    const before = { customerId: visit.customerId, version: visit.version }
    visit.customerId = null
    visit.version++
    const operationId = this.audit("UNDO_VISIT_CUSTOMER_ASSIGNED", "visit", visit.id, before, {
      customerId: null,
      version: visit.version,
    })
    op.compensatedBy = operationId
    db.ops.find((row) => row.id === operationId)!.compensatesOperationId = op.id
    return { visitId: visit.id, version: visit.version, customerId: null, operationId }
  }
  async getDuplicateCustomers(query: { page?: number; pageSize?: number } = {}) {
    const scope = this.access(),
      { page, pageSize } = this.page(query),
      db = this.dbOf()
    const customers = [...db.customers.values()].filter(
      (row) => row.organizationId === ORG_ID && row.status === "ACTIVE" && row.nameSearch,
    )
    const activeHere = (id: number) =>
      [...db.visits.values(), ...db.reservations.values(), ...db.waitlist.values()].some(
        (row) => row.organizationId === ORG_ID && row.venueId === VENUE_ID && row.customerId === id,
      )
    const pairs = customers
      .filter((row) => !row.phoneE164)
      .flatMap((source) =>
        customers
          .filter(
            (target) =>
              target.phoneE164 &&
              target.nameSearch === source.nameSearch &&
              !this.dismissed.has(`${source.id}:${target.id}`) &&
              (scope.orgWide || activeHere(source.id) || activeHere(target.id)),
          )
          .map((target) => ({ source: this.view(source, scope.orgWide), target: this.view(target, scope.orgWide) })),
      )
      .sort((a, b) => a.source.id - b.source.id || a.target.id - b.target.id)
    return {
      pairs: pairs.slice((page - 1) * pageSize, page * pageSize),
      page,
      pageSize,
      total: pairs.length,
      canMerge: scope.canMerge,
      canDismiss: scope.canMerge,
    }
  }
  private pair(input: DuplicateDecisionInput) {
    this.access(true, true)
    const db = this.dbOf(),
      source = db.customers.get(input.sourceCustomerId),
      target = db.customers.get(input.targetCustomerId)
    if (!source || !target || source.organizationId !== ORG_ID || target.organizationId !== ORG_ID)
      throw new ApiError(404, "CUSTOMER_NOT_FOUND", "Không tìm thấy hồ sơ.")
    if (source.version !== input.sourceVersion || target.version !== input.targetVersion)
      throw new ApiError(409, "VERSION_CONFLICT", "Hồ sơ vừa thay đổi.")
    if (
      source.id === target.id ||
      source.status !== "ACTIVE" ||
      target.status !== "ACTIVE" ||
      source.phoneE164 ||
      !target.phoneE164 ||
      !source.nameSearch ||
      source.nameSearch !== target.nameSearch
    ) {
      throw new ApiError(409, "DUPLICATE_PAIR_CHANGED", "Cặp hồ sơ không còn hợp lệ.")
    }
    if (this.dismissed.has(`${source.id}:${target.id}`))
      throw new ApiError(409, "DUPLICATE_PAIR_DISMISSED", "Cặp đã được bỏ qua.")
    return { source, target }
  }
  async mergeDuplicateCustomers(input: DuplicateDecisionInput) {
    this.access(true, true)
    const { idempotencyKey, ...body } = input
    return this.replay(idempotencyKey, "/customers/duplicates/merge", body, () => {
      const { source, target } = this.pair(input),
        db = this.dbOf(),
        tx = new Tx(db),
        moved: Record<string, number> = {}
      try {
        for (const [collection, table] of [
          ["visits", "visits"],
          ["reservations", "reservations"],
          ["waitlist", "waitlist_entries"],
        ] as const) {
          moved[table] = 0
          for (const row of db[collection].values())
            if (row.customerId === source.id && row.organizationId === source.organizationId) {
              tx.edit(collection, row.id).customerId = target.id
              moved[table]++
            }
        }
        moved.customers = 0
        for (const row of db.customers.values())
          if (row.mergedIntoCustomerId === source.id && row.organizationId === source.organizationId) {
            tx.edit("customers", row.id).mergedIntoCustomerId = target.id
            moved.customers++
          }
        const merged = tx.edit("customers", source.id)
        merged.status = "MERGED"
        merged.mergedIntoCustomerId = target.id
        tx.edit("customers", target.id)
        const operationId = this.audit(
          "CUSTOMERS_MERGED",
          "customer",
          source.id,
          {
            sourceCustomerId: source.id,
            targetCustomerId: target.id,
            sourceVersion: input.sourceVersion,
            targetVersion: input.targetVersion,
          },
          {
            sourceCustomerId: source.id,
            targetCustomerId: target.id,
            sourceVersion: source.version,
            targetVersion: target.version,
            moved,
          },
        )
        return {
          sourceCustomerId: source.id,
          targetCustomerId: target.id,
          sourceVersion: source.version,
          targetVersion: target.version,
          moved,
          operationId,
        }
      } catch (error) {
        tx.rollback()
        throw error
      }
    })
  }
  async dismissDuplicateCustomers(input: DuplicateDecisionInput) {
    this.access(true, true)
    const { idempotencyKey, ...body } = input
    return this.replay(idempotencyKey, "/customers/duplicates/dismiss", body, () => {
      const { source, target } = this.pair(input)
      const operationId = this.audit(
        "CUSTOMER_DUPLICATE_DISMISSED",
        "customer",
        source.id,
        { sourceCustomerId: source.id, targetCustomerId: target.id, dismissed: false },
        { sourceCustomerId: source.id, targetCustomerId: target.id, dismissed: true },
      )
      this.dismissed.add(`${source.id}:${target.id}`)
      return { sourceCustomerId: source.id, targetCustomerId: target.id, operationId }
    })
  }
}

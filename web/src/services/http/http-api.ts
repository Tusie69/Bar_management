/** Canonical GamApi backed exclusively by the frozen /api/v1 contract. */
import type { Catalog, ClaimView, MutationResult, SessionUser } from "@/domain/models"
import { businessDateOf, type BusinessDate } from "@/lib/time"
import { clock } from "../clock"
import { ApiError, type GamApi } from "../contracts"
import { HttpBookingApi } from "./booking-api"
import { createAndAssignDirectBooking } from "./direct-booking"
import {
  deriveAvailability,
  deriveOverview,
  mapReservation,
  mapWaitlist,
  type BackendWaitlistEntry,
} from "./canonical-adapter"
import {
  mapCatalog,
  mapFloorState,
  type BackendCatalog,
  type BackendFloorGroup,
  type BackendSource,
  type BackendTableState,
} from "./floor-adapter"
import { HttpVisitApi } from "./visit-api"
import type { HttpClient } from "./http-client"

const revive = (key: string, value: unknown) =>
  key.endsWith("At") && typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) ? new Date(value) : value
const result = (summary: string): MutationResult => ({ operationId: null, changeSeq: null, undoable: false, summary })
const unsupported = (capability: string): never => {
  throw new ApiError(501, "NOT_SUPPORTED_BY_BACKEND", `Máy chủ chưa hỗ trợ ${capability}.`)
}
const rejectUnsupported = (capability: string) => async () => unsupported(capability)
const catalogMaxAgeMs = 60_000

export function createHttpApi(client: HttpClient, _venueId: number): GamApi {
  // Venue is scoped by the server session; never sent as a client-selected actor scope.
  void _venueId
  let session: SessionUser | null = null
  const bookings = new HttpBookingApi(client)
  const visits = new HttpVisitApi(client)
  const get = <T>(path: string) => client.get<T>(path, { reviver: revive })
  const post = <T>(path: string, body: unknown) => client.post<T>(path, body, { reviver: revive })
  let cachedCatalog: { value: Catalog; expiresAt: number } | null = null
  let catalogLoad: Promise<Catalog> | null = null
  let catalogGeneration = 0
  let catalogSessionRevision = client.sessionRevision
  const invalidateCatalog = () => {
    catalogGeneration += 1
    cachedCatalog = null
    catalogLoad = null
  }
  // Scope reference data to this adapter/session; live allocations are always fetched.
  const loadCatalog = async () => {
    // AuthApi updates the CSRF token on login, restore, logout and expiry.
    if (catalogSessionRevision !== client.sessionRevision) {
      invalidateCatalog()
      catalogSessionRevision = client.sessionRevision
    }
    if (cachedCatalog && Date.now() < cachedCatalog.expiresAt) return structuredClone(cachedCatalog.value)
    if (!catalogLoad) {
      const generation = catalogGeneration
      const sessionRevision = client.sessionRevision
      const pending = Promise.all([
        get<BackendCatalog>("/tables/catalog"),
        get<{ sources: BackendSource[] }>("/bookings/sources"),
      ]).then(([catalog, sources]) => {
        const value = mapCatalog(catalog, sources.sources)
        // An older request must not restore data invalidated by a mutation or login.
        if (generation === catalogGeneration && sessionRevision === client.sessionRevision)
          cachedCatalog = { value, expiresAt: Date.now() + catalogMaxAgeMs }
        return value
      })
      catalogLoad = pending
      void pending
        .finally(() => {
          if (catalogLoad === pending) catalogLoad = null
        })
        .catch(() => undefined)
    }
    return structuredClone(await catalogLoad)
  }
  const snapshot = async (at: Date, date: BusinessDate = businessDateOf(at)) => {
    const [catalog, tables, rows] = await Promise.all([
      loadCatalog(),
      get<{ businessDate: string; tables: BackendTableState[]; groups?: BackendFloorGroup[] }>(`/tables?date=${date}`),
      bookings.list(date),
    ])
    if (tables.businessDate !== date) {
      throw new ApiError(502, "BUSINESS_DATE_RESPONSE_MISMATCH", "Unexpected business date in floor response.")
    }
    return {
      catalog,
      bookings: rows,
      floor: mapFloorState(at, tables.businessDate, tables.tables, rows, catalog, tables.groups),
    }
  }
  const listWaitlist = async (date: BusinessDate) => {
    const response = await get<{ businessDate: string; entries: BackendWaitlistEntry[] }>(`/waitlist?date=${date}`)
    if (response.businessDate !== date || response.entries.some((entry) => entry.businessDate !== date)) {
      throw new ApiError(502, "BUSINESS_DATE_RESPONSE_MISMATCH", "Backend trả về khách chờ khác ngày đã yêu cầu.")
    }
    return response.entries.map(mapWaitlist)
  }
  const visitClaim = async (id: number): Promise<ClaimView> => {
    const { floor } = await snapshot(clock.now())
    const claim = floor.tables.find((table) => table.claim?.visitId === id)?.claim
    if (!claim) throw new ApiError(404, "VISIT_NOT_FOUND", "Không tìm thấy lượt khách đang mở. Hãy tải lại sơ đồ.")
    return claim
  }
  const idsForCodes = async (codes: string[]) => {
    const catalog = await loadCatalog()
    const ids = codes.map((code) => catalog.tables.find((table) => table.code === code)?.id)
    if (ids.some((id) => id === undefined))
      throw new ApiError(502, "UNKNOWN_TABLE", "Máy chủ trả về bàn không có trong danh mục.")
    return ids as number[]
  }
  return {
    mode: "http",
    setSession(user) {
      invalidateCatalog()
      session = user
    },
    listDemoUsers: () => (session ? [session] : []),
    subscribe: () => () => undefined,
    getCatalog: loadCatalog,
    getFloorState: async (at, date) => (await snapshot(at, date)).floor,
    getAvailability: async (at, party) => {
      const data = await snapshot(at)
      return deriveAvailability(at, party, data.floor, data.bookings, data.catalog)
    },
    getShiftOverview: async () => {
      const now = clock.now()
      const [data, entries] = await Promise.all([snapshot(now), listWaitlist(businessDateOf(now))])
      return deriveOverview(now, data.floor, data.bookings, entries, data.catalog)
    },
    listReservations: async (query) => {
      const [rows, catalog] = await Promise.all([bookings.list(query.businessDate, query.search), loadCatalog()])
      return rows.map((booking) => mapReservation(booking, catalog))
    },
    listWaitlist,
    exportDailyBookingText: (date) => bookings.exportDailyText(date),
    createReservation: async (input) => {
      if (input.overrideReason) unsupported("phân bàn vượt quy tắc")
      const fields = {
        guestName: input.contactName ?? "",
        partySize: input.partySize,
        expectedAt: input.expectedAt,
        businessDate: businessDateOf(input.expectedAt),
        sourceCode: input.sourceCode,
        classification: input.classification,
        note: input.note,
        ...(input.phone === undefined ? {} : { phoneNumber: input.phone }),
      }
      const created = input.tableIds?.length
        ? await createAndAssignDirectBooking(bookings, fields, input.tableIds)
        : await bookings.create(fields)
      return { ...result("Đã tạo booking."), reservationId: created.id }
    },
    updateReservation: async (input) => {
      const current = await bookings.detail(input.id)
      await bookings.update(
        { ...current, version: input.version },
        {
          ...(input.contactName === undefined ? {} : { guestName: input.contactName }),
          ...(input.partySize === undefined ? {} : { partySize: input.partySize }),
          ...(input.expectedAt === undefined
            ? {}
            : { expectedAt: input.expectedAt, businessDate: businessDateOf(input.expectedAt) }),
          ...(input.sourceCode === undefined ? {} : { sourceCode: input.sourceCode }),
          ...(input.classification === undefined ? {} : { classification: input.classification }),
          ...(input.note === undefined ? {} : { note: input.note }),
        },
      )
      return result("Đã cập nhật booking.")
    },
    assignTables: async (id, version, tableIds, overrideReason) => {
      if (overrideReason) unsupported("phân bàn vượt quy tắc")
      await bookings.assignVersion(id, version, tableIds)
      return result("Đã phân bàn.")
    },
    cancelReservation: async (id, version, reason, note) => {
      await bookings.cancelVersion(id, version, note || reason)
      return result("Đã hủy booking.")
    },
    markNoShow: async (id, version) => {
      await bookings.markNoShow(id, version)
      return result("Đã xác nhận khách không đến.")
    },
    checkIn: async (input) => {
      if (input.overrideReason) unsupported("check-in vượt quy tắc")
      let current = await bookings.detail(input.reservationId)
      if (input.guestCount !== current.partySize)
        unsupported("thay đổi số khách khi check-in; hãy dùng số khách đã đặt")
      // Preserve the UI's version, even when the detail read sees a newer row.
      current = { ...current, version: input.version }
      if (input.tableIds) {
        const currentIds = await idsForCodes(current.tableCodes)
        if (
          currentIds.length !== new Set(input.tableIds).size ||
          input.tableIds.some((id) => !currentIds.includes(id))
        ) {
          current = await bookings.assignVersion(current.id, input.version, input.tableIds)
        }
      }
      await bookings.checkIn(current)
      return result("Đã check-in.")
    },
    seatWalkIn: async (input) => {
      if (input.overrideReason) unsupported("nhận khách vượt quy tắc")
      const response = await post<{ visitId: number }>("/bookings/walk-ins", {
        partySize: input.guestCount,
        businessDate: businessDateOf(clock.now()),
        tableIds: input.tableIds,
        ...(input.contactName ? { guestName: input.contactName } : {}),
      })
      return { ...result("Đã nhận khách walk-in."), visitId: response.visitId }
    },
    moveClaim: async (input) => {
      if (input.overrideReason) unsupported("đổi bàn vượt quy tắc")
      if (input.claim.visitId) {
        const claim = await visitClaim(input.claim.visitId)
        if (!input.tableIds && !claim.tableIds.includes(input.fromTableId))
          throw new ApiError(409, "TABLE_CONFLICT", "Lượt khách đã đổi bàn. Hãy tải lại sơ đồ.")
        await visits.move(input.claim.visitId, input.claim.version ?? claim.version, [
          ...new Set(input.tableIds ?? claim.tableIds.map((id) => (id === input.fromTableId ? input.toTableId : id))),
        ])
      } else if (input.claim.reservationId) {
        const booking = await bookings.detail(input.claim.reservationId)
        const ids = await idsForCodes(booking.tableCodes)
        if (!input.tableIds && !ids.includes(input.fromTableId))
          throw new ApiError(409, "TABLE_CONFLICT", "Booking đã đổi bàn. Hãy tải lại sơ đồ.")
        await bookings.assignVersion(booking.id, input.claim.version ?? booking.version, [
          ...new Set(input.tableIds ?? ids.map((id) => (id === input.fromTableId ? input.toTableId : id))),
        ])
      } else unsupported("đổi bàn đang giữ từ danh sách chờ")
      return result("Đã đổi bàn.")
    },
    combineTables: async (input) => {
      if (input.overrideReason) unsupported("ghép bàn vượt quy tắc")
      if (input.claim.visitId) {
        const claim = await visitClaim(input.claim.visitId)
        await visits.merge(input.claim.visitId, input.claim.version ?? claim.version, [
          ...new Set([...claim.tableIds, ...input.addTableIds]),
        ])
      } else if (input.claim.reservationId) {
        const booking = await bookings.detail(input.claim.reservationId)
        const ids = await idsForCodes(booking.tableCodes)
        await bookings.merge(booking.id, input.claim.version ?? booking.version, [
          ...new Set([...ids, ...input.addTableIds]),
        ])
      } else unsupported("ghép bàn không có lượt khách hoặc booking")
      return result("Đã ghép bàn.")
    },
    endVisit: async (id, version) => {
      await visits.close(id, version)
      return result("Đã nhả bàn.")
    },
    setTableStatus: async (id, version, patch) => {
      if (!patch.status && patch.isSpare === undefined)
        throw new ApiError(400, "INVALID_TABLE_PATCH", "Chưa chọn thay đổi cho bàn.")
      if (patch.status && !patch.reason?.trim())
        throw new ApiError(400, "REASON_REQUIRED", "Cần nhập lý do thay đổi trạng thái phục vụ.")
      try {
        await client.patch(`/tables/${id}/configuration`, {
          version,
          ...(patch.status === undefined ? {} : { status: patch.status }),
          ...(patch.isSpare === undefined ? {} : { isSpare: patch.isSpare }),
          reason: patch.reason?.trim() || "Nhân viên cập nhật cờ bàn sơ cua.",
        })
      } finally {
        // A failed/timeout response can still follow a committed server-side change.
        invalidateCatalog()
      }
      return result("Đã cập nhật bàn.")
    },
    addWaitlist: async (input) => {
      if (input.preferenceMode !== "ANY" || input.preferences.length) unsupported("lưu lựa chọn bàn ưu tiên")
      let body: Record<string, unknown>
      if (input.kind === "ADVANCE_RESERVATION") {
        if (!Number.isSafeInteger(input.reservationId) || (input.reservationId ?? 0) <= 0)
          throw new ApiError(400, "INVALID_RESERVATION_ID", "Cần chọn booking cho khách đặt trước.")
        const reservation = await bookings.detail(input.reservationId as number)
        body = {
          kind: "ADVANCE_RESERVATION",
          reservationId: input.reservationId,
          businessDate: reservation.businessDate,
        }
      } else {
        if (input.reservationId !== undefined)
          throw new ApiError(400, "INVALID_WAITLIST_SHAPE", "Khách vãng lai không liên kết booking.")
        body = {
          guestName: input.contactName ?? "",
          partySize: input.partySize,
          businessDate: input.businessDate ?? businessDateOf(clock.now()),
          ...(input.phone === undefined ? {} : { phoneNumber: input.phone }),
        }
      }
      const response = await post<{ entry: BackendWaitlistEntry }>("/waitlist", {
        ...body,
        contactChannel: input.channel,
        ...(input.note === undefined ? {} : { note: input.note }),
      })
      return { ...result("Đã thêm khách vào danh sách chờ."), entryId: response.entry.id }
    },
    seatWaitlist: async (input) => {
      if (input.overrideReason) unsupported("nhận khách chờ vượt quy tắc")
      const response = await post<{ reservationId: number; groupId: number | null }>(
        `/waitlist/${input.entryId}/seat`,
        {
          version: input.version,
          tableIds: input.tableIds ?? [],
        },
      )
      return {
        ...result("Đã gán bàn cho khách chờ."),
        reservationId: response.reservationId,
        groupId: response.groupId,
      }
    },
    cancelWaitlist: async (id, version, reasonCode, note) => {
      await post(`/waitlist/${id}/cancel`, { version, reasonCode, ...(note === undefined ? {} : { note }) })
      return result("Đã hủy mục chờ.")
    },
    recordContact: async (input) => {
      if (input.offeredTableIds?.length || input.overrideReason) unsupported("tạo đề nghị hoặc giữ bàn khi ghi liên hệ")
      await post(`/waitlist/${input.entryId}/contact-attempts`, {
        version: input.version,
        channel: input.channel,
        outcome: input.outcome,
        ...(input.note === undefined ? {} : { note: input.note }),
      })
      return result("Đã ghi kết quả liên hệ. Trạng thái và giữ bàn không tự thay đổi.")
    },
    revealPhone: async (bookingId, _reason, context) => {
      if (context.entryId && !context.reservationId) unsupported("mở số điện thoại mục chờ không có booking")
      return {
        customerId: null,
        phoneE164: await bookings.revealPhone(context.reservationId ?? bookingId),
        revealedAt: new Date(),
      }
    },
    listVisits: rejectUnsupported("danh sách lượt khách"),
    searchCustomers: rejectUnsupported("tìm khách hàng"),
    getCustomer: rejectUnsupported("hồ sơ khách hàng"),
    listOperations: rejectUnsupported("nhật ký thao tác"),
    listAllocations: rejectUnsupported("lịch sử sử dụng bàn"),
    getReport: rejectUnsupported("báo cáo"),
    splitGroup: rejectUnsupported("tách nhóm bàn"),
    markPaid: rejectUnsupported("xác minh thanh toán"),
    claimWaitlist: rejectUnsupported("nhận quyền liên hệ"),
    releaseClaim: rejectUnsupported("nhả quyền liên hệ"),
    setHoldDeadline: rejectUnsupported("gia hạn giữ bàn"),
    releaseHold: rejectUnsupported("nhả giữ bàn"),
    updateCustomerNotes: rejectUnsupported("ghi chú hồ sơ khách"),
    undo: rejectUnsupported("hoàn tác"),
    redo: rejectUnsupported("làm lại"),
    updateVenueConfig: rejectUnsupported("cấu hình quán"),
    setZoneFlags: rejectUnsupported("cấu hình khu"),
  }
}

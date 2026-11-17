import { ORIGIN_LABEL, SOURCE_LABEL, type BookingSourceCode, type RoleCode, type VisitOrigin } from "@/domain/enums"
import type {
  DuplicateCustomer,
  TableTurnQuery,
  TableTurnSummary,
  TableTurnView,
  TableTurnsParams,
} from "@/domain/models"
import { isPlausibleVnPhone, noteHasPhoneNumber } from "@/lib/text"
import {
  addDays,
  fmtBusinessDate,
  fmtDayMonth,
  fmtTime,
  fromVenueLocal,
  venueParts,
  type BusinessDate,
} from "@/lib/time"
import { isApiError } from "@/services/contracts"

export type TurnRangePreset = "today" | "week" | "7days" | "30days" | "date"

export interface BusinessDateRange {
  from: BusinessDate
  to: BusinessDate
}

export interface TurnKpiTotals {
  arrivedTotal: number
  guestTotal: number
  openTotal: number
  closedCountedTotal: number
}

export interface DailyTurnPoint {
  businessDate: BusinessDate
  turns: number
  guests: number
}

export interface EndReasonMeta {
  label: string
  isUncounted: boolean
  isOpen: boolean
}

/**
 * Defensive UI shape supporting both the current `models.ts` fields and legacy/transitional
 * payloads (`status`, `checkedInBy*`, nullable `releasedAt`/`endReason`, nullable `turnId`).
 */
export type ExtendedTableTurnView = Omit<
  TableTurnView,
  | "turnId"
  | "status"
  | "releasedAt"
  | "endReason"
  | "checkedInByUserId"
  | "checkedInByDisplayName"
  | "closedByUserId"
  | "closedByDisplayName"
> & {
  turnId: number | null
  status?: "OPEN" | "CLOSED"
  releasedAt?: string | null
  endReason?: string | null
  checkedInByUserId?: number | null
  checkedInByDisplayName?: string | null
  closedByUserId?: number | null
  closedByDisplayName?: string | null
}

/** Defensive UI shape for `summary.byStaff` supporting `checkedInBy*` and legacy `closedBy*`. */
export interface ExtendedStaffBucket {
  checkedInByUserId?: number | null
  checkedInByDisplayName?: string | null
  closedByUserId?: number | null
  closedByDisplayName?: string | null
  turns: number
  guests: number
}

/** Defensive query params shape supporting `checkedInByUserId` alongside legacy `closedByUserId`. */
export type ExtendedTableTurnsParams = TableTurnsParams & {
  checkedInByUserId?: number
}

const END_REASON_LABELS: Record<string, Omit<EndReasonMeta, "isOpen">> = {
  GUEST_LEFT: { label: "Đã trả bàn", isUncounted: false },
  AFTER_PAYMENT: { label: "Sau thanh toán", isUncounted: false },
  MERGED: { label: "Gộp lượt", isUncounted: false },
  ENTRY_ERROR: { label: "Nhập nhầm", isUncounted: true },
  BUSINESS_DAY_END: { label: "Hệ thống đóng ca", isUncounted: true },
}

/**
 * Returns the Monday-Sunday business date range containing `businessDate`.
 * Uses the venue's fixed UTC+07:00 calendar helpers so weekday math never drifts.
 */
export function getWeekRange(businessDate: BusinessDate): BusinessDateRange {
  const weekday = venueParts(fromVenueLocal(businessDate, "12:00")).weekday // 0 = Sun, 1 = Mon .. 6 = Sat
  const offsetToMonday = weekday === 0 ? -6 : 1 - weekday
  const from = addDays(businessDate, offsetToMonday)
  const to = addDays(from, 6)
  return { from, to }
}

/**
 * Returns the inclusive 7-business-day range ending on `businessDate`.
 */
export function get7DayRange(businessDate: BusinessDate): BusinessDateRange {
  return {
    from: addDays(businessDate, -6),
    to: businessDate,
  }
}

/**
 * Returns the inclusive 30-business-day range ending on `businessDate`.
 */
export function get30DayRange(businessDate: BusinessDate): BusinessDateRange {
  return {
    from: addDays(businessDate, -29),
    to: businessDate,
  }
}

/**
 * Resolves the inclusive `[from, to]` business date range for the selected filter preset.
 */
export function resolveTurnDateRange(
  preset: TurnRangePreset,
  today: BusinessDate,
  pickedDate: BusinessDate,
): BusinessDateRange {
  switch (preset) {
    case "today":
      return { from: today, to: today }
    case "week":
      return getWeekRange(today)
    case "7days":
      return get7DayRange(today)
    case "30days":
      return get30DayRange(today)
    case "date":
      return { from: pickedDate, to: pickedDate }
  }
}

/**
 * Fills every business date in `[from, to]` inclusive, defaulting missing days to 0 turns and 0 guests.
 */
export function fillBusinessDateSeries(
  from: BusinessDate,
  to: BusinessDate,
  buckets: readonly TableTurnSummary["byBusinessDate"][number][],
): DailyTurnPoint[] {
  if (!from || !to || from > to) return []
  const byDate = new Map(buckets.map((bucket) => [bucket.businessDate, bucket]))
  const result: DailyTurnPoint[] = []
  let cursor = from
  let guard = 0
  while (cursor <= to && guard < 367) {
    const existing = byDate.get(cursor)
    result.push({
      businessDate: cursor,
      turns: existing?.turns ?? 0,
      guests: existing?.guests ?? 0,
    })
    cursor = addDays(cursor, 1)
    guard += 1
  }
  return result
}

/**
 * Extracts `(userId, displayName)` preferring `checkedInBy*` and falling back to
 * `closedBy*` only when `checkedInBy*` fields are absent on the payload.
 */
export function resolveStaffIdentity(row: {
  checkedInByUserId?: number | null
  checkedInByDisplayName?: string | null
  closedByUserId?: number | null
  closedByDisplayName?: string | null
}): { userId: number | null; displayName: string | null } {
  const hasCheckedIn = "checkedInByUserId" in row && row.checkedInByUserId !== undefined
  if (hasCheckedIn) {
    return {
      userId: row.checkedInByUserId ?? null,
      displayName: row.checkedInByDisplayName ?? null,
    }
  }
  return {
    userId: row.closedByUserId ?? null,
    displayName: row.closedByDisplayName ?? null,
  }
}

/**
 * Returns true if the backend/mock summary already provides `checkedInByUserId` on staff rows.
 */
export function hasCheckedInByStaffField(summary?: Pick<TableTurnSummary, "byStaff"> | null): boolean {
  return Boolean(summary?.byStaff.some((row) => "checkedInByUserId" in row))
}

/**
 * Determines whether a turn is still active (`status === "OPEN"` or missing `releasedAt`).
 */
export function isTurnOpen(row: Pick<ExtendedTableTurnView, "status" | "releasedAt">): boolean {
  return row.status === "OPEN" || !row.releasedAt
}

/**
 * Formats the staff display name ("Người check-in").
 * Null staff IDs display "Hệ thống".
 */
export function formatStaffName(staffUserId: number | null, staffDisplayName: string | null): string {
  if (staffUserId === null) return "Hệ thống"
  const trimmed = staffDisplayName?.trim()
  return trimmed ? trimmed : `Nhân viên #${staffUserId}`
}

/**
 * Maps turn `status` / `endReason` to its Vietnamese badge label and state flags.
 */
export function formatEndReason(endReason: string | null | undefined, status?: "OPEN" | "CLOSED"): EndReasonMeta {
  if (status === "OPEN" || (!endReason && status !== "CLOSED")) {
    return { label: "Đang ngồi", isUncounted: false, isOpen: true }
  }
  if (!endReason) {
    return { label: "Đã trả bàn", isUncounted: false, isOpen: false }
  }
  const matched = END_REASON_LABELS[endReason]
  if (matched) {
    return { ...matched, isOpen: false }
  }
  return { label: endReason, isUncounted: false, isOpen: false }
}

/**
 * Maps a turn's booking `sourceCode` (or fallback `origin`) to a Vietnamese label.
 */
export function formatTurnSource(sourceCode: string | null, origin: string): string {
  if (sourceCode) {
    return SOURCE_LABEL[sourceCode as BookingSourceCode] ?? ORIGIN_LABEL[sourceCode as VisitOrigin] ?? sourceCode
  }
  return ORIGIN_LABEL[origin as VisitOrigin] ?? origin ?? "—"
}

/**
 * Formats a turn's logical scope label (`groupCode` for GROUP, joined `tableCodes` for TABLE).
 */
export function formatScopeLabel(row: Pick<TableTurnView, "scope" | "groupCode" | "tableCodes">): string {
  if (row.scope === "GROUP" && row.groupCode) return row.groupCode
  if (row.tableCodes.length > 0) return row.tableCodes.join(" + ")
  return "—"
}

/**
 * Masks any full phone-like sequence inside free-form display text so full phone numbers
 * are never exposed in the turn ledger UI.
 */
export function maskPhoneNumbersInText(value: string): string {
  if (!value) return value
  return value.replace(/(?:\(\+?\d{1,4}\)\s*|\+?\d)(?:[\d\s().-]{6,}\d)/g, (match) => {
    const digits = match.replace(/\D/g, "")
    if (digits.length < 8) return match
    if (/^\d{4}-\d{2}-\d{2}$/.test(match.trim())) return match
    return `***${digits.slice(-3)}`
  })
}

/**
 * Formats ISO `seatedAt` and nullable `releasedAt` timestamps as `HH:mm → HH:mm`,
 * or `HH:mm → —` while the turn is open / guest is still seated.
 */
export function formatTimeRange(
  seatedAt: string,
  releasedAt: string | null | undefined,
  status?: "OPEN" | "CLOSED",
): string {
  const start = seatedAt ? fmtTime(new Date(seatedAt)) : "--:--"
  if (status === "OPEN" || !releasedAt) {
    return `${start} → —`
  }
  const end = fmtTime(new Date(releasedAt))
  return `${start} → ${end}`
}

/**
 * Formats a compact range caption matching the active filter preset.
 */
export function formatRangeCaption(preset: TurnRangePreset, from: BusinessDate, to: BusinessDate): string {
  if (from === to) {
    const year = from.slice(0, 4)
    return `${fmtBusinessDate(from, "short")}/${year}`
  }
  const prefix =
    preset === "week"
      ? "Tuần này"
      : preset === "7days"
        ? "7 ngày qua"
        : preset === "30days"
          ? "30 ngày qua"
          : "Khoảng ngày"
  return `${prefix} · ${fmtDayMonth(from)} - ${fmtDayMonth(to)}/${to.slice(0, 4)}`
}

/**
 * Formats the ledger card title suffix ("Sổ lượt - <range caption>"), e.g. "ca 12/11".
 */
export function formatLedgerRangeCaption(preset: TurnRangePreset, from: BusinessDate, to: BusinessDate): string {
  if (from === to) {
    return `ca ${fmtDayMonth(from)}`
  }
  if (preset === "week") {
    return `tuần ${fmtDayMonth(from)} - ${fmtDayMonth(to)}`
  }
  if (preset === "7days") {
    return `7 ngày (${fmtDayMonth(from)} - ${fmtDayMonth(to)})`
  }
  if (preset === "30days") {
    return `30 ngày (${fmtDayMonth(from)} - ${fmtDayMonth(to)})`
  }
  return `${fmtDayMonth(from)} - ${fmtDayMonth(to)}`
}

/**
 * Formats a turn's stable display code from its visit ID (`L-<visitId>`).
 */
export function formatTurnCode(visitId: number): string {
  return `L-${visitId}`
}

/**
 * Computes the 4 KPI card totals from `TableTurnSummary` without recounting paginated rows.
 * `completedTotal` counts all counted turns (`OPEN` + `CLOSED` counted), while `openTotal`
 * counts active `OPEN` turns in the range (`0 <= openTotal <= completedTotal`).
 */
export function computeTurnKpis(summary: TableTurnSummary): TurnKpiTotals {
  const arrivedTotal = summary.completedTotal
  const openTotal = Math.max(0, Math.min(arrivedTotal, summary.openTotal))
  const closedCountedTotal = arrivedTotal - openTotal
  return {
    arrivedTotal,
    guestTotal: summary.guestTotal,
    openTotal,
    closedCountedTotal,
  }
}

/**
 * Computes the uncounted turn count from summary buckets and `completedTotal` without
 * reading or recounting paged turn rows.
 */
export function getSummaryUncountedTotal(summary: TableTurnSummary): number {
  const allBucketTurns = summary.byBusinessDate.reduce((sum, item) => sum + item.turns, 0)
  return Math.max(0, allBucketTurns - summary.completedTotal)
}

/**
 * Builds the `useTableTurnSummary` query parameters for the selected range and uncounted toggle.
 */
export function buildSummaryQuery(from: BusinessDate, to: BusinessDate, includeUncounted: boolean): TableTurnQuery {
  return {
    from,
    to,
    ...(includeUncounted ? { includeUncounted: true } : {}),
  }
}

/**
 * Builds the `useTableTurns` query parameters for the paginated ledger list.
 * Defaults to `checkedInByUserId` per BA decision and falls back to `closedByUserId`
 * when `staffFilterField` is `"closedByUserId"`.
 */
export function buildListParams(
  from: BusinessDate,
  to: BusinessDate,
  includeUncounted: boolean,
  staffUserId: number | undefined,
  page: number,
  pageSize: number,
  staffFilterField: "checkedInByUserId" | "closedByUserId" = "checkedInByUserId",
): TableTurnsParams {
  const params: ExtendedTableTurnsParams = {
    from,
    to,
    page,
    pageSize,
    ...(includeUncounted ? { includeUncounted: true } : {}),
    ...(staffUserId !== undefined
      ? staffFilterField === "checkedInByUserId"
        ? { checkedInByUserId: staffUserId }
        : { closedByUserId: staffUserId }
      : {}),
  }
  return params
}

/**
 * Computes the next radio index for keyboard navigation (`Arrow*`, `Home`, `End`)
 * with wraparound, or `null` if the key does not navigate within the group.
 */
export function resolveRadioKeyTargetIndex(key: string, currentIndex: number, count: number): number | null {
  if (count <= 0) return null
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (currentIndex + 1) % count
    case "ArrowLeft":
    case "ArrowUp":
      return (currentIndex - 1 + count) % count
    case "Home":
      return 0
    case "End":
      return count - 1
    default:
      return null
  }
}

export interface TurnWriteAccess {
  isReadOnly: boolean
  canAssignAnonymous: boolean
}

export interface MappedHistoryError {
  message: string
  isConflict: boolean
  isForbidden: boolean
  requiresName: boolean
}

/**
 * Resolves whether the current admin/owner session can mutate anonymous visit assignments.
 * Honors server `principal.accessLevel` and `permissions` when present, plus mock `user.accessLevel`.
 */
export function resolveTurnWriteAccess(session: {
  mode: "mock" | "http"
  role?: RoleCode
  userAccessLevel?: "WRITE" | "READ_ONLY" | null
  principalAccessLevel?: "WRITE" | "READ_ONLY" | null
  hasPrincipal: boolean
  permissions: readonly string[]
}): TurnWriteAccess {
  if (session.userAccessLevel === "READ_ONLY" || session.principalAccessLevel === "READ_ONLY") {
    return { isReadOnly: true, canAssignAnonymous: false }
  }
  if (session.role === "OWNER") {
    return { isReadOnly: false, canAssignAnonymous: true }
  }
  if (session.role !== "ADMIN") {
    return { isReadOnly: true, canAssignAnonymous: false }
  }
  if (session.mode === "http" || session.hasPrincipal) {
    if (
      session.permissions.includes("customer.history.manage") ||
      session.permissions.includes("user.manage") ||
      session.principalAccessLevel === "WRITE"
    ) {
      return { isReadOnly: false, canAssignAnonymous: true }
    }
    return { isReadOnly: true, canAssignAnonymous: false }
  }
  return { isReadOnly: false, canAssignAnonymous: true }
}

/**
 * Formats the display label for an anonymous visit (`Khách Walk-in #<id>` fallback or masked ledger name).
 */
export function formatAnonymousGuestLabel(visitId: number, ledgerGuestName?: string | null): string {
  const safe = ledgerGuestName ? maskPhoneNumbersInText(ledgerGuestName).trim() : ""
  if (!safe || safe === "Khách" || safe === "Khách Walk-in") {
    return `Khách Walk-in #${visitId}`
  }
  return safe
}

/**
 * Formats an anonymous visit's seated time as `<HH:mm> hôm nay` or `<HH:mm> <dd/mm>`.
 */
export function formatAnonymousVisitTimestamp(
  seatedAt: string,
  businessDate: BusinessDate,
  currentBusinessDate: BusinessDate,
): string {
  const time = seatedAt ? fmtTime(new Date(seatedAt)) : "--:--"
  const suffix = businessDate === currentBusinessDate ? "hôm nay" : fmtDayMonth(businessDate)
  return `${time} ${suffix}`
}

/**
 * Formats a remaining anonymous visit count label without assuming a total when `hasMore` is true.
 */
export function formatRemainingAnonymousCount(visibleCount: number, hasMore: boolean): string {
  if (visibleCount <= 0) return ""
  return hasMore ? `Hơn ${visibleCount} lượt khuyết danh còn lại` : `${visibleCount} lượt khuyết danh còn lại`
}

/**
 * Formats a duplicate customer profile using only masked phone (`••• 678`) or `"chưa có SĐT"`.
 * Also masks any phone-like digits inside `displayName`.
 */
export function formatDuplicateCustomerLine(customer: Pick<DuplicateCustomer, "displayName" | "maskedPhone">): string {
  const rawName = customer.displayName?.trim()
  const safeName = rawName ? maskPhoneNumbersInText(rawName) : "Khách"
  const phoneLabel = customer.maskedPhone ? maskPhoneNumbersInText(customer.maskedPhone) : "chưa có SĐT"
  return `${safeName} · ${phoneLabel}`
}

/**
 * Validates the Vietnamese local 10-digit phone input before submitting an assignment.
 */
export function validateAnonymousAssignPhone(phone: string): string | null {
  const trimmed = phone.trim()
  if (!trimmed) return "Vui lòng nhập số điện thoại 10 chữ số bắt đầu bằng 0."
  if (!isPlausibleVnPhone(trimmed)) {
    return "Số điện thoại phải gồm 10 chữ số bắt đầu bằng 0."
  }
  return null
}

/**
 * Validates the customer display name when creating a new customer during assignment.
 */
export function validateNewCustomerName(displayName: string): string | null {
  const trimmed = displayName.trim()
  if (!trimmed || trimmed.length > 120) {
    return "Cần nhập tên khách (1-120 ký tự)."
  }
  if (noteHasPhoneNumber(trimmed)) {
    return "Tên khách không được chứa số điện thoại."
  }
  return null
}

/**
 * Maps NA-34 API errors into safe Vietnamese UI messages (never echoing any phone digits).
 */
export function mapCustomerHistoryError(
  error: unknown,
  context: "assign" | "undo" | "merge" | "dismiss",
): MappedHistoryError {
  if (isApiError(error)) {
    if (error.code === "CUSTOMER_NAME_REQUIRED") {
      return {
        message: "Chưa có hồ sơ với SĐT này. Vui lòng nhập tên khách để tạo mới và gán lượt.",
        isConflict: false,
        isForbidden: false,
        requiresName: true,
      }
    }
    if (error.status === 403 || error.code === "PERMISSION_DENIED" || error.code === "CUSTOMER_ORG_WRITE_REQUIRED") {
      return {
        message:
          error.code === "CUSTOMER_ORG_WRITE_REQUIRED"
            ? "Cần quyền quản trị ghi toàn tổ chức để gộp hoặc đánh dấu khác nhau."
            : "Tài khoản hiện tại chỉ có quyền xem, không thể thực hiện thao tác này.",
        isConflict: false,
        isForbidden: true,
        requiresName: false,
      }
    }
    if (error.status === 409) {
      const conflictMessage =
        context === "undo"
          ? "Lượt đã thay đổi sau khi gán nên không thể hoàn tác. Danh sách đã được tải lại."
          : context === "merge" || context === "dismiss"
            ? "Cặp hồ sơ vừa thay đổi hoặc đã được xử lý trước đó. Danh sách đã được tải lại."
            : "Dữ liệu lượt vừa thay đổi. Danh sách đã được tải lại."
      return {
        message: conflictMessage,
        isConflict: true,
        isForbidden: false,
        requiresName: false,
      }
    }
    if (error.status === 404) {
      return {
        message:
          context === "undo"
            ? "Không tìm thấy thao tác gán để hoàn tác. Danh sách đã được tải lại."
            : "Dữ liệu không còn tồn tại trong phạm vi hiện tại. Danh sách đã được tải lại.",
        isConflict: true,
        isForbidden: false,
        requiresName: false,
      }
    }
    if (error.status === 422) {
      if (error.code === "INVALID_PHONE_NUMBER") {
        return {
          message: "Số điện thoại phải gồm 10 chữ số bắt đầu bằng 0.",
          isConflict: false,
          isForbidden: false,
          requiresName: false,
        }
      }
      if (error.code === "PHONE_IN_NOTE_FORBIDDEN") {
        return {
          message: "Tên khách không được chứa số điện thoại.",
          isConflict: false,
          isForbidden: false,
          requiresName: false,
        }
      }
      if (error.code === "IDEMPOTENCY_KEY_REUSED") {
        return {
          message: "Yêu cầu vừa được gửi với dữ liệu khác. Vui lòng thử lại.",
          isConflict: false,
          isForbidden: false,
          requiresName: false,
        }
      }
      return {
        message: maskPhoneNumbersInText(error.message || "Thông tin nhập chưa hợp lệ."),
        isConflict: false,
        isForbidden: false,
        requiresName: false,
      }
    }
    return {
      message: maskPhoneNumbersInText(error.message || "Không thể xử lý yêu cầu. Vui lòng thử lại."),
      isConflict: false,
      isForbidden: false,
      requiresName: false,
    }
  }
  return {
    message: "Không thể kết nối tới máy chủ. Vui lòng thử lại.",
    isConflict: false,
    isForbidden: false,
    requiresName: false,
  }
}

/**
 * Determines whether `AnonymousVisitsCard` should stay on the current page,
 * advance to the next page after all local rows are skipped, or recover to page 1
 * when an out-of-range page becomes empty.
 */
export function resolveAnonymousPageAction(params: {
  page: number
  dataPage: number | undefined
  visitsCount: number
  visibleCount: number
  hasMore: boolean
  isPending: boolean
  isFetching: boolean
}): "stay" | "advance" | "recover" {
  if (params.isPending || params.isFetching || params.dataPage !== params.page) {
    return "stay"
  }
  if (params.page > 1 && params.visitsCount === 0) {
    return "recover"
  }
  if (params.visitsCount > 0 && params.visibleCount === 0 && params.hasMore) {
    return "advance"
  }
  return "stay"
}

/**
 * Computes the target recovery page when `DuplicateCustomersCard` lands on an empty
 * page > 1 (e.g. after concurrent removal on the final page), or `null` when no
 * page adjustment is required.
 */
export function resolveDuplicatePageRecovery(params: {
  page: number
  dataPage: number | undefined
  pairsCount: number
  total: number
  pageSize: number
  isPending: boolean
  isFetching: boolean
}): number | null {
  if (params.isPending || params.isFetching || params.dataPage !== params.page) {
    return null
  }
  if (params.page > 1 && params.pairsCount === 0) {
    if (params.total > 0) {
      return Math.max(1, Math.min(params.page - 1, Math.ceil(params.total / params.pageSize)))
    }
    return 1
  }
  return null
}

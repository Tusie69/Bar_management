import {
  ORIGIN_LABEL,
  SOURCE_LABEL,
  type BookingSourceCode,
  type VisitOrigin,
} from "@/domain/enums"
import type { TableTurnQuery, TableTurnSummary, TableTurnView, TableTurnsParams } from "@/domain/models"
import {
  addDays,
  fmtBusinessDate,
  fmtDayMonth,
  fmtTime,
  fromVenueLocal,
  venueParts,
  type BusinessDate,
} from "@/lib/time"

export type TurnRangePreset = "today" | "week" | "7days" | "date"

export interface BusinessDateRange {
  from: BusinessDate
  to: BusinessDate
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
  "turnId" | "status" | "releasedAt" | "endReason" | "checkedInByUserId" | "checkedInByDisplayName" | "closedByUserId" | "closedByDisplayName"
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
export function hasCheckedInByStaffField(
  summary?: Pick<TableTurnSummary, "byStaff"> | null,
): boolean {
  return Boolean(summary?.byStaff.some((row) => "checkedInByUserId" in row))
}

/**
 * Determines whether a turn is still active (`status === "OPEN"` or missing `releasedAt`).
 */
export function isTurnOpen(
  row: Pick<ExtendedTableTurnView, "status" | "releasedAt">,
): boolean {
  return row.status === "OPEN" || !row.releasedAt
}

/**
 * Formats the staff display name ("Người check-in").
 * Null staff IDs display "Hệ thống".
 */
export function formatStaffName(
  staffUserId: number | null,
  staffDisplayName: string | null,
): string {
  if (staffUserId === null) return "Hệ thống"
  const trimmed = staffDisplayName?.trim()
  return trimmed ? trimmed : `Nhân viên #${staffUserId}`
}

/**
 * Maps turn `status` / `endReason` to its Vietnamese badge label and state flags.
 */
export function formatEndReason(
  endReason: string | null | undefined,
  status?: "OPEN" | "CLOSED",
): EndReasonMeta {
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
    return (
      SOURCE_LABEL[sourceCode as BookingSourceCode] ??
      ORIGIN_LABEL[sourceCode as VisitOrigin] ??
      sourceCode
    )
  }
  return ORIGIN_LABEL[origin as VisitOrigin] ?? origin ?? "—"
}

/**
 * Formats a turn's logical scope label (`groupCode` for GROUP, joined `tableCodes` for TABLE).
 */
export function formatScopeLabel(
  row: Pick<TableTurnView, "scope" | "groupCode" | "tableCodes">,
): string {
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
  return value.replace(/(?:\+?\d[\d\s.-]{6,}\d)/g, (match) => {
    const digits = match.replace(/\D/g, "")
    if (digits.length < 8) return match
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
export function formatRangeCaption(
  preset: TurnRangePreset,
  from: BusinessDate,
  to: BusinessDate,
): string {
  if (from === to) {
    const year = from.slice(0, 4)
    return `${fmtBusinessDate(from, "short")}/${year}`
  }
  const prefix = preset === "week" ? "Tuần này" : preset === "7days" ? "7 ngày qua" : "Khoảng ngày"
  return `${prefix} · ${fmtDayMonth(from)} – ${fmtDayMonth(to)}/${to.slice(0, 4)}`
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
export function buildSummaryQuery(
  from: BusinessDate,
  to: BusinessDate,
  includeUncounted: boolean,
): TableTurnQuery {
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
export function resolveRadioKeyTargetIndex(
  key: string,
  currentIndex: number,
  count: number,
): number | null {
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

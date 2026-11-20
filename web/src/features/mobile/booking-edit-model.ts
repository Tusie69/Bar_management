import {
  type Honorific,
  type SocialPlatform,
  honorificSupported,
  iconKeysSupported,
  socialPlatformSupported,
  validateSocialPlatform,
} from "@/components/booking-pickers"
import { contactNameUpdate, initialContactName } from "@/domain/booking-identity"
import {
  guestCount,
  guestError,
  guestValueFrom,
  isBookingSlot,
  validateBookingTime,
  type GuestValue,
} from "@/domain/booking-rules"
import type { BookingClassification, BookingSourceCode } from "@/domain/enums"
import type { FloorTableState, ReservationView, TableAvailability, TableView } from "@/domain/models"
import { NOTE_PHONE_ERROR } from "@/lib/text"
import { atBusinessTime, fmtTime, venueParts, type BusinessDate } from "@/lib/time"
import type { UpdateReservationInput } from "@/services/contracts"
import { capacityWarningText, selectedTablesCapacity } from "../floor/reception-rules"
import { bookingSelectionIssues } from "./booking-table-selection"
import { noteHasNormalizedPhoneNumber } from "./note-phone-privacy"

export const GUEST_NAME_MAX_LENGTH = 120
export const BOOKING_NOTE_MAX_LENGTH = 500
export const PARTY_SIZE_MIN = 1
export const PARTY_SIZE_MAX = 500

export type EditableFieldKey =
  | "name"
  | "honorific"
  | "classification"
  | "partySize"
  | "businessDate"
  | "time"
  | "tables"
  | "source"
  | "icons"
  | "note"

export interface BookingEditDraft {
  name: string
  honorific: Honorific | null
  classification: BookingClassification
  guest: GuestValue
  businessDate: BusinessDate
  time: string
  tableIds: number[]
  source: BookingSourceCode
  platform: SocialPlatform | ""
  isBirthday: boolean
  iconKeys: string[]
  note: string
}

export interface BookingEditDiff {
  changed: {
    name: boolean
    honorific: boolean
    classification: boolean
    partySize: boolean
    businessDate: boolean
    time: boolean
    tables: boolean
    source: boolean
    platform: boolean
    icons: boolean
    note: boolean
  }
  fieldsDirty: boolean
  tablesDirty: boolean
  isDirty: boolean
}

export interface BookingEditErrors {
  name: string | null
  partySize: string | null
  time: string | null
  tables: string | null
  platform: string | null
  note: string | null
}

function sortedUniqueNumbers(ids: readonly number[]): number[] {
  return [...new Set(ids)].sort((a, b) => a - b)
}

function sortedUniqueStrings(items: readonly string[]): string[] {
  return [...new Set(items)].sort()
}

function sameSortedArray<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((item, idx) => item === b[idx])
}

export function initialBookingEditDraft(r: ReservationView): BookingEditDraft {
  const parts = venueParts(r.expectedAt)
  const time = `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`
  return {
    name: initialContactName(r.hasGuestName, r.displayName),
    honorific: r.honorific ?? null,
    classification: r.classification,
    guest: guestValueFrom(r.partySize),
    businessDate: r.businessDate,
    time,
    tableIds: sortedUniqueNumbers(r.tableIds),
    source: r.sourceCode,
    platform: (r.socialPlatform as SocialPlatform | null | undefined) ?? "",
    isBirthday: r.isBirthday,
    iconKeys: sortedUniqueStrings(r.iconKeys ?? []),
    note: r.note ?? "",
  }
}

export function diffBookingEditDraft(r: ReservationView, draft: BookingEditDraft): BookingEditDiff {
  const saved = initialBookingEditDraft(r)
  const count = guestCount(draft.guest)
  const partySizeChanged = count === null ? true : count !== r.partySize

  const draftPlatform = draft.source === "SOCIAL" ? draft.platform : ""
  const savedPlatform = saved.source === "SOCIAL" ? saved.platform : ""

  const changed = {
    name: draft.name.trim() !== saved.name.trim(),
    honorific: draft.honorific !== saved.honorific,
    classification: draft.classification !== saved.classification,
    partySize: partySizeChanged,
    businessDate: draft.businessDate !== saved.businessDate,
    time: draft.time !== saved.time,
    tables: !sameSortedArray(sortedUniqueNumbers(draft.tableIds), saved.tableIds),
    source: draft.source !== saved.source,
    platform: draftPlatform !== savedPlatform,
    icons:
      draft.isBirthday !== saved.isBirthday || !sameSortedArray(sortedUniqueStrings(draft.iconKeys), saved.iconKeys),
    note: draft.note.trim() !== saved.note.trim(),
  }

  const fieldsDirty =
    changed.name ||
    changed.honorific ||
    changed.classification ||
    changed.partySize ||
    changed.businessDate ||
    changed.time ||
    changed.source ||
    changed.platform ||
    changed.icons ||
    changed.note

  return {
    changed,
    fieldsDirty,
    tablesDirty: changed.tables,
    isDirty: fieldsDirty || changed.tables,
  }
}

export interface BookingEditSessionState {
  source: ReservationView
  draft: BookingEditDraft
  /** False after a PUT succeeds until a fresh server read confirms the new source & version. */
  versionConfirmed?: boolean
}

/**
 * Keeps a booking editor mounted once its initial record has loaded for `(id, bd)`,
 * even if a subsequent date-scoped list refresh no longer contains the booking.
 */
export function pinLoadedBooking(
  pinned: { key: string; record: ReservationView } | null,
  key: string,
  current: ReservationView | undefined,
): { key: string; record: ReservationView } | null {
  if (pinned && pinned.key === key) return pinned
  return current ? { key, record: current } : null
}

/**
 * Pins the edit session's source record and version while local edits exist,
 * while waiting for a confirmed post-save read, or when the booking disappears
 * from the refreshed list; replaces both together when a clean confirmed draft
 * receives a refreshed booking.
 */
export function syncBookingEditSession(
  session: BookingEditSessionState,
  refreshed: ReservationView | undefined,
): BookingEditSessionState {
  if (session.versionConfirmed === false) {
    return session
  }
  if (!refreshed) {
    return session
  }
  if (diffBookingEditDraft(session.source, session.draft).isDirty) {
    return session
  }
  if (refreshed === session.source) {
    return session
  }
  if (
    refreshed.version === session.source.version &&
    sameSortedArray(sortedUniqueNumbers(refreshed.tableIds), sortedUniqueNumbers(session.source.tableIds))
  ) {
    return session
  }
  return {
    source: refreshed,
    draft: initialBookingEditDraft(refreshed),
  }
}

export type BookingEditBackAction = "block_pending" | "confirm_discard" | "leave"

/**
 * Routes all close/back entry points (top-left Back, Escape, browser Back)
 * through a single pending and dirty-state guard.
 */
export function resolveBookingEditBackAction(state: { pending: boolean; isDirty: boolean }): BookingEditBackAction {
  if (state.pending) return "block_pending"
  if (state.isDirty) return "confirm_discard"
  return "leave"
}

const OWN_RESERVATION_LIVE_STATES = new Set<FloorTableState["state"]>([
  "reserved",
  "upcoming",
  "late",
  "late_confirmed",
  "noshow",
  "hold",
  "hold_overdue",
])

/**
 * Adjusts availability and live state maps so tables already held by `r` on the
 * same business date remain selectable unless another reservation/visit owns them.
 */
export function tableContextForEditedBooking(
  r: ReservationView,
  targetBusinessDate: BusinessDate,
  availMap: ReadonlyMap<number, TableAvailability>,
  states: ReadonlyMap<number, FloorTableState>,
): { availMap: Map<number, TableAvailability>; states: Map<number, FloorTableState> } {
  const nextAvail = new Map(availMap)
  const nextStates = new Map(states)
  if (targetBusinessDate !== r.businessDate) {
    return { availMap: nextAvail, states: nextStates }
  }
  for (const id of r.tableIds) {
    const entry = nextAvail.get(id)
    const otherConflicts = (entry?.bookingConflicts ?? []).filter((c) => c.reservationId !== r.id)
    if (entry && entry.status === "reserved" && otherConflicts.length === 0) {
      nextAvail.set(id, {
        ...entry,
        status: "available",
        reason: "",
        bookingConflicts: [],
      })
    }
    const st = nextStates.get(id)
    const ownedBySameBooking = !st?.claim || st.claim.reservationId === r.id
    if (st && ownedBySameBooking && OWN_RESERVATION_LIVE_STATES.has(st.state)) {
      nextStates.set(id, {
        ...st,
        state: "free",
        claim: null,
      })
    }
  }
  return { availMap: nextAvail, states: nextStates }
}

export function validateBookingEditDraft(
  r: ReservationView,
  draft: BookingEditDraft,
  diff: BookingEditDiff,
  opts: {
    now: Date
    quickTimes: readonly string[]
    byId: ReadonlyMap<number, TableView>
    states: ReadonlyMap<number, FloorTableState>
    availMap: ReadonlyMap<number, TableAvailability>
    bookableZoneIds: ReadonlySet<number>
    availReady: boolean
    isSameBusinessDate: boolean
  },
): {
  errors: BookingEditErrors
  hasErrors: boolean
  canSave: boolean
  legacyTime: string | null
  capacityWarning: string | null
} {
  const trimmedName = draft.name.trim()
  let nameError: string | null = null
  if (trimmedName.length > GUEST_NAME_MAX_LENGTH) {
    nameError = `Tên khách không được vượt quá ${GUEST_NAME_MAX_LENGTH} ký tự.`
  } else if (!trimmedName && !r.phoneLast3) {
    nameError = "Cần ít nhất tên khách hoặc số điện thoại."
  }

  const count = guestCount(draft.guest)
  let partySizeError: string | null = guestError(draft.guest)
  if (!partySizeError && count === null) {
    partySizeError = "Nhập số khách."
  } else if (!partySizeError && count !== null && (count < PARTY_SIZE_MIN || count > PARTY_SIZE_MAX)) {
    partySizeError = `Số khách phải từ ${PARTY_SIZE_MIN} đến ${PARTY_SIZE_MAX}.`
  }

  const originalSchedule = draft.businessDate === r.businessDate && draft.time === fmtTime(r.expectedAt)
  const timeError = originalSchedule
    ? null
    : validateBookingTime(draft.businessDate, draft.time, opts.now, undefined, opts.quickTimes)
  const legacyTime = originalSchedule && !isBookingSlot(draft.time) ? draft.time : null

  const platformError = validateSocialPlatform(draft.source, draft.platform, socialPlatformSupported)

  let noteError: string | null = null
  if (noteHasNormalizedPhoneNumber(draft.note)) {
    noteError = NOTE_PHONE_ERROR
  } else if (draft.note.trim().length > BOOKING_NOTE_MAX_LENGTH) {
    noteError = `Ghi chú không được vượt quá ${BOOKING_NOTE_MAX_LENGTH} ký tự.`
  }

  let tablesError: string | null = null
  if (diff.tablesDirty) {
    if (r.tableIds.length > 0 && draft.tableIds.length === 0) {
      tablesError = "Booking đã xếp bàn cần giữ ít nhất 1 bàn."
    } else if (draft.tableIds.length > 0) {
      if (!opts.availReady) {
        tablesError = "Chưa xác minh được bàn cho lịch đã chọn."
      } else {
        const adjusted = tableContextForEditedBooking(r, draft.businessDate, opts.availMap, opts.states)
        const issues = bookingSelectionIssues(
          draft.tableIds,
          opts.byId,
          adjusted.states,
          adjusted.availMap,
          opts.bookableZoneIds,
          opts.isSameBusinessDate,
          count ?? r.partySize,
        )
        tablesError = issues[0] ?? null
      }
    }
  }

  const errors: BookingEditErrors = {
    name: nameError,
    partySize: partySizeError,
    time: timeError,
    tables: tablesError,
    platform: platformError,
    note: noteError,
  }

  const hasErrors = Object.values(errors).some(Boolean)
  const capacityWarning =
    draft.tableIds.length > 0 && count !== null
      ? capacityWarningText(draft.tableIds.length, selectedTablesCapacity(draft.tableIds, opts.byId), count)
      : null

  return {
    errors,
    hasErrors,
    canSave: r.status === "BOOKED" && diff.isDirty && !hasErrors,
    legacyTime,
    capacityWarning,
  }
}

export function buildUpdateReservationInput(r: ReservationView, draft: BookingEditDraft): UpdateReservationInput {
  const partySize = guestCount(draft.guest) ?? r.partySize
  return {
    id: r.id,
    version: r.version,
    ...contactNameUpdate(r.hasGuestName, draft.name.trim()),
    partySize,
    expectedAt: atBusinessTime(draft.businessDate, draft.time),
    sourceCode: draft.source,
    socialPlatform: socialPlatformSupported && draft.source === "SOCIAL" ? draft.platform || null : null,
    note: draft.note.trim(),
    classification: draft.classification,
    guestType: draft.classification === "RETURNING" ? "REGULAR" : draft.classification === "NEW" ? "NEW" : null,
    isBirthday: draft.isBirthday,
    iconKeys: iconKeysSupported ? sortedUniqueStrings(draft.iconKeys) : undefined,
    honorific: honorificSupported ? draft.honorific || null : undefined,
  }
}

/**
 * Updates the displayed booking snapshot and clean baseline immediately after
 * `updateReservation` succeeds while keeping `source.version` untouched until
 * a fresh server booking query confirms the new version.
 */
export function applySavedBookingEdit(source: ReservationView, draft: BookingEditDraft): ReservationView {
  const partySize = guestCount(draft.guest) ?? source.partySize
  const trimmedName = draft.name.trim()
  const hasGuestName = Boolean(trimmedName)
  const displayName = hasGuestName ? trimmedName : source.hasGuestName ? "Khách" : source.displayName
  const socialPlatform = socialPlatformSupported && draft.source === "SOCIAL" ? draft.platform || null : null
  const iconKeys = iconKeysSupported ? sortedUniqueStrings(draft.iconKeys) : source.iconKeys
  const honorific = honorificSupported ? draft.honorific || null : source.honorific
  const guestType = draft.classification === "RETURNING" ? "REGULAR" : draft.classification === "NEW" ? "NEW" : null

  return {
    ...source,
    displayName,
    hasGuestName,
    partySize,
    expectedAt: atBusinessTime(draft.businessDate, draft.time),
    businessDate: draft.businessDate,
    classification: draft.classification,
    guestType,
    isBirthday: draft.isBirthday,
    sourceCode: draft.source,
    socialPlatform,
    iconKeys,
    honorific,
    note: draft.note.trim() || null,
  }
}

export interface TablePickerLoadDeps {
  loadBooking: (id: number, bd: BusinessDate) => Promise<ReservationView | undefined>
  ensureWaitlist: (bd: BusinessDate) => Promise<void>
  checkPolicy: (r: ReservationView) => { canReassign: boolean; reason?: string }
  onSessionSync: (r: ReservationView) => void
  onMissingOrClosed: () => void
  openPicker: (r: ReservationView) => void
  isMounted?: () => boolean
}

export type TablePickerLoadStage = "booking" | "waitlist" | "policy"

export type TablePickerLoadResult =
  | { status: "opened" | "closed" | "unmounted" }
  | { status: "error"; savedBeforePick: boolean; stage: TablePickerLoadStage; message: string }

/**
 * Loads target-date booking/waitlist state and validates waitlist policy before
 * opening the table picker, returning a structured error instead of rejecting.
 */
export async function prepareTablePickerTarget(
  target: ReservationView,
  fromSave: boolean,
  deps: TablePickerLoadDeps,
): Promise<TablePickerLoadResult> {
  const stillMounted = () => deps.isMounted?.() ?? true
  let stage: TablePickerLoadStage = "booking"
  try {
    const latest = await deps.loadBooking(target.id, target.businessDate)
    if (!stillMounted()) return { status: "unmounted" }
    if (!latest || latest.status !== "BOOKED") {
      deps.onMissingOrClosed()
      return { status: "closed" }
    }
    deps.onSessionSync(latest)

    stage = "waitlist"
    await deps.ensureWaitlist(latest.businessDate)
    if (!stillMounted()) return { status: "unmounted" }

    const policy = deps.checkPolicy(latest)
    if (!policy.canReassign) {
      return {
        status: "error",
        savedBeforePick: fromSave,
        stage: "policy",
        message: fromSave
          ? `Đã lưu thay đổi, nhưng chưa thể đổi bàn: ${policy.reason ?? "Không hỗ trợ đổi bàn."}`
          : (policy.reason ?? "Chưa hỗ trợ đổi bàn cho đơn giữ chỗ."),
      }
    }

    deps.openPicker(latest)
    return { status: "opened" }
  } catch {
    if (!stillMounted()) return { status: "unmounted" }
    return {
      status: "error",
      savedBeforePick: fromSave,
      stage,
      message:
        fromSave && stage === "booking"
          ? "Đã lưu thay đổi, nhưng chưa đồng bộ được bản ghi booking mới. Vui lòng thử lại."
          : fromSave
            ? "Đã lưu thay đổi, nhưng không tải được dữ liệu để đổi bàn. Vui lòng thử lại Đổi bàn."
            : "Không tải được dữ liệu để đổi bàn. Vui lòng thử lại.",
    }
  }
}

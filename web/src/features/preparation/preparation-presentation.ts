/**
 * L2 — ngôn ngữ của từng quầy và các luật đọc một phiếu.
 *
 * Bar và Bếp cùng dùng một state machine (`SUBMITTED → ACCEPTED → PREPARING →
 * READY → COLLECTED`) nhưng không nói cùng một thứ tiếng: Bartender "pha" và
 * "bàn giao món", Bếp "làm" và "nhận món". Ở đây là chỗ duy nhất biết khác biệt
 * đó, nên không component nào phải rải `station === "BAR"`.
 *
 * Mọi thứ trong file là hàm thuần hoặc hằng: status code gửi lên API không phụ
 * thuộc quầy, chỉ nhãn mới phụ thuộc.
 */
import { fmtTime } from "@/lib/time"
import { preparationWaitSeconds, type PreparationTicketStatus } from "./preparation-layout"

export type PreparationStationCode = "BAR" | "KITCHEN"

export type PreparationQueueStatus = Exclude<PreparationTicketStatus, "COLLECTED">

export interface PreparationColumn {
  status: PreparationQueueStatus
  label: string
  tone: string
}

export interface PreparationAction {
  /** Status gửi lên API — giống nhau ở cả hai quầy. */
  status: PreparationTicketStatus
  label: string
}

const COLUMN_TONE: Record<PreparationQueueStatus, string> = {
  SUBMITTED: "border-amber-400/40 bg-amber-400/5",
  ACCEPTED: "border-blue-400/40 bg-blue-400/5",
  PREPARING: "border-violet-400/40 bg-violet-400/5",
  READY: "border-emerald-400/40 bg-emerald-400/5",
}

const COLUMN_LABEL: Record<PreparationStationCode, Record<PreparationQueueStatus, string>> = {
  BAR: {
    SUBMITTED: "Mới nhận",
    ACCEPTED: "Đã tiếp nhận",
    PREPARING: "Đang pha",
    READY: "Hoàn thành · chờ bàn giao",
  },
  KITCHEN: {
    SUBMITTED: "Mới nhận",
    ACCEPTED: "Đã tiếp nhận",
    PREPARING: "Đang làm",
    READY: "Hoàn thành",
  },
}

const ACTION_LABEL: Record<PreparationStationCode, Partial<Record<PreparationTicketStatus, string>>> = {
  BAR: {
    SUBMITTED: "Tiếp nhận",
    ACCEPTED: "Bắt đầu pha",
    PREPARING: "Báo hoàn thành",
    READY: "Đã bàn giao món",
  },
  KITCHEN: {
    SUBMITTED: "Tiếp nhận",
    ACCEPTED: "Bắt đầu làm",
    PREPARING: "Báo hoàn thành",
    READY: "Đã nhận món",
  },
}

/** Status kế tiếp của state machine — một bộ duy nhất cho mọi quầy. */
export const PREPARATION_NEXT_STATUS: Partial<Record<PreparationTicketStatus, PreparationTicketStatus>> = {
  SUBMITTED: "ACCEPTED",
  ACCEPTED: "PREPARING",
  PREPARING: "READY",
  READY: "COLLECTED",
}

export const PREPARATION_QUEUE_STATUSES: readonly PreparationQueueStatus[] = [
  "SUBMITTED",
  "ACCEPTED",
  "PREPARING",
  "READY",
]

export function preparationColumns(station: PreparationStationCode): PreparationColumn[] {
  return PREPARATION_QUEUE_STATUSES.map((status) => ({
    status,
    label: COLUMN_LABEL[station][status],
    tone: COLUMN_TONE[status],
  }))
}

/**
 * Hành động kế tiếp của một phiếu, hoặc `null` khi phiếu đã rời hàng đợi.
 * `status` luôn là mã của state machine; chỉ `label` đổi theo quầy.
 */
export function preparationNextAction(
  station: PreparationStationCode,
  status: PreparationTicketStatus,
): PreparationAction | null {
  const next = PREPARATION_NEXT_STATUS[status]
  const label = ACTION_LABEL[station][status]
  return next && label ? { status: next, label } : null
}

export function preparationStationLabel(station: PreparationStationCode): string {
  return station === "BAR" ? "Bar" : "Bếp"
}

/* ---------------- cảnh báo thời gian chờ ---------------- */

/** Từ 8 phút, phiếu bắt đầu trễ so với nhịp phục vụ. */
export const PREPARATION_WAIT_WARNING_SECONDS = 8 * 60
/** Từ 12 phút, khách đã chờ quá lâu và cần người can thiệp. */
export const PREPARATION_WAIT_CRITICAL_SECONDS = 12 * 60

export type PreparationWaitTone = "normal" | "warning" | "critical"

/**
 * Ngưỡng cảnh báo chờ. Critical ưu tiên hơn warning, và thời gian âm được clamp
 * về 0 để một đồng hồ máy lệch giờ không bao giờ hiện phiếu "quá lâu" ngược.
 */
export function preparationWaitTone(seconds: number): PreparationWaitTone {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  if (safe >= PREPARATION_WAIT_CRITICAL_SECONDS) return "critical"
  if (safe >= PREPARATION_WAIT_WARNING_SECONDS) return "warning"
  return "normal"
}

/** Nhãn ngắn cạnh đồng hồ: "3 phút", "< 1 phút". */
export function preparationWaitLabel(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  const minutes = Math.floor(safe / 60)
  return minutes > 0 ? `${minutes} phút` : "< 1 phút"
}

/**
 * Tên đọc được cho screen reader. Màu không bao giờ là tín hiệu duy nhất, nên
 * mức độ trễ phải nằm trong chữ.
 */
export function preparationWaitAccessibleLabel(seconds: number): string {
  const tone = preparationWaitTone(seconds)
  const base = `Chờ ${preparationWaitLabel(seconds)}`
  if (tone === "critical") return `${base}, quá lâu`
  if (tone === "warning") return `${base}, cần chú ý`
  return base
}

/** Tone của nhãn chờ và viền card. Không bao giờ chỉ dựa vào màu. */
export const PREPARATION_WAIT_TONE_CLASS: Record<PreparationWaitTone, { chip: string; card: string }> = {
  normal: { chip: "bg-surface-2 text-foreground", card: "border-border" },
  warning: {
    chip: "bg-amber-400/20 font-bold text-[var(--st-upcoming-ink)]",
    card: "border-amber-500/60",
  },
  critical: {
    chip: "bg-destructive/15 font-bold text-[var(--st-late-ink)]",
    card: "border-destructive/60 ring-1 ring-destructive/30",
  },
}

/** Lớp bề mặt callout theo mục đích sử dụng (cảnh báo bộ lọc/thiếu số lượng vs ghi chú món), giữ nguyên sắc vàng. */
export const PREPARATION_CALLOUT_CLASS = {
  warning: "border border-amber-400/40 bg-amber-400/10",
  note: "bg-amber-400/10",
} as const

/* ---------------- metadata đầu phiếu ---------------- */

/** Giờ gọi món, hoặc "—" khi timestamp không đọc được — không bao giờ throw. */
export function preparationSubmittedAtLabel(submittedAt: string | null | undefined): string {
  if (!submittedAt) return "—"
  const ms = Date.parse(submittedAt)
  if (!Number.isFinite(ms)) return "—"
  return fmtTime(new Date(ms))
}

/** Danh sách bàn/cụm bàn, hoặc câu nói rõ phiếu đang chờ gán bàn. */
export function preparationTableLabel(tableCodes: ReadonlyArray<string> | null | undefined): string {
  const codes = (tableCodes ?? []).filter((code) => code.trim().length > 0)
  return codes.length ? codes.join(" · ") : "Đang đổi bàn"
}

/**
 * Dòng metadata: "Đơn 2 · gọi lúc 21:44 · Minh".
 *
 * Người gọi chỉ là display name mà contract trả về — không nối thêm vai, vì
 * contract không nói người đó là Phục vụ hay Bartender. Phần nào thiếu thì bỏ
 * hẳn thay vì để lại dấu phân cách trống.
 */
export function preparationMetaLine(ticket: {
  visitSequence: number
  submittedAt: string | null | undefined
  orderedByDisplayName?: string | null
}): string {
  const parts = [`Đơn ${ticket.visitSequence}`, `gọi lúc ${preparationSubmittedAtLabel(ticket.submittedAt)}`]
  const orderedBy = ticket.orderedByDisplayName?.trim()
  if (orderedBy) parts.push(orderedBy)
  return parts.join(" · ")
}

/* ---------------- cờ vận hành ---------------- */

export interface PreparationGuestFlagBadge {
  key: "vip" | "designated" | "birthday"
  glyph: string
  label: string
}

/**
 * Cờ vận hành của khách, theo đúng thứ tự ưu tiên icon của sơ đồ bàn
 * (⭐ VIP > 📌 Chỉ định > 🎂 Sinh nhật). Chỉ cờ `true` mới có badge, nên khi cả
 * ba đều false thì card không có chỗ trống thừa.
 *
 * Contract chỉ có ba boolean này: không suy ra khách cũ/mới, và VIP không đổi
 * thứ tự phiếu trong giai đoạn này.
 */
export function preparationGuestFlagBadges(
  flags: { vip?: boolean; birthday?: boolean; designated?: boolean } | null | undefined,
): PreparationGuestFlagBadge[] {
  const badges: PreparationGuestFlagBadge[] = []
  if (flags?.vip) badges.push({ key: "vip", glyph: "⭐", label: "VIP" })
  if (flags?.designated) badges.push({ key: "designated", glyph: "📌", label: "Chỉ định" })
  if (flags?.birthday) badges.push({ key: "birthday", glyph: "🎂", label: "Sinh nhật" })
  return badges
}

/* ---------------- hủy đang chờ duyệt ---------------- */

/**
 * Nhãn cho yêu cầu hủy chưa được duyệt trên một dòng, hoặc `null`.
 *
 * Nó nói đúng một việc: có bao nhiêu phần đang chờ duyệt. Contract không trả lý
 * do nên không bịa ra lý do, và yêu cầu này nằm trên một dòng chứ không phải cả
 * phiếu — quầy vẫn tiếp tục pha phần còn lại và vẫn chuyển được trạng thái.
 */
export function preparationPendingCancellationLabel(line: {
  pendingCancellation?: { quantity: number } | null
}): string | null {
  const pending = line.pendingCancellation
  if (!pending) return null
  const quantity = Math.max(0, Math.floor(Number.isFinite(pending.quantity) ? pending.quantity : 0))
  return `Đang chờ duyệt hủy ${quantity} phần`
}

/* ---------------- loading / empty ---------------- */

export type PreparationQueueViewState = "loading" | "empty" | "tickets"

/**
 * Lần tải đầu hiện skeleton thay vì bốn cột trống — bốn cột trống đọc như "không
 * có đơn nào", và đó là câu trả lời sai khi màn hình chưa biết gì cả.
 *
 * Refetch nền không được xóa snapshot cũ: còn ticket thì vẫn vẽ ticket, nên màn
 * hình không nháy mỗi lần React Query làm mới.
 */
export function preparationQueueViewState(input: {
  hasSnapshot: boolean
  ticketCount: number
}): PreparationQueueViewState {
  if (!input.hasSnapshot) return "loading"
  return input.ticketCount > 0 ? "tickets" : "empty"
}

export const PREPARATION_EMPTY_QUEUE_TEXT = "Chưa có phiếu đang chờ."

/* ---------------- bộ lọc nhanh ---------------- */

export type PreparationQueueFilter = "all" | "vip" | "designated"

export const PREPARATION_QUEUE_FILTERS: readonly PreparationQueueFilter[] = ["all", "vip", "designated"]

export const PREPARATION_FILTER_EMPTY_TEXT = "Không có phiếu nào khớp bộ lọc."

export function preparationQueueFilterLabel(filter: PreparationQueueFilter): string {
  if (filter === "vip") return "VIP"
  if (filter === "designated") return "Chỉ định"
  return "Tất cả"
}

interface PreparationFilterableTicket {
  submittedAt: string
  waitSeconds: number
  guestFlags: { vip: boolean; designated: boolean }
}

export interface PreparationQueueFilterProjection<T> {
  visibleTickets: T[]
  hiddenCount: number
  hiddenCriticalCount: number
}

/**
 * Projection tại chỗ của snapshot: giữ nguyên thứ tự server và không ghi ngược
 * vào React Query. Cùng `now` và helper của card được dùng cho hidden-critical,
 * nên một tick 30 giây cập nhật cả card lẫn dải nhắc mà không cần timer thứ hai.
 */
export function preparationQueueFilterProjection<T extends PreparationFilterableTicket>(
  tickets: readonly T[],
  filter: PreparationQueueFilter,
  now: Date,
): PreparationQueueFilterProjection<T> {
  if (filter === "all") return { visibleTickets: [...tickets], hiddenCount: 0, hiddenCriticalCount: 0 }

  const visibleTickets: T[] = []
  let hiddenCriticalCount = 0
  for (const ticket of tickets) {
    const visible = filter === "vip" ? ticket.guestFlags.vip : ticket.guestFlags.designated
    if (visible) {
      visibleTickets.push(ticket)
    } else if (
      preparationWaitTone(preparationWaitSeconds(ticket.submittedAt, ticket.waitSeconds, now)) === "critical"
    ) {
      hiddenCriticalCount += 1
    }
  }
  return {
    visibleTickets,
    hiddenCount: tickets.length - visibleTickets.length,
    hiddenCriticalCount,
  }
}

export function preparationColumnCount(
  visible: number,
  total: number,
  filter: PreparationQueueFilter,
): { text: string; accessibleLabel: string } {
  if (filter === "all") return { text: String(total), accessibleLabel: `${total} phiếu` }
  return {
    text: `${visible}/${total}`,
    accessibleLabel: `${visible} phiếu hiển thị trên tổng ${total} phiếu`,
  }
}

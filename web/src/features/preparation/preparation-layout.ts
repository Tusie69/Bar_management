export type PreparationTicketStatus = "SUBMITTED" | "ACCEPTED" | "PREPARING" | "READY" | "COLLECTED"

export const PREPARATION_COLUMNS: Array<{ status: Exclude<PreparationTicketStatus, "COLLECTED">; label: string; tone: string }> = [
  { status: "SUBMITTED", label: "Mới nhận", tone: "border-amber-400/40 bg-amber-400/5" },
  { status: "ACCEPTED", label: "Đã tiếp nhận", tone: "border-blue-400/40 bg-blue-400/5" },
  { status: "PREPARING", label: "Đang làm", tone: "border-violet-400/40 bg-violet-400/5" },
  { status: "READY", label: "Hoàn thành", tone: "border-emerald-400/40 bg-emerald-400/5" },
]

/** Một cột trên mobile, hai trên tablet dọc, bốn trên tablet ngang/desktop. */
export const PREPARATION_QUEUE_LAYOUT_CLASS = "grid gap-3 md:grid-cols-2 xl:grid-cols-4"
export const PREPARATION_ACTION_CLASS = "min-h-11 flex-1"

export const PREPARATION_NEXT_ACTION: Partial<Record<PreparationTicketStatus, { status: PreparationTicketStatus; label: string }>> = {
  SUBMITTED: { status: "ACCEPTED", label: "Tiếp nhận" },
  ACCEPTED: { status: "PREPARING", label: "Bắt đầu làm" },
  PREPARING: { status: "READY", label: "Báo hoàn thành" },
  READY: { status: "COLLECTED", label: "Đã nhận món" },
}

export function canShowPrintRetry(hasPermission: boolean, printingEnabled: boolean): boolean {
  return hasPermission && printingEnabled
}

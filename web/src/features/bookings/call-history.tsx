/**
 * Calls already placed on one guest.
 *
 * booking_call_logs was write-only: nothing in the app could show that a
 * colleague had already rung this guest twice, or that a call was left without
 * an outcome. Without it the receptionist either rings a second time for
 * nothing or assumes someone else did and rings not at all.
 *
 * Folded by default and fetched on first open, so tapping a table costs no
 * request. The rows carry no phone number, so anyone allowed to call may read
 * them.
 */
import { useQuery } from "@tanstack/react-query"
import { ChevronDown, History } from "lucide-react"
import { useState, type ReactElement } from "react"
import { callTargetKey } from "@/domain/call-target"
import type { BookingCallHistoryEntry, CallTarget } from "@/domain/models"
import { fmtTime } from "@/lib/time"
import { cn } from "@/lib/utils"
import { api } from "@/services"
import { useCan } from "@/state/session"

const OUTCOME_LABEL: Record<NonNullable<BookingCallHistoryEntry["outcome"]>, string> = {
  CONTACTED: "Đã liên hệ",
  NO_ANSWER: "Không nghe máy",
  LATE_CONFIRMED: "Khách báo tới muộn",
}

export function CallHistory({ target, className }: { target: CallTarget; className?: string }): ReactElement | null {
  const allowed = useCan("booking.phone.call")
  const [open, setOpen] = useState(false)
  const calls = useQuery({
    queryKey: ["calls", callTargetKey(target)],
    queryFn: () => api.listCalls(target),
    enabled: allowed && open,
    staleTime: 10_000,
  })

  if (!allowed) return null
  const rows = calls.data ?? []

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 self-start text-xs font-medium text-tx-2"
      >
        <History className="size-3.5" aria-hidden />
        Lịch sử gọi
        {open && rows.length ? ` (${rows.length})` : ""}
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open ? (
        <div className="rounded-lg bg-surface-2 px-3 py-2 text-xs" aria-live="polite">
          {calls.isPending ? (
            <span className="text-tx-2">Đang tải...</span>
          ) : calls.isError ? (
            <span className="text-st-noshow-ink">Không tải được lịch sử gọi.</span>
          ) : rows.length === 0 ? (
            <span className="text-tx-2">Chưa gọi lần nào.</span>
          ) : (
            <ul className="flex flex-col gap-1">
              {rows.map((c) => (
                <li key={c.callId} className="flex flex-wrap items-baseline gap-x-1.5">
                  <span className="tnum font-medium text-tx-strong">{fmtTime(c.initiatedAt)}</span>
                  <span className="text-tx-2">{c.initiatedBy}</span>
                  <span className="text-subtle">·</span>
                  {c.outcome ? (
                    <span className="text-tx-strong">{OUTCOME_LABEL[c.outcome]}</span>
                  ) : (
                    // An outcome nobody recorded is worth seeing: it usually
                    // means the call was cut short, not that nothing happened.
                    <span className="text-st-late-ink">Chưa ghi kết quả</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}

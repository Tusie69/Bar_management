import { Clock3, Printer } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  PREPARATION_ACTION_CLASS,
  preparationLineDisplay,
  preparationWaitSeconds,
  type PreparationTicketStatus,
} from "./preparation-layout"
import {
  PREPARATION_WAIT_TONE_CLASS,
  preparationGuestFlagBadges,
  preparationMetaLine,
  preparationNextAction,
  preparationPendingCancellationLabel,
  preparationTableLabel,
  preparationWaitAccessibleLabel,
  preparationWaitLabel,
  preparationWaitTone,
  type PreparationStationCode,
} from "./preparation-presentation"
import type { PreparationTicket } from "./preparation-queue-data"

/**
 * Một phiếu trên hàng đợi quầy.
 *
 * Mọi luật đọc phiếu — ngôn ngữ theo quầy, ngưỡng chờ, nhãn hủy — nằm trong
 * `preparation-presentation.ts` và `preparation-layout.ts`; component này chỉ
 * đặt chúng vào DOM. Nhờ vậy "phiếu này trễ chưa" assert được mà không cần JSX.
 *
 * Phiếu không mang tên khách, số điện thoại hay ghi chú booking: contract của
 * quầy không trả về và quầy không cần biết.
 */
export function PreparationTicketCard({
  ticket,
  station,
  now,
  canTransition,
  canRetry,
  onTransition,
  onRetry,
  pending,
}: {
  ticket: PreparationTicket
  station: PreparationStationCode
  now: Date
  canTransition: boolean
  canRetry: boolean
  onTransition: (ticket: PreparationTicket, status: PreparationTicketStatus) => void
  onRetry: (ticket: PreparationTicket) => void
  pending: boolean
}) {
  const action = preparationNextAction(station, ticket.status)
  const waitSeconds = preparationWaitSeconds(ticket.submittedAt, ticket.waitSeconds, now)
  const waitTone = preparationWaitTone(waitSeconds)
  const waitToneClass = PREPARATION_WAIT_TONE_CLASS[waitTone]
  const flags = preparationGuestFlagBadges(ticket.guestFlags)
  return (
    <article
      className={cn("grid min-w-0 gap-3 rounded-xl border bg-surface-1 p-3 shadow-xs", waitToneClass.card)}
      data-ticket-id={ticket.ticketId}
      data-visit-id={ticket.visitId}
      data-wait-tone={waitTone}
    >
      <header className="grid min-w-0 gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <p className="min-w-0 flex-1 text-base font-bold break-words text-foreground">
            {preparationTableLabel(ticket.tableCodes)}
          </p>
          <span
            className={cn(
              "flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-medium",
              waitToneClass.chip,
            )}
            data-wait-tone={waitTone}
          >
            <Clock3 className="size-3.5" aria-hidden="true" />
            <span aria-hidden="true">{preparationWaitLabel(waitSeconds)}</span>
            <span className="sr-only">{preparationWaitAccessibleLabel(waitSeconds)}</span>
          </span>
        </div>
        {flags.length ? (
          <ul className="flex flex-wrap gap-1" aria-label="Cờ vận hành">
            {flags.map((flag) => (
              <li key={flag.key}>
                <Badge variant="outline" data-flag={flag.key}>
                  <span aria-hidden="true">{flag.glyph}</span>
                  {flag.label}
                </Badge>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="text-xs break-words text-muted-foreground">{preparationMetaLine(ticket)}</p>
      </header>
      <ul className="grid min-w-0 gap-2" aria-label="Món trên phiếu">
        {ticket.lines.map((line) => {
          const display = preparationLineDisplay(line)
          const pendingLabel = preparationPendingCancellationLabel(line)
          return (
            <li
              key={line.lineNo}
              className={cn(
                "min-w-0 border-t border-border-subtle pt-2 first:border-0 first:pt-0",
                display.fullyCancelled && "opacity-60",
              )}
              data-line-no={line.lineNo}
              data-cancelled={display.cancelledLabel === null ? undefined : display.fullyCancelled ? "all" : "partial"}
              data-pending-cancellation={pendingLabel === null ? undefined : "true"}
            >
              <div className={cn("flex min-w-0 gap-2 text-sm", display.fullyCancelled && "line-through decoration-2")}>
                <strong className="min-w-6 text-primary-ink">{display.quantity}×</strong>
                <span className="min-w-0 break-words">{line.itemName}</span>
              </div>
              {line.variantDisplayName ? (
                <p className="pl-8 text-xs break-words text-muted-foreground">{line.variantDisplayName}</p>
              ) : null}
              {display.cancelledLabel ? (
                <p
                  className="mt-1 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs font-semibold text-destructive"
                  role="status"
                >
                  {display.cancelledLabel}
                </p>
              ) : null}
              {pendingLabel ? (
                <p
                  className="mt-1 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs font-semibold text-destructive"
                  role="status"
                >
                  ⏳ {pendingLabel}
                </p>
              ) : null}
              {line.note ? (
                <p className="mt-1 rounded-md bg-amber-400/10 px-2 py-1 text-xs font-medium break-words">
                  Ghi chú: {line.note}
                </p>
              ) : null}
            </li>
          )
        })}
      </ul>
      <footer className="flex min-w-0 gap-2">
        {action && canTransition ? (
          <Button
            className={PREPARATION_ACTION_CLASS}
            disabled={pending}
            onClick={() => onTransition(ticket, action.status)}
          >
            {action.label}
          </Button>
        ) : null}
        {canRetry ? (
          <Button
            variant="outline"
            size="icon"
            className="size-11 shrink-0"
            disabled={pending}
            onClick={() => onRetry(ticket)}
            aria-label="Yêu cầu in lại"
          >
            <Printer className="size-4" />
          </Button>
        ) : null}
      </footer>
    </article>
  )
}

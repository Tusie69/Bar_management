import { Clock3, GripVertical, Minus, Plus, Printer, TriangleAlert, Undo2 } from "lucide-react"
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
import {
  isGroupedPendingCancellation,
  preparationGroupedCancellationDetail,
  preparationGroupedCancellationTitle,
  summarizePreparationGroupedCancellation,
} from "./preparation-cancellation-summary"

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
  onProgress,
  onRevert,
  onDragHandlePointerDown,
  dragging = false,
  pending,
}: {
  ticket: PreparationTicket
  station: PreparationStationCode
  now: Date
  canTransition: boolean
  canRetry: boolean
  onTransition: (ticket: PreparationTicket, status: PreparationTicketStatus) => void
  onRetry: (ticket: PreparationTicket) => void
  onProgress: (ticket: PreparationTicket, lineNo: number, doneQuantity: number, expectedVersion: number) => void
  /** Lùi một bước. Không truyền nghĩa là màn này không cho lùi. */
  onRevert?: (ticket: PreparationTicket) => void
  /** Bắt đầu cú kéo. Không truyền thì thẻ không có tay nắm. */
  onDragHandlePointerDown?: (event: React.PointerEvent, ticket: PreparationTicket) => void
  dragging?: boolean
  pending: boolean
}) {
  const action = preparationNextAction(station, ticket.status)
  const waitSeconds = preparationWaitSeconds(ticket.submittedAt, ticket.waitSeconds, now)
  const waitTone = preparationWaitTone(waitSeconds)
  const waitToneClass = PREPARATION_WAIT_TONE_CLASS[waitTone]
  const flags = preparationGuestFlagBadges(ticket.guestFlags)
  const groupedCancellation = summarizePreparationGroupedCancellation(ticket.lines)
  const progressEditable = canTransition && (ticket.status === "ACCEPTED" || ticket.status === "PREPARING")
  // Lùi chỉ có nghĩa ở hai bước giữa; READY đã bắn thông báo ra ngoài quầy.
  const canRevert =
    canTransition && onRevert !== undefined && (ticket.status === "ACCEPTED" || ticket.status === "PREPARING")
  const incompleteLineCount = ticket.lines.filter(
    (line) => line.quantity > 0 && line.doneQuantity < line.quantity,
  ).length
  return (
    <article
      className={cn(
        "grid min-w-0 gap-3 rounded-xl border bg-surface-1 p-3 shadow-xs",
        waitToneClass.card,
        dragging && "opacity-50",
      )}
      data-ticket-id={ticket.ticketId}
      data-dragging={dragging ? "true" : undefined}
      data-visit-id={ticket.visitId}
      data-wait-tone={waitTone}
    >
      <header className="grid min-w-0 gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {onDragHandlePointerDown ? (
            <button
              type="button"
              // touch-action-none: trình duyệt nhường chuyển động cho cú kéo.
              // Chỉ riêng tay nắm, nên vuốt ở chỗ khác vẫn cuộn được danh sách.
              className="-ml-1 grid size-9 shrink-0 cursor-grab touch-none place-items-center rounded-lg text-muted-foreground hover:bg-surface-2 active:cursor-grabbing"
              aria-label={`Kéo phiếu ${preparationTableLabel(ticket.tableCodes)} sang cột khác`}
              onPointerDown={(event) => onDragHandlePointerDown(event, ticket)}
            >
              <GripVertical className="size-4" aria-hidden="true" />
            </button>
          ) : null}
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
      {groupedCancellation ? (
        <section
          className="grid min-w-0 gap-1 rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-xs"
          aria-label="Yêu cầu hủy theo đơn đang chờ duyệt"
          data-grouped-cancellation={groupedCancellation.coversAllActiveLines ? "all" : "partial"}
        >
          <p className="flex min-w-0 items-start gap-2 font-semibold text-destructive">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 break-words">
              {preparationGroupedCancellationTitle(station, groupedCancellation)}
            </span>
          </p>
          <p>{preparationGroupedCancellationDetail(groupedCancellation)}</p>
          {groupedCancellation.hasSingleLinePendingAlongsideGroup ? (
            <p>Phiếu này đồng thời có yêu cầu hủy riêng từng món.</p>
          ) : null}
          {groupedCancellation.groupCount > 1 ? <p>Phiếu này có nhiều nhóm yêu cầu hủy đang chờ duyệt.</p> : null}
        </section>
      ) : null}
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
              {isGroupedPendingCancellation(line) ? (
                <p className="mt-1 text-xs font-medium text-destructive">Thuộc yêu cầu hủy theo đơn</p>
              ) : null}
              {line.note ? (
                <p className="mt-1 rounded-md bg-amber-400/10 px-2 py-1 text-xs font-medium break-words">
                  Ghi chú: {line.note}
                </p>
              ) : null}
              {line.quantity > 0 ? (
                <div
                  className="mt-2 flex min-w-0 items-center justify-between gap-2"
                  aria-label={`Tiến độ ${line.itemName}`}
                >
                  <span className="text-xs font-semibold" aria-live="polite">
                    Đã làm {line.doneQuantity}/{line.quantity}
                  </span>
                  {progressEditable ? (
                    <div className="flex shrink-0 gap-1" role="group" aria-label={`Cập nhật tiến độ ${line.itemName}`}>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="size-11"
                        disabled={pending || line.doneQuantity <= 0}
                        aria-label={`Giảm số đã làm của ${line.itemName}`}
                        onClick={() => onProgress(ticket, line.lineNo, line.doneQuantity - 1, line.progressVersion)}
                      >
                        <Minus className="size-4" aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="size-11"
                        disabled={pending || line.doneQuantity >= line.quantity}
                        aria-label={`Tăng số đã làm của ${line.itemName}`}
                        onClick={() => onProgress(ticket, line.lineNo, line.doneQuantity + 1, line.progressVersion)}
                      >
                        <Plus className="size-4" aria-hidden="true" />
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
      {ticket.status === "PREPARING" && incompleteLineCount > 0 ? (
        <p className="rounded-lg border border-amber-400/40 bg-amber-400/10 p-2 text-xs" role="status">
          {`${incompleteLineCount} dòng chưa đủ số lượng. Bạn vẫn có thể báo xong nếu đã đối chiếu thực tế.`}
        </p>
      ) : null}
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
        {canRevert ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-11 shrink-0"
            disabled={pending}
            onClick={() => onRevert?.(ticket)}
            aria-label="Lùi phiếu về bước trước"
            title="Lùi phiếu về bước trước"
          >
            <Undo2 className="size-4" aria-hidden="true" />
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

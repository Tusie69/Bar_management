/**
 * Module Phục vụ (v1.1) — "Đơn vừa đặt" (mockup P10) và "Hủy đơn?" (P11).
 *
 * Mở từ nút "Xem" trên dải thông báo đã lên đơn. Nó trả lời đúng câu mà Phục
 * vụ cần khi quay lại bàn đọc lại cho khách: đơn này gồm những gì, gửi lúc
 * nào, ai gọi, quầy nào nhận, và mỗi món đang ở đâu.
 *
 * Nút "Hủy đơn?" KHÔNG hủy gì. Nó gửi một yêu cầu tới Thu ngân / Admin Edit
 * (chốt Q2 ngày 21/11) và nói thẳng điều đó trên nút lẫn trong hộp xác nhận —
 * một nút tên "Hủy đơn" mà không hủy là một nút nói dối.
 */
import { useQuery } from "@tanstack/react-query"
import { AlertCircle, Clock3, MapPin, UserRound } from "lucide-react"
import { useState } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { fmtTime } from "@/lib/time"
import { cn } from "@/lib/utils"
import { useSession } from "@/state/session"
import { isApiError } from "@/services"
import { formatVnd } from "./menu-price"
import { PREPARATION_LABEL, STATION_LABEL } from "./order-board-model"
import { fetchWaiterOrder, type OrderCancellationWasteLine, type WaiterOrderDetail } from "./waiter-order-api"

export const MAX_CANCEL_REASON_LENGTH = 200

/** Lý do chọn sẵn, theo mockup P11. Lý do là BẮT BUỘC. */
const CANCEL_REASONS: readonly string[] = [
  "Khách đổi ý",
  "Gọi nhầm bàn",
  "Gọi trùng đơn",
  "Khách chờ quá lâu",
  "Nhập sai món",
]

function MetaRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      {icon}
      <span className="min-w-0 truncate">{children}</span>
    </p>
  )
}

export function OrderJustSentBody({ order }: { order: WaiterOrderDetail }) {
  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <MetaRow icon={<Clock3 className="size-4 shrink-0" aria-hidden />}>
          {`Gửi lúc ${fmtTime(new Date(order.submittedAt))} · Đơn ${order.visitSequence} của bàn`}
        </MetaRow>
        <MetaRow icon={<UserRound className="size-4 shrink-0" aria-hidden />}>
          {`Người gọi: ${order.orderedByDisplayName}`}
        </MetaRow>
        <MetaRow icon={<MapPin className="size-4 shrink-0" aria-hidden />}>
          {`Gửi tới: ${order.stations.map((station) => STATION_LABEL[station]).join(" + ")}`}
        </MetaRow>
      </div>

      <ul className="rounded-xl border border-border px-3">
        {order.lines.map((line) => (
          <li
            key={line.lineNo}
            className="flex items-start gap-3 border-t border-border-subtle py-2.5 first:border-t-0"
          >
            <div className="min-w-0 flex-1">
              <p
                className={cn("text-sm font-semibold", line.netQuantity === 0 && "text-muted-foreground line-through")}
              >
                {`${line.netQuantity}× ${line.itemName}`}
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                <span>{line.variantDisplayName}</span>
                {line.note ? <span className="rounded bg-amber-100 px-1 text-amber-900">{line.note}</span> : null}
                <span>· {STATION_LABEL[line.preparationStation]}</span>
                {line.preparationStatus ? <span>· {PREPARATION_LABEL[line.preparationStatus]}</span> : null}
              </p>
              {line.pendingCancellation ? (
                <p className="mt-1 text-xs text-amber-700">
                  {`Đang chờ duyệt hủy ${line.pendingCancellation.quantity} phần.`}
                </p>
              ) : null}
            </div>
            <strong className="tnum shrink-0 text-sm">{formatVnd(line.netTotalVnd)}</strong>
          </li>
        ))}
      </ul>

      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold">Tổng đơn</span>
        <strong className="tnum text-base text-primary-ink">{formatVnd(order.netAmountVnd)}</strong>
      </div>
    </div>
  )
}

export function CancelOrderDialog({
  open,
  order,
  submitting,
  errorMessage,
  wasteLines,
  onCancel,
  onSubmit,
}: {
  open: boolean
  order: WaiterOrderDetail | null
  submitting: boolean
  errorMessage: string | null
  /** Món đã làm xong mà máy chủ vừa báo; buộc một lần tick riêng. */
  wasteLines: readonly OrderCancellationWasteLine[]
  onCancel: () => void
  onSubmit: (input: { reason: string; acknowledgeWaste: boolean }) => void
}) {
  const [reason, setReason] = useState("")
  const [extra, setExtra] = useState("")
  const [acknowledgeWaste, setAcknowledgeWaste] = useState(false)
  const needsWaste = wasteLines.length > 0
  const fullReason = [reason, extra.trim()].filter(Boolean).join(" · ")
  const ready = reason.length > 0 && (!needsWaste || acknowledgeWaste)

  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Xin hủy cả đơn</AlertDialogTitle>
          <AlertDialogDescription>
            {order
              ? `Đơn ${order.visitSequence} · ${order.itemCount - order.cancelledItemCount} món · ${formatVnd(order.netAmountVnd)}. Yêu cầu được gửi tới Thu ngân / Admin Edit; đơn chưa bị hủy ngay.`
              : null}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">Lý do (bắt buộc)</span>
            <div className="flex flex-wrap gap-2">
              {CANCEL_REASONS.map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  aria-pressed={reason === candidate}
                  onClick={() => setReason(candidate)}
                  className={cn(
                    "min-h-11 rounded-lg border px-3 text-sm font-medium transition-colors hover:border-border-strong focus-visible:ring-[3px] focus-visible:ring-primary/25 focus-visible:outline-none active:scale-[0.97]",
                    reason === candidate
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-surface-1 text-foreground",
                  )}
                >
                  {candidate}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-1.5">
            <label className="text-sm font-medium" htmlFor="cancel-order-note">
              Ghi thêm
            </label>
            <Textarea
              id="cancel-order-note"
              value={extra}
              maxLength={MAX_CANCEL_REASON_LENGTH - 40}
              onChange={(event) => setExtra(event.target.value)}
              placeholder="Không bắt buộc"
              className="min-h-16"
            />
            <p className="text-xs text-muted-foreground">Không ghi tên hay số điện thoại khách vào đây.</p>
          </div>

          {needsWaste ? (
            <label className="grid gap-1.5 rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
              <span className="font-semibold text-destructive">Đơn có món đã làm xong</span>
              <span className="text-xs leading-snug">
                {wasteLines
                  .map((line) => `${line.quantity ?? ""}${line.quantity ? "× " : ""}${line.itemName}`)
                  .join(", ")}
              </span>
              <span className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={acknowledgeWaste}
                  onChange={(event) => setAcknowledgeWaste(event.target.checked)}
                  aria-label="Xác nhận ghi hao phần đã làm xong"
                />
                <span>Tôi xác nhận phần đã làm xong sẽ được ghi hao.</span>
              </span>
            </label>
          ) : null}

          {errorMessage ? (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage}
            </p>
          ) : null}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Thôi</AlertDialogCancel>
          <AlertDialogAction
            disabled={!ready || submitting}
            onClick={(event) => {
              event.preventDefault()
              if (!ready) return
              onSubmit({ reason: fullReason, acknowledgeWaste })
            }}
          >
            {submitting ? "Đang gửi…" : "Gửi yêu cầu hủy"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function OrderJustSentSheet({
  orderId,
  tableLabel,
  open,
  onClose,
  onRequestCancel,
  canRequestCancel,
  pendingCancelRequest,
}: {
  orderId: number | null
  /** "A3" hoặc "B11 + B12"; đơn không mang mã bàn, Phiên mới mang. */
  tableLabel: string
  open: boolean
  onClose: () => void
  onRequestCancel: (order: WaiterOrderDetail) => void
  canRequestCancel: boolean
  /** Đã gửi yêu cầu hủy cho đơn này rồi: nút đổi thành một dòng trạng thái. */
  pendingCancelRequest: boolean
}) {
  const venueId = useSession((state) => state.principal?.venueId ?? null)
  const detail = useQuery({
    queryKey: ["waiter-order", venueId, orderId],
    queryFn: () => fetchWaiterOrder(orderId as number),
    enabled: open && orderId !== null,
    staleTime: 5_000,
  })

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{`Đơn vừa đặt · ${tableLabel}`}</SheetTitle>
          <SheetDescription className="sr-only">Món, giờ gửi, người gọi và quầy nhận của đơn vừa gửi.</SheetDescription>
        </SheetHeader>
        <div className="grid gap-3 px-4 pb-6">
          {detail.isPending ? (
            <Skeleton className="h-40" />
          ) : detail.isError ? (
            <p role="alert" className="flex items-start gap-2 rounded-lg border border-border bg-surface-2 p-3 text-sm">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
              <span>{isApiError(detail.error) ? detail.error.message : "Không tải được đơn vừa đặt."}</span>
            </p>
          ) : detail.data ? (
            <>
              <OrderJustSentBody order={detail.data} />
              {pendingCancelRequest ? (
                <p className="rounded-xl border border-amber-400/60 bg-amber-50 px-3 py-2.5 text-center text-sm text-amber-900">
                  Đang chờ Thu ngân / Admin Edit duyệt hủy đơn này.
                </p>
              ) : canRequestCancel ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-12 w-full border-destructive/50 text-base text-destructive hover:bg-destructive/5"
                  onClick={() => detail.data && onRequestCancel(detail.data)}
                >
                  Hủy đơn?
                </Button>
              ) : null}
              {canRequestCancel && !pendingCancelRequest ? (
                <p className="text-center text-xs text-muted-foreground">
                  Gửi yêu cầu hủy cả đơn tới Thu ngân / Admin Edit duyệt
                </p>
              ) : null}
              {detail.data.cancelledItemCount > 0 ? (
                <Badge variant="outline" className="justify-self-center">
                  {`Đã hủy ${detail.data.cancelledItemCount} món`}
                </Badge>
              ) : null}
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}

/**
 * Module Phục vụ 5 — các khối của màn "Đơn của bàn".
 *
 * Tách khỏi trang để test render được: `Sheet`/`AlertDialog` của Radix vẽ vào
 * portal, nên `renderToStaticMarkup` không thấy gì bên trong chúng.
 */
import { AlertCircle, BellRing, Hourglass, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
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
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { formatVnd } from "./menu-price"
import { PREPARATION_LABEL, STATION_LABEL, lineCapability, lineNetLabel } from "./order-board-model"
import { QuantityStepper } from "./quantity-stepper"
import type { WaiterOrderLine } from "./waiter-order-api"

export const MAX_CANCEL_REASON_LENGTH = 200

/** Badge trạng thái món. Màu theo mức độ "đã làm tới đâu", không theo cảm tính. */
export function PreparationBadge({ line }: { line: WaiterOrderLine }) {
  const status = line.preparationStatus
  if (status === null) return null
  return (
    <Badge
      variant={status === "READY" || status === "COLLECTED" ? "default" : "secondary"}
      className={cn(status === "READY" && "bg-primary text-primary-foreground")}
    >
      {PREPARATION_LABEL[status]}
    </Badge>
  )
}

export function OrderLineRow({
  line,
  canAdjust,
  canRequestCancel,
  onAdjust,
  onRequestCancel,
  busy = false,
}: {
  line: WaiterOrderLine
  /** Quyền `order.line.adjust` của người đang đăng nhập. */
  canAdjust: boolean
  /** Quyền `order.cancel.request`. */
  canRequestCancel: boolean
  onAdjust: (line: WaiterOrderLine, quantity: number) => void
  onRequestCancel: (line: WaiterOrderLine) => void
  busy?: boolean
}) {
  const capability = lineCapability(line)
  const cancelled = line.cancelledQuantity > 0
  return (
    <li className="grid gap-2 border-t border-border px-4 py-3 first:border-t-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn("font-medium", line.netQuantity === 0 && "text-muted-foreground line-through")}>
            <span className="tnum">{lineNetLabel(line)}×</span> {line.itemName}{" "}
            <span className="text-muted-foreground">({line.variantDisplayName})</span>
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <PreparationBadge line={line} />
            <span>{STATION_LABEL[line.preparationStation]}</span>
            <span className="tnum">{formatVnd(line.unitPriceVnd)}/phần</span>
          </div>
          {line.note ? <p className="mt-1 text-xs text-muted-foreground italic">Ghi chú: {line.note}</p> : null}
        </div>
        <div className="shrink-0 text-right">
          <strong className="tnum block">{formatVnd(line.netTotalVnd)}</strong>
          {cancelled ? <s className="tnum text-xs text-muted-foreground">{formatVnd(line.lineTotalVnd)}</s> : null}
        </div>
      </div>

      {capability.notice ? (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          {line.pendingCancellation ? (
            <Hourglass className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          ) : (
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          )}
          <span>{capability.notice}</span>
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {canAdjust && capability.canAdjust ? (
          <QuantityStepper
            value={line.quantity}
            label={`${line.itemName} ${line.variantDisplayName}`}
            onChange={(next) => onAdjust(line, next)}
          />
        ) : null}
        {canRequestCancel && capability.canRequestCancel ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-10"
            disabled={busy}
            onClick={() => onRequestCancel(line)}
          >
            <Trash2 className="size-4" aria-hidden />
            {capability.needsWasteAcknowledgement ? "Xin ghi hao" : "Xin hủy món"}
          </Button>
        ) : null}
      </div>
    </li>
  )
}

export interface CancelRequestDraft {
  line: WaiterOrderLine
  quantity: number
  reason: string
  acknowledgeWaste: boolean
}

/**
 * Hộp xin hủy món.
 *
 * Lý do là BẮT BUỘC: người duyệt chỉ có câu này để quyết định, và nhật ký sau
 * một tháng cũng chỉ còn nó. Với món đã làm xong, hộp nói thẳng rằng duyệt
 * nghĩa là ghi hao, và buộc một lần tick riêng — không phải cùng một cú bấm với
 * "khách đổi ý".
 */
export function CancelRequestDialog({
  line,
  submitting,
  errorMessage,
  onCancel,
  onSubmit,
}: {
  line: WaiterOrderLine | null
  submitting: boolean
  errorMessage: string | null
  onCancel: () => void
  onSubmit: (draft: CancelRequestDraft) => void
}) {
  const [quantity, setQuantity] = useState(1)
  const [reason, setReason] = useState("")
  const [acknowledgeWaste, setAcknowledgeWaste] = useState(false)

  useEffect(() => {
    setQuantity(line ? Math.min(1, line.netQuantity) || 1 : 1)
    setReason("")
    setAcknowledgeWaste(false)
  }, [line])

  const capability = line ? lineCapability(line) : null
  const needsWaste = capability?.needsWasteAcknowledgement ?? false
  const ready = reason.trim().length > 0 && (!needsWaste || acknowledgeWaste)

  return (
    <AlertDialog open={line !== null} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{needsWaste ? "Xin ghi hao món đã làm" : "Xin hủy món"}</AlertDialogTitle>
          <AlertDialogDescription>
            {line ? (
              <>
                {line.itemName} ({line.variantDisplayName}) · còn {line.netQuantity} phần.{" "}
                {needsWaste
                  ? "Món đã làm xong: duyệt yêu cầu này nghĩa là bỏ phần đã pha."
                  : "Yêu cầu được gửi tới người có quyền phê duyệt; món chưa bị hủy ngay."}
              </>
            ) : null}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {line ? (
          <div className="grid gap-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">Số phần xin hủy</span>
              <QuantityStepper
                value={quantity}
                label={`hủy ${line.itemName}`}
                onChange={(next) => setQuantity(Math.min(next, line.netQuantity))}
              />
            </div>
            <div className="grid gap-1.5">
              <label className="text-sm font-medium" htmlFor="cancel-reason">
                Lý do (bắt buộc)
              </label>
              <Textarea
                id="cancel-reason"
                value={reason}
                maxLength={MAX_CANCEL_REASON_LENGTH}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Ví dụ: khách đổi ý, gọi trùng món"
                className="min-h-20"
              />
              <p className="text-xs text-muted-foreground">Không ghi tên hay số điện thoại khách vào đây.</p>
            </div>
            {needsWaste ? (
              <label className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={acknowledgeWaste}
                  onChange={(event) => setAcknowledgeWaste(event.target.checked)}
                  aria-label="Xác nhận ghi hao món đã làm xong"
                />
                <span>Tôi xác nhận món đã làm xong và phần này sẽ được ghi hao.</span>
              </label>
            ) : null}
            {errorMessage ? (
              <p role="alert" className="text-sm text-destructive">
                {errorMessage}
              </p>
            ) : null}
          </div>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Thôi</AlertDialogCancel>
          <AlertDialogAction
            disabled={!ready || submitting || line === null}
            onClick={(event) => {
              event.preventDefault()
              if (!line || !ready) return
              onSubmit({ line, quantity, reason: reason.trim(), acknowledgeWaste })
            }}
          >
            {submitting ? "Đang gửi…" : "Gửi yêu cầu"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Dải thông báo "món đã xong" của chính người đang đăng nhập, cho một Phiên. */
export function ReadyBanner({ count, onOpen }: { count: number; onOpen?: () => void }) {
  if (count === 0) return null
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/40 bg-primary/5 px-4 py-3 text-sm"
    >
      <BellRing className="size-4 text-primary-ink" aria-hidden />
      <span>
        <strong className="tnum">{count}</strong> phiếu món đã xong cho bàn này.
      </span>
      {onOpen ? (
        <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={onOpen}>
          Đã nhận
        </Button>
      ) : null}
    </div>
  )
}

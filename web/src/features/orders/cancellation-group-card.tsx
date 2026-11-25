/**
 * Module Phục vụ (v1.1) — thẻ "Hủy cả đơn" trên hàng chờ phê duyệt.
 *
 * Một thẻ, một quyết định. Phần phải GHI HAO được tách ra thành dòng riêng và
 * tô đỏ: đó là thứ duy nhất trong thẻ này khiến quán mất tiền thật, và người
 * duyệt phải thấy nó trước khi ngón tay chạm nút, không phải sau.
 */
import { AlertTriangle, Check, X } from "lucide-react"
import { useRef, useState, type RefObject } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatVnd } from "@/features/waiter-menu/menu-price"
import { PREPARATION_LABEL, STATION_LABEL } from "@/features/waiter-menu/order-board-model"
import { CancellationApproveDialog } from "./cancellation-approve-dialog"
import { useFocusFallbackOnUnmount } from "./cancellation-focus"
import type { CancellationGroupItem } from "./cancellation-grouping"

function timeLabel(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })
}

export function CancellationGroupCard({
  group,
  note,
  busy,
  decided,
  fallbackFocusRef,
  onNoteChange,
  onDecide,
}: {
  group: CancellationGroupItem
  note: string
  busy: boolean
  /** Hàng chờ đã xử lý (APPROVED/REJECTED): chỉ xem, không còn nút quyết định. */
  decided: boolean
  fallbackFocusRef?: RefObject<HTMLElement | null>
  onNoteChange: (value: string) => void
  onDecide: (decision: "approve" | "reject") => void | Promise<unknown>
}) {
  const waste = group.wasteQuantity > 0
  const [confirmOpen, setConfirmOpen] = useState(false)
  const cardRef = useRef<HTMLLIElement>(null)
  const approveButtonRef = useRef<HTMLButtonElement>(null)
  const tableOrderLabel = `Đơn ${group.visitSequence} · ${group.tableCodes.length > 0 ? `Bàn ${group.tableCodes.join(" + ")}` : "—"}`

  useFocusFallbackOnUnmount(cardRef, fallbackFocusRef)

  return (
    <li ref={cardRef} className="grid gap-3 rounded-2xl border-2 border-border-strong bg-surface-1 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            <Badge>Hủy cả đơn</Badge>
            {`Đơn ${group.visitSequence} · ${group.tableCodes.join(" + ") || "—"}`}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {`${group.entryCount} dòng món · ${group.totalQuantity} phần`}
          </p>
        </div>
        <strong className="tnum shrink-0 text-base">{formatVnd(group.amountVnd)}</strong>
      </div>

      {waste ? (
        <p className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{`${group.wasteQuantity} phần đã làm xong — duyệt nghĩa là ghi hao số này.`}</span>
        </p>
      ) : null}

      <ul className="grid gap-1 rounded-xl border border-border-subtle px-3 py-2">
        {group.entries.map((entry) => (
          <li key={entry.cancellationId} className="flex items-start justify-between gap-3 text-sm">
            <span className="min-w-0">
              <span className="tnum font-medium">{entry.quantity}× </span>
              {entry.itemName}
              <span className="text-muted-foreground">
                {` · ${entry.variantDisplayName} · ${STATION_LABEL[entry.station]} · ${PREPARATION_LABEL[entry.ticketStatusAtRequest]}`}
              </span>
            </span>
            <span className="tnum shrink-0 text-muted-foreground">{formatVnd(entry.amountVnd)}</span>
          </li>
        ))}
      </ul>

      <div className="grid gap-1 text-sm">
        <p>
          <span className="text-muted-foreground">Lý do: </span>
          <span className="font-medium">{group.reason}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          {`${group.requestedByDisplayName} · ${timeLabel(group.requestedAt)}`}
        </p>
      </div>

      {decided ? null : (
        <>
          <Input
            value={note}
            onChange={(event) => onNoteChange(event.target.value)}
            placeholder="Ghi chú (không bắt buộc)"
            className="h-11"
            aria-label={`Ghi chú quyết định cho đơn ${group.visitSequence}`}
          />
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11"
              disabled={busy}
              onClick={() => void Promise.resolve(onDecide("reject")).catch(() => undefined)}
            >
              <X className="size-4" aria-hidden /> Từ chối
            </Button>
            <Button
              ref={approveButtonRef}
              type="button"
              variant={waste ? "destructive" : "default"}
              className="h-11"
              disabled={busy}
              onClick={() => setConfirmOpen(true)}
            >
              <Check className="size-4" aria-hidden /> Duyệt cả đơn
            </Button>
          </div>
          <CancellationApproveDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            triggerRef={approveButtonRef}
            fallbackFocusRef={fallbackFocusRef}
            title={waste ? "Xác nhận duyệt ghi hao cả đơn" : "Xác nhận duyệt hủy cả đơn"}
            description={
              waste
                ? "Thao tác này chấp nhận hủy toàn bộ đơn và ghi hao các món đã làm xong."
                : "Thao tác này chấp nhận hủy toàn bộ các món trong đơn."
            }
            waste={waste}
            tableOrderLabel={tableOrderLabel}
            quantityLabel={`${group.totalQuantity} phần (${group.entryCount} dòng món)`}
            amountVnd={group.amountVnd}
            items={group.entries.map((entry) => ({
              key: entry.cancellationId,
              quantity: entry.quantity,
              itemName: entry.itemName,
              variantDisplayName: entry.variantDisplayName,
              amountVnd: entry.amountVnd,
            }))}
            wasteNoticeDetail={waste ? `${group.wasteQuantity} phần đã làm xong trong đơn này.` : undefined}
            busy={busy}
            onConfirm={() => onDecide("approve")}
          />
        </>
      )}
    </li>
  )
}

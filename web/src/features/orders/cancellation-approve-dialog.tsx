/**
 * Hộp xác nhận cho thao tác duyệt hủy món, duyệt ghi hao và duyệt cả đơn.
 *
 * Chỉ chèn cổng xác nhận ở lớp UI trước khi gọi `onConfirm` (tức handler
 * `onDecide("approve")` hiện có), giữ nguyên API, payload và mutation.
 */
import { AlertTriangle, Loader2 } from "lucide-react"
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react"
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
import { formatVnd } from "@/features/waiter-menu/menu-price"

export interface ApproveConfirmItem {
  key: string | number
  quantity: number
  itemName: string
  variantDisplayName: string
  amountVnd?: number
}

export function CancellationApproveSummary({
  waste,
  tableOrderLabel,
  quantityLabel,
  amountVnd,
  items,
  wasteNoticeDetail,
}: {
  waste: boolean
  tableOrderLabel: string
  quantityLabel: string
  amountVnd: number
  items: readonly ApproveConfirmItem[]
  wasteNoticeDetail?: string
}) {
  return (
    <>
      <dl className="grid gap-2 rounded-xl border border-border bg-surface-2 px-3.5 py-3 text-sm">
        {items.length === 1 ? (
          <div className="flex items-start justify-between gap-3">
            <dt className="shrink-0 text-muted-foreground">Món</dt>
            <dd className="min-w-0 text-right font-medium break-words text-foreground">
              {items[0]!.itemName} ({items[0]!.variantDisplayName})
            </dd>
          </div>
        ) : null}
        <div className="flex items-start justify-between gap-3">
          <dt className="shrink-0 text-muted-foreground">Bàn / Đơn</dt>
          <dd className="min-w-0 text-right font-medium break-words text-foreground">{tableOrderLabel}</dd>
        </div>
        <div className="flex items-start justify-between gap-3">
          <dt className="shrink-0 text-muted-foreground">Số lượng</dt>
          <dd className="tnum min-w-0 text-right font-medium text-foreground">{quantityLabel}</dd>
        </div>
        <div className="flex items-start justify-between gap-3 border-t border-border-subtle pt-2">
          <dt className="shrink-0 text-muted-foreground">Số tiền</dt>
          <dd className="tnum min-w-0 text-right font-semibold text-foreground">{formatVnd(amountVnd)}</dd>
        </div>
      </dl>

      {items.length > 1 ? (
        <ul className="grid max-h-36 gap-1.5 overflow-y-auto rounded-xl border border-border-subtle bg-surface-1 px-3 py-2 text-sm">
          {items.map((item) => (
            <li key={item.key} className="flex items-start justify-between gap-3">
              <span className="min-w-0 break-words">
                <span className="tnum font-medium">{item.quantity}× </span>
                {item.itemName} <span className="text-muted-foreground">({item.variantDisplayName})</span>
              </span>
              {item.amountVnd !== undefined ? (
                <span className="tnum shrink-0 text-muted-foreground">{formatVnd(item.amountVnd)}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {waste ? (
        <div
          role="note"
          className="flex items-start gap-2.5 rounded-xl border border-destructive/40 bg-destructive/5 px-3.5 py-2.5 text-sm text-foreground"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <div className="grid gap-0.5">
            <p className="font-semibold">Ghi hao món đã làm - tính vào hao hụt</p>
            {wasteNoticeDetail ? <p className="text-xs text-muted-foreground">{wasteNoticeDetail}</p> : null}
          </div>
        </div>
      ) : null}
    </>
  )
}

export function CancellationApproveSendingStatus({ ref }: { ref?: RefObject<HTMLParagraphElement | null> }) {
  return (
    <p
      ref={ref}
      role="status"
      aria-live="polite"
      aria-label="Đang duyệt..."
      tabIndex={0}
      className="flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-3.5 py-2.5 text-sm font-medium text-foreground focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/25 focus-visible:outline-none"
    >
      <Loader2 className="size-4 shrink-0 animate-spin text-primary-ink motion-reduce:animate-none" aria-hidden />
      <span>Đang duyệt yêu cầu, vui lòng chờ...</span>
    </p>
  )
}

export function CancellationApproveDialog({
  open,
  onOpenChange,
  triggerRef,
  fallbackFocusRef,
  title,
  description,
  waste,
  tableOrderLabel,
  quantityLabel,
  amountVnd,
  items,
  wasteNoticeDetail,
  busy,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  triggerRef: RefObject<HTMLButtonElement | null>
  fallbackFocusRef?: RefObject<HTMLElement | null>
  title: string
  description: string
  waste: boolean
  tableOrderLabel: string
  quantityLabel: string
  amountVnd: number
  items: readonly ApproveConfirmItem[]
  wasteNoticeDetail?: string
  busy: boolean
  onConfirm: () => void
}) {
  const wasBusyRef = useRef(false)
  // Chốt đồng bộ chặn nhấp đúp / Enter lặp trước khi React render lại với `busy=true`.
  const submittingRef = useRef(false)
  const [submitting, setSubmitting] = useState(false)
  const sendingStatusRef = useRef<HTMLParagraphElement>(null)
  const locked = busy || submitting

  if ((!open || busy) && submitting) {
    setSubmitting(false)
  }

  useEffect(() => {
    if (!open) {
      wasBusyRef.current = false
      submittingRef.current = false
      return
    }
    if (busy) {
      wasBusyRef.current = true
    } else if (wasBusyRef.current) {
      wasBusyRef.current = false
      submittingRef.current = false
      onOpenChange(false)
    }
  }, [busy, onOpenChange, open])

  useLayoutEffect(() => {
    if (open && locked) {
      sendingStatusRef.current?.focus({ preventScroll: true })
    }
  }, [locked, open])

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && (busy || submittingRef.current)) return
        onOpenChange(next)
      }}
    >
      <AlertDialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
        onMouseDown={(event) => {
          if (locked && event.target !== sendingStatusRef.current) {
            event.preventDefault()
          }
        }}
        onEscapeKeyDown={(event) => {
          if (busy || submittingRef.current) event.preventDefault()
        }}
        onCloseAutoFocus={(event) => {
          if (triggerRef.current?.isConnected && !triggerRef.current.disabled) {
            event.preventDefault()
            triggerRef.current.focus()
            return
          }
          if (fallbackFocusRef?.current?.isConnected) {
            event.preventDefault()
            fallbackFocusRef.current.focus()
          }
        }}
      >
        <AlertDialogHeader>
          {waste ? (
            <div className="mb-1 grid size-11 place-items-center rounded-full bg-st-late-tint text-[var(--st-late-ink)]">
              <AlertTriangle className="size-5" aria-hidden />
            </div>
          ) : null}
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        <CancellationApproveSummary
          waste={waste}
          tableOrderLabel={tableOrderLabel}
          quantityLabel={quantityLabel}
          amountVnd={amountVnd}
          items={items}
          wasteNoticeDetail={wasteNoticeDetail}
        />

        {locked ? <CancellationApproveSendingStatus ref={sendingStatusRef} /> : null}

        <AlertDialogFooter>
          <AlertDialogCancel
            disabled={locked}
            onClick={(event) => {
              if (busy || submittingRef.current) {
                event.preventDefault()
                return
              }
              onOpenChange(false)
            }}
          >
            Huỷ bỏ
          </AlertDialogCancel>
          <AlertDialogAction
            variant={waste ? "destructive" : "default"}
            disabled={locked}
            onClick={(event) => {
              event.preventDefault()
              if (busy || submittingRef.current) return
              submittingRef.current = true
              setSubmitting(true)
              onConfirm()
            }}
          >
            {locked ? "Đang duyệt..." : "Xác nhận"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

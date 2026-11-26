import { Bell } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import type { PaymentNotification, PaymentNotificationType } from "@/services/payment"

const DOT_CLASS: Record<PaymentNotificationType, string> = {
  CANCELLED_ITEM: "bg-destructive",
  PAYMENT_REQUEST: "bg-primary",
  AWAITING_PAYMENT: "bg-[var(--st-pending)]",
  PAID: "bg-st-seated",
}

export function PaymentNotificationBell({
  notifications,
  unread,
  onOpen,
  onSelectVisit,
}: {
  notifications: PaymentNotification[]
  unread: boolean
  onOpen: () => void
  onSelectVisit?: (visitId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onPointerDown)
    window.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("mousedown", onPointerDown)
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [open])

  const hasUnread = unread && notifications.length > 0

  return (
    <span ref={wrapRef} className="relative inline-flex">
      <button
        type="button"
        aria-label={
          hasUnread ? `Thông báo thanh toán, có ${notifications.length} mục mới` : "Thông báo thanh toán"
        }
        aria-expanded={open}
        aria-controls="pay-ntf-list"
        onClick={() => {
          const next = !open
          setOpen(next)
          if (next) onOpen()
        }}
        className="relative inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface-2 px-3 text-foreground cursor-pointer transition-colors hover:bg-surface-3 md:px-3.5"
      >
        <Bell className="size-5 shrink-0" aria-hidden />
        <span className="hidden text-[13px] font-semibold md:inline">Thông báo thu tiền</span>
        {hasUnread ? (
          <span
            aria-hidden
            data-testid="pay-ntf-unread-dot"
            className="absolute top-2 right-2.5 size-2.5 rounded-full border-2 border-surface-1 bg-destructive"
          />
        ) : null}
      </button>

      {open ? (
        <div
          id="pay-ntf-list"
          role="dialog"
          aria-label="Thông báo thanh toán"
          className="absolute top-[calc(100%+6px)] right-0 z-30 max-h-[420px] w-[min(340px,calc(100vw-24px))] overflow-auto rounded-xl border border-border bg-surface-1 pt-3 pb-1 text-foreground shadow-float"
        >
          <b className="block px-4 pb-2 text-sm">Thông báo</b>
          {notifications.length === 0 ? (
            <p className="border-t border-border px-4 py-3 text-sm text-[var(--text-muted)]">Chưa có thông báo.</p>
          ) : (
            <ul className="m-0 list-none p-0">
              {notifications.map((n) => (
                <li key={n.id} className="border-t border-border">
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false)
                      if (n.visitId && onSelectVisit) onSelectVisit(n.visitId)
                    }}
                    className="grid w-full grid-cols-[10px_1fr_auto] items-start gap-2.5 px-4 py-2.5 text-left text-[13px] cursor-pointer hover:bg-surface-2"
                  >
                    <span className={cn("mt-1 size-2.5 rounded-full", DOT_CLASS[n.type])} aria-hidden />
                    <span className="grid min-w-0 gap-0.5">
                      <b className="font-semibold text-foreground">{n.title}</b>
                      <span className="text-[var(--text-muted)]">{n.text}</span>
                    </span>
                    <time className="tnum text-xs text-[var(--text-muted)]">{n.time}</time>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </span>
  )
}

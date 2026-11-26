import { Bell } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import type { PaymentNotification, PaymentNotificationType } from "@/services/payment"

const NTF_TYPE_CLASS: Record<PaymentNotificationType, string> = {
  CANCELLED_ITEM: "pay-ntf-cancel",
  PAYMENT_REQUEST: "pay-ntf-req",
  AWAITING_PAYMENT: "pay-ntf-pend",
  PAID: "pay-ntf-paid",
  INVOICE_ISSUED: "pay-ntf-req",
  CANCEL_REQUESTED: "pay-ntf-cancel",
  CANCEL_DECIDED: "pay-ntf-pend",
}

export function PaymentNotificationBell({
  notifications,
  unread,
  navigationLocked = false,
  onOpen,
  onSelectVisit,
}: {
  notifications: PaymentNotification[]
  unread: boolean
  navigationLocked?: boolean
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
    <span ref={wrapRef} className="pay-ntf-wrap">
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
        className="pay-icon-btn"
      >
        <Bell className="pay-i" aria-hidden />
        {hasUnread ? <span aria-hidden data-testid="pay-ntf-unread-dot" className="pay-ntf-dot" /> : null}
      </button>

      {open ? (
        <div id="pay-ntf-list" role="dialog" aria-label="Thông báo thanh toán" className="pay-ntf-pop">
          <b className="pay-ntf-h">Thông báo</b>
          {notifications.length === 0 ? (
            <p className="border-t border-border px-4 py-3 text-sm text-[var(--text-muted)]">Chưa có thông báo.</p>
          ) : (
            <ul>
              {notifications.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    disabled={navigationLocked}
                    onClick={() => {
                      if (navigationLocked) return
                      setOpen(false)
                      if (n.visitId && onSelectVisit) onSelectVisit(n.visitId)
                    }}
                    className={cn("pay-ntf", NTF_TYPE_CLASS[n.type])}
                  >
                    <span className="pay-ntf-ic" aria-hidden />
                    <span className="pay-ntf-t">
                      <b>{n.title}</b>
                      <span>{n.text}</span>
                    </span>
                    <time>{n.time}</time>
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

import { useCallback, useRef, useState, type ReactNode } from "react"
import { Outlet } from "react-router"
import { PaymentHeader } from "./payment-header"
import { PaymentShellContext } from "./payment-shell-context"

export function PaymentShellFrame({
  fullViewport = true,
  showBackToApp = false,
  rightSlot,
  children,
}: {
  fullViewport?: boolean
  showBackToApp?: boolean
  rightSlot?: ReactNode
  children: ReactNode
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const scrollToTop = useCallback(() => {
    const el = rootRef.current
    if (!el) return
    el.scrollTop = 0
    if (el.parentElement && el.parentElement.scrollTop > 0) {
      el.parentElement.scrollTop = 0
    }
  }, [])

  return (
    <PaymentShellContext.Provider value={{ selectedId, setSelectedId, scrollToTop }}>
      <div
        ref={rootRef}
        className={fullViewport ? "pay-root h-dvh overflow-y-auto" : "pay-root h-full overflow-y-auto"}
      >
        <PaymentHeader showBackToApp={showBackToApp} rightSlot={rightSlot} />
        {fullViewport ? <main className="pay-pg">{children}</main> : <div className="pay-pg">{children}</div>}
      </div>
    </PaymentShellContext.Provider>
  )
}

/**
 * Dedicated shell for CASHIER: only the payment mockup header and S1-S7 payment screens.
 * Never mounts AppShell sidebar, reception TopBar, reception alert banners, or MobileApp BottomNav.
 */
export function CashierShell() {
  return (
    <PaymentShellFrame fullViewport>
      <Outlet />
    </PaymentShellFrame>
  )
}

export default CashierShell

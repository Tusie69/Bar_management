import { useQuery } from "@tanstack/react-query"
import { ChevronDown, LayoutDashboard, LogOut, Moon, Sun } from "lucide-react"
import { useState, type ReactNode } from "react"
import { useNavigate } from "react-router"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ROLE_LABEL } from "@/domain/enums"
import { useBusinessShift, useNow } from "@/hooks/use-data"
import { useIsMobile } from "@/hooks/use-mobile"
import { initials } from "@/lib/text"
import { businessDateOf, fmtBusinessDate, fmtBusinessShift, fmtTime, shiftHour } from "@/lib/time"
import { api, clock } from "@/services"
import { isPaymentAvailable, paymentApi } from "@/services/payment"
import { PaymentNotificationBell } from "@/features/payment/payment-notifications"
import { buildNotificationTargetPath } from "@/features/payment/payment-notification-target"
import { useCan, useSession } from "@/state/session"
import { useUi } from "@/state/ui"
import { usePaymentShell } from "./payment-shell-context"

export function PaymentHeader({
  showBackToApp = false,
  rightSlot,
}: {
  showBackToApp?: boolean
  rightSlot?: ReactNode
}) {
  const { user, users, setUser, theme, setTheme, principal, logout } = useSession()
  const canCollect = useCan("payment.collect")
  const canReadOrders = useCan("order.read")
  const canViewAny = canCollect || (user.role === "WAITER" && canReadOrders)
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const payShell = usePaymentShell()

  const now = useNow(30_000)
  const shift = useBusinessShift()
  const bd = businessDateOf(now, shiftHour(shift.cutoffLocal))

  const displayName = api.mode === "http" ? (principal?.displayName ?? user.displayName) : user.displayName
  const roleLabel = ROLE_LABEL[user.role]
  const subtitle = api.mode === "http" ? (principal ? `@${principal.username}` : "") : "Đổi vai trò để thử (demo)"

  const [seenNtfIds, setSeenNtfIds] = useState<Set<string>>(() => new Set())

  const ntfQuery = useQuery({
    queryKey: ["payment-notifications"],
    queryFn: () => paymentApi.listNotifications(),
    enabled: isPaymentAvailable && canViewAny,
  })

  const notifications = ntfQuery.data ?? []
  const hasUnreadNtf = notifications.some((n) => !seenNtfIds.has(n.id))
  const navigationLocked = Boolean(payShell?.pendingPayment)

  return (
    <header className="pay-hdr">
      <div className="pay-hdr-l">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Tài khoản: ${displayName}`}
              className="pay-hdr-hi"
            >
              <span aria-hidden className="pay-av">
                {initials(displayName)}
              </span>
              <span className="pay-hdr-hi-t">
                <small>Xin chào,</small>
                <b>{`${displayName} · ${roleLabel}`}</b>
              </span>
              <ChevronDown className="size-3.5 shrink-0 text-[var(--text-subtle)]" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel className="font-normal">
              <span className="block text-sm font-medium">{displayName}</span>
              <span className="block text-xs text-muted-foreground">{subtitle}</span>
            </DropdownMenuLabel>
            {showBackToApp ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="h-10 cursor-pointer"
                  disabled={navigationLocked}
                  onSelect={() => {
                    if (navigationLocked) return
                    navigate(isMobile ? "/home" : "/floor")
                  }}
                >
                  <LayoutDashboard className="mr-2 size-4" aria-hidden />
                  {isMobile ? "Về Tổng quan" : "Về Điều phối"}
                </DropdownMenuItem>
              </>
            ) : null}
            <DropdownMenuSeparator />
            {api.mode === "mock" ? (
              <DropdownMenuRadioGroup
                value={String(user.id)}
                onValueChange={(v) => {
                  if (navigationLocked) return
                  setUser(Number(v))
                  useUi.getState().clearHistory()
                }}
              >
                {users.map((u) => (
                  <DropdownMenuRadioItem key={u.id} value={String(u.id)} disabled={navigationLocked} className="h-11">
                    <span className="grid">
                      <span>{ROLE_LABEL[u.role]}</span>
                      <span className="text-xs text-muted-foreground">
                        {u.displayName} · {u.deviceLabel}
                      </span>
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            ) : (
              <DropdownMenuItem className="h-11 cursor-pointer" onSelect={() => void logout()}>
                <LogOut className="mr-2 size-4" aria-hidden /> Đăng xuất
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="h-11 cursor-pointer"
              onSelect={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? <Sun className="mr-2 size-4" aria-hidden /> : <Moon className="mr-2 size-4" aria-hidden />}
              Giao diện {theme === "dark" ? "sáng" : "tối"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="pay-hdr-c">
        <span className="pay-shift">{`${fmtBusinessDate(bd, "short")} · Ca ${fmtBusinessShift(shift)}`}</span>
        <span className="pay-clock">
          {fmtTime(now)}
          {clock.isSimulated ? <small>mô phỏng</small> : null}
        </span>
      </div>

      <div className="pay-hdr-r">
        {rightSlot}
        {canViewAny ? (
          <PaymentNotificationBell
            notifications={notifications}
            unread={hasUnreadNtf}
            navigationLocked={navigationLocked}
            onOpen={() => setSeenNtfIds((prev) => new Set([...prev, ...notifications.map((n) => n.id)]))}
            onSelectVisit={(visitId, notification) => {
              if (payShell?.pendingPayment) return
              payShell?.setSelectedId(visitId)
              navigate(buildNotificationTargetPath(visitId, notification))
            }}
          />
        ) : null}
      </div>
    </header>
  )
}

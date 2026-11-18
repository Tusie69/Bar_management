import {
  AlertTriangle,
  CalendarPlus,
  Check,
  ChevronRight,
  Clock,
  ListPlus,
  LogOut,
  UserPlus,
  X,
  type LucideIcon,
} from "lucide-react"
import { useEffect, useRef, useState, type ReactNode } from "react"
import { useNavigate } from "react-router"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { roleCan, type Permission } from "@/domain/access"
import { ROLE_LABEL } from "@/domain/enums"
import type { ReservationView } from "@/domain/models"
import { usePresenceController } from "@/lib/motion"
import { fmtTime12 } from "@/lib/time"
import { cn } from "@/lib/utils"
import { api } from "@/services"
import { useSession } from "@/state/session"
import { NAV } from "@/app/nav"
import type { Alert } from "../floor/alerts"
import { useMobileActions } from "./actions"
import { useM, type Confirm } from "./context"
import { tableText } from "./model"
import { EmptyBox, Seg } from "./ui"

function useRestoreTriggerFocus(open: boolean) {
  const triggerRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (open) return
    const capture = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return
      if (
        target.closest("[data-slot='sheet-content'], [data-slot='dialog-content'], [data-slot='alert-dialog-content']")
      ) {
        return
      }
      const focusable = target.closest<HTMLElement>(
        "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
      )
      triggerRef.current = focusable ?? target
    }
    const onFocusIn = (e: FocusEvent) => capture(e.target)
    const onPointerDown = (e: PointerEvent) => capture(e.target)
    document.addEventListener("focusin", onFocusIn, true)
    document.addEventListener("pointerdown", onPointerDown, true)
    return () => {
      document.removeEventListener("focusin", onFocusIn, true)
      document.removeEventListener("pointerdown", onPointerDown, true)
      const active = document.activeElement
      if (
        active instanceof HTMLElement &&
        active !== document.body &&
        !active.closest("[data-slot='sheet-content'], [data-slot='dialog-content'], [data-slot='alert-dialog-content']")
      ) {
        triggerRef.current = active
      }
    }
  }, [open])

  return (event: Event) => {
    const target = triggerRef.current
    triggerRef.current = null
    if (target && target.isConnected) {
      event.preventDefault()
      target.focus({ preventScroll: true })
    }
  }
}

function sheetContentClass(isReceptionist: boolean, className?: string) {
  return cn(
    "w-full gap-0 overflow-hidden rounded-t-[20px] border-t border-border bg-surface-1 p-0 shadow-[var(--shadow-float)]",
    isReceptionist && "mx-auto max-w-[var(--gm-max-w)]",
    className,
  )
}

function SheetBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-2", className)}>{children}</div>
}

function SheetCloseFooter({ onClose }: { onClose: () => void }) {
  return (
    <SheetFooter className="border-t border-border/70 bg-surface-1 px-4 pt-3 pb-[calc(14px+var(--bottom-safe))]">
      <Button
        type="button"
        variant="secondary"
        size="lg"
        onClick={onClose}
        className="h-12 w-full rounded-xl font-medium"
      >
        Đóng
      </Button>
    </SheetFooter>
  )
}

function SheetItem({
  icon: Icon,
  label,
  sub,
  onClick,
}: {
  icon: LucideIcon
  label: string
  sub: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="gm-press-card flex min-h-[66px] items-center gap-3.5 rounded-2xl border border-border bg-background px-3.5 py-3 text-left text-tx-1 hover:border-border-strong"
    >
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary-tint text-primary-ink">
        <Icon className="size-5" strokeWidth={1.85} aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[15px] font-semibold text-tx-strong">{label}</span>
        <span className="text-[13px] leading-snug text-[var(--text-muted)]">{sub}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-subtle" aria-hidden />
    </button>
  )
}

export function CreateSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const m = useM()
  const isReceptionist = m.role === "RECEPTIONIST"
  const onCloseAutoFocus = useRestoreTriggerFocus(open)
  const items: { icon: LucideIcon; label: string; sub: string; permission: Permission; go: () => void }[] = [
    {
      icon: CalendarPlus,
      label: "Đặt bàn",
      sub: "Booking cho giờ sau, có hẹn giờ đến",
      permission: "reservation.create",
      go: () => m.openForm({ mode: "booking" }),
    },
    {
      icon: UserPlus,
      label: "Mở bàn Walk-in",
      sub: "Khách đã đến, xếp bàn ngay",
      permission: "visit.walkin",
      go: () => m.openForm({ mode: "walkin" }),
    },
    {
      icon: ListPlus,
      label: "Thêm danh sách chờ",
      sub: "Khách đến nhưng chưa có bàn phù hợp",
      permission: "waitlist.create",
      go: () => m.openForm({ mode: "walkin" }),
    },
  ]
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        data-gm
        data-receptionist-frame={isReceptionist ? "true" : undefined}
        side="bottom"
        onCloseAutoFocus={onCloseAutoFocus}
        className={sheetContentClass(isReceptionist)}
      >
        <SheetHeader className="px-4 pt-5 pb-2 text-left">
          <SheetTitle className="text-[19px] font-bold tracking-[-0.015em] text-tx-strong">Tạo mới</SheetTitle>
          <SheetDescription className="sr-only">Chọn loại thao tác đặt bàn hoặc tiếp nhận khách mới</SheetDescription>
        </SheetHeader>
        <SheetBody className="pb-3">
          {items
            .filter((i) => roleCan(m.role, i.permission))
            .map((i) => (
              <SheetItem key={i.label} icon={i.icon} label={i.label} sub={i.sub} onClick={i.go} />
            ))}
        </SheetBody>
        <SheetCloseFooter onClose={onClose} />
      </SheetContent>
    </Sheet>
  )
}

export function AlertsSheet({
  open,
  alerts,
  onOpen,
  onClose,
}: {
  open: boolean
  alerts: Alert[]
  onOpen: (a: Alert) => void
  onClose: () => void
}) {
  const m = useM()
  const isReceptionist = m.role === "RECEPTIONIST"
  const onCloseAutoFocus = useRestoreTriggerFocus(open)
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        data-gm
        data-receptionist-frame={isReceptionist ? "true" : undefined}
        side="bottom"
        onCloseAutoFocus={onCloseAutoFocus}
        className={sheetContentClass(isReceptionist)}
      >
        <SheetHeader className="px-4 pt-5 pb-2 text-left">
          <SheetTitle className="text-[19px] font-bold tracking-[-0.015em] text-tx-strong">Thông báo</SheetTitle>
          <SheetDescription className="sr-only">Cảnh báo booking và trạng thái bàn trong ca</SheetDescription>
        </SheetHeader>
        <SheetBody className="pb-3">
          {alerts.length ? (
            alerts.map((a) => (
              <button
                key={a.key}
                type="button"
                onClick={() => onOpen(a)}
                className="gm-press-card flex min-h-14 items-start gap-3 rounded-2xl border border-border bg-background px-3.5 py-3 text-left text-tx-1 hover:border-border-strong"
              >
                <span
                  className="grid size-9 shrink-0 place-items-center rounded-xl"
                  style={{ background: `var(--st-${a.tone}-tint)`, color: `var(--st-${a.tone}-ink)` }}
                >
                  <Clock className="size-4" aria-hidden />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[14px] font-semibold text-tx-strong">{a.title}</span>
                  <span className="text-[13px] leading-snug text-[var(--text-muted)]">{a.detail}</span>
                </span>
                <ChevronRight className="mt-1 size-4 shrink-0 text-subtle" aria-hidden />
              </button>
            ))
          ) : (
            <EmptyBox title="Chưa có cảnh báo" body="Chưa có cảnh báo trong ca." />
          )}
        </SheetBody>
        <SheetCloseFooter onClose={onClose} />
      </SheetContent>
    </Sheet>
  )
}

/** Demo user, theme and the pages that are not in the tab bar (Khách, Báo cáo, Cài đặt). */
export function AccountSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, users, theme, setUser, setTheme, principal, permissions, logout } = useSession()
  const navigate = useNavigate()
  const [loggingOut, setLoggingOut] = useState(false)
  const isReceptionist = user.role === "RECEPTIONIST"
  const onCloseAutoFocus = useRestoreTriggerFocus(open)
  const more = NAV.filter((n) => ["/guests", "/reports", "/settings"].includes(n.to)).filter(
    (n) =>
      !n.permission || (api.mode === "http" ? permissions.includes(n.permission) : roleCan(user.role, n.permission)),
  )
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        data-gm
        data-receptionist-frame={isReceptionist ? "true" : undefined}
        side="bottom"
        onCloseAutoFocus={onCloseAutoFocus}
        className={sheetContentClass(isReceptionist)}
      >
        <SheetHeader className="px-4 pt-5 pb-2 text-left">
          <SheetTitle className="text-[19px] font-bold tracking-[-0.015em] text-tx-strong">Tài khoản</SheetTitle>
          <SheetDescription className="sr-only">Chọn giao diện sáng tối, tài khoản và trang mở rộng</SheetDescription>
        </SheetHeader>
        <SheetBody className="gap-3 pb-3">
          <Seg
            label="Giao diện"
            value={theme}
            onChange={setTheme}
            opts={[
              ["light", "Sáng"],
              ["dark", "Tối"],
            ]}
          />
          {/* Bộ đổi vai trò là công cụ của bản mock: nó bấm một phát là thành
              người khác, nên trên bản đã deploy nó vừa vô nghĩa vừa gây hiểu nhầm
              rằng tài khoản thật đổi được vai ngay tại đây. Bản HTTP chỉ hiện khối
              "Phiên đăng nhập" bên dưới, là phiên thật do server cấp. */}
          {api.mode === "mock" ? (
            <div className="flex flex-col gap-1.5">
              <span className="eyebrow px-0.5 pt-1">Đổi vai trò để thử</span>
              <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-background">
                {users.map((u) => {
                  const active = u.id === user.id
                  return (
                    <button
                      key={u.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        setUser(u.id)
                        onClose()
                      }}
                      className={cn(
                        "gm-press-card flex min-h-12 w-full items-center justify-between gap-3 px-4 py-2.5 text-left",
                        active ? "bg-primary-tint" : "bg-background hover:bg-surface-2",
                      )}
                    >
                      <span
                        className={cn(
                          "text-[15px] font-medium",
                          active ? "font-semibold text-primary-ink" : "text-tx-strong",
                        )}
                      >
                        {u.displayName}
                      </span>
                      <span className="flex items-center gap-2 text-[13px] text-[var(--text-muted)]">
                        <span>{ROLE_LABEL[u.role]}</span>
                        {active ? <Check className="size-4 text-primary-ink" aria-hidden /> : null}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}
          {/* Máy lễ tân chạy cả ca trên một tài khoản và trước đây không có chỗ nào
              thoát ra: đăng xuất chỉ có trong menu của bản desktop. */}
          {principal ? (
            <div className="flex flex-col gap-2">
              <span className="eyebrow px-0.5 pt-1">Phiên đăng nhập</span>
              <div className="flex min-h-12 items-center justify-between rounded-2xl border border-border bg-background px-4">
                <span className="min-w-0 truncate text-[15px] font-semibold text-tx-strong">
                  {principal.displayName}
                </span>
                <span className="shrink-0 text-[13px] text-[var(--text-muted)]">{ROLE_LABEL[user.role]}</span>
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={loggingOut}
                onClick={() => {
                  setLoggingOut(true)
                  void logout().finally(() => {
                    setLoggingOut(false)
                    onClose()
                  })
                }}
                className="h-12 w-full justify-start gap-2.5 rounded-2xl border-destructive/40 bg-[var(--destructive-tint)] px-4 text-[15px] font-semibold text-destructive hover:border-destructive/60 hover:bg-[var(--destructive-tint)]"
              >
                <LogOut className="size-4 shrink-0" aria-hidden />
                {loggingOut ? "Đang đăng xuất…" : "Đăng xuất"}
              </Button>
            </div>
          ) : null}
          {more.length ? (
            <div className="flex flex-col gap-1.5">
              <span className="eyebrow px-0.5 pt-1">Trang khác</span>
              <div className="flex flex-col gap-2">
                {more.map((n) => (
                  <SheetItem
                    key={n.to}
                    icon={n.icon}
                    label={n.label}
                    sub="Mở trang đầy đủ"
                    onClick={() => {
                      onClose()
                      navigate(n.to)
                    }}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </SheetBody>
        <SheetCloseFooter onClose={onClose} />
      </SheetContent>
    </Sheet>
  )
}

export function StatusDialog({ r, onClose }: { r: ReservationView | null; onClose: () => void }) {
  const m = useM()
  const a = useMobileActions()
  const isReceptionist = m.role === "RECEPTIONIST"
  const onCloseAutoFocus = useRestoreTriggerFocus(Boolean(r))
  const [cachedR, setCachedR] = useState<ReservationView | null>(r)
  if (r && r !== cachedR) {
    setCachedR(r)
  }
  const activeR = r ?? cachedR

  const close = (fn: () => unknown) => () => {
    onClose()
    void fn()
  }

  const opts: { label: string; dot: string; sub?: string; disabled?: boolean; go: () => void }[] = activeR
    ? (() => {
        const hold = a.bookingPolicy(activeR)
        const canLate =
          hold.canLate &&
          !activeR.lateConfirmedAt &&
          activeR.businessDate === m.today &&
          m.now.getTime() >= activeR.expectedAt.getTime() &&
          m.can("reservation.update")

        if (activeR.status === "BOOKED") {
          return canLate ? [{ label: "Tới muộn", dot: "var(--st-late)", go: close(() => a.confirmLate(activeR)) }] : []
        }
        if (activeR.status === "CHECKED_IN") {
          return [
            { label: "Đổi bàn", dot: "var(--st-reserved)", go: close(() => a.move(activeR)) },
            { label: "Nhả bàn khi khách rời", dot: "var(--st-oos)", go: close(() => a.release(activeR)) },
          ]
        }
        return []
      })()
    : []

  return (
    <Dialog open={Boolean(r)} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        data-gm
        data-receptionist-frame={isReceptionist ? "true" : undefined}
        showCloseButton={false}
        onCloseAutoFocus={onCloseAutoFocus}
        aria-label="Đổi trạng thái booking"
        className="max-w-[min(calc(100%-2rem),400px)] gap-0 overflow-hidden rounded-2xl border-border bg-surface-1 p-0 shadow-[var(--shadow-float)]"
      >
        <DialogHeader className="border-b border-border px-5 pt-5 pb-3.5 text-center sm:text-center">
          <DialogTitle className="text-[17px] font-semibold tracking-[-0.015em] text-tx-strong">
            Đổi trạng thái booking
          </DialogTitle>
          <DialogDescription className="text-[13px] text-[var(--text-muted)]">
            {activeR
              ? `${activeR.displayName}, ${fmtTime12(activeR.expectedAt)}, ${tableText(activeR.tableIds, m.model)}`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col divide-y divide-border">
          {opts.map((o) => (
            <button
              key={o.label}
              type="button"
              onClick={o.go}
              disabled={o.disabled}
              className="gm-press-card flex min-h-[54px] items-center gap-3.5 px-5 py-2.5 text-left text-tx-1 disabled:opacity-45"
            >
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: o.dot }} aria-hidden />
              <span className="flex flex-1 flex-col">
                <span className="text-[15px] font-medium text-tx-strong">{o.label}</span>
                {o.sub ? <span className="text-xs text-subtle">{o.sub}</span> : null}
              </span>
              <ChevronRight className="size-4 shrink-0 text-subtle" aria-hidden />
            </button>
          ))}
          {!opts.length ? (
            <span className="px-5 py-4 text-center text-[14px] text-[var(--text-muted)]">
              Booking đã đóng, không còn thao tác.
            </span>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          onClick={onClose}
          className="h-[52px] w-full rounded-none border-t border-border text-[15px] font-semibold text-primary-ink hover:bg-surface-2"
        >
          Đóng
        </Button>
      </DialogContent>
    </Dialog>
  )
}

export function ConfirmDialog({ c, onClose }: { c: Confirm | null; onClose: () => void }) {
  const m = useM()
  const isReceptionist = m.role === "RECEPTIONIST"
  const onCloseAutoFocus = useRestoreTriggerFocus(Boolean(c))
  const [cachedC, setCachedC] = useState<Confirm | null>(c)
  const [inProgress, setInProgress] = useState(false)

  if (c && c !== cachedC) {
    setCachedC(c)
    if (inProgress) setInProgress(false)
  }

  const active = c ?? cachedC

  return (
    <AlertDialog
      open={Boolean(c)}
      onOpenChange={(next) => {
        if (!next && !inProgress) onClose()
      }}
    >
      <AlertDialogContent
        data-gm
        data-receptionist-frame={isReceptionist ? "true" : undefined}
        size="sm"
        onCloseAutoFocus={onCloseAutoFocus}
        aria-label={active?.title ?? "Xác nhận"}
        className="max-w-[min(calc(100%-2rem),380px)] gap-4 rounded-2xl border-border bg-surface-1 p-5 shadow-[var(--shadow-float)]"
      >
        <AlertDialogHeader>
          <AlertDialogMedia className="size-11 rounded-xl bg-st-late-tint text-st-late-ink">
            <AlertTriangle className="size-5" aria-hidden />
          </AlertDialogMedia>
          <AlertDialogTitle className="text-[17px] font-semibold tracking-[-0.015em] text-tx-strong">
            {active?.title}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-[14px] leading-relaxed text-pretty text-[var(--text-muted)]">
            {active?.body}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="grid grid-cols-2 gap-2.5 pt-1">
          <AlertDialogCancel
            disabled={inProgress}
            onClick={onClose}
            className="h-12 rounded-xl border-border-strong text-[15px] font-medium"
          >
            Quay lại
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={inProgress}
            onClick={(e) => {
              e.preventDefault()
              if (inProgress || !active) return
              setInProgress(true)
              onClose()
              void active.run().finally(() => setInProgress(false))
            }}
            className="h-12 rounded-xl text-[15px] font-semibold"
          >
            {active?.label ?? "Xác nhận"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** 15': light floating banner, never blocks, keeps mounted through exit animation. */
export function Toast15({
  r,
  onView,
  onClose,
}: {
  r: ReservationView | null
  onView: () => void
  onClose: () => void
}) {
  const m = useM()
  const { isOpen, present, markExited } = usePresenceController({ open: Boolean(r) })
  const [cachedR, setCachedR] = useState<ReservationView | null>(r)

  if (r && r !== cachedR) {
    setCachedR(r)
  }

  useEffect(() => {
    if (!isOpen && present && typeof window !== "undefined") {
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
      if (reduced) {
        const id = window.setTimeout(markExited, 150)
        return () => window.clearTimeout(id)
      }
      const fallback = window.setTimeout(markExited, 260)
      return () => window.clearTimeout(fallback)
    }
  }, [isOpen, present, markExited])

  if (!present || !cachedR) return null

  return (
    <div
      role={isOpen ? "status" : undefined}
      aria-hidden={!isOpen || undefined}
      inert={!isOpen}
      data-state={isOpen ? "open" : "closed"}
      onAnimationEnd={() => {
        if (!isOpen) markExited()
      }}
      className="gm-toast-banner gm-glass-chrome absolute inset-x-3 top-[calc(var(--top-safe)+8px)] z-[42] flex items-center gap-2.5 rounded-2xl border border-border bg-[var(--glass)] py-2 pr-1.5 pl-3 shadow-[var(--shadow-float)] backdrop-blur-md"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-st-late-tint text-st-late-ink">
        <Clock className="size-[17px]" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[14px] leading-snug font-semibold text-tx-strong">
          {cachedR.displayName} đã trễ {m.th.late} phút
        </span>
        <span className="tnum truncate text-[12.5px] text-[var(--text-muted)]">
          {cachedR.partySize} khách · {tableText(cachedR.tableIds, m.model)} · hẹn {fmtTime12(cachedR.expectedAt)}
        </span>
      </span>
      <button
        type="button"
        onClick={onView}
        className="gm-press h-11 shrink-0 rounded-xl px-3 text-[14px] font-semibold text-primary-ink hover:bg-primary-tint"
      >
        Xem
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label="Đóng thông báo"
        className="gm-press grid size-11 shrink-0 place-items-center rounded-xl text-subtle hover:bg-surface-2 hover:text-tx-1"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  )
}

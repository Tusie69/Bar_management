/**
 * Mobile Reception & Phone Shell (< 768px + RECEPTIONIST tablet/desktop frame).
 * Tabs map to the existing routes, so deep links keep working:
 *   /home Tiếp đón (Lễ tân) or Tổng quan (Chủ quán) · /reservations Danh sách · /floor Sơ đồ · /waitlist Đơn chờ.
 * Other routes (Khách, Báo cáo, Cài đặt) render their Desktop page inside this shell.
 */
import { Clock4, LayoutDashboard, List, ListOrdered, Map as MapIcon, Plus, type LucideIcon } from "lucide-react"
import { Suspense, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { Outlet, useLocation, useNavigate } from "react-router"
import type { ReservationView } from "@/domain/models"
import { useBusinessShift, useNow, useReservations, useWaitlist } from "@/hooks/use-data"
import { prewarmMotionController } from "@/lib/motion"
import { businessDateOf, shiftHour, type BusinessDate } from "@/lib/time"
import { cn } from "@/lib/utils"
import { useSession } from "@/state/session"
import { roleCan } from "@/domain/access"
import { api } from "@/services"
import { useUi } from "@/state/ui"
import { toast } from "sonner"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { NAV } from "@/app/nav"
import { useShiftAlerts, type Alert } from "../floor/alerts"
import { GuestCountSheet } from "../floor/guest-count-card"
import { useFloorModel } from "../floor/use-floor-model"
import { isWaitingForTable } from "../floor/reception-rules"
import {
  MobileContext,
  type CancelBookingRequest,
  type Confirm,
  type FormRequest,
  type MobileCtx,
  type TablePick,
  type Tab,
} from "./context"
import { CancelBookingDialog } from "./cancel-booking-dialog"
import { DetailScreen } from "./detail"
import { FormScreen } from "./form"
import { HomeScreen } from "./home"
import { ListScreen } from "./list"
import { MapScreen, TableSheet } from "./map"
import { isOpenEntry } from "./model"
import { notificationTarget } from "./notification-target"
import { useRestoreTriggerFocus } from "./overlay-focus"
import { AccountSheet, AlertsSheet, ConfirmDialog, CreateSheet, StatusDialog, Toast15 } from "./overlays"
import { useSeenKeys } from "./seen-keys"
import { PlainHeader } from "./ui"
import { EntryDetailScreen, WaitScreen } from "./wait"
import "./mobile.css"

/** Khoá localStorage cho cảnh báo đã xem (chuông) và toast "tới muộn" đã xử lý. */
const SEEN_STORAGE_KEY = "21gam.mobile.alerts.seen.v1"
const HANDLED_STORAGE_KEY = "21gam.mobile.alerts.handled.v1"

const PATH: Record<Tab, string> = { home: "/home", list: "/reservations", map: "/floor", wait: "/waitlist" }
const TAB_OF: Record<string, Tab> = { "/home": "home", "/reservations": "list", "/floor": "map", "/waitlist": "wait" }

function FullScreenPresence({
  open,
  label,
  isReceptionist,
  onClose,
  onRequestClose,
  children,
}: {
  open: boolean
  label: string
  isReceptionist: boolean
  onClose: () => void
  onRequestClose?: () => void
  children: ReactNode
}) {
  const focus = useRestoreTriggerFocus(open)

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) (onRequestClose ?? onClose)()
      }}
    >
      <SheetContent
        data-gm
        data-gm-overlay-id={focus.overlayId}
        data-receptionist-frame={isReceptionist ? "true" : undefined}
        side="right"
        showCloseButton={false}
        aria-label={label}
        inert={!open || undefined}
        onCloseAutoFocus={focus.onCloseAutoFocus}
        className={cn(
          "inset-x-0 top-0 bottom-[var(--kb-inset,0px)] h-auto w-full max-w-none gap-0 overflow-hidden rounded-none border-0 bg-background p-0 shadow-none sm:max-w-none",
          isReceptionist &&
            "mx-auto max-w-[var(--gm-max-w)] md:border-x md:border-border/70 md:shadow-[var(--shadow-float)]",
        )}
      >
        <SheetTitle className="sr-only">{label}</SheetTitle>
        <SheetDescription className="sr-only">{label}</SheetDescription>
        {children}
      </SheetContent>
    </Sheet>
  )
}

export default function MobileApp() {
  const loc = useLocation()
  const navigate = useNavigate()
  const tab: Tab | null = TAB_OF[loc.pathname] ?? null
  const role = useSession((s) => s.user.role)
  const permissions = useSession((s) => s.permissions)
  const isOwner = role === "OWNER"
  const isReceptionist = role === "RECEPTIONIST"
  const ui = useUi()
  const now = useNow(15_000)
  // TU-38: mốc cắt ca lấy từ cấu hình địa điểm, không mặc định 05:00.
  const shiftCutoff = shiftHour(useBusinessShift().cutoffLocal)
  const today = businessDateOf(now, shiftCutoff)
  const selectedDate = isReceptionist && ui.floorMode !== "live" ? ui.availDate : today
  const model = useFloorModel(selectedDate)
  const reservations = useReservations(selectedDate).data
  const waitlistQuery = useWaitlist(selectedDate)
  const waitlist = waitlistQuery.isPlaceholderData ? undefined : waitlistQuery.data
  const venue = model.catalog?.venue
  const th = { late: venue?.lateWarningMinutes ?? 15, noshow: venue?.noShowWarningMinutes ?? 30 }

  const [overlay, setOverlay] = useState<null | "create" | "alerts" | "account" | "wait" | "count" | "count-edit">(null)
  const [statusFor, setStatusFor] = useState<ReservationView | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [cancelReq, setCancelReq] = useState<CancelBookingRequest | null>(null)
  const [detail, setDetail] = useState<{ id: number; bd: BusinessDate } | null>(null)
  const [entryDetail, setEntryDetail] = useState<{ id: number; bd: BusinessDate } | null>(null)
  const [form, setForm] = useState<FormRequest | null>(null)
  const [tableSel, setTableSel] = useState<number | null>(null)
  const [pick, setPick] = useState<TablePick | null>(null)
  const [pickSel, setPickSel] = useState<number[]>([])
  const [pickBusy, setPickBusy] = useState(false)
  const [seen, markSeen] = useSeenKeys(SEEN_STORAGE_KEY, selectedDate)
  const [handled, markHandled] = useSeenKeys(HANDLED_STORAGE_KEY, selectedDate)

  // Retain last payload during right-edge slide-out exit
  const [cachedDetail, setCachedDetail] = useState(detail)
  if (detail && detail !== cachedDetail) setCachedDetail(detail)
  const [cachedEntryDetail, setCachedEntryDetail] = useState(entryDetail)
  if (entryDetail && entryDetail !== cachedEntryDetail) setCachedEntryDetail(entryDetail)
  const [cachedForm, setCachedForm] = useState(form)
  if (form && form !== cachedForm) setCachedForm(form)

  const booked = useMemo(() => (reservations ?? []).filter((r) => r.status === "BOOKED"), [reservations])
  const alerts = useShiftAlerts(model, booked, now)
  const unread = alerts.filter((a) => !seen.has(a.key)).length
  const handle = (key: string) => markHandled([key])
  const toast15 = booked.find((r) => r.warning === "late" && !handled.has(`l${r.id}`)) ?? null
  const busy = !!(overlay || statusFor || confirm || cancelReq || detail || entryDetail || form || pick || ui.draft)
  const keyboardSafeHeight = useKeyboardSafeHeight()

  const shellContentRef = useRef<HTMLDivElement>(null)
  const bottomNavRef = useRef<HTMLElement>(null)
  const formRequestCloseRef = useRef<(() => void) | null>(null)
  const waitFocus = useRestoreTriggerFocus(overlay === "wait")
  const hasFullScreenModal = Boolean(detail || entryDetail || form)

  useEffect(() => {
    if (shellContentRef.current) shellContentRef.current.inert = hasFullScreenModal
    if (bottomNavRef.current) bottomNavRef.current.inert = hasFullScreenModal
  }, [hasFullScreenModal])

  // Role switch resets to the role's home, like a fresh login.
  useEffect(() => {
    setOverlay(null)
    setDetail(null)
    setEntryDetail(null)
    setForm(null)
    setPick(null)
    setTableSel(null)
    const { draft, closeBooking, closeWalkIn } = useUi.getState()
    if (draft) (draft.kind === "booking" ? closeBooking : closeWalkIn)()
  }, [role])

  // Escape closes the top non-Radix layer (Radix Dialog/Sheet/AlertDialog manage their own Escape).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return
      if (statusFor || confirm || cancelReq || overlay || detail || entryDetail || form) return
      if (tableSel) setTableSel(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [statusFor, overlay, confirm, cancelReq, detail, entryDetail, form, tableSel])

  // Ensure any focused input inside a mobile sheet or modal stays scrolled above virtual keyboard
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target
      if (!(target instanceof HTMLElement)) return
      if (!target.matches("input, textarea, select")) return
      if (!target.closest("[data-gm]")) return
      window.setTimeout(() => {
        const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
        target.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" })
      }, 60)
    }
    document.addEventListener("focusin", onFocusIn)
    return () => document.removeEventListener("focusin", onFocusIn)
  }, [])

  const go = (t: Tab) => {
    if (isReceptionist && t === "wait") {
      setOverlay("wait")
      return
    }
    setOverlay(null)
    if (t !== "map") setTableSel(null)
    if (PATH[t] !== loc.pathname) navigate(PATH[t])
  }

  const openAlertDetail = (alert: Alert) => {
    setOverlay(null)
    const target = notificationTarget(alert.tableId, alert.reservationId, selectedDate)
    if (target?.kind === "table") ctx.openTable(target.tableId)
    else if (target?.kind === "reservation") setDetail({ id: target.reservationId, bd: target.businessDate })
  }

  const ctx: MobileCtx = {
    model,
    now,
    today,
    businessDate: selectedDate,
    role,
    isOwner,
    can: (permission) => (api.mode === "http" ? permissions.includes(permission) : roleCan(role, permission)),
    th,
    reservations,
    waitlist,
    waitlistError: waitlistQuery.error,
    unread,
    go,
    openAlerts: () => {
      if (isReceptionist) return
      markSeen(alerts.map((a) => a.key))
      setOverlay("alerts")
    },
    openAccount: () => setOverlay("account"),
    openCount: () => setOverlay("count"),
    openCountEdit: () => setOverlay("count-edit"),
    openDetail: (id, bd) => {
      setOverlay(null)
      setTableSel(null)
      setEntryDetail(null)
      setDetail({ id, bd })
    },
    openEntryDetail: (id, bd) => {
      setOverlay(null)
      setTableSel(null)
      setDetail(null)
      setEntryDetail({ id, bd })
    },
    openStatus: (r) => setStatusFor(reservations?.find((x) => x.id === r.id) ?? r),
    openForm: (f) => {
      if (f.mode === "walkin" && (f.date ?? selectedDate) !== today) {
        toast.info("Walk-in chỉ áp dụng cho ngày kinh doanh hiện tại.")
        return
      }
      setOverlay(null)
      setTableSel(null)
      if (isReceptionist) {
        if (f.mode === "walkin") ui.openWalkIn(f.tableIds)
        else ui.openBooking({ tableIds: f.tableIds, date: f.date ?? selectedDate, toWaitlist: f.toWaitlist })
        return
      }
      setForm({ ...f, date: f.date ?? selectedDate })
    },
    openTable: (id) => {
      setDetail(null)
      setEntryDetail(null)
      setTableSel(id)
      go("map")
    },
    ask: (c) => {
      setStatusFor(null)
      setConfirm(c)
    },
    askCancel: (req) => {
      if (!isReceptionist) return
      setStatusFor(null)
      setCancelReq(req)
    },
    startPick: (p) => {
      setDetail(null)
      setEntryDetail(null)
      setStatusFor(null)
      setTableSel(null)
      setPickSel(p.preselected ?? [])
      setPick(p)
      go("map")
    },
  }

  const titleOf = tab
    ? { home: isOwner ? "Tổng quan" : "Tiếp đón", list: "Danh sách", map: "Sơ đồ bàn", wait: "Đơn chờ" }[tab]
    : ""
  const other = NAV.find((n) => loc.pathname.startsWith(n.to))
  const tableSheetSuperseded = Boolean(detail || entryDetail || form || ui.draft || ui.pick?.intent === "layout")

  return (
    <MobileContext.Provider value={ctx}>
      <div
        data-gm
        style={
          {
            ...(isReceptionist ? { "--nav-h": "0px" } : {}),
            ...(keyboardSafeHeight ? { height: keyboardSafeHeight } : {}),
          } as CSSProperties
        }
        className={cn(
          "gm-shell-viewport fixed inset-x-0 top-0 w-full touch-manipulation overflow-hidden",
          isReceptionist &&
            "mx-auto max-w-[var(--gm-max-w)] md:border-x md:border-border/70 md:shadow-[var(--shadow-float)]",
        )}
      >
        <div
          ref={shellContentRef}
          aria-hidden={hasFullScreenModal || undefined}
          className="absolute inset-x-0 top-0 bottom-[var(--nav-h)] flex flex-col overflow-hidden"
        >
          {tab === "home" ? (
            <HomeScreen />
          ) : tab === "list" ? (
            <ListScreen />
          ) : tab === "map" ? (
            <MapScreen
              selected={tableSel}
              onSelect={(id) => {
                setTableSel(id)
              }}
              pick={pick}
              pickSel={pickSel}
              onPickToggle={(id) =>
                setPickSel((s) =>
                  pick?.multi ? (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]) : s[0] === id ? [] : [id],
                )
              }
              onPickCancel={() => setPick(null)}
              onPickConfirm={async () => {
                if (!pick) return
                setPickBusy(true)
                const ok = await pick.onConfirm(pickSel)
                setPickBusy(false)
                if (ok) setPick(null)
              }}
              pickBusy={pickBusy}
              keyboardSafeHeight={keyboardSafeHeight}
            />
          ) : tab === "wait" ? (
            <WaitScreen />
          ) : (
            <>
              <PlainHeader title={other?.label ?? "21GAM"} />
              <div className="min-h-0 flex-1 overflow-y-auto">
                <Suspense fallback={null}>
                  <Outlet />
                </Suspense>
              </div>
            </>
          )}
        </div>

        {!isReceptionist ? (
          <BottomNav
            navRef={bottomNavRef}
            hidden={hasFullScreenModal}
            tab={tab}
            isOwner={isOwner}
            waitBadge={(waitlist ?? []).filter(isOpenEntry).length}
            onCreate={() => setOverlay("create")}
            go={go}
          />
        ) : null}

        {tab === "map" ? (
          <TableSheet id={tableSel} superseded={tableSheetSuperseded} onClose={() => setTableSel(null)} />
        ) : null}

        <FullScreenPresence
          open={Boolean(detail)}
          label="Chi tiết booking"
          isReceptionist={isReceptionist}
          onClose={() => setDetail(null)}
        >
          {cachedDetail ? (
            <DetailScreen
              id={cachedDetail.id}
              bd={cachedDetail.bd}
              backLabel={titleOf || "Quay lại"}
              onClose={() => setDetail(null)}
            />
          ) : null}
        </FullScreenPresence>

        <FullScreenPresence
          open={Boolean(entryDetail)}
          label="Chi tiết mục chờ"
          isReceptionist={isReceptionist}
          onClose={() => setEntryDetail(null)}
        >
          {cachedEntryDetail ? (
            <EntryDetailScreen
              id={cachedEntryDetail.id}
              bd={cachedEntryDetail.bd}
              backLabel={titleOf || "Quay lại"}
              onClose={() => setEntryDetail(null)}
            />
          ) : null}
        </FullScreenPresence>

        <FullScreenPresence
          open={Boolean(form)}
          label={cachedForm?.mode === "walkin" ? "Mở bàn Walk-in" : "Tạo đơn đặt bàn"}
          isReceptionist={isReceptionist}
          onClose={() => setForm(null)}
          onRequestClose={() => (formRequestCloseRef.current ? formRequestCloseRef.current() : setForm(null))}
        >
          {cachedForm ? (
            <FormScreen
              req={cachedForm}
              parentOpen={Boolean(form)}
              requestCloseRef={formRequestCloseRef}
              onClose={() => setForm(null)}
            />
          ) : null}
        </FullScreenPresence>

        <Toast15
          r={toast15 && !busy ? toast15 : null}
          onView={() => {
            if (!toast15) return
            handle(`l${toast15.id}`)
            const target = notificationTarget(toast15.tableIds[0], toast15.id, toast15.businessDate)
            if (target?.kind === "table") ctx.openTable(target.tableId)
            else if (target?.kind === "reservation") setDetail({ id: target.reservationId, bd: target.businessDate })
          }}
          onClose={() => {
            if (toast15) handle(`l${toast15.id}`)
          }}
        />

        <CreateSheet open={overlay === "create"} onClose={() => setOverlay(null)} />
        <AccountSheet
          open={overlay === "account"}
          onClose={() => setOverlay(null)}
          alerts={alerts}
          onOpenNotifications={() => {
            if (unread) markSeen(alerts.map((a) => a.key))
          }}
          onOpenAlert={openAlertDetail}
        />
        <GuestCountSheet
          businessDate={selectedDate}
          open={overlay === "count" || overlay === "count-edit"}
          initialMode={overlay === "count-edit" ? "edit" : "view"}
          onClose={() => setOverlay(null)}
          isReceptionist={isReceptionist}
        />
        <Sheet open={overlay === "wait"} onOpenChange={(open) => !open && setOverlay(null)}>
          <SheetContent
            data-gm
            data-gm-overlay-id={waitFocus.overlayId}
            data-receptionist-frame={isReceptionist ? "true" : undefined}
            side="bottom"
            onCloseAutoFocus={waitFocus.onCloseAutoFocus}
            className={cn(
              "h-[85dvh] w-full gap-0 overflow-hidden rounded-t-[20px] border-t border-border bg-surface-1 p-0 shadow-[var(--shadow-float)]",
              isReceptionist && "mx-auto max-w-[var(--gm-max-w)]",
            )}
          >
            <SheetHeader className="px-4 pt-5 pb-2 text-left">
              <SheetTitle className="text-[19px] font-bold tracking-[-0.015em] text-tx-strong">
                Bàn chờ ảo{" "}
                <span aria-hidden className="tnum font-semibold text-[var(--text-muted)]">
                  ({(waitlist ?? []).filter(isWaitingForTable).length})
                </span>
              </SheetTitle>
              <SheetDescription className="text-xs text-[var(--text-muted)]">
                Ai đặt trước nằm trên. Chưa giữ bàn thật.
              </SheetDescription>
            </SheetHeader>
            <WaitScreen embedded />
          </SheetContent>
        </Sheet>
        {!isReceptionist ? (
          <AlertsSheet
            open={overlay === "alerts"}
            alerts={alerts}
            onClose={() => setOverlay(null)}
            onOpen={openAlertDetail}
          />
        ) : null}
        <StatusDialog r={statusFor} onClose={() => setStatusFor(null)} />
        <ConfirmDialog c={confirm} onClose={() => setConfirm(null)} />
        {isReceptionist ? <CancelBookingDialog req={cancelReq} onClose={() => setCancelReq(null)} /> : null}
      </div>
    </MobileContext.Provider>
  )
}

/** Keeps both shell height and portaled sheet `--kb-inset` synchronized with visualViewport. */
export function useKeyboardSafeHeight() {
  const [height, setHeight] = useState<number | null>(null)
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const update = () => {
      const shrunk = viewport.scale === 1 && viewport.height < window.innerHeight - 1
      setHeight(shrunk ? viewport.height : null)
      const inset = shrunk ? Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop)) : 0
      document.documentElement.style.setProperty("--kb-inset", `${inset}px`)
      if (shrunk) {
        const active = document.activeElement
        if (active instanceof HTMLElement && active.matches("input, textarea, select") && active.closest("[data-gm]")) {
          window.requestAnimationFrame(() => {
            active.scrollIntoView({ block: "nearest", behavior: "auto" })
          })
        }
      }
    }
    viewport.addEventListener("resize", update)
    viewport.addEventListener("scroll", update)
    return () => {
      viewport.removeEventListener("resize", update)
      viewport.removeEventListener("scroll", update)
      document.documentElement.style.removeProperty("--kb-inset")
    }
  }, [])
  return height
}

interface NavItem {
  tab: Tab
  label: string
  icon: LucideIcon
  badge?: number
}

function BottomNav({
  navRef,
  hidden,
  tab,
  isOwner,
  waitBadge,
  onCreate,
  go,
}: {
  navRef: React.RefObject<HTMLElement | null>
  hidden: boolean
  tab: Tab | null
  isOwner: boolean
  waitBadge: number
  onCreate: () => void
  go: (t: Tab) => void
}) {
  const left: NavItem[] = [
    { tab: "home", label: isOwner ? "Tổng quan" : "Tiếp đón", icon: isOwner ? LayoutDashboard : Clock4 },
    { tab: "list", label: "Danh sách", icon: List },
  ]
  const right: NavItem[] = [
    { tab: "map", label: "Sơ đồ", icon: MapIcon },
    { tab: "wait", label: "Đơn chờ", icon: ListOrdered, badge: waitBadge },
  ]
  const item = (n: NavItem) => {
    const on = tab === n.tab
    return (
      <button
        key={n.tab}
        type="button"
        onClick={() => go(n.tab)}
        aria-current={on ? "page" : undefined}
        aria-label={n.badge ? `${n.label}, ${n.badge} đang chờ` : n.label}
        className={cn(
          "gm-press relative flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[11px]",
          on ? "font-semibold text-primary-ink" : "font-medium text-tx-2 hover:text-tx-1",
        )}
      >
        <n.icon className="size-[22px]" strokeWidth={on ? 2.2 : 1.75} aria-hidden />
        <span>{n.label}</span>
        {n.badge ? (
          <span className="tnum absolute top-1 left-[calc(50%+7px)] h-4 min-w-4 rounded-full bg-tx-strong px-1 text-[10px] leading-4 font-semibold text-background">
            {n.badge}
          </span>
        ) : null}
      </button>
    )
  }
  return (
    <nav
      ref={navRef}
      aria-hidden={hidden || undefined}
      aria-label="Điều hướng chính"
      className="gm-glass-chrome absolute inset-x-0 bottom-0 z-[30] grid h-[var(--nav-h)] grid-cols-5 items-center border-t border-border/70 bg-surface-1/92 px-1.5 pb-[var(--bottom-safe)] backdrop-blur-md"
    >
      {left.map(item)}
      <div className="relative z-[31] grid place-items-center">
        <button
          type="button"
          onClick={onCreate}
          onPointerEnter={() => void prewarmMotionController()}
          onPointerDown={() => void prewarmMotionController()}
          aria-label="Tạo mới"
          aria-haspopup="dialog"
          className="gm-press -mt-5 grid size-14 place-items-center rounded-full border-4 border-surface-1 bg-primary text-primary-foreground shadow-[var(--shadow-soft)] hover:bg-[var(--primary-hover)]"
        >
          <Plus className="size-[25px]" strokeWidth={2.25} aria-hidden />
        </button>
      </div>
      {right.map(item)}
    </nav>
  )
}

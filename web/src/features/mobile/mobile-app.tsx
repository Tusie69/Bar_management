/**
 * Mobile V1 (< 768px): its own shell, not a squeezed Desktop. Built from "GAM Mobile V1" round 2.
 * Tabs map to the existing routes, so deep links keep working:
 *   /home Tiếp đón (Lễ tân) or Tổng quan (Chủ quán) · /reservations Danh sách · /floor Sơ đồ · /waitlist Đơn chờ.
 * Other routes (Khách, Báo cáo, Cài đặt) render their Desktop page inside this shell.
 */
import { Clock4, LayoutDashboard, List, ListOrdered, Map as MapIcon, Plus, type LucideIcon } from "lucide-react"
import { Suspense, useEffect, useMemo, useState } from "react"
import { Outlet, useLocation, useNavigate } from "react-router"
import type { ReservationView } from "@/domain/models"
import { useNow, useReservations, useWaitlist } from "@/hooks/use-data"
import { businessDateOf, type BusinessDate } from "@/lib/time"
import { cn } from "@/lib/utils"
import { useSession } from "@/state/session"
import { NAV } from "@/app/nav"
import { useShiftAlerts } from "../floor/alerts"
import { useFloorModel } from "../floor/use-floor-model"
import { MobileContext, type Confirm, type FormRequest, type MobileCtx, type TablePick, type Tab } from "./context"
import { DetailScreen } from "./detail"
import { FormScreen } from "./form"
import { HomeScreen } from "./home"
import { ListScreen } from "./list"
import { MapScreen, TableSheet } from "./map"
import { isOpenEntry } from "./model"
import {
  AccountSheet,
  Alert30,
  AlertsSheet,
  ConfirmDialog,
  CreateSheet,
  Scrim,
  StatusDialog,
  Toast15,
} from "./overlays"
import { PlainHeader } from "./ui"
import { WaitScreen } from "./wait"
import "./mobile.css"

const PATH: Record<Tab, string> = { home: "/home", list: "/reservations", map: "/floor", wait: "/waitlist" }
const TAB_OF: Record<string, Tab> = { "/home": "home", "/reservations": "list", "/floor": "map", "/waitlist": "wait" }

export default function MobileApp() {
  const loc = useLocation()
  const navigate = useNavigate()
  const tab: Tab | null = TAB_OF[loc.pathname] ?? null
  const role = useSession((s) => s.user.role)
  const isOwner = role === "OWNER_ADMIN"
  const model = useFloorModel()
  const now = useNow(15_000)
  const today = model.floor?.businessDate ?? businessDateOf(now)
  const reservations = useReservations(today).data
  const waitlistQuery = useWaitlist(today)
  const waitlist = waitlistQuery.data
  const venue = model.catalog?.venue
  const th = { late: venue?.lateWarningMinutes ?? 15, noshow: venue?.noShowWarningMinutes ?? 30 }

  const [overlay, setOverlay] = useState<null | "create" | "alerts" | "account">(null)
  const [statusFor, setStatusFor] = useState<ReservationView | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [detail, setDetail] = useState<{ id: number; bd: BusinessDate } | null>(null)
  const [form, setForm] = useState<FormRequest | null>(null)
  const [tableSel, setTableSel] = useState<number | null>(null)
  const [pick, setPick] = useState<TablePick | null>(null)
  const [pickSel, setPickSel] = useState<number[]>([])
  const [pickBusy, setPickBusy] = useState(false)
  const [seen, setSeen] = useState<Set<string>>(() => new Set())
  const [handled, setHandled] = useState<Set<string>>(() => new Set())

  const booked = useMemo(() => (reservations ?? []).filter((r) => r.status === "BOOKED"), [reservations])
  const alerts = useShiftAlerts(model, booked, now)
  const unread = alerts.filter((a) => !seen.has(a.key)).length
  const handle = (key: string) => setHandled((s) => new Set(s).add(key))
  const alert30 = booked.find((r) => r.warning === "noshow" && !handled.has(`n${r.id}`)) ?? null
  const toast15 = booked.find((r) => r.warning === "late" && !handled.has(`l${r.id}`)) ?? null
  const busy = !!(overlay || statusFor || confirm || detail || form || pick)

  // Role switch resets to the role's home, like a fresh login.
  useEffect(() => {
    setOverlay(null)
    setDetail(null)
    setForm(null)
    setPick(null)
    setTableSel(null)
  }, [role])

  // Escape closes the top layer. The 30' alert and confirmations need an explicit choice.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      if (statusFor) setStatusFor(null)
      else if (overlay) setOverlay(null)
      else if (tableSel) setTableSel(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [statusFor, overlay, tableSel])

  const go = (t: Tab) => {
    setOverlay(null)
    if (t !== "map") setTableSel(null)
    if (PATH[t] !== loc.pathname) navigate(PATH[t])
  }

  const ctx: MobileCtx = {
    model,
    now,
    today,
    role,
    isOwner,
    th,
    reservations,
    waitlist,
    waitlistError: waitlistQuery.error,
    unread,
    go,
    openAlerts: () => {
      setSeen(new Set(alerts.map((a) => a.key)))
      setOverlay("alerts")
    },
    openAccount: () => setOverlay("account"),
    openDetail: (id, bd) => {
      setOverlay(null)
      setDetail({ id, bd })
    },
    openStatus: (r) => setStatusFor(reservations?.find((x) => x.id === r.id) ?? r),
    openForm: (f) => {
      setOverlay(null)
      setTableSel(null)
      setForm(f)
    },
    openTable: (id) => {
      setDetail(null)
      setTableSel(id)
      go("map")
    },
    ask: (c) => {
      setStatusFor(null)
      setConfirm(c)
    },
    startPick: (p) => {
      setDetail(null)
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

  return (
    <MobileContext.Provider value={ctx}>
      <div data-gm className="fixed inset-0 h-dvh w-full touch-manipulation overflow-hidden">
        <div className="absolute inset-x-0 top-0 bottom-[var(--nav-h)] flex flex-col overflow-hidden">
          {tab === "home" ? (
            <HomeScreen />
          ) : tab === "list" ? (
            <ListScreen />
          ) : tab === "map" ? (
            <MapScreen
              selected={tableSel}
              onSelect={setTableSel}
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

        <BottomNav
          tab={tab}
          isOwner={isOwner}
          waitBadge={(waitlist ?? []).filter(isOpenEntry).length}
          onCreate={() => setOverlay("create")}
          go={go}
        />

        {tab === "map" && tableSel && !pick && !detail && !form ? (
          <TableSheet id={tableSel} onClose={() => setTableSel(null)} />
        ) : null}
        {detail ? (
          <DetailScreen
            id={detail.id}
            bd={detail.bd}
            backLabel={titleOf || "Quay lại"}
            onClose={() => setDetail(null)}
          />
        ) : null}
        {form ? <FormScreen req={form} onClose={() => setForm(null)} /> : null}

        {toast15 && !alert30 && !busy ? (
          <Toast15
            r={toast15}
            onView={() => {
              handle(`l${toast15.id}`)
              setDetail({ id: toast15.id, bd: toast15.businessDate })
            }}
            onClose={() => handle(`l${toast15.id}`)}
          />
        ) : null}

        {overlay || statusFor || confirm || (alert30 && !busy) ? (
          <Scrim
            onClick={() => {
              if (confirm || (alert30 && !overlay && !statusFor)) return
              setStatusFor(null)
              setOverlay(null)
            }}
          />
        ) : null}
        {overlay === "create" ? <CreateSheet onClose={() => setOverlay(null)} /> : null}
        {overlay === "account" ? <AccountSheet onClose={() => setOverlay(null)} /> : null}
        {overlay === "alerts" ? (
          <AlertsSheet
            alerts={alerts}
            onClose={() => setOverlay(null)}
            onOpen={(a) => {
              setOverlay(null)
              if (a.reservationId) setDetail({ id: a.reservationId, bd: today })
              else if (a.tableId) ctx.openTable(a.tableId)
            }}
          />
        ) : null}
        {statusFor ? <StatusDialog r={statusFor} onClose={() => setStatusFor(null)} /> : null}
        {confirm ? <ConfirmDialog c={confirm} onClose={() => setConfirm(null)} /> : null}
        {alert30 && !busy ? (
          <Alert30
            r={alert30}
            onAck={() => {
              handle(`n${alert30.id}`)
              handle(`l${alert30.id}`)
            }}
          />
        ) : null}
      </div>
    </MobileContext.Provider>
  )
}

interface NavItem {
  tab: Tab
  label: string
  icon: LucideIcon
  badge?: number
}

function BottomNav({
  tab,
  isOwner,
  waitBadge,
  onCreate,
  go,
}: {
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
          "relative flex h-14 flex-col items-center justify-center gap-[3px] rounded-[14px] text-[11px]",
          on ? "font-semibold text-primary-ink" : "font-normal text-tx-2",
        )}
      >
        <n.icon className="size-6" strokeWidth={on ? 2.1 : 1.7} />
        {n.label}
        {n.badge ? (
          <span className="absolute top-1 left-[calc(50%+6px)] h-4 min-w-4 rounded-full bg-tx-strong px-1 text-[10px] leading-4 font-semibold text-background">
            {n.badge}
          </span>
        ) : null}
      </button>
    )
  }
  return (
    <nav
      aria-label="Điều hướng chính"
      className="fixed inset-x-0 bottom-0 z-[30] grid h-[var(--nav-h)] grid-cols-5 items-start border-t border-border bg-surface-1 px-1.5 pb-[env(safe-area-inset-bottom)]"
    >
      {left.map(item)}
      <div className="relative z-[31] grid place-items-center">
        <button
          type="button"
          onClick={onCreate}
          aria-label="Tạo mới"
          aria-haspopup="dialog"
          className="-mt-[22px] grid size-14 place-items-center rounded-full border-4 border-surface-1 bg-primary text-primary-foreground shadow-[var(--shadow-soft)] active:brightness-90"
        >
          <Plus className="size-[26px]" strokeWidth={2.2} />
        </button>
      </div>
      {right.map(item)}
    </nav>
  )
}

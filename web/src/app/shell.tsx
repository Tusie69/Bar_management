import {
  Bell,
  ChevronDown,
  ChevronsUpDown,
  Clock4,
  FastForward,
  Menu,
  Moon,
  MonitorSmartphone,
  Redo2,
  RotateCcw,
  Sun,
  Undo2,
  Unplug,
  UserRound,
  X,
  Zap,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { NavLink, Outlet, useLocation, useNavigate } from "react-router"
import { toast } from "sonner"
import { Kbd } from "@/components/common"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { roleCan } from "@/domain/access"
import { ROLE_LABEL } from "@/domain/enums"
import { reportError, undoOperation, MOCK_NOTE } from "@/hooks/use-action"
import { useNow, useOverview, useReservations } from "@/hooks/use-data"
import { businessDateOf, fmtBusinessDate, fmtTime } from "@/lib/time"
import { cn } from "@/lib/utils"
import { api, clock, demo } from "@/services"
import { useSession } from "@/state/session"
import { useUi } from "@/state/ui"
import { useShiftAlerts } from "@/features/floor/alerts"
import { useFloorModel } from "@/features/floor/use-floor-model"
import { WalkInSheet } from "@/features/floor/walk-in-sheet"
import { BookingSheet } from "@/features/reservations/booking-sheet"
import { ReservationDetailSheet } from "@/features/reservations/reservation-detail"
import { NAV } from "./nav"

export function AppShell() {
  // v2: on Điều phối the booking / walk-in forms live inline in the right column (quick-form.tsx).
  const onFloor = useLocation().pathname.startsWith("/floor")
  return (
    <SidebarProvider defaultOpen={false} className="h-dvh min-h-0">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="min-h-0 flex-1 overflow-hidden pb-[calc(64px+env(safe-area-inset-bottom))] md:pb-0">
          <Outlet />
        </main>
      </div>
      <MobileNav />
      {onFloor ? null : <BookingSheet />}
      {onFloor ? null : <WalkInSheet />}
      <ReservationDetailSheet />
    </SidebarProvider>
  )
}

function Wordmark() {
  return (
    <span className="flex items-center gap-3">
      <img src="/21gam-logo.png" alt="21GAM" className="size-8 shrink-0 rounded-sm object-cover" />
      <span className="text-sm font-medium tracking-[0.04em] whitespace-nowrap text-brand group-data-[collapsible=icon]:hidden">
        21GAM
      </span>
    </span>
  )
}

function AppSidebar() {
  const user = useSession((s) => s.user)
  const overview = useOverview()
  const { setOpenMobile } = useSidebar()
  const location = useLocation()
  const badges: Record<string, number | undefined> = {
    "/floor": overview.data?.attention || undefined,
    "/waitlist": overview.data ? overview.data.waitlistAdvance + overview.data.waitlistWalkIn || undefined : undefined,
  }
  return (
    <Sidebar collapsible="icon" className="border-r">
      <SidebarHeader className="h-14 justify-center border-b px-4 group-data-[collapsible=icon]:px-4">
        <Wordmark />
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label="Điều hướng chính">
          <SidebarGroup className="p-3">
            <SidebarMenu className="gap-1">
              {NAV.filter((n) => !n.permission || roleCan(user.role, n.permission)).map((item) => (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    asChild
                    isActive={location.pathname.startsWith(item.to)}
                    tooltip={item.label}
                    className="h-10 gap-3 px-2.5 text-tx-2 hover:bg-surface-2 hover:text-tx-1 data-[active=true]:bg-surface-2 data-[active=true]:font-medium data-[active=true]:text-tx-1 data-[active=true]:shadow-[inset_2px_0_0_var(--primary)] [&>svg]:size-5 data-[active=true]:[&>svg]:text-primary-ink"
                  >
                    <NavLink to={item.to} onClick={() => setOpenMobile(false)}>
                      <item.icon />
                      <span>{item.label}</span>
                    </NavLink>
                  </SidebarMenuButton>
                  {badges[item.to] ? (
                    <SidebarMenuBadge className="tnum group-data-[collapsible=icon]:top-0.5 group-data-[collapsible=icon]:right-0.5 group-data-[collapsible=icon]:flex! group-data-[collapsible=icon]:h-4 group-data-[collapsible=icon]:min-w-4 group-data-[collapsible=icon]:rounded-full group-data-[collapsible=icon]:bg-st-noshow group-data-[collapsible=icon]:px-1 group-data-[collapsible=icon]:text-[11px] group-data-[collapsible=icon]:text-white">
                      {badges[item.to]}
                    </SidebarMenuBadge>
                  ) : null}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        </nav>
      </SidebarContent>
      <SidebarFooter className="border-t p-3">
        <SidebarCollapseButton />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

function SidebarCollapseButton() {
  const { toggleSidebar, open } = useSidebar()
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          onClick={toggleSidebar}
          tooltip={open ? "Thu gọn thanh bên" : "Mở rộng thanh bên"}
          className="h-10 gap-3 px-2.5 text-tx-2 [&>svg]:size-5"
        >
          <ChevronsUpDown className="rotate-90" />
          <span>Thu gọn</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

function TopBar() {
  const { toggleSidebar } = useSidebar()
  const navigate = useNavigate()
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-background px-3 md:px-4">
      <Button variant="ghost" size="icon" className="md:hidden" aria-label="Mở menu" onClick={toggleSidebar}>
        <Menu />
      </Button>
      <div className="mr-auto flex min-w-0 items-center gap-2">
        <AccountMenu />
        <Button className="hidden h-9 px-3 sm:inline-flex" onClick={() => navigate("/reservations")}>
          Theo dõi đơn đặt bàn
        </Button>
      </div>
      <div className="flex items-center gap-1 md:gap-2">
        <SyncPill />
        <ClockMenu />
        <UndoRedo />
        <ThemeToggle />
        <AlertsBell />
        <Identity />
      </div>
    </header>
  )
}

function SyncPill() {
  if (api.mode === "http") {
    return (
      <Badge variant="outline" className="hidden h-7 gap-1.5 px-2.5 sm:inline-flex">
        <Zap className="size-3.5" /> Đã kết nối API
      </Badge>
    )
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className="hidden h-7 gap-1.5 border-dashed border-strong px-2.5 text-xs font-normal text-tx-2 sm:inline-flex"
          tabIndex={0}
        >
          <Unplug className="size-3.5" /> Dữ liệu mô phỏng
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">
        Chưa kết nối máy chủ. Mọi thao tác chỉ thay đổi dữ liệu giả trên trình duyệt này; đồng bộ giữa thiết bị là mô
        phỏng.
      </TooltipContent>
    </Tooltip>
  )
}

function ClockMenu() {
  const now = useNow(1000)
  const [armed, setArmed] = useState(demo?.conflictArmed ?? false)
  const [busy, setBusy] = useState(false)
  const bd = businessDateOf(now)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className="tnum gap-2 px-2 text-sm font-medium"
          aria-label={`Giờ ${clock.isSimulated ? "mô phỏng" : "thực"} ${fmtTime(now)}. Mở điều khiển thời gian`}
        >
          <Clock4 className="text-muted-foreground" />
          {fmtTime(now)}
          {clock.isSimulated ? <span className="hidden text-xs font-normal text-tx-3 lg:inline">mô phỏng</span> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="grid gap-4">
          <div>
            <p className="eyebrow">Ngày kinh doanh</p>
            <p className="mt-1 font-medium">{fmtBusinessDate(bd)} · 17:00 → 05:00</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {clock.isSimulated
                ? "Đồng hồ mô phỏng bắt đầu lúc 21:30 để thấy cảnh báo 15'/30'."
                : "Đang dùng giờ thật của máy."}
            </p>
          </div>
          {demo ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                <Button variant="outline" size="sm" onClick={() => clock.advance(5)}>
                  <FastForward /> 5'
                </Button>
                <Button variant="outline" size="sm" onClick={() => clock.advance(15)}>
                  <FastForward /> 15'
                </Button>
                <Button variant="outline" size="sm" onClick={() => clock.advance(30)}>
                  <FastForward /> 30'
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="ghost" size="sm" onClick={() => clock.resetToScenario()}>
                  <RotateCcw /> Về 21:30
                </Button>
                <Button variant="ghost" size="sm" onClick={() => clock.useRealTime()}>
                  Giờ thật
                </Button>
              </div>
            </>
          ) : null}
          {demo ? <DemoTools armed={armed} setArmed={setArmed} busy={busy} setBusy={setBusy} /> : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function DemoTools({
  armed,
  setArmed,
  busy,
  setBusy,
}: {
  armed: boolean
  setArmed: (v: boolean) => void
  busy: boolean
  setBusy: (v: boolean) => void
}) {
  const d = demo!
  return (
    <div className="grid gap-2 border-t pt-3">
      <p className="eyebrow flex items-center gap-1.5">
        <MonitorSmartphone className="size-3.5" /> Mô phỏng thiết bị khác
      </p>
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          try {
            toast.info(await d.simulateRemoteActivity(), { description: "Mô phỏng: iPad cửa (Lễ tân 2)" })
          } catch (e) {
            reportError(e)
          } finally {
            setBusy(false)
          }
        }}
      >
        iPad cửa thao tác ngay
      </Button>
      <Button
        variant={armed ? "default" : "outline"}
        size="sm"
        onClick={() => {
          d.armConflictOnce()
          setArmed(true)
          toast.info("Lần xác nhận bàn kế tiếp sẽ bị thiết bị khác giành trước", {
            description: "Dùng để xem cảnh báo xung đột",
          })
        }}
      >
        {armed && d.conflictArmed ? "Đã gài xung đột" : "Gài xung đột lần xác nhận tới"}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          d.reset()
          useUi.getState().clearHistory()
          useUi.getState().selectTable(null)
          toast.success("Đã nạp lại dữ liệu mẫu")
        }}
      >
        Nạp lại dữ liệu mẫu
      </Button>
    </div>
  )
}

function UndoRedo() {
  const undoStack = useUi((s) => s.undoStack)
  const redoStack = useUi((s) => s.redoStack)
  const canUndo = useSession((s) => roleCan(s.user.role, "operation.undo"))
  const lastUndo = undoStack[undoStack.length - 1]
  const lastRedo = redoStack[redoStack.length - 1]

  const doUndo = async () => {
    const item = useUi.getState().popUndo()
    if (item) await undoOperation(item.id, item.summary)
  }
  const doRedo = async () => {
    const item = useUi.getState().popRedo()
    if (!item) return
    try {
      const res = await api.redo(item.id)
      useUi.getState().pushUndo({ id: res.operationId!, summary: item.summary })
      toast.success(`Đã làm lại: ${item.summary}`, { description: MOCK_NOTE })
    } catch (e) {
      reportError(e)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.closest("input, textarea, [contenteditable=true]")) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault()
        if (e.shiftKey) void doRedo()
        else void doUndo()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  if (!canUndo) return null
  return (
    <div className="flex items-center">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Hoàn tác" disabled={!lastUndo} onClick={doUndo}>
            <Undo2 />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {lastUndo ? (
            <>
              Hoàn tác: {lastUndo.summary} <Kbd>Ctrl Z</Kbd>
            </>
          ) : (
            "Chưa có thao tác để hoàn tác"
          )}
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Làm lại"
            disabled={!lastRedo}
            onClick={doRedo}
            className="hidden sm:inline-flex"
          >
            <Redo2 />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{lastRedo ? <>Làm lại: {lastRedo.summary}</> : "Chưa có thao tác để làm lại"}</TooltipContent>
      </Tooltip>
    </div>
  )
}

function ThemeToggle() {
  const theme = useSession((s) => s.theme)
  const setTheme = useSession((s) => s.setTheme)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          aria-label="Đổi giao diện sáng / tối"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="hidden size-10 bg-transparent sm:inline-flex"
        >
          {theme === "dark" ? <Moon /> : <Sun />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{theme === "dark" ? "Daylight (ban ngày)" : "Service (trong quán)"}</TooltipContent>
    </Tooltip>
  )
}

/** v2 bell: same alert source as the "Cần xử lý" tab, reachable from every page. */
function AlertsBell() {
  const model = useFloorModel()
  const now = useNow(15_000)
  const bd = model.floor?.businessDate ?? businessDateOf(now)
  const reservations = useReservations(bd)
  const booked = useMemo(() => (reservations.data ?? []).filter((r) => r.status === "BOOKED"), [reservations.data])
  const alerts = useShiftAlerts(model, booked, now)
  const ui = useUi()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="relative size-10 bg-transparent"
          aria-label={`Cần xử lý: ${alerts.length}`}
        >
          <Bell />
          {alerts.length ? (
            <span className="tnum absolute -top-1.5 -right-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-st-noshow px-1.5 text-xs font-semibold text-white">
              {alerts.length}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center gap-2 py-2.5 pr-2 pl-4">
          <span className="text-sm font-semibold">Cần xử lý</span>
          <span className="tnum text-xs text-tx-3">{alerts.length}</span>
          <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label="Đóng" onClick={() => setOpen(false)}>
            <X />
          </Button>
        </div>
        {alerts.length === 0 ? (
          <p className="border-t px-4 py-3 text-xs text-tx-2">Ca đang ổn.</p>
        ) : (
          <ul className="max-h-[60vh] overflow-y-auto">
            {alerts.map((a) => (
              <li key={a.key} className="border-t">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    if (a.tableId) {
                      ui.selectTable(a.tableId)
                      navigate("/floor")
                    } else if (a.reservationId) ui.openReservation(a.reservationId, bd)
                  }}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2"
                >
                  <span
                    className="grid size-8 shrink-0 place-items-center rounded-sm"
                    style={{ color: `var(--st-${a.tone}-ink)`, background: `var(--st-${a.tone}-tint)` }}
                  >
                    {a.icon}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-tx-strong">{a.title}</span>
                    <span className="tnum block truncate text-xs text-tx-2">{a.detail}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="border-t px-4 py-3 text-xs text-tx-3">
          Hệ thống không tự hủy booking hay nhả bàn. Lễ tân xử lý thủ công.
        </p>
      </PopoverContent>
    </Popover>
  )
}

function Identity() {
  const user = useSession((s) => s.user)
  return (
    <div className="hidden items-center gap-2.5 pl-1 xl:flex">
      <span className="grid size-8 place-items-center rounded-full bg-surface-3 text-xs font-semibold">
        {(user.displayName.split(" ").pop()?.[0] ?? "?").toUpperCase()}
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold text-tx-strong">{user.displayName}</span>
        <span className="block text-xs text-tx-3">
          {ROLE_LABEL[user.role]} · {user.deviceLabel}
        </span>
      </span>
    </div>
  )
}

function AccountMenu() {
  const { user, users, setUser, theme, setTheme } = useSession()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="h-9 max-w-[220px] gap-2 bg-surface-1 pr-2 pl-2.5 text-sm font-medium"
          aria-label={`Tài khoản: ${user.displayName}, ${ROLE_LABEL[user.role]}`}
        >
          <UserRound className="text-muted-foreground" />
          <span className="truncate">{user.displayName}</span>
          <ChevronDown className="size-3.5 text-subtle" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <span className="block text-sm font-medium">
            {user.displayName} · {user.deviceLabel}
          </span>
          <span className="block text-xs text-muted-foreground">Đổi vai trò để thử phân quyền (demo)</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={String(user.id)}
          onValueChange={(v) => {
            setUser(Number(v))
            useUi.getState().clearHistory()
          }}
        >
          {users.map((u) => (
            <DropdownMenuRadioItem key={u.id} value={String(u.id)} className="h-11">
              <span className="grid">
                <span>{ROLE_LABEL[u.role]}</span>
                <span className="text-xs text-muted-foreground">
                  {u.displayName} · {u.deviceLabel}
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="h-11 sm:hidden" onSelect={() => setTheme(theme === "dark" ? "light" : "dark")}>
          {theme === "dark" ? <Sun /> : <Moon />} Giao diện {theme === "dark" ? "sáng" : "tối"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function MobileNav() {
  const { setOpenMobile } = useSidebar()
  const overview = useOverview()
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      aria-label="Điều hướng chính"
    >
      {NAV.filter((n) => n.mobile).map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            cn(
              "relative flex h-16 flex-col items-center justify-center gap-1 text-xs",
              isActive ? "text-primary-ink" : "text-tx-3",
            )
          }
        >
          {({ isActive }) => (
            <>
              <span className={cn("grid h-7 w-12 place-items-center rounded-sm", isActive && "bg-primary-tint")}>
                <item.icon className="size-[18px]" />
              </span>
              {item.short}
              {item.to === "/floor" && overview.data?.attention ? (
                <span className="absolute top-2 right-[calc(50%-22px)] size-2 rounded-full bg-st-noshow" />
              ) : null}
            </>
          )}
        </NavLink>
      ))}
      <button
        type="button"
        onClick={() => setOpenMobile(true)}
        className="flex h-16 flex-col items-center justify-center gap-1 text-xs text-tx-3"
      >
        <span className="grid h-7 w-12 place-items-center">
          <Menu className="size-[18px]" />
        </span>
        Thêm
      </button>
    </nav>
  )
}

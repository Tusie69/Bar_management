import {
  Bell,
  ChevronDown,
  ChevronsUpDown,
  Clock4,
  FastForward,
  LogOut,
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
import { useUndoRedo, useUndoRedoShortcuts } from "@/features/operations/use-undo-redo"
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
import { useBusinessShift, useNow, useOverview, useReservations } from "@/hooks/use-data"
import { businessDateOf, fmtBusinessDate, fmtBusinessShift, fmtTime, shiftHour } from "@/lib/time"
import { initials } from "@/lib/text"
import { cn } from "@/lib/utils"
import { api, clock, demo } from "@/services"
import { useCan, useSession } from "@/state/session"
import { useUi } from "@/state/ui"
import { useShiftAlerts } from "@/features/floor/alerts"
import { useFloorModel } from "@/features/floor/use-floor-model"
import { WalkInSheet } from "@/features/floor/walk-in-sheet"
import { BookingSheet } from "@/features/reservations/booking-sheet"
import { ReservationDetailSheet } from "@/features/reservations/reservation-detail"
import { NAV } from "./nav"

export function AppShell() {
  // v2: on Điều phối the booking / walk-in forms live inline in the right column (quick-form.tsx).
  const path = useLocation().pathname
  const onFloor = path.startsWith("/floor")
  return (
    <SidebarProvider defaultOpen={false} className="h-dvh min-h-0">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
      {onFloor ? null : <BookingSheet />}
      {onFloor ? null : <WalkInSheet />}
      <ReservationDetailSheet />
    </SidebarProvider>
  )
}

function Wordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <img
        src="/21gam-logo.png"
        alt="21GAM"
        className="size-8 shrink-0 rounded-lg object-cover ring-1 ring-border-subtle"
      />
      <span className="text-sm font-semibold tracking-[0.04em] whitespace-nowrap text-brand group-data-[collapsible=icon]:hidden">
        21GAM
      </span>
    </span>
  )
}

function AppSidebar() {
  const user = useSession((s) => s.user)
  const permissions = useSession((s) => s.permissions)
  const overview = useOverview()
  const { setOpenMobile } = useSidebar()
  const location = useLocation()
  const badges: Record<string, number | undefined> = {
    "/floor": overview.data?.attention || undefined,
    "/waitlist": overview.data ? overview.data.waitlistAdvance + overview.data.waitlistWalkIn || undefined : undefined,
  }
  return (
    <Sidebar collapsible="icon" className="border-r border-border-subtle">
      <SidebarHeader className="h-14 justify-center border-b border-border-subtle px-4 group-data-[collapsible=icon]:px-4">
        <Wordmark />
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label="Điều hướng chính">
          <SidebarGroup className="p-2.5">
            <SidebarMenu className="gap-1">
              {NAV.filter(
                (n) =>
                  (user.role !== "RECEPTIONIST" || n.to === "/floor") &&
                  (!n.permission ||
                    (api.mode === "http" ? permissions.includes(n.permission) : roleCan(user.role, n.permission))),
              ).map((item) => (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    asChild
                    isActive={location.pathname.startsWith(item.to)}
                    tooltip={item.label}
                    className="relative h-11 gap-3 rounded-lg border border-transparent px-3 text-tx-2 transition-[background-color,color,border-color,box-shadow,transform] duration-[var(--duration-hover)] ease-[var(--ease-spring-default)] before:absolute before:inset-y-2.5 before:left-1 before:hidden before:w-[3px] before:rounded-full before:bg-primary group-data-[collapsible=icon]:before:hidden hover:bg-surface-2 hover:text-tx-1 active:scale-[0.985] data-[active=true]:border-border-subtle data-[active=true]:bg-surface-1 data-[active=true]:font-semibold data-[active=true]:text-tx-strong data-[active=true]:shadow-xs data-[active=true]:before:block dark:data-[active=true]:bg-surface-2 [&>svg]:size-[18px] data-[active=true]:[&>svg]:text-primary-ink"
                  >
                    <NavLink to={item.to} onClick={() => setOpenMobile(false)}>
                      <item.icon />
                      <span>{item.label}</span>
                    </NavLink>
                  </SidebarMenuButton>
                  {badges[item.to] ? (
                    <SidebarMenuBadge className="tnum rounded-full bg-surface-3 px-1.5 text-xs font-semibold text-tx-1 group-data-[collapsible=icon]:top-0.5 group-data-[collapsible=icon]:right-0.5 group-data-[collapsible=icon]:flex! group-data-[collapsible=icon]:h-4 group-data-[collapsible=icon]:min-w-4 group-data-[collapsible=icon]:bg-st-noshow group-data-[collapsible=icon]:px-1 group-data-[collapsible=icon]:text-white">
                      {badges[item.to]}
                    </SidebarMenuBadge>
                  ) : null}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        </nav>
      </SidebarContent>
      <SidebarFooter className="border-t border-border-subtle p-2.5">
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
          className="h-11 gap-3 rounded-lg px-3 text-tx-2 transition-[background-color,color,transform] duration-[var(--duration-hover)] hover:bg-surface-2 hover:text-tx-1 active:scale-[0.985] [&>svg]:size-[18px]"
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
  const location = useLocation()
  const receptionist = useSession((state) => state.user.role === "RECEPTIONIST")
  const pageTitle =
    NAV.find((n) => location.pathname.startsWith(n.to))?.label ??
    (location.pathname === "/overview" ? "Tổng quan" : "21GAM")
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border-subtle bg-background/90 px-3 backdrop-blur-md supports-[not(backdrop-filter)]:bg-background sm:gap-3 md:px-4">
      <h1 className="sr-only">{pageTitle}</h1>
      <Button
        variant="outline"
        size="icon"
        className="size-11 rounded-lg bg-surface-1 shadow-xs md:hidden"
        aria-label="Mở menu"
        onClick={toggleSidebar}
      >
        <Menu />
      </Button>
      <div className="mr-auto flex min-w-0 items-center gap-2">
        <AccountMenu />
        {!receptionist ? (
          <Button
            className="hidden h-11 rounded-lg px-3.5 shadow-xs sm:inline-flex xl:h-10"
            onClick={() => navigate("/reservations")}
          >
            Theo dõi đơn đặt bàn
          </Button>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5 md:gap-2">
        {!receptionist ? <SyncPill /> : null}
        <ClockMenu />
        <UndoRedo />
        <ThemeToggle />
        {!receptionist ? <AlertsBell /> : null}
        {!receptionist ? <Identity /> : null}
      </div>
    </header>
  )
}

function SyncPill() {
  if (api.mode === "http") {
    return (
      <Badge
        variant="outline"
        className="hidden h-8 shrink-0 gap-1.5 rounded-full border-border bg-surface-1 px-3 text-xs font-medium shadow-2xs lg:inline-flex"
      >
        <Zap className="size-3.5 text-st-seated-ink" /> Đã kết nối API
      </Badge>
    )
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className="hidden h-8 shrink-0 gap-1.5 rounded-full border-dashed border-strong bg-surface-1/80 px-3 text-xs font-medium text-tx-2 lg:inline-flex"
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
  // TU-38: the shift comes from the venue row, so a venue that opens at another hour is
  // labelled with its own hours instead of the 17:00-05:00 this used to hardcode.
  const shift = useBusinessShift()
  const bd = businessDateOf(now, shiftHour(shift.cutoffLocal))
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className="tnum h-11 min-h-[44px] gap-2 rounded-lg px-2.5 text-sm font-medium"
          aria-label={`${fmtTime(now)}${clock.isSimulated ? " mô phỏng" : ""} - Mở điều khiển thời gian`}
        >
          <Clock4 className="text-muted-foreground" aria-hidden="true" />
          <span>{fmtTime(now)}</span>
          {clock.isSimulated ? (
            <>
              {" "}
              <span className="hidden rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-tx-3 lg:inline">
                mô phỏng
              </span>
            </>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 rounded-xl p-4 shadow-float">
        <div className="grid gap-4">
          <div>
            <p className="eyebrow">Ngày kinh doanh</p>
            <p className="mt-1 font-medium">
              {fmtBusinessDate(bd)} · {fmtBusinessShift(shift)}
            </p>
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
  return api.mode === "http" ? <HttpUndoRedo /> : <UndoRedoContent />
}

function HttpUndoRedo() {
  const controller = useUndoRedo()
  const { undo, redo, pending, apply } = controller
  useUndoRedoShortcuts(controller)

  if (!controller.enabled) return null
  return (
    <div className="flex items-center">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Hoàn tác"
            disabled={!undo || pending}
            onClick={() => void apply("undo")}
          >
            <Undo2 />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {undo ? (
            <>
              Hoàn tác: {undo.summary} <Kbd>Ctrl Z</Kbd>
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
            disabled={!redo || pending}
            onClick={() => void apply("redo")}
          >
            <Redo2 />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{redo ? <>Làm lại: {redo.summary}</> : "Chưa có thao tác để làm lại"}</TooltipContent>
      </Tooltip>
    </div>
  )
}

function UndoRedoContent() {
  const undoStack = useUi((s) => s.undoStack)
  const redoStack = useUi((s) => s.redoStack)
  const canUndo = useCan("operation.undo")
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
          className="hidden size-11 min-h-[44px] min-w-[44px] rounded-lg bg-surface-1 shadow-xs sm:inline-flex"
        >
          {theme === "dark" ? <Moon /> : <Sun />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{theme === "dark" ? "Daylight (ban ngày)" : "Service (trong quán)"}</TooltipContent>
    </Tooltip>
  )
}

/** v2 bell: same alert source as the "Cần xử lý" tab, reachable from every page. */
export function AlertsBell({ className }: { className?: string }) {
  const receptionist = useSession((state) => state.user.role === "RECEPTIONIST")
  if (receptionist) return null
  return <AlertsBellContent className={className} />
}

function AlertsBellContent({ className }: { className?: string }) {
  const ui = useUi()
  const now = useNow(15_000)
  // TU-38: mốc cắt ca lấy từ cấu hình địa điểm, không mặc định 05:00.
  const shiftCutoff = shiftHour(useBusinessShift().cutoffLocal)
  const selectedDate = businessDateOf(now, shiftCutoff)
  const model = useFloorModel(undefined)
  const bd = model.floor?.businessDate ?? selectedDate
  const reservations = useReservations(bd)
  const booked = useMemo(() => (reservations.data ?? []).filter((r) => r.status === "BOOKED"), [reservations.data])
  const alerts = useShiftAlerts(model, booked, now)
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className={cn("relative size-11 min-h-[44px] min-w-[44px] rounded-lg bg-surface-1 shadow-xs", className)}
          aria-label={`Cần xử lý: ${alerts.length}`}
        >
          <Bell />
          {alerts.length ? (
            <span className="tnum absolute -top-1.5 -right-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-st-noshow px-1.5 text-xs font-semibold text-white shadow-xs">
              {alerts.length}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 max-w-[calc(100vw-16px)] overflow-hidden rounded-xl p-0 shadow-float">
        <div className="flex items-center gap-2 border-b border-border-subtle bg-surface-2/60 py-2.5 pr-2 pl-4">
          <span className="text-sm font-semibold tracking-[-0.01em] text-tx-strong">Cần xử lý</span>
          <span className="tnum rounded-full bg-surface-3 px-2 py-0.5 text-xs font-semibold text-tx-2">
            {alerts.length}
          </span>
          <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label="Đóng" onClick={() => setOpen(false)}>
            <X />
          </Button>
        </div>
        {alerts.length === 0 ? (
          <p className="px-4 py-4 text-sm text-tx-2">Ca đang ổn.</p>
        ) : (
          <ul className="max-h-[60vh] divide-y divide-border-subtle overflow-y-auto">
            {alerts.map((a) => (
              <li key={a.key}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    if (a.tableId) {
                      ui.selectTable(a.tableId)
                      navigate("/floor")
                    } else if (a.reservationId) ui.openReservation(a.reservationId, bd)
                  }}
                  className="flex min-h-[56px] w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-[var(--duration-hover)] hover:bg-surface-2/80"
                >
                  <span
                    className="grid size-9 shrink-0 place-items-center rounded-lg"
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
        <p className="border-t border-border-subtle bg-surface-2/40 px-4 py-2.5 text-xs text-tx-3">
          Hệ thống không tự hủy booking hay nhả bàn. Lễ tân xử lý thủ công.
        </p>
      </PopoverContent>
    </Popover>
  )
}

function Identity() {
  const user = useSession((s) => s.user)
  const principal = useSession((s) => s.principal)
  const displayName = api.mode === "http" ? (principal?.displayName ?? "Nhân viên") : user.displayName
  const subtitle = api.mode === "http" ? ROLE_LABEL[user.role] : `${ROLE_LABEL[user.role]} · ${user.deviceLabel}`

  return (
    <div className="hidden items-center gap-2.5 rounded-xl border border-border-subtle bg-surface-1/80 py-1 pr-3 pl-1.5 xl:flex">
      <span className="grid size-8 place-items-center rounded-full bg-surface-3 text-xs font-semibold text-tx-strong">
        {initials(displayName)}
      </span>
      <span className="leading-tight">
        <span className="block text-[13px] font-semibold text-tx-strong">{displayName}</span>
        <span className="block text-xs text-tx-3">{subtitle}</span>
      </span>
    </div>
  )
}

function AccountMenu() {
  const { user, users, setUser, theme, setTheme, principal, logout } = useSession()
  const displayName = api.mode === "http" ? (principal?.displayName ?? "Đã đăng nhập") : user.displayName
  const subtitle =
    api.mode === "http" ? (principal ? `@${principal.username}` : "") : `${user.displayName} · ${user.deviceLabel}`

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="h-11 min-h-[44px] max-w-[220px] gap-2 rounded-lg bg-surface-1 pr-2.5 pl-2.5 text-sm font-medium shadow-xs"
          aria-label={`Tài khoản: ${displayName}`}
        >
          <UserRound className="text-muted-foreground" />
          <span className="truncate">{displayName}</span>
          <ChevronDown className="size-3.5 text-subtle" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <span className="block text-sm font-medium">{displayName}</span>
          <span className="block text-xs text-muted-foreground">
            {api.mode === "http" ? subtitle : "Đổi vai trò để thử phân quyền (demo)"}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {api.mode === "mock" ? (
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
        ) : (
          <DropdownMenuItem className="h-11 cursor-pointer" onSelect={() => void logout()}>
            <LogOut className="mr-2 size-4" /> Đăng xuất
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="h-11 sm:hidden" onSelect={() => setTheme(theme === "dark" ? "light" : "dark")}>
          {theme === "dark" ? <Sun /> : <Moon />} Giao diện {theme === "dark" ? "sáng" : "tối"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

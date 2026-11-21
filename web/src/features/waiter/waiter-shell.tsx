/**
 * Module Phục vụ 1 — khung của khu vực `/phucvu`.
 *
 * Khung RIÊNG, không phải `AppShell` cũng không phải `MobileApp`. Lý do không
 * phải là thẩm mỹ: hai khung kia mount navigation của Lễ tân (Đặt bàn, Chờ,
 * Khách, Báo cáo, Cài đặt) cùng các sheet booking/walk-in của nó. Dùng lại
 * chúng rồi ẩn từng mục bằng `if` là cách để một mục quay lại sau một lần
 * refactor mà không ai nhận ra. Ở đây những mục đó không tồn tại trong cây
 * component, nên không có gì để sót.
 *
 * Mobile-first: header cao 56px, nội dung chiếm phần còn lại của `100dvh`,
 * không có thanh ngang nào phải cuộn. Trên tablet và desktop nội dung được
 * giới hạn bề ngang và căn giữa, vì sơ đồ quán có tỷ lệ cố định.
 */
import { useQuery } from "@tanstack/react-query"
import { Bell, LogOut, UserRound } from "lucide-react"
import { Outlet, useNavigate } from "react-router"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { api } from "@/services"
import { useSession } from "@/state/session"
import { readyBadgeCount } from "@/features/waiter-menu/order-board-model"
import { fetchReadyNotifications } from "@/features/waiter-menu/waiter-order-api"
import { useWaiterSession } from "./use-waiter-session"
import { WAITER_HOME_PATH, waiterOrdersViewPath } from "./waiter-access"

/**
 * Module Phục vụ 5 — badge thông báo món đã xong.
 *
 * Nguồn là `GET /preparation/ready-notifications` của Module 4, vốn đã lọc theo
 * audience ở máy chủ: dòng tới đây đều là phiếu của CHÍNH người đang đăng nhập
 * (`ORDERED_BY_USER`). Badge chỉ đếm những thông báo chưa xác nhận — một badge
 * không bao giờ về 0 là một badge không ai còn nhìn.
 *
 * Bấm vào mở đúng Phiên của thông báo mới nhất. Không có thông báo nào thì nút
 * vẫn ở đó và nói thật rằng chưa có gì, chứ không biến mất khỏi header.
 */
function WaiterNotificationsButton() {
  const navigate = useNavigate()
  const venueId = useSession((state) => state.principal?.venueId ?? null)
  const ready = useQuery({
    queryKey: ["ready-notifications", venueId],
    queryFn: fetchReadyNotifications,
    enabled: venueId !== null,
    staleTime: 10_000,
    refetchInterval: 20_000,
  })
  const pending = (ready.data ?? []).filter((entry) => entry.acknowledgedAt === null)
  const count = readyBadgeCount(ready.data)
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="relative"
      aria-label={count === 0 ? "Thông báo: chưa có món nào xong" : `Thông báo: ${count} phiếu món đã xong`}
      disabled={count === 0}
      onClick={() => {
        const first = pending[0]
        if (first) navigate(waiterOrdersViewPath(first.visitId))
      }}
    >
      <Bell className="size-5" aria-hidden="true" />
      {count > 0 ? (
        <span className="tnum absolute -top-0.5 -right-0.5 grid min-w-5 place-items-center rounded-full bg-primary px-1 text-[11px] leading-5 font-semibold text-primary-foreground">
          {count}
        </span>
      ) : null}
    </Button>
  )
}

export function WaiterShell() {
  const session = useWaiterSession()
  const logout = useSession((state) => state.logout)
  const navigate = useNavigate()

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-surface-1 px-3">
        <button
          type="button"
          onClick={() => navigate(WAITER_HOME_PATH)}
          className="flex min-w-0 items-baseline gap-2 rounded-md px-1 py-0.5 text-left"
        >
          <span className="text-base font-semibold tracking-tight">21GAM</span>
          <span className="truncate text-sm text-muted-foreground">Phục vụ</span>
        </button>
        <div className="ml-auto flex items-center gap-1">
          {/* Tên nhân viên hiện ở MỌI bề ngang: một ca có nhiều máy dùng chung,
              và biết mình đang đăng nhập bằng tài khoản nào là việc của header. */}
          <span className="max-w-[8rem] truncate text-sm text-muted-foreground sm:max-w-[14rem]">
            {session.displayName}
          </span>
          <WaiterNotificationsButton />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon" aria-label="Tài khoản">
                <UserRound className="size-5" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="truncate">{session.displayName}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={api.mode !== "http"} onSelect={() => void logout()}>
                <LogOut className="size-4" aria-hidden="true" /> Đăng xuất
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <main className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col overflow-hidden">
        <Outlet />
      </main>
    </div>
  )
}

export default WaiterShell

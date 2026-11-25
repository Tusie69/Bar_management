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
import { LogOut, UserRound } from "lucide-react"
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
import { useWaiterSession } from "./use-waiter-session"
import { WAITER_HOME_PATH, waiterRoleLabel } from "./waiter-access"
import { WaiterNotificationsButton } from "./waiter-notifications"

export function WaiterShell() {
  const session = useWaiterSession()
  const role = useSession((state) => state.user.role)
  const logout = useSession((state) => state.logout)
  const navigate = useNavigate()

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background">
      <header className="flex h-14 min-w-0 shrink-0 items-center gap-2 border-b border-border bg-surface-1 px-3">
        <Button
          type="button"
          variant="ghost"
          onClick={() => navigate(WAITER_HOME_PATH)}
          className="min-h-11 max-w-[7.5rem] min-w-0 shrink justify-start gap-2 px-1.5 py-0.5 text-left min-[360px]:max-w-[9.5rem] sm:max-w-none sm:px-2"
        >
          <span className="text-base font-semibold tracking-tight">21GAM</span>
          <span className="truncate text-sm font-normal text-muted-foreground">{waiterRoleLabel(role)}</span>
        </Button>
        <div className="ml-auto flex min-w-0 items-center gap-1">
          {/* Tên nhân viên hiện ở MỌI bề ngang: một ca có nhiều máy dùng chung,
              và biết mình đang đăng nhập bằng tài khoản nào là việc của header. */}
          <span className="max-w-[4.5rem] truncate text-sm text-muted-foreground sm:max-w-[14rem]">
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

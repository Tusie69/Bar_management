/**
 * Module Phục vụ 1 — chặn cửa `/phucvu`.
 *
 * Ba trạng thái phải tách bạch: đang tải phiên, chưa đăng nhập và không đủ
 * quyền. Gộp chúng lại là cách sinh ra lỗi "vừa F5 đã bị đá về /floor" khi
 * phiên còn đang bootstrap.
 *
 * "Chưa đăng nhập" do `AuthBoundary` lo (nó hiện trang đăng nhập đúng cổng
 * theo URL, nên `/phucvu` ra form `/phucvu/login`), nên ở đây chỉ còn tải phiên
 * và thiếu quyền. Vai khác gõ thẳng `/phucvu` được đưa về home của chính họ,
 * kèm một câu nói rõ lý do — đẩy im lặng về `/floor` làm người dùng tưởng mình
 * gõ sai URL.
 *
 * Ẩn menu không phải là bảo vệ: backend vẫn kiểm permission trên từng endpoint,
 * và phép chiếu sơ đồ của Phục vụ không mang dữ liệu khách.
 */
import { LoaderCircle, ShieldAlert } from "lucide-react"
import type { ReactNode } from "react"
import { Link } from "react-router"
import { PORTAL_CONFIG } from "@/domain/auth-portal"
import { useSession } from "@/state/session"
import { useWaiterSession } from "./use-waiter-session"

function WaiterLoading() {
  return (
    <div
      className="grid h-dvh place-items-center bg-background"
      role="status"
      aria-live="polite"
      aria-label="Đang kiểm tra quyền phục vụ"
    >
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> Đang kiểm tra phiên đăng nhập…
      </p>
    </div>
  )
}

export function WaiterForbidden() {
  const portal = useSession((state) => state.portal)
  const home = portal ? PORTAL_CONFIG[portal].home : "/floor"
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-4">
      <section className="grid max-w-md gap-4 rounded-2xl border border-border bg-surface-1 p-6 text-center">
        <ShieldAlert className="mx-auto size-10 text-amber-500" aria-hidden="true" />
        <div className="grid gap-1.5">
          <h1 className="text-xl font-semibold tracking-[-0.015em]">Không có quyền truy cập</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Khu vực Phục vụ chỉ dành cho tài khoản Phục vụ đăng nhập ở cổng /phucvu.
          </p>
        </div>
        <Link to={home} className="text-sm font-medium text-primary-ink underline-offset-4 hover:underline">
          Về màn hình làm việc của bạn
        </Link>
      </section>
    </main>
  )
}

export function WaiterGuard({ children }: { children: ReactNode }) {
  const { allowed, loading } = useWaiterSession()
  if (loading) return <WaiterLoading />
  if (!allowed) return <WaiterForbidden />
  return children
}

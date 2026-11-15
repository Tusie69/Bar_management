/**
 * TU-39 — Chặn cửa `/admin`.
 *
 * Ba trạng thái phải tách bạch: đang tải phiên, chưa đăng nhập và không đủ
 * quyền. Gộp chúng lại là cách sinh ra lỗi "vừa F5 đã bị đá về /floor" khi
 * phiên còn đang bootstrap.
 *
 * Việc "chưa đăng nhập" do `AuthBoundary` lo (nó hiện trang đăng nhập đúng
 * cổng theo URL), nên ở đây chỉ còn tải phiên và thiếu quyền. Ẩn menu không
 * phải là bảo vệ: backend vẫn kiểm quyền trên từng endpoint.
 */
import { LoaderCircle, ShieldAlert } from "lucide-react"
import type { ReactNode } from "react"
import { Link } from "react-router"
import { PORTAL_CONFIG } from "@/domain/auth-portal"
import { useSession } from "@/state/session"
import { canReadAdminPage } from "./admin-access"
import type { AdminPage } from "./admin-pages"
import { useAdminSession } from "./use-admin-session"

function AdminLoading() {
  return (
    <main className="grid min-h-dvh place-items-center bg-[#f7f6f3]">
      <p className="flex items-center gap-2 text-sm text-[#6e6a62]">
        <LoaderCircle className="size-5 animate-spin" /> Đang kiểm tra quyền quản trị…
      </p>
    </main>
  )
}

export function AdminForbidden({ message }: { message: string }) {
  const portal = useSession((state) => state.portal)
  const home = portal ? PORTAL_CONFIG[portal].home : "/floor"
  return (
    <main className="grid min-h-dvh place-items-center bg-[#f7f6f3] p-4">
      <section className="grid max-w-md gap-4 rounded-xl border border-[#e2dfd8] bg-white p-6 text-center">
        <ShieldAlert className="mx-auto size-10 text-[#d13b3b]" />
        <div>
          <h1 className="text-xl font-semibold text-[#1a1a1a]">Không có quyền truy cập</h1>
          <p className="mt-2 text-sm text-[#6e6a62]">{message}</p>
        </div>
        <Link to={home} className="text-sm font-medium text-[#1d6fc2] underline-offset-4 hover:underline">
          Về màn hình làm việc của bạn
        </Link>
      </section>
    </main>
  )
}

/** Cửa vào `/admin`: chỉ OWNER và ADMIN của cổng quản trị. */
export function AdminGuard({ children }: { children: ReactNode }) {
  const { allowed, loading } = useAdminSession()
  if (loading) return <AdminLoading />
  if (!allowed) {
    return (
      <AdminForbidden message="Trang Quản trị chỉ dành cho tài khoản Chủ sở hữu và Quản trị viên đăng nhập ở cổng /admin." />
    )
  }
  return children
}

/**
 * Cửa của từng trang. Gõ thẳng URL một trang không có quyền đọc vẫn bị chặn,
 * chứ không chỉ mất mục trong sidebar.
 */
export function AdminPageGuard({ page, children }: { page: AdminPage; children: ReactNode }) {
  const { can } = useAdminSession()
  if (!canReadAdminPage(page, can)) {
    return (
      <section className="adm-card mx-auto grid max-w-xl gap-3 p-6 text-center">
        <ShieldAlert className="mx-auto size-8 text-[var(--adm-state-late)]" />
        <h2 className="adm-h2">Không đủ quyền xem trang này</h2>
        <p className="adm-body text-[var(--adm-text-muted)]">
          Tài khoản của bạn không có quyền “{page.title}”. Liên hệ Chủ quán nếu bạn cần xem mục này.
        </p>
      </section>
    )
  }
  return children
}

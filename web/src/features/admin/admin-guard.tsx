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
import { ADMIN_PAGES, type AdminPage } from "./admin-pages"
import { useAdminSession } from "./use-admin-session"

/**
 * Khung chờ giữ đúng hình học của shell thật (sidebar 232px, header 75px),
 * để lúc shell vào chỗ không có cú nhảy layout. Một spinner giữa trang
 * trống làm cả màn hình dịch một nhịp ngay khi người dùng bắt đầu đọc.
 *
 * Màu viết thẳng hex vì `admin-theme.css` đi cùng shell đã lazy-load, còn
 * cửa này nằm trong bundle chính nên chưa có token `--adm-*`.
 */
function AdminLoading() {
  return (
    <div
      className="flex h-dvh min-h-0 w-full overflow-hidden bg-[#f7f6f3]"
      role="status"
      aria-live="polite"
      aria-label="Đang kiểm tra quyền quản trị"
    >
      <div className="hidden w-[232px] shrink-0 border-r border-[#e2dfd8] bg-white lg:block" aria-hidden="true">
        <div className="grid gap-2 px-4 pt-6 pb-4">
          <div className="h-6 w-24 rounded bg-[#f0eee9]" />
          <div className="h-5 w-16 rounded bg-[#f0eee9]" />
        </div>
        <div className="grid gap-1 px-4">
          {ADMIN_PAGES.map((page) => (
            <div key={page.path} className="h-[42px] rounded-lg bg-[#f0eee9]" />
          ))}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[75px] shrink-0 items-center gap-2 border-b border-[#e2dfd8] bg-white px-4 text-sm text-[#6e6a62] md:px-6">
          <LoaderCircle className="size-5 animate-spin" /> Đang kiểm tra quyền quản trị…
        </header>
        <div className="min-h-0 flex-1 p-4 md:p-6" aria-hidden="true">
          <div className="h-44 rounded-xl border border-[#e2dfd8] bg-white" />
        </div>
      </div>
    </div>
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

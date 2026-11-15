/**
 * TU-39 — Khung Trang Quản trị: sidebar 232px, header 75px, vùng nội dung.
 *
 * Khung này độc lập với `app/shell.tsx` của Lễ tân. Hai portal có nhịp làm
 * việc khác nhau (Lễ tân thao tác liên tục trên sàn, Quản trị đọc số và tra
 * cứu), nên gộp chung một shell sẽ biến mọi thay đổi nhỏ ở một bên thành rủi
 * ro cho bên kia giữa ca.
 *
 * Màn con cắm vào qua `admin-routes.tsx` + `ADMIN_PAGES`; không màn nào cần
 * sửa file này. Xem docs/frontend.md.
 */
import { Menu, X } from "lucide-react"
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { NavLink, Outlet, useLocation } from "react-router"
import { useNow } from "@/hooks/use-data"
import { initials } from "@/lib/text"
import { useAdminSession } from "./use-admin-session"
import { visibleAdminPages } from "./admin-access"
import { adminBusinessDateLabel, ADMIN_SHIFT_LABEL } from "./admin-date"
import { adminPageForPath, adminPagePath } from "./admin-pages"
import "./admin-theme.css"

/**
 * Tiêu đề header mặc định lấy từ registry. Màn con muốn nói thêm (ví dụ
 * "Tài khoản & phân quyền · Trần Thu Hà") thì gọi `useAdminPageTitle`.
 */
const AdminTitleContext = createContext<{ setTitle: (title: string | null) => void }>({ setTitle: () => {} })

/** Đặt tiêu đề header trong lúc component còn mounted, tự trả lại khi unmount. */
export function useAdminPageTitle(title: string | null) {
  const { setTitle } = useContext(AdminTitleContext)
  useEffect(() => {
    setTitle(title)
    return () => setTitle(null)
  }, [setTitle, title])
}

export function AdminShell() {
  const location = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [override, setOverride] = useState<string | null>(null)
  const setTitle = useCallback((value: string | null) => setOverride(value), [])
  const titleApi = useMemo(() => ({ setTitle }), [setTitle])

  const page = adminPageForPath(location.pathname)
  // Trang rời màn hình thì `useAdminPageTitle` tự gọi setTitle(null) lúc
  // unmount, nên không cần hiệu ứng nào canh theo pathname ở đây.
  const title = override ?? page?.title ?? "Quản trị"

  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [drawerOpen])

  return (
    <AdminTitleContext.Provider value={titleApi}>
      <div className="admin-portal flex h-dvh min-h-0 w-full overflow-hidden">
        {/* Desktop ≥1024px: sidebar cố định. Dưới mức đó: drawer. */}
        <div className="hidden w-[var(--adm-sidebar-w)] shrink-0 lg:block">
          <AdminSidebar />
        </div>
        {drawerOpen ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button
              type="button"
              aria-label="Đóng menu"
              className="absolute inset-0 bg-black/40"
              onClick={() => setDrawerOpen(false)}
            />
            <div className="absolute inset-y-0 left-0 w-[var(--adm-sidebar-w)] shadow-xl">
              <AdminSidebar onNavigate={() => setDrawerOpen(false)} />
            </div>
          </div>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <AdminHeader title={title} drawerOpen={drawerOpen} onToggleDrawer={() => setDrawerOpen((open) => !open)} />
          <main className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-[var(--adm-canvas)] p-4 md:p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </AdminTitleContext.Provider>
  )
}

function AdminSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { can, displayName, levelLabel } = useAdminSession()
  const pages = visibleAdminPages(can)
  return (
    <div className="flex h-full flex-col border-r border-[var(--adm-border)] bg-[var(--adm-surface)]">
      <div className="px-4 pt-6 pb-4">
        <span className="adm-h2 block">21GAM</span>
        <span className="adm-body block text-[var(--adm-text-muted)]">Quản trị</span>
      </div>
      <nav aria-label="Điều hướng quản trị" className="min-h-0 flex-1 overflow-y-auto px-4">
        <ul className="grid gap-1">
          {pages.map((page) => (
            <li key={page.path}>
              <NavLink to={adminPagePath(page)} className="adm-nav-item" onClick={onNavigate}>
                {page.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex items-center gap-2.5 border-t border-[var(--adm-border)] px-4 py-4">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--adm-surface-sunken)] text-xs font-semibold">
          {initials(displayName)}
        </span>
        <span className="min-w-0 leading-tight">
          <span className="adm-h3 block truncate">{displayName}</span>
          <span className="adm-label block truncate text-[var(--adm-text-muted)]">{levelLabel}</span>
        </span>
      </div>
    </div>
  )
}

function AdminHeader({
  title,
  drawerOpen,
  onToggleDrawer,
}: {
  title: string
  drawerOpen: boolean
  onToggleDrawer: () => void
}) {
  // Ngày kinh doanh đổi lúc 05:00, không phải 00:00: nhịp 60s là đủ.
  const now = useNow(60_000)
  return (
    <header className="flex h-[var(--adm-header-h)] shrink-0 items-center gap-3 border-b border-[var(--adm-border)] bg-[var(--adm-surface)] px-4 md:px-6">
      <button
        type="button"
        className="grid size-10 shrink-0 place-items-center rounded-lg border border-[var(--adm-border)] lg:hidden"
        aria-label={drawerOpen ? "Đóng menu" : "Mở menu"}
        aria-expanded={drawerOpen}
        onClick={onToggleDrawer}
      >
        {drawerOpen ? <X className="size-5" /> : <Menu className="size-5" />}
      </button>
      <h1 className="adm-h1 truncate">{title}</h1>
      <span className="adm-body hidden whitespace-nowrap text-[var(--adm-text-muted)] sm:inline">
        {ADMIN_SHIFT_LABEL}
      </span>
      <span className="adm-body hidden font-medium whitespace-nowrap md:inline">{adminBusinessDateLabel(now)}</span>
    </header>
  )
}

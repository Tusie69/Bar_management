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
import { createContext, type RefObject, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { NavLink, Outlet, useLocation } from "react-router"
import { useNow } from "@/hooks/use-data"
import { initials } from "@/lib/text"
import { useAdminSession } from "./use-admin-session"
import { visibleAdminPages } from "./admin-access"
import { adminBusinessDateLabel, ADMIN_SHIFT_LABEL } from "./admin-date"
import { ADMIN_DESKTOP_MEDIA_QUERY, resolveDrawerCloseFocusTarget, resolveTrapTarget } from "./admin-focus"
import { adminPageForPath, adminPagePath } from "./admin-pages"
import {
  drawerDataState,
  drawerExitDelay,
  drawerIsInteractive,
  drawerIsMounted,
  nextDrawerPhase,
  prefersReducedMotion,
  type DrawerPhase,
} from "./admin-motion"
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
  /**
   * Ba pha thay cho một boolean: panel phải còn trong DOM lúc đang đóng, nếu
   * không thì không có gì để chạy animation ra. Xem `admin-motion.ts`.
   */
  const [drawerPhase, setDrawerPhase] = useState<DrawerPhase>("closed")
  const drawerOpen = drawerPhase === "open"
  const [override, setOverride] = useState<string | null>(null)
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const drawerRef = useRef<HTMLDivElement>(null)
  const desktopSidebarRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  const setTitle = useCallback((value: string | null) => setOverride(value), [])
  const titleApi = useMemo(() => ({ setTitle }), [setTitle])

  const page = adminPageForPath(location.pathname)
  // Trang rời màn hình thì `useAdminPageTitle` tự gọi setTitle(null) lúc
  // unmount, nên không cần hiệu ứng nào canh theo pathname ở đây.
  const title = override ?? page?.title ?? "Quản trị"

  /**
   * Drawer là một lớp phủ: mở ra thì focus phải vào trong nó, đóng lại thì
   * phải quay về chỗ cũ. Không làm vậy, người dùng bàn phím mở menu xong
   * vẫn đang focus ở nút menu nằm sau lớp phủ, và Tab tiếp sẽ chạy vào
   * những phần tử đang bị che.
   */
  const closeDrawer = useCallback(() => {
    setDrawerPhase((phase) => nextDrawerPhase(phase, "close"))
    const isDesktop =
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia(ADMIN_DESKTOP_MEDIA_QUERY).matches
        : false
    resolveDrawerCloseFocusTarget({
      trigger: menuTriggerRef.current,
      isDesktop,
      desktopSidebar: desktopSidebarRef.current,
      mainContent: mainRef.current,
    })?.focus()
  }, [])

  useEffect(() => {
    if (!drawerOpen) return
    drawerRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeDrawer()
        return
      }
      if (event.key !== "Tab") return
      const panel = drawerRef.current
      if (!panel) return
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      )
      const target = resolveTrapTarget({
        focusables,
        active: document.activeElement instanceof HTMLElement ? document.activeElement : null,
        shiftKey: event.shiftKey,
      })
      if (!target) return
      event.preventDefault()
      target.focus()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [closeDrawer, drawerOpen])

  /**
   * Gỡ panel khỏi DOM sau khi animation ra chạy xong. Dùng timer chứ không
   * dùng `transitionend`/`animationend`: nếu người dùng xin giảm chuyển
   * động, hoặc tab bị ẩn giữa lúc đóng, event đó có thể không bao giờ tới và
   * drawer sẽ nằm lại trong DOM vĩnh viễn.
   */
  useEffect(() => {
    if (drawerPhase !== "closing") return
    const delay = drawerExitDelay(drawerPhase, prefersReducedMotion())
    if (delay === 0) {
      setDrawerPhase("closed")
      return
    }
    const timer = window.setTimeout(() => setDrawerPhase("closed"), delay)
    return () => window.clearTimeout(timer)
  }, [drawerPhase])

  return (
    <AdminTitleContext.Provider value={titleApi}>
      <div className="admin-portal flex h-dvh min-h-0 w-full overflow-hidden" data-testid="admin-shell">
        {/*
          Sidebar của Quản trị có 8 mục đứng trước nội dung. Không có link này
          thì người dùng bàn phím phải Tab qua cả 8 mục đó ở mọi trang.
        */}
        <a href="#admin-main-content" className="adm-skip-link">
          Chuyển đến nội dung chính
        </a>
        {/* Desktop ≥1024px: sidebar cố định. Dưới mức đó: drawer. */}
        <div
          ref={desktopSidebarRef}
          className="hidden w-[var(--adm-sidebar-w)] shrink-0 lg:block"
          data-testid="admin-sidebar"
        >
          <AdminSidebar />
        </div>
        {drawerIsMounted(drawerPhase) ? (
          <div
            className="fixed inset-0 z-50 lg:hidden"
            data-state={drawerDataState(drawerPhase)}
            // Pha `closing`: panel còn trên màn hình nhưng không được ăn
            // click, nếu không người dùng bấm tiếp sẽ trúng một cái menu
            // đang biến đi.
            style={drawerIsInteractive(drawerPhase) ? undefined : { pointerEvents: "none" }}
          >
            <button
              type="button"
              aria-label="Đóng menu"
              className="adm-drawer-overlay absolute inset-0 bg-black/40"
              onClick={closeDrawer}
            />
            <div
              ref={drawerRef}
              id="admin-drawer"
              tabIndex={-1}
              role="dialog"
              aria-modal="true"
              aria-label="Điều hướng quản trị"
              className="adm-drawer-panel absolute inset-y-0 left-0 w-[var(--adm-sidebar-w)] shadow-xl outline-none"
              data-testid="admin-drawer-panel"
            >
              <AdminSidebar onNavigate={closeDrawer} />
            </div>
          </div>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <AdminHeader
            title={title}
            drawerOpen={drawerOpen}
            onToggleDrawer={() => (drawerOpen ? closeDrawer() : setDrawerPhase((phase) => nextDrawerPhase(phase, "open")))}
            triggerRef={menuTriggerRef}
          />
          {/* Đích của skip link, nên phải nhận được focus bằng chương trình. */}
          <main
            ref={mainRef}
            id="admin-main-content"
            tabIndex={-1}
            data-testid="admin-main-content"
            className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-[var(--adm-canvas)] p-4 outline-none md:p-6"
          >
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
              <NavLink
                to={adminPagePath(page)}
                className="adm-nav-item"
                onClick={onNavigate}
                data-testid={`adm-nav-${page.path}`}
              >
                {page.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div
        className="flex items-center gap-2.5 border-t border-[var(--adm-border)] px-4 py-4"
        data-testid="admin-sidebar-footer"
      >
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
  triggerRef,
}: {
  title: string
  drawerOpen: boolean
  onToggleDrawer: () => void
  triggerRef: RefObject<HTMLButtonElement | null>
}) {
  // Ngày kinh doanh đổi lúc 05:00, không phải 00:00: nhịp 60s là đủ.
  const now = useNow(60_000)
  return (
    <header className="flex h-[var(--adm-header-h)] shrink-0 items-center gap-3 border-b border-[var(--adm-border)] bg-[var(--adm-surface)] px-4 md:px-6">
      <button
        ref={triggerRef}
        type="button"
        className="grid size-10 shrink-0 place-items-center rounded-lg border border-[var(--adm-border)] lg:hidden"
        aria-label={drawerOpen ? "Đóng menu" : "Mở menu"}
        aria-expanded={drawerOpen}
        aria-controls="admin-drawer"
        data-testid="admin-menu-trigger"
        onClick={onToggleDrawer}
      >
        {drawerOpen ? <X className="size-5" /> : <Menu className="size-5" />}
      </button>
      <h1 className="adm-h1 truncate" data-testid="admin-page-title">
        {title}
      </h1>
      <span className="adm-body hidden whitespace-nowrap text-[var(--adm-text-muted)] sm:inline">
        {ADMIN_SHIFT_LABEL}
      </span>
      <span className="adm-body hidden font-medium whitespace-nowrap md:inline">{adminBusinessDateLabel(now)}</span>
    </header>
  )
}

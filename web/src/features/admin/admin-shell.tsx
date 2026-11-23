/**
 * TU-39 + Redesign P1 — Khung Trang Quản trị: sidebar 232px, header translucent,
 * mobile drawer với GSAP presence (interruptible, focus trap, inert, scroll lock).
 *
 * Khung này độc lập với `app/shell.tsx` của Lễ tân. Màn con cắm vào qua
 * `admin-routes.tsx` + `ADMIN_PAGES`; không màn nào cần sửa file này.
 */
import {
  BarChart3,
  BookOpenText,
  ClipboardCheck,
  LayoutDashboard,
  Menu,
  Scale,
  Settings,
  ShieldCheck,
  Users,
  X,
  type LucideIcon,
} from "lucide-react"
import { createContext, type RefObject, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { NavLink, Outlet, useLocation } from "react-router"
import { useBusinessShift, useNow } from "@/hooks/use-data"
import { MOTION, usePresenceController, useStableNodeRef } from "@/lib/motion"
import { SheetPresenceController } from "@/lib/motion-controller"
import { initials } from "@/lib/text"
import { visibleAdminPages } from "./admin-access"
import { adminBusinessDateLabel, adminShiftLabel } from "./admin-date"
import { ADMIN_DESKTOP_MEDIA_QUERY, resolveDrawerCloseFocusTarget, resolveTrapTarget } from "./admin-focus"
import { useAdminCardReveal } from "./admin-motion"
import { adminPageForPath, adminPagePath } from "./admin-pages"
import { useAdminSession } from "./use-admin-session"
import "./admin-theme.css"

const NAV_ICONS: Record<string, LucideIcon> = {
  overview: LayoutDashboard,
  reports: BarChart3,
  reconciliation: Scale,
  customers: Users,
  visits: BookOpenText,
  accounts: ShieldCheck,
  settings: Settings,
  audit: ClipboardCheck,
}

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
  const {
    isOpen: drawerOpen,
    present: drawerMounted,
    handleOpenChange: setDrawerOpen,
    markExited: markDrawerExited,
  } = usePresenceController({ defaultOpen: false })
  const [override, setOverride] = useState<string | null>(null)
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const drawerRef = useRef<HTMLDivElement>(null)
  const [drawerEl, drawerCallbackRef] = useStableNodeRef<HTMLDivElement>(drawerRef)
  const [drawerOverlayEl, drawerOverlayCallbackRef] = useStableNodeRef<HTMLButtonElement>()
  const desktopSidebarRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  const setTitle = useCallback((value: string | null) => setOverride(value), [])
  const titleApi = useMemo(() => ({ setTitle }), [setTitle])

  const page = adminPageForPath(location.pathname)
  const title = override ?? page?.title ?? "Quản trị"

  const setBackgroundInert = useCallback((inert: boolean) => {
    for (const el of [desktopSidebarRef.current, headerRef.current, mainRef.current]) {
      if (el) el.inert = inert
    }
  }, [])

  const closeDrawer = useCallback(() => {
    // Clear inert before restoring focus so the trigger is focusable immediately.
    setBackgroundInert(false)
    setDrawerOpen(false)
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
  }, [setBackgroundInert, setDrawerOpen])

  useAdminCardReveal(mainRef, location.pathname)

  useEffect(() => {
    if (!drawerOpen) {
      setBackgroundInert(false)
      return
    }
    setBackgroundInert(true)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    drawerRef.current?.focus()

    const desktopMedia = window.matchMedia(ADMIN_DESKTOP_MEDIA_QUERY)
    const onDesktopChange = (event: MediaQueryListEvent) => {
      if (event.matches) closeDrawer()
    }
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

    desktopMedia.addEventListener("change", onDesktopChange)
    window.addEventListener("keydown", onKey)
    return () => {
      desktopMedia.removeEventListener("change", onDesktopChange)
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = prevOverflow
      setBackgroundInert(false)
    }
  }, [closeDrawer, drawerOpen, setBackgroundInert])

  return (
    <AdminTitleContext.Provider value={titleApi}>
      <div className="admin-portal flex h-dvh min-h-0 w-full overflow-hidden" data-testid="admin-shell">
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
        {drawerMounted ? (
          <div
            className={`fixed inset-0 z-[var(--z-drawer)] lg:hidden ${drawerOpen ? "" : "pointer-events-none"}`}
            aria-hidden={!drawerOpen}
            inert={!drawerOpen}
          >
            <button
              ref={drawerOverlayCallbackRef}
              type="button"
              tabIndex={-1}
              aria-label="Đóng menu"
              className="absolute inset-0 bg-[var(--adm-scrim)]"
              onClick={closeDrawer}
            />
            <div
              ref={drawerCallbackRef}
              id="admin-drawer"
              tabIndex={-1}
              role="dialog"
              aria-modal="true"
              aria-label="Điều hướng quản trị"
              className="absolute inset-y-0 left-0 w-[var(--adm-sidebar-w)] shadow-[var(--shadow-drawer)] outline-none"
              data-testid="admin-drawer-panel"
            >
              <AdminSidebar onNavigate={closeDrawer} />
            </div>
            {drawerOverlayEl && drawerEl ? (
              <SheetPresenceController
                open={drawerOpen}
                side="left"
                duration={MOTION.duration.drawer}
                overlay={drawerOverlayEl}
                content={drawerEl}
                onExitComplete={markDrawerExited}
              />
            ) : null}
          </div>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <AdminHeader
            headerRef={headerRef}
            title={title}
            drawerOpen={drawerOpen}
            onToggleDrawer={() => (drawerOpen ? closeDrawer() : setDrawerOpen(true))}
            triggerRef={menuTriggerRef}
          />
          <main
            ref={mainRef}
            id="admin-main-content"
            tabIndex={-1}
            data-testid="admin-main-content"
            className="adm-content min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-[var(--adm-canvas)] p-[var(--gutter-page)] outline-none"
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
      <div className="flex items-center justify-between gap-2 border-b border-[var(--adm-border-subtle)] px-4 pt-5 pb-4">
        <div className="min-w-0">
          <span className="adm-h2 block tracking-[-0.02em] text-[var(--adm-brand-navy)]">21GAM</span>
          <span className="adm-caption block">Cổng quản trị</span>
        </div>
        <span className="rounded-full border border-[var(--adm-border)] bg-[var(--adm-surface-sunken)] px-2 py-0.5 text-[11px] font-semibold tracking-[0.02em] text-[var(--adm-text-muted)]">
          Quản trị
        </span>
      </div>
      <nav aria-label="Điều hướng quản trị" className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <ul className="grid gap-1">
          {pages.map((page) => {
            const Icon = NAV_ICONS[page.path]
            return (
              <li key={page.path}>
                <NavLink
                  to={adminPagePath(page)}
                  className="adm-nav-item gap-2.5"
                  onClick={onNavigate}
                  data-testid={`adm-nav-${page.path}`}
                >
                  {Icon ? <Icon className="size-4 shrink-0 opacity-75" aria-hidden /> : null}
                  <span className="truncate">{page.label}</span>
                </NavLink>
              </li>
            )
          })}
        </ul>
      </nav>
      <div className="border-t border-[var(--adm-border-subtle)] p-3" data-testid="admin-sidebar-footer">
        <div className="flex items-center gap-2.5 rounded-xl border border-[var(--adm-border-subtle)] bg-[var(--adm-surface-sunken)]/70 px-3 py-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--adm-tint-blue)] text-xs font-semibold text-[var(--adm-action-active)]">
            {initials(displayName)}
          </span>
          <span className="min-w-0 leading-tight">
            <span className="adm-h3 block truncate">{displayName}</span>
            <span className="adm-caption block truncate">{levelLabel}</span>
          </span>
        </div>
      </div>
    </div>
  )
}

function AdminHeader({
  headerRef,
  title,
  drawerOpen,
  onToggleDrawer,
  triggerRef,
}: {
  headerRef: RefObject<HTMLElement | null>
  title: string
  drawerOpen: boolean
  onToggleDrawer: () => void
  triggerRef: RefObject<HTMLButtonElement | null>
}) {
  // Ngày kinh doanh đổi ở mốc cắt ca (đọc từ cấu hình địa điểm), không phải 00:00: nhịp 60s là đủ.
  const now = useNow(60_000)
  const shift = useBusinessShift()
  const dateLabel = adminBusinessDateLabel(now, shift)
  const shiftLabel = adminShiftLabel(shift)
  return (
    <header
      ref={headerRef}
      className="adm-header sticky top-0 z-[var(--z-sticky)] flex shrink-0 items-center gap-3 border-b border-[var(--adm-border)] px-4 py-2.5 md:px-6 lg:px-8"
    >
      <button
        ref={triggerRef}
        type="button"
        className="grid size-11 shrink-0 place-items-center rounded-lg border border-[var(--adm-border)] bg-[var(--adm-surface)] text-[var(--adm-text)] shadow-xs transition-[background-color,border-color,transform] duration-[var(--duration-hover)] ease-[var(--ease-spring-default)] hover:border-[var(--adm-border-strong)] hover:bg-[var(--adm-surface-sunken)] focus-visible:border-[var(--adm-action)] focus-visible:ring-[3px] focus-visible:ring-[var(--adm-action)]/25 focus-visible:outline-none active:scale-[0.96] lg:hidden"
        aria-label={drawerOpen ? "Đóng menu" : "Mở menu"}
        aria-expanded={drawerOpen}
        aria-controls="admin-drawer"
        data-testid="admin-menu-trigger"
        onClick={onToggleDrawer}
      >
        {drawerOpen ? <X className="size-5" /> : <Menu className="size-5" />}
      </button>
      <div className="min-w-0 flex-1">
        <h1 className="adm-h1 truncate" data-testid="admin-page-title">
          {title}
        </h1>
        <p className="adm-caption truncate md:hidden" data-testid="admin-header-meta-compact">
          {shiftLabel} · {dateLabel}
        </p>
      </div>
      <div className="hidden shrink-0 items-center gap-2 md:flex">
        <span className="adm-supporting rounded-full border border-[var(--adm-border)] bg-[var(--adm-surface)] px-3 py-1 whitespace-nowrap">
          {shiftLabel}
        </span>
        <span className="adm-supporting rounded-full border border-[var(--adm-border)] bg-[var(--adm-surface-sunken)] px-3 py-1 font-medium whitespace-nowrap text-[var(--adm-text)]">
          {dateLabel}
        </span>
      </div>
    </header>
  )
}

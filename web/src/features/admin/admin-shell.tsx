import { Menu, X } from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { Link, Outlet, useLocation } from "react-router"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { useBusinessDate } from "@/hooks/use-data"
import { useMediaQuery } from "@/hooks/use-media"
import { useSession } from "@/state/session"
import {
  ADMIN_DESKTOP_MEDIA_QUERY,
  ADMIN_NAV_ITEMS,
  ADMIN_SHIFT_LABEL,
  formatAdminBusinessDate,
  resolveActiveAdminNavItem,
  resolveDrawerCloseFocusTarget,
  type AdminNavItem,
} from "./admin-config"
import { useAdminCan, useAdminRoleLabel } from "./admin-hooks"
import "./admin.css"

function useVisibleAdminNavItems(): AdminNavItem[] {
  const canReport = useAdminCan("report.read")
  const canCustomer = useAdminCan("customer.view_masked")
  const canUser = useAdminCan("user.read")
  const canAudit = useAdminCan("audit.read")

  const permissionMap: Record<string, boolean> = {
    "report.read": canReport,
    "customer.view_masked": canCustomer,
    "user.read": canUser,
    "audit.read": canAudit,
  }

  return ADMIN_NAV_ITEMS.filter((item) => permissionMap[item.permission] ?? false)
}

function SidebarContent({
  visibleItems,
  activeItemId,
  displayName,
  roleLabel,
  onNavigate,
  closeButton,
}: {
  visibleItems: AdminNavItem[]
  activeItemId?: string
  displayName: string
  roleLabel: string
  onNavigate?: () => void
  closeButton?: ReactNode
}) {
  return (
    <>
      <div className="admin-brand">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="admin-brand-title" data-testid="admin-brand-title">
              21GAM
            </p>
            <span className="admin-brand-subtitle" data-testid="admin-brand-subtitle">
              Quản trị
            </span>
          </div>
          {closeButton}
        </div>
      </div>

      <nav className="admin-nav" aria-label="Điều hướng quản trị" data-testid="admin-sidebar-nav">
        {visibleItems.map((item) => {
          const isActive = item.id === activeItemId
          return (
            <Link
              key={item.id}
              to={item.path}
              aria-current={isActive ? "page" : undefined}
              onClick={onNavigate}
              data-testid={`admin-nav-${item.id}`}
              className={`admin-nav-item${isActive ? " admin-nav-item-active" : ""}`}
            >
              <span>{item.navLabel}</span>
            </Link>
          )
        })}
      </nav>

      <div className="admin-sidebar-footer" data-testid="admin-sidebar-footer">
        <div className="admin-user-name" data-testid="admin-user-name" title={displayName}>
          {displayName}
        </div>
        <div className="admin-user-role" data-testid="admin-user-role">
          {roleLabel}
        </div>
      </div>
    </>
  )
}

export function AdminShell({ children }: { children?: ReactNode }) {
  const location = useLocation()
  const user = useSession((state) => state.user)
  const roleLabel = useAdminRoleLabel()
  const visibleItems = useVisibleAdminNavItems()
  const activeItem = resolveActiveAdminNavItem(location.pathname)
  const headerTitle = activeItem?.headerTitle ?? "Không tìm thấy trang"

  const businessDate = useBusinessDate()
  const formattedBusinessDate = formatAdminBusinessDate(businessDate)

  // Keying drawer open state to the current pathname closes the drawer automatically on navigation without an effect.
  const isDesktop = useMediaQuery(ADMIN_DESKTOP_MEDIA_QUERY)
  const [drawerPathname, setDrawerPathname] = useState<string | null>(null)
  const drawerOpen = !isDesktop && drawerPathname === location.pathname
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const drawerCloseRef = useRef<HTMLButtonElement>(null)
  const desktopSidebarRef = useRef<HTMLElement>(null)
  const mainRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return
    const mql = window.matchMedia(ADMIN_DESKTOP_MEDIA_QUERY)
    const handleChange = (event: MediaQueryListEvent) => {
      // Clear remembered pathname when crossing into desktop so shrinking back does not auto-reopen the Sheet.
      if (event.matches) {
        setDrawerPathname(null)
      }
    }
    mql.addEventListener("change", handleChange)
    return () => mql.removeEventListener("change", handleChange)
  }, [])

  const openDrawer = () => {
    if (!isDesktop) {
      setDrawerPathname(location.pathname)
    }
  }
  const closeDrawer = () => setDrawerPathname(null)

  return (
    <div className="admin-root admin-shell" data-testid="admin-shell">
      <a href="#admin-main-content" className="admin-skip-link" data-testid="admin-skip-link">
        Chuyển đến nội dung chính
      </a>

      {/* Persistent Desktop Sidebar (>= 1025px: 1366, 1440, 1920) */}
      <aside
        ref={desktopSidebarRef}
        className="admin-sidebar admin-sidebar-desktop"
        aria-label="Thanh bên quản trị"
        data-testid="admin-sidebar"
      >
        <SidebarContent
          visibleItems={visibleItems}
          activeItemId={activeItem?.id}
          displayName={user.displayName}
          roleLabel={roleLabel}
        />
      </aside>

      {/* Collapsible Tablet/Touch Modal Sheet Drawer (<= 1024px: 1024 landscape, 768/820 portrait) */}
      <Sheet
        open={drawerOpen}
        onOpenChange={(open) => setDrawerPathname(open && !isDesktop ? location.pathname : null)}
      >
        <SheetContent
          id="admin-mobile-drawer"
          side="left"
          aria-modal="true"
          showCloseButton={false}
          className="admin-root admin-drawer-panel w-[232px] max-w-[85vw] gap-0 p-0 sm:max-w-[232px]"
          data-testid="admin-drawer-panel"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            drawerCloseRef.current?.focus()
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            const target = resolveDrawerCloseFocusTarget({
              trigger: menuTriggerRef.current,
              isDesktop: window.matchMedia(ADMIN_DESKTOP_MEDIA_QUERY).matches,
              desktopSidebar: desktopSidebarRef.current,
              mainContent: mainRef.current,
            })
            target?.focus()
          }}
        >
          <SheetTitle className="sr-only">Điều hướng quản trị</SheetTitle>
          <SheetDescription className="sr-only">
            Chọn mục để điều hướng trong khu vực quản trị.
          </SheetDescription>
          <SidebarContent
            visibleItems={visibleItems}
            activeItemId={activeItem?.id}
            displayName={user.displayName}
            roleLabel={roleLabel}
            onNavigate={closeDrawer}
            closeButton={
              <button
                ref={drawerCloseRef}
                type="button"
                onClick={closeDrawer}
                aria-label="Đóng trình đơn quản trị"
                data-testid="admin-drawer-close"
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border"
                style={{
                  borderColor: "var(--admin-border)",
                  backgroundColor: "var(--admin-surface)",
                  color: "var(--admin-text-primary)",
                }}
              >
                <X className="size-5" aria-hidden="true" />
              </button>
            }
          />
        </SheetContent>
      </Sheet>

      {/* Main Column */}
      <div className="admin-main-column" data-testid="admin-main-column">
        <header className="admin-header" data-testid="admin-header">
          <div className="admin-header-start">
            <button
              ref={menuTriggerRef}
              type="button"
              className="admin-menu-trigger"
              onClick={() => (drawerOpen ? closeDrawer() : openDrawer())}
              aria-label="Mở trình đơn quản trị"
              aria-expanded={drawerOpen}
              aria-controls="admin-mobile-drawer"
              data-testid="admin-menu-trigger"
            >
              <Menu className="size-5" aria-hidden="true" />
            </button>
            <h1 className="admin-h1 m-0 truncate" data-testid="admin-page-title">
              {headerTitle}
            </h1>
          </div>

          <div className="admin-header-meta" data-testid="admin-header-meta">
            <span className="admin-header-shift" data-testid="admin-shift-label">
              {ADMIN_SHIFT_LABEL}
            </span>
            <span className="admin-header-date" data-testid="admin-business-date">
              {formattedBusinessDate}
            </span>
          </div>
        </header>

        <main
          ref={mainRef}
          id="admin-main-content"
          tabIndex={-1}
          className="admin-content"
          data-testid="admin-main-content"
        >
          {children ?? <Outlet />}
        </main>
      </div>
    </div>
  )
}

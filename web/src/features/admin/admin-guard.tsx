import { AlertTriangle, ArrowLeft, LoaderCircle, Lock, RotateCcw, ShieldAlert } from "lucide-react"
import { type ReactNode, useEffect } from "react"
import { Link, Navigate, Outlet, useLocation } from "react-router"
import type { Permission } from "@/domain/access"
import { portalLoginPath, resolvePortalLoginDestination } from "@/domain/auth-portal"
import { ROLE_LABEL } from "@/domain/enums"
import { LoginPage } from "@/features/auth/login-page"
import { api } from "@/services"
import { useSession } from "@/state/session"
import { ADMIN_NAV_ITEMS, getUserHomePath, isAdminPortalRole } from "./admin-config"
import { useAdminCan } from "./admin-hooks"
import "./admin.css"

/**
 * Layout-stable loading skeleton matching the exact 232px sidebar + 75px header geometry
 * so transitioning to the authenticated shell causes zero layout jump.
 */
export function AdminLoadingState() {
  return (
    <div
      className="admin-root admin-shell"
      role="status"
      aria-live="polite"
      aria-label="Đang kiểm tra phiên quản trị"
      data-testid="admin-loading-state"
    >
      <aside className="admin-sidebar admin-sidebar-desktop" aria-hidden="true">
        <div className="admin-brand">
          <p className="admin-brand-title">21GAM</p>
          <span className="admin-brand-subtitle">Quản trị</span>
        </div>
        <div className="admin-nav">
          {ADMIN_NAV_ITEMS.map((item) => (
            <div
              key={item.id}
              className="h-[42px] rounded-lg"
              style={{ backgroundColor: "var(--admin-surface-sunken)" }}
            />
          ))}
        </div>
      </aside>
      <div className="admin-main-column">
        <header className="admin-header">
          <div className="flex items-center gap-3">
            <LoaderCircle
              className="size-5 animate-spin"
              style={{ color: "var(--admin-action-blue)" }}
              aria-hidden="true"
            />
            <span className="admin-body-medium" style={{ color: "var(--admin-text-muted)" }}>
              Đang kiểm tra phiên đăng nhập Quản trị…
            </span>
          </div>
        </header>
        <div className="admin-content">
          <div
            className="h-44 rounded-xl border p-6"
            style={{
              backgroundColor: "var(--admin-surface)",
              borderColor: "var(--admin-border)",
            }}
          />
        </div>
      </div>
    </div>
  )
}

export function AdminErrorState({
  error,
  onRetry,
}: {
  error: string | null
  onRetry: () => void
}) {
  return (
    <main
      className="admin-root grid min-h-dvh place-items-center p-6"
      data-testid="admin-error-state"
    >
      <section
        className="grid w-full max-w-md gap-4 rounded-xl border p-6 text-center"
        style={{
          backgroundColor: "var(--admin-surface)",
          borderColor: "var(--admin-border)",
        }}
        role="alert"
      >
        <div
          className="mx-auto flex size-12 items-center justify-center rounded-full"
          style={{
            backgroundColor: "var(--admin-tint-amber)",
            color: "var(--admin-state-soon-ink)",
          }}
        >
          <AlertTriangle className="size-6" aria-hidden="true" />
        </div>
        <div>
          <h1 className="admin-h2">Không thể khôi phục phiên Quản trị</h1>
          <p className="admin-body mt-2" style={{ color: "var(--admin-text-muted)" }}>
            {error ?? "Phiên kết nối tới máy chủ bị gián đoạn. Vui lòng thử lại."}
          </p>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
          style={{
            backgroundColor: "var(--admin-action-blue)",
            color: "var(--admin-text-invert)",
          }}
        >
          <RotateCcw className="size-4" aria-hidden="true" />
          Thử lại
        </button>
      </section>
    </main>
  )
}

/**
 * Full-page "Không có quyền" screen for authenticated non-admin roles
 * (e.g. RECEPTIONIST, CASHIER, CUSTOMER_CARE). Never renders admin shell content.
 */
export function AdminForbiddenPage() {
  const user = useSession((state) => state.user)
  const roleLabel = ROLE_LABEL[user.role] ?? user.role
  const homePath = getUserHomePath(user.role)

  return (
    <main
      className="admin-root grid min-h-dvh place-items-center p-6"
      data-testid="admin-forbidden-page"
    >
      <section
        className="w-full max-w-lg rounded-xl border p-8"
        style={{
          backgroundColor: "var(--admin-surface)",
          borderColor: "var(--admin-border)",
        }}
        aria-labelledby="admin-forbidden-heading"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span
              className="text-lg font-bold tracking-tight"
              style={{ color: "var(--admin-brand-navy)" }}
            >
              21GAM
            </span>
            <span
              className="admin-label rounded px-2 py-0.5"
              style={{
                backgroundColor: "var(--admin-surface-sunken)",
                color: "var(--admin-text-muted)",
              }}
            >
              Quản trị
            </span>
          </div>
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium"
            style={{
              backgroundColor: "var(--admin-tint-red)",
              color: "var(--admin-state-late-ink)",
            }}
          >
            <ShieldAlert className="size-3.5" aria-hidden="true" />
            Truy cập bị từ chối
          </span>
        </div>

        <h1 id="admin-forbidden-heading" className="admin-h1 mt-6">
          Không có quyền truy cập
        </h1>

        <p className="admin-body mt-3" style={{ color: "var(--admin-text-muted)" }}>
          Tài khoản <strong style={{ color: "var(--admin-text-primary)" }}>{user.displayName}</strong>{" "}
          đang đăng nhập với vai trò{" "}
          <strong style={{ color: "var(--admin-text-primary)" }}>{roleLabel}</strong>. Khu vực Quản
          trị (<code>/admin</code>) chỉ dành cho vai trò{" "}
          <strong style={{ color: "var(--admin-text-primary)" }}>SuperAdmin</strong> và{" "}
          <strong style={{ color: "var(--admin-text-primary)" }}>Admin</strong>.
        </p>

        <div
          className="mt-6 rounded-lg border p-4"
          style={{
            backgroundColor: "var(--admin-canvas)",
            borderColor: "var(--admin-border)",
          }}
        >
          <p className="admin-label">Hướng dẫn</p>
          <p className="admin-body mt-1" style={{ color: "var(--admin-text-muted)" }}>
            Vui lòng quay về màn hình vận hành tương ứng với vai trò của bạn hoặc đăng nhập bằng tài
            khoản Quản trị tại cổng <code>/admin/login</code>.
          </p>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link
            to={homePath}
            data-testid="admin-forbidden-home-link"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium no-underline transition-opacity hover:opacity-95"
            style={{
              backgroundColor: "var(--admin-action-blue)",
              color: "var(--admin-text-invert)",
            }}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Về trang chính ({homePath})
          </Link>
        </div>
      </section>
    </main>
  )
}

/**
 * Guard for the entire `/admin` subtree:
 * 1. Unauthenticated -> redirects to `/admin/login` and renders the existing `LoginPage(portal="admin")` flow.
 * 2. Authenticated but not an admin-portal role (`OWNER` | `ADMIN`) -> renders `AdminForbiddenPage` ("Không có quyền") with a link to the user's home; never renders admin content.
 * 3. Authenticated admin -> renders child routes.
 */
export function AdminGuard({ children }: { children?: ReactNode }) {
  const status = useSession((state) => state.authStatus)
  const error = useSession((state) => state.authError)
  const bootstrap = useSession((state) => state.bootstrap)
  const user = useSession((state) => state.user)
  const portal = useSession((state) => state.portal)
  const location = useLocation()

  useEffect(() => {
    if (api.mode === "http" && status === "loading") {
      void bootstrap()
    }
  }, [bootstrap, status])

  if (status === "loading") {
    return <AdminLoadingState />
  }

  if (status === "error") {
    return <AdminErrorState error={error} onRetry={() => void bootstrap()} />
  }

  const isUnauthenticated = status === "anonymous" || !user || user.id <= 0
  if (isUnauthenticated) {
    const loginPath = portalLoginPath("admin")
    const requestedPath = `${location.pathname}${location.search}${location.hash}`
    return (
      <div
        className="admin-root"
        data-testid="admin-unauthenticated-redirect"
        data-redirect-to={loginPath}
      >
        {location.pathname !== loginPath ? (
          <Navigate to={loginPath} state={{ from: requestedPath }} replace />
        ) : null}
        <LoginPage portal="admin" redirectTo={requestedPath} />
      </div>
    )
  }

  const hasAdminRole = isAdminPortalRole(user.role)
  const isWrongPortal = api.mode === "http" && portal !== null && portal !== "admin"
  if (!hasAdminRole || isWrongPortal) {
    return <AdminForbiddenPage />
  }

  return <>{children ?? <Outlet />}</>
}

/**
 * Per-route permission guard inside the Admin shell.
 * Hidden menu items are not security: direct URL access to `/admin/accounts` or `/admin/audit`
 * is also blocked when the session lacks the required permission.
 */
export function AdminRoutePermissionGuard({
  permission,
  screenTitle,
  children,
}: {
  permission: Permission
  screenTitle: string
  children?: ReactNode
}) {
  const allowed = useAdminCan(permission)

  if (!allowed) {
    return (
      <section
        className="rounded-xl border p-8"
        style={{
          backgroundColor: "var(--admin-surface)",
          borderColor: "var(--admin-border)",
        }}
        role="alert"
        data-testid="admin-route-permission-denied"
      >
        <div className="flex items-start gap-4">
          <div
            className="flex size-11 shrink-0 items-center justify-center rounded-lg"
            style={{
              backgroundColor: "var(--admin-tint-red)",
              color: "var(--admin-state-late-ink)",
            }}
          >
            <Lock className="size-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <span
              className="inline-block rounded px-2 py-0.5 text-xs font-medium"
              style={{
                backgroundColor: "var(--admin-tint-red)",
                color: "var(--admin-state-late-ink)",
              }}
            >
              Không có quyền · Thiếu quyền {permission}
            </span>
            <h2 className="admin-h2 mt-2">
              Không có quyền truy cập mục &ldquo;{screenTitle}&rdquo;
            </h2>
            <p className="admin-body mt-2" style={{ color: "var(--admin-text-muted)" }}>
              Tài khoản Quản trị của bạn hiện không được cấp quyền <code>{permission}</code> từ máy
              chủ. Mục này đã bị khóa truy cập trực tiếp qua đường dẫn URL.
            </p>
            <div className="mt-5">
              <Link
                to="/admin/overview"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium no-underline"
                style={{
                  backgroundColor: "var(--admin-surface)",
                  borderColor: "var(--admin-border)",
                  color: "var(--admin-text-primary)",
                }}
              >
                <ArrowLeft className="size-4" aria-hidden="true" />
                Quay lại Tổng quan
              </Link>
            </div>
          </div>
        </div>
      </section>
    )
  }

  return <>{children}</>
}

export function AdminLoginRoute() {
  const status = useSession((state) => state.authStatus)
  const role = useSession((state) => state.user.role)
  const userId = useSession((state) => state.user.id)
  const location = useLocation()
  const searchParams = new URLSearchParams(location.search)
  const stateFrom =
    typeof location.state === "object" &&
    location.state !== null &&
    "from" in location.state &&
    typeof (location.state as { from?: unknown }).from === "string"
      ? (location.state as { from: string }).from
      : null
  const redirectTarget = resolvePortalLoginDestination(
    "admin",
    undefined,
    stateFrom ?? searchParams.get("redirect") ?? searchParams.get("next"),
  )

  if (status === "authenticated" && userId > 0 && isAdminPortalRole(role)) {
    return (
      <div
        data-testid="admin-login-authenticated-redirect"
        data-redirect-to={redirectTarget}
      >
        <Navigate to={redirectTarget} replace />
      </div>
    )
  }

  return (
    <div className="admin-root">
      <LoginPage portal="admin" redirectTo={redirectTarget} />
    </div>
  )
}

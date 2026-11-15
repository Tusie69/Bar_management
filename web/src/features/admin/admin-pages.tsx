import { ArrowLeft, CalendarClock, Clock3, Compass, Eye } from "lucide-react"
import { lazy, Suspense, type ReactNode } from "react"
import { Link, Navigate, useLocation } from "react-router"
import { Skeleton } from "@/components/ui/skeleton"
import { AccountsSection } from "@/features/settings/accounts-section"
import { ADMIN_NAV_ITEMS, type AdminNavItem } from "./admin-config"
import { AdminRoutePermissionGuard } from "./admin-guard"
import { useIsReadOnlyAdmin } from "./admin-hooks"

const ShiftOverviewPage = lazy(() => import("@/features/shift-overview"))
const TurnLedgerPage = lazy(() => import("@/features/turns"))

function ReadOnlyBanner() {
  const isReadOnly = useIsReadOnlyAdmin()
  if (!isReadOnly) return null

  return (
    <div
      className="mb-5 flex items-center gap-2.5 rounded-lg border px-4 py-2.5"
      style={{
        backgroundColor: "var(--admin-tint-blue)",
        borderColor: "var(--admin-border)",
        color: "var(--admin-brand-navy)",
      }}
      data-testid="admin-readonly-banner"
    >
      <Eye
        className="size-4 shrink-0"
        style={{ color: "var(--admin-action-blue)" }}
        aria-hidden="true"
      />
      <span className="admin-body">
        Chế độ <strong>Chỉ xem</strong> - Tài khoản của bạn chỉ xem dữ liệu, các thao tác chỉnh sửa
        đã được ẩn.
      </span>
    </div>
  )
}

export function AdminRouteFallback() {
  return (
    <div
      className="grid gap-4"
      role="status"
      aria-live="polite"
      aria-label="Đang tải nội dung"
      data-testid="admin-route-fallback"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-xl" />
    </div>
  )
}

/**
 * 01 · Tổng quan ca (/admin/overview)
 */
export function AdminOverviewPage() {
  return (
    <Suspense fallback={<AdminRouteFallback />}>
      <ShiftOverviewPage />
    </Suspense>
  )
}

/**
 * Index redirect `/admin` -> `/admin/overview`.
 */
export function AdminIndexRedirect() {
  return (
    <div data-testid="admin-index-redirect" data-redirect-to="/admin/overview">
      <Navigate to="/admin/overview" replace />
      <AdminRoutePermissionGuard permission="report.read" screenTitle="Tổng quan">
        <AdminOverviewPage />
      </AdminRoutePermissionGuard>
    </div>
  )
}

/**
 * 08 · Sổ lượt tới quán (/admin/turns)
 */
export function AdminTurnsPage() {
  return (
    <Suspense fallback={<AdminRouteFallback />}>
      <TurnLedgerPage />
    </Suspense>
  )
}

/**
 * 02 · Tài khoản (/admin/accounts)
 * Reuses existing `AccountsSection` while hiding mutation controls for READ_ONLY admins.
 */
export function AdminAccountsPage() {
  const isReadOnly = useIsReadOnlyAdmin()
  return (
    <div className="grid gap-5" data-testid="admin-accounts-page">
      <ReadOnlyBanner />
      <AccountsSection readOnly={isReadOnly} />
    </div>
  )
}

/**
 * 03 · Nhật ký (/admin/audit)
 * Empty/pending state until audit log screen is ready. No fake data or buttons.
 */
export function AdminAuditPlaceholderPage({ children }: { children?: ReactNode }) {
  if (children) {
    return <div data-testid="admin-audit-slot">{children}</div>
  }

  return (
    <div className="grid gap-6" data-testid="admin-audit-slot">
      <ReadOnlyBanner />

      <section
        className="rounded-xl border p-8"
        style={{
          backgroundColor: "var(--admin-surface)",
          borderColor: "var(--admin-border)",
        }}
        aria-labelledby="admin-audit-heading"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium"
            style={{
              backgroundColor: "var(--admin-tint-amber)",
              color: "var(--admin-state-soon-ink)",
            }}
          >
            <Clock3 className="size-3.5" aria-hidden="true" />
            Đang xây dựng
          </span>
        </div>

        <h2 id="admin-audit-heading" className="admin-h2 mt-4">
          Nhật ký thao tác Quản trị
        </h2>

        <p className="admin-body mt-2 max-w-2xl" style={{ color: "var(--admin-text-muted)" }}>
          Chức năng tra cứu nhật ký kiểm toán các thao tác nhạy cảm (tạo hoặc khóa tài khoản, xem
          số điện thoại đầy đủ và thay đổi cấu hình quán) đang được hoàn thiện.
        </p>
      </section>
    </div>
  )
}

/**
 * 04-07 · Báo cáo, Đối soát, Khách hàng, Cấu hình
 * Designed "Đợt 2 - Sprint 5" empty state, no fake data, no fake buttons.
 */
export function AdminDot2EmptyPage({ itemId }: { itemId: AdminNavItem["id"] }) {
  const item = ADMIN_NAV_ITEMS.find((candidate) => candidate.id === itemId)
  const title = item?.headerTitle ?? "Tính năng Quản trị"
  const summary =
    item?.summary ?? "Chức năng thuộc lộ trình phát triển Đợt 2 - Sprint 5 của phân hệ Quản trị."

  return (
    <div className="grid gap-6" data-testid={`admin-dot2-${itemId}`}>
      <ReadOnlyBanner />

      <section
        className="rounded-xl border p-8"
        style={{
          backgroundColor: "var(--admin-surface)",
          borderColor: "var(--admin-border)",
        }}
        aria-labelledby={`admin-dot2-heading-${itemId}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium"
            style={{
              backgroundColor: "var(--admin-surface-sunken)",
              color: "var(--admin-brand-navy)",
            }}
          >
            <CalendarClock className="size-3.5" aria-hidden="true" />
            Đợt 2 - Sprint 5
          </span>
        </div>

        <h2 id={`admin-dot2-heading-${itemId}`} className="admin-h2 mt-4">
          {title} · Đợt 2 - Sprint 5
        </h2>

        <p className="admin-body mt-2 max-w-2xl" style={{ color: "var(--admin-text-muted)" }}>
          {summary}
        </p>

        <div
          className="mt-6 rounded-lg border p-4"
          style={{
            backgroundColor: "var(--admin-canvas)",
            borderColor: "var(--admin-border)",
          }}
        >
          <p className="admin-label">Trạng thái phát hành</p>
          <p className="admin-body mt-1" style={{ color: "var(--admin-text-muted)" }}>
            Màn hình này thuộc lộ trình <strong>Đợt 2 - Sprint 5</strong> và hiện chưa kết nối dữ
            liệu hoặc thao tác trên hệ thống.
          </p>
        </div>
      </section>
    </div>
  )
}

/**
 * Unknown `/admin/*` route -> in-shell admin not-found page.
 */
export function AdminNotFoundPage() {
  const location = useLocation()

  return (
    <section
      className="rounded-xl border p-8"
      style={{
        backgroundColor: "var(--admin-surface)",
        borderColor: "var(--admin-border)",
      }}
      aria-labelledby="admin-not-found-heading"
      data-testid="admin-not-found-page"
    >
      <div className="flex items-center gap-2">
        <span
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium"
          style={{
            backgroundColor: "var(--admin-tint-red)",
            color: "var(--admin-state-late-ink)",
          }}
        >
          <Compass className="size-3.5" aria-hidden="true" />
          404 · Không tìm thấy trang
        </span>
      </div>

      <h2 id="admin-not-found-heading" className="admin-h2 mt-4">
        Không tìm thấy đường dẫn quản trị
      </h2>

      <p className="admin-body mt-2" style={{ color: "var(--admin-text-muted)" }}>
        Đường dẫn <code>{location.pathname}</code> không tồn tại trong phân hệ Quản trị.
      </p>

      <div className="mt-6">
        <Link
          to="/admin/overview"
          data-testid="admin-not-found-overview-link"
          className="inline-flex min-h-[44px] items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium no-underline"
          style={{
            backgroundColor: "var(--admin-action-blue)",
            color: "var(--admin-text-invert)",
          }}
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Về Tổng quan ca
        </Link>
      </div>
    </section>
  )
}

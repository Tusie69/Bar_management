/**
 * TU-39 — Điểm cắm màn con của Trang Quản trị.
 *
 * Thêm một màn hình admin = thêm một dòng vào `ADMIN_PAGE_COMPONENTS` ở dưới
 * (và một dòng vào `ADMIN_PAGES` nếu là route mới). Không ai phải sửa sidebar,
 * header hay router gốc. Mục chưa có component thì tự rơi về placeholder, nên
 * sidebar không bao giờ dẫn tới màn trắng.
 *
 * Hướng dẫn đầy đủ: docs/frontend.md.
 */
import { lazy, Suspense, type ComponentType } from "react"
import { Navigate, type RouteObject } from "react-router"
import { Skeleton } from "@/components/ui/skeleton"
import { AdminGuard, AdminPageGuard } from "./admin-guard"
import { ADMIN_HOME_PATH, ADMIN_PAGES, type AdminPage } from "./admin-pages"
import { AdminPlaceholder } from "./admin-placeholder"

/**
 * Shell nạp động: font Be Vietnam Pro và token riêng của Admin chỉ tải khi có
 * người thật sự mở `/admin`, không nằm trong bundle của máy lễ tân.
 */
const AdminShell = lazy(() => import("./admin-shell").then((module) => ({ default: module.AdminShell })))

/**
 * Khoá là `AdminPage.path`. Giá trị nên là `lazy(...)` để mỗi màn nằm trong
 * chunk riêng; khung Admin không phải tải code của màn chưa ai mở.
 *
 * Ví dụ khi NA-33 xong:
 *   overview: lazy(() => import("./pages/overview-page")),
 */
const ADMIN_PAGE_COMPONENTS: Partial<Record<string, ComponentType>> = {
  overview: lazy(() => import("@/features/shift-overview")), // NA-33 — 01 Tổng quan ca
  visits: lazy(() => import("@/features/turns")), // NA-34 — 08 Sổ lượt tới quán
  accounts: lazy(() => import("./pages/accounts-page")), // TU-34
  audit: lazy(() => import("./pages/audit-page")), // TU-35
}

function AdminPageFallback() {
  return (
    <div className="grid gap-3">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-24" />
      <Skeleton className="h-64" />
    </div>
  )
}

function renderAdminPage(page: AdminPage) {
  const Component = ADMIN_PAGE_COMPONENTS[page.path]
  const body = Component ? <Component /> : <AdminPlaceholder page={page} />
  return (
    <AdminPageGuard page={page}>
      <Suspense fallback={<AdminPageFallback />}>{body}</Suspense>
    </AdminPageGuard>
  )
}

function AdminUnknownRoute() {
  return (
    <section className="adm-card grid gap-2 p-6">
      <h2 className="adm-h2">Không tìm thấy trang</h2>
      <p className="adm-body text-[var(--adm-text-muted)]">
        Đường dẫn này không thuộc Trang Quản trị. Chọn một mục ở thanh bên để tiếp tục.
      </p>
    </section>
  )
}

/**
 * Route của toàn bộ `/admin`. `children` sinh từ registry, nên thứ tự và
 * đường dẫn luôn khớp sidebar.
 */
export const adminRoute: RouteObject = {
  path: "/admin",
  element: (
    <AdminGuard>
      <Suspense fallback={null}>
        <AdminShell />
      </Suspense>
    </AdminGuard>
  ),
  children: [
    { index: true, element: <Navigate to={ADMIN_HOME_PATH} replace /> },
    ...ADMIN_PAGES.map((page) => ({
      // Khớp cả URL con (`accounts/12`) để màn chi tiết của màn con không cần
      // khai báo thêm route ở tầng này.
      path: `${page.path}/*`,
      element: renderAdminPage(page),
    })),
    { path: "*", element: <AdminUnknownRoute /> },
  ],
}

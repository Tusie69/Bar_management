import { Route, Routes } from "react-router"
import { AdminGuard, AdminLoginRoute, AdminRoutePermissionGuard } from "./admin-guard"
import {
  AdminAccountsPage,
  AdminAuditPlaceholderPage,
  AdminDot2EmptyPage,
  AdminIndexRedirect,
  AdminNotFoundPage,
  AdminOverviewPage,
  AdminTurnsPage,
} from "./admin-pages"
import { AdminShell } from "./admin-shell"

function renderAdminShellChildRoutes() {
  return (
    <>
      <Route index element={<AdminIndexRedirect />} />
      <Route
        path="overview"
        element={
          <AdminRoutePermissionGuard permission="report.read" screenTitle="Tổng quan">
            <AdminOverviewPage />
          </AdminRoutePermissionGuard>
        }
      />
      <Route
        path="reports"
        element={
          <AdminRoutePermissionGuard permission="report.read" screenTitle="Báo cáo">
            <AdminDot2EmptyPage itemId="reports" />
          </AdminRoutePermissionGuard>
        }
      />
      <Route
        path="reconciliation"
        element={
          <AdminRoutePermissionGuard permission="report.read" screenTitle="Đối soát">
            <AdminDot2EmptyPage itemId="reconciliation" />
          </AdminRoutePermissionGuard>
        }
      />
      <Route
        path="customers"
        element={
          <AdminRoutePermissionGuard permission="customer.view_masked" screenTitle="Khách hàng">
            <AdminDot2EmptyPage itemId="customers" />
          </AdminRoutePermissionGuard>
        }
      />
      <Route
        path="turns"
        element={
          <AdminRoutePermissionGuard permission="report.read" screenTitle="Sổ lượt tới quán">
            <AdminTurnsPage />
          </AdminRoutePermissionGuard>
        }
      />
      <Route
        path="accounts"
        element={
          <AdminRoutePermissionGuard permission="user.read" screenTitle="Tài khoản">
            <AdminAccountsPage />
          </AdminRoutePermissionGuard>
        }
      />
      <Route
        path="settings"
        element={
          <AdminRoutePermissionGuard permission="report.read" screenTitle="Cấu hình">
            <AdminDot2EmptyPage itemId="settings" />
          </AdminRoutePermissionGuard>
        }
      />
      <Route
        path="audit"
        element={
          <AdminRoutePermissionGuard permission="audit.read" screenTitle="Nhật ký">
            <AdminAuditPlaceholderPage />
          </AdminRoutePermissionGuard>
        }
      />
      <Route path="*" element={<AdminNotFoundPage />} />
    </>
  )
}

/**
 * Single mountable React Router subtree component for `/admin`.
 * Works both when mounted under `<Route path="/admin/*" element={<AdminRoutes />} />`
 * and when rendered directly inside a router at `/admin/*`.
 */
export function AdminRoutes() {
  return (
    <Routes>
      <Route path="/admin/login" element={<AdminLoginRoute />} />
      <Route
        path="/admin"
        element={
          <AdminGuard>
            <AdminShell />
          </AdminGuard>
        }
      >
        {renderAdminShellChildRoutes()}
      </Route>
      <Route path="login" element={<AdminLoginRoute />} />
      <Route
        path="/"
        element={
          <AdminGuard>
            <AdminShell />
          </AdminGuard>
        }
      >
        {renderAdminShellChildRoutes()}
      </Route>
    </Routes>
  )
}

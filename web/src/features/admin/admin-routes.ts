import { createElement } from "react"
import type { RouteObject } from "react-router"
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

export const adminChildRouteObjects: RouteObject[] = [
  {
    index: true,
    element: createElement(AdminIndexRedirect),
  },
  {
    path: "overview",
    element: createElement(
      AdminRoutePermissionGuard,
      { permission: "report.read", screenTitle: "Tổng quan" },
      createElement(AdminOverviewPage),
    ),
  },
  {
    path: "reports",
    element: createElement(
      AdminRoutePermissionGuard,
      { permission: "report.read", screenTitle: "Báo cáo" },
      createElement(AdminDot2EmptyPage, { itemId: "reports" }),
    ),
  },
  {
    path: "reconciliation",
    element: createElement(
      AdminRoutePermissionGuard,
      { permission: "report.read", screenTitle: "Đối soát" },
      createElement(AdminDot2EmptyPage, { itemId: "reconciliation" }),
    ),
  },
  {
    path: "customers",
    element: createElement(
      AdminRoutePermissionGuard,
      { permission: "customer.view_masked", screenTitle: "Khách hàng" },
      createElement(AdminDot2EmptyPage, { itemId: "customers" }),
    ),
  },
  {
    path: "turns",
    element: createElement(
      AdminRoutePermissionGuard,
      { permission: "report.read", screenTitle: "Sổ lượt tới quán" },
      createElement(AdminTurnsPage),
    ),
  },
  {
    path: "accounts",
    element: createElement(
      AdminRoutePermissionGuard,
      { permission: "user.read", screenTitle: "Tài khoản" },
      createElement(AdminAccountsPage),
    ),
  },
  {
    path: "settings",
    element: createElement(
      AdminRoutePermissionGuard,
      { permission: "report.read", screenTitle: "Cấu hình" },
      createElement(AdminDot2EmptyPage, { itemId: "settings" }),
    ),
  },
  {
    path: "audit",
    element: createElement(
      AdminRoutePermissionGuard,
      { permission: "audit.read", screenTitle: "Nhật ký" },
      createElement(AdminAuditPlaceholderPage),
    ),
  },
  {
    path: "*",
    element: createElement(AdminNotFoundPage),
  },
]

/**
 * Top-level RouteObject entry matching `createBrowserRouter(routes)` in `web/src/app/app.tsx`.
 * Mount alongside the reception `/` root so `/admin/*` does not fall under reception redirects.
 */
export const adminRouteObject: RouteObject = {
  path: "/admin",
  children: [
    {
      path: "login",
      element: createElement(AdminLoginRoute),
    },
    {
      element: createElement(AdminGuard, null, createElement(AdminShell)),
      children: adminChildRouteObjects,
    },
  ],
}

import "./admin.css"

export {
  AdminErrorState,
  AdminForbiddenPage,
  AdminGuard,
  AdminLoadingState,
  AdminLoginRoute,
  AdminRoutePermissionGuard,
} from "./admin-guard"
export {
  AdminAccountsPage,
  AdminAuditPlaceholderPage,
  AdminDot2EmptyPage,
  AdminIndexRedirect,
  AdminNotFoundPage,
  AdminOverviewPage,
  AdminRouteFallback,
  AdminTurnsPage,
} from "./admin-pages"
export { AdminRoutes } from "./admin-router"
// oxlint-disable-next-line react/only-export-components -- barrel re-export of router RouteObject definitions alongside admin components
export { adminChildRouteObjects, adminRouteObject } from "./admin-routes"
export { AdminShell } from "./admin-shell"

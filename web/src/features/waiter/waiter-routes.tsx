/**
 * Module Phục vụ 1 — route của toàn bộ `/phucvu`.
 *
 * Route này phải đứng TRƯỚC route "/" trong router gốc: route đó bắt mọi URL
 * còn lại (`path: "*"` → `/floor`) và sẽ nuốt `/phucvu`. Cùng lý do mà
 * `adminRoute` đứng trước nó.
 *
 * Khung và các màn con được nạp động: Phục vụ dùng điện thoại và mạng quán,
 * nên code của khu vực này không nằm trong bundle đầu tiên của máy Lễ tân, và
 * ngược lại.
 */
import { lazy, Suspense } from "react"
import { Navigate, type RouteObject } from "react-router"
import { Skeleton } from "@/components/ui/skeleton"
import {
  WAITER_BASE_PATH,
  WAITER_LEGACY_BASE_PATH,
  WAITER_ORDERS_VIEW_PATH,
  WAITER_ORDER_PATH,
  WAITER_QUEUE_PATH,
} from "./waiter-access"
import { WaiterGuard } from "./waiter-guard"

const WaiterShell = lazy(() => import("./waiter-shell").then((module) => ({ default: module.WaiterShell })))
const WaiterPage = lazy(() => import("./waiter-page").then((module) => ({ default: module.WaiterPage })))
const WaiterMenuPage = lazy(() => import("@/features/waiter-menu/waiter-menu-page"))
const WaiterOrdersPage = lazy(() => import("@/features/waiter-menu/waiter-orders-page"))
const WaiterBarQueuePage = lazy(() => import("./waiter-bar-queue-page"))

function WaiterPageFallback() {
  return (
    <div className="grid gap-3 p-4">
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-[60dvh]" />
    </div>
  )
}

const page = (element: React.ReactNode) => <Suspense fallback={<WaiterPageFallback />}>{element}</Suspense>

export const waiterRoute: RouteObject = {
  path: WAITER_BASE_PATH,
  element: (
    <WaiterGuard>
      <Suspense fallback={null}>
        <WaiterShell />
      </Suspense>
    </WaiterGuard>
  ),
  children: [
    { index: true, element: page(<WaiterPage />) },
    { path: WAITER_ORDER_PATH, element: page(<WaiterMenuPage />) },
    { path: `${WAITER_ORDERS_VIEW_PATH}/:visitId`, element: page(<WaiterOrdersPage />) },
    { path: WAITER_QUEUE_PATH, element: page(<WaiterBarQueuePage />) },
    // Một URL con lạ dưới /phucvu về sơ đồ, không rơi ra ngoài khu vực Phục vụ.
    { path: "*", element: <Navigate to={WAITER_BASE_PATH} replace /> },
  ],
}

/**
 * URL cũ bằng tiếng Anh. Chỉ chuyển hướng; quyền vẫn do `WaiterGuard` và
 * backend quyết định, nên alias không cấp thêm gì.
 */
export const waiterLegacyRoute: RouteObject = {
  path: WAITER_LEGACY_BASE_PATH,
  element: <Navigate to={WAITER_BASE_PATH} replace />,
  children: [{ path: "*", element: <Navigate to={WAITER_BASE_PATH} replace /> }],
}

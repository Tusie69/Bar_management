import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { lazy, Suspense } from "react"
import { createBrowserRouter, Navigate, RouterProvider, useLocation } from "react-router"
import { ConfirmDialog, ConflictDialog, OverrideDialog } from "@/components/dialogs"
import { Skeleton } from "@/components/ui/skeleton"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { FloorPage } from "@/features/floor/floor-page"
import { AuthBoundary } from "@/features/auth/auth-boundary"
import { adminRoute } from "@/features/admin/admin-routes"
import { waiterLegacyRoute, waiterRoute } from "@/features/waiter/waiter-routes"
import { useRealtimeSync } from "@/hooks/use-data"
import { useIsMobile } from "@/hooks/use-mobile"
import { AppShell } from "./shell"
import { shouldUseMobileShell } from "./shell-mode"
import { useSession } from "@/state/session"
import { WAITER_HOME_PATH } from "@/features/waiter/waiter-access"
import { isPaymentAvailable } from "@/services/payment"

const OverviewPage = lazy(() => import("@/features/overview/overview-page"))
const ReservationsPage = lazy(() => import("@/features/reservations/reservations-page"))
const WaitlistPage = lazy(() => import("@/features/waitlist/waitlist-page"))
const GuestsPage = lazy(() => import("@/features/guests/guests-page"))
const ReportsPage = lazy(() => import("@/features/reports/reports-page"))
const SettingsPage = lazy(() => import("@/features/settings/settings-page"))
// Phone (< 768px) gets its own app: Mobile V1. Desktop/Tablet keep AppShell.
const MobileApp = lazy(() => import("@/features/mobile/mobile-app"))
const PreparationPage = lazy(() => import("@/features/preparation/preparation-page"))
const CancellationQueuePage = lazy(() => import("@/features/orders/cancellation-queue-page"))
const PaymentPage = lazy(() => import("@/features/payment/payment-page"))

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
})

function PageFallback() {
  return (
    <div className="grid gap-3 p-6">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-24" />
      <Skeleton className="h-64" />
    </div>
  )
}

const page = (el: React.ReactNode) => <Suspense fallback={<PageFallback />}>{el}</Suspense>

function Root() {
  const mobile = useIsMobile()
  const location = useLocation()
  const role = useSession((state) => state.user.role)
  const portal = useSession((state) => state.portal)
  // Module Phục vụ 1: Phục vụ có khu vực riêng và không dùng màn Điều phối.
  // `waiterRoute` đã bắt mọi URL dưới /phucvu, nên tới được đây nghĩa là tài
  // khoản Phục vụ đang ở một URL của vai khác — đưa họ về đúng khu vực của mình
  // thay vì render một màn hình họ không có dữ liệu để đọc.
  if (role === "WAITER") return <Navigate to={WAITER_HOME_PATH} replace />
  // L9: BAR có hai khu vực và cổng đăng nhập là thứ chọn giữa chúng. Một
  // Bartender đăng nhập ở `/phucvu` phải về khu vực Phục vụ; dòng cũ đẩy mọi
  // phiên BAR về `/chebien`, nên vừa đăng nhập xong là bị bật ra khỏi màn Gọi
  // món. Cổng preparation vẫn về `/chebien` như trước.
  if (role === "BAR" && portal === "waiter") return <Navigate to={WAITER_HOME_PATH} replace />
  if (role === "BAR" || role === "KITCHEN") return <Navigate to="/chebien" replace />
  if (role === "RECEPTIONIST" && location.pathname !== "/floor") return <Navigate to="/floor" replace />
  return shouldUseMobileShell(role, mobile) ? page(<MobileApp />) : <AppShell />
}

// Phone opens the role home (Tiếp đón / Tổng quan). Deep links keep their route.
function HomeIndex() {
  return <Navigate to={useIsMobile() ? "/home" : "/floor"} replace />
}

/** /home exists on phone only. */
function HomeRoute() {
  return useIsMobile() ? null : <Navigate to="/floor" replace />
}

const router = createBrowserRouter([
  { path: "/chebien", element: page(<PreparationPage />) },
  // Module Phục vụ 5: hàng chờ phê duyệt hủy món. Route riêng ở gốc, cùng lý do
  // thứ tự như /chebien: nó không thuộc khung của Lễ tân và cũng không thuộc
  // khu vực Phục vụ — người mở nó là người có quyền phê duyệt.
  { path: "/duyet-huy-mon", element: page(<CancellationQueuePage />) },
  // TU-39: Trang Quản trị có shell, sidebar và registry riêng. Nó đứng trước
  // route "/" vì route đó bắt mọi URL còn lại và sẽ nuốt /admin.
  adminRoute,
  // Module Phục vụ 1: khu vực Phục vụ, cùng lý do thứ tự như adminRoute.
  waiterRoute,
  waiterLegacyRoute,
  {
    path: "/",
    element: <Root />,
    children: [
      { index: true, element: <HomeIndex /> },
      { path: "home", element: <HomeRoute /> },
      { path: "overview", element: page(<OverviewPage />) },
      { path: "floor", element: <FloorPage /> },
      { path: "payment", element: isPaymentAvailable ? page(<PaymentPage />) : <Navigate to="/floor" replace /> },
      { path: "payment/:visitId", element: isPaymentAvailable ? page(<PaymentPage />) : <Navigate to="/floor" replace /> },
      { path: "payment/:visitId/:step", element: isPaymentAvailable ? page(<PaymentPage />) : <Navigate to="/floor" replace /> },
      { path: "reservations", element: page(<ReservationsPage />) },
      { path: "waitlist", element: page(<WaitlistPage />) },
      { path: "guests", element: page(<GuestsPage />) },
      { path: "reports", element: page(<ReportsPage />) },
      { path: "settings", element: page(<SettingsPage />) },
      { path: "*", element: <Navigate to="/floor" replace /> },
    ],
  },
])

function GlobalLayer() {
  useRealtimeSync()
  return (
    <>
      <ConflictDialog />
      <OverrideDialog />
      <ConfirmDialog />
    </>
  )
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <AuthBoundary>
          <GlobalLayer />
          <RouterProvider router={router} />
        </AuthBoundary>
        <Toaster position="top-center" richColors={false} closeButton visibleToasts={3} duration={3000} />
      </TooltipProvider>
    </QueryClientProvider>
  )
}

/**
 * TU-45 — route của khu vực Thanh toán.
 *
 * Đứng ở GỐC router, trước route "/", cùng lý do như `/chebien` và
 * `/duyet-huy-mon`: route "/" bắt mọi URL còn lại và sẽ nuốt `/thanh-toan`.
 *
 * Nạp động: màn này chạy trên máy Thu ngân và trên điện thoại, nên code của nó
 * không nằm trong bundle đầu tiên của máy Lễ tân.
 */
import { lazy, Suspense } from "react"
import { Navigate, type RouteObject } from "react-router"
import { Skeleton } from "@/components/ui/skeleton"
import { BILLING_BASE_PATH } from "./billing-access"

const BillListPage = lazy(() => import("./bill-list-page"))
const BillSessionDetail = lazy(() => import("./bill-session-detail"))

function BillingFallback() {
  return (
    <div className="grid gap-3 p-4">
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-[50dvh]" />
    </div>
  )
}

const page = (element: React.ReactNode) => <Suspense fallback={<BillingFallback />}>{element}</Suspense>

export const billingRoute: RouteObject = {
  path: BILLING_BASE_PATH,
  children: [
    { index: true, element: page(<BillListPage />) },
    { path: "phien/:visitId", element: page(<BillSessionDetail />) },
    // URL con lạ dưới /thanh-toan về danh sách, không rơi ra ngoài khu vực.
    { path: "*", element: <Navigate to={BILLING_BASE_PATH} replace /> },
  ],
}

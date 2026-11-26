import { useCallback } from "react"
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router"
import { isPaymentAvailable } from "@/services/payment"
import { useSession } from "@/state/session"
import { WaiterInvoiceWorkspace } from "@/features/waiter/waiter-invoice-views"
import {
  isMoneyViewParam,
  isWaiterBillRole,
  parseWaiterBillView,
  type WaiterBillView,
} from "@/features/waiter/waiter-invoice-model"
import "./css/waiter.css"

/**
 * Waiter & Bartender entry to session bill / Xem tạm tính / Xuất hóa đơn.
 * Never exposes S4-S7 money collection screens (method, cash, QR confirm, success).
 */
export default function WaiterPaymentPage() {
  const { visitId } = useParams<{ visitId: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const role = useSession((s) => s.user.role)

  const rawView = searchParams.get("view") ?? searchParams.get("step")
  const billCode = searchParams.get("bill")

  const handleNavigateView = useCallback(
    (nextView: WaiterBillView, nextBillCode?: string) => {
      if (!visitId) return
      const params = new URLSearchParams()
      if (nextView !== "detail") params.set("view", nextView)
      if (nextBillCode) params.set("bill", nextBillCode)
      const qs = params.toString()
      navigate(`/phucvu/phien/${visitId}/thanh-toan${qs ? `?${qs}` : ""}`)
    },
    [navigate, visitId],
  )

  if (!isPaymentAvailable || !visitId || !isWaiterBillRole(role)) {
    return <Navigate to="/phucvu" replace />
  }

  if (isMoneyViewParam(rawView)) {
    return <Navigate to="/phucvu" replace />
  }

  const view = parseWaiterBillView(rawView)

  return (
    <WaiterInvoiceWorkspace
      visitId={visitId}
      view={view}
      billCode={billCode}
      backLabel="Sơ đồ bàn"
      onBack={() => navigate("/phucvu")}
      onNavigateView={handleNavigateView}
    />
  )
}

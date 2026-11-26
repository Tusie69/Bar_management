import { Navigate, useParams, useSearchParams } from "react-router"
import { isPaymentAvailable } from "@/services/payment"
import { useSession } from "@/state/session"
import { PaymentFlowWorkspace } from "./payment-page"

const MONEY_VIEWS = new Set(["method", "cash", "qr", "success"])

/**
 * Waiter entry to S2/S3 (reached ONLY through the session detail on /phucvu).
 * Bartender gets NO payment screens. Waiter never sees S4-S7 money screens.
 */
export default function WaiterPaymentPage() {
  const { visitId } = useParams<{ visitId: string }>()
  const [searchParams] = useSearchParams()
  const role = useSession((s) => s.user.role)

  if (!isPaymentAvailable || role !== "WAITER") {
    return <Navigate to="/phucvu" replace />
  }

  const rawView = searchParams.get("view") ?? searchParams.get("step")
  if (rawView && MONEY_VIEWS.has(rawView)) {
    return <Navigate to="/phucvu" replace />
  }

  const step = rawView === "preview" ? "preview" : "detail"

  return (
    <PaymentFlowWorkspace
      visitIdParam={visitId}
      stepParam={step}
      homePath="/phucvu"
      backHomeLabel="Sơ đồ bàn"
    />
  )
}

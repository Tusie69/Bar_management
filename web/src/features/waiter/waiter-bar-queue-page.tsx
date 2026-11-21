import { useNavigate } from "react-router"
import { PreparationQueue } from "@/features/preparation/preparation-queue"
import { useWaiterSession } from "./use-waiter-session"
import { WAITER_HOME_PATH } from "./waiter-access"

export default function WaiterBarQueuePage() {
  const navigate = useNavigate()
  const session = useWaiterSession()
  return (
    <PreparationQueue
      station="BAR"
      canRead={session.can("preparation.bar.read")}
      canTransition={session.can("preparation.bar.transition")}
      canRetry={session.can("preparation.print.retry")}
      embedded
      onBack={() => navigate(WAITER_HOME_PATH)}
    />
  )
}

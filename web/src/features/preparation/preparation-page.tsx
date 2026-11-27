import { ReceiptText } from "lucide-react"
import { useCallback, useState } from "react"
import { Button } from "@/components/ui/button"
import { roleCan, type Permission } from "@/domain/access"
import { api } from "@/services"
import { isPaymentAvailable } from "@/services/payment"
import { useSession } from "@/state/session"
import { useWaiterCatalogQuery } from "@/features/waiter/use-waiter-floor"
import { isBarGuestSession } from "@/features/waiter/waiter-invoice-model"
import { BarBillDrawer } from "./bar-bill-drawer"
import { PreparationQueue } from "./preparation-queue"
import type { PreparationStation, PreparationTicket } from "./preparation-queue-data"
import { fixedPreparationStation } from "./preparation-layout"

export default function PreparationPage() {
  const role = useSession((state) => state.user.role)
  const permissions = useSession((state) => state.permissions)
  const logout = useSession((state) => state.logout)
  const fixedStation = fixedPreparationStation(role)
  const [station, setStation] = useState<PreparationStation>(fixedStation ?? "BAR")
  const [billOpen, setBillOpen] = useState(false)
  const [billVisitId, setBillVisitId] = useState<string | null>(null)
  const can = useCallback(
    (permission: Permission) => (api.mode === "http" ? permissions.includes(permission) : roleCan(role, permission)),
    [permissions, role],
  )
  const canBarBill = role === "BAR" && station === "BAR" && isPaymentAvailable
  const catalogQuery = useWaiterCatalogQuery(canBarBill)
  const isBarTicket = useCallback(
    (ticket: PreparationTicket) => isBarGuestSession({ tables: ticket.tableCodes }, catalogQuery.data?.tables),
    [catalogQuery.data?.tables],
  )

  return (
    <>
      <PreparationQueue
        station={station}
        canRead={can(`preparation.${station.toLowerCase()}.read` as Permission)}
        canTransition={can(`preparation.${station.toLowerCase()}.transition` as Permission)}
        canRetry={can("preparation.print.retry")}
        headerActions={
          canBarBill ? (
            <Button
              type="button"
              variant="outline"
              className="min-h-11 shrink-0 px-3"
              onClick={() => {
                setBillVisitId(null)
                setBillOpen(true)
              }}
            >
              <ReceiptText className="size-4" aria-hidden="true" />
              <span>Hóa đơn quầy Bar</span>
            </Button>
          ) : undefined
        }
        canOpenBill={canBarBill ? isBarTicket : undefined}
        onOpenBill={
          canBarBill
            ? (ticket) => {
                if (!isBarTicket(ticket)) return
                setBillVisitId(String(ticket.visitId))
                setBillOpen(true)
              }
            : undefined
        }
        stationControls={
          !fixedStation ? (
            <div className="flex gap-1 rounded-lg border border-border p-1">
              <Button
                className="min-h-11 px-3 xl:min-h-9"
                variant={station === "BAR" ? "default" : "ghost"}
                onClick={() => setStation("BAR")}
              >
                Bar
              </Button>
              <Button
                className="min-h-11 px-3 xl:min-h-9"
                variant={station === "KITCHEN" ? "default" : "ghost"}
                onClick={() => setStation("KITCHEN")}
              >
                Bếp
              </Button>
            </div>
          ) : undefined
        }
        onLogout={() => void logout()}
      />
      {canBarBill ? (
        <BarBillDrawer
          open={billOpen}
          initialVisitId={billVisitId}
          onClose={() => setBillOpen(false)}
        />
      ) : null}
    </>
  )
}

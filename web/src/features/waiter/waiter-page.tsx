/**
 * Module Phục vụ 1 — trang chủ `/phucvu`.
 *
 * Nội dung: ngày kinh doanh / ca hiện tại, sơ đồ chung của quán (Khu A, B, C
 * và Quầy Bar), và panel chi tiết bàn khi chạm vào một ô.
 *
 * Mọi hành động đi theo `visitId` của Phiên, không theo `tableId`: chạm vào ô
 * nào của một cụm ghép cũng mở đúng một Phiên chung, nên không thể sinh ra hai
 * đơn cho cùng một đoàn khách.
 */
import { AlertTriangle, LoaderCircle } from "lucide-react"
import { useMemo, useState } from "react"
import { useNavigate } from "react-router"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusLegend } from "@/features/floor/status-legend"
import { reportError } from "@/hooks/use-action"
import { useBusinessShift, useNow } from "@/hooks/use-data"
import { useIsMobile } from "@/hooks/use-mobile"
import { fmtBusinessDate, fmtBusinessShift } from "@/lib/time"
import { api } from "@/services"
import { useWaiterFloor } from "./use-waiter-floor"
import { useWaiterSession } from "./use-waiter-session"
import { waiterOrderPath, waiterOrdersViewPath } from "./waiter-access"
import { WaiterFloor } from "./waiter-floor"
import { isSplitRequest, type WaiterRearrangePlan } from "./waiter-rearrange"
import { buildWaiterSheetView, WaiterTableSheet } from "./waiter-table-sheet"

export function WaiterPage() {
  const session = useWaiterSession()
  const model = useWaiterFloor()
  const shift = useBusinessShift()
  const clientNow = useNow(30_000)
  const mobile = useIsMobile()
  const navigate = useNavigate()
  const [selectedTableId, setSelectedTableId] = useState<number | null>(null)
  const [pending, setPending] = useState(false)

  // Mốc của máy chủ khi đã có: "đã phục vụ 40 phút" phải giống nhau trên mọi
  // máy, kể cả máy đặt sai giờ.
  const now = model.serverNow ?? clientNow

  const state = selectedTableId === null ? undefined : model.states.get(selectedTableId)
  const view = useMemo(() => {
    if (selectedTableId === null) return null
    const table = model.byId.get(selectedTableId)
    const zone = model.zones.find((candidate) => candidate.id === table?.zoneId)
    return buildWaiterSheetView({
      tableId: selectedTableId,
      state,
      byId: model.byId,
      zoneName: zone?.name ?? "—",
      serverNow: now,
      canOrder: session.canCreateOrders,
      canRearrange: session.canRearrange,
    })
  }, [model.byId, model.zones, now, selectedTableId, session.canCreateOrders, session.canRearrange, state])

  const runRearrange = async (plan: WaiterRearrangePlan) => {
    if (plan.request === null) return
    setPending(true)
    try {
      if (isSplitRequest(plan.request)) {
        await api.splitGroup({ groupId: plan.request.groupId, keepTableIds: plan.request.keepTableIds })
        toast.success("Đã tách bàn.")
      } else {
        const result = await api.updateWaiterVisitTables(plan.request)
        toast.success(result.summary)
      }
      model.refetch()
      setSelectedTableId(null)
    } catch (error) {
      reportError(error)
      model.refetch()
    } finally {
      setPending(false)
    }
  }

  if (model.loading) {
    return (
      <div className="grid gap-3 p-4" role="status" aria-live="polite" aria-label="Đang tải sơ đồ bàn">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-[60dvh]" />
      </div>
    )
  }

  if (model.error) {
    return (
      <section className="mx-auto grid max-w-md gap-3 p-6 text-center">
        <AlertTriangle className="mx-auto size-8 text-amber-500" aria-hidden="true" />
        <h2 className="text-lg font-semibold">Không tải được sơ đồ bàn</h2>
        <p className="text-sm text-muted-foreground">
          Kiểm tra kết nối rồi thử lại. Sơ đồ luôn lấy từ máy chủ, nên không có bản cũ nào để hiện tạm.
        </p>
        <Button type="button" onClick={model.refetch}>
          <LoaderCircle className="size-4" aria-hidden="true" /> Thử lại
        </Button>
      </section>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/*
        Ngày kinh doanh, ca, và chú giải trạng thái gói trong MỘT dòng cao 44px.
        Chú giải dùng biến thể `badge` (nút tròn ⓘ, số đếm nằm trong popover)
        thay vì thẻ đầy đủ: trên điện thoại thẻ đó ăn ~130px chiều cao và cắt
        mất hàng bàn dưới cùng của sơ đồ.
      */}
      <div className="flex h-11 shrink-0 items-center gap-2 px-3">
        <p className="truncate text-sm font-semibold">{fmtBusinessDate(model.businessDate, "short")}</p>
        <p className="truncate text-xs text-muted-foreground tabular-nums">Ca {fmtBusinessShift(shift)}</p>
        <StatusLegend variant="badge" tables={model.tables} states={model.states} className="ml-auto" />
      </div>
      <div className="min-h-0 flex-1">
        <WaiterFloor
          tables={model.tables}
          zones={model.zones}
          states={model.states}
          groups={model.groups}
          now={now}
          selectedIds={selectedTableId === null ? [] : [selectedTableId]}
          onTableClick={setSelectedTableId}
          className="h-full"
        />
      </div>

      {view ? (
        <WaiterTableSheet
          open={selectedTableId !== null}
          onClose={() => setSelectedTableId(null)}
          side={mobile ? "bottom" : "right"}
          view={view}
          tables={model.tables}
          states={model.states}
          byId={model.byId}
          canMove={session.canMove}
          canCombine={session.canCombine}
          canSplit={session.canSplit}
          pending={pending}
          onOrder={() => view.capability.visitId !== null && navigate(waiterOrderPath(view.capability.visitId))}
          onViewOrders={() =>
            view.capability.visitId !== null && navigate(waiterOrdersViewPath(view.capability.visitId))
          }
          onRearrange={(plan) => void runRearrange(plan)}
        />
      ) : null}
    </div>
  )
}

export default WaiterPage

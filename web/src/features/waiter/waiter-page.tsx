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
import { AlertTriangle, ListOrdered, LoaderCircle } from "lucide-react"
import { useMemo, useState } from "react"
import { useNavigate } from "react-router"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { reportError } from "@/hooks/use-action"
import { useNow } from "@/hooks/use-data"
import { useIsMobile } from "@/hooks/use-mobile"
import { fmtBusinessDate, fmtBusinessShift } from "@/lib/time"
import { api } from "@/services"
import { outstandingPreparationCount } from "@/features/preparation/preparation-layout"
import { usePreparationQueue } from "@/features/preparation/preparation-queue-data"
import { useWaiterBusinessShift, useWaiterFloor } from "./use-waiter-floor"
import { useWaiterSession } from "./use-waiter-session"
import { WAITER_QUEUE_ABSOLUTE_PATH, waiterOrderPath, waiterOrdersViewPath } from "./waiter-access"
import { WaiterFloor } from "./waiter-floor"
import { waiterCellTones } from "./waiter-phase"
import { WaiterStatusLegend } from "./waiter-status-legend"
import { isSplitRequest, type WaiterRearrangePlan } from "./waiter-rearrange"
import { buildWaiterSheetView, WaiterTableSheet } from "./waiter-table-sheet"
import {
  WAITER_TOOLBAR_ACTION_CLASS,
  WAITER_TOOLBAR_CLASS,
  WAITER_TOOLBAR_TEXT_CLASS,
  WAITER_TOOLBAR_TEXT_ITEM_CLASS,
} from "./waiter-toolbar-layout"

export function WaiterQueueButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="outline"
      className="relative min-h-11 shrink-0 px-3"
      aria-label={`Hàng đợi Bar: ${count} phiếu chưa hoàn tất`}
      onClick={onClick}
    >
      <ListOrdered className="size-4" aria-hidden="true" /> Hàng đợi
      {count > 0 ? (
        <span
          className="tnum absolute -top-1 -right-1 grid min-w-5 place-items-center rounded-full bg-primary px-1 text-[11px] leading-5 font-semibold text-primary-foreground"
          aria-hidden="true"
        >
          {count}
        </span>
      ) : null}
    </Button>
  )
}

export function WaiterPage() {
  const session = useWaiterSession()
  const model = useWaiterFloor()
  const shift = useWaiterBusinessShift()
  const clientNow = useNow(30_000)
  const mobile = useIsMobile()
  const navigate = useNavigate()
  const canReadBarQueue = session.can("preparation.bar.read")
  // Chỉ badge poll. Khi mở màn hàng đợi, observer này unmount và màn đó dùng
  // SSE trên cùng query key, nên không có hai vòng tải lại cạnh tranh nhau.
  const barQueue = usePreparationQueue("BAR", canReadBarQueue, true)
  const barQueueCount = outstandingPreparationCount(barQueue.data?.tickets)
  const [selectedTableId, setSelectedTableId] = useState<number | null>(null)
  const [pending, setPending] = useState(false)

  // Mốc của máy chủ khi đã có: "đã phục vụ 40 phút" phải giống nhau trên mọi
  // máy, kể cả máy đặt sai giờ.
  const now = model.serverNow ?? clientNow

  // Tông màu sáu trạng thái, dựng một lần cho cả sơ đồ. Tính trong render của
  // từng ô bàn thì mỗi lần chạm vào sơ đồ lại dựng lại cả bảng màu.
  const cellTones = useMemo(() => waiterCellTones(model.states), [model.states])

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
        <h1 className="text-lg font-semibold">Không tải được sơ đồ bàn</h1>
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
      <h1 className="sr-only">Sơ đồ bàn phục vụ</h1>
      {/*
        Ngày kinh doanh, ca, và chú giải trạng thái gói trong MỘT dòng cao 44px.
        Chú giải dùng biến thể `badge` (nút tròn ⓘ, số đếm nằm trong popover)
        thay vì thẻ đầy đủ: trên điện thoại thẻ đó ăn ~130px chiều cao và cắt
        mất hàng bàn dưới cùng của sơ đồ.
      */}
      <div className={WAITER_TOOLBAR_CLASS}>
        <div className={WAITER_TOOLBAR_TEXT_CLASS}>
          <p className={`${WAITER_TOOLBAR_TEXT_ITEM_CLASS} text-sm font-semibold`}>
            {fmtBusinessDate(model.businessDate, "short")}
          </p>
          <p className={`${WAITER_TOOLBAR_TEXT_ITEM_CLASS} text-xs text-muted-foreground tabular-nums`}>
            Ca {fmtBusinessShift(shift)}
          </p>
        </div>
        {canReadBarQueue ? (
          <WaiterQueueButton count={barQueueCount} onClick={() => navigate(WAITER_QUEUE_ABSOLUTE_PATH)} />
        ) : null}
        <WaiterStatusLegend states={model.states} className={`ml-auto ${WAITER_TOOLBAR_ACTION_CLASS}`} />
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
          cellTones={cellTones}
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

/**
 * Module Phục vụ 1 — panel chi tiết bàn.
 *
 * Trên điện thoại là bottom sheet, trên màn lớn là drawer bên phải; cùng một
 * nội dung, chỉ khác phía mở ra (`Sheet` của dự án nhận `side`).
 *
 * Panel này KHÔNG có đường nào dẫn tới dữ liệu khách: nó chỉ đọc những trường
 * mà phép chiếu của Phục vụ mang về, và phép chiếu đó không có tên, số điện
 * thoại, nguồn đặt hay ghi chú booking. Không có `hideGuestNames` ở đây vì
 * không có gì để ẩn.
 *
 * Thứ tự hành động theo biên bản: Gọi món → Xem đơn đã gọi → Đổi/Ghép/Tách →
 * thông tin Phiên chỉ đọc. Thứ tự này là thứ tự tay người dùng đã học, nên nó
 * được giữ nguyên trong markup, không sắp lại theo trạng thái.
 */
import { ArrowLeftRight, ClipboardList, Columns3, Info, Scissors, UtensilsCrossed } from "lucide-react"
import { useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import type { FloorTableState, TableView } from "@/domain/models"
import { fmtTime } from "@/lib/time"
import { cn } from "@/lib/utils"
import {
  WAITER_PHASE_LABEL,
  waiterServedDuration,
  waiterTableCapability,
  type WaiterTableCapability,
} from "./waiter-access"
import {
  WAITER_REARRANGE_HINT,
  WAITER_REARRANGE_LABEL,
  waiterCurrentTables,
  waiterRearrangePlan,
  waiterTargetTables,
  type WaiterRearrangeMode,
  type WaiterRearrangePlan,
} from "./waiter-rearrange"

export interface WaiterSheetView {
  /** "A1" hoặc "Cụm G01" — tên mà Phục vụ gọi trên sàn. */
  title: string
  /** Mã các ô bàn thuộc Phiên, luôn hiện riêng từng ô theo quy tắc sơ đồ. */
  tableCodes: string[]
  zoneName: string
  capability: WaiterTableCapability
  guestCount: number | null
  openedAtLabel: string | null
  servedLabel: string | null
  /** Lượt khách thứ mấy của bàn trong ngày kinh doanh này. */
  turnCount: number | null
  /** Bàn đang thuộc cụm ghép nào, để Tách bàn có định danh cụm. */
  groupId: number | null
  visitVersion: number | null
  currentTableIds: number[]
}

/**
 * Dựng nội dung panel từ trạng thái đã chiếu. Hàm thuần, nên "bàn ghép mở đúng
 * một Phiên chung" kiểm được bằng một assert.
 */
export function buildWaiterSheetView(input: {
  tableId: number
  state: FloorTableState | undefined
  byId: Map<number, TableView>
  zoneName: string
  serverNow: Date | null
  canOrder: boolean
  canRearrange: boolean
}): WaiterSheetView {
  const { tableId, state, byId, zoneName, serverNow } = input
  const capability = waiterTableCapability(state, {
    canOrder: input.canOrder,
    canRearrange: input.canRearrange,
  })
  const currentTableIds = waiterCurrentTables(state)
  const claim = state?.claim ?? null
  const groupCode = claim?.groupDisplayCode ?? null
  const ownCode = byId.get(tableId)?.code ?? `#${tableId}`
  const startsAt = capability.phase === "serving" || capability.phase === "payment" ? (claim?.startsAt ?? null) : null
  return {
    title: groupCode && currentTableIds.length > 1 ? `Cụm ${groupCode}` : ownCode,
    tableCodes: currentTableIds.map((id) => byId.get(id)?.code ?? `#${id}`),
    zoneName,
    capability,
    guestCount: claim && capability.phase !== "empty" ? claim.partySize : null,
    openedAtLabel: startsAt ? fmtTime(startsAt) : null,
    servedLabel: startsAt && serverNow ? waiterServedDuration(startsAt, serverNow) : null,
    turnCount: state?.seatedTurnCount ?? null,
    groupId: currentTableIds.length > 1 ? (claim?.groupId ?? null) : null,
    visitVersion: claim?.version ?? null,
    currentTableIds,
  }
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm font-medium tabular-nums">{value}</dd>
    </div>
  )
}

export interface WaiterTableSheetBodyProps {
  view: WaiterSheetView
  tables: TableView[]
  states: Map<number, FloorTableState>
  byId: Map<number, TableView>
  canMove: boolean
  canCombine: boolean
  canSplit: boolean
  pending: boolean
  onOrder: () => void
  onViewOrders: () => void
  onRearrange: (plan: WaiterRearrangePlan) => void
}

/**
 * Thân panel, tách khỏi `Sheet` để test render được ở môi trường Node (dự án
 * chưa có jsdom; xem web/src/features/waiter/waiter-ui.test.ts).
 */
export function WaiterTableSheetBody({
  view,
  tables,
  states,
  byId,
  canMove,
  canCombine,
  canSplit,
  pending,
  onOrder,
  onViewOrders,
  onRearrange,
}: WaiterTableSheetBodyProps) {
  const [mode, setMode] = useState<WaiterRearrangeMode | null>(null)
  const [selected, setSelected] = useState<number[]>([])
  const { capability } = view

  const modes = useMemo<WaiterRearrangeMode[]>(() => {
    if (!capability.canRearrange) return []
    const available: WaiterRearrangeMode[] = []
    if (canMove) available.push("MOVE")
    if (canCombine) available.push("MERGE")
    if (canSplit && view.groupId !== null) available.push("SPLIT")
    return available
  }, [canCombine, canMove, canSplit, capability.canRearrange, view.groupId])

  const pickable = useMemo(() => {
    if (mode === null) return []
    if (mode === "SPLIT") return view.currentTableIds.map((id) => byId.get(id)).filter((t): t is TableView => !!t)
    return waiterTargetTables(tables, states, view.currentTableIds)
  }, [byId, mode, states, tables, view.currentTableIds])

  const plan = useMemo(
    () =>
      mode === null
        ? null
        : waiterRearrangePlan({
            mode,
            visitId: capability.visitId,
            version: view.visitVersion,
            groupId: view.groupId,
            currentTableIds: view.currentTableIds,
            selectedTableIds: selected,
            byId,
          }),
    [byId, capability.visitId, mode, selected, view.currentTableIds, view.groupId, view.visitVersion],
  )

  const toggle = (id: number) => {
    setSelected((current) => {
      if (mode === "MOVE") return current.includes(id) ? [] : [id]
      return current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    })
  }

  const openMode = (next: WaiterRearrangeMode) => {
    setMode(next)
    // Tách bàn mặc định giữ nguyên cả cụm, để người dùng BỎ bớt bàn thay vì
    // phải chọn lại từ đầu: nhả bàn là thao tác ít hơn giữ bàn.
    setSelected(next === "SPLIT" ? [...view.currentTableIds] : [])
  }

  return (
    <div className="grid gap-4" data-waiter-phase={capability.phase}>
      <section className="grid gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{WAITER_PHASE_LABEL[capability.phase]}</Badge>
          <span className="text-sm text-muted-foreground">{view.zoneName}</span>
        </div>
        {view.tableCodes.length > 1 ? (
          <p className="text-sm text-muted-foreground">{`Gồm các bàn ${view.tableCodes.join(", ")}`}</p>
        ) : null}
      </section>

      {capability.notice ? (
        <p className="flex gap-2 rounded-lg border border-border bg-surface-2 p-3 text-sm leading-relaxed" role="note">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>{capability.notice}</span>
        </p>
      ) : null}

      {/* Thứ tự hành động theo biên bản, giữ nguyên trong markup. */}
      <section className="grid gap-2">
        <Button
          type="button"
          className="h-12 w-full justify-center text-base"
          disabled={!capability.canOrder || pending}
          onClick={onOrder}
        >
          <UtensilsCrossed className="size-5" aria-hidden="true" /> Gọi món
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full justify-center"
          disabled={!capability.canViewOrders || pending}
          onClick={onViewOrders}
        >
          <ClipboardList className="size-4" aria-hidden="true" /> Xem đơn đã gọi
        </Button>

        {modes.length ? (
          <div className="grid gap-2 rounded-lg border border-border-subtle p-2">
            <p className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Đổi / Ghép / Tách bàn
            </p>
            <div className="grid grid-cols-3 gap-2">
              {modes.map((candidate) => (
                <Button
                  key={candidate}
                  type="button"
                  variant={mode === candidate ? "default" : "secondary"}
                  className="h-11"
                  disabled={pending}
                  onClick={() => (mode === candidate ? setMode(null) : openMode(candidate))}
                >
                  {candidate === "MOVE" ? (
                    <ArrowLeftRight className="size-4" aria-hidden="true" />
                  ) : candidate === "MERGE" ? (
                    <Columns3 className="size-4" aria-hidden="true" />
                  ) : (
                    <Scissors className="size-4" aria-hidden="true" />
                  )}
                  <span className="text-xs">{WAITER_REARRANGE_LABEL[candidate]}</span>
                </Button>
              ))}
            </div>

            {mode !== null ? (
              <div className="grid gap-2 px-1 pb-1">
                <p className="text-xs leading-relaxed text-muted-foreground">{WAITER_REARRANGE_HINT[mode]}</p>
                {pickable.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Không có bàn nào phù hợp lúc này.</p>
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    {pickable.map((table) => {
                      const active = selected.includes(table.id)
                      return (
                        <li key={table.id}>
                          <button
                            type="button"
                            aria-pressed={active}
                            disabled={pending}
                            onClick={() => toggle(table.id)}
                            className={cn(
                              "h-11 min-w-14 rounded-lg border px-3 text-sm font-medium",
                              active
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border bg-surface-1 text-foreground",
                            )}
                          >
                            {table.code}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
                {plan?.reason ? <p className="text-sm text-muted-foreground">{plan.reason}</p> : null}
                <Button
                  type="button"
                  className="h-11 w-full"
                  disabled={pending || !plan || plan.request === null}
                  onClick={() => plan && onRearrange(plan)}
                >
                  {plan?.summary || WAITER_REARRANGE_LABEL[mode]}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <dl className="divide-y divide-border-subtle border-t border-border-subtle pt-1">
        <InfoRow label="Khu vực" value={view.zoneName} />
        <InfoRow label="Bàn" value={view.tableCodes.join(", ") || "—"} />
        <InfoRow label="Số khách" value={view.guestCount === null ? "—" : `${view.guestCount} khách`} />
        <InfoRow label="Mở Phiên" value={view.openedAtLabel ?? "—"} />
        <InfoRow label="Đã phục vụ" value={view.servedLabel ?? "—"} />
        <InfoRow label="Trạng thái Phiên" value={WAITER_PHASE_LABEL[view.capability.phase]} />
        {view.turnCount !== null && view.turnCount > 0 ? (
          <InfoRow label="Lượt trong ca" value={`${view.turnCount}`} />
        ) : null}
      </dl>
    </div>
  )
}

export interface WaiterTableSheetProps extends WaiterTableSheetBodyProps {
  open: boolean
  onClose: () => void
  /** Điện thoại: mở từ dưới lên. Màn lớn: drawer bên phải. */
  side: "bottom" | "right"
}

export function WaiterTableSheet({ open, onClose, side, ...body }: WaiterTableSheetProps) {
  return (
    <Sheet open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetContent side={side} className={side === "bottom" ? "max-h-[85dvh] overflow-y-auto" : "overflow-y-auto"}>
        <SheetHeader>
          <SheetTitle>{body.view.title}</SheetTitle>
          <SheetDescription>Thông tin phục vụ của bàn. Không hiển thị thông tin khách.</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">
          <WaiterTableSheetBody {...body} />
        </div>
      </SheetContent>
    </Sheet>
  )
}

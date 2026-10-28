import { useNavigate } from "react-router"
import { GuardedButton } from "@/components/common"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { WAITLIST_STATUS_LABEL } from "@/domain/enums"
import { useNow, useOverview, useWaitlist } from "@/hooks/use-data"
import { businessDateOf, fmtBusinessDate, fmtTime, minutesBetween } from "@/lib/time"
import { cn } from "@/lib/utils"
import { useUi } from "@/state/ui"
import type { FloorModel } from "./use-floor-model"

const ACTIVE = ["WAITING", "CONTACTING", "OFFERED", "HOLD_ACTIVE"]

/** Right column when nothing is selected (v2): shift KPIs + waitlist. */
export function ShiftPanel({ model }: { model: FloorModel }) {
  const overview = useOverview()
  const now = useNow(15_000)
  const bd = model.floor?.businessDate ?? businessDateOf(now)
  const waitlist = useWaitlist(bd)
  const ui = useUi()
  const navigate = useNavigate()
  const o = overview.data
  const waiting = (waitlist.data ?? []).filter((e) => ACTIVE.includes(e.status))
  const kpis = o
    ? [
        { label: "Khách đang ngồi", value: o.seatedGuests, suffix: "khách", accent: true },
        {
          label: "Công suất",
          value: o.tablesInUse + o.barSeatsInUse,
          suffix: `/ ${o.tablesTotal + o.barSeatsTotal} vị trí`,
        },
        { label: "Sắp đến 60'", value: o.reservationsUpcoming60, suffix: "booking" },
        { label: "Danh sách chờ", value: o.waitlistAdvance + o.waitlistWalkIn, suffix: "nhóm" },
      ]
    : null

  return (
    <div className="flex h-full min-h-0 scrollbar-thin flex-col gap-6 overflow-y-auto bg-surface-1 p-5">
      <div className="flex shrink-0 flex-col gap-0.5">
        <h2 className="text-[15px] leading-tight font-semibold">Ca tối · {bd ? fmtBusinessDate(bd) : "..."}</h2>
        <p className="tnum text-xs text-tx-2">Cập nhật {fmtTime(now)} · 17:00 → 05:00</p>
      </div>
      {kpis ? (
        <div className="grid shrink-0 grid-cols-2 gap-px overflow-hidden rounded-sm border bg-border">
          {kpis.map((k) => (
            <div key={k.label} className="flex flex-col gap-1.5 bg-surface-1 p-4">
              <span className="text-xs text-tx-2">{k.label}</span>
              <span className="flex items-baseline gap-1.5">
                <span className={cn("tnum text-xl leading-7 font-semibold", k.accent && "text-primary-ink")}>
                  {k.value}
                </span>
                <span className="text-xs text-tx-3">{k.suffix}</span>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <Skeleton className="h-[196px] shrink-0" />
      )}
      <section className="flex shrink-0 flex-col">
        <div className="flex items-center gap-2 pb-2">
          <h3 className="text-sm font-semibold">Danh sách chờ</h3>
          <span className="tnum text-xs text-tx-3">{waiting.length}</span>
          <GuardedButton
            permission="waitlist.create"
            variant="outline"
            size="sm"
            className="ml-auto border-strong bg-transparent font-semibold"
            onClick={() => navigate("/waitlist?add=1")}
          >
            Thêm
          </GuardedButton>
        </div>
        {waiting.length === 0 ? (
          <p className="border-t py-3 text-xs text-tx-2">Không có khách chờ cho ngày này.</p>
        ) : (
          waiting.map((e) => {
            const hold = e.hold
            const mins = hold ? Math.abs(minutesBetween(now, hold.deadlineAt)) : 0
            const status = hold
              ? `Đang giữ ${hold.tableIds.map(model.label).join(" + ")} · ${hold.overdue ? `quá hạn ${mins}'` : `còn ${mins}'`}`
              : WAITLIST_STATUS_LABEL[e.status]
            return (
              <div key={e.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t py-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="truncate text-sm font-semibold text-tx-strong">
                    {e.displayName}
                    {e.phoneLast3 ? ` · ••• ${e.phoneLast3}` : ""}
                  </span>
                  <span className="tnum text-xs text-tx-2">
                    {e.partySize} khách ·{" "}
                    {e.kind === "WALK_IN"
                      ? "Walk-in"
                      : `Đặt trước${e.reservationExpectedAt ? ` ${fmtTime(e.reservationExpectedAt)}` : ""}`}{" "}
                    · chờ từ {fmtTime(e.queuedAt)}
                  </span>
                  <span
                    className={cn(
                      "tnum text-xs font-semibold",
                      hold ? (hold.overdue ? "text-st-late-ink" : "text-st-reserved-ink") : "text-tx-2",
                    )}
                  >
                    {status}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-w-[84px] border-strong bg-transparent font-semibold"
                  onClick={() =>
                    hold?.tableIds[0] ? ui.selectTable(hold.tableIds[0]) : navigate(`/waitlist?entry=${e.id}`)
                  }
                >
                  {hold ? "Xếp chỗ" : "Tìm bàn"}
                </Button>
              </div>
            )
          })
        )}
      </section>
    </div>
  )
}

import { CalendarPlus, Info, Link2 } from "lucide-react"
import { EmptyState, GuardedButton, PendingTag, SectionTitle } from "@/components/common"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import type { AvailabilityResult } from "@/domain/models"
import { fmtBusinessDate } from "@/lib/time"
import { cn } from "@/lib/utils"
import { useUi } from "@/state/ui"
import type { FloorModel } from "./use-floor-model"

export function AvailabilityPanel({
  model,
  result,
  loading,
  selection,
  setSelection,
}: {
  model: FloorModel
  result: AvailabilityResult | undefined
  loading: boolean
  selection: number[]
  setSelection: (ids: number[]) => void
}) {
  const ui = useUi()
  const available = (result?.tables ?? []).filter((t) => t.status === "available")
  const tablesOk = available.filter((a) => model.byId.get(a.tableId)?.kind === "TABLE")
  // A single bar seat is "too small" for 2+ guests but still free to combine with its neighbour.
  const seatsOk = (result?.tables ?? []).filter(
    (a) => (a.status === "available" || a.status === "too_small") && model.byId.get(a.tableId)?.kind === "BAR_SEAT",
  )
  const blocked = (result?.tables ?? []).filter((t) => t.status === "reserved" || t.status === "occupied_unknown_end")
  const selCapacity = selection.reduce((s, id) => s + (model.byId.get(id)?.capacity ?? 0), 0)
  const combos = model.catalog?.combinations ?? []

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b px-4 pt-4 pb-3">
        <p className="eyebrow">Khả dụng theo ngày giờ khách muốn</p>
        <h2 className="mt-1 text-lg font-bold">
          {fmtBusinessDate(ui.availDate)} · <span className="tnum">{ui.availTime}</span> · {ui.availParty} khách
        </h2>
        <p className="mt-2 flex gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Tính theo booking và giữ chỗ của ngày này, không suy ra từ trạng thái bàn hiện tại. Máy chủ kiểm tra lại khi
          xác nhận.
        </p>
      </header>
      <div className="min-h-0 flex-1 scrollbar-thin overflow-y-auto px-4 py-4">
        {loading && !result ? (
          <div className="grid gap-2">
            <Skeleton className="h-16" />
            <Skeleton className="h-24" />
          </div>
        ) : (
          <div className="grid gap-5">
            <dl className="grid grid-cols-3 gap-2 text-center">
              <Stat
                label="Bàn trống vừa"
                value={tablesOk.filter((a) => (model.byId.get(a.tableId)?.capacity ?? 0) >= ui.availParty).length}
              />
              <Stat label="Ghế Bar trống" value={seatsOk.length} />
              <Stat label="Đã có claim" value={blocked.length} />
            </dl>

            <section className="grid gap-2">
              <SectionTitle aside={<PendingTag>Cấu hình chờ xác nhận</PendingTag>}>Cấu hình ghép sẵn</SectionTitle>
              <ul className="grid gap-1.5">
                {combos.map((c) => {
                  const a = result?.combinations.find((x) => x.combinationId === c.id)
                  const selected =
                    c.memberIds.every((id) => selection.includes(id)) && selection.length === c.memberIds.length
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        disabled={!a?.available}
                        onClick={() => setSelection(selected ? [] : c.memberIds)}
                        className={cn(
                          "flex min-h-12 w-full items-center gap-3 rounded-lg border px-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                          selected ? "border-foreground bg-surface-2" : "hover:bg-surface-2",
                        )}
                      >
                        <Link2 className="size-4 text-muted-foreground" aria-hidden />
                        <span className="text-sm font-semibold">{c.displayName}</span>
                        <span className="ml-auto text-xs text-muted-foreground">{a?.reason ?? ""}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>

            <section className="grid gap-2">
              <SectionTitle>Vị trí đã chọn</SectionTitle>
              {selection.length === 0 ? (
                <EmptyState className="py-4" title="Chạm bàn hoặc ghế còn trống trên sơ đồ">
                  Có thể chọn nhiều bàn để ghép.
                </EmptyState>
              ) : (
                <div className="grid gap-3 rounded-xl border bg-surface-1 p-3">
                  <p className="text-base font-semibold">{selection.map((id) => model.label(id)).join(" + ")}</p>
                  <p className={cn("text-sm", selCapacity < ui.availParty ? "text-st-late" : "text-muted-foreground")}>
                    {selCapacity} chỗ cho {ui.availParty} khách
                    {selCapacity < ui.availParty ? ": chưa đủ, chọn thêm bàn" : ""}
                  </p>
                  <div className="flex gap-2">
                    <GuardedButton
                      permission="reservation.create"
                      className="flex-1"
                      onClick={() =>
                        ui.openBooking({
                          tableIds: selection,
                          date: ui.availDate,
                          time: ui.availTime,
                          party: ui.availParty,
                        })
                      }
                    >
                      <CalendarPlus /> Đặt các vị trí này
                    </GuardedButton>
                    <Button variant="ghost" onClick={() => setSelection([])}>
                      Bỏ chọn
                    </Button>
                  </div>
                </div>
              )}
              <GuardedButton
                permission="reservation.create"
                variant="outline"
                onClick={() => ui.openBooking({ date: ui.availDate, time: ui.availTime, party: ui.availParty })}
              >
                Nhận trước, xếp bàn sau
              </GuardedButton>
            </section>

            {blocked.length ? (
              <section className="grid gap-2">
                <SectionTitle>Không khả dụng lúc này</SectionTitle>
                <ul className="grid gap-1 text-sm">
                  {blocked.slice(0, 12).map((b) => (
                    <li key={b.tableId} className="flex gap-3">
                      <span className="w-14 shrink-0 font-semibold">{model.label(b.tableId)}</span>
                      <span className="text-muted-foreground">{b.reason}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-subtle">
                  Chính sách giữ bàn: {result?.policy} (chờ PO duyệt). Có thể thêm khách vào danh sách chờ với bàn mong
                  muốn.
                </p>
              </section>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-surface-1 px-2 py-2.5">
      <dd className="tnum text-2xl font-semibold">{value}</dd>
      <dt className="text-[11px] leading-tight text-muted-foreground">{label}</dt>
    </div>
  )
}

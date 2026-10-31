import { AlertCircle, Check, Eye, MousePointerClick, Radio, Search, X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { EmptyState, Stepper } from "@/components/common"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import type { ZoneCode } from "@/domain/venue-layout"
import { useAvailability, useNow } from "@/hooks/use-data"
import { useMediaQuery } from "@/hooks/use-media"
import { atBusinessTime, businessDateOf, fmtBusinessDate, MS } from "@/lib/time"
import { cn } from "@/lib/utils"
import { isApiError } from "@/services"
import { useUi } from "@/state/ui"
import { AvailabilityPanel } from "./availability-panel"
import { BookingList, BookingTable, LIST_TABS, useBookingItems, type ListTab } from "./booking-list"
import { FloorCanvas } from "./floor-canvas"
import { FloorTimeline } from "./floor-timeline"
import { FloorToolbar, TimeField } from "./floor-toolbar"
import { draftPickable, QuickForm } from "./quick-form"
import { ShiftPanel } from "./shift-panel"
import { TableDetail } from "./table-detail"
import { useFloorModel } from "./use-floor-model"

const ZONE_TABS: { value: ZoneCode | "ALL"; label: string }[] = [
  { value: "ALL", label: "Tất cả" },
  { value: "A", label: "Khu A" },
  { value: "B", label: "Khu B" },
  { value: "C", label: "Khu C" },
  { value: "BAR", label: "Bar" },
]

function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string; count?: number }[]
  label: string
}) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-0.5 rounded-sm border bg-surface-1 p-[3px]">
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex h-[34px] items-center gap-1.5 rounded-sm px-3 text-sm whitespace-nowrap",
              on ? "bg-primary-tint font-medium text-primary-ink" : "text-tx-2 hover:text-tx-1",
            )}
          >
            {o.label}
            {o.count !== undefined ? <span className="tnum text-xs text-tx-3">{o.count}</span> : null}
          </button>
        )
      })}
    </div>
  )
}

/** Điều phối (v2): toolbar · booking list | workspace (list / timeline / map) | shift or table panel. */
export function FloorPage() {
  const model = useFloorModel()
  const ui = useUi()
  const now = useNow(1000)
  const wide = useMediaQuery("(min-width: 1024px)")
  const xl = useMediaQuery("(min-width: 1280px)")
  const [listOpen, setListOpen] = useState(false)
  const [tab, setTab] = useState<ListTab>("attn")
  // Leaving Điều phối drops the inline draft so the shell sheets do not pop open elsewhere.
  useEffect(
    () => () => {
      const s = useUi.getState()
      if (s.draft) (s.draft.kind === "booking" ? s.closeBooking : s.closeWalkIn)()
    },
    [],
  )
  const availKey = `${ui.availDate}|${ui.availTime}|${ui.floorMode}`
  const [availSelState, setAvailSelState] = useState<{ key: string; ids: number[] }>({ key: "", ids: [] })
  const availSel = availSelState.key === availKey ? availSelState.ids : []
  const setAvailSel = (next: number[] | ((prev: number[]) => number[])) =>
    setAvailSelState((s) => {
      const prev = s.key === availKey ? s.ids : []
      return { key: availKey, ids: typeof next === "function" ? next(prev) : next }
    })

  const live = ui.floorMode === "live"
  const today = model.floor?.businessDate ?? businessDateOf(now)
  const date = live ? today : ui.availDate
  const draft = ui.draft
  const view = ui.pick || draft ? "map" : ui.view
  const feed = useBookingItems(model, date, live, Math.floor(now.getTime() / MS.MIN))

  const availAt = useMemo(() => atBusinessTime(ui.availDate, ui.availTime), [ui.availDate, ui.availTime])
  const availability = useAvailability(live ? null : availAt, ui.availParty)
  const availMap = useMemo(
    () => new Map((availability.data?.tables ?? []).map((t) => [t.tableId, t])),
    [availability.data],
  )
  const draftAt = useMemo(
    () => (draft?.kind === "booking" ? atBusinessTime(draft.date, draft.time) : null),
    [draft?.kind, draft?.date, draft?.time],
  )
  const draftAvail = useAvailability(draftAt, draft?.party ?? 2)
  const draftAvailMap = useMemo(
    () => new Map((draftAvail.data?.tables ?? []).map((t) => [t.tableId, t])),
    [draftAvail.data],
  )

  const pickable = useMemo(() => {
    if (!ui.pick) return null
    const set = new Set(model.freeIds)
    ui.pick.excludeIds?.forEach((id) => set.delete(id))
    return set
  }, [ui.pick, model.freeIds])

  const selectedIds = draft
    ? draft.tableIds
    : ui.pick
      ? ui.pickSelection
      : !live
        ? availSel
        : ui.selectedTableId
          ? [ui.selectedTableId]
          : []

  const onTableClick = (id: number) => {
    if (draft) {
      if (draft.tableIds.includes(id) || draftPickable(draft.kind, id, model, draftAvail.data))
        return ui.toggleDraftTable(id)
      return toast.info(`${model.label(id)}: không trống · chọn vị trí trống`)
    }
    if (ui.pick) return ui.togglePick(id)
    if (!live) {
      const status = availMap.get(id)?.status
      if (status !== "available" && status !== "spare" && status !== "too_small") return
      setAvailSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
      return
    }
    ui.selectTable(ui.selectedTableId === id ? null : id)
  }

  const panel = draft ? (
    <QuickForm model={model} availability={draftAvail.data} />
  ) : !live ? (
    <AvailabilityPanel
      model={model}
      result={availability.data}
      loading={availability.isFetching}
      selection={availSel}
      setSelection={setAvailSel}
    />
  ) : ui.selectedTableId ? (
    <TableDetail tableId={ui.selectedTableId} model={model} onBack={() => ui.selectTable(null)} />
  ) : (
    <ShiftPanel model={model} />
  )

  // v2: the timeline gets the full width until a row is picked.
  const showRight = wide && (!!draft || view !== "timeline" || !live || !!ui.selectedTableId)
  const bottomOpen = !wide && (!!draft || (live && !!ui.selectedTableId && !ui.pick) || (!live && availSel.length > 0))
  const bookingDraft = draft?.kind === "booking" ? draft : null

  const counts = model.counts
  const summary =
    view === "list"
      ? `${feed[tab].length} mục`
      : bookingDraft
        ? `Khả dụng ${bookingDraft.time} · ${fmtBusinessDate(bookingDraft.date, "short")} · ${bookingDraft.party} khách`
        : live
          ? `${model.tables.length} vị trí · ${counts.seated ?? 0} đang dùng · ${counts.free ?? 0} trống`
          : `Xem trước ${ui.availTime} · ${ui.availParty} khách`

  const list = <BookingList feed={feed} tab={tab} setTab={setTab} model={model} live={live} />

  return (
    <div className="flex h-full min-h-0 flex-col">
      <FloorToolbar onOpenList={xl ? undefined : () => setListOpen(true)} />
      {!live ? (
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-dashed border-strong bg-surface-1 px-4 py-1.5 text-sm"
          role="status"
        >
          <span className="inline-flex items-center gap-1.5 font-medium">
            <Eye className="size-4 text-muted-foreground" aria-hidden />
            Xem trước · {fmtBusinessDate(ui.availDate, "short")}
          </span>
          <TimeField value={ui.availTime} onChange={(time) => ui.setAvailability({ time })} className="h-9 w-[96px]" />
          <Stepper
            value={ui.availParty}
            onChange={(party) => ui.setAvailability({ party })}
            label="số khách"
            size="sm"
          />
          <span className="text-muted-foreground">Chạm bàn trống để chọn vị trí.</span>
          <Button variant="ghost" size="sm" className="ml-auto h-8 gap-1.5" onClick={() => ui.setFloorMode("live")}>
            <Radio className="size-3.5" /> Về Live
          </Button>
        </div>
      ) : null}

      <div className="relative flex min-h-0 flex-1">
        {xl && view !== "list" ? (
          <aside className="w-1/4 max-w-[336px] min-w-[288px] shrink-0 border-r" aria-label="Danh sách booking">
            {list}
          </aside>
        ) : null}

        <section className="flex min-w-0 flex-1 flex-col gap-3 px-4 pt-3.5 pb-4" aria-label="Không gian làm việc">
          <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-3">
            {view === "list" ? (
              <Segmented
                label="Lọc booking"
                value={tab}
                onChange={setTab}
                options={LIST_TABS.map((t) => ({ value: t.id, label: t.label, count: feed[t.id].length }))}
              />
            ) : (
              <Segmented label="Lọc khu" value={ui.zone} onChange={ui.setZone} options={ZONE_TABS} />
            )}
            {live && view === "map" && !ui.pick && !draft ? (
              <Button variant="ghost" size="sm" onClick={() => ui.setFloorMode("availability")}>
                <Search /> Xem khả dụng
              </Button>
            ) : null}
            <span className="tnum ml-auto text-xs whitespace-nowrap text-tx-2">{summary}</span>
          </div>

          {view === "map" ? (
            <div className="relative min-h-0 flex-1 overflow-hidden rounded-sm border">
              {model.error ? (
                <div className="grid h-full place-items-center p-6">
                  <EmptyState
                    title="Lỗi tải dữ liệu sơ đồ bàn"
                    icon={<AlertCircle className="size-6 text-destructive" />}
                  >
                    {isApiError(model.error)
                      ? model.error.message
                      : model.error instanceof Error
                        ? model.error.message
                        : "Không thể tải sơ đồ bàn"}
                  </EmptyState>
                </div>
              ) : model.loading || !model.catalog ? (
                <div className="grid h-full place-items-center p-6">
                  <Skeleton className="aspect-[589/754] h-full max-h-[640px]" />
                </div>
              ) : (
                <FloorCanvas
                  tables={model.tables}
                  zones={model.catalog.zones}
                  mode={bookingDraft ? "availability" : draft ? "live" : ui.floorMode}
                  states={model.states}
                  availability={bookingDraft ? draftAvailMap : availMap}
                  groups={live && !bookingDraft ? model.floor?.groups : []}
                  selectedIds={selectedIds}
                  pickable={draft ? null : pickable}
                  zoneFocus={ui.zone}
                  now={now}
                  onTableClick={onTableClick}
                  onBackgroundClick={() => !ui.pick && !draft && live && ui.selectTable(null)}
                  ariaLabel={
                    bookingDraft
                      ? `Sơ đồ khả dụng lúc ${bookingDraft.time} để chọn bàn`
                      : live
                        ? "Sơ đồ bàn, trạng thái hiện tại"
                        : `Sơ đồ khả dụng lúc ${ui.availTime}`
                  }
                />
              )}
              <PickBanner model={model} />
              {draft ? (
                <div
                  className="pointer-events-none absolute top-3 left-1/2 z-10 flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-2 rounded-sm border border-strong bg-popover/95 px-3 py-2 text-sm shadow-float backdrop-blur"
                  aria-live="polite"
                >
                  <MousePointerClick className="size-4 shrink-0 text-primary-ink" aria-hidden />
                  <span className="truncate">
                    {draft.tableIds.length
                      ? `Đã chọn ${draft.tableIds.map((id) => model.label(id)).join(", ")} · chạm để thêm hoặc bỏ`
                      : "Chạm vị trí trống để gán bàn cho đơn"}
                  </span>
                </div>
              ) : null}
            </div>
          ) : view === "timeline" ? (
            <FloorTimeline model={model} date={date} now={now} zone={ui.zone} live={live} />
          ) : (
            <BookingTable feed={feed} tab={tab} model={model} live={live} />
          )}
        </section>

        {showRight ? (
          <aside
            className="w-[26%] max-w-[372px] min-w-[340px] shrink-0 border-l bg-surface-1"
            aria-label="Bảng điều phối"
          >
            {panel}
          </aside>
        ) : null}

        {bottomOpen ? (
          <section
            className="absolute inset-x-0 bottom-0 z-20 flex max-h-[62%] animate-in flex-col overflow-hidden rounded-t-sm border-t border-strong bg-popover shadow-float duration-200 slide-in-from-bottom-6"
            aria-label="Chi tiết"
          >
            <div className="flex justify-center pt-2" aria-hidden>
              <span className="h-1 w-10 rounded-full bg-strong" />
            </div>
            {!live && !draft ? (
              <Button
                variant="ghost"
                size="icon-sm"
                className="absolute top-1.5 right-2 z-10"
                aria-label="Đóng chi tiết"
                onClick={() => setAvailSel([])}
              >
                <X />
              </Button>
            ) : null}
            <div className="min-h-0 flex-1">{panel}</div>
          </section>
        ) : null}
      </div>

      {!xl ? (
        <Sheet open={listOpen} onOpenChange={setListOpen}>
          <SheetContent side="left" className="w-[min(92vw,360px)] gap-0 p-0">
            <SheetTitle className="sr-only">Danh sách booking</SheetTitle>
            <SheetDescription className="sr-only">Cần xử lý, sắp đến, tất cả booking trong ca</SheetDescription>
            <div
              className="h-full"
              onClickCapture={(e) => {
                const t = e.target as HTMLElement
                const isBookingCard = !!t.closest("[data-booking-card]")
                const isAction =
                  !!t.closest("button, a, input, select, textarea, [role=menuitem]") &&
                  !t.closest("[data-booking-select]")
                if (isBookingCard && !isAction) {
                  setTimeout(() => setListOpen(false), 0)
                } else if (t.closest("[role=button]") && !t.closest("button")) {
                  setTimeout(() => setListOpen(false), 0)
                }
              }}
            >
              {list}
            </div>
          </SheetContent>
        </Sheet>
      ) : null}
    </div>
  )
}

function PickBanner({ model }: { model: ReturnType<typeof useFloorModel> }) {
  const pick = useUi((s) => s.pick)
  const selection = useUi((s) => s.pickSelection)
  const cancel = useUi((s) => s.cancelPick)
  const [busy, setBusy] = useState(false)
  if (!pick) return null
  const totalCapacity = selection.reduce((sum, id) => sum + (model.byId.get(id)?.capacity ?? 0), 0)
  return (
    <div
      className="absolute inset-x-3 top-3 z-10 mx-auto max-w-xl rounded-sm border border-strong bg-popover/97 p-3 shadow-float backdrop-blur"
      role="dialog"
      aria-label={pick.title}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{pick.title}</p>
          <p className="text-sm text-muted-foreground">{pick.hint}</p>
          <p className="mt-1 text-sm" aria-live="polite">
            {selection.length ? (
              <>
                <span className="font-medium">{selection.map((id) => model.label(id)).join(" + ")}</span>
                <span className="text-muted-foreground font-normal"> · tổng sức chứa {totalCapacity} chỗ</span>
              </>
            ) : (
              <span className="text-subtle">Chưa chọn bàn</span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="ghost" size="icon" aria-label="Hủy chọn bàn" onClick={cancel}>
            <X />
          </Button>
          <Button
            disabled={!selection.length || busy}
            onClick={async () => {
              setBusy(true)
              try {
                const done = await pick.onConfirm(selection)
                if (done) cancel()
              } finally {
                setBusy(false)
              }
            }}
          >
            <Check /> {pick.confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

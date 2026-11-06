import { AlertCircle, Check, Eye, Radio, Search, X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { EmptyState, Stepper } from "@/components/common"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import type { ZoneCode } from "@/domain/venue-layout"
import { useAvailability, useNow, useWaitlist } from "@/hooks/use-data"
import { useReceptionSearch } from "@/hooks/use-reception-search"
import { useMediaQuery } from "@/hooks/use-media"
import { atBusinessTime, businessDateOf, fmtBusinessDate, MS } from "@/lib/time"
import { cn } from "@/lib/utils"
import { isApiError } from "@/services"
import { useUi } from "@/state/ui"
import { useCan, useSession } from "@/state/session"
import { ZaloBookingExport } from "../reservations/zalo-booking-export"
import WaitlistPage from "../waitlist/waitlist-page"
import { AvailabilityPanel } from "./availability-panel"
import { BookingList, BookingTable, LIST_TABS, useBookingItems, type ListTab } from "./booking-list"
import { FloorCanvas } from "./floor-canvas"
import { StatusLegend } from "./status-legend"
import { FloorTimeline } from "./floor-timeline"
import { FloorToolbar, TimeField } from "./floor-toolbar"
import { QuickForm } from "./quick-form"
import { useBookingDraft } from "./use-booking-draft"
import { ShiftPanel } from "./shift-panel"
import { TableDetail } from "./table-detail"
import { useFloorModel } from "./use-floor-model"
import { ReceptionControls } from "./reception-controls"
import { canStartTableBooking, isWaitingForTable } from "./reception-rules"

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
    <div role="tablist" aria-label={label} className="flex gap-0.5 rounded-sm border bg-surface-1 p-[2px]">
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
              "flex h-[30px] items-center gap-1 rounded-sm px-2.5 text-xs sm:text-sm whitespace-nowrap",
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
  const ui = useUi()
  const now = useNow(1000)
  const receptionist = useSession((state) => state.user.role === "RECEPTIONIST")
  const currentDate = businessDateOf(now)
  const selectedDate = receptionist && ui.floorMode !== "live" ? ui.availDate : currentDate
  const model = useFloorModel(receptionist ? selectedDate : undefined)
  const canCreate = useCan("reservation.create")
  const search = useReceptionSearch(selectedDate, receptionist)
  const waitlist = useWaitlist(receptionist ? selectedDate : "")
  const [waitOpen, setWaitOpen] = useState(false)
  const [countOpen, setCountOpen] = useState(false)
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

  const live = receptionist || ui.floorMode === "live"
  const today = model.floor?.businessDate ?? businessDateOf(now)
  const date = receptionist ? selectedDate : live ? today : ui.availDate
  const draft = ui.draft
  const view = receptionist || ui.pick || draft ? "map" : ui.view
  const feed = useBookingItems(model, date, live, Math.floor(now.getTime() / MS.MIN))

  const availAt = useMemo(() => atBusinessTime(ui.availDate, ui.availTime), [ui.availDate, ui.availTime])
  const availability = useAvailability(live ? null : availAt, ui.availParty)
  const availMap = useMemo(
    () => new Map((availability.data?.tables ?? []).map((t) => [t.tableId, t])),
    [availability.data],
  )
  const {
    availability: draftAvail,
    availabilityMap: draftAvailMap,
    status: draftAvailStatus,
    pickable: draftBookingPickable,
    onTableClick: onDraftTableClick,
  } = useBookingDraft(model)

  const isPickAssign = ui.pick?.intent === "assign" && !!ui.pick.targetExpectedAt
  const pickAvail = useAvailability(isPickAssign ? ui.pick!.targetExpectedAt! : null, ui.pick?.targetParty ?? 2)
  const pickSnapshot = pickAvail.isPlaceholderData || pickAvail.isError ? undefined : pickAvail.data
  const pickAvailMap = useMemo(
    () => new Map((pickSnapshot?.tables ?? []).map((t) => [t.tableId, t])),
    [pickSnapshot],
  )

  const pickable = useMemo(() => {
    if (!ui.pick) return null
    if (ui.pick.intent === "assign" && ui.pick.targetExpectedAt) {
      const availTables = pickSnapshot?.tables ?? []
      const pickableSet = new Set<number>()
      for (const t of availTables) {
        if (t.status === "available" || t.status === "too_small") {
          pickableSet.add(t.tableId)
        }
      }
      // Allow booking's own retained tables on reassignment
      if (ui.pick.preselected) {
        for (const id of ui.pick.preselected) {
          pickableSet.add(id)
        }
      }
      if (ui.pick.excludeIds) {
        for (const id of ui.pick.excludeIds) {
          pickableSet.delete(id)
        }
      }
      return pickableSet
    }
    const set = new Set(model.freeIds)
    ui.pick.excludeIds?.forEach((id) => set.delete(id))
    return set
  }, [ui.pick, model.freeIds, pickSnapshot])

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
    if (draft) return onDraftTableClick(id)
    if (ui.pick) {
      if (pickable && !pickable.has(id) && !ui.pickSelection.includes(id)) {
        return toast.info(`${model.label(id)}: không khả dụng vào giờ đã chọn`)
      }
      return ui.togglePick(id)
    }
    if (receptionist) {
      const table = model.byId.get(id)
      const state = model.states.get(id)
      if (!state) return toast.info("Chưa tải được trạng thái bàn. Vui lòng thử lại.")
      if (canCreate && canStartTableBooking(table, state, model.catalog?.zones ?? [])) {
        return ui.openBooking({ tableIds: [id], date: selectedDate })
      }
      return ui.selectTable(ui.selectedTableId === id ? null : id)
    }
    if (!live) {
      const status = availMap.get(id)?.status
      if (status !== "available" && status !== "spare" && status !== "too_small") return
      setAvailSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
      return
    }
    ui.selectTable(ui.selectedTableId === id ? null : id)
  }

  const panel = draft ? (
    <QuickForm
      model={model}
      availability={draftAvailStatus === "ready" ? draftAvail.data : undefined}
      availabilityStatus={draftAvailStatus}
      onRetryAvailability={() => void draftAvail.refetch()}
      compact={!wide}
    />
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
        : isPickAssign
          ? `Phân bàn lúc ${ui.pick?.targetTime} · ${fmtBusinessDate(ui.pick?.targetDate ?? today, "short")} · ${ui.pick?.targetParty ?? 2} khách`
          : live
            ? `${model.tables.length} vị trí · ${counts.seated ?? 0} đang dùng · ${counts.free ?? 0} trống`
            : `Xem trước ${ui.availTime} · ${ui.availParty} khách`

  const list = <BookingList feed={feed} tab={tab} setTab={setTab} model={model} live={live} />

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!receptionist ? <FloorToolbar onOpenList={xl ? undefined : () => setListOpen(true)} /> : null}
      {receptionist ? (
        <div className="shrink-0 border-b px-4 py-2">
          <ReceptionControls
            search={search}
            onCount={() => setCountOpen(true)}
            onOpenBooking={ui.openReservation}
            onDateChange={() => ui.selectTable(null)}
          />
        </div>
      ) : null}
      {!live && !ui.pick ? (
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

      <div className={cn("relative flex min-h-0 flex-1", !wide && draft && "flex-col")}>
        {/* NA-11: the receptionist works from the floor alone, without the Cần xử lý / Sắp đến lists. */}
        {xl && view !== "list" && !receptionist ? (
          <aside className="w-1/4 max-w-[336px] min-w-[288px] shrink-0 border-r" aria-label="Danh sách booking">
            {list}
          </aside>
        ) : null}

        <section className="flex min-w-0 flex-1 flex-col gap-2 p-3 sm:px-4 sm:pt-2.5 sm:pb-3" aria-label="Không gian làm việc">
          {/* The receptionist always works on the whole floor, so only draft context needs this row. */}
          {!receptionist || bookingDraft || isPickAssign ? (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <div className="flex shrink-0 items-center gap-2">
              {view === "list" ? (
                <Segmented
                  label="Lọc booking"
                  value={tab}
                  onChange={setTab}
                  options={LIST_TABS.map((t) => ({ value: t.id, label: t.label, count: feed[t.id].length }))}
                />
              ) : receptionist ? null : (
                <Segmented label="Lọc khu" value={ui.zone} onChange={ui.setZone} options={ZONE_TABS} />
              )}
              {!receptionist && live && view === "map" && !ui.pick && !draft ? (
                <Button variant="ghost" size="sm" className="h-8 shrink-0 gap-1 px-2 text-xs" onClick={() => ui.setFloorMode("availability")}>
                  <Search className="size-3.5" /> Xem khả dụng
                </Button>
              ) : null}
            </div>
            <span className="tnum text-xs whitespace-nowrap text-tx-2 sm:ml-auto">{summary}</span>
          </div>
          ) : null}

          {view === "map" && !ui.pick && !draft ? (
            <StatusLegend tables={model.tables} states={model.states} />
          ) : null}

          {view === "map" ? <PickBanner model={model} /> : null}

          {view === "map" ? (
            <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-border/60">
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
                  mode={
                    bookingDraft
                      ? "availability"
                      : isPickAssign
                        ? "availability"
                        : draft || receptionist
                          ? "live"
                          : ui.floorMode
                  }
                  states={model.states}
                  availability={bookingDraft ? draftAvailMap : isPickAssign ? pickAvailMap : availMap}
                  groups={live && !bookingDraft && !isPickAssign ? model.floor?.groups : []}
                  selectedIds={selectedIds}
                  searchHighlightedIds={!ui.pick && !draft ? search.tableIds : []}
                  pickable={bookingDraft ? draftBookingPickable : draft ? null : pickable}
                  zoneFocus={receptionist ? "ALL" : ui.zone}
                  now={now}
                  onTableClick={onTableClick}
                  onBlockedTableClick={draft ? onDraftTableClick : undefined}
                  onBackgroundClick={() => !ui.pick && !draft && live && ui.selectTable(null)}
                  ariaLabel={
                    bookingDraft
                      ? `Sơ đồ khả dụng lúc ${bookingDraft.time} để chọn bàn`
                      : isPickAssign
                        ? `Sơ đồ khả dụng lúc ${ui.pick?.targetTime ?? ""} ngày ${fmtBusinessDate(ui.pick?.targetDate ?? today, "short")} để phân bàn`
                        : live
                          ? "Sơ đồ bàn, trạng thái hiện tại"
                          : `Sơ đồ khả dụng lúc ${ui.availTime}`
                  }
                  waitingCount={!draft && !ui.pick ? (waitlist.isPlaceholderData ? 0 : (waitlist.data ?? []).filter(isWaitingForTable).length) : undefined}
                  onOpenWaitlist={!draft && !ui.pick ? () => setWaitOpen(true) : undefined}
                />
              )}
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
            className={cn(
              "z-20 flex animate-in flex-col overflow-hidden border-t border-strong bg-popover shadow-float duration-200 slide-in-from-bottom-6",
              draft ? "relative max-h-[60%] shrink-0 rounded-t-lg" : "absolute inset-x-0 bottom-0 max-h-[62%] rounded-t-sm",
            )}
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
            <div className="flex min-h-0 flex-1 flex-col">{panel}</div>
          </section>
        ) : null}
      </div>

      <>
          {receptionist ? <ZaloBookingExport businessDate={date} open={countOpen} onOpenChange={setCountOpen} /> : null}
          <Sheet open={waitOpen} onOpenChange={setWaitOpen}>
            <SheetContent className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[920px]">
              <SheetTitle className="sr-only">Bàn chờ ảo</SheetTitle>
              <SheetDescription className="sr-only">Ngày kinh doanh {fmtBusinessDate(date)}</SheetDescription>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <WaitlistPage businessDate={date} onLeaveToFloor={() => setWaitOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>
      </>

      {!receptionist && !xl ? (
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
  const isAssign = pick.intent === "assign" && !!pick.targetDate
  return (
    <div
      className="z-10 w-full shrink-0 rounded-sm border border-strong bg-popover p-3"
      role="dialog"
      aria-label={pick.title}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{pick.title}</p>
          <p className="text-sm text-muted-foreground">{pick.hint}</p>
          {isAssign ? (
            <p className="mt-0.5 text-xs font-medium text-primary-ink">
              Lịch đặt: {pick.targetTime} · {fmtBusinessDate(pick.targetDate!, "short")} ({pick.targetParty} khách)
            </p>
          ) : null}
          <p className="mt-1 text-sm" aria-live="polite">
            {selection.length ? (
              <>
                <span className="font-medium">{selection.map((id) => model.label(id)).join(" + ")}</span>
                <span className="font-normal text-muted-foreground"> · tổng sức chứa {totalCapacity} chỗ</span>
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

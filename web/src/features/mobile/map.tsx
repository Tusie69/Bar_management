import { ListOrdered, Menu, MessageSquareText, X } from "lucide-react"
import { useMemo, useState } from "react"
import type { TableLiveState, TableView } from "@/domain/models"
import type { ZoneCode } from "@/domain/venue-layout"
import { useAvailability } from "@/hooks/use-data"
import { fmtBusinessDate, fmtTime } from "@/lib/time"
import { cn } from "@/lib/utils"
import { useUi } from "@/state/ui"
import { useReceptionSearch } from "@/hooks/use-reception-search"
import { usePlanWidth } from "@/hooks/use-plan-width"
import { FloorCanvas } from "../floor/floor-canvas"
import { SpareButton } from "../floor/spare-button"
import { LayoutActions, LayoutMergeControls } from "../floor/layout-merge-controls"
import { independentLayoutEnabled, layoutMembers, toggleLayoutTable } from "../floor/layout-merge"
import { GuestCountCard } from "../floor/guest-count-card"
import { StatusLegend } from "../floor/status-legend"
import { claimCallTarget } from "@/domain/call-target"
import { CallCustomerControl } from "../bookings/call-customer"
import { CallHistory } from "../bookings/call-history"
import { groupCode, groupDisplayName } from "../floor/floor-visual-rules"
import { ReceptionDatePicker, ReceptionSearchField, ReceptionSearchResults } from "../floor/reception-controls"
import { ZaloBookingExport } from "../reservations/zalo-booking-export"
import { QuickForm } from "../floor/quick-form"
import { isWaitingForTable } from "../floor/reception-rules"
import { useBookingDraft } from "../floor/use-booking-draft"
import { useMobileActions } from "./actions"
import { useM, type TablePick } from "./context"
import { codesOf, duration, type Tone, toneStyle } from "./model"
import { useUndoRedo } from "@/features/operations/use-undo-redo"
import { PlainHeader, UndoRedoButtons } from "./ui"

const ZONE_TABS: [ZoneCode | "ALL", string][] = [
  ["ALL", "Tất cả"],
  ["A", "Khu A"],
  ["B", "Khu B"],
  ["C", "Khu C"],
  ["BAR", "Bar"],
]

export function MapScreen({
  selected,
  onSelect,
  pick,
  pickSel,
  onPickToggle,
  onPickCancel,
  onPickConfirm,
  pickBusy,
}: {
  selected: number | null
  onSelect: (id: number | null) => void
  pick: TablePick | null
  pickSel: number[]
  onPickToggle: (id: number) => void
  onPickCancel: () => void
  onPickConfirm: () => void
  pickBusy: boolean
}) {
  const m = useM()
  const receptionist = m.role === "RECEPTIONIST"
  const search = useReceptionSearch(m.businessDate, receptionist)
  const zone = useUi((s) => (receptionist ? "ALL" : s.zone))
  const setZone = useUi((s) => s.setZone)
  const d = useBookingDraft(m.model)
  const draft = d.draft
  const layoutPick = useUi((s) => s.pick?.intent === "layout")
  const layoutIds = useUi((s) => s.pickSelection)
  const waitingCount = (m.waitlist ?? []).filter(isWaitingForTable).length
  const undoEnabled = useUndoRedo().enabled
  const [exportOpen, setExportOpen] = useState(false)
  const canExport = m.can("customer.view_masked")
  // Cỡ máy thật, không phải cỡ viewport: Safari thu nhỏ trang thì iPhone X báo
  // ~506px và trước đây nhận bộ chrome của máy to, đè lên Khu B/Khu C.
  const planWidth = usePlanWidth()
  // The plan owns the screen: its own controls float on it instead of stacking above it.
  const planChrome = receptionist && !pick && !draft

  // While the booking form is open the map only gets the upper half, so fitting
  // the whole venue into it leaves the tables too small to aim at. Focus the
  // zone the chosen table sits in instead: that zone fills the strip, and the
  // canvas dims every other zone, which is what "mờ các khu khác" means.
  const draftZone = useMemo<ZoneCode | null>(() => {
    const first = draft?.tableIds?.[0]
    if (first === undefined) return null
    return (m.model.byId.get(first)?.zoneCode as ZoneCode | undefined) ?? null
  }, [draft, m.model])

  const isAssignPick = !!pick?.targetExpectedAt
  const pickAvail = useAvailability(isAssignPick ? pick.targetExpectedAt! : null, pick?.targetParty ?? 2)
  const pickSnapshot = pickAvail.isPlaceholderData || pickAvail.isError ? undefined : pickAvail.data
  const pickAvailMap = useMemo(() => new Map((pickSnapshot?.tables ?? []).map((t) => [t.tableId, t])), [pickSnapshot])

  const pickable = useMemo(() => {
    if (!pick) return null
    if (isAssignPick) {
      const availTables = pickSnapshot?.tables ?? []
      const ids = new Set<number>()
      for (const t of availTables) {
        if (t.status === "available" || t.status === "too_small") {
          ids.add(t.tableId)
        }
      }
      for (const id of pick.preselected ?? []) ids.add(id)
      for (const id of pick.exclude ?? []) ids.delete(id)
      return ids
    }
    const ids = new Set(pick.only ?? [...m.model.freeIds, ...(pick.preselected ?? [])])
    for (const id of pick.exclude ?? []) ids.delete(id)
    return ids
  }, [pick, isAssignPick, pickSnapshot, m.model.freeIds])

  return (
    <main className="contents">
      {receptionist ? (
        <header className="z-[5] shrink-0 bg-background px-3 pt-[var(--top-safe)]">
          {/* A single 48px row is the whole fixed chrome: menu, search, export.
              Undo/redo, date, Đếm khách and ⓘ float on the plan itself. */}
          <div className="flex h-[48px] items-center gap-2">
            <button
              type="button"
              onClick={m.openAccount}
              aria-label="Menu"
              className="grid size-10 shrink-0 place-items-center rounded-xl border border-border bg-surface-1 text-tx-strong shadow-[var(--shadow-xs)]"
            >
              <Menu className="size-5" />
            </button>
            {planChrome ? (
              <ReceptionSearchField search={search} />
            ) : (
              <h1 className="m-0 min-w-0 flex-1 truncate text-[18px] font-semibold text-tx-strong">Sơ đồ bàn</h1>
            )}
            <button
              type="button"
              disabled={!canExport}
              onClick={() => setExportOpen(true)}
              aria-label="Xuất text Zalo"
              title="Xuất text booking để gửi nhóm Zalo"
              className={cn(
                "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3 text-[14px] font-semibold text-primary-foreground",
                !canExport && "cursor-not-allowed opacity-50",
              )}
            >
              <MessageSquareText className="size-4 shrink-0" aria-hidden />
              <span>Xuất Text</span>
            </button>
          </div>
        </header>
      ) : (
        <PlainHeader
          title={pick?.targetDate ? `Sơ đồ bàn · ${fmtBusinessDate(pick.targetDate, "short")}` : "Sơ đồ bàn"}
        />
      )}
      {/* The receptionist works on the whole floor and reads the counts inside the ⓘ popup,
          so neither the zone tabs nor the legend card take screen height from the plan. */}
      {!receptionist && !pick ? (
        <div className="z-[4] flex shrink-0 flex-col gap-1.5 bg-background px-4 pt-0 pb-1.5">
          {
            <div
              role="tablist"
              aria-label="Lọc khu"
              className="flex w-full max-w-full gap-0.5 overflow-x-auto rounded-[14px] border border-border bg-surface-1 p-[3px] shadow-[var(--shadow-xs)]"
            >
              {ZONE_TABS.map(([k, label]) => {
                const on = zone === k
                return (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => setZone(k)}
                    className={cn(
                      "flex h-[38px] min-w-0 flex-1 shrink-0 items-center justify-center rounded-[11px] px-1 text-[13px] whitespace-nowrap",
                      on ? "bg-tx-strong font-semibold text-background" : "font-medium text-tx-2",
                    )}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          }
          {draft ? null : <StatusLegend tables={m.model.tables} states={m.model.states} />}
        </div>
      ) : null}
      {/* Idle "Ghép bàn" button is off the receptionist's screen: merging starts from the
          table sheet. The active merge panel still shows so nobody gets stuck in pick mode. */}
      {!pick && !layoutPick && !receptionist ? (
        <div className="shrink-0 px-3 pb-1">
          <LayoutMergeControls model={m.model} />
        </div>
      ) : null}
      {pick ? (
        <div className="z-[6] mx-3 mt-1 mb-2 flex shrink-0 items-start gap-2 rounded-[14px] border border-primary bg-surface-1 py-2.5 pr-1.5 pl-3.5 shadow-[var(--shadow-soft)]">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-[14px] font-semibold text-tx-strong">{pick.title}</span>
            <span className="text-[13px] text-pretty text-[var(--text-muted)]">{pick.hint}</span>
            {pick.targetDate ? (
              <span className="mt-0.5 text-[12px] font-medium text-primary">
                Lịch đặt: {pick.targetTime} · {fmtBusinessDate(pick.targetDate, "short")} ({pick.targetParty} khách)
              </span>
            ) : null}
          </span>
          <button
            type="button"
            onClick={onPickCancel}
            aria-label="Hủy chọn bàn"
            className="grid size-11 shrink-0 place-items-center rounded-full text-[var(--text-muted)]"
          >
            <X className="size-5" />
          </button>
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1 bg-[var(--floor)]">
        {/* Mockup 03: the merge panel floats OVER the plan. In the document flow
            it shortened the canvas, the camera re-fitted, and the plan jumped. */}
        {planChrome && search.active ? (
          // Kết quả tìm kiếm nổi trên sơ đồ thay vì nằm trong luồng: trong luồng
          // nó lấy mất 74px chiều cao của sơ đồ. Nó chỉ cao hai dòng và biến mất
          // ngay khi xoá ô tìm kiếm, nên che tạm góc trên là chấp nhận được.
          <div className="pointer-events-none absolute inset-x-0 top-0 z-[11] px-2">
            <div className="pointer-events-auto rounded-[14px] border border-border/80 bg-background/95 px-3 py-2 shadow-lg backdrop-blur dark:border-slate-700/80 dark:bg-[#1e232d]/95">
              <ReceptionSearchResults search={search} onOpenBooking={m.openDetail} />
            </div>
          </div>
        ) : null}
        {m.model.catalog ? (
          <FloorCanvas
            className="absolute inset-0"
            tables={m.model.tables}
            zones={m.model.catalog.zones}
            mode={isAssignPick || d.bookingDraft ? "availability" : "live"}
            states={m.model.states}
            availability={d.bookingDraft ? d.availabilityMap : isAssignPick ? pickAvailMap : undefined}
            groups={independentLayoutEnabled || (!isAssignPick && !d.bookingDraft) ? m.model.floor?.groups : []}
            selectedIds={draft ? draft.tableIds : layoutPick ? layoutIds : pick ? pickSel : selected ? [selected] : []}
            searchHighlightedIds={!pick && !draft ? search.tableIds : []}
            pickable={layoutPick ? null : d.bookingDraft ? d.pickable : draft ? null : pickable}
            zoneFocus={receptionist ? (draftZone ?? "ALL") : zone}
            preserveWidthFit={!!draft}
            now={m.now}
            planOverlay={
              planChrome
                ? () => (
                    // Anchor to the canvas, not the wall. On a short phone the
                    // whole-floor fit leaves useful side gutters; pinning the
                    // controls to the wall put them directly over C4/C5 and
                    // B21/B22. The canvas edges use those gutters and return
                    // the toolbar's full height to the plan.
                    <div className="reception-plan-overlay pointer-events-none absolute inset-0">
                      <GuestCountCard
                        reservations={m.reservations}
                        claims={[...m.model.states.values()].flatMap((state) => (state.claim ? [state.claim] : []))}
                        onOpen={m.openCount}
                        initialOpen={planWidth > 480}
                        tiny={planWidth <= 359}
                        className="pointer-events-auto absolute top-2 left-2"
                      />
                      <div className="pointer-events-auto absolute top-2 right-2 flex flex-col items-end gap-1.5">
                        <StatusLegend variant="badge" tables={m.model.tables} states={m.model.states} />
                        <ReceptionDatePicker
                          onDateChange={() => onSelect(null)}
                          className="[&>button]:h-9 [&>button]:min-h-[36px] [&>button]:px-1.5 [&>button]:shadow-lg"
                        />
                        {/* The mockup puts Bàn chờ here, right under the date. Drawn in
                            floor space it scaled with the plan while the date chip kept
                            real pixels, and the two overlapped by 8px on a 375 screen. */}
                        <button
                          type="button"
                          onClick={() => m.go("wait")}
                          aria-label={`Bàn chờ, ${waitingCount} nhóm đang đợi`}
                          className="inline-flex h-9 items-center gap-2 rounded-xl border border-border/80 bg-background/95 px-2.5 text-[13px] font-semibold text-tx-strong shadow-lg backdrop-blur active:scale-95 dark:border-slate-700/80 dark:bg-[#1e232d]/95"
                        >
                          <ListOrdered className="size-4 shrink-0" aria-hidden />
                          {planWidth > 480 ? <span>Bàn chờ</span> : planWidth >= 375 ? <span>Chờ</span> : null}
                          {waitingCount > 0 ? `+${waitingCount}` : ""}
                        </button>
                      </div>
                    </div>
                  )
                : undefined
            }
            waitingCount={receptionist || draft || pick ? undefined : waitingCount}
            onOpenWaitlist={receptionist || draft || pick ? undefined : () => m.go("wait")}
            onTableClick={(id) =>
              layoutPick
                ? toggleLayoutTable(m.model, id)
                : draft
                  ? d.onTableClick(id)
                  : pick
                    ? onPickToggle(id)
                    : onSelect(id)
            }
            onBlockedTableClick={draft ? d.onTableClick : undefined}
            onBackgroundClick={() => (pick || draft || layoutPick ? undefined : onSelect(null))}
            ariaLabel={
              d.bookingDraft
                ? `Sơ đồ khả dụng lúc ${d.bookingDraft.time} để chọn bàn`
                : isAssignPick
                  ? `Sơ đồ khả dụng lúc ${pick.targetTime} ngày ${fmtBusinessDate(pick.targetDate!, "short")}`
                  : "Sơ đồ bàn. Kéo để di chuyển, chụm hai ngón để phóng to"
            }
          />
        ) : null}
      </div>
      {/* Dải dưới cùng: đang ghép bàn thì nó là bảng ghép, còn lại là cặp
          hoàn tác. Ghép bàn không che ô bàn nào, và hoàn tác cũng không cần
          tới giữa chừng một thao tác ghép. */}
      {!pick && layoutPick ? (
        <div className="z-[11] shrink-0 px-2 pb-[var(--bottom-safe)]">
          <LayoutMergeControls model={m.model} overlay />
        </div>
      ) : planChrome && undoEnabled ? (
        // Mockup 01 ends the screen with a 52px row holding just these two.
        // Floating them over the plan put them on top of Khu A. The row is
        // dropped entirely where undo is not available (mock build), so there
        // is no empty strip; api.mode is fixed per build, so the plan height
        // cannot change under the camera mid-session.
        <div className="z-[5] flex h-[52px] shrink-0 items-center gap-1 bg-background px-2 pb-[var(--bottom-safe)]">
          <UndoRedoButtons square />
        </div>
      ) : null}
      {pick ? (
        <div className="z-[12] flex shrink-0 flex-col gap-2.5 rounded-t-[24px] border-t border-border bg-surface-1 px-4 pt-3.5 pb-4 shadow-[var(--shadow-float)]">
          {pick.question && pickSel.length ? (
            <span className="text-[15px] font-medium text-tx-strong">{pick.question(codesOf(pickSel, m.model))}</span>
          ) : null}
          <span className="text-[13px] text-[var(--text-muted)]">
            {pickSel.length ? (
              <>
                Đã chọn {codesOf(pickSel, m.model)} ·{" "}
                {pickSel.reduce((sum, id) => sum + (m.model.byId.get(id)?.capacity ?? 0), 0)} chỗ
              </>
            ) : (
              "Chưa chọn bàn"
            )}
          </span>
          <button
            type="button"
            disabled={!pickSel.length || pickBusy}
            onClick={onPickConfirm}
            className="h-[52px] rounded-[14px] bg-primary text-base font-semibold text-primary-foreground disabled:opacity-50"
          >
            {pickBusy ? "Đang gửi..." : pick.confirmLabel}
          </button>
        </div>
      ) : null}
      {draft && draftZone ? (
        <p className="z-[11] shrink-0 bg-background px-4 pb-1 text-center text-[11px] font-medium tracking-wide text-[var(--text-muted)]">
          KHU {draftZone} · chạm để chọn thêm
        </p>
      ) : null}
      {draft ? (
        <section
          role="dialog"
          aria-label="Đặt bàn trên sơ đồ"
          className="z-[12] flex max-h-[62dvh] shrink-0 flex-col overflow-hidden rounded-t-[20px] border-t border-border bg-popover shadow-[var(--shadow-float)]"
        >
          <div className="flex shrink-0 justify-center pt-2" aria-hidden>
            <span className="h-[5px] w-9 rounded-full bg-strong" />
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <QuickForm
              compact
              model={m.model}
              availability={d.status === "ready" ? d.availability.data : undefined}
              availabilityStatus={d.status}
              onRetryAvailability={() => void d.availability.refetch()}
            />
          </div>
        </section>
      ) : null}
      <ZaloBookingExport businessDate={m.businessDate} open={exportOpen} onOpenChange={setExportOpen} />
    </main>
  )
}

const STATE_TEXT = (st: TableLiveState, late: number, noshow: number): [string, Tone] =>
  ({
    free: ["Trống", null],
    reserved: ["Đã đặt", "reserved"],
    upcoming: ["Sắp tới", "upcoming"],
    late: [`Tới muộn · ${late} phút`, "noshow"],
    late_confirmed: [`Tới muộn · đã báo muộn · ${late} phút`, "noshow"],
    noshow: [`Tới muộn · ${noshow} phút`, "noshow"],
    seated: ["Đã tới", "seated"],
    hold: ["Đang giữ", "reserved"],
    hold_overdue: ["Quá hạn giữ", "late"],
    oos: ["Ngưng phục vụ", null],
    spare: ["Sơ cua", null],
  })[st] as [string, Tone]

interface Action {
  label: string
  go?: () => void
  primary?: boolean
  danger?: boolean
  wide?: boolean
  disabled?: boolean
  title?: string
  /** Nút này đứng cùng hàng với nút Sơ cua. */
  withSpare?: boolean
}

/** Bottom sheet over the lower half; the map stays visible and other tables stay tappable. */
export function TableSheet({ id, onClose }: { id: number; onClose: () => void }) {
  const m = useM()
  const a = useMobileActions()
  const pending = a.pending
  const t = m.model.byId.get(id)
  if (!t) return null
  const fs = m.model.states.get(id)
  const st = fs?.state ?? "free"
  const c = fs?.claim ?? null
  const callTarget = c ? claimCallTarget(c) : null
  const members = layoutMembers(m.model, id)
  const isGroup = members.length > 1
  const memberTables = members.map((mid) => m.model.byId.get(mid)).filter((x): x is TableView => !!x)
  const group = m.model.floor?.groups.find((g) => g.tableIds.includes(id))
  const groupName = isGroup ? groupDisplayName(memberTables, group) : ""
  const isBar = t.kind === "BAR_SEAT"
  const groupTitle = isGroup ? `Bàn ${groupName}` : isBar ? `Ghế Bar ${t.seqNo}` : `Bàn ${t.code}`
  const totalCapacity = memberTables.reduce((sum, x) => sum + x.capacity, 0)
  const zone = m.model.catalog?.zones.find((z) => z.id === t.zoneId)
  const [chip, tone] = STATE_TEXT(st, m.th.late, m.th.noshow)
  const r = c?.reservationId ? m.reservations?.find((x) => x.id === c.reservationId) : undefined
  const linkedEntry = c?.waitlistEntryId
    ? m.waitlist?.find((x) => x.id === c.waitlistEntryId)
    : r
      ? m.waitlist?.find((x) => x.reservationId === r.id && x.status === "HOLD_ACTIVE")
      : undefined

  let who = ""
  let when = ""
  let info = ""
  /** Nút thường; các nút huỷ tách ra `tailActions` để luôn nằm dưới cùng. */
  let actions: Action[] = []
  if (c?.kind === "visit") {
    who = `${c.displayName}, ${c.partySize} khách`
    when = `Đang ngồi từ ${fmtTime(c.startsAt)}, ${duration(m.now.getTime() - c.startsAt.getTime())}`
    actions = [
      { label: "Đổi bàn", withSpare: true, go: () => a.moveVisit(c, id) },
      ...(c.reservationId ? [{ label: "Xem booking", go: () => m.openDetail(c.reservationId!, m.today) }] : []),
      { label: "Nhả bàn", danger: true, wide: true, go: () => a.endVisit(c) },
    ]
  } else if (c?.kind === "waitlist_hold" || (c?.kind === "reservation" && linkedEntry)) {
    const entry = linkedEntry ?? (c?.waitlistEntryId ? m.waitlist?.find((x) => x.id === c.waitlistEntryId) : undefined)
    who = `${c.displayName}, ${c.partySize} khách`
    when = c.deadlineAt ? `Giữ từ danh sách chờ đến ${fmtTime(c.deadlineAt)}` : "Đang giữ bàn từ danh sách chờ"

    const hold = a.heldPolicy(entry, r)
    actions = [
      {
        label: "Khách đã đến",
        primary: true,
        wide: true,
        disabled: !hold.canArrival,
        title: !hold.supported ? "Chưa hỗ trợ" : undefined,
        go: () =>
          a.arrival({ entry, reservation: r, partySize: c.partySize, tableCodes: codesOf(c.tableIds, m.model) }),
      },
      {
        label: "Quản lý đơn",
        go: () =>
          r ? m.openDetail(r.id, r.businessDate) : m.openEntryDetail(entry?.id ?? c.waitlistEntryId!, m.businessDate),
      },
      {
        label: "Đổi / Ghép bàn",
        disabled: !hold.canReassign,
        title: !hold.supported ? "Chưa hỗ trợ" : undefined,
        go: () => a.reassignHold(entry, r),
      },
      ...(r ? [{ label: "Xem booking", go: () => m.openDetail(r.id, r.businessDate) }] : []),
      {
        label: "Xem đơn chờ",
        wide: !r,
        disabled: !entry,
        go: () => entry && m.openEntryDetail(entry.id, entry.businessDate),
      },
      // Huỷ cũng xuống cuối. Với đơn chờ không gắn booking thì đây là lối huỷ
      // duy nhất từ sheet này, nên nó ở lại, dưới đúng tên của nó.
      ...(r
        ? [
            {
              label: "Hủy booking",
              danger: true,
              wide: true,
              disabled: !m.can("reservation.cancel") || !hold.canBookingStatus,
              go: () => a.cancel(r),
            },
          ]
        : [
            {
              label: "Hủy đơn chờ",
              danger: true,
              wide: true,
              disabled: !entry || !m.can("waitlist.cancel"),
              go: () => entry && a.cancelEntry(entry),
            },
          ]),
    ]
  } else if (c?.kind === "reservation") {
    who = `${c.displayName}, ${c.partySize} khách`
    when = `Booking ${fmtTime(c.startsAt)}${st === "late" || st === "late_confirmed" || st === "noshow" ? `, trễ ${c.minutesLate} phút` : st === "upcoming" ? ", sắp đến" : ", đã đặt"}`
    actions = r
      ? [
          { label: "Khách đã đến", primary: true, go: () => void a.checkIn(r) },
          ...(!r.lateConfirmedAt &&
          r.businessDate === m.today &&
          m.now.getTime() >= r.expectedAt.getTime() &&
          r.minutesLate < m.th.noshow
            ? [{ label: "Tới muộn", go: () => a.confirmLate(r) }]
            : []),
          { label: "Xem booking", go: () => m.openDetail(r.id, r.businessDate) },
          { label: "Đổi bàn", withSpare: true, go: () => a.assign(r) },
          // Hủy booking đứng cuối và chiếm cả dòng: thao tác không lùi lại
          // được thì không nên nằm lẫn giữa những nút bấm hằng ngày.
          {
            label: "Hủy booking",
            danger: true,
            wide: true,
            disabled: !m.can("reservation.cancel"),
            go: () => a.cancel(r),
          },
        ]
      : []
  } else if (st === "spare") {
    info = m.isOwner
      ? "Bàn sơ cua chỉ mở khi quản lý chấp nhận vượt quy tắc."
      : "Bàn sơ cua. Cần Chủ quán/Admin mở vượt quy tắc."
    actions = m.isOwner
      ? [{ label: "Mở bàn vượt quy tắc", wide: true, go: () => m.openForm({ mode: "walkin", tableIds: members }) }]
      : []
  } else if (st === "oos") {
    info = "Bàn đang ngưng phục vụ."
  } else {
    info = zone?.isWaitingArea ? `${zone.name} là khu chờ, không nhận đặt trước.` : "Bàn đang trống lúc này."
    actions = [
      { label: "Mở bàn Walk-in", primary: true, go: () => m.openForm({ mode: "walkin", tableIds: members }) },
      {
        label: "Tạo đặt trước",
        go: () => m.openForm({ mode: "booking", tableIds: zone?.isBookable ? members : [] }),
      },
    ]
  }

  // Nút huỷ luôn ở dưới cùng và chiếm cả dòng, dưới cả nút Sơ cua.
  const tailActions = actions.filter((x) => x.danger && x.wide)
  const mainActions = actions.filter((x) => !(x.danger && x.wide))
  /** Có nút nào kéo Sơ cua lên cùng hàng chưa; nếu chưa thì Sơ cua đứng một mình như cũ. */
  const pairedSpare = Boolean(t) && mainActions.some((x) => x.withSpare)

  const actionButton = (x: Action) => (
    <button
      key={x.label}
      type="button"
      onClick={x.go}
      disabled={x.disabled || a.pending || pending}
      title={x.title}
      className={cn(
        "h-12 rounded-xl border text-[15px] font-medium disabled:opacity-45",
        x.wide && "col-span-2",
        x.primary
          ? "border-primary bg-primary text-primary-foreground"
          : cn("border-strong bg-transparent", x.danger ? "text-st-noshow-ink" : "text-tx-1"),
      )}
    >
      {x.label}
    </button>
  )

  return (
    <div
      role="dialog"
      aria-label={`Chi tiết ${isGroup ? groupTitle : t.code}`}
      className="absolute inset-x-0 bottom-[var(--nav-h)] z-[12] flex flex-col gap-3 rounded-t-[24px] border-t border-border bg-surface-1 px-4 pt-2 pb-4 shadow-[var(--shadow-float)]"
    >
      <div className="mx-auto mb-0.5 h-[5px] w-9 rounded-[3px] bg-strong" />
      <div className="flex items-center gap-2.5">
        <span className="text-2xl font-semibold tracking-[-0.01em] text-tx-strong">{groupTitle}</span>
        <span className="rounded-full px-2.5 text-xs leading-6 font-medium" style={toneStyle(tone)}>
          {isGroup ? `${chip} - ghép ${members.length} bàn` : chip}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          aria-label="Đóng"
          className="-mr-2 grid size-11 place-items-center rounded-full text-[var(--text-muted)]"
        >
          <X className="size-5" />
        </button>
      </div>
      {/* Trạng thái chỉ hiển thị một lần ở chip cạnh tên bàn. */}
      <span className="-mt-2 text-[13px] text-[var(--text-muted)]">
        {zone?.name}, {isBar && !isGroup ? "1 ghế" : `${totalCapacity} chỗ`}
        {t.isSpare ? ", bàn sơ cua" : ""}
      </span>
      {who ? (
        <div className="flex flex-col gap-0.5 rounded-[14px] bg-surface-2 px-3.5 py-3">
          <span className="text-base font-medium text-tx-strong">{who}</span>
          <span className="text-[13px] text-tx-2">{when}</span>
          {c?.phoneLast3 ? <span className="text-[13px] text-[var(--text-muted)]">SĐT: ••• {c.phoneLast3}</span> : null}
          {c?.flags?.length ? (
            <span className="text-[13px] text-[var(--text-muted)]">
              {c.flags.includes("RETURNING") ? "🔥 Đã từng đặt bàn" : ""}
              {c.flags.includes("RETURNING") && c.flags.includes("NEW") ? " · " : ""}
              {c.flags.includes("NEW") ? "🆕 Chưa từng đặt bàn" : ""}
            </span>
          ) : null}
          {c && c.tableIds.length > 1 ? (
            <span className="text-[13px] text-[var(--text-muted)]">
              Nhóm {c.groupDisplayCode ?? groupCode(c.symbolNo) ?? "ghép"}: {codesOf(c.tableIds, m.model)}
            </span>
          ) : null}
          {st === "noshow" ? (
            <span className="text-[13px] font-medium text-st-noshow-ink">Chờ lễ tân xử lý; bàn vẫn được giữ.</span>
          ) : null}
        </div>
      ) : null}
      {info ? <span className="text-[13px] text-pretty text-[var(--text-muted)]">{info}</span> : null}
      <LayoutActions model={m.model} tableId={id} />
      {actions.length || t ? (
        <div className="grid grid-cols-2 gap-2">
          {/* Mọi loại chỗ giữ còn booking đều gọi được, không chỉ booking chưa
              check-in: khách chờ đã có booking và khách đang ngồi cũng cần gọi. */}
          {callTarget ? (
            <>
              <CallCustomerControl
                target={callTarget}
                canCall={c?.canCall === true || c?.phoneLast3 != null}
                className="col-span-2"
              />
              <CallHistory target={callTarget} className="col-span-2" />
            </>
          ) : null}
          {/* Sơ cua không phải việc hằng ngày nên nó đứng cùng hàng với Đổi bàn
              thay vì chiếm riêng một khối ngay trên các nút chính. Cặp này nằm
              trong lưới hai cột của riêng nó: dù phía trên có lẻ nút thì Sơ cua
              vẫn không bị đẩy xuống dòng sau. Các nút huỷ chiếm cả dòng nên luôn
              ở dưới cùng, sau cả Sơ cua. */}
          {mainActions.map((x) =>
            x.withSpare && t ? (
              <div key={x.label} className="col-span-2 grid grid-cols-2 items-start gap-2">
                {actionButton(x)}
                <SpareButton table={t} state={st} hasClaim={Boolean(c)} inGroup={isGroup} />
              </div>
            ) : (
              actionButton(x)
            ),
          )}
          {t && !pairedSpare ? (
            <div className={cn(mainActions.length % 2 === 0 && "col-span-2")}>
              <SpareButton table={t} state={st} hasClaim={Boolean(c)} inGroup={isGroup} />
            </div>
          ) : null}
          {tailActions.map((x) => (
            <button
              key={x.label}
              type="button"
              onClick={x.go}
              disabled={x.disabled || a.pending || pending}
              title={x.title}
              className="col-span-2 h-12 rounded-xl border border-strong bg-transparent text-[15px] font-medium text-st-noshow-ink disabled:opacity-45"
            >
              {x.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

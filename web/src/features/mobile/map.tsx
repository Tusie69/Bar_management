import { Menu, X } from "lucide-react"
import { useMemo } from "react"
import type { TableLiveState } from "@/domain/models"
import type { ZoneCode } from "@/domain/venue-layout"
import { useAvailability } from "@/hooks/use-data"
import { fmtBusinessDate, fmtTime } from "@/lib/time"
import { cn } from "@/lib/utils"
import { api } from "@/services"
import { useUi } from "@/state/ui"
import { useReceptionSearch } from "@/hooks/use-reception-search"
import { FloorCanvas } from "../floor/floor-canvas"
import { StatusLegend } from "../floor/status-legend"
import { CallCustomerControl } from "../bookings/call-customer"
import { groupCode } from "../floor/floor-visual-rules"
import { ReceptionControls } from "../floor/reception-controls"
import { QuickForm } from "../floor/quick-form"
import { isWaitingForTable } from "../floor/reception-rules"
import { useBookingDraft } from "../floor/use-booking-draft"
import { useMobileActions } from "./actions"
import { useM, type TablePick } from "./context"
import { codesOf, duration, type Tone, toneStyle } from "./model"
import { BellButton, PlainHeader } from "./ui"

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
  const zone = useUi((s) => receptionist ? "ALL" : s.zone)
  const setZone = useUi((s) => s.setZone)
  const d = useBookingDraft(m.model)
  const draft = d.draft
  const waitingCount = (m.waitlist ?? []).filter(isWaitingForTable).length

  const isAssignPick = !!pick?.targetExpectedAt
  const pickAvail = useAvailability(isAssignPick ? pick.targetExpectedAt! : null, pick?.targetParty ?? 2)
  const pickSnapshot = pickAvail.isPlaceholderData || pickAvail.isError ? undefined : pickAvail.data
  const pickAvailMap = useMemo(
    () => new Map((pickSnapshot?.tables ?? []).map((t) => [t.tableId, t])),
    [pickSnapshot],
  )

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
        <header className="z-[5] shrink-0 bg-background px-4 pt-[var(--top-safe)]">
          <div className="flex h-[48px] items-center gap-3">
            <button
              type="button"
              onClick={m.openAccount}
              aria-label="Menu"
              className="grid size-10 shrink-0 place-items-center rounded-xl border border-border bg-surface-1 text-tx-strong shadow-[var(--shadow-xs)]"
            >
              <Menu className="size-5" />
            </button>
            <h1 className="m-0 min-w-0 flex-1 truncate text-[22px] font-semibold text-tx-strong">Sơ đồ bàn</h1>
            <BellButton />
          </div>
          {!pick && !draft ? (
            <div className="pb-1.5">
              <ReceptionControls
                search={search}
                onCount={m.openCount}
                onOpenBooking={m.openDetail}
                onDateChange={() => onSelect(null)}
              />
            </div>
          ) : null}
        </header>
      ) : (
        <PlainHeader
          title={pick?.targetDate ? `Sơ đồ bàn · ${fmtBusinessDate(pick.targetDate, "short")}` : "Sơ đồ bàn"}
        />
      )}
      {!pick && !(receptionist && draft) ? (
        <div className="z-[4] flex shrink-0 flex-col gap-1.5 bg-background px-4 pt-0 pb-1.5">
          {/* The receptionist always works on the whole floor; zone tabs stay for other roles. */}
          {receptionist ? null : (
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
          )}
          {draft ? null : <StatusLegend tables={m.model.tables} states={m.model.states} />}
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
        {m.model.catalog ? (
          <FloorCanvas
            className="absolute inset-0"
            tables={m.model.tables}
            zones={m.model.catalog.zones}
            mode={isAssignPick || d.bookingDraft ? "availability" : "live"}
            states={m.model.states}
            availability={d.bookingDraft ? d.availabilityMap : isAssignPick ? pickAvailMap : undefined}
            groups={isAssignPick || d.bookingDraft ? [] : m.model.floor?.groups}
            selectedIds={
              draft
                ? draft.tableIds
                : pick
                  ? pickSel
                  : selected ? [selected] : []
            }
            searchHighlightedIds={!pick && !draft ? search.tableIds : []}
            pickable={d.bookingDraft ? d.pickable : draft ? null : pickable}
            zoneFocus={receptionist ? "ALL" : zone}
            now={m.now}
            waitingCount={draft || pick ? undefined : waitingCount}
            onOpenWaitlist={draft || pick ? undefined : () => m.go("wait")}
            onTableClick={(id) => (draft ? d.onTableClick(id) : pick ? onPickToggle(id) : onSelect(id))}
            onBlockedTableClick={draft ? d.onTableClick : undefined}
            onBackgroundClick={() => (pick || draft ? undefined : onSelect(null))}
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
      {draft ? (
        <section
          role="dialog"
          aria-label="Đặt bàn trên sơ đồ"
          className="z-[12] flex max-h-[calc(100dvh-210px)] shrink-0 flex-col overflow-hidden rounded-t-[20px] border-t border-border bg-popover shadow-[var(--shadow-float)]"
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
    </main>
  )
}

const STATE_TEXT = (st: TableLiveState, late: number, noshow: number): [string, Tone] =>
  ({
    free: ["Trống", null],
    reserved: ["Đã đặt", "reserved"],
    upcoming: ["Sắp đến", "reserved"],
    late: [`Không tới · ${late} phút`, "noshow"],
    late_confirmed: [`Không tới · đã báo muộn · ${late} phút`, "noshow"],
    noshow: [`Không tới · ${noshow} phút`, "noshow"],
    seated: ["Có khách", "seated"],
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
  const zone = m.model.catalog?.zones.find((z) => z.id === t.zoneId)
  const isBar = t.kind === "BAR_SEAT"
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
  let actions: Action[] = []
  if (c?.kind === "visit") {
    who = `${c.displayName}, ${c.partySize} khách`
    when = `Đang ngồi từ ${fmtTime(c.startsAt)}, ${duration(m.now.getTime() - c.startsAt.getTime())}`
    actions = [
      { label: "Đổi bàn", go: () => a.moveVisit(c, id) },
      c.tableIds.length > 1 && c.groupId && api.mode !== "http"
        ? { label: "Tách bàn", go: () => a.split(c, id) }
        : { label: "Ghép bàn", go: () => a.combine(c) },
      ...(c.reservationId ? [{ label: "Xem booking", go: () => m.openDetail(c.reservationId!, m.today) }] : []),
      { label: "Nhả bàn", danger: true, wide: !c.reservationId, go: () => a.endVisit(c) },
    ]
  } else if (c?.kind === "waitlist_hold" || (c?.kind === "reservation" && linkedEntry)) {
    const entry = linkedEntry ?? (c?.waitlistEntryId ? m.waitlist?.find((x) => x.id === c.waitlistEntryId) : undefined)
    who = `${c.displayName}, ${c.partySize} khách`
    when = c.deadlineAt ? `Giữ từ danh sách chờ đến ${fmtTime(c.deadlineAt)}` : "Đang giữ bàn từ danh sách chờ"

    const hold = a.heldPolicy(entry, r)
    actions = [
      { label: "Khách đã đến", primary: true, wide: true, disabled: !hold.canArrival,
        title: !hold.supported ? "Chưa hỗ trợ" : undefined,
        go: () => a.arrival({ entry, reservation: r, partySize: c.partySize, tableCodes: codesOf(c.tableIds, m.model) }) },
      { label: "Quản lý đơn", go: () => r ? m.openDetail(r.id, r.businessDate) : m.openEntryDetail(entry?.id ?? c.waitlistEntryId!, m.businessDate) },
      { label: "Đổi / Ghép bàn", disabled: !hold.canReassign, title: !hold.supported ? "Chưa hỗ trợ" : undefined,
        go: () => a.reassignHold(entry, r) },
      { label: "Đổi trạng thái",
        disabled: r ? !hold.canBookingStatus || (!m.can("reservation.cancel") && !m.can("reservation.mark_no_show") && !m.can("reservation.update")) : !m.can("waitlist.cancel"),
        go: () => r ? m.openStatus(r) : entry && a.cancelEntry(entry) },
      ...(r ? [{ label: "Xem booking", go: () => m.openDetail(r.id, r.businessDate) }] : []),
      { label: "Xem đơn chờ", wide: true, disabled: !entry, go: () => entry && m.openEntryDetail(entry.id, entry.businessDate) },
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
          { label: "Đổi bàn", go: () => a.assign(r) },
          { label: "Đổi trạng thái", go: () => m.openStatus(r) },
        ]
      : []
  } else if (st === "spare") {
    info = m.isOwner
      ? "Bàn sơ cua chỉ mở khi quản lý chấp nhận vượt quy tắc."
      : "Bàn sơ cua. Cần Chủ quán/Admin mở vượt quy tắc."
    actions = m.isOwner
      ? [{ label: "Mở bàn vượt quy tắc", wide: true, go: () => m.openForm({ mode: "walkin", tableIds: [id] }) }]
      : []
  } else if (st === "oos") {
    info = "Bàn đang ngưng phục vụ."
  } else {
    info = zone?.isWaitingArea ? `${zone.name} là khu chờ, không nhận đặt trước.` : "Bàn đang trống lúc này."
    actions = [
      { label: "Mở bàn Walk-in", primary: true, go: () => m.openForm({ mode: "walkin", tableIds: [id] }) },
      {
        label: "Tạo đặt trước",
        go: () => m.openForm({ mode: "booking", tableIds: zone?.isBookable ? [id] : [] }),
      },
    ]
  }

  return (
    <div
      role="dialog"
      aria-label={`Chi tiết ${t.code}`}
      className="absolute inset-x-0 bottom-[var(--nav-h)] z-[12] flex flex-col gap-3 rounded-t-[24px] border-t border-border bg-surface-1 px-4 pt-2 pb-4 shadow-[var(--shadow-float)]"
    >
      <div className="mx-auto mb-0.5 h-[5px] w-9 rounded-[3px] bg-strong" />
      <div className="flex items-center gap-2.5">
        <span className="text-2xl font-semibold tracking-[-0.01em] text-tx-strong">
          {isBar ? `Ghế Bar ${t.seqNo}` : `Bàn ${t.code}`}
        </span>
        <span className="rounded-full px-2.5 text-xs leading-6 font-medium" style={toneStyle(tone)}>
          {chip}
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
      <span className="-mt-2 text-[13px] text-[var(--text-muted)]">
        {zone?.name}, {isBar ? "1 ghế" : `${t.capacity} chỗ`}
        {t.isSpare ? ", bàn sơ cua" : ""}
      </span>
      {who ? (
        <div className="flex flex-col gap-0.5 rounded-[14px] bg-surface-2 px-3.5 py-3">
          <span className="text-base font-medium text-tx-strong">{who}</span>
          <span className="text-[13px] text-tx-2">{when}</span>
          {c?.phoneLast3 ? <span className="text-[13px] text-[var(--text-muted)]">SĐT: ••• {c.phoneLast3}</span> : null}
          {c?.flags?.length ? (
            <span className="text-[13px] text-[var(--text-muted)]">
              {c.flags.includes("RETURNING") ? "🔥 Khách quen" : ""}
              {c.flags.includes("RETURNING") && c.flags.includes("NEW") ? " · " : ""}
              {c.flags.includes("NEW") ? "🆕 Khách mới" : ""}
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
      {actions.length ? (
        <div className="grid grid-cols-2 gap-2">
          {c?.kind === "reservation" && c.reservationId ? (
            <CallCustomerControl
              bookingId={c.reservationId}
              bookingVersion={c.version}
              canCall={c.canCall === true}
              className="col-span-2"
            />
          ) : null}
          {actions.map((x) => (
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
          ))}
        </div>
      ) : null}
    </div>
  )
}

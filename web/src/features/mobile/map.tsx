import { X } from "lucide-react"
import { useMemo } from "react"
import type { TableLiveState } from "@/domain/models"
import type { Permission } from "@/domain/access"
import { validateBookingCheckInDate } from "@/domain/booking-rules"
import type { ZoneCode } from "@/domain/venue-layout"
import { useAvailability } from "@/hooks/use-data"
import { fmtBusinessDate, fmtTime12, MS } from "@/lib/time"
import { cn } from "@/lib/utils"
import { api } from "@/services"
import { initials } from "@/lib/text"
import { useSession } from "@/state/session"
import { useUi } from "@/state/ui"
import { FloorCanvas } from "../floor/floor-canvas"
import { ReceptionControls, ReceptionDatePicker } from "../floor/reception-controls"
import { canStartTableBooking, isReceptionBookableTable } from "../floor/reception-rules"
import { useReceptionSearch } from "@/hooks/use-reception-search"
import { useMobileActions } from "./actions"
import { useM, type TablePick } from "./context"
import { codesOf, duration, isOpenEntry, type Tone, toneStyle } from "./model"
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
  const user = useSession((state) => state.user)
  const receptionist = m.role === "RECEPTIONIST"
  const search = useReceptionSearch(m.businessDate, receptionist)
  const zone = useUi((s) => s.zone)
  const setZone = useUi((s) => s.setZone)

  const isAssignPick = !!pick?.targetExpectedAt
  const pickAvail = useAvailability(isAssignPick ? pick.targetExpectedAt! : null, pick?.targetParty ?? 2)
  const pickAvailMap = useMemo(
    () => new Map((pickAvail.data?.tables ?? []).map((t) => [t.tableId, t])),
    [pickAvail.data],
  )

  const pickable = useMemo(() => {
    if (!pick) return null
    const validCatalog = (id: number) =>
      !receptionist ||
      (!!m.model.states.get(id) && isReceptionBookableTable(m.model.byId.get(id), m.model.catalog?.zones ?? []))
    if (isAssignPick) {
      const availTables = pickAvail.isPlaceholderData ? [] : (pickAvail.data?.tables ?? [])
      const ids = new Set<number>()
      for (const t of availTables) {
        if ((t.status === "available" || t.status === "too_small") && validCatalog(t.tableId)) {
          ids.add(t.tableId)
        }
      }
      for (const id of pick.preselected ?? []) if (validCatalog(id)) ids.add(id)
      for (const id of pick.exclude ?? []) ids.delete(id)
      return ids
    }
    const ids = new Set(pick.only ?? [...m.model.freeIds, ...(pick.preselected ?? [])])
    if (receptionist)
      for (const id of ids) {
        const retained = pick.only?.includes(id) || pick.preselected?.includes(id)
        if (
          !validCatalog(id) ||
          (!retained &&
            !canStartTableBooking(m.model.byId.get(id), m.model.states.get(id), m.model.catalog?.zones ?? []))
        )
          ids.delete(id)
      }
    for (const id of pick.exclude ?? []) ids.delete(id)
    return ids
  }, [pick, isAssignPick, pickAvail.data, pickAvail.isPlaceholderData, m.model, receptionist])

  const claimIds = selected ? (m.model.states.get(selected)?.claim?.tableIds ?? [selected]) : []

  return (
    <>
      {receptionist ? (
        <header className="z-[5] shrink-0 bg-background px-4 pt-[var(--top-safe)]">
          <div className="flex h-[52px] items-center gap-3">
            <button
              type="button"
              onClick={m.openAccount}
              aria-label="Tài khoản và giao diện"
              className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--glass)] text-[15px] font-semibold text-tx-strong shadow-[var(--shadow-xs)]"
            >
              {initials(user.displayName).slice(0, 1)}
            </button>
            <h1 className="m-0 min-w-0 flex-1 truncate text-[22px] font-semibold tracking-[-0.01em] text-tx-strong">
              Sơ đồ bàn
            </h1>
            {!pick ? <ReceptionDatePicker onDateChange={() => onSelect(null)} /> : null}
            <BellButton />
          </div>
          {!pick ? (
            <div className="pb-3">
              <ReceptionControls
                search={search}
                waitCount={(m.waitlist ?? []).filter(isOpenEntry).length}
                onWaitlist={() => m.go("wait")}
                onCount={m.openCount}
                onOpenBooking={m.openDetail}
              />
            </div>
          ) : null}
        </header>
      ) : (
        <PlainHeader
          title={pick?.targetDate ? `Sơ đồ bàn · ${fmtBusinessDate(pick.targetDate, "short")}` : "Sơ đồ bàn"}
        />
      )}
      <main className="relative min-h-0 flex-1 bg-[var(--floor)]">
        {m.model.catalog ? (
          <FloorCanvas
            className="absolute inset-0"
            tables={m.model.tables}
            zones={m.model.catalog.zones}
            mode={isAssignPick ? "availability" : "live"}
            states={m.model.states}
            availability={isAssignPick ? pickAvailMap : undefined}
            groups={isAssignPick ? [] : m.model.floor?.groups}
            selectedIds={pick ? pickSel : [...new Set([...claimIds, ...search.tableIds])]}
            pickable={pickable}
            zoneFocus={zone}
            now={m.now}
            onTableClick={(id) => (pick ? onPickToggle(id) : onSelect(id))}
            onBackgroundClick={() => (pick ? undefined : onSelect(null))}
            ariaLabel={
              isAssignPick
                ? `Sơ đồ khả dụng lúc ${pick.targetTime} ngày ${fmtBusinessDate(pick.targetDate!, "short")}`
                : receptionist
                  ? `Sơ đồ bàn ngày ${m.businessDate}. Kéo để di chuyển, chụm hai ngón để phóng to`
                  : "Sơ đồ bàn. Kéo để di chuyển, chụm hai ngón để phóng to"
            }
          />
        ) : null}

        {pick ? (
          <div className="absolute inset-x-3 top-2.5 z-[6] flex items-start gap-2 rounded-[14px] border border-primary bg-surface-1 py-2.5 pr-1.5 pl-3.5 shadow-[var(--shadow-soft)]">
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
        ) : (
          <div className="absolute inset-x-3 top-2.5 z-[6] flex justify-center">
            <div
              role="tablist"
              aria-label="Lọc khu"
              className="flex max-w-full gap-0.5 overflow-x-auto rounded-[14px] border border-border bg-surface-1 p-[3px] shadow-[var(--shadow-xs)]"
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
                      "flex h-[38px] shrink-0 items-center rounded-[11px] px-[13px] text-[13px] whitespace-nowrap",
                      on ? "bg-tx-strong font-semibold text-background" : "font-medium text-tx-2",
                    )}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {pick ? (
          <div className="absolute inset-x-0 bottom-0 z-[12] flex flex-col gap-2.5 rounded-t-[24px] border-t border-border bg-surface-1 px-4 pt-3.5 pb-4 shadow-[var(--shadow-float)]">
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
              disabled={!pickSel.length || pickBusy || (receptionist && pickSel.some((id) => !pickable?.has(id)))}
              onClick={onPickConfirm}
              className="h-[52px] rounded-[14px] bg-primary text-base font-semibold text-primary-foreground disabled:opacity-50"
            >
              {pickBusy ? "Đang gửi..." : pick.confirmLabel}
            </button>
          </div>
        ) : null}
      </main>
    </>
  )
}

const STATE_TEXT = (st: TableLiveState, late: number, noshow: number): [string, Tone] =>
  ({
    free: ["Trống", null],
    reserved: ["Đã đặt", "reserved"],
    late: [`Trễ ${late} phút`, "late"],
    noshow: [`Trễ ${noshow} phút`, "noshow"],
    seated: ["Có khách", "seated"],
    hold: ["Đang giữ", "reserved"],
    hold_overdue: ["Quá hạn giữ", "late"],
    oos: ["Ngưng phục vụ", null],
    spare: ["Sơ cua", null],
  })[st] as [string, Tone]

interface Action {
  label: string
  go: () => void
  primary?: boolean
  danger?: boolean
  wide?: boolean
  permission?: Permission
  disabled?: boolean
}

/** Bottom sheet over the lower half; the map stays visible and other tables stay tappable. */
export function TableSheet({ id, onClose }: { id: number; onClose: () => void }) {
  const m = useM()
  const a = useMobileActions()
  const t = m.model.byId.get(id)
  if (!t) return null
  const fs = m.model.states.get(id)
  const st = fs?.state ?? "free"
  const c = fs?.claim ?? null
  const zone = m.model.catalog?.zones.find((z) => z.id === t.zoneId)
  const isBar = t.kind === "BAR_SEAT"
  const [chip, tone] = STATE_TEXT(st, m.th.late, m.th.noshow)
  const r = c?.reservationId ? m.reservations?.find((x) => x.id === c.reservationId) : undefined

  let who = ""
  let when = ""
  let info = ""
  let actions: Action[] = []
  if (c?.kind === "reservation") {
    const left = Math.floor((c.startsAt.getTime() - m.now.getTime()) / MS.MIN)
    who = `${c.displayName}, ${c.partySize} khách`
    when = `Booking ${fmtTime12(c.startsAt)}${left < 0 ? `, trễ ${-left} phút` : `, còn ${left} phút`}`
    actions = r
      ? [
          {
            label: "Khách đã đến",
            permission: "visit.checkin",
            disabled: !!validateBookingCheckInDate(r.businessDate, m.now),
            primary: true,
            go: () => void a.checkIn(r),
          },
          { label: "Xem booking", go: () => m.openDetail(r.id, r.businessDate) },
          { label: "Đổi bàn", permission: "table.assign", go: () => a.assign(r) },
          { label: "Đổi trạng thái", go: () => m.openStatus(r) },
        ]
      : []
  } else if (c?.kind === "visit") {
    who = `${c.displayName}, ${c.partySize} khách`
    when = `Đang ngồi từ ${fmtTime12(c.startsAt)}, ${duration(m.now.getTime() - c.startsAt.getTime())}`
    actions = [
      { label: "Đổi bàn", permission: "visit.move", go: () => a.moveVisit(c, id) },
      c.tableIds.length > 1 && c.groupId && api.mode !== "http"
        ? { label: "Tách bàn", permission: "visit.split", go: () => a.split(c, id) }
        : { label: "Ghép bàn", permission: "visit.combine", go: () => a.combine(c) },
      ...(c.reservationId ? [{ label: "Xem booking", go: () => m.openDetail(c.reservationId!, m.businessDate) }] : []),
      { label: "Nhả bàn", permission: "visit.end", danger: true, wide: !c.reservationId, go: () => a.endVisit(c) },
    ]
  } else if (c?.kind === "waitlist_hold") {
    who = `${c.displayName}, ${c.partySize} khách`
    when = c.deadlineAt ? `Giữ từ danh sách chờ đến ${fmtTime12(c.deadlineAt)}` : "Đang giữ bàn từ danh sách chờ"
    actions = [{ label: "Mở đơn chờ", primary: true, wide: true, go: () => m.go("wait") }]
  } else if (st === "spare") {
    info = m.isOwner
      ? "Bàn sơ cua chỉ mở khi quản lý chấp nhận vượt quy tắc."
      : "Bàn sơ cua. Cần Chủ quán/Admin mở vượt quy tắc."
    actions = m.isOwner
      ? [
          {
            label: "Mở bàn vượt quy tắc",
            permission: "table.assign_override",
            wide: true,
            go: () => m.openForm({ mode: "walkin", tableIds: [id] }),
          },
        ]
      : []
  } else if (st === "oos") {
    info = "Bàn đang ngưng phục vụ."
  } else if (fs && st !== "free") {
    info = fs.staleFromPreviousDay
      ? "Bàn chưa được nhả từ ngày trước. Kiểm tra phân bổ trước khi thao tác."
      : "Bàn đang được giữ hoặc sử dụng, chưa có thông tin trong ngày đã chọn. Kiểm tra phân bổ trước khi thao tác."
  } else if (m.role === "RECEPTIONIST" && (!fs || !zone?.isBookable || zone.isWaitingArea)) {
    info = !fs ? "Chưa tải được trạng thái bàn." : "Khu vực này không nhận đặt bàn."
  } else {
    info = zone?.isWaitingArea ? `${zone.name} là khu chờ, không nhận đặt trước.` : "Bàn đang trống lúc này."
    actions = [
      {
        label: "Mở bàn Walk-in",
        permission: "visit.walkin",
        disabled: m.businessDate !== m.today,
        primary: true,
        go: () => m.openForm({ mode: "walkin", tableIds: [id] }),
      },
      {
        label: "Tạo đặt trước",
        permission: "reservation.create",
        go: () => m.openForm({ mode: "booking", tableIds: zone?.isBookable ? [id] : [] }),
      },
    ]
  }
  actions = actions.filter((action) => !action.permission || m.can(action.permission))

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
          {c && c.tableIds.length > 1 ? (
            <span className="text-[13px] text-[var(--text-muted)]">Nhóm: {codesOf(c.tableIds, m.model)}</span>
          ) : null}
        </div>
      ) : null}
      {info ? <span className="text-[13px] text-pretty text-[var(--text-muted)]">{info}</span> : null}
      {actions.length ? (
        <div className="grid grid-cols-2 gap-2">
          {actions.map((x) => (
            <button
              key={x.label}
              type="button"
              onClick={x.go}
              disabled={a.pending || x.disabled}
              className={cn(
                "h-12 rounded-xl border text-[15px] font-medium",
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

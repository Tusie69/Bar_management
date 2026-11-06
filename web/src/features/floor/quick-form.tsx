/**
 * The one booking sheet of the floor: "Đặt bàn" / "Walk-in" as a right column on Điều phối and as a
 * bottom sheet (`compact`) under the map on phones and portrait tablets. Date/time/party/tables live in
 * `ui.draft` so the map shows availability for the draft and tables are picked by tapping the map.
 * Submit: booking -> createReservation; `toWaitlist` booking -> createReservation + ADVANCE_RESERVATION
 * waitlist entry; walk-in with tables -> seatWalkIn; walk-in without tables -> WALK_IN waitlist.
 * The backend stays the final check against double booking (one active allocation per table per business date).
 */
import { AlertCircle, Check, ChevronDown, LoaderCircle, MousePointerClick, X } from "lucide-react"
import { useState, type KeyboardEvent } from "react"
import {
  BookingTimePicker,
  GuestPicker,
  guestCount,
  guestError,
  guestValueFrom,
  type GuestValue,
} from "@/components/booking-pickers"
import { GuardedButton } from "@/components/common"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { Permission } from "@/domain/access"
import { bookingInstant, validateBookingTime } from "@/domain/booking-rules"
import { SOURCE_LABEL, type BookingClassification, type BookingSourceCode, type WaitlistChannel } from "@/domain/enums"
import type { AvailabilityResult } from "@/domain/models"
import { useAction } from "@/hooks/use-action"
import { useNow, useVenueSettings } from "@/hooks/use-data"
import { useIdempotencyKey } from "@/hooks/use-idempotency-key"
import { NOTE_PHONE_ERROR, isPlausibleVnPhone, noteHasPhoneNumber } from "@/lib/text"
import { addDays, businessDateOf, fmtBusinessDate, fmtDayMonth, fmtTime, MS } from "@/lib/time"
import { cn } from "@/lib/utils"
import { api } from "@/services"
import { useSession } from "@/state/session"
import { useUi } from "@/state/ui"
import { toast } from "sonner"
import type { TableView } from "@/domain/models"
import type { FloorModel } from "./use-floor-model"

const PICKABLE = new Set(["available", "too_small"])

export type AvailabilityStatus = "checking" | "ready" | "error"

export function checkDirectTableCompatibility(tableIds: number[], byId: Map<number, TableView>): string | null {
  if (tableIds.length <= 1) return null
  const first = byId.get(tableIds[0])
  if (!first) return null
  for (let i = 1; i < tableIds.length; i++) {
    const t = byId.get(tableIds[i])
    if (!t) continue
    if (t.zoneId !== first.zoneId) {
      return "Chỉ có thể chọn các bàn trong cùng một khu vực."
    }
    if (t.kind !== first.kind) {
      return "Không thể ghép bàn thường với ghế Bar."
    }
  }
  return null
}

export function draftPickable(
  kind: "booking" | "walkin",
  id: number,
  model: FloorModel,
  availability: AvailabilityResult | undefined,
  currentTableIds?: number[],
): boolean {
  if (kind === "walkin") {
    const table = model.byId.get(id)
    if (!table || table.isSpare || table.status !== "ACTIVE" || model.states.get(id)?.state !== "free") return false
  } else {
    // The backend allows one active allocation per table per business date, so any booking there blocks it.
    const row = availability?.tables.find((t) => t.tableId === id)
    if (!row || !PICKABLE.has(row.status) || row.bookingConflicts?.length) return false
  }
  if (currentTableIds && currentTableIds.length > 0 && !currentTableIds.includes(id)) {
    const first = model.byId.get(currentTableIds[0])
    const candidate = model.byId.get(id)
    if (first && candidate) {
      if (candidate.zoneId !== first.zoneId) return false
      if (candidate.kind !== first.kind) return false
    }
  }
  return true
}

/** Why a selected table cannot be confirmed, in the receptionist's words. */
export function draftBlockReason(
  kind: "booking" | "walkin",
  id: number,
  model: FloorModel,
  availability: AvailabilityResult | undefined,
  date: string,
): string {
  const label = model.label(id)
  if (kind === "walkin") return `${label} không còn trống lúc này.`
  const day = fmtDayMonth(date)
  const row = availability?.tables.find((t) => t.tableId === id)
  if (row?.bookingConflicts?.length) return `${label} đã có khách đặt trong ngày ${day}.`
  switch (row?.status) {
    case "reserved":
      return `${label} đã có khách đặt trong ngày ${day}.`
    case "occupied_unknown_end":
      return `${label} đang có khách, chưa biết giờ nhả bàn. Chọn bàn khác hoặc đổi sang ngày khác.`
    case "spare":
      return `${label} là bàn sơ cua, không nhận đặt trước.`
    case "oos":
      return `${label} đang ngưng phục vụ.`
    case "not_bookable":
      return `${label} không thuộc khu nhận đặt bàn.`
    case "past":
      return `${label}: giờ này đã qua.`
    default:
      return `${label} không còn khả dụng trong ngày ${day}.`
  }
}

const CHANNEL_OF_SOURCE: Partial<Record<BookingSourceCode, WaitlistChannel>> = {
  HOTLINE: "PHONE_CALLBACK",
  FANPAGE: "FANPAGE_THREAD",
  ZALO: "ZALO_THREAD",
}

const label12 = "text-xs text-tx-2"
// 16px on phones stops iOS focus zoom.
const inputCls =
  "h-11 w-full rounded-sm border border-strong bg-background px-3 text-base sm:text-sm outline-none placeholder:text-tx-3 focus:border-foreground aria-[invalid=true]:border-st-noshow"

function FieldError({ children }: { children?: string }) {
  return children ? (
    <span role="alert" className="text-xs text-st-noshow-ink">
      {children}
    </span>
  ) : null
}

export function QuickForm({
  model,
  availability,
  availabilityStatus = "ready",
  onRetryAvailability,
  compact = false,
}: {
  model: FloorModel
  availability: AvailabilityResult | undefined
  availabilityStatus?: AvailabilityStatus
  onRetryAvailability?: () => void
  /** Bottom sheet under the map: shrinks so the whole floor stays tappable. */
  compact?: boolean
}) {
  const ui = useUi()
  const draft = ui.draft!
  const now = useNow(30_000)
  const quickTimes = useVenueSettings().data?.quickTimes ?? []
  const today = businessDateOf(now)
  const receptionist = useSession((s) => s.user.role === "RECEPTIONIST")
  const { run, pending } = useAction()
  const [phone, setPhone] = useState("")
  const [name, setName] = useState("")
  const [note, setNote] = useState("")
  const [source, setSource] = useState<BookingSourceCode>("HOTLINE")
  const [classification, setClassification] = useState<BookingClassification>("UNCLASSIFIED")
  const [isBirthday, setIsBirthday] = useState(false)
  const [tried, setTried] = useState(false)
  const [guest, setGuest] = useState<GuestValue>(() => guestValueFrom(draft.party))
  // Selection when "Chọn thêm bàn" was pressed; any change to it reopens the form.
  const [addingFrom, setAddingFrom] = useState<string | null>(null)
  const [confirmLeave, setConfirmLeave] = useState(false)

  const isB = draft.kind === "booking"
  const toWaitlist = isB && !!draft.toWaitlist
  const close = isB ? ui.closeBooking : ui.closeWalkIn
  const dirty = !!(name.trim() || phone.trim() || note.trim())
  const requestClose = () => (dirty ? setConfirmLeave(true) : close())
  // Re-derived every render: changing the date re-checks the time without silently replacing it.
  const timeError = isB ? validateBookingTime(draft.date, draft.time, now) : null
  const at = isB && !timeError ? bookingInstant(draft.date, draft.time) : null
  const party = guestCount(guest)
  const venue = model.catalog?.venue

  const errors: { name?: string; phone?: string; note?: string; time?: string; party?: string } = {}
  if (isB && !name.trim() && !phone.trim()) errors.name = "Cần ít nhất tên hoặc số điện thoại"
  if (isB && phone.trim() && !isPlausibleVnPhone(phone)) errors.phone = "Số điện thoại 10 số, bắt đầu bằng 0"
  if (isB && noteHasPhoneNumber(note)) errors.note = NOTE_PHONE_ERROR
  if (timeError) errors.time = timeError
  const pErr = guestError(guest)
  if (pErr) errors.party = pErr
  const shown = tried ? errors : {}

  const onGuest = (v: GuestValue) => {
    setGuest(v)
    const n = guestCount(v)
    if (n !== null) ui.setDraft({ party: n })
  }

  const dates = Array.from({ length: 7 }, (_, i) => addDays(today, i))
  if (!dates.includes(draft.date)) dates.push(draft.date)
  const dateLabel = (bd: string, i: number) =>
    i === 0
      ? `Hôm nay · ${fmtDayMonth(bd)}`
      : i === 1
        ? `Ngày mai · ${fmtDayMonth(bd)}`
        : fmtBusinessDate(bd).replace(", ", " · ")

  const tables = toWaitlist ? [] : draft.tableIds
  const codes = tables.map((id) => model.label(id)).join(" + ")
  const checking = isB && tables.length > 0 && availabilityStatus !== "ready"
  const compatError = isB ? checkDirectTableCompatibility(tables, model.byId) : null
  // A passed time is the time's problem, not the table's: fix the time first.
  const blocked =
    checking || timeError ? [] : tables.filter((id) => !draftPickable(draft.kind, id, model, availability, tables))
  const cap = tables.reduce((s, id) => s + (model.byId.get(id)?.capacity ?? 0), 0)
  const short = party === null ? 0 : party - cap
  // Receptionist flow A is table-first: no table never silently becomes an unassigned booking.
  const needsTable = receptionist && isB && !toWaitlist && tables.length === 0
  const choosing = !!draft.replacing || addingFrom === draft.tableIds.join()
  const collapsed = compact && (choosing || needsTable)

  const chooseOther = () => {
    blocked.forEach((id) => ui.toggleDraftTable(id))
    setAddingFrom(draft.tableIds.filter((id) => !blocked.includes(id)).join())
  }

  // Best-fit free tables (same order as the old walk-in sheet) so a walk-in stays two taps.
  const zoneOk = new Set(model.catalog?.zones.filter((z) => z.isBookable).map((z) => z.id))
  const selectedFirstTable = tables.length > 0 ? model.byId.get(tables[0]) : null
  const suggestions = model.tables
    .filter((t) => t.kind === "TABLE" && zoneOk.has(t.zoneId) && t.capacity >= draft.party && !tables.includes(t.id))
    .filter((t) => {
      if (selectedFirstTable && (t.zoneId !== selectedFirstTable.zoneId || t.kind !== selectedFirstTable.kind)) {
        return false
      }
      return isB
        ? draftPickable("booking", t.id, model, availability) &&
            availability?.tables.find((a) => a.tableId === t.id)?.status === "available"
        : model.states.get(t.id)?.state === "free"
    })
    .sort((a, b) => a.capacity - b.capacity || a.code.localeCompare(b.code))
    .slice(0, 5)

  const permission: Permission = isB ? "reservation.create" : tables.length ? "visit.walkin" : "waitlist.create"

  // FX-04: 1 mã chống trùng cho lần mở form; đổi mã sau mỗi lần tạo thành công.
  const [idempotencyKey, renewIdempotencyKey] = useIdempotencyKey()
  const submit = async () => {
    setTried(true)
    if (Object.keys(errors).length || blocked.length || party === null || compatError) {
      if (errors.name) document.getElementById("qf-name")?.focus()
      else if (errors.phone) document.getElementById("qf-phone")?.focus()
      return
    }
    if (isB) {
      if (tables.length > 0 && short > 0) {
        toast.error(
          `Các bàn đã chọn chỉ có ${cap} chỗ cho ${party} khách. Chọn thêm bàn phù hợp hoặc bỏ chọn bàn để xếp sau.`,
        )
        return
      }
      if (!at) return
      const r = await run(async (o) => {
        const created = await api.createReservation({
          contactName: name.trim() || undefined,
          phone: phone.trim() || undefined,
          partySize: party,
          expectedAt: at,
          sourceCode: source,
          classification,
          guestType: classification === "RETURNING" ? "REGULAR" : classification === "NEW" ? "NEW" : null,
          isBirthday,
          note: note.trim() || undefined,
          tableIds: tables,
          overrideReason: o,
          idempotencyKey,
        })
        if (!toWaitlist) return created
        // Retrying after a failed second call replays the first one through its idempotency key.
        return api.addWaitlist({
          kind: "ADVANCE_RESERVATION",
          reservationId: created.reservationId,
          channel: CHANNEL_OF_SOURCE[source] ?? "OTHER",
          preferenceMode: "ANY",
          preferences: [],
          idempotencyKey: idempotencyKey && `${idempotencyKey.slice(0, 60)}-wl`,
        })
      })
      if (r) {
        renewIdempotencyKey()
        close()
      }
      return
    }
    if (tables.length) {
      const ids = tables
      const r = await run((o) =>
        api.seatWalkIn({
          tableIds: ids,
          guestCount: party,
          contactName: name.trim() || undefined,
          overrideReason: o,
          idempotencyKey,
        }),
      )
      if (r) {
        renewIdempotencyKey()
        close()
        ui.selectTable(ids[0])
      }
      return
    }
    const r = await run(() =>
      api.addWaitlist({
        kind: "WALK_IN",
        contactName: name.trim() || `Khách Walk-in ${party} người`,
        partySize: party,
        channel: "IN_PERSON",
        preferenceMode: "ANY",
        preferences: [],
        idempotencyKey,
      }),
    )
    if (r) {
      renewIdempotencyKey()
      close()
    }
  }

  // The one main action. It follows the checks instead of warning next to a button that still submits.
  const lacksSeats = receptionist && tables.length > 0 && short > 0 && !compatError
  const cta: { label: string; disabled?: boolean; go: () => void } = pending
    ? { label: "Đang lưu…", disabled: true, go: submit }
    : blocked.length
      ? { label: "Chọn bàn khác", go: chooseOther }
      : timeError
        ? { label: "Chọn lại giờ", disabled: true, go: submit }
        : checking
          ? {
              label: availabilityStatus === "error" ? "Chưa kiểm tra được bàn" : "Đang kiểm tra bàn…",
              disabled: true,
              go: submit,
            }
          : needsTable
            ? { label: "Chạm bàn trên sơ đồ", disabled: true, go: submit }
            : lacksSeats
              ? { label: `Thiếu ${short} chỗ · Chọn thêm bàn`, go: chooseOther }
              : toWaitlist
                ? { label: "Lưu vào Bàn chờ", go: submit }
                : isB
                  ? { label: receptionist && codes ? `Đặt bàn ${codes}` : "Lưu đặt bàn", go: submit }
                  : tables.length
                    ? { label: "Mở bàn ngay", go: submit }
                    : { label: receptionist ? "Thêm vào Bàn chờ" : "Thêm vào danh sách chờ", go: submit }

  const title = toWaitlist
    ? "Nhận booking vào Bàn chờ"
    : isB
      ? codes
        ? `Đặt bàn ${codes}`
        : "Tạo đặt bàn"
      : codes
        ? `Walk-in ${codes}`
        : "Walk-in vào Bàn chờ"

  const tab = (on: boolean) =>
    cn("h-[38px] rounded-sm text-sm", on ? "bg-primary-tint font-medium text-primary-ink" : "text-tx-2 hover:text-tx-1")

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && !event.defaultPrevented) requestClose()
  }

  return (
    <div
      className="relative flex h-full min-h-0 flex-col"
      aria-label={isB ? `Tạo đặt bàn ${codes}`.trim() : `Mở bàn Walk-in ${codes}`.trim()}
      role="form"
      onKeyDown={onKeyDown}
    >
      <div className={cn("flex shrink-0 items-center gap-3 border-b pr-3", compact ? "h-14 pl-4" : "h-[60px] pl-5")}>
        <h2 className="m-0 mr-auto min-w-0 truncate text-[17px] font-semibold text-tx-strong">{title}</h2>
        {compact && tables.length && !blocked.length && !choosing ? (
          <button
            type="button"
            className="h-11 shrink-0 rounded-sm px-2 text-sm font-medium text-primary-ink"
            onClick={() => ui.setDraft({ replacing: true })}
          >
            Đổi bàn
          </button>
        ) : null}
        <Button variant="ghost" size="icon" className="size-11" aria-label="Đóng form" onClick={requestClose}>
          <X />
        </Button>
      </div>

      {collapsed ? (
        <div className="flex shrink-0 flex-col gap-2 px-4 pt-3 pb-1 text-sm">
          <p className="m-0 flex items-start gap-2 text-tx-1">
            <MousePointerClick className="mt-0.5 size-4 shrink-0 text-primary-ink" aria-hidden />
            Chạm bàn trống trên sơ đồ. Thông tin đã nhập được giữ nguyên.
          </p>
          {choosing && !needsTable ? (
            <Button
              variant="outline"
              className="h-11 self-start border-strong"
              onClick={() => {
                ui.setDraft({ replacing: false })
                setAddingFrom(null)
              }}
            >
              Quay lại form
            </Button>
          ) : null}
        </div>
      ) : null}

      <div
        className={cn(
          "flex min-h-0 flex-1 scrollbar-thin flex-col gap-4 overflow-x-hidden overflow-y-auto overscroll-contain pt-3 pb-4",
          compact ? "px-4" : "px-5",
          collapsed && "hidden",
        )}
      >
        {toWaitlist ? null : (
          <div
            role="tablist"
            aria-label="Loại đơn"
            className="grid shrink-0 grid-cols-2 gap-0.5 rounded-sm border bg-surface-1 p-[3px]"
          >
            <button
              type="button"
              role="tab"
              aria-selected={isB}
              className={tab(isB)}
              onClick={() => ui.switchDraft("booking")}
            >
              Đặt bàn
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={!isB}
              className={tab(!isB)}
              onClick={() => {
                if (model.floor && model.floor.businessDate !== today)
                  return void toast.info("Walk-in chỉ áp dụng cho ngày kinh doanh hiện tại.")
                ui.switchDraft("walkin")
              }}
            >
              Walk-in
            </button>
          </div>
        )}

        <section className="flex shrink-0 flex-col gap-2" aria-label="Khách">
          <div className={cn("grid gap-3", isB && "grid-cols-2")}>
            <div className="flex min-w-0 flex-col gap-1.5">
              <label htmlFor="qf-name" className={label12}>
                {isB ? "Tên khách" : "Tên hoặc đặc điểm (tùy chọn)"}
              </label>
              <input
                id="qf-name"
                className={inputCls}
                autoComplete="off"
                placeholder={isB ? "Tên người đặt" : "Khách Walk-in"}
                value={name}
                aria-invalid={!!shown.name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            {isB ? (
              <div className="flex min-w-0 flex-col gap-1.5">
                <label htmlFor="qf-phone" className={label12}>
                  Số điện thoại
                </label>
                <input
                  id="qf-phone"
                  className={cn(inputCls, "tnum")}
                  inputMode="tel"
                  autoComplete="off"
                  maxLength={20}
                  placeholder="0xxx xxx xxx"
                  value={phone}
                  aria-invalid={!!shown.phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            ) : null}
          </div>
          <FieldError>{shown.name}</FieldError>
          <FieldError>{shown.phone}</FieldError>
        </section>

        <section className="flex shrink-0 flex-col gap-3" aria-label="Số khách và thời gian">
          <GuestPicker value={guest} onChange={onGuest} showErrors={tried} />
          {isB ? (
            <>
              <div className="flex flex-col gap-1.5">
                <span className={label12}>Ngày</span>
                <Select value={draft.date} onValueChange={(date) => ui.setDraft({ date })}>
                  <SelectTrigger className="h-11 w-full border-strong" aria-label="Ngày">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {dates.map((bd, i) => (
                      <SelectItem key={bd} value={bd} className="tnum">
                        {dateLabel(bd, i)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <BookingTimePicker
                date={draft.date}
                value={draft.time}
                now={now}
                onChange={(time) => ui.setDraft({ time })}
                quickTimes={quickTimes}
              />
            </>
          ) : (
            <div className="flex items-baseline justify-between gap-2">
              <span className={label12}>Vào lúc</span>
              <span className="tnum text-sm">{fmtTime(now)} · bây giờ</span>
            </div>
          )}
        </section>

        {isB ? (
          <section className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className={label12}>Loại khách</span>
              <Select value={classification} onValueChange={(v) => setClassification(v as BookingClassification)}>
                <SelectTrigger className="h-11 w-full border-strong" aria-label="Loại khách">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="UNCLASSIFIED">Chưa phân loại</SelectItem>
                  <SelectItem value="NEW">Khách mới (N)</SelectItem>
                  <SelectItem value="RETURNING">Khách quen (O)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="flex h-11 items-center gap-2.5 text-sm">
              <Checkbox checked={isBirthday} onCheckedChange={(checked) => setIsBirthday(checked === true)} />
              Sinh nhật
            </label>
          </section>
        ) : null}

        {toWaitlist || (compact && tables.length === 1 && short <= 0) ? null : (
          <section className="flex shrink-0 flex-col gap-2" aria-label="Bàn">
            <div className="flex items-baseline justify-between gap-2">
              <span className={label12}>Bàn</span>
              {compact ? null : <span className="text-xs text-tx-2">Chạm vị trí trống trên sơ đồ</span>}
            </div>
            {tables.length ? (
              <div className="flex flex-wrap items-center gap-2">
                {tables.map((id) => {
                  const bad = blocked.includes(id)
                  return (
                    <button
                      key={id}
                      type="button"
                      aria-label={`Bỏ ${model.label(id)}`}
                      onClick={() => ui.toggleDraftTable(id)}
                      className={cn(
                        "tnum flex h-11 items-center gap-1.5 rounded-sm border pr-2 pl-3 text-sm font-medium",
                        bad
                          ? "border-st-noshow bg-st-noshow-tint text-st-noshow-ink"
                          : "border-primary bg-primary-tint text-primary-ink",
                      )}
                    >
                      {model.label(id)}
                      <X className="size-3.5" aria-hidden />
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="flex min-h-11 items-center rounded-sm border border-dashed border-strong px-3 text-xs text-tx-2">
                {!isB
                  ? "Chưa chọn bàn · nếu hết chỗ, đưa vào Bàn chờ"
                  : receptionist
                    ? "Chưa chọn bàn"
                    : "Chưa chọn bàn · có thể xếp sau"}
              </div>
            )}
            {suggestions.length > 0 && party !== null && cap < party ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-tx-2">Gợi ý</span>
                {suggestions.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    aria-label={`Gợi ý ${t.code}`}
                    onClick={() => ui.toggleDraftTable(t.id)}
                    className="tnum flex h-11 items-center gap-1 rounded-sm border border-strong px-2.5 text-sm hover:bg-surface-2"
                  >
                    {t.code} <span className="text-xs text-tx-2">{t.capacity}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </section>
        )}

        {/* shortcut: WalkInInput has no note/phone yet, so those fields are booking-only. */}
        {isB ? (
          <details className="group shrink-0" open={!compact || !!shown.note}>
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 text-sm font-medium text-tx-1 [&::-webkit-details-marker]:hidden">
              Thêm thông tin
              <span className="flex items-center gap-1 text-xs font-normal text-tx-2">
                {SOURCE_LABEL[source]}
                {note.trim() ? " · có ghi chú" : ""}
                <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
              </span>
            </summary>
            <div className="flex flex-col gap-3 pt-1">
              <div className="flex flex-col gap-1.5">
                <span className={label12}>Nguồn đặt</span>
                <Select value={source} onValueChange={(v) => setSource(v as BookingSourceCode)}>
                  <SelectTrigger className="h-11 w-full border-strong" aria-label="Nguồn đặt">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(model.catalog?.sources ?? []).map((s) => (
                      <SelectItem key={s.code} value={s.code}>
                        {SOURCE_LABEL[s.code]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="qf-note" className={label12}>
                  Ghi chú
                </label>
                <textarea
                  id="qf-note"
                  rows={2}
                  className={cn(inputCls, "h-auto resize-none py-2.5")}
                  placeholder="Sinh nhật, cần ghế trẻ em…"
                  value={note}
                  aria-invalid={!!shown.note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <FieldError>{shown.note}</FieldError>
              </div>
              {at && venue ? (
                <span className="tnum text-xs text-pretty text-tx-2">
                  {`Cảnh báo đến muộn lúc ${fmtTime(new Date(at.getTime() + venue.lateWarningMinutes * MS.MIN))} · không tới lúc ${fmtTime(new Date(at.getTime() + venue.noShowWarningMinutes * MS.MIN))}`}
                </span>
              ) : null}
            </div>
          </details>
        ) : null}
      </div>

      <div
        className={cn(
          "flex shrink-0 flex-col gap-2 border-t bg-popover px-4 pt-2.5 pb-[calc(12px+env(safe-area-inset-bottom))]",
          compact && choosing && !needsTable && "hidden",
        )}
      >
        {blocked.length ? (
          <p role="alert" className="m-0 flex items-start gap-2 text-sm text-st-noshow-ink">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {blocked.map((id) => draftBlockReason(draft.kind, id, model, availability, draft.date)).join(" ")}
          </p>
        ) : timeError ? (
          <p role="alert" className="m-0 flex items-start gap-2 text-sm text-st-noshow-ink">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {timeError}
          </p>
        ) : compatError ? (
          <FieldError>{compatError}</FieldError>
        ) : availabilityStatus === "error" && tables.length ? (
          <p role="alert" className="m-0 flex items-center gap-2 text-sm text-st-noshow-ink">
            <AlertCircle className="size-4 shrink-0" aria-hidden />
            Không kiểm tra được bàn.
            <button type="button" className="min-h-11 font-medium underline" onClick={onRetryAvailability}>
              Thử lại
            </button>
          </p>
        ) : checking ? (
          <p role="status" className="m-0 flex items-center gap-2 text-sm text-tx-2">
            <LoaderCircle className="size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
            Đang kiểm tra {codes} ngày {fmtDayMonth(draft.date)}…
          </p>
        ) : tables.length ? (
          <p
            role="status"
            className={cn(
              "tnum m-0 flex items-start gap-2 text-sm",
              short > 0 ? "text-st-late-ink" : "text-st-seated-ink",
            )}
          >
            {short > 0 ? (
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            ) : (
              <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
            )}
            {party === null
              ? `${codes} còn trống · ${cap} chỗ`
              : short > 0
                ? `${codes} có ${cap} chỗ · thiếu ${short} chỗ cho ${party} khách`
                : isB
                  ? `${codes} còn trống ngày ${fmtDayMonth(draft.date)} · ${cap} chỗ, đủ ${party} khách`
                  : `${codes} đang trống · ${cap} chỗ, đủ ${party} khách`}
          </p>
        ) : toWaitlist ? (
          <p role="status" className="m-0 text-sm text-tx-2">
            Lưu vào Bàn chờ ngày {fmtDayMonth(draft.date)}. Chưa giữ bàn cho đến khi chuyển bàn.
          </p>
        ) : null}
        {needsTable ? (
          <button
            type="button"
            className="min-h-11 self-start text-sm font-medium text-primary-ink"
            onClick={() => ui.setDraft({ toWaitlist: true })}
          >
            Chưa xếp được bàn? Lưu vào Bàn chờ
          </button>
        ) : null}
        <div className={cn("grid gap-2", !compact && "grid-cols-[1fr_2fr]")}>
          {compact ? null : (
            <Button variant="outline" className="h-11 border-strong bg-transparent" onClick={requestClose}>
              Hủy
            </Button>
          )}
          <GuardedButton
            permission={permission}
            className={cn("font-semibold", compact ? "h-[52px] text-base" : "h-11")}
            disabled={!!cta.disabled}
            aria-busy={pending}
            onClick={cta.go}
          >
            {cta.label}
          </GuardedButton>
        </div>
      </div>

      {confirmLeave ? (
        <div className="absolute inset-0 z-[3] grid place-items-center bg-[var(--scrim)] p-5">
          <div
            role="alertdialog"
            aria-label="Bỏ đơn đang nhập"
            aria-modal="true"
            className="flex w-full max-w-sm flex-col gap-3 rounded-lg bg-surface-1 p-5 shadow-float"
          >
            <span className="text-[17px] font-semibold text-tx-strong">Bỏ đơn đang nhập?</span>
            <span className="text-sm text-tx-2">Thông tin vừa nhập sẽ không được lưu.</span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="h-11 flex-1 border-strong"
                autoFocus
                onClick={() => setConfirmLeave(false)}
              >
                Tiếp tục nhập
              </Button>
              <Button variant="destructive" className="h-11 flex-1" onClick={close}>
                Bỏ đơn
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

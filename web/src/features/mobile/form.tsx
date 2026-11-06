import { ChevronLeft } from "lucide-react"
import { useId, useMemo, useState } from "react"
import {
  bookingCalendarDate,
  bookingInstant,
  defaultBookingSlot,
  GUEST_QUICK,
  isAfterMidnight,
  parseOtherGuests,
  slotLabel,
  validateBookingTime,
} from "@/domain/booking-rules"
import { SOURCE_LABEL, type BookingClassification, type BookingSourceCode } from "@/domain/enums"
import { BookingTimePicker } from "@/components/booking-pickers"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { useAvailability } from "@/hooks/use-data"
import { useAction } from "@/hooks/use-action"
import { useIdempotencyKey } from "@/hooks/use-idempotency-key"
import { isPlausibleVnPhone, NOTE_PHONE_ERROR, noteHasPhoneNumber } from "@/lib/text"
import { addDays, fmtBusinessDate, fmtDayMonth } from "@/lib/time"
import { cn } from "@/lib/utils"
import { api } from "@/services"
import { FloorCanvas } from "../floor/floor-canvas"
import { useM, type FormRequest } from "./context"
import { codesOf } from "./model"
import { Seg } from "./ui"
import {
  selectedCapacity,
  walkInBlockReason,
  walkInPickableIds,
  walkInSelectionIssues,
} from "./walk-in-selection"
import {
  bookingSelectionIssues,
  bookingTableBadge,
  isTableAvailableForBooking,
} from "./booking-table-selection"

interface Option {
  key: string
  ids: number[]
  label: string
  sub: string
}

const field =
  "h-12 w-full rounded-xl border border-strong bg-background px-3.5 text-base text-tx-1 outline-none focus:border-primary focus:shadow-[0_0_0_3px_var(--primary-tint)]"

/** Full-screen "Tạo đơn đặt bàn": Đặt trước / Walk-in. Rules come from domain/booking-rules.ts (same as Desktop). */
export function FormScreen({ req, onClose }: { req: FormRequest; onClose: () => void }) {
  const m = useM()
  const uid = useId()
  const { run, pending } = useAction()
  const preset = useMemo(() => req.tableIds ?? [], [req.tableIds])
  const [mode, setMode] = useState(req.mode)
  const [party, setParty] = useState(preset.length ? Math.min(8, preset.length * 4) : 4)
  const [isOther, setIsOther] = useState(false)
  const [otherText, setOtherText] = useState("")
  const [dateIdx, setDateIdx] = useState(() =>
    req.date ? Math.max(0, Math.round((Date.parse(`${req.date}T00:00:00Z`) - Date.parse(`${m.today}T00:00:00Z`)) / 86_400_000)) : 0,
  )
  const [slot, setSlot] = useState<string | null>(() => defaultBookingSlot(req.date ?? m.today, m.now))
  const [checked, setChecked] = useState(preset.length > 0)
  const [choice, setChoice] = useState<Option | null>(
    preset.length ? { key: "preset", ids: preset, label: codesOf(preset, m.model), sub: "" } : null,
  )
  const [phone, setPhone] = useState("")
  const [name, setName] = useState("")
  const [source, setSource] = useState<BookingSourceCode>("HOTLINE")
  const [classification, setClassification] = useState<BookingClassification>("UNCLASSIFIED")
  const [isBirthday, setIsBirthday] = useState(false)
  const [note, setNote] = useState("")
  const [tried, setTried] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [selectionMessage, setSelectionMessage] = useState<string | null>(null)

  const isBooking = mode === "booking"
  const bd = addDays(m.today, dateIdx)
  const other = isOther ? parseOtherGuests(otherText) : null
  const guests = isOther ? (other?.ok ? other.value : null) : party
  const timeErr = isBooking ? validateBookingTime(bd, slot, m.now) : null
  const at = isBooking && slot && !timeErr ? bookingInstant(bd, slot) : null
  const nextDay = !!at && !!slot && isAfterMidnight(slot)
  const slotText =
    at && slot ? `${slotLabel(slot)}${nextDay ? ` (sáng ${fmtDayMonth(bookingCalendarDate(bd, slot))})` : ""}` : ""
  const phoneOk = !phone.trim() || isPlausibleVnPhone(phone)
  const guestMissing = isBooking && !phone.trim() && !name.trim()
  const noteBad = noteHasPhoneNumber(note)
  const errOther = !!other && !other.ok && (tried || !!otherText.trim())
  const errTime = isBooking && !!timeErr && (tried || !!slot)
  const errGuest = tried && (guestMissing || !phoneOk)

  const isSameBusinessDate = m.model.floor?.businessDate
    ? bd === m.model.floor.businessDate
    : bd === m.today
  const bookableZoneIds = useMemo(
    () => new Set(m.model.catalog?.zones.filter((zone) => zone.isBookable).map((zone) => zone.id) ?? []),
    [m.model.catalog],
  )

  const avail = useAvailability(isBooking && checked && guests ? at : null, guests ?? 1).data
  const availMap = useMemo(
    () => new Map((avail?.tables ?? []).map((t) => [t.tableId, t])),
    [avail?.tables],
  )

  const presetIssues = useMemo(() => {
    if (!isBooking || !preset.length || !guests) return []
    return bookingSelectionIssues(
      preset,
      m.model.byId,
      m.model.states,
      availMap,
      bookableZoneIds,
      isSameBusinessDate,
      guests,
    )
  }, [
    isBooking,
    preset,
    guests,
    m.model.byId,
    m.model.states,
    availMap,
    bookableZoneIds,
    isSameBusinessDate,
  ])

  const presetBadge = useMemo(() => {
    if (!preset.length) return null
    const firstTable = m.model.byId.get(preset[0])
    if (!firstTable) return "Không khả dụng"
    return bookingTableBadge(
      firstTable,
      m.model.states.get(preset[0]),
      availMap.get(preset[0]),
      isSameBusinessDate,
    )
  }, [preset, m.model.byId, m.model.states, availMap, isSameBusinessDate])

  const choiceIssues = useMemo(() => {
    if (!isBooking || !choice?.ids.length || !guests) return []
    return bookingSelectionIssues(
      choice.ids,
      m.model.byId,
      m.model.states,
      availMap,
      bookableZoneIds,
      isSameBusinessDate,
      guests,
    )
  }, [
    isBooking,
    choice,
    guests,
    m.model.byId,
    m.model.states,
    availMap,
    bookableZoneIds,
    isSameBusinessDate,
  ])

  const options = useMemo<Option[]>(() => {
    if (!checked || !guests || !isBooking) return []
    const fits = m.model.tables
      .filter((t) => t.kind === "TABLE" && t.capacity >= guests && bookableZoneIds.has(t.zoneId))
      .filter((t) =>
        isTableAvailableForBooking(
          t,
          m.model.states.get(t.id),
          availMap.get(t.id),
          bookableZoneIds,
          isSameBusinessDate,
          guests,
        ),
      )
      .sort((a, b) => a.capacity - b.capacity || a.code.localeCompare(b.code))
      .slice(0, 6)
      .map((t) => ({
        key: `t${t.id}`,
        ids: [t.id],
        label: t.code,
        sub: `${t.capacity} chỗ`,
      }))
    const combos = (avail?.combinations ?? [])
      .filter((c) => c.available && c.capacity >= guests)
      .slice(0, 2)
      .flatMap((c) => {
        const v = m.model.catalog?.combinations.find((x) => x.id === c.combinationId)
        return v
          ? [
              {
                key: `c${v.id}`,
                ids: v.memberIds,
                label: v.displayName,
                sub: `${codesOf(v.memberIds, m.model)}, ${c.capacity} chỗ`,
              },
            ]
          : []
      })
    const list = [...fits, ...combos]
    const isPresetFree = preset.length > 0 && presetIssues.length === 0
    if (isPresetFree && !list.some((o) => o.ids.join() === preset.join())) {
      const presetCap = selectedCapacity(preset, m.model.byId)
      list.unshift({
        key: "preset",
        ids: preset,
        label: codesOf(preset, m.model),
        sub: `${presetCap} chỗ, chọn từ sơ đồ`,
      })
    }
    return list
  }, [
    checked,
    guests,
    isBooking,
    avail?.combinations,
    availMap,
    m.model,
    preset,
    presetIssues.length,
    bookableZoneIds,
    isSameBusinessDate,
  ])

  const selectedWalkInIds = useMemo(() => (!isBooking ? (choice?.ids ?? []) : []), [choice, isBooking])
  const walkInPickable = useMemo(
    () => walkInPickableIds(m.model.tables, m.model.states, bookableZoneIds, selectedWalkInIds),
    [m.model.tables, m.model.states, bookableZoneIds, selectedWalkInIds],
  )
  const walkInCapacity = selectedCapacity(selectedWalkInIds, m.model.byId)
  const walkInIssues = walkInSelectionIssues(
    selectedWalkInIds,
    m.model.byId,
    m.model.states,
    bookableZoneIds,
  )
  const walkInReady = !!guests && selectedWalkInIds.length > 0 && walkInCapacity >= guests && walkInIssues.length === 0

  const reset = () => {
    // Revalidate the existing map selection when date/time/party changes.
    // Only an explicit table toggle or cancel should discard the user's choice.
    setChecked(!!choice)
    setSelectionMessage(null)
  }
  const touch = () => setDirty(true)
  const choiceIsBlocked = isBooking && choiceIssues.length > 0
  const tableLabel = choice
    ? `Bàn ${choice.label}${choiceIsBlocked ? " (không khả dụng)" : ""}`
    : isBooking
      ? "chưa chọn bàn"
      : "chưa có bàn"
  const dayOffsets = Array.from({ length: 7 }, (_, i) => i)
  if (dateIdx > 6) dayOffsets.push(dateIdx)
  const days = dayOffsets.map((i) => {
    const [wd, dm] = fmtBusinessDate(addDays(m.today, i), "short").split(", ")
    return { offset: i, top: i === 0 ? "Hôm nay" : wd, day: dm }
  })

  const toggleWalkInTable = (id: number) => {
    const current = selectedWalkInIds
    const selected = current.includes(id)
    const table = m.model.byId.get(id)
    if (!selected && table) {
      const anchor = current.length ? m.model.byId.get(current[0]) : undefined
      const reason = walkInBlockReason(table, m.model.states.get(id), bookableZoneIds, anchor)
      if (reason) {
        setSelectionMessage(reason)
        return
      }
    }
    const next = selected ? current.filter((tableId) => tableId !== id) : [...current, id]
    setChoice(next.length ? { key: "map", ids: next, label: codesOf(next, m.model), sub: "" } : null)
    setSelectionMessage(null)
    touch()
  }

  const explainBlockedWalkInTable = (id: number) => {
    const table = m.model.byId.get(id)
    if (!table) return setSelectionMessage(`Bàn #${id} không còn trong sơ đồ.`)
    const anchor = selectedWalkInIds.length ? m.model.byId.get(selectedWalkInIds[0]) : undefined
    setSelectionMessage(
      walkInBlockReason(table, m.model.states.get(id), bookableZoneIds, anchor) ?? `${m.model.label(id)} không thể chọn.`,
    )
  }

  // FX-04: 1 mã chống trùng cho lần mở form; đổi mã sau mỗi lần tạo thành công.
  const [idempotencyKey, renewIdempotencyKey] = useIdempotencyKey()
  const submit = async () => {
    if (guests === null || (isBooking ? guestMissing || !phoneOk || !at : false) || noteBad) {
      setTried(true)
      return
    }
    const ids = choice?.ids ?? []
    if (isBooking && ids.length) {
      if (choiceIssues.length) {
        setTried(true)
        setSelectionMessage(
          `${choiceIssues[0]} Vui lòng chọn bàn trống khác hoặc bỏ chọn bàn để lưu chưa xếp bàn.`,
        )
        return
      }
    }
    if (!isBooking && ids.length && !walkInReady) {
      setTried(true)
      setSelectionMessage(
        walkInIssues[0] ?? `Mới chọn ${walkInCapacity}/${guests} chỗ. Chạm thêm bàn hoặc ghế phù hợp trên sơ đồ.`,
      )
      return
    }
    const ok = isBooking
      ? await run((o) =>
          api.createReservation({
            contactName: name.trim() || undefined,
            phone: phone.trim() || undefined,
            partySize: guests,
            expectedAt: at!,
            sourceCode: source,
            classification,
            guestType: classification === "RETURNING" ? "REGULAR" : classification === "NEW" ? "NEW" : null,
            isBirthday,
            note: note.trim() || undefined,
            tableIds: ids,
            overrideReason: o,
            idempotencyKey,
          }),
        )
      : ids.length
        ? await run((o) =>
            api.seatWalkIn({
              tableIds: ids,
              guestCount: guests,
              contactName: name.trim() || undefined,
              overrideReason: o,
              idempotencyKey,
            }),
          )
        : await run(() =>
            api.addWaitlist({
              kind: "WALK_IN",
              contactName: name.trim() || `Khách Walk-in ${guests} người`,
              partySize: guests,
              channel: "IN_PERSON",
              preferenceMode: "ANY",
              preferences: [],
              note: note.trim() || undefined,
              idempotencyKey,
            }),
          )
    if (ok) {
      renewIdempotencyKey()
      onClose()
    }
  }

  const pickChip = (on: boolean, off = false) =>
    cn(
      "border",
      on
        ? "border-primary bg-primary-tint font-semibold text-primary-ink"
        : off
          ? "cursor-not-allowed border-dashed border-border bg-background font-medium text-subtle"
          : "border-strong bg-background font-medium text-tx-1",
    )

  return (
    <div
      role="dialog"
      aria-label="Tạo đơn đặt bàn"
      className="fixed inset-0 z-[40] flex flex-col overflow-hidden bg-background"
    >
      <div className="shrink-0 border-b border-border bg-background px-4 pt-[var(--top-safe)] pb-3">
        <div className="-ml-2.5 flex h-11 items-center gap-1">
          <button
            type="button"
            onClick={() => (dirty ? setConfirmLeave(true) : onClose())}
            aria-label="Quay lại"
            className="grid size-11 place-items-center rounded-xl text-tx-1 active:bg-surface-2"
          >
            <ChevronLeft className="size-[22px]" />
          </button>
          <h1 className="m-0 text-xl font-semibold tracking-[-0.01em] text-tx-strong">Tạo đơn đặt bàn</h1>
        </div>
        <div className="mt-2">
          <Seg
            label="Loại đơn"
            value={mode}
            onChange={(k) => {
              setMode(k)
              setTried(false)
              if (!preset.length) reset()
            }}
            opts={[
              ["booking", "Đặt trước"],
              ["walkin", "Walk-in"],
            ]}
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pt-4 pb-6">
        <section className="flex flex-col gap-3">
          <h2 className="m-0 text-base font-semibold text-tx-strong">
            {isBooking ? "Số khách và thời gian" : "Khách vừa đến"}
          </h2>
          <div className="flex flex-col gap-3.5 rounded-2xl border border-border bg-surface-1 p-4">
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-2">
                <span id={`${uid}-party`} className="text-[14px] text-tx-2">
                  Số khách
                </span>
                <span className="text-xs text-subtle">Trên 10 khách, chọn Khác</span>
              </div>
              <div role="radiogroup" aria-labelledby={`${uid}-party`} className="grid grid-cols-4 gap-2">
                {GUEST_QUICK.map((n) => {
                  const on = !isOther && party === n
                  return (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={`${n} khách`}
                      onClick={() => {
                        setIsOther(false)
                        setParty(n)
                        reset()
                        touch()
                      }}
                      className={cn("h-12 min-w-0 rounded-xl px-1 text-base tabular-nums", pickChip(on))}
                    >
                      {n}
                    </button>
                  )
                })}
                <button
                  type="button"
                  role="radio"
                  aria-checked={isOther}
                  aria-label={other?.ok ? `Khác, ${other.value} khách` : "Khác, trên 10 khách"}
                  onClick={() => {
                    setIsOther(true)
                    reset()
                    touch()
                  }}
                  className={cn(
                    "col-span-2 h-12 min-w-0 rounded-xl px-1 text-base whitespace-nowrap",
                    pickChip(isOther),
                  )}
                >
                  {other?.ok ? `Khác: ${other.value}` : "Khác"}
                </button>
              </div>
              {isOther ? (
                <label className="mt-1 flex flex-col gap-1.5">
                  <span className="text-[13px] font-medium text-tx-2">Số khách, từ 11 trở lên</span>
                  <span className="relative block">
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      enterKeyHint="done"
                      autoComplete="off"
                      autoFocus
                      value={otherText}
                      onChange={(e) => {
                        setOtherText(e.target.value)
                        reset()
                        touch()
                      }}
                      placeholder="Ví dụ: 12"
                      aria-invalid={errOther}
                      className={cn(field, "scroll-mb-36 pr-[72px] tabular-nums", errOther && "border-st-noshow")}
                    />
                    <span
                      aria-hidden
                      className="pointer-events-none absolute top-0 right-3.5 flex h-12 items-center text-[15px] text-tx-2"
                    >
                      khách
                    </span>
                  </span>
                  {errOther ? (
                    <span role="alert" className="text-[13px] text-st-noshow-ink">
                      {other?.error}
                    </span>
                  ) : null}
                </label>
              ) : null}
            </div>

            {isBooking ? (
              <>
                <div className="flex flex-col gap-2 border-t border-border pt-3.5">
                  <span className="text-[14px] text-tx-2">Ngày</span>
                  <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5">
                    {days.map((d) => {
                      const on = dateIdx === d.offset
                      return (
                        <button
                          key={d.offset}
                          type="button"
                          aria-pressed={on}
                          onClick={() => {
                            setDateIdx(d.offset)
                            reset()
                            touch()
                          }}
                          className={cn(
                            "flex h-14 min-w-16 shrink-0 flex-col items-center justify-center gap-px rounded-[14px] border px-2.5",
                            on
                              ? "border-tx-strong bg-tx-strong text-background"
                              : "border-border bg-background text-tx-1",
                          )}
                        >
                          <span className="text-xs">{d.top}</span>
                          <span className="text-[15px] font-semibold">{d.day}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
                <div className="border-t border-border pt-3.5">
                  <BookingTimePicker
                    date={bd}
                    value={slot ?? ""}
                    now={m.now}
                    error={errTime ? timeErr : null}
                    quickTimes={m.model.catalog?.venue.settings?.quick_times}
                    onChange={(time) => {
                      setSlot(time)
                      reset()
                      touch()
                    }}
                  />
                </div>
              </>
            ) : null}

            <button
              type="button"
              onClick={() => (guests === null || (isBooking && timeErr) ? setTried(true) : setChecked(true))}
              className="h-12 rounded-xl border border-primary bg-primary-tint text-[15px] font-medium text-primary-ink active:brightness-95"
            >
              {isBooking ? "Kiểm tra bàn trống" : "Xem bàn trống lúc này"}
            </button>
          </div>
        </section>

        {checked ? (
          <section className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <h2 className="m-0 text-base font-semibold text-tx-strong">Chọn bàn</h2>
              <span className="text-[13px] text-[var(--text-muted)]">
                {isBooking ? slotText : "Lúc này"}, {guests ?? "?"} khách
              </span>
            </div>
            {isBooking ? (
              <>
                {presetIssues.length > 0 ? (
                  <div
                    role="status"
                    aria-label={`Bàn ${codesOf(preset, m.model)} không khả dụng`}
                    className="flex flex-col gap-1.5 rounded-[14px] border border-st-reserved/30 bg-st-reserved-tint px-4 py-3 text-tx-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[15px] font-semibold text-tx-strong">
                        Bàn {codesOf(preset, m.model)}
                      </span>
                      <span className="rounded-md bg-st-reserved/20 px-2 py-0.5 text-xs font-medium text-st-reserved-ink">
                        {presetBadge}
                      </span>
                    </div>
                    <span className="text-[13px] text-tx-2">
                      {presetIssues[0]} Vui lòng chọn bàn trống khác bên dưới hoặc lưu booking chưa xếp bàn.
                    </span>
                    {choice?.key === "preset" ? (
                      <button
                        type="button"
                        onClick={() => {
                          setChoice(null)
                          setSelectionMessage(null)
                          touch()
                        }}
                        className="self-start text-[13px] font-medium text-primary-ink underline active:opacity-70"
                      >
                        Bỏ chọn bàn này
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {options.length ? (
                  <div role="radiogroup" aria-label="Bàn trống" className="flex flex-wrap gap-2">
                    {options.map((o) => {
                      const on = choice?.key === o.key || (choice?.key === "preset" && o.ids.join() === choice.ids.join())
                      return (
                        <button
                          key={o.key}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          onClick={() => {
                            setChoice(on ? null : o)
                            setSelectionMessage(null)
                            touch()
                          }}
                          className={cn(
                            "flex min-h-12 flex-col items-start justify-center rounded-[14px] border px-3.5 py-1 text-tx-1",
                            on ? "border-primary bg-primary-tint" : "border-border bg-surface-1",
                          )}
                        >
                          <span
                            className={cn("text-[15px] font-semibold", on ? "text-primary-ink" : "text-tx-strong")}
                          >
                            {o.label}
                          </span>
                          {o.sub ? <span className="text-xs text-[var(--text-muted)]">{o.sub}</span> : null}
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <div className="rounded-[14px] bg-st-late-tint px-4 py-3.5 text-[14px] text-pretty text-tx-1">
                    Không còn bàn trống cho {guests} khách lúc {slotText}. Vẫn có thể lưu booking chưa có bàn.
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="m-0 text-[13px] text-pretty text-tx-2">
                  Chạm trực tiếp lên bàn hoặc ghế trống. Nếu chưa đủ chỗ, tiếp tục chọn thêm trong cùng khu và cùng loại.
                </p>
                <div className="relative h-[min(58dvh,500px)] min-h-[360px] overflow-hidden rounded-2xl border border-border bg-floor">
                  {m.model.catalog ? (
                    <FloorCanvas
                      className="absolute inset-0"
                      tables={m.model.tables}
                      zones={m.model.catalog.zones}
                      mode="live"
                      states={m.model.states}
                      groups={m.model.floor?.groups}
                      selectedIds={selectedWalkInIds}
                      pickable={walkInPickable}
                      now={m.now}
                      onTableClick={toggleWalkInTable}
                      onBlockedTableClick={explainBlockedWalkInTable}
                      onBackgroundClick={() => setSelectionMessage(null)}
                      ariaLabel="Sơ đồ bàn để chọn trực tiếp cho khách Walk-in"
                    />
                  ) : (
                    <div className="grid h-full place-items-center px-6 text-center text-sm text-subtle">
                      Đang tải sơ đồ bàn…
                    </div>
                  )}
                </div>
                <div
                  className={cn(
                    "flex flex-col gap-1 rounded-[14px] border px-4 py-3",
                    walkInReady ? "border-primary bg-primary-tint" : "border-border bg-surface-1",
                  )}
                  role="status"
                  aria-live="polite"
                >
                  <span className="text-[14px] font-semibold text-tx-strong">
                    {selectedWalkInIds.length ? `Đã chọn: ${codesOf(selectedWalkInIds, m.model)}` : "Chưa chọn bàn"}
                  </span>
                  <span className={cn("text-[13px]", walkInReady ? "text-primary-ink" : "text-tx-2")}>
                    Sức chứa: {walkInCapacity}/{guests ?? "?"} chỗ
                    {walkInReady
                      ? " · Đã đủ chỗ"
                      : selectedWalkInIds.length
                        ? ` · Cần thêm ${Math.max(0, (guests ?? 0) - walkInCapacity)} chỗ`
                        : ""}
                  </span>
                  {walkInIssues[0] || selectionMessage ? (
                    <span className="text-[13px] text-st-noshow-ink" role="alert">
                      {walkInIssues[0] ?? selectionMessage}
                    </span>
                  ) : walkInPickable.size === 0 ? (
                    <span className="text-[13px] text-st-late-ink">
                      Không có bàn hợp lệ lúc này. Không chọn bàn để thêm khách vào danh sách chờ.
                    </span>
                  ) : null}
                </div>
              </div>
            )}
            <span className="text-xs text-pretty text-subtle">
              {isBooking
                ? "Bàn chỉ được giữ khi máy chủ xác nhận lưu. Chọn bàn không có nghĩa là bàn đã bị khóa."
                : "Chọn bàn để mở ngay. Không chọn bàn thì khách vào danh sách chờ."}
            </span>
          </section>
        ) : null}

        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h2 className="m-0 text-base font-semibold text-tx-strong">Thông tin khách</h2>
            <span className="text-[13px] text-[var(--text-muted)]">
              {isBooking ? "Cần tên hoặc SĐT" : "Không bắt buộc"}
            </span>
          </div>
          <div
            className={cn(
              "flex flex-col gap-3 rounded-2xl border bg-surface-1 p-4",
              errGuest ? "border-st-noshow" : "border-border",
            )}
          >
            {isBooking ? (
              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium text-tx-2">Số điện thoại</span>
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value)
                    touch()
                  }}
                  placeholder="09xx xxx xxx"
                  className={field}
                />
              </label>
            ) : null}
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-tx-2">Tên khách</span>
              <input
                type="text"
                autoComplete="name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  touch()
                }}
                placeholder="Ví dụ: Chị Lan"
                className={field}
              />
            </label>
            {errGuest ? (
              <span role="alert" className="text-[13px] text-st-noshow-ink">
                {!phoneOk ? "SĐT chưa đúng định dạng (10 số, bắt đầu bằng 0)." : "Nhập ít nhất tên hoặc số điện thoại."}
              </span>
            ) : null}
            {isBooking ? (
              <div className="flex flex-col gap-2">
                <span className="text-[13px] font-medium text-tx-2">Nguồn đặt</span>
                <div className="flex flex-wrap gap-2">
                  {(Object.entries(SOURCE_LABEL) as [BookingSourceCode, string][]).map(([code, label]) => {
                    const on = source === code
                    return (
                      <button
                        key={code}
                        type="button"
                        aria-pressed={on}
                        onClick={() => {
                          setSource(code)
                          touch()
                        }}
                        className={cn(
                          "h-9 rounded-full border px-3.5 text-[13px] font-medium",
                          on
                            ? "border-tx-strong bg-tx-strong text-background"
                            : "border-strong bg-transparent text-tx-1",
                        )}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : null}
            {isBooking ? (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="bk-classification" className="text-[13px] font-medium text-tx-2">
                  Loại khách
                </label>
                <Select
                  value={classification}
                  onValueChange={(val) => {
                    setClassification(val as BookingClassification)
                    touch()
                  }}
                >
                  <SelectTrigger
                    id="bk-classification"
                    aria-label="Loại khách"
                    className="h-12 w-full rounded-xl bg-surface-1 text-tx-1"
                  >
                    <SelectValue placeholder="Chưa phân loại" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="UNCLASSIFIED">Chưa phân loại</SelectItem>
                    <SelectItem value="NEW">Khách mới (N)</SelectItem>
                    <SelectItem value="RETURNING">Khách quen (O)</SelectItem>
                  </SelectContent>
                </Select>
                <label className="flex min-h-12 items-center gap-3 text-sm">
                  <Checkbox
                    checked={isBirthday}
                    onCheckedChange={(checked) => {
                      setIsBirthday(checked === true)
                      touch()
                    }}
                  />
                  Sinh nhật
                </label>
              </div>
            ) : null}
            {isBooking || !choice ? (
              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium text-tx-2">Ghi chú</span>
                <textarea
                  rows={3}
                  value={note}
                  onChange={(e) => {
                    setNote(e.target.value)
                    touch()
                  }}
                  aria-invalid={noteBad}
                  placeholder="Sinh nhật, ghế trẻ em, khu yên tĩnh..."
                  className={cn(field, "h-auto resize-none py-3 leading-[1.45]", noteBad && "border-st-noshow")}
                />
                {noteBad ? <span className="text-[13px] text-st-noshow-ink">{NOTE_PHONE_ERROR}</span> : null}
              </label>
            ) : null}
          </div>
        </section>
      </div>

      <footer className="flex shrink-0 flex-col gap-2 border-t border-border bg-surface-1 px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
        <span className="truncate text-[13px] text-[var(--text-muted)]">
          {isBooking
            ? `${dateIdx === 0 ? "Hôm nay" : fmtBusinessDate(bd, "short")}, ${slotText || "chưa chọn giờ"}, ${guests ?? "?"} khách, ${tableLabel}`
            : `Walk-in, ${guests ?? "?"} khách, ${tableLabel}`}
        </span>
        {isBooking && selectionMessage ? (
          <span role="alert" className="text-[13px] text-st-noshow-ink">
            {selectionMessage}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => void submit()}
          disabled={pending || (!isBooking && selectedWalkInIds.length > 0 && !walkInReady)}
          aria-busy={pending}
          className="h-[52px] rounded-[14px] bg-primary text-base font-semibold text-primary-foreground active:brightness-90 disabled:opacity-70"
        >
          {pending
            ? "Đang gửi..."
            : isBooking
              ? "Đặt bàn"
              : choice
                ? walkInReady
                  ? `Mở bàn ${choice.label}`
                  : `Chọn thêm bàn · ${walkInCapacity}/${guests ?? "?"} chỗ`
                : "Thêm vào danh sách chờ"}
        </button>
      </footer>

      {confirmLeave ? (
        <>
          <div className="absolute inset-0 z-[2] bg-[var(--scrim)]" />
          <div
            role="alertdialog"
            aria-label="Bỏ đơn đang nhập"
            className="absolute inset-x-6 top-1/2 z-[3] flex -translate-y-1/2 flex-col gap-3.5 rounded-[20px] bg-surface-1 p-5 shadow-[var(--shadow-float)]"
          >
            <span className="text-[17px] font-semibold text-tx-strong">Bỏ đơn đang nhập?</span>
            <span className="text-[14px] text-[var(--text-muted)]">Thông tin vừa nhập sẽ không được lưu.</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmLeave(false)}
                className="h-12 flex-1 rounded-xl border border-strong text-[15px] text-tx-1"
              >
                Tiếp tục nhập
              </button>
              <button
                type="button"
                onClick={onClose}
                className="h-12 flex-1 rounded-xl bg-st-noshow text-[15px] font-medium text-white"
              >
                Bỏ đơn
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}

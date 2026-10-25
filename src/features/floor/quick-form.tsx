/**
 * v2 inline form (right column of Điều phối): "Tạo đặt bàn" / "Mở bàn Walk-in"
 * in one panel. Date/time/party/tables live in `ui.draft` so the map can show
 * availability for the draft and tables are picked by tapping the map.
 * Submit: booking -> createReservation; walk-in with tables -> seatWalkIn;
 * walk-in without tables -> WALK_IN waitlist.
 */
import { X } from "lucide-react"
import { useState } from "react"
import { GuardedButton, Stepper } from "@/components/common"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { Permission } from "@/domain/access"
import { SOURCE_LABEL, type BookingSourceCode } from "@/domain/enums"
import type { AvailabilityResult } from "@/domain/models"
import { useAction } from "@/hooks/use-action"
import { useNow } from "@/hooks/use-data"
import { NOTE_PHONE_ERROR, isPlausibleVnPhone, noteHasPhoneNumber } from "@/lib/text"
import {
  addDays,
  atBusinessTime,
  businessDateOf,
  businessSlots,
  fmtBusinessDate,
  fmtDayMonth,
  fmtTime,
  MS,
} from "@/lib/time"
import { cn } from "@/lib/utils"
import { api } from "@/services"
import { useUi } from "@/state/ui"
import type { FloorModel } from "./use-floor-model"

const PICKABLE = new Set(["available", "spare", "too_small"])

export function draftPickable(
  kind: "booking" | "walkin",
  id: number,
  model: FloorModel,
  availability: AvailabilityResult | undefined,
): boolean {
  if (kind === "walkin") return model.freeIds.has(id)
  const st = availability?.tables.find((t) => t.tableId === id)?.status
  return !!st && PICKABLE.has(st)
}

const label12 = "text-xs text-tx-2"
const inputCls =
  "h-11 w-full rounded-sm border border-strong bg-background px-3 text-sm outline-none placeholder:text-tx-3 focus:border-foreground aria-[invalid=true]:border-st-noshow"

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
}: {
  model: FloorModel
  availability: AvailabilityResult | undefined
}) {
  const ui = useUi()
  const draft = ui.draft!
  const now = useNow(30_000)
  const today = businessDateOf(now)
  const { run, pending } = useAction()
  const [phone, setPhone] = useState("")
  const [name, setName] = useState("")
  const [note, setNote] = useState("")
  const [source, setSource] = useState<BookingSourceCode>("HOTLINE")
  const [tried, setTried] = useState(false)

  const isB = draft.kind === "booking"
  const close = isB ? ui.closeBooking : ui.closeWalkIn
  const at = atBusinessTime(draft.date, draft.time)
  const isPast = isB && at.getTime() < now.getTime() - 5 * MS.MIN
  const venue = model.catalog?.venue

  const errors: { name?: string; phone?: string; note?: string; time?: string } = {}
  if (isB && !name.trim() && !phone.trim()) errors.name = "Cần ít nhất tên hoặc số điện thoại"
  if (isB && phone.trim() && !isPlausibleVnPhone(phone)) errors.phone = "Số điện thoại 10 số, bắt đầu bằng 0"
  if (isB && noteHasPhoneNumber(note)) errors.note = NOTE_PHONE_ERROR
  if (isPast) errors.time = "Giờ đã chọn đã qua, chọn giờ khác."
  const shown = tried ? errors : {}

  const dates = Array.from({ length: 7 }, (_, i) => addDays(today, i))
  const dateLabel = (bd: string, i: number) =>
    i === 0
      ? `Hôm nay · ${fmtDayMonth(bd)}`
      : i === 1
        ? `Ngày mai · ${fmtDayMonth(bd)}`
        : fmtBusinessDate(bd).replace(", ", " · ")
  const slots = businessSlots().filter((s) => atBusinessTime(draft.date, s).getTime() >= now.getTime() - 5 * MS.MIN)

  const blocked = draft.tableIds.filter((id) => !draftPickable(draft.kind, id, model, availability))
  const cap = draft.tableIds.reduce((s, id) => s + (model.byId.get(id)?.capacity ?? 0), 0)
  const short = draft.party - cap

  // Best-fit free tables (same order as the old walk-in sheet) so a walk-in stays two taps.
  const zoneOk = new Set(model.catalog?.zones.filter((z) => z.isBookable).map((z) => z.id))
  const suggestions = model.tables
    .filter(
      (t) => t.kind === "TABLE" && zoneOk.has(t.zoneId) && t.capacity >= draft.party && !draft.tableIds.includes(t.id),
    )
    .filter((t) =>
      isB
        ? availability?.tables.find((a) => a.tableId === t.id)?.status === "available"
        : model.states.get(t.id)?.state === "free",
    )
    .sort((a, b) => a.capacity - b.capacity || a.code.localeCompare(b.code))
    .slice(0, 5)

  const submitLabel = isB ? "Lưu đặt bàn" : draft.tableIds.length ? "Mở bàn ngay" : "Thêm vào danh sách chờ"
  const permission: Permission = isB ? "reservation.create" : draft.tableIds.length ? "visit.walkin" : "waitlist.create"

  const submit = async () => {
    setTried(true)
    if (Object.keys(errors).length || blocked.length) return
    if (isB) {
      const r = await run((o) =>
        api.createReservation({
          contactName: name.trim() || undefined,
          phone: phone.trim() || undefined,
          partySize: draft.party,
          expectedAt: at,
          sourceCode: source,
          note: note.trim() || undefined,
          tableIds: draft.tableIds,
          overrideReason: o,
        }),
      )
      if (r) close()
      return
    }
    if (draft.tableIds.length) {
      const ids = draft.tableIds
      const r = await run((o) =>
        api.seatWalkIn({
          tableIds: ids,
          guestCount: draft.party,
          contactName: name.trim() || undefined,
          overrideReason: o,
        }),
      )
      if (r) {
        close()
        ui.selectTable(ids[0])
      }
      return
    }
    const r = await run(() =>
      api.addWaitlist({
        kind: "WALK_IN",
        contactName: name.trim() || `Khách Walk-in ${draft.party} người`,
        partySize: draft.party,
        channel: "IN_PERSON",
        preferenceMode: "ANY",
        preferences: [],
      }),
    )
    if (r) close()
  }

  const tab = (on: boolean) =>
    cn("h-[38px] rounded-sm text-sm", on ? "bg-primary-tint font-medium text-primary-ink" : "text-tx-2 hover:text-tx-1")

  return (
    <div className="flex h-full min-h-0 flex-col" aria-label={isB ? "Tạo đặt bàn" : "Mở bàn Walk-in"} role="form">
      <div className="flex h-[60px] shrink-0 items-center gap-3 border-b pr-3 pl-5">
        <span className="mr-auto text-[15px] font-semibold">{isB ? "Tạo đặt bàn" : "Mở bàn Walk-in"}</span>
        <Button variant="ghost" size="icon" aria-label="Đóng form" onClick={close}>
          <X />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 scrollbar-thin flex-col gap-5 overflow-x-hidden overflow-y-auto px-5 pt-4 pb-5">
        <div
          role="tablist"
          aria-label="Loại khách"
          className="grid grid-cols-2 gap-0.5 rounded-sm border bg-surface-1 p-[3px]"
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
            onClick={() => ui.switchDraft("walkin")}
          >
            Walk-in
          </button>
        </div>

        <section className="flex flex-col gap-3">
          <span className="text-sm font-semibold text-primary-ink">Khách</span>
          {isB ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="qf-phone" className={cn(label12, "flex justify-between gap-2")}>
                Số điện thoại <span className="text-tx-3">hoặc tên</span>
              </label>
              <input
                id="qf-phone"
                className={cn(inputCls, "tnum")}
                inputMode="tel"
                autoComplete="off"
                placeholder="0xxx xxx xxx"
                value={phone}
                aria-invalid={!!shown.phone}
                onChange={(e) => setPhone(e.target.value)}
              />
              <FieldError>{shown.phone}</FieldError>
            </div>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="qf-name" className={label12}>
              {isB ? "Tên khách" : "Tên hoặc đặc điểm nhận dạng (tùy chọn)"}
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
            <FieldError>{shown.name}</FieldError>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <span className="text-sm font-semibold text-primary-ink">Thời gian &amp; số khách</span>
          {isB ? (
            <>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
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
                <div className="flex flex-col gap-1.5">
                  <span className={label12}>Giờ đến</span>
                  <Select value={draft.time} onValueChange={(time) => ui.setDraft({ time })}>
                    <SelectTrigger
                      className="tnum h-11 w-full border-strong aria-[invalid=true]:border-st-noshow"
                      aria-label="Giờ đến"
                      aria-invalid={!!shown.time}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {slots.map((s) => (
                        <SelectItem key={s} value={s} className="tnum">
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <FieldError>{shown.time}</FieldError>
              {venue ? (
                <span className="tnum text-xs text-pretty text-tx-2">
                  Cảnh báo đến muộn lúc {fmtTime(new Date(at.getTime() + venue.lateWarningMinutes * MS.MIN))} · không
                  đến lúc {fmtTime(new Date(at.getTime() + venue.noShowWarningMinutes * MS.MIN))}
                </span>
              ) : null}
            </>
          ) : null}
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
            <div className="flex flex-col gap-1.5">
              <span className={label12}>Số khách</span>
              <Stepper value={draft.party} onChange={(party) => ui.setDraft({ party })} label="số khách" max={60} />
            </div>
            {isB ? (
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
            ) : (
              <div className="flex flex-col gap-1.5">
                <span className={label12}>Vào lúc</span>
                <span className="tnum flex h-11 items-center text-sm">{fmtTime(now)} · bây giờ</span>
              </div>
            )}
          </div>
        </section>

        <section className="flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-semibold text-primary-ink">Bàn</span>
            <span className="text-xs text-tx-3">Chạm vị trí trống trên sơ đồ</span>
          </div>
          {draft.tableIds.length ? (
            <>
              <div className="flex flex-wrap gap-2">
                {draft.tableIds.map((id) => {
                  const bad = blocked.includes(id)
                  return (
                    <button
                      key={id}
                      type="button"
                      aria-label={`Bỏ ${model.label(id)}`}
                      onClick={() => ui.toggleDraftTable(id)}
                      className={cn(
                        "tnum flex h-9 items-center gap-1.5 rounded-sm border pr-2 pl-3 text-sm font-medium",
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
              {blocked.length ? (
                <FieldError>{`${blocked.map((id) => model.label(id)).join(", ")} không còn trống · bỏ chọn để tiếp tục`}</FieldError>
              ) : (
                <span className={cn("tnum text-xs", short > 0 ? "text-st-late-ink" : "text-tx-2")}>
                  {short > 0
                    ? `Sức chứa ${cap} chỗ · thiếu ${short} chỗ cho ${draft.party} khách · cần Chủ quán duyệt`
                    : `Sức chứa ${cap} chỗ · đủ cho ${draft.party} khách`}
                </span>
              )}
            </>
          ) : (
            <div className="flex min-h-11 items-center rounded-sm border border-dashed border-strong px-3 text-xs text-tx-2">
              {isB ? "Chưa chọn bàn · có thể xếp sau" : "Chưa chọn bàn · nếu hết chỗ, đưa vào danh sách chờ"}
            </div>
          )}
          {suggestions.length > 0 && cap < draft.party ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-tx-3">Gợi ý</span>
              {suggestions.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-label={`Gợi ý ${t.code}`}
                  onClick={() => ui.toggleDraftTable(t.id)}
                  className="tnum flex h-9 items-center gap-1 rounded-sm border border-strong px-2.5 text-sm hover:bg-surface-2"
                >
                  {t.code} <span className="text-xs text-tx-3">{t.capacity}</span>
                </button>
              ))}
            </div>
          ) : null}
        </section>

        {/* shortcut: WalkInInput has no note/phone yet, so those fields are booking-only. */}
        {isB ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="qf-note" className={label12}>
              Ghi chú
            </label>
            <textarea
              id="qf-note"
              rows={3}
              className={cn(inputCls, "h-auto resize-none py-2.5")}
              placeholder="Sinh nhật, cần ghế trẻ em…"
              value={note}
              aria-invalid={!!shown.note}
              onChange={(e) => setNote(e.target.value)}
            />
            <FieldError>{shown.note}</FieldError>
          </div>
        ) : null}
      </div>

      <div className="grid shrink-0 grid-cols-[1fr_2fr] gap-2 border-t px-5 pt-3 pb-4">
        <Button variant="outline" className="h-11 border-strong bg-transparent" onClick={close}>
          Hủy
        </Button>
        <GuardedButton permission={permission} className="h-11" disabled={pending} onClick={submit}>
          {submitLabel}
        </GuardedButton>
      </div>
    </div>
  )
}

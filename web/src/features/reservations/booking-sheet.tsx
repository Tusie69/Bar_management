/**
 * Booking flow (OpenTable/Eat App pattern, adapted):
 * 1 Ngày giờ + số khách -> 2 Khả dụng + vị trí -> 3 Thông tin khách -> 4 Xác nhận.
 * The server re-checks availability on confirm; a 409 sends the user back to
 * step 2 with fresh availability.
 * Guest count (1–10 + Khác) and arrival slots (19:00 → 01:00, 30') come from domain/booking-rules
 * through components/booking-pickers, shared with the inline form on Điều phối.
 */
import { zodResolver } from "@hookform/resolvers/zod"
import { ArrowLeft, ArrowRight, Check, Link2 } from "lucide-react"
import { useMemo, useState } from "react"
import { useForm, useWatch } from "react-hook-form"
import { z } from "zod"
import {
  BookingTimePicker,
  GuestPicker,
  guestCount,
  guestValueFrom,
  type GuestValue,
} from "@/components/booking-pickers"
import { MaskedPhone, PendingTag, SectionTitle } from "@/components/common"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import {
  bookingCalendarDate,
  bookingInstant,
  defaultBookingSlot,
  isAfterMidnight,
  slotLabel,
  validateBookingTime,
} from "@/domain/booking-rules"
import { SOURCE_LABEL, type BookingClassification, type BookingSourceCode } from "@/domain/enums"
import { useAction } from "@/hooks/use-action"
import { useAvailability, useNow } from "@/hooks/use-data"
import { NOTE_PHONE_ERROR, isPlausibleVnPhone, noteHasPhoneNumber } from "@/lib/text"
import { addDays, businessDateOf, fmtBusinessDate, fmtDayMonth, type BusinessDate } from "@/lib/time"
import { cn } from "@/lib/utils"
import { api } from "@/services"
import { useUi } from "@/state/ui"
import { FloorCanvas } from "../floor/floor-canvas"
import { DateField } from "../floor/floor-toolbar"
import { useFloorModel } from "../floor/use-floor-model"

const STEPS = ["Thời gian", "Vị trí", "Khách", "Xác nhận"] as const

const guestSchema = z
  .object({
    contactName: z.string().trim().max(120, "Tối đa 120 ký tự"),
    phone: z
      .string()
      .trim()
      .refine((v) => v === "" || isPlausibleVnPhone(v), "Số điện thoại 10 số, bắt đầu bằng 0"),
    sourceCode: z.string().min(1, "Chọn nguồn đặt"),
    classification: z.enum(["RETURNING", "NEW", "UNCLASSIFIED"]),
    note: z
      .string()
      .max(500, "Tối đa 500 ký tự")
      .refine((v) => !noteHasPhoneNumber(v), NOTE_PHONE_ERROR),
  })
  .refine((v) => v.contactName !== "" || v.phone !== "", {
    message: "Cần ít nhất tên hoặc số điện thoại",
    path: ["contactName"],
  })

type GuestForm = z.infer<typeof guestSchema>

export function BookingSheet() {
  const open = useUi((s) => s.bookingOpen)
  const close = useUi((s) => s.closeBooking)
  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-[560px]">{open ? <BookingBody /> : null}</SheetContent>
    </Sheet>
  )
}

function BookingBody() {
  const ui = useUi()
  const model = useFloorModel()
  const now = useNow(30_000)
  const today = businessDateOf(now)
  const { run, pending } = useAction()

  const prefill = ui.bookingPrefill
  const [step, setStep] = useState(0)
  const [date, setDate] = useState<BusinessDate>(prefill.date ?? today)
  const [time, setTime] = useState(() => {
    const wanted = prefill.time ?? ui.availTime
    const d = prefill.date ?? today
    if (!validateBookingTime(d, wanted, now)) return wanted
    return defaultBookingSlot(d, now) ?? "19:00"
  })
  const [guest, setGuest] = useState<GuestValue>(() =>
    guestValueFrom(prefill.party ?? (prefill.tableIds?.length ? Math.min(8, prefill.tableIds.length * 4) : 2)),
  )
  // While "Khác" is being typed, availability keeps the last valid count.
  const party = guestCount(guest) ?? guest.party
  const [tables, setTables] = useState<number[]>(prefill.tableIds ?? [])
  const [later, setLater] = useState(false)

  const form = useForm<GuestForm>({
    resolver: zodResolver(guestSchema),
    defaultValues: { contactName: "", phone: "", sourceCode: "HOTLINE", classification: "UNCLASSIFIED", note: "" },
    mode: "onTouched",
  })

  // Re-derived every render: changing the date re-checks the slot without silently replacing it.
  const timeError = validateBookingTime(date, time, now)
  const at = useMemo(() => bookingInstant(date, time), [date, time])
  const nextDayNote = isAfterMidnight(time) ? ` (sáng ${fmtDayMonth(bookingCalendarDate(date, time))})` : ""
  const availability = useAvailability(step >= 1 ? at : null, party)
  const availMap = useMemo(
    () => new Map((availability.data?.tables ?? []).map((t) => [t.tableId, t])),
    [availability.data],
  )
  const capacity = tables.reduce((s, id) => s + (model.byId.get(id)?.capacity ?? 0), 0)
  const blockedSelected = tables.filter((id) => {
    const s = availMap.get(id)?.status
    return s && s !== "available" && s !== "spare" && s !== "too_small"
  })

  const suggestions = useMemo(
    () =>
      (availability.data?.tables ?? [])
        .filter((t) => t.status === "available")
        .map((t) => model.byId.get(t.tableId)!)
        .filter((t) => t && t.kind === "TABLE" && t.capacity >= party)
        .sort((a, b) => a.capacity - b.capacity || a.code.localeCompare(b.code))
        .slice(0, 10),
    [availability.data, model.byId, party],
  )

  const toggle = (id: number) => {
    const s = availMap.get(id)?.status
    if (s && s !== "available" && s !== "spare" && s !== "too_small") return
    setLater(false)
    setTables((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]))
  }

  const canNext = [
    !timeError && guestCount(guest) !== null,
    later || (tables.length > 0 && blockedSelected.length === 0),
    true,
    true,
  ]

  const next = async () => {
    if (step === 2) {
      const ok = await form.trigger()
      if (!ok) return
    }
    setStep((s) => Math.min(3, s + 1))
  }

  const submit = async () => {
    const v = form.getValues()
    const r = await run((o) =>
      api.createReservation({
        contactName: v.contactName || undefined,
        phone: v.phone || undefined,
        partySize: party,
        expectedAt: at,
        sourceCode: v.sourceCode as BookingSourceCode,
        classification: v.classification as BookingClassification,
        note: v.note || undefined,
        tableIds: later ? [] : tables,
        overrideReason: o,
      }),
    )
    if (r) ui.closeBooking()
    else setStep((s) => (s === 3 ? 1 : s))
  }

  const v = useWatch({ control: form.control }) as GuestForm

  return (
    <>
      <SheetHeader className="border-b px-5 pt-5 pb-4">
        <SheetTitle className="text-xl">Đặt bàn mới</SheetTitle>
        <SheetDescription>
          Đặt trước cần ít nhất tên hoặc số điện thoại. Máy chủ sẽ kiểm tra lại bàn khi xác nhận.
        </SheetDescription>
        <ol className="mt-3 grid grid-cols-4 gap-1.5" aria-label="Các bước">
          {STEPS.map((s, i) => (
            <li key={s}>
              <button
                type="button"
                disabled={i > step}
                onClick={() => setStep(i)}
                aria-current={i === step ? "step" : undefined}
                className={cn(
                  "flex w-full flex-col items-start gap-1 rounded-md pt-1.5 text-left text-xs disabled:cursor-default",
                  i <= step ? "text-foreground" : "text-subtle",
                )}
              >
                <span className={cn("h-1 w-full rounded-full", i <= step ? "bg-foreground" : "bg-surface-3")} />
                <span>
                  <span className="tnum">{i + 1}</span> {s}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </SheetHeader>

      <div className="min-h-0 flex-1 scrollbar-thin overflow-y-auto px-5 py-5">
        {step === 0 ? (
          <div className="grid gap-6">
            <section className="grid gap-2">
              <SectionTitle>Ngày</SectionTitle>
              <div className="flex flex-wrap gap-2">
                {[0, 1, 2].map((d) => {
                  const bd = addDays(today, d)
                  return (
                    <Button key={d} variant={date === bd ? "default" : "outline"} onClick={() => setDate(bd)}>
                      {d === 0 ? "Tối nay" : d === 1 ? "Ngày mai" : fmtBusinessDate(bd, "short")}
                    </Button>
                  )
                })}
                <DateField
                  value={date}
                  minDate={today}
                  onChange={setDate}
                  label={[0, 1, 2].some((d) => addDays(today, d) === date) ? "Ngày khác" : undefined}
                />
              </div>
            </section>
            <section className="grid gap-2">
              <SectionTitle>Số khách</SectionTitle>
              <GuestPicker value={guest} onChange={setGuest} />
            </section>
            <section className="grid gap-2">
              <SectionTitle>Giờ đến</SectionTitle>
              <BookingTimePicker
                date={date}
                value={time}
                now={now}
                onChange={setTime}
                error={timeError}
                gridClassName="sm:grid-cols-5"
              />
            </section>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="grid gap-4">
            <p className="text-sm text-muted-foreground">
              Khả dụng lúc{" "}
              <b className="text-foreground">
                {slotLabel(time)}
                {nextDayNote}
              </b>
              , {fmtBusinessDate(date)} cho <b className="text-foreground">{party} khách</b>. Chính sách giữ bàn:{" "}
              {availability.data?.policy ?? "..."} <PendingTag />
            </p>
            <div className="h-[340px] overflow-hidden rounded-xl border">
              {model.catalog ? (
                <FloorCanvas
                  tables={model.tables}
                  zones={model.catalog.zones}
                  mode="availability"
                  availability={availMap}
                  selectedIds={tables}
                  now={now}
                  onTableClick={toggle}
                  ariaLabel="Sơ đồ khả dụng để chọn vị trí"
                />
              ) : null}
            </div>
            <section className="grid gap-2">
              <SectionTitle>Gợi ý vừa {party} khách</SectionTitle>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((t) => (
                  <Button
                    key={t.id}
                    size="sm"
                    variant={tables.includes(t.id) ? "default" : "outline"}
                    className="tnum"
                    onClick={() => toggle(t.id)}
                  >
                    {t.code} <span className="text-[11px] opacity-70">{t.capacity}</span>
                  </Button>
                ))}
                {(model.catalog?.combinations ?? []).map((c) => {
                  const a = availability.data?.combinations.find((x) => x.combinationId === c.id)
                  if (!a?.available) return null
                  return (
                    <Button
                      key={c.id}
                      size="sm"
                      variant="outline"
                      className="tnum"
                      onClick={() => {
                        setLater(false)
                        setTables(c.memberIds)
                      }}
                    >
                      <Link2 /> {c.code} <span className="text-[11px] opacity-70">{c.capacity}</span>
                    </Button>
                  )
                })}
                {suggestions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Không có bàn đơn đủ chỗ. Ghép bàn, hoặc nhận trước xếp sau.
                  </p>
                ) : null}
              </div>
            </section>
            <div className="grid gap-2 rounded-xl border bg-surface-1 p-3">
              <p className="text-sm">
                {later ? (
                  "Nhận trước, xếp bàn sau (lễ tân phân bàn đầu ca)."
                ) : tables.length ? (
                  <>
                    <span className="font-semibold">{tables.map((id) => model.label(id)).join(" + ")}</span> ·{" "}
                    {capacity} chỗ
                    {capacity < party ? <span className="text-st-late"> · thiếu chỗ, cần Chủ quán duyệt</span> : null}
                  </>
                ) : (
                  "Chưa chọn vị trí."
                )}
              </p>
              {blockedSelected.length ? (
                <p className="text-sm text-destructive">
                  {blockedSelected.map((id) => model.label(id)).join(", ")} không còn khả dụng, bỏ chọn để tiếp tục.
                </p>
              ) : null}
              <Button
                variant={later ? "default" : "outline"}
                size="sm"
                className="justify-self-start"
                onClick={() => {
                  setLater((l) => !l)
                  setTables([])
                }}
              >
                Nhận trước, xếp bàn sau
              </Button>
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              void next()
            }}
          >
            <Field id="bk-name" label="Tên khách" error={form.formState.errors.contactName?.message}>
              <Input
                id="bk-name"
                className="h-11"
                autoComplete="off"
                {...form.register("contactName")}
                placeholder="Ví dụ: Nguyễn Minh Anh"
              />
            </Field>
            <Field
              id="bk-phone"
              label="Số điện thoại"
              error={form.formState.errors.phone?.message}
              hint="Lưu mã hóa. Sau khi lưu, lễ tân chỉ thấy 3 số cuối."
            >
              <Input
                id="bk-phone"
                className="h-11"
                inputMode="tel"
                autoComplete="off"
                {...form.register("phone")}
                placeholder="09xx xxx xxx"
              />
            </Field>
            <Field id="bk-source" label="Nguồn đặt" error={form.formState.errors.sourceCode?.message}>
              <Select
                value={v.sourceCode}
                onValueChange={(val) => form.setValue("sourceCode", val, { shouldValidate: true })}
              >
                <SelectTrigger id="bk-source" className="h-11 w-full">
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
            </Field>
            <Field id="bk-classification" label="Loại khách">
              <Select
                value={v.classification}
                onValueChange={(val) => form.setValue("classification", val as BookingClassification)}
              >
                <SelectTrigger id="bk-classification" className="h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="UNCLASSIFIED">Chưa phân loại</SelectItem>
                  <SelectItem value="NEW">Khách mới (N)</SelectItem>
                  <SelectItem value="RETURNING">Khách quen (O)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field
              id="bk-note"
              label="Ghi chú"
              error={form.formState.errors.note?.message}
              hint="Không ghi số điện thoại vào ghi chú."
            >
              <Textarea
                id="bk-note"
                rows={3}
                {...form.register("note")}
                placeholder="Ví dụ: sinh nhật, cần ghế em bé"
              />
            </Field>
          </form>
        ) : null}

        {step === 3 ? (
          <div className="grid gap-4">
            <dl className="grid gap-3 rounded-xl border bg-surface-1 p-4 text-sm">
              <Summary
                k="Thời gian"
                v={
                  <span className="tnum">
                    {slotLabel(time)}
                    {nextDayNote} · ngày kinh doanh {fmtBusinessDate(date)}
                  </span>
                }
              />
              <Summary k="Số khách" v={`${party} khách`} />
              <Summary
                k="Vị trí"
                v={
                  later || !tables.length ? (
                    "Nhận trước, xếp bàn sau"
                  ) : (
                    <span className="tnum">{tables.map((id) => model.label(id)).join(" + ")}</span>
                  )
                }
              />
              <Summary k="Khách" v={v.contactName || "(không tên)"} />
              <Summary
                k="SĐT"
                v={v.phone ? <MaskedPhone last3={v.phone.replace(/\D/g, "").slice(-3)} /> : "Không có"}
              />
              <Summary k="Nguồn" v={SOURCE_LABEL[v.sourceCode as BookingSourceCode]} />
              <Summary
                k="Loại khách"
                v={
                  v.classification === "RETURNING"
                    ? "Khách quen (O)"
                    : v.classification === "NEW"
                      ? "Khách mới (N)"
                      : "Chưa phân loại"
                }
              />
              {v.note ? <Summary k="Ghi chú" v={v.note} /> : null}
            </dl>
            <p className="text-xs text-muted-foreground">
              Bản mô phỏng: xác nhận chỉ lưu trên máy này. Khi nối API thật, máy chủ kiểm tra lại khả dụng trong một
              transaction.
            </p>
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-2 border-t px-5 py-4">
        {step > 0 ? (
          <Button variant="ghost" onClick={() => setStep((s) => s - 1)}>
            <ArrowLeft /> Quay lại
          </Button>
        ) : null}
        <div className="ml-auto" />
        {step < 3 ? (
          <Button size="lg" disabled={!canNext[step]} onClick={next}>
            Tiếp <ArrowRight />
          </Button>
        ) : (
          <Button size="lg" disabled={pending} onClick={submit}>
            <Check /> Xác nhận đặt bàn
          </Button>
        )}
      </div>
    </>
  )
}

function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string
  label: string
  error?: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-subtle">{hint}</p>
      ) : null}
    </div>
  )
}

function Summary({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-2">
      <dt className="text-muted-foreground">{k}</dt>
      <dd>{v}</dd>
    </div>
  )
}

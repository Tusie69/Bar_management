import { ArrowRightLeft, ListPlus, LogIn, MapPinned, Pencil, XCircle } from "lucide-react"
import { useMemo, useState } from "react"
import { useNavigate } from "react-router"
import {
  BookingTimePicker,
  HonorificPicker,
  IconPicker,
  SourcePicker,
  formatBookingIcons,
  formatBookingSource,
  formatHonorificName,
  honorificSupported,
  iconKeysSupported,
  socialPlatformSupported,
  validateSocialPlatform,
  type Honorific,
  type SocialPlatform,
} from "@/components/booking-pickers"
import { GuardedButton, SectionTitle, Stepper, TableCodes } from "@/components/common"
import { ConfirmAction } from "@/components/dialogs"
import { RevealPhone } from "@/components/reveal-phone"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  CLOSE_REASON_LABEL,
  PREFERENCE_MODE_LABEL,
  RESERVATION_STATUS_LABEL,
  type BookingClassification,
  type BookingSourceCode,
  type ReservationCloseReason,
  type WaitlistPreferenceMode,
} from "@/domain/enums"
import type { ReservationView } from "@/domain/models"
import { isBookingSlot, validateBookingCheckInDate, validateBookingTime } from "@/domain/booking-rules"
import { contactNameUpdate, initialContactName } from "@/domain/booking-identity"
import type { ZoneCode } from "@/domain/venue-layout"
import { useAction } from "@/hooks/use-action"
import { useCatalog, useNow, useOperations, useReservations, useVenueSettings, useWaitlist } from "@/hooks/use-data"
import { useIdempotencyKey } from "@/hooks/use-idempotency-key"
import { toast } from "sonner"
import { NOTE_PHONE_ERROR, noteHasPhoneNumber } from "@/lib/text"
import { atBusinessTime, businessDateOf, fmtBusinessDate, fmtTime, venueParts } from "@/lib/time"
import { api } from "@/services"
import { useUi } from "@/state/ui"
import { GuestCountDialog } from "../floor/floor-dialogs"
import { CallCustomerControl } from "../bookings/call-customer"
import { ReservationStatusChip } from "./reservation-status"
import { useFloorModel } from "../floor/use-floor-model"
import { bookingOrderPolicy, useHeldOrderActions } from "../mobile/actions"

const CANCEL_REASONS = (Object.keys(CLOSE_REASON_LABEL) as ReservationCloseReason[])
  .filter((r) => r !== "NO_SHOW_CONFIRMED")
  .map((value) => ({ value, label: CLOSE_REASON_LABEL[value] }))

export function ReservationDetailSheet() {
  const detail = useUi((s) => s.reservationDetail)
  const openReservation = useUi((s) => s.openReservation)
  const list = useReservations(detail?.bd ?? "", "")
  const r = list.data?.find((x) => x.id === detail?.id)
  return (
    <Sheet open={!!detail} onOpenChange={(o) => !o && openReservation(null)}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-[480px]">
        {r ? (
          <Detail r={r} />
        ) : (
          <SheetHeader className="p-5">
            <SheetTitle>Đang tải booking…</SheetTitle>
            <SheetDescription>Vui lòng chờ</SheetDescription>
          </SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  )
}

function Detail({ r }: { r: ReservationView }) {
  const catalog = useCatalog()
  const ui = useUi()
  const navigate = useNavigate()
  const now = useNow(15_000)
  const { run, pending } = useAction()
  const ops = useOperations(300)
  const waitlist = useWaitlist(r.businessDate)
  const held = useHeldOrderActions(useFloorModel(r.businessDate))
  const holdPolicy = bookingOrderPolicy(r, waitlist.isPlaceholderData ? undefined : waitlist)
  const heldEntry = holdPolicy.entry
  const [checkInOpen, setCheckInOpen] = useState(false)
  const [heldArrival, setHeldArrival] = useState<(() => Promise<unknown>) | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [waitOpen, setWaitOpen] = useState(false)
  const codes = (ids: number[]) =>
    ids.map((id) => {
      const t = catalog.data?.tables.find((x) => x.id === id)
      return t ? (t.kind === "BAR_SEAT" ? `Bar ${t.seqNo}` : t.code) : `#${id}`
    })
  const checkInError = validateBookingCheckInDate(r.businessDate, now)
  const booked = r.status === "BOOKED"
  const history = (ops.data ?? []).filter((o) => o.entityType === "reservation" && o.entityId === r.id)

  const pickOnFloor = (intent: "assign" | "checkin", count?: number) => {
    if (!(intent === "assign" ? held.bookingPolicy(r).canReassign : held.bookingPolicy(r).canArrival)) return
    if (heldEntry) {
      if (intent !== "assign") return
      const pick = held.picker(heldEntry, r)
      if (pick) {
        ui.openReservation(null)
        navigate("/floor")
        ui.startPick({ ...pick, intent: "assign" })
      }
      return
    }
    ui.openReservation(null)
    navigate("/floor")
    if (intent === "assign") {
      ui.setAvailability({
        date: r.businessDate,
        time: fmtTime(r.expectedAt),
        party: r.partySize,
      })
      ui.setFloorMode(r.businessDate === businessDateOf(now) ? "live" : "availability")
    } else {
      ui.setFloorMode("live")
    }
    ui.startPick({
      intent,
      targetDate: r.businessDate,
      targetTime: fmtTime(r.expectedAt),
      targetExpectedAt: r.expectedAt,
      targetParty: r.partySize,
      preselected: r.tableIds,
      title:
        intent === "assign"
          ? `${r.tableIds.length ? "Đổi bàn" : "Phân bàn"} cho ${formatHonorificName(r.displayName, r.honorific)} · ${r.partySize} khách`
          : `Check-in ${formatHonorificName(r.displayName, r.honorific)} vào bàn`,
      hint:
        intent === "assign"
          ? `Booking ${fmtTime(r.expectedAt)}${r.businessDate !== businessDateOf(now) ? ` ngày ${fmtBusinessDate(r.businessDate, "short")}` : ""}. Chạm bàn khả dụng.`
          : `Booking ${fmtTime(r.expectedAt)}. Chạm một hoặc nhiều bàn trống.`,
      multi: true,
      confirmLabel: intent === "assign" ? (r.tableIds.length ? "Đổi bàn" : "Phân bàn") : "Check-in",
      onConfirm: async (ids) => {
        const current = held.bookingPolicy(r)
        if (current.kind !== "direct" || !(intent === "assign" ? current.canReassign : current.canArrival)) {
          toast.error("Đơn chờ đã thay đổi. Vui lòng mở lại.")
          return false
        }
        if (intent === "assign") {
          const kinds = new Set(ids.map((id) => catalog.data?.tables.find((t) => t.id === id)?.kind).filter(Boolean))
          if (kinds.size > 1) {
            toast.error("Không thể ghép bàn thường với ghế Bar.")
            return false
          }
          return !!(await run(async (o) => {
            const current = await held.verifyBooking(r)
            if (!current.canReassign || current.kind !== "direct")
              throw new Error("Đơn chờ đã thay đổi. Vui lòng mở lại.")
            return api.assignTables(r.id, r.version, ids, o)
          }))
        }
        return !!(await run(async (o) => {
          const current = await held.verifyBooking(r)
          if (!current.canArrival || current.kind !== "direct") throw new Error("Đơn chờ đã thay đổi. Vui lòng mở lại.")
          return api.checkIn({
            reservationId: r.id,
            version: r.version,
            guestCount: count ?? r.partySize,
            tableIds: ids,
            overrideReason: o,
          })
        }))
      },
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SheetHeader className="border-b px-5 pt-5 pb-4">
        <div className="flex items-center gap-2">
          {<ReservationStatusChip r={r} />}
          <Badge variant="outline" className="tnum">
            #{r.id}
          </Badge>
        </div>
        <SheetTitle className="text-xl">{formatHonorificName(r.displayName, r.honorific)}</SheetTitle>
        <SheetDescription asChild>
          <div>
            <RevealPhone
              key={r.customerId ?? 0}
              customerId={r.customerId}
              last3={r.phoneLast3}
              context={{ reservationId: r.id }}
            />
          </div>
        </SheetDescription>
      </SheetHeader>
      <div className="min-h-0 flex-1 scrollbar-thin overflow-y-auto px-5 py-5">
        {holdPolicy.reason ? (
          <p role="alert" className="mb-3 text-sm text-destructive">
            {holdPolicy.reason}
          </p>
        ) : null}
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <Item k="Giờ đến" v={<span className="text-base font-semibold">{fmtTime(r.expectedAt)}</span>} />
          <Item k="Ngày kinh doanh" v={fmtBusinessDate(r.businessDate)} />
          <Item k="Số khách" v={`${r.partySize} khách`} />
          <Item k="Nguồn" v={formatBookingSource(r.sourceCode, r.socialPlatform)} />
          <Item
            k="Loại khách"
            v={
              r.classification === "RETURNING"
                ? "Khách quen (O)"
                : r.classification === "NEW"
                  ? "Khách mới (N)"
                  : "Chưa phân loại"
            }
          />
          <Item k="Đặc điểm" v={formatBookingIcons(r.isBirthday, r.iconKeys)} />
          <Item
            k="Bàn"
            v={
              r.tableIds.length ? (
                <TableCodes codes={codes(r.tableIds)} symbolNo={r.symbolNo} />
              ) : (
                <span className="text-muted-foreground">
                  {r.subState === "CHO_BAN" ? "Đang chờ bàn (danh sách chờ)" : "Chưa phân bàn"}
                </span>
              )
            }
          />
          <Item
            k="Tạo bởi"
            v={
              r.createdByName && r.createdAt ? (
                `${r.createdByName} · ${fmtTime(r.createdAt)}`
              ) : r.createdAt ? (
                fmtTime(r.createdAt)
              ) : r.createdByName ? (
                r.createdByName
              ) : (
                <span className="text-muted-foreground">Chưa có dữ liệu</span>
              )
            }
          />
          {r.status === "CANCELLED" || r.status === "NO_SHOW" ? (
            <Item
              k="Lý do đóng"
              v={`${r.closeReasonCode ? CLOSE_REASON_LABEL[r.closeReasonCode] : ""}${r.closeReasonNote ? ` · ${r.closeReasonNote}` : ""}`}
            />
          ) : null}
          {r.checkedInAt ? <Item k="Check-in lúc" v={fmtTime(r.checkedInAt)} /> : null}
        </dl>
        {r.note ? (
          <p className="mt-4 rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted-foreground">{r.note}</p>
        ) : null}
        {r.warning ? (
          <p className="mt-4 rounded-lg border border-st-late/40 bg-st-late-tint px-3 py-2 text-sm">
            Trễ {r.minutesLate} phút. Hệ thống chỉ cảnh báo, không tự hủy booking hay nhả bàn.
          </p>
        ) : null}

        {booked ? (
          <div className="mt-5 grid grid-cols-2 gap-2">
            <CallCustomerControl
              bookingId={r.id}
              bookingVersion={r.version}
              canCall={r.canCall === true}
              className="col-span-2"
            />
            {r.tableIds.length ? (
              <GuardedButton
                permission="visit.checkin"
                size="lg"
                className="col-span-2"
                disabled={Boolean(checkInError) || pending || !holdPolicy.canArrival}
                disabledReason={
                  holdPolicy.reason ?? (heldEntry && !holdPolicy.supported ? "Chưa hỗ trợ" : checkInError)
                }
                onClick={() => {
                  setHeldArrival(heldEntry ? () => () => held.arrive(heldEntry, r, r.partySize) : null)
                  setCheckInOpen(true)
                }}
              >
                <LogIn /> Check-in {codes(r.tableIds).join(" + ")}
              </GuardedButton>
            ) : (
              <GuardedButton
                permission="visit.checkin"
                size="lg"
                className="col-span-2"
                disabled={Boolean(checkInError) || pending || !holdPolicy.canArrival}
                disabledReason={
                  holdPolicy.reason ?? (heldEntry && !holdPolicy.supported ? "Chưa hỗ trợ" : checkInError)
                }
                onClick={() => {
                  setHeldArrival(heldEntry ? () => () => held.arrive(heldEntry, r, r.partySize) : null)
                  setCheckInOpen(true)
                }}
              >
                <LogIn /> Khách đã tới: chọn bàn và check-in
              </GuardedButton>
            )}
            <GuardedButton
              permission="table.assign"
              variant="outline"
              disabled={pending || !holdPolicy.canReassign}
              disabledReason={holdPolicy.reason ?? (heldEntry && !holdPolicy.supported ? "Chưa hỗ trợ" : undefined)}
              onClick={() => pickOnFloor("assign")}
            >
              {r.tableIds.length ? <ArrowRightLeft /> : <MapPinned />} {r.tableIds.length ? "Đổi bàn" : "Phân bàn"}
            </GuardedButton>
            <GuardedButton
              permission="reservation.update"
              variant="outline"
              disabled={pending || !!holdPolicy.reason}
              disabledReason={holdPolicy.reason}
              onClick={() => setEditOpen(true)}
            >
              <Pencil /> Sửa
            </GuardedButton>
            {!r.tableIds.length && !r.waitlistEntryId && !heldEntry ? (
              <GuardedButton
                permission="waitlist.create"
                variant="outline"
                className="col-span-2"
                disabled={pending || !!holdPolicy.reason}
                disabledReason={holdPolicy.reason}
                onClick={() => setWaitOpen(true)}
              >
                <ListPlus /> Đưa vào danh sách chờ (đặt trước)
              </GuardedButton>
            ) : null}
            <GuardedButton
              permission="reservation.cancel"
              variant="outline"
              className="col-span-2 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={pending || !holdPolicy.canBookingStatus}
              disabledReason={holdPolicy.reason ?? (!holdPolicy.canBookingStatus ? "Chưa hỗ trợ" : undefined)}
              onClick={() => setCancelOpen(true)}
            >
              <XCircle /> Hủy booking
            </GuardedButton>
          </div>
        ) : null}

        <section className="mt-6 grid gap-2">
          <SectionTitle>Nhật ký booking</SectionTitle>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có thao tác trong phiên này.</p>
          ) : (
            <ol className="grid gap-1.5 text-sm">
              {history.map((h) => (
                <li key={h.id} className="grid grid-cols-[3.25rem_1fr] gap-2">
                  <span className="tnum text-xs text-subtle">{fmtTime(h.occurredAt)}</span>
                  <span>
                    <span className="font-medium">{h.actionLabel}</span> ·{" "}
                    <span className="text-muted-foreground">
                      {h.actorName}
                      {h.deviceLabel ? ` (${h.deviceLabel})` : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}
          <p className="text-xs text-subtle">
            Trạng thái: {RESERVATION_STATUS_LABEL[r.status]}. Mọi thay đổi được ghi vào operation_log.
          </p>
        </section>
      </div>

      <GuestCountDialog
        open={checkInOpen}
        onOpenChange={setCheckInOpen}
        title={`Check-in ${formatHonorificName(r.displayName, r.honorific)}`}
        description={
          r.tableIds.length ? <>Bàn {codes(r.tableIds).join(" + ")}</> : "Bước tiếp theo: chọn bàn trống trên sơ đồ."
        }
        initial={r.partySize}
        readOnly
        confirmLabel={r.tableIds.length ? "Check-in" : "Chọn bàn"}
        onConfirm={async () => {
          if (!held.bookingPolicy(r).canArrival) {
            toast.error("Đơn chờ đã thay đổi. Vui lòng mở lại.")
            return
          }
          if (heldArrival) {
            const result = await heldArrival()
            if (result) setCheckInOpen(false)
            return
          }
          if (held.bookingPolicy(r).kind !== "direct") return
          if (!r.tableIds.length) {
            setCheckInOpen(false)
            pickOnFloor("checkin", r.partySize)
            return
          }
          const res = await run(async () => {
            const current = await held.verifyBooking(r)
            if (!current.canArrival || current.kind !== "direct")
              throw new Error("Đơn chờ đã thay đổi. Vui lòng mở lại.")
            return api.checkIn({ reservationId: r.id, version: r.version, guestCount: r.partySize })
          })
          if (res) setCheckInOpen(false)
        }}
      />
      <ConfirmAction
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Hủy booking?"
        description={
          <>
            Booking {fmtTime(r.expectedAt)} của <b className="text-foreground">{formatHonorificName(r.displayName, r.honorific)}</b>. Bàn đang giữ (nếu
            có) sẽ được nhả.
          </>
        }
        confirmLabel="Hủy booking"
        reasons={CANCEL_REASONS}
        requireNoteFor="OTHER"
        onConfirm={async (reason, note) => {
          if (!held.bookingPolicy(r).canBookingStatus || !held.can("reservation.cancel")) return
          await run(async () => {
            if (!(await held.verifyBooking(r)).canBookingStatus)
              throw new Error("Đơn chờ đã thay đổi. Vui lòng mở lại.")
            return api.cancelReservation(r.id, r.version, reason as ReservationCloseReason, note)
          })
        }}
      />
      <EditReservationDialog open={editOpen} onOpenChange={setEditOpen} r={r} />
      <AdvanceWaitlistDialog open={waitOpen} onOpenChange={setWaitOpen} r={r} />
    </div>
  )
}

function Item({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-subtle">{k}</dt>
      <dd>{v}</dd>
    </div>
  )
}

export function EditReservationDialog({
  open,
  onOpenChange,
  r,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  r: ReservationView
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-h-[min(90dvh,46rem)] sm:max-w-lg">
        {open ? <EditReservationBody r={r} close={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function EditReservationBody({ r, close }: { r: ReservationView; close: () => void }) {
  const now = useNow(30_000)
  const quickTimes = useVenueSettings().data?.quickTimes ?? []
  const { run, pending } = useAction()
  const [time, setTime] = useState(() => {
    const p = venueParts(r.expectedAt)
    return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`
  })
  const [party, setParty] = useState(r.partySize)
  const [name, setName] = useState(() => initialContactName(r.hasGuestName, r.displayName))
  const [note, setNote] = useState(r.note ?? "")
  const [source, setSource] = useState<BookingSourceCode>(r.sourceCode)
  const [platform, setPlatform] = useState<SocialPlatform | "">(() => (r.socialPlatform as SocialPlatform) ?? "")
  const [platformError, setPlatformError] = useState<string | null>(null)
  const [classification, setClassification] = useState<BookingClassification>(r.classification)
  const [isBirthday, setIsBirthday] = useState(r.isBirthday)
  const [iconKeys, setIconKeys] = useState<string[]>(() => (r.iconKeys ? [...r.iconKeys] : []))
  const [honorific, setHonorific] = useState<Honorific | null>(() => r.honorific ?? null)
  const invalid = noteHasPhoneNumber(note)
  const originalSchedule = time === fmtTime(r.expectedAt)
  const timeError = originalSchedule ? null : validateBookingTime(r.businessDate, time, now, undefined, quickTimes)
  const legacyTime = originalSchedule && !isBookingSlot(time) ? time : null
  return (
    <>
      <DialogHeader className="shrink-0 p-6 pr-14 pb-2 text-left">
        <DialogTitle>Sửa booking</DialogTitle>
        <DialogDescription>Đổi giờ trong cùng ngày giữ nguyên bàn. Đổi sang ngày khác sẽ nhả bàn cũ.</DialogDescription>
      </DialogHeader>
      <div className="flex-1 overflow-y-auto overscroll-contain px-6 pt-1 pb-4">
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="ed-name">Tên khách</Label>
            <div className="flex items-center gap-1.5">
              <Input
                id="ed-name"
                className="h-11 min-w-0 flex-1"
                value={name}
                placeholder={r.hasGuestName ? undefined : "Khách chưa cho tên"}
                onChange={(e) => setName(e.target.value)}
              />
              <HonorificPicker
                value={honorific}
                onChange={setHonorific}
                disabled={pending}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <div className="grid gap-1.5">
              <Label>Số khách</Label>
              <Stepper value={party} onChange={setParty} label="số khách" />
            </div>
          </div>
          <BookingTimePicker
            date={r.businessDate}
            value={time}
            now={now}
            quickTimes={quickTimes}
            onChange={setTime}
            error={timeError}
            legacyValue={legacyTime}
          />
          <div className="grid gap-1.5">
            <Label htmlFor="ed-source">Nguồn</Label>
            <SourcePicker
              id="ed-source"
              source={source}
              onSourceChange={(s) => {
                setSource(s)
                setPlatform("")
                setPlatformError(null)
              }}
              platform={platform}
              onPlatformChange={(p) => {
                setPlatform(p)
                setPlatformError(null)
              }}
              error={platformError}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Icon</Label>
            <IconPicker
              isBirthday={isBirthday}
              onBirthdayChange={setIsBirthday}
              iconKeys={iconKeys}
              onIconKeysChange={setIconKeys}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ed-classification">Loại khách</Label>
            <Select value={classification} onValueChange={(v) => setClassification(v as BookingClassification)}>
              <SelectTrigger id="ed-classification" className="h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="UNCLASSIFIED">Chưa phân loại</SelectItem>
                <SelectItem value="NEW">Khách mới (N)</SelectItem>
                <SelectItem value="RETURNING">Khách quen (O)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ed-note">Ghi chú</Label>
            <Textarea
              id="ed-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-invalid={invalid}
            />
            {invalid ? <p className="text-sm text-destructive">{NOTE_PHONE_ERROR}</p> : null}
          </div>
        </div>
      </div>
      <DialogFooter className="shrink-0 border-t border-border p-6 pt-3">
        <Button variant="ghost" onClick={close}>
          Quay lại
        </Button>
        <Button
          disabled={pending || invalid || !!timeError || (!name.trim() && !r.phoneLast3)}
          onClick={async () => {
            const pErr = validateSocialPlatform(source, platform, socialPlatformSupported)
            if (pErr) {
              setPlatformError(pErr)
              return
            }
            const res = await run(() =>
              api.updateReservation({
                id: r.id,
                version: r.version,
                // WF-01: omit the name unless it is really the guest's.
                ...contactNameUpdate(r.hasGuestName, name),
                partySize: party,
                expectedAt: atBusinessTime(r.businessDate, time),
                sourceCode: source,
                socialPlatform: socialPlatformSupported && source === "SOCIAL" ? (platform || null) : null,
                note,
                classification,
                guestType: classification === "RETURNING" ? "REGULAR" : classification === "NEW" ? "NEW" : null,
                isBirthday,
                iconKeys: iconKeysSupported ? iconKeys : undefined,
                honorific: honorificSupported ? (honorific || null) : undefined,
              }),
            )
            if (res) close()
          }}
        >
          Lưu thay đổi
        </Button>
      </DialogFooter>
    </>
  )
}

export function AdvanceWaitlistDialog({
  open,
  onOpenChange,
  r,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  r: ReservationView
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>{open ? <AdvanceWaitlistBody r={r} close={() => onOpenChange(false)} /> : null}</DialogContent>
    </Dialog>
  )
}

function AdvanceWaitlistBody({ r, close }: { r: ReservationView; close: () => void }) {
  const catalog = useCatalog()
  const { run, pending } = useAction()
  const [mode, setMode] = useState<WaitlistPreferenceMode>("ANY")
  const [zones, setZones] = useState<ZoneCode[]>([])
  const [tableId, setTableId] = useState<string>("")
  const bookableZones = useMemo(() => (catalog.data?.zones ?? []).filter((z) => z.isBookable), [catalog.data])
  const prefs = [...(tableId ? [{ tableId: Number(tableId) }] : []), ...zones.map((z) => ({ zoneCode: z }))]
  // FX-04: 1 mã chống trùng cho lần mở form; đổi mã sau mỗi lần tạo thành công.
  const [idempotencyKey, renewIdempotencyKey] = useIdempotencyKey()
  return (
    <>
      <DialogHeader>
        <DialogTitle>Đưa vào danh sách chờ</DialogTitle>
        <DialogDescription>
          Booking {fmtTime(r.expectedAt)} · {r.partySize} khách chưa có bàn. Hệ thống chỉ gợi ý khi có bàn trống, không
          tự xếp.
        </DialogDescription>
      </DialogHeader>
      <WaitlistPreferencePicker
        mode={mode}
        setMode={setMode}
        zones={zones}
        setZones={setZones}
        tableId={tableId}
        setTableId={setTableId}
        zoneOptions={bookableZones.map((z) => ({ code: z.code, name: z.name }))}
        tables={(catalog.data?.tables ?? []).filter((t) => t.kind === "TABLE").map((t) => ({ id: t.id, code: t.code }))}
      />
      <DialogFooter>
        <Button variant="ghost" onClick={close}>
          Quay lại
        </Button>
        <Button
          disabled={pending || (mode !== "ANY" && prefs.length === 0)}
          onClick={async () => {
            const res = await run(() =>
              api.addWaitlist({
                kind: "ADVANCE_RESERVATION",
                reservationId: r.id,
                channel: "ZALO_THREAD",
                preferenceMode: api.mode === "http" ? "ANY" : mode,
                preferences: api.mode === "http" || mode === "ANY" ? [] : prefs,
                idempotencyKey,
              }),
            )
            if (res) {
              renewIdempotencyKey()
              close()
            }
          }}
        >
          Thêm vào danh sách chờ
        </Button>
      </DialogFooter>
    </>
  )
}

export function WaitlistPreferencePicker({
  mode,
  setMode,
  zones,
  setZones,
  tableId,
  setTableId,
  zoneOptions,
  tables,
}: {
  mode: WaitlistPreferenceMode
  setMode: (m: WaitlistPreferenceMode) => void
  zones: ZoneCode[]
  setZones: (z: ZoneCode[]) => void
  tableId: string
  setTableId: (t: string) => void
  zoneOptions: { code: ZoneCode; name: string }[]
  tables: { id: number; code: string }[]
}) {
  if (api.mode === "http") {
    return (
      <div className="grid gap-1.5">
        <Label>Mong muốn</Label>
        <p className="rounded-lg border bg-surface-1 px-3 py-2 text-xs text-muted-foreground">
          Lựa chọn bàn ưu tiên chưa được backend hỗ trợ. Khách sẽ được lưu với mong muốn bất kỳ.
        </p>
      </div>
    )
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <Label>Mong muốn</Label>
        <ToggleGroup
          type="single"
          variant="outline"
          value={mode}
          onValueChange={(v) => v && setMode(v as WaitlistPreferenceMode)}
          className="w-full"
        >
          {(Object.keys(PREFERENCE_MODE_LABEL) as WaitlistPreferenceMode[]).map((m) => (
            <ToggleGroupItem key={m} value={m} className="flex-1 text-xs sm:text-sm">
              {PREFERENCE_MODE_LABEL[m]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      {mode !== "ANY" ? (
        <>
          <div className="grid gap-1.5">
            <Label>Khu mong muốn</Label>
            <ToggleGroup
              type="multiple"
              variant="outline"
              value={zones}
              onValueChange={(v) => setZones(v as ZoneCode[])}
            >
              {zoneOptions.map((z) => (
                <ToggleGroupItem key={z.code} value={z.code} className="px-4">
                  {z.name}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pref-table">Bàn cụ thể (tùy chọn)</Label>
            <Select value={tableId || "none"} onValueChange={(v) => setTableId(v === "none" ? "" : v)}>
              <SelectTrigger id="pref-table" className="h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="none">Không chọn</SelectItem>
                {tables.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)} className="tnum">
                    {t.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      ) : null}
    </div>
  )
}

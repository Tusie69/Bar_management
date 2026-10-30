import { ArrowRightLeft, ListPlus, LogIn, MapPinned, Pencil, TimerReset, XCircle } from "lucide-react"
import { useMemo, useState } from "react"
import { useNavigate } from "react-router"
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
  SOURCE_LABEL,
  type BookingClassification,
  type BookingSourceCode,
  type ReservationCloseReason,
  type WaitlistPreferenceMode,
} from "@/domain/enums"
import type { ReservationView } from "@/domain/models"
import type { ZoneCode } from "@/domain/venue-layout"
import { useAction } from "@/hooks/use-action"
import { useCatalog, useNow, useOperations, useReservations } from "@/hooks/use-data"
import { NOTE_PHONE_ERROR, noteHasPhoneNumber } from "@/lib/text"
import { atBusinessTime, businessDateOf, fmtBusinessDate, fmtTime, venueParts } from "@/lib/time"
import { api } from "@/services"
import { useUi } from "@/state/ui"
import { GuestCountDialog } from "../floor/floor-dialogs"
import { ReservationStatusChip } from "./reservation-status"
import { TimeField } from "../floor/floor-toolbar"

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
  const { run } = useAction()
  const ops = useOperations(300)
  const [checkInOpen, setCheckInOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [noShowOpen, setNoShowOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [waitOpen, setWaitOpen] = useState(false)
  const codes = (ids: number[]) =>
    ids.map((id) => {
      const t = catalog.data?.tables.find((x) => x.id === id)
      return t ? (t.kind === "BAR_SEAT" ? `Bar ${t.seqNo}` : t.code) : `#${id}`
    })
  const today = businessDateOf(now) === r.businessDate
  const booked = r.status === "BOOKED"
  const noShowAfter = catalog.data?.venue.noShowWarningMinutes ?? 30
  const history = (ops.data ?? []).filter((o) => o.entityType === "reservation" && o.entityId === r.id)

  const pickOnFloor = (intent: "assign" | "checkin", count?: number) => {
    ui.openReservation(null)
    navigate("/floor")
    ui.setFloorMode("live")
    ui.startPick({
      intent,
      title:
        intent === "assign"
          ? `Phân bàn cho ${r.displayName} · ${r.partySize} khách`
          : `Check-in ${r.displayName} vào bàn`,
      hint: `Booking ${fmtTime(r.expectedAt)}${r.businessDate !== businessDateOf(now) ? ` ngày ${fmtBusinessDate(r.businessDate, "short")}` : ""}. Chạm một hoặc nhiều bàn trống.`,
      multi: true,
      confirmLabel: intent === "assign" ? "Phân bàn" : "Check-in",
      onConfirm: async (ids) =>
        intent === "assign"
          ? !!(await run((o) => api.assignTables(r.id, r.version, ids, o)))
          : !!(await run((o) =>
              api.checkIn({
                reservationId: r.id,
                version: r.version,
                guestCount: count ?? r.partySize,
                tableIds: ids,
                overrideReason: o,
              }),
            )),
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
        <SheetTitle className="text-xl">{r.displayName}</SheetTitle>
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
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <Item k="Giờ đến" v={<span className="text-base font-semibold">{fmtTime(r.expectedAt)}</span>} />
          <Item k="Ngày kinh doanh" v={fmtBusinessDate(r.businessDate)} />
          <Item k="Số khách" v={`${r.partySize} khách`} />
          <Item k="Nguồn" v={SOURCE_LABEL[r.sourceCode]} />
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
          <Item k="Tạo bởi" v={`${r.createdByName} · ${fmtTime(r.createdAt)}`} />
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
            {r.tableIds.length ? (
              <GuardedButton
                permission="visit.checkin"
                size="lg"
                className="col-span-2"
                disabled={!today}
                disabledReason={!today ? "Chỉ check-in trong ngày kinh doanh của booking" : null}
                onClick={() => setCheckInOpen(true)}
              >
                <LogIn /> Check-in {codes(r.tableIds).join(" + ")}
              </GuardedButton>
            ) : (
              <GuardedButton
                permission="visit.checkin"
                size="lg"
                className="col-span-2"
                disabled={!today}
                disabledReason={!today ? "Chỉ check-in trong ngày kinh doanh của booking" : null}
                onClick={() => setCheckInOpen(true)}
              >
                <LogIn /> Khách đã tới: chọn bàn và check-in
              </GuardedButton>
            )}
            <GuardedButton permission="table.assign" variant="outline" onClick={() => pickOnFloor("assign")}>
              {r.tableIds.length ? <ArrowRightLeft /> : <MapPinned />} {r.tableIds.length ? "Đổi bàn" : "Phân bàn"}
            </GuardedButton>
            <GuardedButton permission="reservation.update" variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil /> Sửa
            </GuardedButton>
            {!r.tableIds.length && !r.waitlistEntryId ? (
              <GuardedButton
                permission="waitlist.create"
                variant="outline"
                className="col-span-2"
                onClick={() => setWaitOpen(true)}
              >
                <ListPlus /> Đưa vào danh sách chờ (đặt trước)
              </GuardedButton>
            ) : null}
            <GuardedButton permission="reservation.cancel" variant="outline" onClick={() => setCancelOpen(true)}>
              <XCircle /> Hủy booking
            </GuardedButton>
            <GuardedButton
              permission="reservation.mark_no_show"
              variant="outline"
              disabledReason={r.minutesLate >= noShowAfter ? null : `Chỉ bật sau ${noShowAfter} phút trễ`}
              onClick={() => setNoShowOpen(true)}
            >
              <TimerReset /> Không đến
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
        title={`Check-in ${r.displayName}`}
        description={
          r.tableIds.length ? <>Bàn {codes(r.tableIds).join(" + ")}</> : "Bước tiếp theo: chọn bàn trống trên sơ đồ."
        }
        initial={r.partySize}
        confirmLabel={r.tableIds.length ? "Check-in" : "Chọn bàn"}
        onConfirm={async (count) => {
          if (!r.tableIds.length) {
            setCheckInOpen(false)
            pickOnFloor("checkin", count)
            return
          }
          const res = await run(() => api.checkIn({ reservationId: r.id, version: r.version, guestCount: count }))
          if (res) setCheckInOpen(false)
        }}
      />
      <ConfirmAction
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Hủy booking?"
        description={
          <>
            Booking {fmtTime(r.expectedAt)} của <b className="text-foreground">{r.displayName}</b>. Bàn đang giữ (nếu
            có) sẽ được nhả.
          </>
        }
        confirmLabel="Hủy booking"
        reasons={CANCEL_REASONS}
        requireNoteFor="OTHER"
        onConfirm={async (reason, note) => {
          await run(() => api.cancelReservation(r.id, r.version, reason as ReservationCloseReason, note))
        }}
      />
      <ConfirmAction
        open={noShowOpen}
        onOpenChange={setNoShowOpen}
        title="Xác nhận khách không đến?"
        description={
          <>
            Đã trễ {r.minutesLate} phút. Booking chuyển sang Không đến{r.tableIds.length ? " và bàn được nhả" : ""}.
          </>
        }
        confirmLabel="Xác nhận không đến"
        onConfirm={async () => {
          await run(() => api.markNoShow(r.id, r.version))
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

function EditReservationDialog({
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
      <DialogContent>{open ? <EditReservationBody r={r} close={() => onOpenChange(false)} /> : null}</DialogContent>
    </Dialog>
  )
}

function EditReservationBody({ r, close }: { r: ReservationView; close: () => void }) {
  const catalog = useCatalog()
  const { run, pending } = useAction()
  const [time, setTime] = useState(() => {
    const p = venueParts(r.expectedAt)
    return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`
  })
  const [party, setParty] = useState(r.partySize)
  const [name, setName] = useState(r.displayName)
  const [note, setNote] = useState(r.note ?? "")
  const [source, setSource] = useState<BookingSourceCode>(r.sourceCode)
  const [classification, setClassification] = useState<BookingClassification>(r.classification)
  const invalid = noteHasPhoneNumber(note)
  return (
    <>
      <DialogHeader>
        <DialogTitle>Sửa booking</DialogTitle>
        <DialogDescription>Đổi giờ trong cùng ngày giữ nguyên bàn. Đổi sang ngày khác sẽ nhả bàn cũ.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="ed-name">Tên khách</Label>
          <Input id="ed-name" className="h-11" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div className="grid gap-1.5">
            <Label>Giờ đến</Label>
            <TimeField value={time} onChange={setTime} />
          </div>
          <div className="grid gap-1.5">
            <Label>Số khách</Label>
            <Stepper value={party} onChange={setParty} label="số khách" />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ed-source">Nguồn</Label>
          <Select value={source} onValueChange={(v) => setSource(v as BookingSourceCode)}>
            <SelectTrigger id="ed-source" className="h-11 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(catalog.data?.sources ?? []).map((s) => (
                <SelectItem key={s.code} value={s.code}>
                  {SOURCE_LABEL[s.code]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
      <DialogFooter>
        <Button variant="ghost" onClick={close}>
          Quay lại
        </Button>
        <Button
          disabled={pending || invalid || (!name.trim() && !r.phoneLast3)}
          onClick={async () => {
            const res = await run(() =>
              api.updateReservation({
                id: r.id,
                version: r.version,
                contactName: name,
                partySize: party,
                expectedAt: atBusinessTime(r.businessDate, time),
                sourceCode: source,
                classification,
                note,
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
                preferenceMode: mode,
                preferences: mode === "ANY" ? [] : prefs,
              }),
            )
            if (res) close()
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

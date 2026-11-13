import {
  AlertCircle,
  Armchair,
  ArrowRightLeft,
  CalendarClock,
  Check,
  Clock3,
  Footprints,
  Hand,
  History,
  Hourglass,
  ListPlus,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Phone,
  PhoneCall,
  PhoneForwarded,
  StickyNote,
  TimerReset,
  Users,
  XCircle,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router"
import {
  EmptyState,
  GuardedButton,
  GuestAvatar,
  MaskedPhone,
  SectionTitle,
  Stepper,
  TableCodes,
} from "@/components/common"
import { ConfirmAction } from "@/components/dialogs"
import { RevealPhone } from "@/components/reveal-phone"
import { CallCustomerControl } from "@/features/bookings/call-customer"
import { StateChip } from "@/components/status"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  CLOSE_REASON_LABEL,
  CONTACT_OUTCOME_LABEL,
  HOLD_RELEASE_LABEL,
  PREFERENCE_MODE_LABEL,
  WAITLIST_CHANNEL_LABEL,
  WAITLIST_CLOSE_LABEL,
  WAITLIST_KIND_LABEL,
  WAITLIST_STATUS_LABEL,
  type ContactAttemptChannel,
  type ContactOutcome,
  type HoldReleaseReason,
  type ReservationCloseReason,
  type WaitlistChannel,
  type WaitlistCloseReason,
  type WaitlistKind,
  type WaitlistPreferenceMode,
} from "@/domain/enums"
import type { WaitlistEntryView } from "@/domain/models"
import type { ZoneCode } from "@/domain/venue-layout"
import { useAction } from "@/hooks/use-action"
import { useBusinessDate, useNow, useReservations, useWaitlist } from "@/hooks/use-data"
import { useDragScroll } from "@/hooks/use-drag-scroll"
import { useIdempotencyKey } from "@/hooks/use-idempotency-key"
import { NOTE_PHONE_ERROR, noteHasPhoneNumber } from "@/lib/text"
import { businessDateOf, fmtCountdown, fmtElapsed, fmtTime, type BusinessDate } from "@/lib/time"
import { cn } from "@/lib/utils"
import { api, isApiError } from "@/services"
import { useCan, useSession } from "@/state/session"
import { useUi } from "@/state/ui"
import { assignWaitlistTables } from "./assign-waitlist"
import { useHeldOrderActions } from "../mobile/actions"
import { ExtendHoldDialog, GuestCountDialog } from "../floor/floor-dialogs"
import { useFloorModel, type FloorModel } from "../floor/use-floor-model"
import { WaitlistPreferencePicker } from "../reservations/reservation-detail"

const CANCEL_REASONS = (Object.keys(CLOSE_REASON_LABEL) as ReservationCloseReason[]).map((v) => ({
  value: v,
  label: CLOSE_REASON_LABEL[v],
}))

const ACTIVE = ["WAITING", "CONTACTING", "OFFERED", "HOLD_ACTIVE"]

export default function WaitlistPage({
  businessDate,
  onLeaveToFloor,
}: {
  businessDate?: BusinessDate
  /** Set on the receptionist's floor sheet: actions continue on the map, so the sheet must close first. */
  onLeaveToFloor?: () => void
}) {
  const openBooking = useUi((s) => s.openBooking)
  const today = useBusinessDate()
  const bd = businessDate ?? today
  const waitlist = useWaitlist(bd)
  const model = useFloorModel(bd)
  const [params, setParams] = useSearchParams()
  const focusEntry = Number(params.get("entry")) || null
  const focusTable = Number(params.get("table")) || null
  const [addOpen, setAddOpen] = useState(params.get("add") === "1")
  const [tableFocus, setTableFocus] = useState<number | null>(focusTable)
  const freeTablesRef = useDragScroll<HTMLDivElement>()

  useEffect(() => {
    if (!focusEntry) return
    const el = document.getElementById(`entry-${focusEntry}`)
    const scroller = el?.closest(".overflow-y-auto")
    if (el && scroller)
      scroller.scrollTop += el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 120
  }, [focusEntry, waitlist.data])

  const active = (waitlist.data ?? []).filter((e) => ACTIVE.includes(e.status))
  const closed = (waitlist.data ?? []).filter((e) => !ACTIVE.includes(e.status))
  const lanes: { kind: WaitlistKind; items: WaitlistEntryView[] }[] = [
    { kind: "ADVANCE_RESERVATION", items: active.filter((e) => e.kind === "ADVANCE_RESERVATION") },
    { kind: "WALK_IN", items: active.filter((e) => e.kind === "WALK_IN") },
  ]

  const freeTables = useMemo(
    () =>
      model.tables.filter(
        (t) =>
          t.kind === "TABLE" &&
          model.states.get(t.id)?.state === "free" &&
          model.catalog?.zones.find((z) => z.id === t.zoneId)?.isBookable,
      ),
    [model],
  )
  const fitFor = (tableId: number) => {
    const t = model.byId.get(tableId)
    return active.filter(
      (e) =>
        ["WAITING", "CONTACTING", "OFFERED"].includes(e.status) &&
        t &&
        e.partySize <= t.capacity &&
        (e.preferenceMode !== "PREFERRED_ONLY" ||
          (e.preferences ?? []).some((p) => p.tableId === tableId || p.zoneCode === t.zoneCode)),
    )
  }

  return (
    <div className="h-full scrollbar-thin overflow-y-auto">
      <div className="mx-auto grid max-w-[1400px] grid-cols-[minmax(0,1fr)] gap-5 p-4 md:p-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="grid gap-2">
            <h2 className="text-2xl leading-tight font-extrabold tracking-tight">Danh sách chờ</h2>
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              Chỉ gợi ý, không tự xếp chỗ · khách đặt trước được ưu tiên hơn Walk-in
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SummaryPill icon={CalendarClock} hue={265} n={lanes[0].items.length} label="đặt trước" />
            <SummaryPill icon={Footprints} hue={200} n={lanes[1].items.length} label="walk-in" />
            <SummaryPill
              icon={Hourglass}
              hue={300}
              n={active.filter((e) => e.status === "HOLD_ACTIVE").length}
              label="đang giữ bàn"
            />
            {onLeaveToFloor ? (
              <GuardedButton
                permission="reservation.create"
                onClick={() => {
                  onLeaveToFloor()
                  openBooking({ tableIds: [], date: businessDate, toWaitlist: true })
                }}
              >
                <CalendarClock /> Nhận booking
              </GuardedButton>
            ) : null}
            <GuardedButton
              permission="waitlist.create"
              variant={onLeaveToFloor ? "outline" : "default"}
              onClick={() => setAddOpen(true)}
            >
              <ListPlus /> Thêm khách chờ
            </GuardedButton>
          </div>
        </header>

        <section className="grid gap-2" aria-label="Gợi ý cho bàn trống">
          <SectionTitle aside={<span className="hidden text-xs text-subtle sm:inline">chạm để lọc khách hợp bàn</span>}>
            Bàn trống · {freeTables.length}
          </SectionTitle>
          <div
            ref={freeTablesRef}
            className="-mx-1 no-scrollbar flex touch-pan-x gap-2 overflow-x-auto overscroll-x-contain px-1 pb-1 md:scrollbar-thin"
          >
            {freeTables.length === 0 ? <p className="text-sm text-muted-foreground">Chưa có bàn trống.</p> : null}
            {freeTables.map((t) => {
              const n = fitFor(t.id).length
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={tableFocus === t.id}
                  onClick={() => setTableFocus(tableFocus === t.id ? null : t.id)}
                  className={cn(
                    "flex h-12 shrink-0 items-center gap-2.5 rounded-xl border px-3 text-left transition-colors",
                    tableFocus === t.id ? "border-foreground bg-foreground text-background" : "hover:bg-surface-2",
                  )}
                >
                  <Armchair className="size-4 opacity-60" aria-hidden />
                  <span className="grid leading-tight">
                    <span className="text-sm font-semibold">
                      {t.code} <span className="text-xs font-normal opacity-70">· {t.capacity} chỗ</span>
                    </span>
                    <span
                      className={cn(
                        "text-xs",
                        tableFocus === t.id ? "text-background/75" : n ? "text-st-seated-ink" : "text-subtle",
                      )}
                    >
                      {n ? `${n} khách hợp` : "chưa ai hợp"}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        {waitlist.isLoading ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-72" />
            <Skeleton className="h-72" />
          </div>
        ) : waitlist.isError ? (
          <EmptyState title="Lỗi tải danh sách chờ" icon={<AlertCircle className="size-6 text-destructive" />}>
            {isApiError(waitlist.error)
              ? waitlist.error.message
              : waitlist.error instanceof Error
                ? waitlist.error.message
                : "Không thể tải danh sách chờ"}
          </EmptyState>
        ) : (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-2">
            {lanes.map((lane) => (
              <section
                key={lane.kind}
                className="grid min-w-0 content-start gap-3"
                aria-label={WAITLIST_KIND_LABEL[lane.kind]}
              >
                <div className="flex items-center gap-2.5 border-b pb-2.5">
                  <span
                    className="tone grid size-8 place-items-center rounded-lg"
                    style={{ ["--h" as string]: lane.kind === "ADVANCE_RESERVATION" ? 265 : 200 }}
                  >
                    {lane.kind === "ADVANCE_RESERVATION" ? (
                      <CalendarClock className="size-4" aria-hidden />
                    ) : (
                      <Footprints className="size-4" aria-hidden />
                    )}
                  </span>
                  <h3 className="text-base font-semibold">{WAITLIST_KIND_LABEL[lane.kind]}</h3>
                  <span className="tnum ml-auto rounded-full bg-surface-2 px-2 text-sm text-muted-foreground">
                    {lane.items.length}
                  </span>
                </div>
                {lane.items.length === 0 ? (
                  <EmptyState title="Không có khách chờ" icon={<Users />} className="rounded-xl border border-dashed" />
                ) : (
                  <ol className="grid gap-2">
                    {lane.items.map((e, i) => (
                      <EntryCard
                        onLeaveToFloor={onLeaveToFloor}
                        key={e.id}
                        entry={e}
                        index={i + 1}
                        model={model}
                        highlighted={
                          focusEntry === e.id || (!!tableFocus && fitFor(tableFocus).some((x) => x.id === e.id))
                        }
                        dimmed={!!tableFocus && !fitFor(tableFocus).some((x) => x.id === e.id)}
                        presetTable={tableFocus}
                      />
                    ))}
                  </ol>
                )}
              </section>
            ))}
          </div>
        )}

        {closed.length ? (
          <details className="rounded-xl border">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
              Đã đóng trong ca · {closed.length}
            </summary>
            <ul className="grid gap-px border-t">
              {closed.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="tnum w-12 text-xs text-subtle">{fmtTime(e.queuedAt)}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {e.displayName} · {e.partySize} khách · {e.kind === "WALK_IN" ? "Walk-in" : "Đặt trước"}
                  </span>
                  <span className="text-muted-foreground">
                    {WAITLIST_STATUS_LABEL[e.status]}
                    {e.closedAt ? ` lúc ${fmtTime(e.closedAt)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
      <AddWaitlistDialog
        open={addOpen}
        onOpenChange={(o) => {
          setAddOpen(o)
          if (!o && params.get("add")) {
            params.delete("add")
            setParams(params, { replace: true })
          }
        }}
        model={model}
      />
    </div>
  )
}

function EntryCard({
  entry: e,
  index,
  model,
  highlighted,
  dimmed,
  presetTable,
  onLeaveToFloor,
}: {
  entry: WaitlistEntryView
  index: number
  model: FloorModel
  highlighted: boolean
  dimmed: boolean
  presetTable: number | null
  onLeaveToFloor?: () => void
}) {
  const startPick = useUi((s) => s.startPick)
  const openReservation = useUi((s) => s.openReservation)
  const now = useNow(1000)
  const me = useSession((s) => s.user.id)
  const canReveal = useCan("customer.phone.reveal")
  const canOpenWalkIn = useCan("visit.walkin")
  const { run, pending } = useAction()
  const { data: reservations } = useReservations(e.businessDate)
  const [contactOpen, setContactOpen] = useState(false)
  const [seatOpen, setSeatOpen] = useState(false)
  const [arrival, setArrival] = useState<(() => Promise<unknown>) | null>(null)
  const [extendOpen, setExtendOpen] = useState(false)
  const [releaseOpen, setReleaseOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [cancelResOpen, setCancelResOpen] = useState(false)
  const [entryDetailOpen, setEntryDetailOpen] = useState(false)
  const mine = e.claimedBy?.userId === me
  const claimLeft = e.claimExpiresAt ? e.claimExpiresAt.getTime() - now.getTime() : 0
  const overdue = !!e.hold && now > e.hold.deadlineAt
  const ChannelIcon = e.channel === "PHONE_CALLBACK" ? Phone : e.channel === "IN_PERSON" ? Hand : MessageCircle
  const linkedRes = reservations?.find((r) => (e.reservationId ? r.id === e.reservationId : r.waitlistEntryId === e.id))
  const heldCodes = linkedRes?.tableIds?.length ? model.codes(linkedRes.tableIds) : (e.hold?.tableIds?.length ? model.codes(e.hold.tableIds) : [])
  const held = useHeldOrderActions(model)
  const policy = held.policy(e, linkedRes)
  const today = e.businessDate === businessDateOf(now)
  const canConfirmLate =
    today &&
    linkedRes &&
    policy.canLate &&
    linkedRes.status === "BOOKED" &&
    !linkedRes.lateConfirmedAt &&
    now.getTime() >= linkedRes.expectedAt.getTime()

  return (
    <li
      id={`entry-${e.id}`}
      className={cn(
        "grid grid-cols-[minmax(0,1fr)] gap-3 rounded-2xl border bg-surface-1 p-4 transition-opacity",
        highlighted && "border-foreground",
        dimmed && "opacity-45",
      )}
    >
      <div className="flex items-start gap-3">
        <span className="relative">
          <GuestAvatar name={e.displayName} seed={e.customerId ?? e.displayName} size={40} />
          <span
            className="tnum absolute -right-1 -bottom-1 grid size-[18px] place-items-center rounded-full border-2 border-surface-1 bg-foreground text-[10px] font-semibold text-background"
            aria-label={`Thứ tự ${index} trong nhóm`}
          >
            {index}
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <p className="truncate text-base font-semibold">{e.displayName}</p>
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
              style={{
                background: e.kind === "ADVANCE_RESERVATION" ? "var(--st-reserved-tint)" : "var(--surface-2)",
                color: e.kind === "ADVANCE_RESERVATION" ? "var(--st-reserved-ink)" : "var(--text-muted)",
              }}
            >
              {e.kind === "ADVANCE_RESERVATION" ? "Đặt trước" : "Walk-in"}
            </span>
            <span className="tnum inline-flex items-center gap-1 text-sm text-muted-foreground">
              <Users className="size-3.5" aria-hidden />
              {e.partySize}
            </span>
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <ChannelIcon className="size-3.5 text-subtle" aria-hidden /> {WAITLIST_CHANNEL_LABEL[e.channel]}
            </span>
            <span className="inline-flex items-center gap-1" title={`Yêu cầu lúc ${fmtTime(e.queuedAt)}`}>
              <Clock3 className="size-3.5 text-subtle" aria-hidden />
              <span className="tnum">{fmtTime(e.queuedAt)}</span>
              <span className="text-subtle">·</span>
              chờ <span className="tnum text-foreground">{fmtElapsed(now.getTime() - e.queuedAt.getTime())}</span>
            </span>
            {e.reservationExpectedAt ? (
              <span className="inline-flex items-center gap-1">
                <CalendarClock className="size-3.5 text-subtle" aria-hidden /> hẹn{" "}
                <span className="tnum">{fmtTime(e.reservationExpectedAt)}</span>
              </span>
            ) : null}
            {e.phoneLast3 && !(canReveal && e.customerId && (e.callbackRequested || e.channel === "PHONE_CALLBACK")) ? (
              <MaskedPhone last3={e.phoneLast3} className="text-xs" />
            ) : null}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <StatusChip e={e} overdue={overdue} />
          <EntryMenu onCancel={() => setCancelOpen(true)} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {(e.preferences?.length ?? 0) > 0 || e.preferenceMode ? (
          <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-surface-2 px-2.5 text-muted-foreground">
            <MapPin className="size-3.5 text-subtle" aria-hidden />
            {e.preferences?.length
              ? e.preferences.map((p) => p.label).join(", ")
              : PREFERENCE_MODE_LABEL[e.preferenceMode!]}
          </span>
        ) : null}
        {e.callbackRequested === true ? (
          <StateChip state="late" className="h-7">
            <PhoneForwarded className="size-3.5" /> Cần gọi lại
          </StateChip>
        ) : null}
      </div>

      {/* A waitlist guest could only be rung by an owner revealing the number by
          hand, even though one of the three reveal reasons is literally "gọi lại
          cho khách trong danh sách chờ". Where the entry is backed by a booking
          the receptionist can now call it like any other, number unseen. An
          entry with no booking still cannot: booking_call_logs.reservation_id is
          NOT NULL, so logging that call needs a schema change of its own. */}
      {e.reservationId && e.phoneLast3 ? (
        <CallCustomerControl
          bookingId={e.reservationId}
          bookingVersion={null}
          canCall
          label="Gọi khách chờ"
          className="w-full"
        />
      ) : null}

      {canReveal && e.customerId && (e.callbackRequested || e.channel === "PHONE_CALLBACK") ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm">
          <Phone className="size-4 text-subtle" aria-hidden />
          <RevealPhone key={e.customerId} customerId={e.customerId} last3={e.phoneLast3} context={{ entryId: e.id }} />
        </div>
      ) : null}

      {e.status === "CONTACTING" && e.claimedBy ? (
        <p
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
          style={{ background: "var(--st-reserved-tint)", color: "var(--st-reserved-ink)" }}
        >
          <PhoneCall className="size-4 shrink-0" aria-hidden />
          <span>
            {mine ? "Bạn" : e.claimedBy.name} đang liên hệ · còn <span className="tnum">{fmtCountdown(claimLeft)}</span>
          </span>
        </p>
      ) : null}
      {e.hold ? (
        <p
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
          style={{
            background: `var(--st-${overdue ? "late" : "reserved"}-tint)`,
            color: `var(--st-${overdue ? "late" : "reserved"}-ink)`,
          }}
        >
          <Hourglass className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0">
            Giữ <TableCodes codes={model.codes(e.hold.tableIds)} className="[&>span]:text-[13px]" /> đến{" "}
            <span className="tnum">{fmtTime(e.hold.deadlineAt)}</span>
            {e.hold.basis === "NEGOTIATED" ? " (gia hạn)" : ""} ·{" "}
            {overdue ? (
              <b className="font-semibold">quá {fmtElapsed(now.getTime() - e.hold.deadlineAt.getTime())}</b>
            ) : (
              <>
                còn <span className="tnum">{fmtCountdown(e.hold.deadlineAt.getTime() - now.getTime())}</span>
              </>
            )}
          </span>
        </p>
      ) : e.status === "HOLD_ACTIVE" ? (
        <p
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
          style={{
            background: "var(--st-reserved-tint)",
            color: "var(--st-reserved-ink)",
          }}
        >
          <Hourglass className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0">
            {heldCodes.length ? (
              <>
                Giữ <TableCodes codes={heldCodes} className="[&>span]:text-[13px]" /> cho booking liên kết
              </>
            ) : (
              "Đang giữ bàn cho booking liên kết"
            )}
          </span>
        </p>
      ) : null}
      {e.note ? (
        <p className="flex gap-2 text-sm text-muted-foreground">
          <StickyNote className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden />
          {e.note}
        </p>
      ) : null}
      {e.attempts === null ? (
        <p className="flex items-center gap-1.5 text-xs text-subtle">
          <History className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">Lịch sử liên hệ chưa khả dụng</span>
        </p>
      ) : e.attempts.length > 0 ? (
        <p className="flex items-center gap-1.5 text-xs text-subtle">
          <History className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">
            Lần {e.attempts[e.attempts.length - 1].attemptNo}:{" "}
            {CONTACT_OUTCOME_LABEL[e.attempts[e.attempts.length - 1].outcome]} ·{" "}
            {e.attempts[e.attempts.length - 1].byName}{" "}
            <span className="tnum">{fmtTime(e.attempts[e.attempts.length - 1].startedAt)}</span>
          </span>
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {e.status === "HOLD_ACTIVE" ? (
          <>
            <GuardedButton
              permission="visit.checkin"
              disabled={!policy.canArrival || held.pending}
              disabledReason={!policy.supported ? "Chưa hỗ trợ" : undefined}
              onClick={() => {
                if (held.policy(e, linkedRes).canArrival) {
                  setArrival(() => () => held.arrive(e, linkedRes, linkedRes?.partySize ?? e.partySize))
                  setSeatOpen(true)
                }
              }}
            >
              <Check /> Khách đã đến
            </GuardedButton>
            <Button
              variant="outline"
              onClick={() => {
                if (linkedRes) openReservation(linkedRes.id, e.businessDate)
                else setEntryDetailOpen(true)
              }}
            >
              Quản lý đơn
            </Button>
            <GuardedButton
              permission="table.assign"
              variant="outline"
              disabled={!policy.canReassign || held.pending}
              disabledReason={!policy.supported ? "Chưa hỗ trợ" : undefined}
              onClick={() => {
                const pick = held.picker(e, linkedRes)
                if (pick) {
                  onLeaveToFloor?.()
                  startPick({ ...pick, intent: "assign" })
                }
              }}
            >
              <ArrowRightLeft /> Đổi / Ghép bàn
            </GuardedButton>
            {linkedRes ? (
              <Button
                variant="outline"
                onClick={() => openReservation(linkedRes.id, e.businessDate)}
              >
                Xem booking
              </Button>
            ) : null}
            <Button
              variant="outline"
              onClick={() => {
                setEntryDetailOpen(true)
              }}
            >
              Xem đơn chờ
            </Button>
            {linkedRes ? (
              <GuardedButton
                permission={held.can("reservation.cancel") ? "reservation.cancel" : "reservation.update"}
                disabled={!policy.canBookingStatus}
                disabledReason={!policy.canBookingStatus ? "Chưa hỗ trợ" : undefined}
                variant="outline"
                onClick={() => setStatusOpen(true)}
              >
                Đổi trạng thái
              </GuardedButton>
            ) : (
              <GuardedButton
                permission="waitlist.cancel"
                variant="outline"
                onClick={() => setCancelOpen(true)}
              >
                Đổi trạng thái
              </GuardedButton>
            )}
          </>
        ) : e.status === "CONTACTING" && mine ? (
          <>
            <GuardedButton permission="waitlist.record_contact" onClick={() => setContactOpen(true)}>
              <PhoneCall /> Ghi kết quả liên hệ
            </GuardedButton>
            <Button
              variant="outline"
              disabled={pending || api.mode === "http"}
              title={api.mode === "http" ? "Backend v1 chưa hỗ trợ nhả quyền liên hệ." : undefined}
              onClick={() => run(() => api.releaseClaim(e.id, e.version), { silent: true })}
            >
              Thả
            </Button>
            <GuardedButton
              permission="table.assign"
              variant="outline"
              onClick={() => setSeatOpen(true)}
            >
              <Armchair /> {e.channel === "IN_PERSON" ? "Khách nhận bàn ngay" : "Gán giữ bàn"}
            </GuardedButton>
          </>
        ) : (
          <>
            {api.mode === "http" ? (
              <GuardedButton
                permission="waitlist.record_contact"
                variant="outline"
                onClick={() => setContactOpen(true)}
              >
                <PhoneCall /> Ghi liên hệ
              </GuardedButton>
            ) : (
              <GuardedButton
                permission="waitlist.claim"
                variant={e.status === "CONTACTING" ? "outline" : "default"}
                disabled={pending}
                onClick={async () => {
                  const r = await run(() => api.claimWaitlist(e.id, e.version), { silent: true })
                  if (r) setContactOpen(true)
                }}
              >
                <PhoneCall /> {e.status === "CONTACTING" ? "Đang có người liên hệ" : "Nhận liên hệ"}
              </GuardedButton>
            )}
            {onLeaveToFloor && e.status === "WAITING" ? (
              <GuardedButton
                permission={api.mode === "http" ? "table.assign" : "waitlist.claim"}
                disabled={pending || (api.mode === "http" && e.kind === "WALK_IN" && !canOpenWalkIn)}
                onClick={() => {
                  const expected = e.kind === "ADVANCE_RESERVATION" ? e.reservationExpectedAt : null
                  onLeaveToFloor()
                  startPick({
                    intent: expected ? "assign" : "seat-waitlist",
                    title: `Chuyển ${e.displayName} vào bàn`,
                    hint: `Chạm bàn trống cho ${e.partySize || 1} khách rồi xác nhận.`,
                    multi: true,
                    confirmLabel: e.kind === "WALK_IN" ? "Xác nhận mở bàn" : "Xác nhận chuyển bàn",
                    ...(expected
                      ? {
                          targetDate: e.businessDate,
                          targetTime: fmtTime(expected),
                          targetExpectedAt: expected,
                          targetParty: e.partySize || 1,
                        }
                      : {}),
                    onConfirm: async (ids) => !!(await run((o) => assignWaitlistTables(e, ids, o))),
                  })
                }}
              >
                <Armchair /> Chuyển bàn
              </GuardedButton>
            ) : null}
            <GuardedButton
              permission="table.assign"
              variant={api.mode === "http" && !onLeaveToFloor ? "default" : "outline"}
              onClick={() => setSeatOpen(true)}
            >
              <Armchair /> {e.channel === "IN_PERSON" ? "Khách nhận bàn ngay" : "Gán giữ bàn"}
            </GuardedButton>
          </>
        )}
      </div>

      {api.mode === "mock" && e.hold ? (
        <div className="flex gap-2">
          <GuardedButton permission="hold.set_deadline" variant="outline" onClick={() => setExtendOpen(true)}>Gia hạn giữ</GuardedButton>
          <GuardedButton permission="hold.release" variant="outline" onClick={() => setReleaseOpen(true)}>Nhả giữ</GuardedButton>
        </div>
      ) : null}

      <ContactDialog
        open={contactOpen}
        onOpenChange={setContactOpen}
        entry={e}
        model={model}
        presetTable={presetTable}
      />
      <SeatDialog onArrival={arrival ?? undefined} open={seatOpen} onOpenChange={setSeatOpen} entry={e} model={model} presetTable={presetTable} />
      {e.hold ? (
        <>
          <ExtendHoldDialog
            open={extendOpen}
            onOpenChange={setExtendOpen}
            deadline={e.hold.deadlineAt}
            onConfirm={async (deadline, reason) => {
              if (!held.can("hold.set_deadline")) return
              const r = await run(() => api.setHoldDeadline(e.hold!.id, e.hold!.version, deadline, reason))
              if (r) setExtendOpen(false)
            }}
          />
          <ConfirmAction
            open={releaseOpen}
            onOpenChange={setReleaseOpen}
            title="Nhả giữ bàn?"
            description="Bàn trở về trống. Khách quay lại danh sách chờ."
            confirmLabel="Nhả giữ"
            reasons={(
              ["CUSTOMER_CANCELLED", "STAFF_REASSIGNED", "OTHER"] as HoldReleaseReason[]
            ).map((v) => ({ value: v, label: HOLD_RELEASE_LABEL[v] }))}
            requireNoteFor="OTHER"
            onConfirm={async (reason, note) => {
              if (!held.can("hold.release")) return
              await run(() => api.releaseHold(e.hold!.id, e.hold!.version, reason as HoldReleaseReason, note))
            }}
          />
        </>
      ) : null}
      <ConfirmAction
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Hủy mục chờ?"
        description={
          <>
            {e.displayName} · {e.partySize} khách. {e.hold ? "Bàn đang giữ sẽ được nhả." : ""}
            {e.kind === "ADVANCE_RESERVATION" ? " Booking vẫn giữ nguyên trạng thái Đã đặt." : ""}
          </>
        }
        confirmLabel="Hủy mục chờ"
        reasons={(
          [
            "CUSTOMER_WITHDREW",
            "CUSTOMER_DECLINED",
            "SEATED_OTHERWISE",
            "DUPLICATE",
            "ENTRY_ERROR",
            "OTHER",
          ] as WaitlistCloseReason[]
        ).map((v) => ({ value: v, label: WAITLIST_CLOSE_LABEL[v] }))}
        requireNoteFor="OTHER"
        onConfirm={async (reason, note) => {
          if (!held.can("waitlist.cancel")) return
          await run(() => api.cancelWaitlist(e.id, e.version, reason as WaitlistCloseReason, note))
        }}
      />
      {linkedRes ? (
        <>
          <Dialog open={statusOpen} onOpenChange={setStatusOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Đổi trạng thái booking</DialogTitle>
                <DialogDescription>{linkedRes.displayName}</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-2 pt-2">
                <GuardedButton
                  permission="reservation.update"
                  variant="outline"
                  disabledReason={
                    pending
                      ? "Đang ghi nhận..."
                      : canConfirmLate
                        ? null
                        : linkedRes.lateConfirmedAt
                          ? "Đã ghi nhận khách tới muộn"
                          : "Chỉ bật sau giờ hẹn"
                  }
                  onClick={async () => {
                    if (!held.can("reservation.update") || !held.policy(e, linkedRes).canLate || !canConfirmLate) return
                    const r = await run(() => api.confirmLate(linkedRes.id, linkedRes.version))
                    if (r) setStatusOpen(false)
                  }}
                >
                  <TimerReset /> Tới muộn
                </GuardedButton>
                <GuardedButton
                  permission="reservation.cancel"
                  variant="outline"
                  onClick={() => {
                    setStatusOpen(false)
                    setCancelResOpen(true)
                  }}
                >
                  <XCircle /> Hủy booking
                </GuardedButton>
              </div>
            </DialogContent>
          </Dialog>
          <ConfirmAction
            open={cancelResOpen}
            onOpenChange={setCancelResOpen}
            title="Hủy booking?"
            description={
              <>
                Booking của <b className="text-foreground">{linkedRes.displayName}</b>. Bàn đang giữ sẽ được nhả.
              </>
            }
            confirmLabel="Hủy booking"
            reasons={CANCEL_REASONS}
            requireNoteFor="OTHER"
            onConfirm={async (reason, note) => {
              await run(() =>
                held.can("reservation.cancel") && held.policy(e, linkedRes).canBookingStatus ? api.cancelReservation(linkedRes.id, linkedRes.version, reason as ReservationCloseReason, note) : Promise.reject(new Error("Chưa hỗ trợ hoặc thiếu quyền hủy booking")),
              )
            }}
          />
        </>
      ) : null}

      <Dialog open={entryDetailOpen} onOpenChange={setEntryDetailOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Chi tiết mục chờ #{e.id}</DialogTitle>
            <DialogDescription>{e.displayName}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 pt-2 text-sm">
            <div className="flex justify-between border-b pb-1">
              <span className="text-muted-foreground">Khách hàng:</span>
              <span className="font-medium">{e.displayName}</span>
            </div>
            <div className="flex justify-between border-b pb-1">
              <span className="text-muted-foreground">Số khách:</span>
              <span className="font-medium">{e.partySize} khách</span>
            </div>
            <div className="flex justify-between border-b pb-1">
              <span className="text-muted-foreground">Loại mục chờ:</span>
              <span className="font-medium">{e.kind === "WALK_IN" ? "Walk-in" : "Đặt trước"}</span>
            </div>
            <div className="flex justify-between border-b pb-1">
              <span className="text-muted-foreground">Trạng thái:</span>
              <span className="font-medium">{WAITLIST_STATUS_LABEL[e.status]}</span>
            </div>
            <div className="flex justify-between border-b pb-1">
              <span className="text-muted-foreground">Thời gian:</span>
              <span className="font-medium">{fmtTime(e.queuedAt)}</span>
            </div>
            {heldCodes.length ? (
              <div className="flex justify-between border-b pb-1">
                <span className="text-muted-foreground">Bàn đang giữ:</span>
                <span className="font-medium">{heldCodes.join(" + ")}</span>
              </div>
            ) : null}
            {e.note ? (
              <div className="flex flex-col gap-1 pt-1">
                <span className="text-muted-foreground">Ghi chú:</span>
                <p className="text-tx-1">{e.note}</p>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </li>
  )
}

function SummaryPill({ icon: Icon, hue, n, label }: { icon: typeof Users; hue: number; n: number; label: string }) {
  return (
    <span className="inline-flex h-10 items-center gap-2 rounded-full border px-3 text-sm">
      <span className="tone grid size-6 place-items-center rounded-full" style={{ ["--h" as string]: hue }}>
        <Icon className="size-3.5" aria-hidden />
      </span>
      <span className="tnum font-semibold">{n}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  )
}

function EntryMenu({ onCancel }: { onCancel: () => void }) {
  const can = useCan("waitlist.cancel")
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Thêm thao tác">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={!can} onSelect={onCancel}>
          <XCircle /> Hủy mục chờ
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function StatusChip({ e, overdue }: { e: WaitlistEntryView; overdue: boolean }) {
  switch (e.status) {
    case "HOLD_ACTIVE":
      return <StateChip state={overdue ? "hold_overdue" : "hold"}>{overdue ? "Quá hạn giữ" : "Đang giữ bàn"}</StateChip>
    case "CONTACTING":
      return <StateChip state="reserved">Đang liên hệ</StateChip>
    case "OFFERED":
      return <StateChip state="reserved">Đã đề nghị bàn</StateChip>
    default:
      return <StateChip state="free">Đang chờ</StateChip>
  }
}

function TablePicker({
  model,
  party,
  value,
  onChange,
}: {
  model: FloorModel
  party: number
  value: number[]
  onChange: (v: number[]) => void
}) {
  const free = model.tables.filter(
    (t) =>
      model.states.get(t.id)?.state === "free" &&
      model.catalog?.zones.find((z) => z.id === t.zoneId)?.isBookable &&
      (t.kind === "TABLE" || party <= 2),
  )
  return (
    <div className="grid max-h-52 scrollbar-thin grid-cols-4 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-6">
      {free.map((t) => {
        const on = value.includes(t.id)
        return (
          <button
            key={t.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== t.id) : [...value, t.id])}
            className={cn(
              "flex h-12 flex-col items-center justify-center rounded-lg border text-sm font-semibold",
              on
                ? "border-foreground bg-foreground text-background"
                : t.capacity < party && t.kind === "TABLE"
                  ? "text-subtle hover:bg-surface-2"
                  : "hover:bg-surface-2",
            )}
          >
            {t.kind === "BAR_SEAT" ? `Bar ${t.seqNo}` : t.code}
            <span className="font-sans text-[10px] font-normal opacity-70">{t.capacity} chỗ</span>
          </button>
        )
      })}
      {free.length === 0 ? <p className="col-span-full text-sm text-muted-foreground">Chưa có bàn trống.</p> : null}
    </div>
  )
}

const OUTCOMES: ContactOutcome[] = [
  "ACCEPTED",
  "OFFER_PENDING",
  "NO_ANSWER",
  "CALLBACK_REQUESTED",
  "KEEP_WAITING",
  "DECLINED_OFFER",
  "WITHDREW",
  "WRONG_CONTACT",
]

interface EntryDialogProps {
  entry: WaitlistEntryView
  model: FloorModel
  presetTable: number | null
}

function ContactDialog({
  open,
  onOpenChange,
  ...props
}: EntryDialogProps & { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        {open ? <ContactBody {...props} close={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function ContactBody({ entry: e, model, presetTable, close }: EntryDialogProps & { close: () => void }) {
  const isOwner = useCan("customer.phone.reveal")
  const { run, pending } = useAction()
  const [channel, setChannel] = useState<ContactAttemptChannel>(() =>
    e.channel === "ZALO_THREAD"
      ? "ZALO_THREAD"
      : e.channel === "FANPAGE_THREAD"
        ? "FANPAGE_THREAD"
        : e.channel === "PHONE_CALLBACK" && isOwner
          ? "PHONE_BY_AUTHORIZED"
          : "IN_PERSON",
  )
  const [outcome, setOutcome] = useState<ContactOutcome>("ACCEPTED")
  const [tables, setTables] = useState<number[]>(presetTable ? [presetTable] : [])
  const [note, setNote] = useState(e.channel === "PHONE_CALLBACK" && !isOwner ? "Chuyển Chủ quán gọi" : "")
  const needsTables = api.mode !== "http" && (outcome === "ACCEPTED" || outcome === "OFFER_PENDING")
  const invalid = noteHasPhoneNumber(note)
  const channels: ContactAttemptChannel[] = [
    "IN_PERSON",
    "ZALO_THREAD",
    "FANPAGE_THREAD",
    "OTHER",
    ...(isOwner ? (["PHONE_BY_AUTHORIZED"] as ContactAttemptChannel[]) : []),
  ]
  return (
    <>
      <DialogHeader>
        <DialogTitle>Kết quả liên hệ · {e.displayName}</DialogTitle>
        <DialogDescription>
          Lần liên hệ được ghi lại và không hoàn tác được.{" "}
          {!isOwner ? "Lễ tân không gọi số của khách; chọn “Khách hẹn gọi lại” để chuyển Chủ quán gọi." : ""}
        </DialogDescription>
      </DialogHeader>
      <div className="grid max-h-[60dvh] scrollbar-thin gap-4 overflow-y-auto pr-1">
        <div className="grid gap-1.5">
          <Label htmlFor="ct-channel">Kênh</Label>
          <Select value={channel} onValueChange={(v) => setChannel(v as ContactAttemptChannel)}>
            <SelectTrigger id="ct-channel" className="h-11 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {channels.map((c) => (
                <SelectItem key={c} value={c}>
                  {c === "PHONE_BY_AUTHORIZED"
                    ? "Chủ quán gọi điện"
                    : c === "IN_PERSON"
                      ? "Tại quầy"
                      : c === "ZALO_THREAD"
                        ? "Zalo"
                        : c === "FANPAGE_THREAD"
                          ? "Fanpage"
                          : "Khác"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <RadioGroup
          value={outcome}
          onValueChange={(v) => setOutcome(v as ContactOutcome)}
          className="grid gap-1 sm:grid-cols-2"
          aria-label="Kết quả"
        >
          {OUTCOMES.map((o) => (
            <Label
              key={o}
              htmlFor={`oc-${o}`}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 font-normal has-[[data-state=checked]]:border-foreground has-[[data-state=checked]]:bg-surface-2"
            >
              <RadioGroupItem id={`oc-${o}`} value={o} />
              {CONTACT_OUTCOME_LABEL[o]}
            </Label>
          ))}
        </RadioGroup>
        {needsTables ? (
          <div className="grid gap-1.5">
            <Label>
              Bàn {outcome === "ACCEPTED" ? "giữ cho khách" : "đề nghị"} · {e.partySize} khách
            </Label>
            <TablePicker model={model} party={e.partySize} value={tables} onChange={setTables} />
            {outcome === "ACCEPTED" ? (
              <p className="text-xs text-muted-foreground">
                Bàn được giữ {model.catalog?.venue.waitlistHoldDefaultMinutes ?? 30} phút kể từ lúc khách xác nhận. Quá
                hạn chỉ cảnh báo, không tự nhả.
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="grid gap-1.5">
          <Label htmlFor="ct-note">Ghi chú</Label>
          <Textarea
            id="ct-note"
            rows={2}
            value={note}
            onChange={(ev) => setNote(ev.target.value)}
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
          disabled={pending || invalid || (needsTables && tables.length === 0)}
          onClick={async () => {
            const r = await run((o) =>
              api.recordContact({
                entryId: e.id,
                version: e.version,
                channel,
                outcome,
                offeredTableIds: needsTables ? tables : undefined,
                note: note || undefined,
                overrideReason: o,
              }),
            )
            if (r) close()
          }}
        >
          Ghi kết quả
        </Button>
      </DialogFooter>
    </>
  )
}

function SeatDialog({
  onArrival,
  open,
  onOpenChange,
  ...props
}: EntryDialogProps & { open: boolean; onOpenChange: (o: boolean) => void; onArrival?: () => Promise<unknown> }) {
  const { entry: e, model } = props
  const { data: reservations } = useReservations(e.businessDate)
  const held = useHeldOrderActions(model)
  const isArrival = e.status === "HOLD_ACTIVE" || Boolean(e.hold)

  if (isArrival) {
    const res = reservations?.find((r) => (e.reservationId ? r.id === e.reservationId : r.waitlistEntryId === e.id))
    const tableIds = res?.tableIds?.length ? res.tableIds : e.hold?.tableIds ?? []
    const tableCodes = model.codes(tableIds)
    const storedParty = e.partySize || res?.partySize || 1

    return (
      <GuestCountDialog
        open={open}
        onOpenChange={onOpenChange}
        title={`Xác nhận khách đã đến: ${e.displayName}`}
        description={
          tableCodes.length > 0 ? (
            <>
              Khách: {e.displayName} · Bàn: {tableCodes.join(" + ")} · Số khách: {storedParty} khách. Xác nhận khách nhận bàn và hoàn tất mục chờ.
            </>
          ) : (
            <>Khách: {e.displayName} · Số khách: {storedParty} khách. Xác nhận khách nhận bàn và hoàn tất mục chờ.</>
          )
        }
        initial={storedParty}
        readOnly
        confirmLabel="Khách đã đến"
        onConfirm={async () => {
          const result = onArrival ? await onArrival() : await held.arrive(e, res, storedParty)
          if (result) onOpenChange(false)
        }}
      />
    )
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        {open ? <SeatBody {...props} close={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function SeatBody({ entry: e, model, presetTable, close }: EntryDialogProps & { close: () => void }) {
  const { run, pending } = useAction()
  const [tables, setTables] = useState<number[]>(presetTable ? [presetTable] : [])
  const storedParty = e.partySize || 1
  const canOpenWalkIn = useCan("visit.walkin")
  const arrived = api.mode === "http" && e.kind === "WALK_IN"
  return (
    <>
      <DialogHeader>
        <DialogTitle>{arrived ? "Mở bàn cho khách đã đến" : "Gán giữ bàn cho khách"} · {e.displayName}</DialogTitle>
        <DialogDescription>{arrived ? "Xác nhận khách đang có mặt để mở bàn ngay." : "Hệ thống sẽ giữ bàn cho khách. Khách sẽ check-in sau từ booking."}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        <div className="grid gap-1.5 py-1">
          <Label>Số khách</Label>
          <div className="flex items-center justify-between rounded-xl border bg-surface-2 px-3.5 py-2.5 text-sm">
            <span className="font-semibold text-foreground">{storedParty} khách</span>
            <span className="text-xs text-muted-foreground">Đổi số khách cần sửa mục chờ trước</span>
          </div>
        </div>
        <TablePicker model={model} party={storedParty} value={tables} onChange={setTables} />
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={close}>
          Quay lại
        </Button>
        <Button
          disabled={pending || tables.length === 0 || (arrived && !canOpenWalkIn)}
          onClick={async () => {
            const r = await run((o) =>
              api.seatWaitlist({
                entryId: e.id,
                version: e.version,
                guestCount: storedParty,
                tableIds: tables,
                ...(arrived ? { arrived: true } : {}),
                overrideReason: o,
              }),
            )
            if (r) close()
          }}
        >
          {arrived ? "Xác nhận mở bàn" : "Xác nhận giữ bàn"}
        </Button>
      </DialogFooter>
    </>
  )
}

function AddWaitlistDialog({
  open,
  onOpenChange,
  model,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  model: FloorModel
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        {open ? <AddWaitlistBody model={model} close={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function AddWaitlistBody({ model, close }: { model: FloorModel; close: () => void }) {
  const bd = useBusinessDate()
  const waitlist = useWaitlist(bd)
  const reservations = useReservations(bd)
  const { run, pending } = useAction()
  const [kind, setKind] = useState<WaitlistKind>("WALK_IN")
  const [name, setName] = useState("")
  const [party, setParty] = useState(2)
  const [channel, setChannel] = useState<WaitlistChannel>("IN_PERSON")
  const [mode, setMode] = useState<WaitlistPreferenceMode>("ANY")
  const [zones, setZones] = useState<ZoneCode[]>([])
  const [tableId, setTableId] = useState("")
  const [resId, setResId] = useState("")
  const [note, setNote] = useState("")
  const activeResIds = useMemo(
    () =>
      new Set(
        (waitlist.data ?? []).filter((e) => ACTIVE.includes(e.status) && e.reservationId).map((e) => e.reservationId),
      ),
    [waitlist.data],
  )
  const candidates = (reservations.data ?? []).filter(
    (r) => r.status === "BOOKED" && r.tableIds.length === 0 && !r.waitlistEntryId && !activeResIds.has(r.id),
  )
  const prefs = [...(tableId ? [{ tableId: Number(tableId) }] : []), ...zones.map((z) => ({ zoneCode: z }))]
  const invalid = noteHasPhoneNumber(note) || noteHasPhoneNumber(name)
  const valid = kind === "WALK_IN" ? name.trim().length > 0 && party > 0 : !!resId
  // FX-04: 1 mã chống trùng cho lần mở form; đổi mã sau mỗi lần tạo thành công.
  const [idempotencyKey, renewIdempotencyKey] = useIdempotencyKey()
  return (
    <>
      <DialogHeader>
        <DialogTitle>Thêm khách chờ</DialogTitle>
        <DialogDescription>
          Khách chờ không được tự xếp chỗ. Nhân viên liên hệ, giữ bàn khi khách nhận, rồi xếp chỗ khi khách tới.
        </DialogDescription>
      </DialogHeader>
      <div className="grid max-h-[62dvh] scrollbar-thin gap-4 overflow-y-auto pr-1">
        <ToggleGroup
          type="single"
          variant="outline"
          value={kind}
          onValueChange={(v) => v && setKind(v as WaitlistKind)}
          className="w-full"
        >
          <ToggleGroupItem value="WALK_IN" className="flex-1">
            Walk-in chưa có bàn
          </ToggleGroupItem>
          <ToggleGroupItem value="ADVANCE_RESERVATION" className="flex-1">
            Đặt trước chưa có bàn
          </ToggleGroupItem>
        </ToggleGroup>
        {kind === "WALK_IN" ? (
          <>
            <div className="grid gap-1.5">
              <Label htmlFor="wl-name">Tên hoặc đặc điểm nhận dạng</Label>
              <Input
                id="wl-name"
                className="h-11"
                value={name}
                onChange={(ev) => setName(ev.target.value)}
                placeholder="Ví dụ: chị Lan, nhóm áo xanh"
              />
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <div className="grid gap-1.5">
                <Label>Số khách</Label>
                <Stepper value={party} onChange={setParty} label="số khách" />
              </div>
              <div className="grid min-w-[180px] flex-1 gap-1.5">
                <Label htmlFor="wl-channel">Liên hệ qua</Label>
                <Select value={channel} onValueChange={(v) => setChannel(v as WaitlistChannel)}>
                  <SelectTrigger id="wl-channel" className="h-11 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(WAITLIST_CHANNEL_LABEL) as WaitlistChannel[]).map((c) => (
                      <SelectItem key={c} value={c}>
                        {WAITLIST_CHANNEL_LABEL[c]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </>
        ) : (
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="wl-res">Booking chưa có bàn (tối nay)</Label>
              <Select value={resId} onValueChange={setResId}>
                <SelectTrigger id="wl-res" className="h-11 w-full">
                  <SelectValue placeholder="Chọn booking" />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((r) => (
                    <SelectItem key={r.id} value={String(r.id)}>
                      {fmtTime(r.expectedAt)} · {r.displayName} · {r.partySize} khách
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {candidates.length === 0 ? (
                <p className="text-xs text-muted-foreground">Không có booking nào đang chờ phân bàn.</p>
              ) : null}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="wl-channel-res">Liên hệ qua</Label>
              <Select value={channel} onValueChange={(v) => setChannel(v as WaitlistChannel)}>
                <SelectTrigger id="wl-channel-res" className="h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(WAITLIST_CHANNEL_LABEL) as WaitlistChannel[]).map((c) => (
                    <SelectItem key={c} value={c}>
                      {WAITLIST_CHANNEL_LABEL[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
        <WaitlistPreferencePicker
          mode={mode}
          setMode={setMode}
          zones={zones}
          setZones={setZones}
          tableId={tableId}
          setTableId={setTableId}
          zoneOptions={(model.catalog?.zones ?? [])
            .filter((z) => z.isBookable)
            .map((z) => ({ code: z.code, name: z.name }))}
          tables={model.tables.filter((t) => t.kind === "TABLE").map((t) => ({ id: t.id, code: t.code }))}
        />
        <div className="grid gap-1.5">
          <Label htmlFor="wl-note">Ghi chú</Label>
          <Textarea
            id="wl-note"
            rows={2}
            value={note}
            onChange={(ev) => setNote(ev.target.value)}
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
          disabled={pending || invalid || !valid || (mode !== "ANY" && prefs.length === 0)}
          onClick={async () => {
            const r = await run(() =>
              api.addWaitlist(
                kind === "WALK_IN"
                  ? {
                      kind,
                      contactName: name.trim(),
                      partySize: party,
                      channel,
                      preferenceMode: api.mode === "http" ? "ANY" : mode,
                      preferences: api.mode === "http" || mode === "ANY" ? [] : prefs,
                      note: note || undefined,
                      idempotencyKey,
                    }
                  : {
                      kind,
                      reservationId: Number(resId),
                      channel,
                      preferenceMode: api.mode === "http" ? "ANY" : mode,
                      preferences: api.mode === "http" || mode === "ANY" ? [] : prefs,
                      note: note || undefined,
                      idempotencyKey,
                    },
              ),
            )
            if (r) {
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

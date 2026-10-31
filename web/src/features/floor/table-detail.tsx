import {
  AlarmClock,
  Armchair,
  ArrowLeft,
  ArrowRightLeft,
  Ban,
  BadgeCheck,
  CalendarCheck,
  CalendarClock,
  CalendarPlus,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Combine,
  Crown,
  DoorOpen,
  Footprints,
  History,
  Hourglass,
  Info,
  ListOrdered,
  LogIn,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Phone,
  Split,
  StickyNote,
  Tag,
  TimerReset,
  TriangleAlert,
  UserPlus,
  Users,
  XCircle,
} from "lucide-react"
import { useMemo, useState } from "react"
import { useNavigate } from "react-router"
import {
  Fact,
  GroupSymbolIcon,
  GuardedButton,
  GuestAvatar,
  MaskedPhone,
  QuickCounts,
  SectionTitle,
  TableCodes,
} from "@/components/common"
import { ConfirmAction } from "@/components/dialogs"
import { StateChip } from "@/components/status"
import { STATE_META } from "@/components/status-meta"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  CLOSE_REASON_LABEL,
  HOLD_RELEASE_LABEL,
  ORIGIN_LABEL,
  RELEASE_REASON_LABEL,
  SOURCE_LABEL,
  type AllocationReleaseReason,
  type BookingSourceCode,
  type HoldReleaseReason,
  type VisitOrigin,
  type ReservationCloseReason,
} from "@/domain/enums"
import type { ClaimView, WaitlistEntryView } from "@/domain/models"
import { symbolByNo } from "@/domain/symbols"
import { useAction } from "@/hooks/use-action"
import { useNow, useTableHistory, useWaitlist } from "@/hooks/use-data"
import { fmtCountdown, fmtElapsed, fmtTime } from "@/lib/time"
import { cn } from "@/lib/utils"
import { api } from "@/services"
import { useCan } from "@/state/session"
import { useUi } from "@/state/ui"
import { toast } from "sonner"
import { ExtendHoldDialog, GuestCountDialog, SplitDialog } from "./floor-dialogs"
import type { FloorModel } from "./use-floor-model"

const CANCEL_REASONS = (Object.keys(CLOSE_REASON_LABEL) as ReservationCloseReason[])
  .filter((r) => r !== "NO_SHOW_CONFIRMED")
  .map((value) => ({ value, label: CLOSE_REASON_LABEL[value] }))

const HOLD_REASONS = (
  ["CUSTOMER_NO_SHOW", "CUSTOMER_CANCELLED", "STAFF_REASSIGNED", "ENTRY_ERROR", "OTHER"] as HoldReleaseReason[]
).map((value) => ({
  value,
  label: HOLD_RELEASE_LABEL[value],
}))

const TABLE_OOS_REASONS = [
  { value: "Bàn hỏng / bảo trì", label: "Bàn hỏng / bảo trì" },
  { value: "Sự cố khu vực / vệ sinh", label: "Sự cố khu vực / vệ sinh" },
  { value: "OTHER", label: "Khác" },
]

const TABLE_ACTIVE_REASONS = [
  { value: "Đã khắc phục xong sự cố", label: "Đã khắc phục xong sự cố" },
  { value: "Bảo trì hoàn tất", label: "Bảo trì hoàn tất" },
  { value: "OTHER", label: "Lý do khác" },
]

export function TableDetail({ tableId, model, onBack }: { tableId: number; model: FloorModel; onBack: () => void }) {
  const t = model.byId.get(tableId)
  const fs = model.states.get(tableId)
  const now = useNow(1000)
  const bd = model.floor?.businessDate ?? ""
  const history = useTableHistory(tableId, bd)
  const isOwner = useCan("venue.configure")
  const { run } = useAction()
  const [oosOpen, setOosOpen] = useState(false)
  const [activeOpen, setActiveOpen] = useState(false)

  if (!t) return null
  const state = fs?.state ?? "free"
  const claim = fs?.claim ?? null
  const zone = model.catalog?.zones.find((z) => z.id === t.zoneId)
  const title = t.kind === "BAR_SEAT" ? `Ghế Bar ${t.seqNo}` : `Bàn ${t.code}`

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-1 text-muted-foreground">
          <ArrowLeft /> Ca tối nay
        </Button>
        {isOwner ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Tùy chọn bàn">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {t.status === "ACTIVE" ? (
                <DropdownMenuItem
                  disabled={!!claim}
                  title={claim ? "Bàn đang có khách hoặc đang được giữ." : undefined}
                  onSelect={() => setOosOpen(true)}
                >
                  <Ban /> Ngưng phục vụ
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => setActiveOpen(true)}>
                  <Check /> Mở lại phục vụ
                </DropdownMenuItem>
              )}
              {t.kind === "TABLE" ? (
                <DropdownMenuItem
                  onSelect={() => run(() => api.setTableStatus(t.id, t.version, { isSpare: !t.isSpare }))}
                >
                  {t.isSpare ? "Bỏ đánh dấu sơ cua" : "Đánh dấu bàn sơ cua"}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 scrollbar-thin overflow-y-auto">
        <header className="flex items-start justify-between gap-3 px-4 pt-4 pb-4">
          <div className="min-w-0">
            <h2 className="text-[28px] leading-none font-extrabold tracking-tight">
              {t.kind === "BAR_SEAT" ? `Bar ${t.seqNo}` : t.code}
            </h2>
            <p className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="size-3.5 text-subtle" aria-hidden />
                {zone?.name}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Users className="size-3.5 text-subtle" aria-hidden />
                {t.capacity} chỗ
              </span>
              {t.isSpare ? <span className="rounded-md border border-dashed px-1.5 text-xs">sơ cua</span> : null}
              {zone?.isWaitingArea ? (
                <span className="rounded-md border border-dashed px-1.5 text-xs">khu chờ</span>
              ) : null}
            </p>
          </div>
          <StateChip state={state} />
        </header>

        <div className="grid gap-5 px-4 pb-6">
          {claim?.kind === "visit" ? <SeatedSection tableId={tableId} claim={claim} model={model} now={now} /> : null}
          {claim?.kind === "reservation" ? (
            <ReservationSection tableId={tableId} claim={claim} model={model} now={now} />
          ) : null}
          {claim?.kind === "waitlist_hold" ? (
            <HoldSection tableId={tableId} claim={claim} model={model} now={now} />
          ) : null}
          {!claim && (state === "free" || state === "spare") ? (
            <FreeSection
              tableId={tableId}
              model={model}
              title={title}
              waitingArea={!!zone?.isWaitingArea}
              spare={t.isSpare}
            />
          ) : null}
          {state === "oos" ? (
            <Note icon={Ban}>Ngưng phục vụ. {isOwner ? "Mở lại ở menu ⋯." : "Chủ quán mở lại được."}</Note>
          ) : null}

          <section className="grid gap-2.5">
            <SectionTitle>Lịch sử tối nay</SectionTitle>
            {history.isLoading ? (
              <Skeleton className="h-16" />
            ) : history.data && history.data.length ? (
              <ol className="grid gap-3">
                {history.data.map((h) => {
                  const Icon =
                    h.kind === "USAGE" ? Armchair : h.holdKind === "WAITLIST_OFFER" ? Hourglass : CalendarClock
                  const tone = h.kind === "USAGE" ? "seated" : "reserved"
                  return (
                    <li key={h.allocationId} className="flex gap-3">
                      <span
                        className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full"
                        style={
                          h.releasedAt
                            ? undefined
                            : { color: `var(--st-${tone}-ink)`, background: `var(--st-${tone}-tint)` }
                        }
                      >
                        <Icon className={cn("size-3.5", h.releasedAt && "text-subtle")} aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 text-sm">
                          <span className="tnum text-muted-foreground">{fmtTime(h.startsAt)}</span>
                          {h.symbolNo ? <GroupSymbolIcon no={h.symbolNo} size={11} /> : null}
                          <span className={cn("truncate", h.releasedAt && "text-muted-foreground")}>
                            {h.name}
                            {h.partySize ? ` · ${h.partySize}` : ""}
                          </span>
                        </span>
                        {h.releasedAt ? (
                          <span className="block text-xs text-subtle">
                            <span className="tnum">{fmtTime(h.releasedAt)}</span> ·{" "}
                            {RELEASE_REASON_LABEL[h.releaseReason as AllocationReleaseReason] ?? h.releaseReason}
                          </span>
                        ) : null}
                      </span>
                    </li>
                  )
                })}
              </ol>
            ) : (
              <p className="flex items-center gap-2 text-sm text-subtle">
                <History className="size-4" aria-hidden /> Chưa có lượt nào trong ca
              </p>
            )}
          </section>
        </div>
      </div>
      <ConfirmAction
        open={oosOpen}
        onOpenChange={setOosOpen}
        title={`Ngưng phục vụ ${title}?`}
        description="Bàn sẽ chuyển sang trạng thái ngưng phục vụ và không thể gán khách hoặc check-in. Thao tác được ghi vào nhật ký."
        confirmLabel="Ngưng phục vụ"
        destructive
        reasons={TABLE_OOS_REASONS}
        requireNoteFor="OTHER"
        onConfirm={async (reason, note) => {
          const formattedReason =
            reason === "OTHER" ? note.trim() : note.trim() ? `${reason}: ${note.trim()}` : (reason ?? "")
          if (!formattedReason) return
          await run(() =>
            api.setTableStatus(t.id, t.version, {
              status: "OUT_OF_SERVICE",
              reason: formattedReason,
            }),
          )
        }}
      />
      <ConfirmAction
        open={activeOpen}
        onOpenChange={setActiveOpen}
        title={`Mở lại phục vụ ${title}?`}
        description="Bàn sẽ chuyển sang trạng thái hoạt động bình thường và sẵn sàng phục vụ khách. Thao tác được ghi vào nhật ký."
        confirmLabel="Mở lại phục vụ"
        destructive={false}
        reasons={TABLE_ACTIVE_REASONS}
        requireNoteFor="OTHER"
        onConfirm={async (reason, note) => {
          const formattedReason =
            reason === "OTHER" ? note.trim() : note.trim() ? `${reason}: ${note.trim()}` : (reason ?? "")
          if (!formattedReason) return
          await run(() =>
            api.setTableStatus(t.id, t.version, {
              status: "ACTIVE",
              reason: formattedReason,
            }),
          )
        }}
      />
    </div>
  )
}

/* ---------------- sections ---------------- */

const ORIGIN_ICON: Record<VisitOrigin, typeof CalendarCheck> = {
  RESERVATION: CalendarCheck,
  WALK_IN: Footprints,
  WAITLIST: ListOrdered,
}

const SOURCE_ICON: Partial<Record<BookingSourceCode, typeof Phone>> = {
  HOTLINE: Phone,
  FANPAGE: MessageCircle,
  ZALO: MessageCircle,
  SOCIAL: MessageCircle,
  SHAREHOLDER: Crown,
  STAFF: BadgeCheck,
}

function Note({
  icon: Icon,
  children,
  tone,
}: {
  icon: typeof Info
  children: React.ReactNode
  tone?: "late" | "noshow"
}) {
  return (
    <p
      className={cn("flex gap-2.5 rounded-xl border p-3 text-sm", tone ? "" : "border-dashed text-muted-foreground")}
      style={
        tone
          ? {
              borderColor: `color-mix(in oklch, var(--st-${tone}) 45%, transparent)`,
              background: `var(--st-${tone}-tint)`,
            }
          : undefined
      }
    >
      <Icon
        className="mt-0.5 size-4 shrink-0"
        style={tone ? { color: `var(--st-${tone}-ink)` } : undefined}
        aria-hidden
      />
      <span className="min-w-0">{children}</span>
    </p>
  )
}

function ClaimCard({ claim, children, model }: { claim: ClaimView; children?: React.ReactNode; model: FloorModel }) {
  const sym = symbolByNo(claim.symbolNo)
  return (
    <div className="grid gap-4 rounded-2xl border bg-surface-1 p-4">
      <div className="flex items-center gap-3">
        <GuestAvatar name={claim.displayName} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold">{claim.displayName}</p>
          <MaskedPhone last3={claim.phoneLast3} />
        </div>
        <span
          className="tnum inline-flex h-9 items-center gap-1.5 rounded-full bg-surface-2 px-3 text-base font-semibold"
          aria-label={`${claim.partySize} khách`}
        >
          <Users className="size-4 text-muted-foreground" aria-hidden />
          {claim.partySize}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5 border-t pt-3.5">
        <Fact icon={Armchair} label="Bàn">
          <span title={sym ? `Ký hiệu ghép: ${sym.name}` : undefined}>
            <TableCodes codes={claim.tableIds.map((id) => model.label(id))} symbolNo={claim.symbolNo} />
          </span>
        </Fact>
        {children}
      </dl>
      {claim.note ? (
        <p className="flex gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted-foreground">
          <StickyNote className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden />
          {claim.note}
        </p>
      ) : null}
    </div>
  )
}

function usePickActions(_tableId: number, claim: ClaimView, model: FloorModel) {
  const ui = useUi()
  const { run } = useAction()
  const claimRef = claim.visitId
    ? { visitId: claim.visitId, version: claim.version }
    : claim.reservationId && claim.kind === "reservation"
      ? { reservationId: claim.reservationId, version: claim.version }
      : { waitlistEntryId: claim.waitlistEntryId ?? undefined, version: claim.version }
  const codes = claim.tableIds.map((id) => model.label(id)).join(" + ")
  return {
    move: () =>
      ui.startPick({
        intent: "move",
        title: `Đổi ${codes} sang bàn mới`,
        hint: `Chạm một hoặc nhiều bàn trống cho đoàn ${claim.partySize} khách. Lịch sử bàn cũ được giữ nguyên.`,
        multi: true,
        excludeIds: claim.tableIds,
        confirmLabel: "Đổi bàn",
        onConfirm: async (toIds) => {
          const targetCapacity = toIds.reduce((sum, id) => sum + (model.byId.get(id)?.capacity ?? 0), 0)
          if (targetCapacity < claim.partySize) {
            toast.error(
              `Các bàn đã chọn chỉ có ${targetCapacity} chỗ cho đoàn ${claim.partySize} khách. Chọn thêm bàn trước khi xác nhận.`,
            )
            return false
          }
          const r = await run((o) =>
            api.moveClaim({ claim: claimRef, tableIds: toIds, overrideReason: o }),
          )
          if (r && toIds.length) ui.selectTable(toIds[0])
          return !!r
        },
      }),
    combine: () =>
      ui.startPick({
        intent: "combine",
        title: `Ghép thêm bàn cho ${codes}`,
        hint: "Chạm các bàn trống liền kề. Cả nhóm sẽ dùng chung một ký hiệu.",
        multi: true,
        excludeIds: claim.tableIds,
        confirmLabel: "Ghép bàn",
        onConfirm: async (ids) =>
          !!(await run((o) =>
            api.combineTables({
              claim: claim.visitId
                ? { visitId: claim.visitId, version: claim.version }
                : { reservationId: claim.reservationId!, version: claim.version },
              addTableIds: ids,
              overrideReason: o,
            }),
          )),
      }),
  }
}

function SeatedSection({
  tableId,
  claim,
  model,
  now,
}: {
  tableId: number
  claim: ClaimView
  model: FloorModel
  now: Date
}) {
  const { run } = useAction()
  const pick = usePickActions(tableId, claim, model)
  const [splitOpen, setSplitOpen] = useState(false)
  const [endOpen, setEndOpen] = useState(false)
  const ui = useUi()
  const stale = model.states.get(tableId)?.staleFromPreviousDay
  return (
    <>
      <ClaimCard claim={claim} model={model}>
        <Fact icon={Clock3} label="Bắt đầu">
          <span className="tnum">{fmtTime(claim.startsAt)}</span>
          <span className="text-muted-foreground"> · {fmtElapsed(now.getTime() - claim.startsAt.getTime())}</span>
        </Fact>
        {claim.origin ? (
          <Fact icon={ORIGIN_ICON[claim.origin]} label="Nguồn">
            {ORIGIN_LABEL[claim.origin]}
          </Fact>
        ) : null}
        <Fact icon={CircleDollarSign} label="Thanh toán">
          <span className={claim.paid ? "text-st-seated-ink" : "text-muted-foreground"}>
            {claim.paid ? "Đã thanh toán" : "Chưa thanh toán"}
          </span>
        </Fact>
      </ClaimCard>
      {stale ? (
        <Note icon={TriangleAlert} tone="late">
          Chưa nhả từ ngày trước. Nhả bàn nếu khách đã rời.
        </Note>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <GuardedButton permission="visit.move" variant="outline" onClick={pick.move}>
          <ArrowRightLeft /> Đổi bàn
        </GuardedButton>
        <GuardedButton permission="visit.combine" variant="outline" onClick={pick.combine}>
          <Combine /> Ghép bàn
        </GuardedButton>
        {claim.groupId ? (
          <GuardedButton
            permission="visit.split"
            variant="outline"
            disabledReason={api.mode === "http" ? "Backend v1 chưa hỗ trợ tách nhóm bàn." : undefined}
            onClick={() => setSplitOpen(true)}
          >
            <Split /> Tách bàn
          </GuardedButton>
        ) : null}
        {!claim.paid ? (
          <GuardedButton
            permission="visit.mark_paid"
            variant="outline"
            disabledReason={api.mode === "http" ? "Backend v1 chưa hỗ trợ xác nhận thanh toán." : undefined}
            onClick={() => run(() => api.markPaid(claim.visitId!, claim.version))}
          >
            <CircleDollarSign /> Đã thanh toán
          </GuardedButton>
        ) : null}
        <GuardedButton
          permission="visit.end"
          variant="outline"
          className="col-span-2 border-destructive/50 text-destructive hover:bg-destructive/10"
          onClick={() => setEndOpen(true)}
        >
          <DoorOpen /> Nhả bàn (khách rời)
        </GuardedButton>
      </div>
      <SplitDialog
        open={splitOpen}
        onOpenChange={setSplitOpen}
        tables={claim.tableIds.map((id) => ({ id, label: model.label(id) }))}
        onConfirm={async (keep) => {
          const r = await run(() => api.splitGroup({ groupId: claim.groupId!, keepTableIds: keep }))
          if (r) setSplitOpen(false)
        }}
      />
      <ConfirmAction
        open={endOpen}
        onOpenChange={setEndOpen}
        title={`Nhả ${claim.tableIds.map((id) => model.label(id)).join(" + ")}?`}
        description={
          <>
            Kết thúc lượt ghé của <b className="text-foreground">{claim.displayName}</b> ({claim.partySize} khách). Bàn
            chuyển về trống. Có thể hoàn tác nếu chưa ai dùng bàn.
          </>
        }
        confirmLabel="Nhả bàn"
        onConfirm={async () => {
          const r = await run(() => api.endVisit(claim.visitId!, claim.version))
          if (r) ui.selectTable(null)
        }}
      />
    </>
  )
}

function ReservationSection({
  tableId,
  claim,
  model,
  now,
}: {
  tableId: number
  claim: ClaimView
  model: FloorModel
  now: Date
}) {
  const { run } = useAction()
  const pick = usePickActions(tableId, claim, model)
  const [checkInOpen, setCheckInOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [noShowOpen, setNoShowOpen] = useState(false)
  const ui = useUi()
  const venue = model.catalog?.venue
  const canNoShow = claim.minutesLate >= (venue?.noShowWarningMinutes ?? 30)
  const today = claim.startsAt.getTime() - now.getTime() < 12 * 3600_000
  return (
    <>
      <ClaimCard claim={claim} model={model}>
        <Fact icon={Clock3} label="Giờ đến">
          Hẹn <span className="tnum">{fmtTime(claim.startsAt)}</span>
        </Fact>
        {claim.sourceCode ? (
          <Fact icon={SOURCE_ICON[claim.sourceCode] ?? Tag} label="Nguồn">
            {SOURCE_LABEL[claim.sourceCode]}
          </Fact>
        ) : null}
      </ClaimCard>
      {claim.warning ? (
        <div role="status">
          <Note icon={AlarmClock} tone={claim.warning === "noshow" ? "noshow" : "late"}>
            <span
              className="font-semibold"
              style={{ color: STATE_META[claim.warning === "noshow" ? "noshow" : "late"].ink }}
            >
              {claim.warning === "noshow" ? "Chưa đến" : "Đến muộn"} · trễ {claim.minutesLate}'
            </span>
            <span className="block text-muted-foreground">Chỉ cảnh báo, bàn vẫn giữ.</span>
          </Note>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <GuardedButton
          permission="visit.checkin"
          size="lg"
          className="col-span-2"
          disabled={!today}
          aria-label={`Check-in ${claim.tableIds.map((id) => model.label(id)).join(" + ")}`}
          onClick={() => setCheckInOpen(true)}
        >
          <LogIn /> Check-in
        </GuardedButton>
        <GuardedButton permission="table.assign" variant="outline" onClick={pick.move}>
          <ArrowRightLeft /> Đổi bàn
        </GuardedButton>
        <GuardedButton permission="visit.combine" variant="outline" onClick={pick.combine}>
          <Combine /> Ghép bàn
        </GuardedButton>
        <GuardedButton permission="reservation.cancel" variant="outline" onClick={() => setCancelOpen(true)}>
          <XCircle /> Hủy booking
        </GuardedButton>
        <GuardedButton
          permission="reservation.mark_no_show"
          variant="outline"
          disabledReason={
            canNoShow ? null : `Chỉ bật sau ${venue?.noShowWarningMinutes ?? 30} phút trễ (chờ PO duyệt DR-05)`
          }
          onClick={() => setNoShowOpen(true)}
        >
          <TimerReset /> Không đến
        </GuardedButton>
      </div>
      <GuestCountDialog
        open={checkInOpen}
        onOpenChange={setCheckInOpen}
        title={`Check-in ${claim.displayName}`}
        description={
          <>
            Booking {fmtTime(claim.startsAt)} · {claim.partySize} khách ·{" "}
            {claim.tableIds.map((id) => model.label(id)).join(" + ")}
          </>
        }
        initial={claim.partySize}
        readOnly
        confirmLabel="Check-in"
        onConfirm={async () => {
          const r = await run(() =>
            api.checkIn({ reservationId: claim.reservationId!, version: claim.version, guestCount: claim.partySize }),
          )
          if (r) setCheckInOpen(false)
        }}
      />
      <ConfirmAction
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Hủy booking?"
        description={
          <>
            Booking của <b className="text-foreground">{claim.displayName}</b> lúc {fmtTime(claim.startsAt)}. Bàn đang
            giữ sẽ được nhả.
          </>
        }
        confirmLabel="Hủy booking"
        reasons={CANCEL_REASONS}
        requireNoteFor="OTHER"
        onConfirm={async (reason, note) => {
          const r = await run(() =>
            api.cancelReservation(claim.reservationId!, claim.version, reason as ReservationCloseReason, note),
          )
          if (r) ui.selectTable(null)
        }}
      />
      <ConfirmAction
        open={noShowOpen}
        onOpenChange={setNoShowOpen}
        title="Xác nhận khách không đến?"
        description={
          <>
            Đã trễ {claim.minutesLate} phút. Booking chuyển sang Không đến và bàn được nhả. Có thể hoàn tác nếu chưa ai
            dùng bàn.
          </>
        }
        confirmLabel="Xác nhận không đến"
        onConfirm={async () => {
          const r = await run(() => api.markNoShow(claim.reservationId!, claim.version))
          if (r) ui.selectTable(null)
        }}
      />
    </>
  )
}

function HoldSection({
  tableId,
  claim,
  model,
  now,
}: {
  tableId: number
  claim: ClaimView
  model: FloorModel
  now: Date
}) {
  const { run } = useAction()
  const pick = usePickActions(tableId, claim, model)
  const [seatOpen, setSeatOpen] = useState(false)
  const [extendOpen, setExtendOpen] = useState(false)
  const [releaseOpen, setReleaseOpen] = useState(false)
  const waitlist = useWaitlist(model.floor?.businessDate ?? "")
  const entry = waitlist.data?.find((e) => e.id === claim.waitlistEntryId)
  const ui = useUi()
  const overdue = !!claim.deadlineAt && now > claim.deadlineAt
  return (
    <>
      <ClaimCard claim={claim} model={model}>
        <Fact icon={Clock3} label="Khách xác nhận lúc">
          <span className="tnum">{fmtTime(claim.startsAt)}</span>
        </Fact>
        <Fact icon={Hourglass} label={overdue ? "Quá hạn giữ" : "Giữ đến"}>
          <span className={cn("tnum", overdue ? "text-st-late-ink" : "text-st-reserved-ink")}>
            {fmtTime(claim.deadlineAt)} ·{" "}
            {overdue
              ? `+${fmtElapsed(now.getTime() - claim.deadlineAt!.getTime())}`
              : fmtCountdown(claim.deadlineAt!.getTime() - now.getTime())}
          </span>
        </Fact>
      </ClaimCard>
      {overdue ? (
        <Note icon={Hourglass} tone="late">
          Quá hạn giữ. Bàn vẫn khóa tới khi xử lý.
        </Note>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <GuardedButton
          permission={entry?.kind === "ADVANCE_RESERVATION" ? "visit.checkin" : "visit.walkin"}
          size="lg"
          className="col-span-2"
          disabled={!entry}
          onClick={() => setSeatOpen(true)}
        >
          <Check /> Khách đã tới, xếp chỗ
        </GuardedButton>
        <GuardedButton
          permission="hold.set_deadline"
          variant="outline"
          disabledReason={api.mode === "http" ? "Backend v1 chưa hỗ trợ gia hạn giữ bàn." : undefined}
          onClick={() => setExtendOpen(true)}
        >
          <TimerReset /> Gia hạn
        </GuardedButton>
        <GuardedButton permission="table.assign" variant="outline" onClick={pick.move}>
          <ArrowRightLeft /> Đổi bàn
        </GuardedButton>
        <GuardedButton
          permission="hold.release"
          variant="outline"
          className="col-span-2"
          disabledReason={api.mode === "http" ? "Backend v1 chưa hỗ trợ nhả giữ bàn." : undefined}
          onClick={() => setReleaseOpen(true)}
        >
          <XCircle /> Nhả giữ bàn
        </GuardedButton>
      </div>
      <GuestCountDialog
        open={seatOpen}
        onOpenChange={setSeatOpen}
        title={`Xếp chỗ cho ${claim.displayName}`}
        description="Xác nhận khách đã có mặt và nhận bàn. Mục chờ sẽ đóng (Đã nhận bàn)."
        initial={claim.partySize || 1}
        confirmLabel="Xếp chỗ"
        onConfirm={async (count) => {
          if (!entry) return
          const r = await run(() => api.seatWaitlist({ entryId: entry.id, version: entry.version, guestCount: count }))
          if (r) setSeatOpen(false)
        }}
      />
      <ExtendHoldDialog
        open={extendOpen}
        onOpenChange={setExtendOpen}
        deadline={claim.deadlineAt ?? claim.startsAt}
        onConfirm={async (deadline, reason) => {
          const r = await run(() => api.setHoldDeadline(claim.holdId!, claim.version, deadline, reason))
          if (r) setExtendOpen(false)
        }}
      />
      <ConfirmAction
        open={releaseOpen}
        onOpenChange={setReleaseOpen}
        title="Nhả giữ bàn?"
        description={
          <>
            Bàn {claim.tableIds.map((id) => model.label(id)).join(" + ")} trở về trống. Khách quay lại danh sách chờ,
            trừ khi chọn lý do “Khách không đến”.
          </>
        }
        confirmLabel="Nhả giữ bàn"
        reasons={HOLD_REASONS}
        requireNoteFor="OTHER"
        onConfirm={async (reason, note) => {
          const r = await run(() => api.releaseHold(claim.holdId!, claim.version, reason as HoldReleaseReason, note))
          if (r) ui.selectTable(null)
        }}
      />
    </>
  )
}

function FreeSection({
  tableId,
  model,
  title,
  waitingArea,
  spare,
}: {
  tableId: number
  model: FloorModel
  title: string
  waitingArea: boolean
  spare: boolean
}) {
  const t = model.byId.get(tableId)!
  const [count, setCount] = useState(Math.min(t.capacity, 2))
  const [name, setName] = useState("")
  const { run, pending } = useAction()
  const ui = useUi()
  const navigate = useNavigate()
  const waitlist = useWaitlist(model.floor?.businessDate ?? "")
  const zoneCode = t.zoneCode
  const suggestions = useMemo(
    () => suggestFor(waitlist.data ?? [], tableId, zoneCode, t.capacity),
    [waitlist.data, tableId, zoneCode, t.capacity],
  )
  const [seatEntry, setSeatEntry] = useState<WaitlistEntryView | null>(null)

  if (waitingArea) {
    return <Note icon={Info}>Khu chờ, chưa nhận khách ngồi (chờ PO duyệt). Chủ quán đổi được trong Cài đặt.</Note>
  }

  return (
    <>
      {spare ? <Note icon={Info}>Bàn sơ cua: mở bàn cần Chủ quán duyệt.</Note> : null}
      <section className="grid gap-3.5 rounded-2xl border bg-surface-1 p-4" aria-labelledby="walkin-title">
        <h3 id="walkin-title" className="flex items-center gap-2 text-[15px] font-semibold">
          <UserPlus className="size-4 text-muted-foreground" aria-hidden /> Walk-in
        </h3>
        <QuickCounts value={count} onChange={setCount} options={t.kind === "BAR_SEAT" ? [1, 2] : [1, 2, 3, 4, 5, 6]} />
        <Input
          id="walkin-name"
          className="h-11"
          placeholder="Tên hoặc đặc điểm (tùy chọn)"
          aria-label="Tên hoặc đặc điểm khách (tùy chọn)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <GuardedButton
          permission="visit.walkin"
          size="lg"
          disabled={pending}
          aria-label={`Mở ${title} cho ${count} khách`}
          onClick={async () => {
            const r = await run((o) =>
              api.seatWalkIn({
                tableIds: [tableId],
                guestCount: count,
                contactName: name || undefined,
                overrideReason: o,
              }),
            )
            if (r) setName("")
          }}
        >
          Mở bàn · {count} khách
        </GuardedButton>
        {count > t.capacity ? (
          <p className="flex items-center gap-1.5 text-xs text-st-late-ink">
            <TriangleAlert className="size-3.5" aria-hidden /> Vượt {t.capacity} chỗ, cần Chủ quán duyệt
          </p>
        ) : null}
      </section>
      <GuardedButton
        permission="reservation.create"
        variant="outline"
        onClick={() => ui.openBooking({ tableIds: [tableId] })}
      >
        <CalendarPlus /> Đặt trước
      </GuardedButton>

      <section className="grid gap-2.5">
        <SectionTitle
          aside={
            <Button
              variant="link"
              size="sm"
              className="h-auto gap-0.5 p-0 text-xs font-normal text-muted-foreground"
              onClick={() => navigate("/waitlist")}
            >
              Tất cả <ChevronRight className="size-3.5" />
            </Button>
          }
        >
          Khách chờ phù hợp
        </SectionTitle>
        {suggestions.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-subtle">
            <ListOrdered className="size-4" aria-hidden /> Không có khách chờ phù hợp
          </p>
        ) : (
          <ul className="grid gap-2">
            {suggestions.map(({ entry, fits }) => {
              const KindIcon = entry.kind === "ADVANCE_RESERVATION" ? CalendarClock : Footprints
              return (
                <li key={entry.id} className="flex items-center gap-3 rounded-xl border px-3 py-2.5">
                  <span
                    className="tone grid size-8 shrink-0 place-items-center rounded-full"
                    style={{ ["--h" as string]: entry.kind === "ADVANCE_RESERVATION" ? 265 : 200 }}
                    title={entry.kind === "ADVANCE_RESERVATION" ? "Đặt trước" : "Walk-in"}
                  >
                    <KindIcon className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{entry.displayName}</p>
                    <p className="flex flex-wrap items-center gap-x-2.5 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Users className="size-3" aria-hidden />
                        {entry.partySize}
                      </span>
                      <span className="tnum inline-flex items-center gap-1">
                        <Clock3 className="size-3" aria-hidden />
                        {fmtTime(entry.queuedAt)}
                      </span>
                      {entry.reservationExpectedAt ? (
                        <span className="tnum inline-flex items-center gap-1">
                          <CalendarClock className="size-3" aria-hidden />
                          hẹn {fmtTime(entry.reservationExpectedAt)}
                        </span>
                      ) : null}
                      {!fits ? <span className="text-st-late-ink">thiếu chỗ</span> : null}
                    </p>
                  </div>
                  {entry.channel === "IN_PERSON" && entry.status !== "HOLD_ACTIVE" ? (
                    <GuardedButton
                      permission={entry.kind === "ADVANCE_RESERVATION" ? "visit.checkin" : "visit.walkin"}
                      size="sm"
                      variant="outline"
                      onClick={() => setSeatEntry(entry)}
                    >
                      Mời ngồi
                    </GuardedButton>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => navigate(`/waitlist?entry=${entry.id}&table=${tableId}`)}
                    >
                      <Phone /> Liên hệ
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        <p className="text-xs text-subtle">Chỉ gợi ý · khách đặt trước được ưu tiên hơn Walk-in</p>
      </section>
      <GuestCountDialog
        open={!!seatEntry}
        onOpenChange={(o) => !o && setSeatEntry(null)}
        title={`Xếp ${seatEntry?.displayName ?? ""} vào ${title}`}
        description="Chỉ xác nhận khi khách đang có mặt và đồng ý nhận bàn này."
        initial={seatEntry?.partySize ?? 1}
        confirmLabel="Khách đã nhận bàn"
        onConfirm={async (count) => {
          if (!seatEntry) return
          const r = await run((o) =>
            api.seatWaitlist({
              entryId: seatEntry.id,
              version: seatEntry.version,
              guestCount: count,
              tableIds: [tableId],
              overrideReason: o,
            }),
          )
          if (r) setSeatEntry(null)
        }}
      />
    </>
  )
}

function suggestFor(entries: WaitlistEntryView[], tableId: number, zone: string, capacity: number) {
  return entries
    .filter((e) => ["WAITING", "CONTACTING", "OFFERED"].includes(e.status))
    .filter((e) => {
      if (e.preferenceMode !== "PREFERRED_ONLY") return true
      return e.preferences.some((p) => p.tableId === tableId || p.zoneCode === zone)
    })
    .map((e) => ({ entry: e, fits: e.partySize <= capacity }))
    .sort((a, b) => {
      if (b.fits !== a.fits) return Number(b.fits) - Number(a.fits)
      if (a.entry.kind !== b.entry.kind) return a.entry.kind === "ADVANCE_RESERVATION" ? -1 : 1
      return a.entry.queuedAt.getTime() - b.entry.queuedAt.getTime()
    })
    .slice(0, 4)
}

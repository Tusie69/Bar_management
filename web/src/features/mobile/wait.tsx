import { ChevronLeft } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { PREFERENCE_MODE_LABEL, WAITLIST_STATUS_LABEL } from "@/domain/enums"
import type { TableView, WaitlistEntryView } from "@/domain/models"
import { useAction } from "@/hooks/use-action"
import { useWaitlist } from "@/hooks/use-data"
import { fmtTime, MS, type BusinessDate } from "@/lib/time"
import { cn } from "@/lib/utils"
import { api, isApiError } from "@/services"
import { useCan, useSession } from "@/state/session"
import type { FloorModel } from "../floor/use-floor-model"
import { assignWaitlistTables } from "../waitlist/assign-waitlist"
import { CallCustomerControl } from "../bookings/call-customer"
import { useMobileActions } from "./actions"
import { useM } from "./context"
import { codesOf, isOpenEntry, type Tone, toneStyle } from "./model"
import { card, CardSkeleton, EmptyBox, PlainHeader, Seg, useKeepScroll } from "./ui"

type Kind = "all" | "ADVANCE_RESERVATION" | "WALK_IN"

export function WaitScreen({ embedded = false }: { embedded?: boolean }) {
  const m = useM()
  const [kind, setKind] = useState<Kind>("all")
  const ref = useKeepScroll("wait")
  const all = useMemo(
    () =>
      [...(m.waitlist ?? [])].sort(
        (a, b) =>
          Number(isOpenEntry(b)) - Number(isOpenEntry(a)) ||
          (a.kind === b.kind ? a.queuedAt.getTime() - b.queuedAt.getTime() : a.kind === "ADVANCE_RESERVATION" ? -1 : 1),
      ),
    [m.waitlist],
  )
  const shown = all.filter((e) => kind === "all" || e.kind === kind)
  const kindFilter = (
    <Seg
      small
      label="Loại chờ"
      value={kind}
      onChange={setKind}
      opts={[
        ["all", `Tất cả ${all.length}`],
        ["ADVANCE_RESERVATION", "Đặt trước"],
        ["WALK_IN", "Walk-in"],
      ]}
    />
  )
  const body = (
    <>
      {embedded ? <div className="px-4 pb-3">{kindFilter}</div> : m.toastBanner}
      <div ref={ref} className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4 pt-1 pb-6">
        {m.waitlistError ? (
          <EmptyBox
            title="Lỗi tải danh sách chờ"
            body={
              isApiError(m.waitlistError)
                ? m.waitlistError.message
                : m.waitlistError instanceof Error
                  ? m.waitlistError.message
                  : "Không thể tải danh sách chờ."
            }
          />
        ) : !m.waitlist ? (
          <CardSkeleton n={2} />
        ) : shown.length ? (
          shown.map((e) => <WaitCard key={e.id} e={e} />)
        ) : (
          <EmptyBox
            title="Không có khách đang chờ"
            body="Booking chưa xếp bàn và khách Walk-in chưa có bàn sẽ hiện ở đây."
          />
        )}
      </div>
      {embedded ? (
        <div className="gm-glass-chrome grid shrink-0 grid-cols-[2fr_1fr] gap-2 border-t border-border/70 bg-surface-1/95 px-4 pt-3 pb-[calc(12px+var(--bottom-safe))] backdrop-blur-md">
          <Button
            type="button"
            size="lg"
            onClick={() => m.openForm({ mode: "booking", tableIds: [], toWaitlist: true })}
            className="h-12 rounded-xl text-[15px] font-semibold"
          >
            Nhận booking
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={() => m.openForm({ mode: "walkin", tableIds: [] })}
            className="h-12 rounded-xl border-border-strong text-[15px] font-semibold"
          >
            Walk-in
          </Button>
        </div>
      ) : null}
    </>
  )
  return embedded ? (
    body
  ) : (
    <>
      <PlainHeader title="Đơn chờ">
        <div className="pt-2 pb-3">{kindFilter}</div>
      </PlainHeader>
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">{body}</main>
    </>
  )
}

const TONE: Partial<Record<WaitlistEntryView["status"], Tone>> = {
  WAITING: "reserved",
  CONTACTING: "late",
  OFFERED: "late",
  HOLD_ACTIVE: "late",
  SEATED: "seated",
}

/** Smallest free table that fits, respecting "Chỉ chỗ đã chọn". */
function bestFit(e: WaitlistEntryView, model: FloorModel): TableView | null {
  const party = e.partySize || 1
  const only = e.preferenceMode === "PREFERRED_ONLY" ? e.preferences : null
  return (
    model.tables
      .filter((t) => t.kind === "TABLE" && t.capacity >= party && model.freeIds.has(t.id))
      .filter((t) => model.states.get(t.id)?.state === "free")
      .filter((t) => !only || only.some((p) => p.tableId === t.id || p.zoneCode === t.zoneCode))
      .sort((a, b) => a.capacity - b.capacity || a.code.localeCompare(b.code))[0] ?? null
  )
}

export function WaitCard({ e }: { e: WaitlistEntryView }) {
  const m = useM()
  const me = useSession((s) => s.user.id)
  const { run, pending } = useAction()
  const fit = e.status === "WAITING" ? bestFit(e, m.model) : null
  const party = e.partySize || 1
  const tone = TONE[e.status] ?? null
  const closed = !isOpenEntry(e)

  const time =
    e.kind === "WALK_IN"
      ? `đến ${fmtTime(e.queuedAt)}, chờ ${Math.max(0, Math.floor((m.now.getTime() - e.queuedAt.getTime()) / MS.MIN))} phút`
      : e.reservationExpectedAt
        ? `hẹn ${fmtTime(e.reservationExpectedAt)}`
        : ""
  const pref = e.preferences.length
    ? e.preferences.map((p) => p.label).join(", ")
    : e.preferenceMode
      ? PREFERENCE_MODE_LABEL[e.preferenceMode]
      : null

  const linkedRes = m.reservations?.find((r) =>
    e.reservationId ? r.id === e.reservationId : r.waitlistEntryId === e.id,
  )
  const tableCodes = e.hold?.tableIds
    ? codesOf(e.hold.tableIds, m.model)
    : linkedRes?.tableIds.length
      ? codesOf(linkedRes.tableIds, m.model)
      : ""

  const fitText =
    e.status === "SEATED"
      ? "Đã nhận bàn"
      : e.status === "HOLD_ACTIVE"
        ? tableCodes
          ? `Đang giữ ${tableCodes}`
          : "Đang giữ bàn"
        : closed
          ? "Đã rời danh sách"
          : fit
            ? `Gợi ý: bàn ${fit.code} đang trống, vừa ${party} khách`
            : e.kind === "ADVANCE_RESERVATION"
              ? "Đã đặt trước nhưng chưa có bàn"
              : `Chưa có bàn trống cho ${party} khách`

  const canAssign = useCan("table.assign")
  const canClaim = useCan("waitlist.claim")
  const canCancel = useCan("waitlist.cancel")
  const canOpenWalkIn = useCan("visit.walkin")
  const arrived = api.mode === "http" && e.kind === "WALK_IN"
  const canAct = api.mode === "http" ? canAssign && (!arrived || canOpenWalkIn) : canClaim

  const cancel = () => a.cancelEntry(e)
  // R9: Chuyển bàn -> chạm bàn -> xác nhận. Present Walk-ins open a Visit; advance reservations hold tables.
  const transfer = () => {
    const expected = e.kind === "ADVANCE_RESERVATION" ? e.reservationExpectedAt : null
    m.startPick({
      title: `Chuyển ${e.displayName} vào bàn`,
      hint: `Chạm bàn trống cho ${party} khách. Chạm lại để bỏ chọn.`,
      multi: true,
      targetParty: party,
      ...(expected
        ? {
            targetDate: e.businessDate,
            targetTime: fmtTime(expected),
            targetExpectedAt: expected,
          }
        : {}),
      confirmLabel: arrived ? "Xác nhận mở bàn" : "Xác nhận chuyển bàn",
      question: (codes) =>
        arrived ? `Mở bàn ${codes} cho ${e.displayName}?` : `Chuyển ${e.displayName} vào ${codes}?`,
      onConfirm: async (ids) => {
        const kinds = new Set(ids.map((id) => m.model.byId.get(id)?.kind).filter(Boolean))
        if (kinds.size > 1) {
          toast.error("Không thể ghép bàn thường với ghế Bar.")
          return false
        }
        return !!(await run((o) => assignWaitlistTables(e, ids, o)))
      },
    })
  }

  const a = useMobileActions()
  const isHoldActive = e.status === "HOLD_ACTIVE"
  const hold = a.heldPolicy(e, linkedRes)
  const canArrival = hold.canArrival
  const canReassign = hold.canReassign
  const canChangeStatus = linkedRes
    ? hold.canBookingStatus && (m.can("reservation.cancel") || m.can("reservation.update"))
    : canCancel
  const arrival = () => a.arrival({ entry: e, reservation: linkedRes, partySize: party, tableCodes })
  const reassign = () => a.reassignHold(e, linkedRes)

  const changeStatus = () => {
    if (linkedRes) {
      m.openStatus(linkedRes)
      return
    }
    cancel()
  }

  let primary: { label: string; go?: () => void } | null = null
  let secondary: { label: string; go: () => void } | null = null
  if (e.status === "WAITING") {
    primary = { label: "Chuyển bàn", go: canAct ? transfer : undefined }
    secondary = canCancel ? { label: "Hủy", go: cancel } : null
  } else if (e.status === "CONTACTING" || e.status === "OFFERED") {
    primary = {
      label: "Ghi kết quả liên hệ",
      go: () => toast.info("Ghi kết quả liên hệ trên Tablet hoặc Desktop ở V1"),
    }
    if (e.claimedBy?.userId === me && api.mode !== "http")
      secondary = {
        label: "Nhả liên hệ",
        go: () => void run(() => api.releaseClaim(e.id, e.version), { silent: true }),
      }
  }

  return (
    <div className={cn(card, "flex flex-col gap-2.5 p-4", closed && "opacity-65")}>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[16px] font-semibold tracking-[-0.01em] text-tx-strong">
          {e.displayName}
        </span>
        <span className="shrink-0 rounded-full px-2.5 py-0.5 text-xs leading-5 font-semibold" style={toneStyle(tone)}>
          {WAITLIST_STATUS_LABEL[e.status]}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] text-tx-2">
        <span className="rounded-full border border-border-strong bg-surface-2 px-2.5 py-0.5 text-xs font-medium text-tx-2">
          {e.kind === "WALK_IN" ? "Walk-in" : "Đặt trước"}
        </span>
        <span className="tnum font-medium">{party} khách</span>
        {time ? <span className="tnum text-[var(--text-muted)]">{time}</span> : null}
        {pref ? <span className="text-subtle">{pref}</span> : null}
      </div>
      <span
        className={cn("text-[13px] font-medium", fit && "rounded-lg bg-st-seated-tint px-2.5 py-1.5")}
        style={{ color: fit ? "var(--st-seated-ink)" : "var(--text-muted)" }}
      >
        {fitText}
      </span>
      {isHoldActive ? (
        <div className="flex flex-col gap-2 pt-0.5">
          <Button
            type="button"
            onClick={arrival}
            disabled={pending || !canArrival}
            title={!canArrival && !hold.supported ? "Chưa hỗ trợ" : undefined}
            className="h-11 w-full rounded-xl text-[14px] font-semibold"
          >
            Khách đã đến
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() =>
                linkedRes ? m.openDetail(linkedRes.id, e.businessDate) : m.openEntryDetail(e.id, e.businessDate)
              }
              disabled={pending}
              className="gm-press h-11 rounded-xl border border-border-strong bg-surface-2 px-2.5 text-center text-[13px] font-semibold text-tx-1 hover:bg-surface-3 disabled:opacity-45"
            >
              Quản lý đơn
            </button>
            <button
              type="button"
              onClick={reassign}
              disabled={pending || !canReassign}
              title={!canReassign && !hold.supported ? "Chưa hỗ trợ" : undefined}
              className="gm-press h-11 rounded-xl border border-border-strong bg-surface-2 px-2.5 text-center text-[13px] font-semibold text-tx-1 hover:bg-surface-3 disabled:pointer-events-none disabled:opacity-45"
            >
              Đổi / Ghép bàn
            </button>
            <button
              type="button"
              onClick={changeStatus}
              disabled={pending || !canChangeStatus}
              className="gm-press h-11 rounded-xl border border-border-strong bg-surface-2 px-2.5 text-center text-[13px] font-semibold text-tx-1 hover:bg-surface-3 disabled:pointer-events-none disabled:opacity-45"
            >
              Đổi trạng thái
            </button>
            {linkedRes ? (
              (() => {
                const canEdit = m.can("reservation.update") && linkedRes.status === "BOOKED"
                return (
                  <button
                    type="button"
                    onClick={() =>
                      canEdit
                        ? m.openBookingEdit(linkedRes.id, e.businessDate)
                        : m.openDetail(linkedRes.id, e.businessDate)
                    }
                    disabled={pending}
                    className="gm-press h-11 rounded-xl border border-border-strong bg-surface-2 px-2.5 text-center text-[13px] font-semibold text-tx-1 hover:bg-surface-3 disabled:opacity-45"
                  >
                    {canEdit ? "Sửa booking" : "Xem booking"}
                  </button>
                )
              })()
            ) : (
              <button
                type="button"
                onClick={() => m.openEntryDetail(e.id, e.businessDate)}
                disabled={pending}
                className="gm-press h-11 rounded-xl border border-border-strong bg-surface-2 px-2.5 text-center text-[13px] font-semibold text-tx-1 hover:bg-surface-3 disabled:opacity-45"
              >
                Xem đơn chờ
              </button>
            )}
            {linkedRes ? (
              <button
                type="button"
                onClick={() => m.openEntryDetail(e.id, e.businessDate)}
                disabled={pending}
                className="gm-press col-span-2 h-11 rounded-xl border border-border-strong bg-surface-2 px-2.5 text-center text-[13px] font-semibold text-tx-1 hover:bg-surface-3 disabled:opacity-45"
              >
                Xem đơn chờ
              </button>
            ) : null}
          </div>
        </div>
      ) : primary ? (
        <div className="flex gap-2 pt-0.5">
          <Button
            type="button"
            variant={primary.go ? "default" : "outline"}
            onClick={primary.go}
            disabled={!primary.go || pending}
            className={cn(
              "h-11 flex-1 rounded-xl text-[14px] font-semibold",
              !primary.go && "border-border text-[var(--text-muted)] opacity-60",
            )}
          >
            {primary.label}
          </Button>
          {secondary ? (
            <Button
              type="button"
              variant="outline"
              onClick={secondary.go}
              disabled={pending}
              className="h-11 shrink-0 rounded-xl border-border-strong px-4 text-[14px] font-medium"
            >
              {secondary.label}
            </Button>
          ) : null}
        </div>
      ) : null}
      {/* Khách chờ gắn booking gọi trực tiếp; đơn chờ thuần chưa hỗ trợ log cuộc gọi. */}
      {closed ? null : (
        <CallCustomerControl
          target={e.reservationId ? { kind: "booking", id: e.reservationId } : { kind: "waitlist", id: e.id }}
          canCall={e.phoneLast3 !== null}
          label="Gọi khách chờ"
          className="w-full"
        />
      )}
    </div>
  )
}

export function EntryDetailScreen({
  id,
  bd,
  backLabel,
  onClose,
}: {
  id: number
  bd: BusinessDate
  backLabel: string
  onClose: () => void
}) {
  const m = useM()
  const a = useMobileActions()
  const canCancel = useCan("waitlist.cancel")
  const pending = a.pending
  const waitlist = useWaitlist(bd).data
  const e = waitlist?.find((x) => x.id === id)
  const linkedRes = m.reservations?.find((r) =>
    e?.reservationId ? r.id === e.reservationId : r.waitlistEntryId === e?.id,
  )
  const tableCodes = e?.hold?.tableIds
    ? codesOf(e.hold.tableIds, m.model)
    : linkedRes?.tableIds.length
      ? codesOf(linkedRes.tableIds, m.model)
      : ""
  const party = e?.partySize ?? 1

  const header = (
    <header className="gm-glass-chrome shrink-0 border-b border-border/70 bg-[var(--glass-chrome)] px-4 pt-[var(--top-safe)] pb-2 backdrop-blur-md">
      <div className="-ml-2 flex h-12 items-center gap-1.5">
        <button
          type="button"
          onClick={onClose}
          aria-label="Quay lại"
          className="gm-press grid size-11 shrink-0 place-items-center rounded-xl text-tx-1 hover:bg-surface-2"
        >
          <ChevronLeft className="size-[22px]" aria-hidden />
        </button>
        <span className="min-w-0 truncate text-[15px] font-semibold text-tx-2">{backLabel}</span>
      </div>
    </header>
  )

  if (!e) {
    return (
      <div className="flex h-full w-full flex-col bg-background">
        {header}
        <div className="p-4">
          {waitlist ? (
            <EmptyBox title="Không tìm thấy mục chờ" body="Mục chờ có thể đã được chuyển hoặc hủy." />
          ) : (
            <p className="text-[14px] text-[var(--text-muted)]">Đang tải...</p>
          )}
        </div>
      </div>
    )
  }

  const hold = a.heldPolicy(e, linkedRes)
  const canArrival = hold.canArrival
  const canReassign = hold.canReassign
  const canChangeStatus = linkedRes
    ? hold.canBookingStatus && (m.can("reservation.cancel") || m.can("reservation.update"))
    : canCancel
  const arrival = () => a.arrival({ entry: e, reservation: linkedRes, partySize: party, tableCodes })
  const reassign = () => a.reassignHold(e, linkedRes)

  const changeStatus = () => {
    if (linkedRes) {
      m.openStatus(linkedRes)
      return
    }
    a.cancelEntry(e)
  }

  const pref = e.preferences.length
    ? e.preferences.map((p) => p.label).join(", ")
    : e.preferenceMode
      ? PREFERENCE_MODE_LABEL[e.preferenceMode]
      : null

  return (
    <div className="flex h-full w-full flex-col bg-background">
      {header}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pt-3.5 pb-6">
        <div className="flex flex-col gap-2 rounded-2xl border border-border bg-surface-1 p-4 shadow-[var(--shadow-soft)]">
          <div className="flex items-start gap-2.5">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-[21px] leading-tight font-bold tracking-[-0.02em] text-tx-strong">
                {e.displayName}
              </span>
              <span className="tnum text-[14px] font-medium text-tx-2">
                {e.kind === "WALK_IN" ? "Walk-in" : "Đặt trước"}, {party} khách
                {tableCodes ? `, Đang giữ ${tableCodes}` : ""}
              </span>
            </div>
            <span
              className="shrink-0 rounded-full px-2.5 py-0.5 text-xs leading-5 font-semibold"
              style={toneStyle(TONE[e.status] ?? null)}
            >
              {WAITLIST_STATUS_LABEL[e.status]}
            </span>
          </div>
        </div>

        <section className="flex flex-col gap-1.5">
          <h2 className="eyebrow m-0 px-1">Thông tin mục chờ</h2>
          <div className={cn(card, "flex flex-col divide-y divide-border overflow-hidden")}>
            <div className="flex min-h-12 items-center gap-3 px-4 py-2.5">
              <span className="w-[118px] shrink-0 text-[13px] font-medium text-[var(--text-muted)]">Hình thức</span>
              <span className="min-w-0 flex-1 text-[14px] text-tx-1">
                {e.kind === "WALK_IN" ? "Walk-in" : "Đặt trước"}
              </span>
            </div>
            <div className="flex min-h-12 items-center gap-3 px-4 py-2.5">
              <span className="w-[118px] shrink-0 text-[13px] font-medium text-[var(--text-muted)]">Số khách</span>
              <span className="tnum min-w-0 flex-1 text-[14px] text-tx-1">{party} khách</span>
            </div>
            {tableCodes ? (
              <div className="flex min-h-12 items-center gap-3 px-4 py-2.5">
                <span className="w-[118px] shrink-0 text-[13px] font-medium text-[var(--text-muted)]">
                  Bàn đang giữ
                </span>
                <span className="min-w-0 flex-1 text-[14px] font-medium text-tx-strong">{tableCodes}</span>
              </div>
            ) : null}
            {pref ? (
              <div className="flex min-h-12 items-center gap-3 px-4 py-2.5">
                <span className="w-[118px] shrink-0 text-[13px] font-medium text-[var(--text-muted)]">
                  Khu vực ưu tiên
                </span>
                <span className="min-w-0 flex-1 text-[14px] text-tx-1">{pref}</span>
              </div>
            ) : null}
            {e.note ? (
              <div className="flex min-h-12 items-center gap-3 px-4 py-2.5">
                <span className="w-[118px] shrink-0 text-[13px] font-medium text-[var(--text-muted)]">Ghi chú</span>
                <span className="min-w-0 flex-1 text-[14px] text-pretty text-tx-1">{e.note}</span>
              </div>
            ) : null}
            {linkedRes
              ? (() => {
                  const canEdit = m.can("reservation.update") && linkedRes.status === "BOOKED"
                  return (
                    <div className="flex min-h-12 items-center gap-3 px-4 py-2.5">
                      <span className="w-[118px] shrink-0 text-[13px] font-medium text-[var(--text-muted)]">
                        Booking liên kết
                      </span>
                      <span className="tnum min-w-0 flex-1 text-[14px] text-tx-1">#{linkedRes.id}</span>
                      <button
                        type="button"
                        onClick={() => {
                          if (canEdit) {
                            m.openBookingEdit(linkedRes.id, bd)
                          } else {
                            onClose()
                            m.openDetail(linkedRes.id, bd)
                          }
                        }}
                        className="gm-press inline-flex h-11 shrink-0 items-center rounded-xl border border-border-strong bg-surface-1 px-3.5 text-[13px] font-semibold text-primary-ink hover:bg-primary-tint"
                      >
                        {canEdit ? "Sửa booking" : "Xem booking"}
                      </button>
                    </div>
                  )
                })()
              : null}
          </div>
        </section>
      </div>

      {e.status === "HOLD_ACTIVE" ? (
        <footer className="gm-glass-chrome flex shrink-0 flex-col gap-2 border-t border-border/70 bg-surface-1/95 px-4 pt-3 pb-[calc(12px+var(--bottom-safe))] backdrop-blur-md">
          <Button
            type="button"
            size="lg"
            onClick={arrival}
            disabled={pending || !canArrival}
            title={!canArrival && !hold.supported ? "Chưa hỗ trợ" : undefined}
            className="h-12 w-full rounded-xl text-[15px] font-semibold"
          >
            Khách đã đến
          </Button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={reassign}
              disabled={pending || !canReassign}
              title={!canReassign && !hold.supported ? "Chưa hỗ trợ" : undefined}
              className="gm-press h-11 flex-1 rounded-xl border border-border-strong bg-surface-1 text-[14px] font-semibold text-tx-1 hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-45"
            >
              Đổi / Ghép bàn
            </button>
            <button
              type="button"
              onClick={changeStatus}
              disabled={pending || !canChangeStatus}
              className="gm-press h-11 flex-1 rounded-xl border border-border-strong bg-surface-1 text-[14px] font-semibold text-tx-1 hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-45"
            >
              Đổi trạng thái
            </button>
          </div>
        </footer>
      ) : null}
    </div>
  )
}

import { useMemo, useState } from "react"
import { toast } from "sonner"
import { PREFERENCE_MODE_LABEL, WAITLIST_STATUS_LABEL } from "@/domain/enums"
import type { TableView, WaitlistEntryView } from "@/domain/models"
import { useAction } from "@/hooks/use-action"
import { fmtTime12, MS } from "@/lib/time"
import { cn } from "@/lib/utils"
import { api, isApiError } from "@/services"
import { useCan, useSession } from "@/state/session"
import type { FloorModel } from "../floor/use-floor-model"
import { useM } from "./context"
import { codesOf, isOpenEntry, type Tone, toneStyle } from "./model"
import { card, CardSkeleton, EmptyBox, PlainHeader, Seg, useKeepScroll } from "./ui"

type Kind = "all" | "ADVANCE_RESERVATION" | "WALK_IN"

export function WaitScreen() {
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
  return (
    <>
      <PlainHeader title="Đơn chờ">
        <div className="pt-1 pb-3">
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
        </div>
      </PlainHeader>
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
          <EmptyBox title="Không có khách đang chờ" body="Khách walk-in chưa có bàn sẽ hiện ở đây." />
        )}
      </div>
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
  const canCheckin = useCan("visit.checkin")
  const { run, pending } = useAction()
  const fit = e.status === "WAITING" ? bestFit(e, m.model) : null
  const party = e.partySize || 1
  const tone = TONE[e.status] ?? null
  const closed = !isOpenEntry(e)

  const time =
    e.kind === "WALK_IN"
      ? `đến ${fmtTime12(e.queuedAt)}, chờ ${Math.max(0, Math.floor((m.now.getTime() - e.queuedAt.getTime()) / MS.MIN))} phút`
      : e.reservationExpectedAt
        ? `hẹn ${fmtTime12(e.reservationExpectedAt)}`
        : ""
  const pref = e.preferences.length
    ? e.preferences.map((p) => p.label).join(", ")
    : e.preferenceMode
      ? PREFERENCE_MODE_LABEL[e.preferenceMode]
      : null

  const linkedRes = m.reservations?.find((r) => (e.reservationId ? r.id === e.reservationId : r.waitlistEntryId === e.id))
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
            ? `Bàn ${fit.code} đang trống, vừa ${party} khách`
            : e.kind === "ADVANCE_RESERVATION"
              ? "Đã đặt trước nhưng chưa có bàn"
              : `Chưa có bàn trống cho ${party} khách`

  const canAssign = useCan("table.assign")
  const canClaim = useCan("waitlist.claim")
  const canCancel = useCan("waitlist.cancel")
  const canAct = api.mode === "http" ? canAssign : canClaim

  const cancel = () =>
    m.ask({
      title: `Hủy mục chờ của ${e.displayName}?`,
      body: "Khách rời khỏi danh sách chờ. Thao tác được ghi vào nhật ký.",
      label: "Hủy mục chờ",
      run: () => run(() => api.cancelWaitlist(e.id, e.version, "CUSTOMER_WITHDREW")),
    })
  // Offer = in HTTP, direct table assignment via seatWaitlist; in mock, claim + recordContact with offeredTableIds.
  const offer = (t: TableView) =>
    api.mode === "http"
      ? run((o) =>
          api.seatWaitlist({
            entryId: e.id,
            version: e.version,
            guestCount: party,
            tableIds: [t.id],
            overrideReason: o,
          }),
        )
      : run(async (o) => {
          if (!o) await api.claimWaitlist(e.id, e.version)
          const fresh = (await api.listWaitlist(e.businessDate)).find((x) => x.id === e.id) ?? e
          return api.recordContact({
            entryId: e.id,
            version: fresh.version,
            channel: "IN_PERSON",
            outcome: "ACCEPTED",
            offeredTableIds: [t.id],
            overrideReason: o,
          })
        })

  let primary: { label: string; go?: () => void } | null = null
  let secondary: { label: string; go: () => void } | null = null
  if (e.status === "WAITING") {
    primary = fit
      ? { label: `Đề nghị bàn ${fit.code}`, go: canAct ? () => void offer(fit) : undefined }
      : { label: "Chưa có bàn phù hợp" }
    secondary = canCancel ? { label: "Hủy", go: cancel } : null
  } else if (e.status === "HOLD_ACTIVE") {
    primary = canCheckin
      ? {
          label: "Khách nhận bàn (check-in)",
          go: () =>
            void run(async (o) => {
              const list = await api.listReservations({ businessDate: e.businessDate })
              let res = list.find((r) => (e.reservationId ? r.id === e.reservationId : r.waitlistEntryId === e.id))
              if (!res && e.hold && !e.reservationId) {
                const assigned = await api.seatWaitlist({
                  entryId: e.id,
                  version: e.version,
                  guestCount: party,
                  tableIds: e.hold.tableIds,
                  overrideReason: o,
                })
                if (assigned?.reservationId) {
                  const updatedList = await api.listReservations({ businessDate: e.businessDate })
                  res = updatedList.find((r) => r.id === assigned.reservationId)
                }
              }
              if (!res) throw new Error("Không tìm thấy thông tin đặt bàn liên kết.")
              return api.checkIn({
                reservationId: res.id,
                version: res.version,
                guestCount: party,
                overrideReason: o,
              })
            }),
        }
      : { label: "Khách nhận bàn (check-in)" }
    secondary =
      !e.hold || api.mode === "http"
        ? null
        : {
            label: "Nhả giữ",
            go: () => void run(() => api.releaseHold(e.hold!.id, e.hold!.version, "STAFF_REASSIGNED")),
          }
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
    <div className={cn(card, "flex flex-col gap-2 px-4 py-3.5", closed && "opacity-65")}>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-base font-medium text-tx-strong">{e.displayName}</span>
        <span className="shrink-0 rounded-full px-2.5 text-xs leading-6 font-medium" style={toneStyle(tone)}>
          {WAITLIST_STATUS_LABEL[e.status]}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-tx-2">
        <span className="rounded-full border border-strong px-2 text-xs leading-5 text-tx-2">
          {e.kind === "WALK_IN" ? "Walk-in" : "Đặt trước"}
        </span>
        <span>{party} khách</span>
        {time ? <span>{time}</span> : null}
        {pref ? <span className="text-subtle">{pref}</span> : null}
      </div>
      <span className="text-[13px]" style={{ color: fit ? "var(--st-seated-ink)" : "var(--text-muted)" }}>
        {fitText}
      </span>
      {primary ? (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={primary.go}
            disabled={!primary.go || pending}
            className={cn(
              "h-11 flex-1 rounded-xl border border-primary text-[14px] font-medium",
              primary.go ? "bg-primary text-primary-foreground" : "bg-transparent text-[var(--text-muted)] opacity-60",
            )}
          >
            {primary.label}
          </button>
          {secondary ? (
            <button
              type="button"
              onClick={secondary.go}
              disabled={pending}
              className="h-11 shrink-0 rounded-xl border border-strong px-3.5 text-[14px] text-tx-1"
            >
              {secondary.label}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

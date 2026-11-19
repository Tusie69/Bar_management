import { formatHonorificName } from "@/domain/booking-identity"
import { formatBookingSource } from "@/domain/enums"
import { ChevronLeft } from "lucide-react"
import { type ReactNode } from "react"
import { RevealPhone } from "@/components/reveal-phone"
import { Button } from "@/components/ui/button"
import { useReservations, useWaitlist } from "@/hooks/use-data"
import { fmtBusinessDate, fmtDayMonth, fmtTime12, MS, venueDateString, type BusinessDate } from "@/lib/time"
import { cn } from "@/lib/utils"
import { useCan } from "@/state/session"
import { CallCustomerControl } from "../bookings/call-customer"
import { CallHistory } from "../bookings/call-history"
import { useMobileActions } from "./actions"
import { useM } from "./context"
import { codesOf, lateOf, subOf } from "./model"
import { card, EmptyBox, StatusChip } from "./ui"

interface Row {
  k: string
  v: ReactNode
  btn?: { label: string; go: () => void }
}

/** Full-screen booking detail (covers the tab bar). Back returns to the same scroll position. */
export function DetailScreen({
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
  const canUpdate = useCan("reservation.update")
  const res = useReservations(bd).data
  const r = res?.find((x) => x.id === id)
  const waitlist = useWaitlist(bd)
  const linkedEntry = waitlist.data?.find((x) => x.reservationId === r?.id || r?.waitlistEntryId === x.id)

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
        {canUpdate && r && r.status === "BOOKED" ? (
          <button
            type="button"
            onClick={() => m.openBookingEdit(r.id, r.businessDate)}
            aria-label="Sửa booking"
            disabled={waitlist.isPending || waitlist.isError || waitlist.isFetching || waitlist.isPlaceholderData}
            className="gm-press ml-auto inline-flex h-11 shrink-0 items-center rounded-xl border border-border-strong bg-surface-1 px-4 text-[13.5px] font-semibold text-tx-1 shadow-[var(--shadow-xs)] hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-50"
          >
            Sửa
          </button>
        ) : null}
      </div>
    </header>
  )

  if (!r) {
    return (
      <div className="flex h-full w-full flex-col bg-background">
        {header}
        <div className="p-4">
          {res ? (
            <EmptyBox title="Không tìm thấy booking" body="Booking có thể đã được chuyển ngày hoặc xóa." />
          ) : (
            <p className="text-[14px] text-[var(--text-muted)]">Đang tải...</p>
          )}
        </div>
      </div>
    )
  }

  const hold = a.bookingPolicy(r)
  const heldEntry = hold.entry
  const late = lateOf(r, m.now)
  const sub = subOf(r, m.now, m.th)
  const zone = r.tableIds.length
    ? m.model.catalog?.zones.find((z) => z.id === m.model.byId.get(r.tableIds[0])?.zoneId)?.name
    : null
  const showMap = () => {
    onClose()
    m.openTable(r.tableIds[0])
  }
  const created = r.createdAt ? `${fmtDayMonth(venueDateString(r.createdAt))}, ${fmtTime12(r.createdAt)}` : null
  const creator = r.createdByName ? `Tạo booking, ${r.createdByName}` : "Tạo booking"
  const at = (min: number) => fmtTime12(new Date(r.expectedAt.getTime() + min * MS.MIN))

  const groups: { title: string; rows: Row[] }[] = [
    {
      title: "Thời gian",
      rows: [
        { k: "Giờ hẹn", v: fmtTime12(r.expectedAt) },
        {
          k: "Giờ đến thực tế",
          v: r.checkedInAt ? fmtTime12(r.checkedInAt) : r.status === "BOOKED" ? "Chưa đến" : "Không có",
        },
        ...(late ? [{ k: "Đang trễ", v: `${late} phút` }] : []),
        { k: "Ngày kinh doanh", v: fmtBusinessDate(r.businessDate) },
      ],
    },
    {
      title: "Khách",
      rows: [
        { k: "Tên", v: formatHonorificName(r.displayName, r.honorific) },
        {
          k: "Số điện thoại",
          v: (
            <RevealPhone
              key={r.customerId ?? r.id}
              customerId={r.customerId}
              last3={r.phoneLast3}
              context={{ reservationId: r.id }}
            />
          ),
        },
        { k: "Nguồn đặt", v: formatBookingSource(r.sourceCode, r.socialPlatform) },
        {
          k: "Loại khách",
          v:
            r.classification === "RETURNING"
              ? "Đã từng đặt bàn"
              : r.classification === "NEW"
                ? "Chưa từng đặt bàn"
                : "Chưa phân loại",
          btn:
            canUpdate && r.status === "BOOKED"
              ? { label: "Sửa", go: () => m.openBookingEdit(r.id, r.businessDate) }
              : undefined,
        },
      ],
    },
    {
      title: "Bàn",
      rows: [
        {
          k: "Bàn",
          v: r.tableIds.length ? codesOf(r.tableIds, m.model) : "Chưa có bàn",
          btn: r.tableIds.length ? { label: "Xem sơ đồ", go: showMap } : undefined,
        },
        { k: "Khu", v: zone ?? "Chưa xếp" },
        ...(r.tableIds.length > 1 ? [{ k: "Ghép bàn", v: `${r.tableIds.length} vị trí, chung một nhóm` }] : []),
      ],
    },
    ...(r.note ? [{ title: "Ghi chú", rows: [{ k: "Ghi chú khách", v: r.note }] }] : []),
    ...(linkedEntry
      ? [
          {
            title: "Mục chờ",
            rows: [
              {
                k: "Đơn chờ",
                v: `#${linkedEntry.id} (${linkedEntry.kind === "WALK_IN" ? "Walk-in" : "Đặt trước"})`,
                btn: {
                  label: "Xem đơn chờ",
                  go: () => {
                    onClose()
                    m.openEntryDetail(linkedEntry.id, bd)
                  },
                },
              },
            ],
          },
        ]
      : []),
    {
      title: "Lịch sử",
      rows: [
        { k: created ?? "Thời gian tạo", v: created ? creator : "Chưa có dữ liệu" },
        ...(r.warning ? [{ k: at(m.th.late), v: `Hệ thống: cảnh báo trễ ${m.th.late} phút` }] : []),
        ...(r.warning === "noshow" ? [{ k: at(m.th.noshow), v: `Hệ thống: cảnh báo trễ ${m.th.noshow} phút` }] : []),
        ...(r.checkedInAt ? [{ k: fmtTime12(r.checkedInAt), v: "Check-in" }] : []),
      ],
    },
  ]

  const primary =
    r.status === "CHECKED_IN"
      ? { label: "Xem trên sơ đồ", go: showMap, disabled: a.pending }
      : r.status === "BOOKED"
        ? r.tableIds.length
          ? {
              label: "Khách đã đến",
              disabled: a.pending || !hold.canArrival,
              go: () =>
                a.arrival({
                  entry: heldEntry,
                  reservation: r,
                  partySize: r.partySize,
                  tableCodes: codesOf(r.tableIds, m.model),
                }),
            }
          : {
              label: "Xếp bàn",
              go: () => (heldEntry ? a.reassignHold(heldEntry, r) : a.assign(r)),
              disabled: a.pending || !hold.canReassign,
            }
        : null

  return (
    <div className="flex h-full w-full flex-col bg-background">
      {header}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pt-3.5 pb-6">
        <div
          className="flex flex-col gap-2 rounded-2xl border bg-surface-1 p-4 shadow-[var(--shadow-soft)]"
          style={{
            borderColor:
              r.status === "BOOKED" && r.warning === "noshow"
                ? "color-mix(in oklab, var(--st-noshow) 65%, var(--border))"
                : "var(--border)",
          }}
        >
          <div className="flex items-start gap-2.5">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-[21px] leading-tight font-bold tracking-[-0.02em] text-tx-strong">
                {formatHonorificName(r.displayName, r.honorific)}
              </span>
              <span className="tnum text-[14px] font-medium text-tx-2">
                {fmtTime12(r.expectedAt)}, {r.partySize} khách,{" "}
                {r.tableIds.length ? `Bàn ${codesOf(r.tableIds, m.model)}` : "Chưa có bàn"}
              </span>
            </div>
            <StatusChip big r={r} onClick={() => m.openStatus(r)} />
          </div>
          {sub ? (
            <span
              className="rounded-lg px-2.5 py-1.5 text-[13px] font-medium"
              style={{
                color:
                  r.warning === "noshow"
                    ? "var(--st-noshow-ink)"
                    : r.warning || (r.status === "BOOKED" && !r.tableIds.length)
                      ? "var(--st-late-ink)"
                      : "var(--text-muted)",
                background:
                  r.warning === "noshow"
                    ? "var(--st-noshow-tint)"
                    : r.warning || (r.status === "BOOKED" && !r.tableIds.length)
                      ? "var(--st-late-tint)"
                      : "var(--surface-2)",
              }}
            >
              {sub}
            </span>
          ) : null}
        </div>

        {groups.map((g) => (
          <section key={g.title} className="flex flex-col gap-1.5">
            <h2 className="eyebrow m-0 px-1">{g.title}</h2>
            <div className={cn(card, "flex flex-col divide-y divide-border overflow-hidden")}>
              {g.rows.map((row, i) => (
                <div key={`${row.k}${i}`} className="flex min-h-12 items-center gap-3 px-4 py-2.5">
                  <span className="w-[108px] shrink-0 text-[13px] font-medium text-[var(--text-muted)]">{row.k}</span>
                  <span className="tnum min-w-0 flex-1 text-[14px] text-pretty text-tx-1">{row.v}</span>
                  {row.btn ? (
                    <button
                      type="button"
                      onClick={row.btn.go}
                      disabled={row.btn.label === "Sửa" && !!hold.reason}
                      title={row.btn.label === "Sửa" ? hold.reason : undefined}
                      className="gm-press inline-flex h-11 shrink-0 items-center rounded-xl border border-border-strong bg-surface-1 px-3.5 text-[13px] font-semibold text-primary-ink hover:bg-primary-tint disabled:pointer-events-none disabled:opacity-45"
                    >
                      {row.btn.label}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ))}

        {/* Lễ tân gọi khách trực tiếp từ đây mà không cần quyền mở SĐT đầy đủ. */}
        <section className="flex flex-col gap-2">
          <h2 className="eyebrow m-0 px-1">Gọi khách</h2>
          <CallCustomerControl
            target={{ kind: "booking", id: r.id, version: r.version }}
            canCall={r.canCall === true || r.phoneLast3 !== null}
            className="w-full"
          />
          <CallHistory target={{ kind: "booking", id: r.id }} className="w-full" />
        </section>
      </div>
      {hold.reason ? (
        <p
          role="alert"
          className="m-0 border-t border-border/60 bg-[var(--destructive-tint)] px-4 py-2 text-sm font-medium text-destructive"
        >
          {hold.reason}
        </p>
      ) : null}
      {primary ? (
        <footer className="gm-glass-chrome flex shrink-0 flex-col gap-2 border-t border-border/70 bg-surface-1/95 px-4 pt-3 pb-[calc(12px+var(--bottom-safe))] backdrop-blur-md">
          <Button
            type="button"
            size="lg"
            onClick={primary.go}
            title={hold.reason ?? (heldEntry && !hold.supported ? "Chưa hỗ trợ" : undefined)}
            disabled={primary.disabled ?? a.pending}
            className="h-12 w-full rounded-xl text-[15px] font-semibold"
          >
            {primary.label}
          </Button>
          {r.status === "BOOKED" ? (
            <div className={cn("grid gap-2", r.tableIds.length ? "grid-cols-3" : "grid-cols-2")}>
              {r.tableIds.length ? (
                <button
                  type="button"
                  onClick={() => (heldEntry ? a.reassignHold(heldEntry, r) : a.assign(r))}
                  title={hold.reason ?? (heldEntry && !hold.supported ? "Chưa hỗ trợ" : undefined)}
                  disabled={a.pending || !hold.canReassign}
                  className="gm-press h-11 rounded-xl border border-border-strong bg-surface-1 px-2 text-center text-[13px] font-semibold text-tx-1 hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-45"
                >
                  Đổi / Ghép bàn
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => a.cancel(r)}
                title={hold.reason ?? (heldEntry && !hold.canBookingStatus ? "Chưa hỗ trợ" : undefined)}
                disabled={a.pending || !hold.canBookingStatus || !m.can("reservation.cancel")}
                className="gm-press h-11 rounded-xl border border-destructive/40 bg-[var(--destructive-tint)] px-2 text-center text-[13px] font-semibold text-destructive hover:border-destructive/60 disabled:pointer-events-none disabled:opacity-45"
              >
                Hủy booking
              </button>
              <button
                type="button"
                onClick={() => m.openStatus(r)}
                title={hold.reason ?? (heldEntry && !hold.canBookingStatus ? "Chưa hỗ trợ" : undefined)}
                disabled={
                  a.pending || !hold.canBookingStatus || (!m.can("reservation.cancel") && !m.can("reservation.update"))
                }
                className="gm-press h-11 rounded-xl border border-border-strong bg-surface-1 px-2 text-center text-[13px] font-semibold text-tx-1 hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-45"
              >
                Đổi trạng thái
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => m.openStatus(r)}
              title={hold.reason ?? (heldEntry && !hold.canBookingStatus ? "Chưa hỗ trợ" : undefined)}
              disabled={
                a.pending || !hold.canBookingStatus || (!m.can("reservation.cancel") && !m.can("reservation.update"))
              }
              className="gm-press h-11 w-full rounded-xl border border-border-strong bg-surface-1 px-3 text-center text-[13.5px] font-semibold text-tx-1 hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-45"
            >
              Đổi trạng thái
            </button>
          )}
        </footer>
      ) : null}
    </div>
  )
}

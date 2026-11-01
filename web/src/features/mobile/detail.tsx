import { ChevronLeft } from "lucide-react"
import { useState, type ReactNode } from "react"
import { RevealPhone } from "@/components/reveal-phone"
import { SOURCE_LABEL } from "@/domain/enums"
import { useReservations } from "@/hooks/use-data"
import { fmtBusinessDate, fmtDayMonth, fmtTime12, MS, venueDateString, type BusinessDate } from "@/lib/time"
import { cn } from "@/lib/utils"
import { useCan } from "@/state/session"
import { EditReservationDialog } from "../reservations/reservation-detail"
import { useMobileActions } from "./actions"
import { useM } from "./context"
import { codesOf, lateOf, subOf } from "./model"
import { card, StatusChip } from "./ui"

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
  const [editOpen, setEditOpen] = useState(false)
  const canUpdate = useCan("reservation.update")
  const res = useReservations(bd).data
  const r = res?.find((x) => x.id === id)

  const header = (
    <header className="shrink-0 bg-background px-4 pt-[var(--top-safe)] pb-2">
      <div className="-ml-2.5 flex h-11 items-center gap-1">
        <button
          type="button"
          onClick={onClose}
          aria-label="Quay lại"
          className="grid size-11 place-items-center rounded-xl text-tx-1 active:bg-surface-2"
        >
          <ChevronLeft className="size-[22px]" />
        </button>
        <span className="text-base font-medium text-tx-2">{backLabel}</span>
        {canUpdate && r ? (
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            aria-label="Sửa booking"
            className="ml-auto rounded-xl border border-strong px-3 py-1.5 text-xs font-medium text-tx-1 active:bg-surface-2"
          >
            Sửa
          </button>
        ) : null}
      </div>
    </header>
  )

  if (!r) {
    return (
      <div role="dialog" aria-label="Chi tiết booking" className="fixed inset-0 z-[40] flex flex-col bg-background">
        {header}
        <p className="px-4 text-[14px] text-[var(--text-muted)]">{res ? "Không tìm thấy booking." : "Đang tải..."}</p>
      </div>
    )
  }

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
        { k: "Tên", v: r.displayName },
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
        { k: "Nguồn đặt", v: SOURCE_LABEL[r.sourceCode] },
        {
          k: "Loại khách",
          v:
            r.classification === "RETURNING"
              ? "Khách quen (O)"
              : r.classification === "NEW"
                ? "Khách mới (N)"
                : "Chưa phân loại",
          btn: canUpdate ? { label: "Sửa", go: () => setEditOpen(true) } : undefined,
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
      ? { label: "Xem trên sơ đồ", go: showMap }
      : r.status === "BOOKED"
        ? r.tableIds.length
          ? { label: "Khách đã đến", go: () => void a.checkIn(r) }
          : { label: "Xếp bàn", go: () => a.assign(r) }
        : null

  return (
    <div role="dialog" aria-label="Chi tiết booking" className="fixed inset-0 z-[40] flex flex-col bg-background">
      {header}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pt-1 pb-6">
        <div
          className="flex flex-col gap-2 rounded-[20px] border bg-surface-1 p-[18px] shadow-[var(--shadow-soft)]"
          style={{
            borderColor: r.status === "BOOKED" && r.warning === "noshow" ? "var(--st-noshow)" : "var(--border)",
          }}
        >
          <div className="flex items-start gap-2.5">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[22px] font-semibold tracking-[-0.01em] text-tx-strong">{r.displayName}</span>
              <span className="text-[14px] text-tx-2">
                {fmtTime12(r.expectedAt)}, {r.partySize} khách,{" "}
                {r.tableIds.length ? `Bàn ${codesOf(r.tableIds, m.model)}` : "Chưa có bàn"}
              </span>
            </div>
            <StatusChip big r={r} onClick={() => m.openStatus(r)} />
          </div>
          {sub ? (
            <span
              className="text-[13px] font-medium"
              style={{
                color:
                  r.warning === "noshow"
                    ? "var(--st-noshow-ink)"
                    : r.warning || (r.status === "BOOKED" && !r.tableIds.length)
                      ? "var(--st-late-ink)"
                      : "var(--text-muted)",
              }}
            >
              {sub}
            </span>
          ) : null}
        </div>

        {groups.map((g) => (
          <section key={g.title} className="flex flex-col gap-2">
            <h2 className="m-0 pl-0.5 text-[15px] font-semibold text-tx-strong">{g.title}</h2>
            <div className={cn(card, "flex flex-col overflow-hidden")}>
              {g.rows.map((row, i) => (
                <div
                  key={`${row.k}${i}`}
                  className={cn("flex min-h-12 items-center gap-3 px-4 py-2", i && "border-t border-border")}
                >
                  <span className="w-[118px] shrink-0 text-[13px] text-[var(--text-muted)]">{row.k}</span>
                  <span className="min-w-0 flex-1 text-[14px] text-pretty text-tx-1">{row.v}</span>
                  {row.btn ? (
                    <button
                      type="button"
                      onClick={row.btn.go}
                      className="h-9 shrink-0 rounded-[10px] border border-strong px-3 text-[13px] font-medium text-primary-ink"
                    >
                      {row.btn.label}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
      {primary ? (
        <footer className="flex shrink-0 gap-2 border-t border-border bg-surface-1 px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={primary.go}
            disabled={a.pending}
            className="h-[52px] flex-1 rounded-[14px] bg-primary text-base font-semibold text-primary-foreground"
          >
            {primary.label}
          </button>
          <button
            type="button"
            onClick={() => m.openStatus(r)}
            className="h-[52px] shrink-0 rounded-[14px] border border-strong px-[18px] text-[15px] text-tx-1"
          >
            Đổi trạng thái
          </button>
        </footer>
      ) : null}
      {r ? <EditReservationDialog open={editOpen} onOpenChange={setEditOpen} r={r} /> : null}
    </div>
  )
}

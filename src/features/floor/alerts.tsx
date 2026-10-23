import { AlarmClock, CalendarClock, Hourglass } from "lucide-react"
import { useMemo } from "react"
import type { ReservationView } from "@/domain/models"
import { fmtTime, MS } from "@/lib/time"
import type { FloorModel } from "./use-floor-model"

export interface Alert {
  key: string
  severity: number
  icon: React.ReactNode
  title: string
  detail: string
  tableId: number | null
  reservationId: number | null
  tone: "late" | "noshow" | "reserved"
}

/** Things the host stand must act on now: late / no-show, unassigned soon, holds, stale tables. */
export function useShiftAlerts(model: FloorModel, booked: ReservationView[], now: Date): Alert[] {
  return useMemo<Alert[]>(() => {
    const out: Alert[] = []
    for (const r of booked) {
      if (r.warning) {
        out.push({
          key: `r${r.id}`,
          severity: r.warning === "noshow" ? 3 : 2,
          icon: <AlarmClock className="size-4" />,
          title: `${r.tableIds.length ? model.codes(r.tableIds).join(" + ") : "Chưa có bàn"} · ${r.displayName}`,
          detail: `${r.warning === "noshow" ? "Chưa đến" : "Đến muộn"} +${r.minutesLate}' · hẹn ${fmtTime(r.expectedAt)} · ${r.partySize} khách`,
          tableId: r.tableIds[0] ?? null,
          reservationId: r.id,
          tone: r.warning === "noshow" ? "noshow" : "late",
        })
      } else if (r.subState !== "DANG_GIU_BAN" && r.expectedAt.getTime() - now.getTime() < 60 * MS.MIN) {
        out.push({
          key: `u${r.id}`,
          severity: 1,
          icon: <CalendarClock className="size-4" />,
          title: `Chưa phân bàn · ${r.displayName}`,
          detail: `Hẹn ${fmtTime(r.expectedAt)} · ${r.partySize} khách`,
          tableId: null,
          reservationId: r.id,
          tone: "reserved",
        })
      }
    }
    for (const [tableId, s] of model.states) {
      if (
        s.state === "hold_overdue" ||
        (s.state === "hold" && s.claim?.deadlineAt && s.claim.deadlineAt.getTime() - now.getTime() < 5 * MS.MIN)
      ) {
        out.push({
          key: `h${tableId}`,
          severity: s.state === "hold_overdue" ? 2 : 1,
          icon: <Hourglass className="size-4" />,
          title: `${model.label(tableId)} · ${s.claim?.displayName ?? ""}`,
          detail:
            s.state === "hold_overdue"
              ? `Quá hạn giữ từ ${fmtTime(s.claim?.deadlineAt)}`
              : `Sắp hết hạn giữ ${fmtTime(s.claim?.deadlineAt)}`,
          tableId,
          reservationId: null,
          tone: s.state === "hold_overdue" ? "late" : "reserved",
        })
      }
      if (s.staleFromPreviousDay) {
        out.push({
          key: `s${tableId}`,
          severity: 2,
          icon: <AlarmClock className="size-4" />,
          title: `${model.label(tableId)} chưa nhả từ hôm trước`,
          detail: "Kiểm tra và nhả bàn nếu khách đã rời",
          tableId,
          reservationId: null,
          tone: "late",
        })
      }
    }
    return out.sort((a, b) => b.severity - a.severity)
  }, [booked, model, now])
}

import { StateChip, WarningChip } from "@/components/status"
import type { ReservationView } from "@/domain/models"

export function ReservationStatusChip({ r }: { r: ReservationView }) {
  if (r.status === "BOOKED") {
    if (r.warning) return <WarningChip warning={r.warning} minutes={r.minutesLate} />
    if (r.subState === "DANG_GIU_BAN") return <StateChip state="reserved">Đã xác nhận, giữ bàn</StateChip>
    if (r.subState === "CHO_BAN") return <StateChip state="hold">Đang chờ bàn</StateChip>
    return <StateChip state="free">Chờ phân bàn</StateChip>
  }
  if (r.status === "CHECKED_IN") return <StateChip state="seated">Đã check-in</StateChip>
  if (r.status === "NO_SHOW") return <StateChip state="noshow">Không đến</StateChip>
  return <StateChip state="oos">Đã hủy</StateChip>
}

import { AlarmClock, Ban, CircleDashed, Clock3, Hourglass, Users, type LucideIcon } from "lucide-react"
import type { TableLiveState } from "@/domain/models"

/**
 * Table state vocabulary. Colors are tokens (--st-*) reserved for state;
 * every state also carries an icon/shape cue so color is never the only signal.
 * Labels follow staff wording (db05 §6.1). Color mapping is a UI proposal,
 * pending PO decision (PLAN Q2).
 */
export const STATE_META: Record<
  TableLiveState,
  { label: string; short: string; color: string; ink: string; tint: string; icon: LucideIcon }
> = {
  free: {
    label: "Chưa đặt",
    short: "Trống",
    color: "var(--table-line)",
    ink: "var(--text-muted)",
    tint: "transparent",
    icon: CircleDashed,
  },
  reserved: {
    label: "Đang đặt",
    short: "Đặt",
    color: "var(--st-reserved)",
    ink: "var(--st-reserved-ink)",
    tint: "var(--st-reserved-tint)",
    icon: Clock3,
  },
  late: {
    label: "Đến muộn",
    short: "Muộn",
    color: "var(--st-late)",
    ink: "var(--st-late-ink)",
    tint: "var(--st-late-tint)",
    icon: AlarmClock,
  },
  noshow: {
    label: "Khách không đến",
    short: "Không đến",
    color: "var(--st-noshow)",
    ink: "var(--st-noshow-ink)",
    tint: "var(--st-noshow-tint)",
    icon: AlarmClock,
  },
  seated: {
    label: "Đang sử dụng",
    short: "Đang ngồi",
    color: "var(--st-seated)",
    ink: "var(--st-seated-ink)",
    tint: "var(--st-seated-tint)",
    icon: Users,
  },
  hold: {
    label: "Đang giữ cho khách chờ",
    short: "Giữ",
    color: "var(--st-reserved)",
    ink: "var(--st-reserved-ink)",
    tint: "var(--st-reserved-tint)",
    icon: Hourglass,
  },
  hold_overdue: {
    label: "Quá hạn giữ, chờ xử lý",
    short: "Quá hạn",
    color: "var(--st-late)",
    ink: "var(--st-late-ink)",
    tint: "var(--st-late-tint)",
    icon: Hourglass,
  },
  oos: {
    label: "Ngưng phục vụ",
    short: "Ngưng",
    color: "var(--st-oos)",
    ink: "var(--text-muted)",
    tint: "transparent",
    icon: Ban,
  },
  spare: {
    label: "Bàn sơ cua",
    short: "Sơ cua",
    color: "var(--table-line)",
    ink: "var(--text-muted)",
    tint: "transparent",
    icon: CircleDashed,
  },
}

export const STATE_ORDER: TableLiveState[] = [
  "seated",
  "reserved",
  "late",
  "noshow",
  "hold",
  "hold_overdue",
  "free",
  "spare",
  "oos",
]

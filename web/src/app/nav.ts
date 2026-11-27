import {
  CalendarClock,
  ChartColumn,
  CircleDollarSign,
  FileX2,
  LayoutDashboard,
  ListOrdered,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react"
import type { Permission } from "@/domain/access"
import { isPaymentAvailable } from "@/services/payment"

export interface NavItem {
  to: string
  label: string
  short: string
  icon: LucideIcon
  permission?: Permission
  available?: boolean
  mobile: boolean
}

// v2 nav: "Điều phối" (floor) is the home screen. /overview still routes, just not listed.
export const NAV: NavItem[] = [
  { to: "/floor", label: "Điều phối", short: "Điều phối", icon: LayoutDashboard, mobile: true },
  {
    to: "/payment",
    label: "Thu tiền",
    short: "Thu tiền",
    icon: CircleDollarSign,
    permission: "payment.collect",
    available: isPaymentAvailable,
    mobile: true,
  },
  {
    to: "/cancel-payment",
    label: "Duyệt huỷ thanh toán",
    short: "Duyệt huỷ",
    icon: FileX2,
    permission: "audit.read",
    available: isPaymentAvailable,
    mobile: false,
  },
  { to: "/reservations", label: "Đặt bàn", short: "Đặt bàn", icon: CalendarClock, mobile: true },
  { to: "/waitlist", label: "Chờ", short: "Chờ", icon: ListOrdered, mobile: true },
  { to: "/guests", label: "Khách", short: "Khách", icon: Users, mobile: true },
  { to: "/reports", label: "Báo cáo", short: "Báo cáo", icon: ChartColumn, permission: "report.read", mobile: false },
  { to: "/settings", label: "Cài đặt", short: "Cài đặt", icon: Settings, mobile: false },
]

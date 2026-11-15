import type { Permission } from "@/domain/access"
import { PORTAL_CONFIG } from "@/domain/auth-portal"
import type { RoleCode } from "@/domain/enums"
import { type BusinessDate, fmtBusinessDate } from "@/lib/time"

/**
 * Centralized role display labels for the Admin shell footer.
 * Kept in one map so product naming (e.g. SuperAdmin vs Chủ quán) can change in one place.
 */
export const ADMIN_ROLE_LABELS = {
  OWNER: "SuperAdmin",
  ADMIN_WRITE: "Admin",
  ADMIN_READ_ONLY: "Chỉ xem",
} as const

export type AdminRoleLabelKey = keyof typeof ADMIN_ROLE_LABELS

export function getAdminRoleLabel(
  role: RoleCode,
  accessLevel?: "WRITE" | "READ_ONLY" | null,
): string {
  if (role === "OWNER") return ADMIN_ROLE_LABELS.OWNER
  if (role === "ADMIN") {
    return accessLevel === "READ_ONLY"
      ? ADMIN_ROLE_LABELS.ADMIN_READ_ONLY
      : ADMIN_ROLE_LABELS.ADMIN_WRITE
  }
  return role
}

export function isAdminPortalRole(role: RoleCode): role is "OWNER" | "ADMIN" {
  return (PORTAL_CONFIG.admin.roles as readonly string[]).includes(role)
}

export function getUserHomePath(role: RoleCode): string {
  if (role === "OWNER" || role === "ADMIN") return "/admin/overview"
  if (role === "CUSTOMER_CARE") return PORTAL_CONFIG["customer-care"].home
  if (role === "CASHIER") return PORTAL_CONFIG.cashier.home
  return PORTAL_CONFIG.receptionist.home
}

export interface AdminNavItem {
  id:
    | "overview"
    | "reports"
    | "reconciliation"
    | "customers"
    | "turns"
    | "accounts"
    | "settings"
    | "audit"
  path: string
  /** Exact Vietnamese label in the 232px left sidebar (Figma 2:35..2:49) */
  navLabel: string
  /** Page H1 title in the 75px header row (Figma 2:55 / 10:27) */
  headerTitle: string
  /** Read permission required both to show the nav item and to pass the route guard */
  permission: Permission
  /** Optional write permission for mutation controls inside the screen */
  mutationPermission?: Permission
  /** Delivery wave */
  phase: "dot-1" | "dot-2"
  /** Screen scope summary used in designed empty/placeholder states */
  summary: string
}

/**
 * 8 navigation items in exact Figma order (Figma node 2:31).
 */
export const ADMIN_NAV_ITEMS: readonly AdminNavItem[] = [
  {
    id: "overview",
    path: "/admin/overview",
    navLabel: "Tổng quan",
    headerTitle: "Tổng quan",
    permission: "report.read",
    phase: "dot-1",
    summary: "Theo dõi toàn cảnh ca vận hành, công suất bàn/ghế, cảnh báo đặt bàn trễ và hàng chờ theo thời gian thực.",
  },
  {
    id: "reports",
    path: "/admin/reports",
    navLabel: "Báo cáo",
    headerTitle: "Báo cáo",
    permission: "report.read",
    phase: "dot-2",
    summary: "Tổng hợp hiệu suất ca, tỷ lệ lấp đầy theo khu vực, nguồn đặt bàn và xu hướng khách theo tuần/tháng.",
  },
  {
    id: "reconciliation",
    path: "/admin/reconciliation",
    navLabel: "Đối soát",
    headerTitle: "Đối soát",
    permission: "report.read",
    phase: "dot-2",
    summary: "Đối chiếu lượt bàn thực tế tại lễ tân với hóa đơn thu ngân và biên bản kết ca.",
  },
  {
    id: "customers",
    path: "/admin/customers",
    navLabel: "Khách hàng",
    headerTitle: "Khách hàng",
    permission: "customer.view_masked",
    mutationPermission: "customer.phone.reveal",
    phase: "dot-2",
    summary: "Hồ sơ khách quen, lịch sử ghé quán, tần suất đặt bàn và kiểm soát hiển thị số điện thoại có ghi nhật ký.",
  },
  {
    id: "turns",
    path: "/admin/turns",
    navLabel: "Sổ lượt",
    headerTitle: "Sổ lượt tới quán",
    permission: "report.read",
    phase: "dot-1",
    summary: "Tra cứu chi tiết từng lượt khách tới quán trong ca: giờ mở bàn, giờ đóng bàn, số khách, nguồn tiếp nhận và nhân sự phụ trách.",
  },
  {
    id: "accounts",
    path: "/admin/accounts",
    navLabel: "Tài khoản",
    headerTitle: "Tài khoản",
    permission: "user.read",
    mutationPermission: "user.manage",
    phase: "dot-1",
    summary: "Quản lý tài khoản nhân sự, phân quyền vai trò vận hành, đặt lại mật khẩu và khóa phiên truy cập.",
  },
  {
    id: "settings",
    path: "/admin/settings",
    navLabel: "Cấu hình",
    headerTitle: "Cấu hình",
    permission: "report.read",
    mutationPermission: "venue.configure",
    phase: "dot-2",
    summary: "Thiết lập khung giờ ca kinh doanh, ngưỡng cảnh báo trễ giờ, quy tắc giữ bàn và cấu hình sơ đồ khu vực.",
  },
  {
    id: "audit",
    path: "/admin/audit",
    navLabel: "Nhật ký",
    headerTitle: "Nhật ký",
    permission: "audit.read",
    phase: "dot-1",
    summary: "Nhật ký kiểm toán các thao tác nhạy cảm: tạo/khóa tài khoản, giải mã số điện thoại và thay đổi cấu hình quán.",
  },
] as const

export const ADMIN_SHIFT_LABEL = "Ca 17:00 → 05:00"
export const ADMIN_DESKTOP_MEDIA_QUERY = "(min-width: 1025px)"

export function resolveDrawerCloseFocusTarget({
  trigger,
  isDesktop,
  desktopSidebar,
  mainContent,
}: {
  trigger: HTMLElement | null
  isDesktop: boolean
  desktopSidebar: HTMLElement | null
  mainContent: HTMLElement | null
}): HTMLElement | null {
  const isTriggerVisible =
    Boolean(trigger) && !isDesktop && (trigger?.getClientRects().length ?? 0) > 0
  if (isTriggerVisible) {
    return trigger
  }

  return (
    desktopSidebar?.querySelector<HTMLElement>('a.admin-nav-item[aria-current="page"]') ??
    desktopSidebar?.querySelector<HTMLElement>("a.admin-nav-item") ??
    mainContent
  )
}

/**
 * Formats a BusinessDate ("YYYY-MM-DD") using the app's existing weekday formatter
 * into the Figma header format: "T5 · 12/11/2026".
 */
export function formatAdminBusinessDate(bd: BusinessDate): string {
  const shortText = fmtBusinessDate(bd, "short") // e.g. "T5, 12/11"
  const year = bd.slice(0, 4)
  return `${shortText.replace(", ", " · ")}/${year}`
}

export function resolveActiveAdminNavItem(pathname: string): AdminNavItem | undefined {
  const normalized =
    pathname === "/admin" || pathname === "/admin/" ? "/admin/overview" : pathname
  return ADMIN_NAV_ITEMS.find(
    (item) => normalized === item.path || normalized.startsWith(`${item.path}/`),
  )
}

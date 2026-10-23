/**
 * RBAC matrix from database/08-security-and-rbac.md §3.
 * Roles are TECH_PROPOSED; assignment is still pending PO approval.
 * The backend is the authority. The UI only uses this to disable controls
 * and explain why; the mock server enforces the same matrix.
 */
import type { RoleCode } from "./enums"

export type Permission =
  | "reservation.create"
  | "reservation.update"
  | "reservation.cancel"
  | "reservation.mark_no_show"
  | "table.assign"
  | "table.assign_override"
  | "visit.checkin"
  | "visit.walkin"
  | "visit.move"
  | "visit.combine"
  | "visit.split"
  | "visit.end"
  | "visit.mark_paid"
  | "waitlist.create"
  | "waitlist.cancel"
  | "waitlist.claim"
  | "waitlist.record_contact"
  | "waitlist.accept_offer"
  | "hold.set_deadline"
  | "hold.release"
  | "customer.view_masked"
  | "customer.phone.reveal"
  | "customer.anonymize"
  | "audit.read"
  | "report.read"
  | "venue.configure"
  | "user.manage"
  | "operation.undo"

const OA: RoleCode = "OWNER_ADMIN"
const R: RoleCode = "RECEPTIONIST"
const CC: RoleCode = "CUSTOMER_CARE"
const C: RoleCode = "CASHIER"

export const PERMISSION_MATRIX: Record<Permission, RoleCode[]> = {
  "reservation.create": [OA, R],
  "reservation.update": [OA, R],
  "reservation.cancel": [OA, R],
  "reservation.mark_no_show": [OA, R],
  "table.assign": [OA, R],
  "table.assign_override": [OA],
  "visit.checkin": [OA, R],
  "visit.walkin": [OA, R],
  "visit.move": [OA, R],
  "visit.combine": [OA, R],
  "visit.split": [OA, R],
  "visit.end": [OA, R, C],
  "visit.mark_paid": [OA, C],
  "waitlist.create": [OA, R, CC],
  "waitlist.cancel": [OA, R, CC],
  "waitlist.claim": [OA, R, CC],
  "waitlist.record_contact": [OA, R, CC],
  "waitlist.accept_offer": [OA, R, CC],
  "hold.set_deadline": [OA, R, CC],
  "hold.release": [OA, R],
  "customer.view_masked": [OA, R, CC, C],
  "customer.phone.reveal": [OA],
  "customer.anonymize": [OA],
  "audit.read": [OA],
  "report.read": [OA],
  "venue.configure": [OA],
  "user.manage": [OA],
  "operation.undo": [OA, R],
}

export const PERMISSION_LABEL: Record<Permission, string> = {
  "reservation.create": "Tạo booking",
  "reservation.update": "Sửa booking",
  "reservation.cancel": "Hủy booking",
  "reservation.mark_no_show": "Xác nhận không đến",
  "table.assign": "Phân bàn",
  "table.assign_override": "Phân bàn vượt quy tắc (sơ cua, quá sức chứa)",
  "visit.checkin": "Check-in",
  "visit.walkin": "Nhận Walk-in",
  "visit.move": "Đổi bàn",
  "visit.combine": "Ghép bàn",
  "visit.split": "Tách bàn",
  "visit.end": "Nhả bàn khi khách rời",
  "visit.mark_paid": "Đánh dấu đã thanh toán",
  "waitlist.create": "Thêm vào danh sách chờ",
  "waitlist.cancel": "Hủy mục chờ",
  "waitlist.claim": "Nhận liên hệ mục chờ",
  "waitlist.record_contact": "Ghi kết quả liên hệ",
  "waitlist.accept_offer": "Xác nhận khách nhận bàn",
  "hold.set_deadline": "Gia hạn giữ bàn",
  "hold.release": "Nhả giữ bàn",
  "customer.view_masked": "Xem khách (SĐT che)",
  "customer.phone.reveal": "Xem SĐT đầy đủ",
  "customer.anonymize": "Ẩn danh khách",
  "audit.read": "Xem nhật ký",
  "report.read": "Xem báo cáo",
  "venue.configure": "Cấu hình quán",
  "user.manage": "Quản lý tài khoản",
  "operation.undo": "Hoàn tác / Làm lại",
}

export function roleCan(role: RoleCode, permission: Permission): boolean {
  return PERMISSION_MATRIX[permission].includes(role)
}

export const PERMISSION_GROUPS: { title: string; items: Permission[] }[] = [
  {
    title: "Đặt bàn",
    items: [
      "reservation.create",
      "reservation.update",
      "reservation.cancel",
      "reservation.mark_no_show",
      "table.assign",
      "table.assign_override",
    ],
  },
  {
    title: "Vận hành sàn",
    items: [
      "visit.checkin",
      "visit.walkin",
      "visit.move",
      "visit.combine",
      "visit.split",
      "visit.end",
      "visit.mark_paid",
    ],
  },
  {
    title: "Danh sách chờ",
    items: [
      "waitlist.create",
      "waitlist.cancel",
      "waitlist.claim",
      "waitlist.record_contact",
      "waitlist.accept_offer",
      "hold.set_deadline",
      "hold.release",
    ],
  },
  {
    title: "Khách & dữ liệu",
    items: ["customer.view_masked", "customer.phone.reveal", "customer.anonymize", "audit.read", "report.read"],
  },
  { title: "Quản trị", items: ["venue.configure", "user.manage", "operation.undo"] },
]

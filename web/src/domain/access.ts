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
  | "table.spare.configure"
  | "visit.checkin"
  | "visit.walkin"
  | "visit.move"
  | "visit.combine"
  | "visit.split"
  | "table.group.manage"
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
  | "booking.phone.call"
  | "booking.phone.reveal"
  | "customer.anonymize"
  | "audit.read"
  | "report.read"
  | "venue.configure"
  | "user.read"
  | "user.manage"
  | "operation.undo"
  // TU-32: gian giao phan quyen cho module order. Chua co endpoint nao dung,
  // nen UI cung chua co control nao doc chung; chung o day de bang role x
  // permission phan anh dung sau cap va de route guard tuong lai co cho neo.
  | "order.create"
  | "order.read"
  | "payment.collect"

const O: RoleCode = "OWNER"
const A: RoleCode = "ADMIN"
const M: RoleCode[] = [O, A]
const R: RoleCode = "RECEPTIONIST"
const CC: RoleCode = "CUSTOMER_CARE"
const C: RoleCode = "CASHIER"
const W: RoleCode = "WAITER"

export const PERMISSION_MATRIX: Record<Permission, RoleCode[]> = {
  "reservation.create": [...M, R],
  "reservation.update": [...M, R],
  "reservation.cancel": [...M, R],
  "reservation.mark_no_show": [...M, R],
  "table.assign": [...M, R],
  "table.assign_override": M,
  "table.spare.configure": [...M, R],
  "visit.checkin": [...M, R],
  "visit.walkin": [...M, R],
  "visit.move": [...M, R],
  "visit.combine": [...M, R],
  "visit.split": [...M, R],
  // C1: a layout cluster is managed without touching a guest, so it has its own
  // permission; the server grants it to Lễ tân and the management roles.
  "table.group.manage": [...M, R],
  "visit.end": [...M, R, C],
  "visit.mark_paid": [...M, C],
  "waitlist.create": [...M, R, CC],
  "waitlist.cancel": [...M, R, CC],
  "waitlist.claim": [...M, R, CC],
  "waitlist.record_contact": [...M, R, CC],
  "waitlist.accept_offer": [...M, R, CC],
  "hold.set_deadline": [...M, R, CC],
  "hold.release": [...M, R],
  "customer.view_masked": [...M, R, CC, C],
  "customer.phone.reveal": M,
  "booking.phone.call": [...M, R],
  "booking.phone.reveal": M,
  "customer.anonymize": [O],
  "audit.read": M,
  "report.read": M,
  "venue.configure": [O],
  "user.read": M,
  "user.manage": M,
  "operation.undo": [...M, R],
  // Phuc vu goi mon va xem trang thai cho thanh toan; Thu ngan lam ca hai cong
  // viec nay cong them thu tien. Phuc vu KHONG co payment.collect va KHONG co
  // quyen nao ve khach hang, ke ca 3 so cuoi: bien ban 15/11 khong cap.
  "order.create": [...M, C, W],
  "order.read": [...M, C, W],
  "payment.collect": [...M, C],
}

export const PERMISSION_LABEL: Record<Permission, string> = {
  "reservation.create": "Tạo booking",
  "reservation.update": "Sửa booking",
  "reservation.cancel": "Hủy booking",
  "reservation.mark_no_show": "Xác nhận không tới",
  "table.assign": "Phân bàn",
  "table.assign_override": "Phân bàn vượt quy tắc (sơ cua, quá sức chứa)",
  "table.spare.configure": "Đặt hoặc bỏ bàn sơ cua",
  "visit.checkin": "Check-in",
  "visit.walkin": "Nhận Walk-in",
  "visit.move": "Đổi bàn",
  "visit.combine": "Ghép bàn",
  "visit.split": "Tách bàn",
  "table.group.manage": "Ghép / tách cụm bàn",
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
  "booking.phone.call": "Gọi khách qua trình gọi điện",
  "booking.phone.reveal": "Xem SĐT đầy đủ của booking",
  "customer.anonymize": "Ẩn danh khách",
  "audit.read": "Xem nhật ký",
  "report.read": "Xem báo cáo",
  "venue.configure": "Cấu hình quán",
  "user.read": "Xem danh sách tài khoản",
  "user.manage": "Quản lý tài khoản",
  "operation.undo": "Hoàn tác / Làm lại",
  "order.create": "Gọi món, lên đơn",
  "order.read": "Xem đơn và trạng thái chờ thanh toán",
  "payment.collect": "Thu tiền, in bill",
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
      "table.spare.configure",
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
      "table.group.manage",
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
    items: [
      "customer.view_masked",
      "customer.phone.reveal",
      "booking.phone.call",
      "booking.phone.reveal",
      "customer.anonymize",
      "audit.read",
      "report.read",
    ],
  },
  { title: "Quản trị", items: ["venue.configure", "user.read", "user.manage", "operation.undo"] },
  // Nhóm này hiện chỉ để đối chiếu phân quyền sáu cấp. Chưa có màn hình nào
  // trong web đọc ba permission đó vì module order chưa tồn tại.
  { title: "Gọi món & thanh toán", items: ["order.create", "order.read", "payment.collect"] },
]

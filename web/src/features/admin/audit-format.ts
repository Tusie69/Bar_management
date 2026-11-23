/**
 * TU-35 — Định dạng một dòng nhật ký cho màn Quản trị.
 *
 * Hàm thuần, tách khỏi component để test được mà không cần DOM.
 */
import { venueParts } from "@/lib/time"

const pad = (value: number) => String(value).padStart(2, "0")

/**
 * Giờ của quán, không phải giờ máy đang mở trang.
 *
 * Nhật ký được đọc để đối chiếu với lời kể của nhân viên ("lúc 23:12 tôi
 * đang…"), nên nó phải cùng múi giờ với đồng hồ treo tường trong quán. Một
 * chiếc laptop đặt sai múi giờ không được phép làm lệch bằng chứng.
 */
export function fmtAuditTime(iso: string): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return "—"
  const parts = venueParts(parsed)
  const seconds = pad(parsed.getUTCSeconds())
  return `${pad(parts.day)}/${pad(parts.month)} ${pad(parts.hour)}:${pad(parts.minute)}:${seconds}`
}

const DETAIL_KEY_LABELS: Readonly<Record<string, string>> = {
  portal: "Cổng",
  result: "Kết quả",
  reason: "Lý do",
  roleCode: "Vai trò",
  accessLevel: "Cấp truy cập",
  from: "Từ",
  to: "Đến",
  tableCodes: "Bàn",
  fromTableCodes: "Từ bàn",
  toTableCodes: "Sang bàn",
  revokedSessions: "Phiên đã thu hồi",
  partySize: "Số khách",
  guestCount: "Số khách",
  groupId: "Mã cụm bàn",
  visitSequence: "Lượt thứ",
  lineCount: "Số dòng",
  itemCount: "Số món",
  totalAmountVnd: "Tổng tiền",
  stations: "Quầy",
  quantityBefore: "SL trước",
  quantityAfter: "SL sau",
  quantity: "Số lượng",
  amountDeltaVnd: "Chênh lệch",
  policy: "Chính sách",
  ticketStatus: "Trạng thái phiếu",
  lineNo: "Dòng",
}

const DETAIL_VALUE_LABELS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  portal: {
    admin: "Quản trị",
    receptionist: "Lễ tân",
    "customer-care": "Chăm sóc khách hàng",
    cashier: "Thu ngân",
    waiter: "Phục vụ",
    preparation: "Chế biến",
  },
  result: {
    SUCCESS: "Thành công",
    FAILURE: "Thất bại",
    REVOKED: "Đã thu hồi",
  },
  roleCode: {
    OWNER: "SuperAdmin",
    ADMIN: "Admin",
    RECEPTIONIST: "Lễ tân",
    CASHIER: "Thu ngân",
    WAITER: "Phục vụ",
    BAR: "Bar",
    KITCHEN: "Bếp",
    CUSTOMER_CARE: "CSKH",
  },
  accessLevel: {
    WRITE: "Toàn quyền",
    READ_ONLY: "Chỉ xem",
  },
  policy: {
    STANDARD: "Chuẩn",
    READY_WASTE: "Hủy món đã làm",
    MANUAL: "Thủ công",
  },
  ticketStatus: {
    SUBMITTED: "Mới gửi",
    IN_PROGRESS: "Đang làm",
    READY: "Đã xong",
    COLLECTED: "Đã lấy",
    CANCELLED: "Đã hủy",
  },
  reason: {
    LOGOUT: "Đăng xuất",
    INVALID_CREDENTIALS: "Sai thông tin đăng nhập",
    PORTAL_DENIED: "Sai cổng đăng nhập",
    ACCOUNT_DISABLED: "Tài khoản bị khóa",
    SESSION_REPLACED: "Đăng nhập ở nơi khác",
    SESSION_REVOKED: "Phiên bị thu hồi",
    MANUAL: "Đóng thủ công",
    NOT_IN_CATALOG: "Không còn trong thực đơn",
    TEMPORARILY_UNAVAILABLE: "Tạm hết",
    NOT_SELLABLE: "Ngừng bán",
  },
}

const STATION_LABELS: Readonly<Record<string, string>> = {
  BAR: "Bar",
  KITCHEN: "Bếp",
}

function formatDetailValue(key: string, value: string): string {
  if (key === "stations") {
    return value
      .split(",")
      .map((part) => {
        const trimmed = part.trim()
        return STATION_LABELS[trimmed] ?? trimmed
      })
      .join(", ")
  }
  return DETAIL_VALUE_LABELS[key]?.[value] ?? value
}

/**
 * UI-52: Chuyển các khóa/giá trị kỹ thuật trong chuỗi `detail` của nhật ký
 * sang nhãn tiếng Việt ở tầng hiển thị; khóa hoặc giá trị lạ giữ nguyên văn.
 */
export function fmtAuditDetail(detail: string): string {
  if (!detail) return detail
  return detail
    .split(" · ")
    .map((segment) => {
      const sep = segment.indexOf(": ")
      if (sep === -1) return segment
      const key = segment.slice(0, sep).trim()
      const value = segment.slice(sep + 2).trim()
      const keyLabel = DETAIL_KEY_LABELS[key]
      if (!keyLabel) return segment
      return `${keyLabel}: ${formatDetailValue(key, value)}`
    })
    .join(" · ")
}

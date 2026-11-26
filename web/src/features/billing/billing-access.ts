/**
 * TU-45 — đường dẫn và quyền của khu vực Thanh toán.
 *
 * URL tiếng Việt, đúng quy ước của dự án (`/phucvu`, `/chebien`,
 * `/duyet-huy-mon`). Khu vực này nằm ở gốc router, không trong khung của Lễ
 * tân: người mở nó là người có quyền thu tiền, và Thu ngân không dùng màn Điều
 * phối để làm việc này.
 *
 * Quyền là chốt ở MÁY CHỦ (`requirePermission('payment.collect')`). Hằng số ở
 * đây chỉ để khung ẩn/khoá control và giải thích vì sao — nó không cấp gì.
 */
import type { Permission } from "@/domain/access"

export const BILLING_BASE_PATH = "/thanh-toan"

/** Màn 2 + Màn 3 của một Phiên. */
export function billingSessionPath(visitId: number): string {
  return `${BILLING_BASE_PATH}/phien/${visitId}`
}

/** Quyền xem danh sách và tạm tính: Phục vụ cũng đọc được, họ là người đưa khách xem. */
export const BILLING_READ_PERMISSION: Permission = "order.read"

/** Quyền chốt bill và thu tiền. Phân quyền 15/11: OWNER, ADMIN, CASHIER. */
export const BILLING_COLLECT_PERMISSION: Permission = "payment.collect"

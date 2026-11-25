/**
 * TU-35 — Phân loại hành động cho màn "Nhật ký thao tác".
 *
 * `operation_log` ghi mã kỹ thuật (`RESERVATION_CANCELLED`, `VISIT_TABLES_MOVED`…).
 * Màn hình lọc theo bảy nhóm mà biên bản 15/11 gọi tên. Bản đồ nằm ở đây, ở
 * dạng dữ liệu thuần, để test được mà không cần database và để thêm một hành
 * động mới là thêm một dòng chứ không phải sửa câu SQL.
 *
 * Nhật ký này là append-only: không có endpoint nào sửa hay xoá một dòng, và
 * mọi nơi ghi đều dùng INSERT. Đó là lý do tồn tại của nó — một bản ghi sửa
 * được thì không truy trách nhiệm được.
 */

/** Nhóm lọc, đúng hàng nút trong prototype màn 03. */
export type AuditFilterType =
  | 'booking_cancel'
  | 'table_move'
  | 'phone_reveal'
  | 'discount'
  | 'login'
  | 'permission'
  | 'account'

export interface AuditActionInfo {
  /**
   * `null` = hành động có nhãn tiếng Việt nhưng KHÔNG thuộc nhóm lọc nào.
   *
   * Biên bản 15/11 đặt tên đúng bảy nhóm, và một hành động mới không phải là
   * lý do để dựng nhóm thứ tám hay để nhét nó vào một nhóm sai nghĩa. Dòng vẫn
   * đọc được ở bộ lọc "Tất cả" — nhật ký không giấu một dòng chỉ vì bảng nhóm
   * chưa có chỗ cho nó.
   */
  type: AuditFilterType | null
  /** Chữ hiện ở cột HÀNH ĐỘNG. */
  label: string
}

/**
 * Mã trong `operation_log.action` → nhóm lọc + nhãn tiếng Việt.
 *
 * Hành động không có trong bảng này vẫn được ghi và vẫn đọc được ở bộ lọc
 * "Tất cả"; nó chỉ không thuộc nhóm lọc nào. Cố ý: nhật ký không được giấu
 * một dòng chỉ vì bảng ánh xạ chưa kịp cập nhật.
 */
export const AUDIT_ACTIONS: Readonly<Record<string, AuditActionInfo>> = {
  RESERVATION_CANCELLED: { type: 'booking_cancel', label: 'Hủy booking' },
  WAITLIST_CANCELLED: { type: 'booking_cancel', label: 'Hủy mục chờ' },

  VISIT_TABLES_MOVED: { type: 'table_move', label: 'Đổi bàn' },
  VISIT_TABLES_MERGED: { type: 'table_move', label: 'Ghép bàn' },
  RESERVATION_TABLES_MERGED: { type: 'table_move', label: 'Ghép bàn (booking)' },
  TABLES_SPLIT: { type: 'table_move', label: 'Tách bàn' },
  TABLE_GROUP_FORMED: { type: 'table_move', label: 'Ghép cụm bàn' },
  TABLE_GROUP_MEMBERS_ADDED: { type: 'table_move', label: 'Thêm bàn vào cụm' },
  TABLE_GROUP_DISSOLVED: { type: 'table_move', label: 'Tách cụm bàn' },

  CUSTOMER_PHONE_REVEAL: { type: 'phone_reveal', label: 'Xem SĐT đầy đủ' },
  BOOKING_CALL_INITIATED: { type: 'phone_reveal', label: 'Gọi khách' },

  AUTH_LOGIN_SUCCEEDED: { type: 'login', label: 'Đăng nhập' },
  AUTH_LOGIN_FAILED: { type: 'login', label: 'Đăng nhập thất bại' },
  AUTH_LOGOUT: { type: 'login', label: 'Đăng xuất' },
  // TU-33: bị đẩy ra vì tài khoản đăng nhập ở máy khác.
  AUTH_SESSION_REVOKED: { type: 'login', label: 'Phiên bị thu hồi' },
  AUTH_SESSION_FORCE_REVOKED: { type: 'login', label: 'Buộc đăng xuất thiết bị' },

  // Module Phục vụ 2: duyệt một món là cho phép nó lên máy Phục vụ với một
  // mức giá. Xếp vào nhóm "permission" vì đó là một lần cấp quyền bán, và vì
  // biên bản chưa có nhóm lọc riêng cho danh mục món.
  MENU_ITEM_VERIFIED: { type: 'permission', label: 'Duyệt món vào danh mục' },

  // Module Phục vụ 3: một lần bấm "Gửi đơn". Dòng nhật ký mang người gọi món,
  // Phiên, tổng tiền và mã món — KHÔNG mang nội dung ghi chú từng món, vì ghi
  // chú là ô gõ tự do và đã có lần mang theo tên hay số điện thoại khách.
  // Biên bản chưa có nhóm lọc riêng cho gọi món, và nhóm "Giảm giá / hủy món"
  // nói về việc khác, nên dòng này có nhãn mà không có nhóm: nó đọc được ở bộ
  // lọc "Tất cả" thay vì bị gán vào một nhóm sai nghĩa.
  SALES_ORDER_CREATED: { type: null, label: 'Gửi đơn gọi món' },

  // Module Phục vụ 5. Sửa số lượng không phải giảm giá hay hủy món, nên nó
  // cũng không có nhóm — đọc được ở "Tất cả".
  SALES_ORDER_LINE_ADJUSTED: { type: null, label: 'Sửa số lượng món' },

  // Ba hành động hủy món thì thuộc đúng nhóm mà biên bản đã đặt tên:
  // "Giảm giá / hủy món". Nhóm này rỗng từ 15/11 vì chưa có module gọi món;
  // giờ nó có việc.
  SALES_ORDER_CANCELLATION_REQUESTED: { type: 'discount', label: 'Yêu cầu hủy món' },
  SALES_ORDER_CANCELLATION_APPROVED: { type: 'discount', label: 'Duyệt hủy món' },
  SALES_ORDER_CANCELLATION_REJECTED: { type: 'discount', label: 'Từ chối hủy món' },

  ADMIN_ACCESS_LEVEL_CHANGED: { type: 'permission', label: 'Đổi cấp truy cập' },
  USER_PERMISSIONS_CHANGED: { type: 'permission', label: 'Đổi quyền' },

  USER_ACCOUNT_CREATED: { type: 'account', label: 'Tạo tài khoản' },
  USER_ACCOUNT_LOCKED: { type: 'account', label: 'Khóa tài khoản' },
  USER_ACCOUNT_UNLOCKED: { type: 'account', label: 'Mở khóa tài khoản' },
  USER_PASSWORD_RESET: { type: 'account', label: 'Đặt lại mật khẩu' },
  USER_PASSWORD_CHANGED: { type: 'account', label: 'Đổi mật khẩu' },

  // TU-42: chỉ có trên bản Dev. Không thuộc nhóm lọc nào — đọc ở "Tất cả".
  DEV_CLOCK_CHANGED: { type: null, label: 'Đổi giờ giả lập (Dev)' },
}

export interface AuditFilterDefinition {
  type: AuditFilterType
  label: string
  /** Rỗng = nhóm chưa có hành động nào trong hệ thống. */
  actions: string[]
  unsupportedNote?: string
}

const byType = (type: AuditFilterType): string[] =>
  Object.keys(AUDIT_ACTIONS).filter((action) => AUDIT_ACTIONS[action]?.type === type).sort()

export const AUDIT_FILTERS: readonly AuditFilterDefinition[] = [
  { type: 'booking_cancel', label: 'Hủy booking', actions: byType('booking_cancel') },
  { type: 'table_move', label: 'Đổi bàn', actions: byType('table_move') },
  { type: 'phone_reveal', label: 'Xem SĐT đầy đủ', actions: byType('phone_reveal') },
  // Module Phục vụ 5 điền `actions` cho nhóm này, đúng như 0027 đã dự trù.
  // Giảm giá vẫn chưa có (chưa có module thanh toán), nhưng hủy món thì có, và
  // một ô lọc có việc thì không còn `unsupportedNote`.
  { type: 'discount', label: 'Giảm giá / hủy món', actions: byType('discount') },
  { type: 'login', label: 'Đăng nhập', actions: byType('login') },
  { type: 'permission', label: 'Đổi quyền', actions: byType('permission') },
  { type: 'account', label: 'Tài khoản', actions: byType('account') },
]

/** Mã hành động của một tập nhóm lọc. Rỗng = không lọc (Tất cả). */
export function actionsForTypes(types: readonly string[]): string[] {
  const wanted = new Set(types)
  const actions = AUDIT_FILTERS.filter((filter) => wanted.has(filter.type)).flatMap((filter) => filter.actions)
  return [...new Set(actions)].sort()
}

export function isAuditFilterType(value: unknown): value is AuditFilterType {
  return typeof value === 'string' && AUDIT_FILTERS.some((filter) => filter.type === value)
}

/**
 * Cấu hình nhật ký. Hai giá trị này đang chờ anh Luân trả lời câu C3, nên
 * chúng đọc từ `venue_settings` và chỉ rơi về mặc định khi chưa ai đặt — thay
 * vì viết cứng vào code rồi phải sửa code khi có câu trả lời.
 */
export const AUDIT_RETENTION_SETTING_KEY = 'audit_retention_days'
export const AUDIT_EXPORT_SETTING_KEY = 'audit_export_levels'

/** Tạm 90 ngày theo đề xuất trong thẻ TU-35. */
export const DEFAULT_AUDIT_RETENTION_DAYS = 90
const MIN_RETENTION_DAYS = 1
const MAX_RETENTION_DAYS = 3650

/** Tạm: chỉ SuperAdmin và Admin Edit được xuất file. */
export const DEFAULT_AUDIT_EXPORT_LEVELS: readonly string[] = ['OWNER', 'ADMIN_WRITE']

export function parseRetentionDays(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < MIN_RETENTION_DAYS || parsed > MAX_RETENTION_DAYS) {
    return DEFAULT_AUDIT_RETENTION_DAYS
  }
  return parsed
}

export function parseExportLevels(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string')) {
    return [...DEFAULT_AUDIT_EXPORT_LEVELS]
  }
  return value as string[]
}

/**
 * Cấp của người đang thao tác, viết dưới dạng chuỗi để so với cấu hình:
 * `OWNER`, `ADMIN_WRITE`, `ADMIN_READ_ONLY`, hoặc mã vai trò nhân viên.
 */
export function accessLevelKey(roles: readonly string[], accessLevel: string | null): string {
  if (roles.includes('OWNER')) return 'OWNER'
  if (roles.includes('ADMIN')) return accessLevel === 'READ_ONLY' ? 'ADMIN_READ_ONLY' : 'ADMIN_WRITE'
  return roles[0] ?? 'UNKNOWN'
}

export function canExportAudit(levelKey: string, allowedLevels: readonly string[]): boolean {
  return allowedLevels.includes(levelKey)
}

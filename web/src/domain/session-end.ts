export const SESSION_END_CODES = [
  "SESSION_REPLACED",
  "SESSION_EXPIRED",
  "SESSION_REVOKED",
  "ACCOUNT_LOCKED",
  "SESSION_INVALID",
] as const

export type SessionEndCode = (typeof SESSION_END_CODES)[number]

export function isSessionEndCode(value: unknown): value is SessionEndCode {
  return typeof value === "string" && (SESSION_END_CODES as readonly string[]).includes(value)
}

export function sessionEndMessage(code: string): string {
  switch (code) {
    case "SESSION_REPLACED":
      // Câu chữ do TU-33 chốt. Giữ nguyên để nhân viên gặp cùng một câu ở mọi
      // nơi: trên web, trong tài liệu hướng dẫn và trong thông báo của API.
      return "Tài khoản này vừa được đăng nhập trên thiết bị khác. Phiên đăng nhập hiện tại đã kết thúc."
    case "SESSION_EXPIRED":
      return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại."
    case "SESSION_REVOKED":
      return "Phiên đăng nhập đã bị thu hồi. Vui lòng đăng nhập lại."
    case "ACCOUNT_LOCKED":
      return "Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên."
    default:
      return "Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại."
  }
}

/**
 * Ghi chú kèm theo khi một phiên bị kết thúc đột ngột giữa lúc đang làm việc.
 *
 * Hệ thống hiện KHÔNG có cơ chế lưu nháp: những gì đang gõ dở trong form khi
 * phiên bị thu hồi là mất. Câu này nói đúng điều đó thay vì để nhân viên tự
 * suy ra rằng dữ liệu "chắc là còn" — một lời hứa mà code chưa thực hiện được
 * sẽ dẫn tới mất booking thật khi lễ tân tin vào nó và không nhập lại.
 *
 * Trả về null với các mã kết thúc phiên bình thường (hết hạn), vì khi đó nhân
 * viên không đang gõ dở.
 */
export function sessionEndUnsavedWarning(code: string): string | null {
  switch (code) {
    case "SESSION_REPLACED":
    case "SESSION_REVOKED":
    case "ACCOUNT_LOCKED":
      return "Nội dung đang nhập dở trên máy này không được lưu. Booking đã lưu trước đó vẫn còn nguyên."
    default:
      return null
  }
}

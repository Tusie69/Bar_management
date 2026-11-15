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
      return "Tài khoản của bạn đã được đăng nhập trên một thiết bị khác. Phiên hiện tại đã kết thúc."
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

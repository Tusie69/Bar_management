export type CustomerCallCapability =
  | { enabled: true; href: string }
  | { enabled: false; reason: string }

export function toTelHref(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed || /[^+\d\s().-]/.test(trimmed)) return null
  let normalized = trimmed.replace(/[\s().-]/g, "")
  if (normalized.startsWith("00")) normalized = `+${normalized.slice(2)}`
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) return null
  return `tel:${normalized}`
}

export function customerCallCapability(input: {
  canRevealPhone: boolean
  phoneLast3: string | null
  revealedPhoneE164?: string | null
}): CustomerCallCapability {
  // Permission is checked first so unauthorized users cannot infer whether a customer has a number.
  if (!input.canRevealPhone) {
    return { enabled: false, reason: "Tài khoản không có quyền xem số điện thoại đầy đủ." }
  }
  if (!input.phoneLast3) {
    return { enabled: false, reason: "Booking không có số điện thoại khách hàng." }
  }
  if (!input.revealedPhoneE164) {
    return { enabled: false, reason: "Số điện thoại chưa được mở cho thao tác gọi này." }
  }
  const href = toTelHref(input.revealedPhoneE164)
  if (!href) return { enabled: false, reason: "Backend trả về số điện thoại không hợp lệ." }
  return { enabled: true, href }
}

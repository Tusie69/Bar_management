/** Lowercase, strip Vietnamese diacritics. Mirrors `name_search` columns. */
export function foldVietnamese(input: string): string {
  return input.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase().trim()
}

/** db08 §6: notes must not carry phone numbers (8+ consecutive digits). */
export function noteHasPhoneNumber(note: string): boolean {
  return /\d{8,}/.test(note.replace(/[\s.\-()]/g, ""))
}

export const NOTE_PHONE_ERROR = "Không ghi số điện thoại vào ghi chú"

export function normalizePhone(input: string): string {
  return input.replace(/[^\d+]/g, "")
}

export function isPlausibleVnPhone(input: string): boolean {
  const p = normalizePhone(input)
  return /^(\+84|0)\d{9}$/.test(p)
}

export function maskedPhone(last3: string | null | undefined): string {
  return last3 ? `•••• ••• ${last3}` : "Không có SĐT"
}

export function initials(name: string): string {
  // Drop a trailing note such as "(giả)" so "Lễ tân 1 (giả)" gives "1", not "(".
  const parts = name
    .replace(/\s*\(.*\)\s*$/, "")
    .trim()
    .split(/\s+/)
  if (parts.length === 0) return "?"
  const last = parts[parts.length - 1]
  return (last[0] ?? "?").toUpperCase()
}

export function plural(n: number, unit: string): string {
  return `${n} ${unit}`
}

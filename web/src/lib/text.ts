/** Lowercase, strip Vietnamese diacritics. Mirrors `name_search` columns. */
export function foldVietnamese(input: string): string {
  return input.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase().trim()
}

/** Notes must not carry Vietnamese local, +84, or 0084 phone-number forms. */
export function noteHasPhoneNumber(note: string): boolean {
  const separator = String.raw`[\s.()\-]*`
  const local = new RegExp(String.raw`(?<!\d)0(?:${separator}\d){9}(?!\d)`)
  const international = new RegExp(String.raw`(?<![\d+])(?:\+84|0084)(?:${separator}\d){9}(?!\d)`)
  return local.test(note) || international.test(note)
}

export const NOTE_PHONE_ERROR = "Không ghi số điện thoại vào ghi chú"

export function normalizePhone(input: string): string {
  return input.replace(/[^\d+]/g, "")
}

export function isPlausibleVnPhone(input: string): boolean {
  const trimmed = input.trim()
  if (!trimmed || /[^\d\s().-]/.test(trimmed)) return false
  return /^0\d{9}$/.test(trimmed.replace(/[\s().-]/g, ""))
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

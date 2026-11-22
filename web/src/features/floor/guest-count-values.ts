import type { ReceptionGuestCountValues } from "@/domain/models"

export const guestCountKeys = [
  "arrivedBefore",
  "arrivedAfter",
  "arrivedTotal",
  "bookedTables",
  "bookedGuests",
  "returningGuests",
] as const

export type GuestCountKey = (typeof guestCountKeys)[number]
export type GuestCountDraft = Record<GuestCountKey, string>

export const guestCountDraft = (value: ReceptionGuestCountValues): GuestCountDraft =>
  Object.fromEntries(guestCountKeys.map((key) => [key, String(value[key])])) as GuestCountDraft

export function parseGuestCountDraft(draft: GuestCountDraft): ReceptionGuestCountValues | null {
  const values = {} as Record<GuestCountKey, number>
  for (const key of guestCountKeys) {
    if (!/^\d+$/.test(draft[key])) return null
    const value = Number(draft[key])
    if (!Number.isSafeInteger(value) || value < 0 || value > 4_294_967_295) return null
    values[key] = value
  }
  return values
}

/** Trần của một ô đếm khách: UNSIGNED INT của máy chủ. */
export const GUEST_COUNT_MAX = 4_294_967_295

/**
 * Bấm + hoặc − trên một ô đếm khách.
 *
 * Ô đang trống (hoặc đang chứa thứ không phải số) tính như 0, nên bấm + lần
 * đầu ra 1 chứ không ra chuỗi rỗng. Kẹp trong [0, trần] để nút không bao giờ
 * đẩy ô sang giá trị mà `parseGuestCountDraft` từ chối.
 */
export function stepGuestCountValue(current: string, delta: number): string {
  const base = /^\d+$/.test(current) ? Number(current) : 0
  const next = Math.min(GUEST_COUNT_MAX, Math.max(0, base + delta))
  return String(next)
}

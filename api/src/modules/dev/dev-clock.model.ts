/**
 * TU-42 — phần tính toán thuần của đồng hồ giả lập (không chạm database, test
 * được không cần MySQL).
 *
 * Giờ của quán là Asia/Ho_Chi_Minh, cố định UTC+7, không có giờ mùa hè, nên
 * đổi giờ địa phương ↔ UTC chỉ là cộng trừ 7 tiếng.
 */
import { AppError } from '../../errors/app-error.js'
import { DEV_CLOCK_MAX_OFFSET_MS } from '../../time/application-clock.js'

const VENUE_UTC_OFFSET_MS = 7 * 3_600_000

/** Bốn mốc chọn nhanh trên thẻ TU-42. */
export const DEV_CLOCK_PRESETS = {
  '17:00': 'Mở ca',
  '21:50': 'Sắp tới giờ hẹn',
  '23:30': 'Cao điểm',
  '04:55': 'Cuối ca',
} as const
export type DevClockPreset = keyof typeof DEV_CLOCK_PRESETS

export type DevClockRequest =
  | { kind: 'preset'; preset: DevClockPreset }
  | { kind: 'at'; localDateTime: string }
  | { kind: 'real' }

const localDateTimePattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

export function parseDevClockRequest(body: unknown): DevClockRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new AppError(400, 'INVALID_DEV_CLOCK_PAYLOAD', 'Nội dung phải là một object JSON.')
  }
  const value = body as Record<string, unknown>
  const keys = Object.keys(value)
  if (keys.length !== 1) {
    throw new AppError(400, 'INVALID_DEV_CLOCK_PAYLOAD', 'Gửi đúng một trong: preset, at, mode.')
  }
  if ('preset' in value) {
    if (typeof value.preset !== 'string' || !(value.preset in DEV_CLOCK_PRESETS)) {
      throw new AppError(400, 'INVALID_DEV_CLOCK_PRESET', `preset phải là ${Object.keys(DEV_CLOCK_PRESETS).join(', ')}.`)
    }
    return { kind: 'preset', preset: value.preset as DevClockPreset }
  }
  if ('at' in value) {
    if (typeof value.at !== 'string' || !localDateTimePattern.test(value.at)) {
      throw new AppError(400, 'INVALID_DEV_CLOCK_AT', 'at phải có dạng YYYY-MM-DDTHH:mm (giờ Việt Nam).')
    }
    return { kind: 'at', localDateTime: value.at }
  }
  if ('mode' in value && value.mode === 'real') return { kind: 'real' }
  throw new AppError(400, 'INVALID_DEV_CLOCK_PAYLOAD', 'Gửi đúng một trong: preset, at, mode="real".')
}

/** Giờ địa phương "YYYY-MM-DDTHH:mm" → thời điểm UTC. Ném 400 nếu ngày không có thật. */
export function venueLocalToInstant(localDateTime: string): Date {
  const match = localDateTimePattern.exec(localDateTime)
  if (!match) throw new AppError(400, 'INVALID_DEV_CLOCK_AT', 'at phải có dạng YYYY-MM-DDTHH:mm.')
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [number, number, number, number, number]
  const utcMs = Date.UTC(year, month - 1, day, hour, minute) - VENUE_UTC_OFFSET_MS
  const check = new Date(utcMs + VENUE_UTC_OFFSET_MS)
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day
    || hour > 23 || minute > 59) {
    throw new AppError(400, 'INVALID_DEV_CLOCK_AT', 'Ngày giờ không tồn tại trên lịch.')
  }
  return new Date(utcMs)
}

function venueLocalDate(instant: Date): { year: number; month: number; day: number } {
  const local = new Date(instant.getTime() + VENUE_UTC_OFFSET_MS)
  return { year: local.getUTCFullYear(), month: local.getUTCMonth() + 1, day: local.getUTCDate() }
}

/**
 * Mốc chọn nhanh luôn rơi vào ca "đang mở hoặc sắp mở" theo GIỜ THẬT, để bấm
 * 23:30 lúc 10h sáng nghĩa là 23:30 tối nay chứ không phải tối qua:
 *   - Ngày ca = ngày lịch của (giờ thật − mốc cắt ca). 10:00 ngày 25 → ca 25;
 *     02:00 ngày 26 → vẫn ca 25.
 *   - Giờ trước mốc cắt (04:55) thuộc rạng sáng ngày lịch hôm sau.
 */
export function presetInstant(preset: DevClockPreset, realNow: Date, cutoffHour: number): Date {
  const shiftDay = venueLocalDate(new Date(realNow.getTime() - cutoffHour * 3_600_000))
  const [hour, minute] = preset.split(':').map(Number) as [number, number]
  const dayShift = hour < cutoffHour ? 1 : 0
  return new Date(Date.UTC(shiftDay.year, shiftDay.month - 1, shiftDay.day + dayShift, hour, minute)
    - VENUE_UTC_OFFSET_MS)
}

/** Độ lệch cần đặt để đồng hồ nghiệp vụ chỉ đúng `target` ngay lúc này. */
export function offsetFor(request: DevClockRequest, realNow: Date, cutoffHour: number): number {
  if (request.kind === 'real') return 0
  const target = request.kind === 'preset'
    ? presetInstant(request.preset, realNow, cutoffHour)
    : venueLocalToInstant(request.localDateTime)
  // Lệch chính xác tới mili-giây: ngay sau khi bấm, giờ nghiệp vụ là đúng
  // HH:mm:00.000 rồi trôi tiếp, không hụt nửa giây thành "HH:(mm-1)".
  const offset = target.getTime() - realNow.getTime()
  if (Math.abs(offset) > DEV_CLOCK_MAX_OFFSET_MS) {
    throw new AppError(400, 'DEV_CLOCK_OUT_OF_RANGE', 'Chỉ giả lập được trong khoảng 31 ngày quanh giờ thật.')
  }
  return offset
}

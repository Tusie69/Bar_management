/**
 * The three booking fields migration 0016 added columns for but nobody read:
 * icons, honorific and the Social platform.
 *
 * Icons need no storage of their own. The receptionist's icon picker offers
 * exactly `star` (Bàn sếp) and `pin` (Chỉ định), which are the two boolean
 * columns 0016 added — `is_boss_table` and `is_designated`. `cake` (Sinh nhật)
 * already has `is_birthday`, and the 🔥/🆕 icons are derived from
 * `customer_classification`, so none of them is an icon key a client may send.
 *
 * `social_platform` has a CHECK on its value set, but a CHECK cannot read the
 * source code through the `booking_sources` foreign key, so clearing it when
 * the source is not SOCIAL is this module's job.
 */
import { AppError } from '../../errors/app-error.js'

export type Honorific = 'MR' | 'MS'
export type SocialPlatform = 'FB' | 'IG' | 'TIKTOK' | 'THREADS' | 'GG_REVIEW'
/** Icon keys a client may send; `cake` stays `isBirthday`, 🔥/🆕 stay derived. */
export type BookingIconKey = 'star' | 'pin'

/** Verbatim from `ck_reservations_honorific`. */
export const HONORIFICS: readonly Honorific[] = ['MR', 'MS']
/** Verbatim from `ck_reservations_social_platform`. */
export const SOCIAL_PLATFORMS: readonly SocialPlatform[] = ['FB', 'IG', 'TIKTOK', 'THREADS', 'GG_REVIEW']
export const BOOKING_ICON_KEYS: readonly BookingIconKey[] = ['star', 'pin']
/** The only `booking_sources.code` that may carry a platform. */
export const SOCIAL_SOURCE_CODE = 'SOCIAL'

/** How the icon keys are stored: one boolean column per key. */
export interface BookingIconFlags {
  isBossTable: boolean
  isDesignated: boolean
}

function isHonorific(value: string): value is Honorific {
  return (HONORIFICS as readonly string[]).includes(value)
}

function isSocialPlatform(value: string): value is SocialPlatform {
  return (SOCIAL_PLATFORMS as readonly string[]).includes(value)
}

function isBookingIconKey(value: string): value is BookingIconKey {
  return (BOOKING_ICON_KEYS as readonly string[]).includes(value)
}

/**
 * `undefined` when the client did not send the field (keep what is stored),
 * `null` when it explicitly cleared it.
 */
export function parseHonorific(value: unknown): Honorific | null | undefined {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  if (typeof value !== 'string' || !isHonorific(value)) {
    throw new AppError(400, 'INVALID_HONORIFIC', `Danh xưng chỉ nhận ${HONORIFICS.join(' hoặc ')}.`)
  }
  return value
}

export function parseSocialPlatform(value: unknown): SocialPlatform | null | undefined {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  if (typeof value !== 'string' || !isSocialPlatform(value)) {
    throw new AppError(
      400,
      'INVALID_SOCIAL_PLATFORM',
      `Nền tảng mạng xã hội chỉ nhận ${SOCIAL_PLATFORMS.join(', ')}.`,
    )
  }
  return value
}

/** `undefined` when the field was absent; `null` and `[]` both clear every icon. */
export function parseIconKeys(value: unknown): BookingIconFlags | undefined {
  if (value === undefined) return undefined
  if (value === null) return { isBossTable: false, isDesignated: false }
  if (!Array.isArray(value) || value.length > BOOKING_ICON_KEYS.length) {
    throw new AppError(400, 'INVALID_ICON_KEYS', 'Danh sách icon không hợp lệ.')
  }
  const keys = new Set<BookingIconKey>()
  for (const entry of value) {
    if (typeof entry !== 'string' || !isBookingIconKey(entry)) {
      throw new AppError(
        400,
        'INVALID_ICON_KEYS',
        `Icon chỉ nhận ${BOOKING_ICON_KEYS.join(', ')}; sinh nhật dùng isBirthday.`,
      )
    }
    keys.add(entry)
  }
  return { isBossTable: keys.has('star'), isDesignated: keys.has('pin') }
}

/** The stored booleans, read back as the icon keys the clients speak. */
export function iconKeysFrom(isBossTable: unknown, isDesignated: unknown): BookingIconKey[] {
  const keys: BookingIconKey[] = []
  if (Number(isBossTable ?? 0) !== 0) keys.push('star')
  if (Number(isDesignated ?? 0) !== 0) keys.push('pin')
  return keys
}

export function honorificFrom(value: unknown): Honorific | null {
  return typeof value === 'string' && isHonorific(value) ? value : null
}

export function socialPlatformFrom(value: unknown): SocialPlatform | null {
  return typeof value === 'string' && isSocialPlatform(value) ? value : null
}

/**
 * 0016's opening comment: the API clears the platform whenever the source is
 * not SOCIAL, so a booking moved off Social never keeps a stale platform.
 */
export function resolveSocialPlatform(
  sourceCode: string,
  platform: SocialPlatform | null | undefined,
): SocialPlatform | null {
  if (sourceCode !== SOCIAL_SOURCE_CODE) return null
  return platform ?? null
}

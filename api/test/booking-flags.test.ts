import { describe, expect, it } from 'vitest'

import {
  honorificFrom,
  iconKeysFrom,
  parseHonorific,
  parseIconKeys,
  parseSocialPlatform,
  resolveSocialPlatform,
  socialPlatformFrom,
} from '../src/modules/bookings/booking-flags.js'

describe('0016 booking icons, honorific and Social platform', () => {
  it('tells an absent field apart from an explicit clear', () => {
    expect(parseHonorific(undefined)).toBeUndefined()
    expect(parseHonorific(null)).toBeNull()
    expect(parseHonorific('')).toBeNull()
    expect(parseSocialPlatform(undefined)).toBeUndefined()
    expect(parseSocialPlatform(null)).toBeNull()
    expect(parseIconKeys(undefined)).toBeUndefined()
    expect(parseIconKeys(null)).toEqual({ isBossTable: false, isDesignated: false })
    expect(parseIconKeys([])).toEqual({ isBossTable: false, isDesignated: false })
  })

  it('accepts exactly the values the CHECK constraints allow', () => {
    expect(parseHonorific('MR')).toBe('MR')
    expect(parseHonorific('MS')).toBe('MS')
    for (const platform of ['FB', 'IG', 'TIKTOK', 'THREADS', 'GG_REVIEW']) {
      expect(parseSocialPlatform(platform)).toBe(platform)
    }
  })

  it('maps the two icon keys onto their own columns', () => {
    expect(parseIconKeys(['star'])).toEqual({ isBossTable: true, isDesignated: false })
    expect(parseIconKeys(['pin'])).toEqual({ isBossTable: false, isDesignated: true })
    expect(parseIconKeys(['pin', 'star'])).toEqual({ isBossTable: true, isDesignated: true })
    expect(iconKeysFrom(1, 0)).toEqual(['star'])
    expect(iconKeysFrom(0, 1)).toEqual(['pin'])
    expect(iconKeysFrom(1, 1)).toEqual(['star', 'pin'])
    expect(iconKeysFrom(0, 0)).toEqual([])
  })

  it('rejects a bad value with a 400 of its own code', () => {
    expect(() => parseHonorific('mr')).toThrowError(
      expect.objectContaining({ status: 400, code: 'INVALID_HONORIFIC' }),
    )
    expect(() => parseHonorific('MRS')).toThrowError(expect.objectContaining({ code: 'INVALID_HONORIFIC' }))
    expect(() => parseSocialPlatform('FACEBOOK')).toThrowError(
      expect.objectContaining({ status: 400, code: 'INVALID_SOCIAL_PLATFORM' }),
    )
    expect(() => parseIconKeys('star')).toThrowError(
      expect.objectContaining({ status: 400, code: 'INVALID_ICON_KEYS' }),
    )
    expect(() => parseIconKeys(['star', 'pin', 'star'])).toThrowError(
      expect.objectContaining({ code: 'INVALID_ICON_KEYS' }),
    )
  })

  it('keeps the birthday icon out of iconKeys, where isBirthday already owns it', () => {
    expect(() => parseIconKeys(['cake'])).toThrowError(expect.objectContaining({ code: 'INVALID_ICON_KEYS' }))
    expect(() => parseIconKeys(['fire'])).toThrowError(expect.objectContaining({ code: 'INVALID_ICON_KEYS' }))
  })

  it('clears the platform for every source but SOCIAL', () => {
    expect(resolveSocialPlatform('SOCIAL', 'IG')).toBe('IG')
    expect(resolveSocialPlatform('SOCIAL', null)).toBeNull()
    expect(resolveSocialPlatform('SOCIAL', undefined)).toBeNull()
    expect(resolveSocialPlatform('HOTLINE', 'IG')).toBeNull()
    expect(resolveSocialPlatform('STAFF', 'FB')).toBeNull()
  })

  it('reads a legacy NULL column back as "nothing set"', () => {
    expect(honorificFrom(null)).toBeNull()
    expect(socialPlatformFrom(null)).toBeNull()
    expect(honorificFrom('nonsense')).toBeNull()
    expect(socialPlatformFrom('nonsense')).toBeNull()
    expect(iconKeysFrom(null, null)).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'

import { offsetFor, parseDevClockRequest, presetInstant, venueLocalToInstant } from '../src/modules/dev/dev-clock.model.js'
import {
  applicationNow,
  getDevClockOffsetMs,
  mysqlSessionTimestampSql,
  setDevClockOffsetMs,
} from '../src/time/application-clock.js'

// Giờ Việt Nam = UTC+7. 10:00 sáng 25/11/2026 = 03:00Z.
const morning = new Date('2026-11-25T03:00:00.000Z')
const lateNight = new Date('2026-11-25T19:00:00.000Z') // 02:00 rạng sáng 26/11

describe('TU-42 mốc chọn nhanh', () => {
  it('bấm 23:30 lúc 10h sáng = 23:30 tối nay', () => {
    expect(presetInstant('23:30', morning, 5).toISOString()).toBe('2026-11-25T16:30:00.000Z')
  })

  it('04:55 thuộc rạng sáng hôm sau của cùng ca', () => {
    expect(presetInstant('04:55', morning, 5).toISOString()).toBe('2026-11-25T21:55:00.000Z')
  })

  it('lúc 02:00 rạng sáng vẫn tính là ca hôm trước', () => {
    expect(presetInstant('17:00', lateNight, 5).toISOString()).toBe('2026-11-25T10:00:00.000Z')
    expect(presetInstant('04:55', lateNight, 5).toISOString()).toBe('2026-11-25T21:55:00.000Z')
  })

  it('độ lệch đưa giờ nghiệp vụ tới đúng mốc, Giờ thật = 0', () => {
    const real = new Date('2026-11-25T03:00:00.400Z')
    expect(offsetFor({ kind: 'preset', preset: '17:00' }, real, 5)).toBe(7 * 3_600_000 - 400)
    expect(offsetFor({ kind: 'real' }, real, 5)).toBe(0)
  })
})

describe('TU-42 giờ tự nhập', () => {
  it('đổi giờ Việt Nam sang UTC', () => {
    expect(venueLocalToInstant('2026-11-28T21:50').toISOString()).toBe('2026-11-28T14:50:00.000Z')
  })

  it('từ chối ngày không có thật và ngoài 31 ngày', () => {
    expect(() => venueLocalToInstant('2026-02-30T21:00')).toThrow()
    expect(() => offsetFor({ kind: 'at', localDateTime: '2027-03-01T21:00' }, morning, 5)).toThrow(/31 ngày/)
  })

  it('payload phải đúng một khoá hợp lệ', () => {
    expect(parseDevClockRequest({ preset: '21:50' })).toEqual({ kind: 'preset', preset: '21:50' })
    expect(parseDevClockRequest({ mode: 'real' })).toEqual({ kind: 'real' })
    expect(() => parseDevClockRequest({ preset: '22:00' })).toThrow()
    expect(() => parseDevClockRequest({ preset: '21:50', mode: 'real' })).toThrow()
    expect(() => parseDevClockRequest({ at: '2026-11-25 21:50' })).toThrow()
  })
})

describe('TU-42 đồng hồ ngoài bản Dev', () => {
  it('không đặt được độ lệch khi APP_ENV khác dev', () => {
    // Môi trường test là APP_ENV=local.
    expect(() => setDevClockOffsetMs(60_000)).toThrow(/APP_ENV=dev/)
    expect(getDevClockOffsetMs()).toBe(0)
    expect(Math.abs(applicationNow().getTime() - Date.now())).toBeLessThan(1000)
  })

  it('độ lệch 0 trả MySQL về giờ thật của nó', () => {
    expect(mysqlSessionTimestampSql()).toBe('SET timestamp = DEFAULT')
  })
})

describe('TU-42 đồng hồ trên bản Dev', () => {
  it('cộng độ lệch vào giờ nghiệp vụ và câu SET timestamp', async () => {
    const { vi } = await import('vitest')
    vi.resetModules()
    vi.stubEnv('APP_ENV', 'dev')
    vi.stubEnv('DB_NAME', 'gam21_platform_dev')
    try {
      const clock = await import('../src/time/application-clock.js')
      clock.setDevClockOffsetMs(7 * 3_600_000)
      const drift = clock.applicationNow().getTime() - Date.now() - 7 * 3_600_000
      expect(Math.abs(drift)).toBeLessThan(1000)
      expect(clock.mysqlSessionTimestampSql(1_000_000)).toBe(`SET timestamp = ${((1_000_000 + 7 * 3_600_000) / 1000).toFixed(3)}`)
      expect(() => clock.setDevClockOffsetMs(40 * 86_400_000)).toThrow(RangeError)
      clock.setDevClockOffsetMs(0)
      expect(clock.mysqlSessionTimestampSql()).toBe('SET timestamp = DEFAULT')
    } finally {
      vi.unstubAllEnvs()
      vi.resetModules()
    }
  })
})

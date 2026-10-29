import { describe, expect, it } from 'vitest'

import {
  formatDailyBookingText,
  type BookingExportMetadata,
  type DailyBookingTextInput,
  type DailyBookingTextItem,
} from '../src/modules/bookings/booking-export.js'

const metadata: BookingExportMetadata = {
  bossTable: false,
  returningCustomer: null,
  designated: false,
  birthday: false,
  round: null,
}

function booking(
  id: number,
  tableCodes: string[],
  options: Partial<DailyBookingTextItem> = {},
): DailyBookingTextItem {
  const zoneCode = tableCodes[0]?.startsWith('BAR') ? 'BAR' : (tableCodes[0]?.[0] ?? 'A')
  return {
    id,
    guestName: `Khách ${id}`,
    partySize: 2,
    expectedAt: new Date('2026-10-31T13:00:00.000Z'),
    checkedInAt: null,
    status: 'BOOKED',
    tables: tableCodes.map((code) => ({ code, zoneCode, zoneName: `Khu ${zoneCode}` })),
    metadata,
    ...options,
  }
}

function input(bookings: DailyBookingTextItem[], options: Partial<DailyBookingTextInput> = {}): DailyBookingTextInput {
  return {
    businessDate: '2026-10-31',
    bookings,
    waitlistCount: 0,
    outTables: [],
    arrivalCutoff: null,
    ...options,
  }
}

describe('daily Zalo booking text formatter', () => {
  it('K1 derives the Vietnamese weekday from businessDate without the runtime timezone', () => {
    expect(formatDailyBookingText(input([]))).toMatch(/^Danh sách bàn đặt 21Gam thứ Bảy, 31\/10\/2026\n/)
  })

  it('K2 keeps the confirmed zone and table order, including combined B and Bar tables', () => {
    const text = formatDailyBookingText(input([
      booking(1, ['A10']),
      booking(2, ['A2']),
      booking(3, ['B21', 'B22']),
      booking(4, ['B11', 'B12']),
      booking(5, ['C5']),
      booking(6, ['BAR20', 'BAR21']),
      booking(7, ['BAR01', 'BAR02']),
      booking(8, ['A7']),
    ]))
    expect(text.indexOf('KHU A')).toBeLessThan(text.indexOf('KHU B'))
    expect(text.indexOf('KHU B')).toBeLessThan(text.indexOf('KHU C'))
    expect(text.indexOf('KHU C')).toBeLessThan(text.indexOf('QUẦY BAR'))
    expect(text.indexOf('A2:')).toBeLessThan(text.indexOf('A10:'))
    expect(text.indexOf('A10:')).toBeLessThan(text.indexOf('A7:'))
    expect(text.indexOf('B1:')).toBeLessThan(text.indexOf('B2:'))
    expect(text.indexOf('1+2:')).toBeLessThan(text.indexOf('20+21:'))
  })

  it('K3 uses the real waitlist count supplied by the read model', () => {
    expect(formatDailyBookingText(input([], { waitlistCount: 2 }))).toContain('BC (Bàn Chờ +2)')
  })

  it('K4 separates checked-in, out-of-service, cancelled and active totals', () => {
    const checkedIn = booking(1, ['A1'], {
      partySize: 4,
      status: 'CHECKED_IN',
      checkedInAt: new Date('2026-10-31T13:15:00.000Z'),
    })
    const cancelled = booking(2, ['B3'], { partySize: 9, status: 'CANCELLED' })
    const text = formatDailyBookingText(input([checkedIn, cancelled], {
      outTables: [{ code: 'C4', zoneCode: 'C', zoneName: 'Khu C' }],
    }))
    expect(text).toContain('A1: 20:00 · Khách 1 · 4 khách ✅')
    expect(text).toMatch(/BÀN OUT\nC4/)
    expect(text).toMatch(/BÀN HUỶ\nB3:/)
    expect(text).toContain('Tổng bàn đặt: 1')
    expect(text).toContain('Tổng khách đặt: 4')
    expect(text).toContain('Tổng khách đã đến: 4')
  })

  it('prints only explicit icon metadata and never infers it from names', () => {
    const explicit = booking(1, ['A1'], {
      metadata: { bossTable: true, returningCustomer: true, designated: true, birthday: true, round: 2 },
    })
    const suspiciousName = booking(2, ['A2'], { guestName: 'Boss khách quen sinh nhật vòng 1' })
    const text = formatDailyBookingText(input([explicit, suspiciousName]))
    expect(text).toContain('⭐️ 🔥 📌 🎂 2️⃣')
    expect(text.match(/⭐️/g)).toHaveLength(1)
    expect(text.match(/🔥/g)).toHaveLength(1)
    expect(text.match(/🎂/g)).toHaveLength(1)
    expect(text).not.toContain('1️⃣')
  })

  it('K5 uses an explicit privacy allowlist and redacts phone-like guest text', () => {
    const leakedShape = {
      ...booking(1, ['A1'], { guestName: 'Khách 0987 654 321' }),
      phoneNumber: '+84987654321',
      phoneLast3: '321',
      note: 'gọi 0901234567',
    }
    const text = formatDailyBookingText(input([leakedShape]))
    expect(text).toContain('Khách [đã ẩn SĐT]')
    expect(text).not.toContain('0987')
    expect(text).not.toContain('+849')
    expect(text).not.toContain('321')
    expect(text).not.toContain('0901234567')
  })

  it('reports unresolved statistics instead of fabricating zero values', () => {
    const text = formatDailyBookingText(input([booking(1, ['A1'])]))
    expect(text).toContain('Khách vào trước 9h30: Chưa xác nhận nghiệp vụ')
    expect(text).toContain('Khách vào sau 9h30: Chưa xác nhận nghiệp vụ')
    expect(text).toContain('Bàn khách quen O: Chưa xác nhận nghiệp vụ')
    expect(text).toContain('Bàn khách mới N: Chưa xác nhận nghiệp vụ')
  })

  it('does not drop bookings from a catalog zone outside the confirmed fixed list', () => {
    const otherZone = booking(1, ['T1'], {
      tables: [{ code: 'T1', zoneCode: 'MAIN', zoneName: 'Sảnh chính' }],
    })
    const text = formatDailyBookingText(input([otherZone]))
    expect(text).toContain('KHU Sảnh chính')
    expect(text).toContain('T1:')
  })
})

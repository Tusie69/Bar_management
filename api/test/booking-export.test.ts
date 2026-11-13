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
    sourceCode: 'HOTLINE',
    socialPlatform: null,
    honorific: null,
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
    arrivalCutoff: { hour: 21, minute: 30, basis: 'EXPECTED_AT', atCutoff: 'BEFORE' },
    ...options,
  }
}

describe('daily Zalo booking text formatter', () => {
  it('K1 derives the Vietnamese weekday from businessDate without the runtime timezone', () => {
    expect(formatDailyBookingText(input([]))).toMatch(/^Danh sách bàn đặt 21Gam T7, 31\/10\n/)
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
    expect(text.indexOf('-A2 (sofa):')).toBeLessThan(text.indexOf('-A10:'))
    expect(text.indexOf('-A10:')).toBeLessThan(text.indexOf('-A7:'))
    expect(text.indexOf('-B1 (sofa):')).toBeLessThan(text.indexOf('-B2 (sofa):'))
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
    expect(text).toContain('-A1 (sofa): Khách 1 4p 20h00 (hotline) ✅')
    expect(text).toContain('Bàn Out: 1')
    expect(text).toContain('Bàn Huỷ: 1')
    expect(text).toContain('Tổng bàn đặt/ Tổng khách đặt: 1/4')
    expect(text).toContain('Tổng khách đã đến: 4')
  })

  it('prints only explicit icon metadata and never infers it from names', () => {
    const explicit = booking(1, ['A1'], {
      metadata: { bossTable: true, returningCustomer: true, designated: true, birthday: true, round: 2 },
    })
    const suspiciousName = booking(2, ['A2'], { guestName: 'Boss khách quen sinh nhật vòng 1' })
    const text = formatDailyBookingText(input([explicit, suspiciousName]))
    expect(text).toContain('-A1 (sofa): Khách 1 2p 20h00 (hotline) ⭐️ 🔥 📌 🎂 2️⃣')
    expect(text).toContain('-A2 (sofa): Boss khách quen sinh nhật vòng 1 2p 20h00 (hotline)\n')
    expect(text).not.toContain('(hotline) 1️⃣')
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

  it('reports verified zero values and keeps unclassified bookings out of O/N', () => {
    const text = formatDailyBookingText(input([booking(1, ['A1'])]))
    expect(text).toContain('Lượng khách vào trước/sau 9h30: 2/0')
    expect(text).toContain('Bàn khách quen O: 0')
    expect(text).toContain('Bàn khách mới N: 0')
  })

  it('classifies every confirmed 21:30 expected_at boundary including post-midnight bookings', () => {
    const text = formatDailyBookingText(input([
      booking(1, ['A1'], { partySize: 1, expectedAt: new Date('2026-10-31T13:00:00.000Z') }),
      booking(2, ['A2'], { partySize: 2, expectedAt: new Date('2026-10-31T14:29:00.000Z') }),
      booking(3, ['A3'], { partySize: 3, expectedAt: new Date('2026-10-31T14:30:00.000Z') }),
      booking(4, ['A4'], { partySize: 4, expectedAt: new Date('2026-10-31T14:31:00.000Z') }),
      booking(5, ['A5'], { partySize: 5, expectedAt: new Date('2026-10-31T16:59:00.000Z') }),
      booking(6, ['A6'], { partySize: 6, expectedAt: new Date('2026-10-31T17:30:00.000Z') }),
    ]))
    // BE-04: the 21:30 booking of 3 now counts before the cutoff, not after.
    expect(text).toContain('Lượng khách vào trước/sau 9h30: 6/15')
  })

  it('uses expected_at even when check-in happens on the other side of the cutoff', () => {
    const text = formatDailyBookingText(input([
      booking(1, ['A1'], {
        partySize: 2,
        expectedAt: new Date('2026-10-31T14:20:00.000Z'),
        checkedInAt: new Date('2026-10-31T15:00:00.000Z'),
      }),
      booking(2, ['A2'], {
        partySize: 7,
        expectedAt: new Date('2026-10-31T14:40:00.000Z'),
        checkedInAt: new Date('2026-10-31T14:00:00.000Z'),
      }),
    ]))
    expect(text).toContain('Lượng khách vào trước/sau 9h30: 2/7')
  })

  it('counts each multi-table booking once and aggregates manual O/N only', () => {
    const text = formatDailyBookingText(input([
      booking(1, ['A1', 'A2'], { metadata: { ...metadata, returningCustomer: true } }),
      booking(2, ['B3'], { metadata: { ...metadata, returningCustomer: false } }),
      booking(3, ['C4'], { metadata }),
    ]))
    expect(text).toContain('Tổng bàn đặt/ Tổng khách đặt: 3/6')
    expect(text).toContain('Bàn khách quen O: 1')
    expect(text).toContain('Bàn khách mới N: 1')
  })

  it('does not drop bookings from a catalog zone outside the confirmed fixed list', () => {
    const otherZone = booking(1, ['T1'], {
      tables: [{ code: 'T1', zoneCode: 'MAIN', zoneName: 'Sảnh chính' }],
    })
    const text = formatDailyBookingText(input([otherZone]))
    expect(text).toContain('KHU Sảnh chính')
    expect(text).toContain('T1:')
  })

  it('matches the approved compact Zalo layout, including empty tables, source and honorific', () => {
    const text = formatDailyBookingText(input([
      booking(1, ['A6'], {
        guestName: 'abc', partySize: 4, status: 'CHECKED_IN', honorific: 'MR',
        expectedAt: new Date('2026-11-01T14:20:00.000Z'),
      }),
      booking(2, ['BAR09', 'BAR10'], {
        guestName: 'vũ', partySize: 3, sourceCode: 'SOCIAL', socialPlatform: 'FB',
        expectedAt: new Date('2026-11-01T14:15:00.000Z'),
      }),
    ], { businessDate: '2026-11-01' }))

    expect(text).toContain('Danh sách bàn đặt 21Gam CN, 1/11\n\nKHU A')
    expect(text).toContain('-BC (Bàn Chờ +0):\n\n-A1 (sofa):')
    expect(text).toContain('-A6 (sofa): Mr abc 4p 21h20 (hotline) ✅')
    expect(text).toContain('QUẦY BAR\n\n-1+2:')
    expect(text).toContain('-9+10: vũ 3p 21h15 (FB)')
    expect(text).toContain('_____\nBàn Out: 0\n\nBàn Huỷ: 0')
    expect(text.match(/Danh sách bàn đặt 21Gam CN, 1\/11/g)).toHaveLength(2)
    expect(text).toContain('Lượng khách vào trước/sau 9h30: 7/0')
    expect(text).toContain('⭐️Bàn sếp\n🔥Khách quen\n📌Chỉ định\n🎂Sinh nhật\n✅bàn đã tới')
  })
})

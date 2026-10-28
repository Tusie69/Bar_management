import { describe, expect, it } from 'vitest'

import { formatBookingExport, type BookingExportItem } from '../src/modules/bookings/booking-export.js'

describe('booking TXT export', () => {
  it('groups by venue zones, totals unique tables and guests, and excludes phone data', () => {
    const items: BookingExportItem[] = [
      {
        id: 1,
        guestName: 'Khách A',
        partySize: 4,
        expectedAt: new Date('2030-10-24T14:00:00.000Z'),
        status: 'BOOKED',
        note: 'Sinh nhật\nchuẩn bị bánh',
        tables: [{ code: 'A1', zoneCode: 'A', zoneName: 'Khu A' }],
      },
      {
        id: 2,
        guestName: 'Khách Bar',
        partySize: 2,
        expectedAt: new Date('2030-10-24T17:30:00.000Z'),
        status: 'CHECKED_IN',
        note: null,
        tables: [
          { code: 'BAR01', zoneCode: 'BAR', zoneName: 'Quầy Bar' },
          { code: 'BAR02', zoneCode: 'BAR', zoneName: 'Quầy Bar' },
        ],
      },
    ]
    const text = formatBookingExport('2030-10-24', items)
    expect(text).toContain('KHU A')
    expect(text).toContain('QUẦY BAR')
    expect(text).toContain('A1 | 21:00 | Khách A | 4 khách | Đang đặt | Ghi chú: Sinh nhật chuẩn bị bánh')
    expect(text).toContain('2 booking | 3 bàn đã gán | 6 khách')
    expect(text.toLowerCase()).not.toContain('điện thoại:')
    expect(text).not.toMatch(/\b0\d{9}\b/)
  })

  it('keeps unassigned and cross-zone bookings explicit in the MVP format', () => {
    const text = formatBookingExport('2030-10-24', [
      {
        id: 1,
        guestName: 'Chưa gán',
        partySize: 3,
        expectedAt: new Date('2030-10-24T14:00:00.000Z'),
        status: 'BOOKED',
        note: null,
        tables: [],
      },
      {
        id: 2,
        guestName: 'Liên khu',
        partySize: 8,
        expectedAt: new Date('2030-10-24T15:00:00.000Z'),
        status: 'BOOKED',
        note: null,
        tables: [
          { code: 'A1', zoneCode: 'A', zoneName: 'Khu A' },
          { code: 'B1', zoneCode: 'B', zoneName: 'Khu B' },
        ],
      },
    ])
    expect(text).toContain('CHƯA GÁN BÀN')
    expect(text).toContain('LIÊN KHU')
  })
})

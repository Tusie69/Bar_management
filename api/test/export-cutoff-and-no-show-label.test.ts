/**
 * BE-04 and BE-05 — the 21:30 arrival boundary and the no-show label.
 *
 * BE-04: `arrivalCounts` used `expectedAt < cutoff`, with `atCutoff: 'AFTER'`
 * and a "trước 21:30" label, so a booking at exactly 21:30 counted as arriving
 * after it. S2 #3 locks the opposite: exactly 21:30 belongs to before-or-equal.
 * Predicate, metadata and label have to move together, or the text would count
 * 21:30 in a bucket whose own label denies it.
 *
 * BE-05: the export still printed the old "KHÔNG ĐẾN" while the UI, and the web
 * mock's own export, had already settled on "Không tới". Only wording changes
 * here: the NO_SHOW enum, error codes, permissions and thresholds stay as they
 * are.
 */
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

function booking(id: number, expectedAt: string, partySize: number, status: DailyBookingTextItem['status'] = 'BOOKED'): DailyBookingTextItem {
  return {
    id,
    guestName: `Khách ${id}`,
    partySize,
    expectedAt: new Date(expectedAt),
    checkedInAt: null,
    status,
    tables: [{ code: `A${id}`, zoneCode: 'A', zoneName: 'Khu A' }],
    metadata,
  }
}

function input(bookings: DailyBookingTextItem[]): DailyBookingTextInput {
  return {
    businessDate: '2026-10-31',
    bookings,
    waitlistCount: 0,
    outTables: [],
    arrivalCutoff: { hour: 21, minute: 30, basis: 'EXPECTED_AT', atCutoff: 'BEFORE' },
  }
}

function counts(text: string): { before: string | undefined; after: string | undefined } {
  return {
    before: /Khách vào trước\/bằng 21:30: (\d+)/.exec(text)?.[1],
    after: /Khách vào sau 21:30: (\d+)/.exec(text)?.[1],
  }
}

describe('BE-04 arrival cutoff boundary', () => {
  // 21:30 local is 14:30 UTC on this business date.
  it('counts the instant before, at and after the cutoff on the approved side', () => {
    const text = formatDailyBookingText(input([
      booking(1, '2026-10-31T14:29:59.999Z', 1),
      booking(2, '2026-10-31T14:30:00.000Z', 2),
      booking(3, '2026-10-31T14:30:00.001Z', 4),
    ]))
    // Exactly 21:30 belongs with before, so before = 1 + 2 and after = 4.
    expect(counts(text)).toEqual({ before: '3', after: '4' })
  })

  it('labels the bucket as before-or-equal so the text matches the rule', () => {
    const text = formatDailyBookingText(input([booking(1, '2026-10-31T14:30:00.000Z', 2)]))
    expect(text).toContain('Khách vào trước/bằng 21:30: 2')
    expect(text).toContain('Khách vào sau 21:30: 0')
    expect(text).not.toContain('Khách vào trước 21:30')
  })

  it('keeps the total guest count split across the two buckets', () => {
    const text = formatDailyBookingText(input([
      booking(1, '2026-10-31T13:00:00.000Z', 3),
      booking(2, '2026-10-31T14:30:00.000Z', 5),
      booking(3, '2026-10-31T17:30:00.000Z', 7),
    ]))
    const { before, after } = counts(text)
    expect(Number(before) + Number(after)).toBe(15)
    expect(before).toBe('8')
  })
})

describe('BE-05 no-show label in the export', () => {
  it('prints the settled label and not the old one', () => {
    const text = formatDailyBookingText(input([booking(1, '2026-10-31T13:00:00.000Z', 2, 'NO_SHOW')]))
    expect(text).toContain('KHÔNG TỚI')
    expect(text).not.toContain('KHÔNG ĐẾN')
  })
})

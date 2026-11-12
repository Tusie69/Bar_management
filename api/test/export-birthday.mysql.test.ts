/**
 * The Zalo export never showed the birthday icon.
 *
 * `reservations.is_birthday` is real data: the booking forms send it, the floor
 * projection turns it into a BIRTHDAY flag, and the export formatter already
 * renders 🎂 for `metadata.birthday`. But the export query never selected the
 * column and the mapping hardcoded `birthday: false`, so the icon could not
 * appear for any booking.
 *
 * Unlike bossTable, designated and round — which have no column at all and are
 * part of B01, still waiting on the PO — birthday needs no new field and no
 * decision, only the value it already has.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createBooking } from '../src/modules/bookings/booking.repository.js'
import { formatDailyBookingText, getDailyBookingTextInput } from '../src/modules/bookings/booking-export.js'
import { actor, businessDate, clearFixture, initializeFixture, resetFixture } from './support/integration-fixture.js'

const mysqlDescribe = process.env.RUN_MYSQL_INTEGRATION === '1' && /_test$/.test(process.env.DB_NAME ?? '')
  ? describe
  : describe.skip

const now = new Date(`${businessDate}T19:00:00+07:00`)

function input(guestName: string, time: string, extra: Record<string, unknown> = {}) {
  return {
    guestName,
    partySize: 2,
    expectedAt: `${businessDate}T${time}:00+07:00`,
    businessDate,
    sourceCode: 'HOTLINE',
    ...extra,
  }
}

async function exportText(): Promise<string> {
  return formatDailyBookingText(await getDailyBookingTextInput(actor, businessDate))
}

/** The icons the formatter appends to one booking's line. */
function iconsFor(text: string, guestName: string): string {
  const line = text.split('\n').find((candidate) => candidate.includes(guestName)) ?? ''
  return line.slice(line.indexOf(guestName) + guestName.length).trim()
}

mysqlDescribe('daily export birthday icon', () => {
  beforeAll(initializeFixture)
  beforeEach(resetFixture)
  afterAll(clearFixture)

  it('marks a birthday booking with the cake icon', async () => {
    await createBooking(actor, input('Khach sinh nhat', '21:00', { isBirthday: true }), now)
    const text = await exportText()
    expect(iconsFor(text, 'Khach sinh nhat')).toContain('🎂')
  })

  it('leaves a booking without a birthday unmarked', async () => {
    await createBooking(actor, input('Khach thuong', '21:00'), now)
    const text = await exportText()
    expect(iconsFor(text, 'Khach thuong')).not.toContain('🎂')
  })

  it('combines the birthday icon with the returning-guest icon', async () => {
    await createBooking(actor, input('Khach quen sinh nhat', '21:00', {
      isBirthday: true, classification: 'RETURNING',
    }), now)
    const icons = iconsFor(await exportText(), 'Khach quen sinh nhat')
    expect(icons).toContain('🔥')
    expect(icons).toContain('🎂')
  })

  it('does not invent the icons that have no column yet', async () => {
    // bossTable, designated and round belong to B01 and stay off until the PO decides.
    await createBooking(actor, input('Khach khong co co', '21:00', { isBirthday: true }), now)
    const icons = iconsFor(await exportText(), 'Khach khong co co')
    expect(icons).not.toContain('⭐️')
    expect(icons).not.toContain('📌')
    expect(icons).not.toContain('1️⃣')
    expect(icons).not.toContain('2️⃣')
  })
})

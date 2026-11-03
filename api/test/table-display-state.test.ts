import { describe, expect, it } from 'vitest'

import {
  deriveTableDisplayState,
  type TableDisplayStateInput,
} from '../src/modules/tables/table-display-state.js'
import { groupDisplayCode } from '../src/modules/tables/floor-projection.repository.js'

const thresholds = { upcomingMinutes: 10, lateAfterMinutes: 15, noShowAfterMinutes: 30 }

function input(now: string, overrides: Partial<TableDisplayStateInput> = {}): TableDisplayStateInput {
  return {
    catalogState: 'ACTIVE',
    isSpare: false,
    activeVisit: null,
    reservation: {
      status: 'BOOKED',
      expectedAt: '2026-11-02T14:30:00.000Z', // 21:30 Asia/Ho_Chi_Minh
      businessDate: '2026-11-02',
    },
    businessDate: '2026-11-02',
    now: new Date(now),
    thresholds,
    ...overrides,
  }
}

describe('table display state engine', () => {
  it.each([[1, '◆A'], [2, '◆B'], [26, '◆Z'], [27, '◆AA'], [52, '◆AZ']] as const)(
    'maps persisted group symbol %i to %s',
    (symbolNo, displayCode) => expect(groupDisplayCode(symbolNo)).toBe(displayCode),
  )
  it.each([
    ['2026-11-02T14:19:00.000Z', 'BOOKED', 'SCHEDULED'],
    ['2026-11-02T14:20:00.000Z', 'UPCOMING', 'ARRIVING'],
    ['2026-11-02T14:30:00.000Z', 'UPCOMING', 'ARRIVING'],
    ['2026-11-02T14:45:00.000Z', 'UPCOMING', 'WAITING'],
    ['2026-11-02T14:45:01.000Z', 'LATE', 'LATE'],
    ['2026-11-02T14:59:59.999Z', 'LATE', 'LATE'],
    ['2026-11-02T15:00:00.000Z', 'NO_SHOW', 'NO_SHOW'],
  ] as const)('derives %s as %s', (now, displayState, arrivalPhase) => {
    expect(deriveTableDisplayState(input(now))).toMatchObject({ displayState, arrivalPhase })
  })

  it('keeps a 00:30 booking on the previous business date across midnight', () => {
    const reservation = {
      status: 'BOOKED' as const,
      expectedAt: '2026-11-02T17:30:00.000Z', // 00:30 on 03/11 in venue time
      businessDate: '2026-11-02',
    }
    expect(deriveTableDisplayState(input('2026-11-02T17:20:00.000Z', { reservation })).displayState)
      .toBe('UPCOMING')
    expect(deriveTableDisplayState(input('2026-11-02T18:00:00.000Z', { reservation })).displayState)
      .toBe('NO_SHOW')
  })

  it('shows a persisted late confirmation before the no-show threshold', () => {
    expect(deriveTableDisplayState(input('2026-11-02T14:42:00.000Z', {
      reservation: {
        status: 'BOOKED',
        expectedAt: '2026-11-02T14:30:00.000Z',
        businessDate: '2026-11-02',
        lateConfirmedAt: '2026-11-02T14:42:00.000Z',
      },
    }))).toMatchObject({ displayState: 'LATE_CONFIRMED', arrivalPhase: 'LATE_CONFIRMED', minutesLate: 12 })
  })

  it.each([
    ['2026-11-02T14:42:00.000Z', 'LATE_CONFIRMED'],
    ['2026-11-02T14:45:00.000Z', 'LATE_CONFIRMED'],
    ['2026-11-02T14:59:59.999Z', 'LATE_CONFIRMED'],
    ['2026-11-02T15:00:00.000Z', 'NO_SHOW'],
    ['2026-11-02T15:01:00.000Z', 'NO_SHOW'],
  ] as const)('applies Option A at %s as %s', (now, displayState) => {
    expect(deriveTableDisplayState(input(now, {
      reservation: {
        status: 'BOOKED',
        expectedAt: '2026-11-02T14:30:00.000Z',
        businessDate: '2026-11-02',
        lateConfirmedAt: '2026-11-02T14:42:00.000Z',
      },
    })).displayState).toBe(displayState)
  })

  it('gives OOS and active visits precedence without changing spare metadata', () => {
    expect(deriveTableDisplayState(input('2026-11-02T14:30:00Z', {
      catalogState: 'OUT_OF_SERVICE',
      activeVisit: { active: true },
      isSpare: true,
    }))).toMatchObject({ displayState: 'OUT_OF_SERVICE', isSpare: true })
    expect(deriveTableDisplayState(input('2026-11-02T14:30:00Z', {
      activeVisit: { active: true },
      isSpare: true,
    }))).toMatchObject({ displayState: 'IN_USE', isSpare: true })
  })

  it.each(['CANCELLED', 'CHECKED_IN', 'NO_SHOW'] as const)('does not treat terminal %s history as an active claim', (status) => {
    expect(deriveTableDisplayState(input('2026-11-02T15:00:00Z', {
      reservation: {
        status,
        expectedAt: '2026-11-02T14:30:00Z',
        businessDate: '2026-11-02',
      },
    })).displayState).toBe('EMPTY')
  })

  it('excludes claims from another business date', () => {
    expect(deriveTableDisplayState(input('2026-11-02T15:00:00Z', { businessDate: '2026-11-01' })).displayState)
      .toBe('EMPTY')
  })
})

import { describe, expect, it } from 'vitest'

import { acknowledgeCapacity } from '../src/modules/tables/table-capacity.js'

describe('advisory table capacity', () => {
  it('allows an over-capacity party without confirmation', () => {
    expect(acknowledgeCapacity({
      partySize: 12,
      tables: [{ code: 'C2', capacity: 4 }],
      confirmed: undefined,
    })).toBeNull()
  })

  it('does not treat an explicit legacy false flag as a refusal', () => {
    expect(acknowledgeCapacity({
      partySize: 6,
      tables: [{ code: 'B1', capacity: 4 }],
      confirmed: false,
    })).toBeNull()
  })
})

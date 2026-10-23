import { describe, expect, it } from 'vitest'

import { canTransitionTableState } from '../src/modules/tables/table-state.js'

describe('table state machine', () => {
  it.each([
    ['AVAILABLE', 'RESERVED'],
    ['AVAILABLE', 'IN_USE'],
    ['RESERVED', 'AVAILABLE'],
    ['RESERVED', 'IN_USE'],
    ['IN_USE', 'AVAILABLE'],
  ] as const)('allows %s -> %s', (from, to) => {
    expect(canTransitionTableState(from, to)).toBe(true)
  })

  it('rejects IN_USE -> RESERVED', () => {
    expect(canTransitionTableState('IN_USE', 'RESERVED')).toBe(false)
  })
})


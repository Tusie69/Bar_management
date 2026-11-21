import { describe, expect, it } from 'vitest'

import { priceWindowsOverlap } from '../src/modules/menu/menu-price.repository.js'

describe('menu price windows', () => {
  it('rejects overlap while allowing touching half-open boundaries', () => {
    const first = { effectiveFrom: '2030-01-01T00:00:00Z', effectiveTo: '2030-02-01T00:00:00Z' }
    expect(priceWindowsOverlap(first, { effectiveFrom: '2030-01-15T00:00:00Z', effectiveTo: null })).toBe(true)
    expect(priceWindowsOverlap(first, { effectiveFrom: '2030-02-01T00:00:00Z', effectiveTo: null })).toBe(false)
  })

  it('treats two open-ended prices as overlapping', () => {
    expect(priceWindowsOverlap(
      { effectiveFrom: '2030-01-01T00:00:00Z', effectiveTo: null },
      { effectiveFrom: '2031-01-01T00:00:00Z', effectiveTo: null },
    )).toBe(true)
  })
})

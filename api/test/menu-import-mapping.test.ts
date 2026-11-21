import { describe, expect, it } from 'vitest'

import { buildMenuImportPlan, thousandsToVnd, type MenuWorkbookRow } from '../src/modules/menu/import-mapping.js'

function row(overrides: Partial<MenuWorkbookRow> = {}): MenuWorkbookRow {
  return {
    rowNumber: 7,
    sequence: 1,
    group: 'Rượu mạnh',
    category: 'Single Malt Whisky',
    name: 'MACALLAN 12',
    description: 'Whisky',
    glassShotPriceThousands: 380,
    bottlePriceThousands: 6_500,
    sellingUnit: 'ly / chai',
    note: null,
    ...overrides,
  }
}

describe('menu Excel import mapping', () => {
  it('converts integer thousands to VND and never turns a blank into zero', () => {
    const errors: Array<{ rowNumber: number | null; code: string; message: string }> = []
    expect(thousandsToVnd(280, 7, 'Giá', errors)).toBe(280_000)
    expect(thousandsToVnd(null, 7, 'Giá', errors)).toBeNull()
    expect(thousandsToVnd('', 7, 'Giá', errors)).toBeNull()
    expect(errors).toEqual([])
  })

  it('creates only priced variants and preserves stable keys across reruns', () => {
    const first = buildMenuImportPlan([row({ glassShotPriceThousands: null })])
    const second = buildMenuImportPlan([row({ glassShotPriceThousands: null })])
    expect(first.errors).toEqual([])
    expect(first.items[0]?.variants).toEqual([
      expect.objectContaining({ unitCode: 'BOTTLE', amountVnd: 6_500_000 }),
    ])
    expect(first.items[0]?.importKey).toBe(second.items[0]?.importKey)
    expect(first.items[0]?.variants[0]?.importKey).toBe(second.items[0]?.variants[0]?.importKey)
  })

  it('maps shot combos and sharing jugs to stable business codes', () => {
    const plan = buildMenuImportPlan([
      row({ name: 'RANDOM SHOTS — 6 shots', sellingUnit: 'combo 6 shot', bottlePriceThousands: null }),
      row({ rowNumber: 8, sequence: 2, name: 'SHARING', sellingUnit: 'bình chia', bottlePriceThousands: null }),
    ])
    expect(plan.items[0]?.variants[0]).toMatchObject({ unitCode: 'SHOT_COMBO_6', quantityInUnit: 6 })
    expect(plan.items[1]?.variants[0]).toMatchObject({ unitCode: 'SHARING_JUG' })
  })

  it('locks ambiguous can/bottle and 300++ variants for verification', () => {
    const plan = buildMenuImportPlan([
      row({ name: 'COCA-COLA', sellingUnit: 'lon / chai', bottlePriceThousands: null, glassShotPriceThousands: 60 }),
      row({ rowNumber: 8, sequence: 2, name: '(SPECIAL COCKTAIL)', sellingUnit: 'ly', bottlePriceThousands: null, glassShotPriceThousands: 300, note: '300++' }),
    ])
    expect(plan.errors).toEqual([])
    expect(plan.items[0]?.variants[0]).toMatchObject({ unitCode: 'OTHER', isSellable: false, amountVnd: 60_000 })
    expect(plan.items[1]?.variants[0]).toMatchObject({ unitCode: 'GLASS', isSellable: false, amountVnd: 300_000 })
    expect(plan.warnings.map((warning) => warning.code)).toEqual([
      'AMBIGUOUS_CAN_OR_BOTTLE',
      'STARTING_PRICE_REQUIRES_VERIFICATION',
    ])
  })

  it('reports unmapped units and duplicate names instead of silently merging', () => {
    const plan = buildMenuImportPlan([
      row({ sellingUnit: 'thùng' }),
      row({ rowNumber: 8, sequence: 2, category: 'White Wine', description: 'Sauvignon Blanc' }),
    ])
    expect(plan.errors.map((error) => error.code)).toContain('UNMAPPED_SELLING_UNIT')
    expect(plan.warnings.map((warning) => warning.code)).toContain('DUPLICATE_ITEM_NAME')
    expect(plan.items).toHaveLength(2)
    expect(plan.items[0]?.importKey).not.toBe(plan.items[1]?.importKey)
  })
})

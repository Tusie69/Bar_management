/**
 * Module Phục vụ 2 — luật idempotency và luật đối chiếu, không cần MySQL.
 *
 * Ba thứ được kiểm ở đây là ba thứ sinh ra lỗi "món đã duyệt biến mất khỏi
 * menu sau khi import lại": vân tay nội dung, bảng chuyển trạng thái, và điều
 * kiện chặn khi duyệt. Phần ghi database có test riêng ở
 * menu-import-idempotency.mysql.test.ts.
 */
import { describe, expect, it } from 'vitest'

import { classifyMigration } from '../src/database/migrate-status.js'
import {
  buildMenuImportPlan,
  menuItemDigest,
  menuItemSnapshot,
  type MenuItemSnapshot,
  type MenuWorkbookRow,
} from '../src/modules/menu/import-mapping.js'
import { nextSourceStatus } from '../src/modules/menu/menu-import.repository.js'
import {
  diffMenuSnapshots,
  verificationBlockers,
  type VerificationCandidate,
} from '../src/modules/menu/menu-verification.js'

function row(overrides: Partial<MenuWorkbookRow> = {}): MenuWorkbookRow {
  return {
    rowNumber: 10,
    sequence: 1,
    group: 'Cocktail',
    category: 'Signature',
    name: 'MOJITO',
    description: 'Rum, bạc hà, chanh',
    glassShotPriceThousands: 150,
    bottlePriceThousands: null,
    sellingUnit: 'ly',
    note: null,
    ...overrides,
  }
}

function snapshotOf(rows: MenuWorkbookRow[], index = 0): MenuItemSnapshot {
  const plan = buildMenuImportPlan(rows)
  const item = plan.items[index]!
  const category = plan.categories.find((candidate) => candidate.key === item.categoryKey)!
  return menuItemSnapshot(item, category.code)
}

describe('vân tay nội dung nguồn', () => {
  it('hai lần đọc cùng một nguồn cho cùng một vân tay', () => {
    expect(menuItemDigest(snapshotOf([row()]))).toBe(menuItemDigest(snapshotOf([row()])))
  })

  it('đổi giá thì vân tay đổi', () => {
    const before = menuItemDigest(snapshotOf([row()]))
    const after = menuItemDigest(snapshotOf([row({ glassShotPriceThousands: 170 })]))
    expect(after).not.toBe(before)
  })

  it('đổi tên, mô tả, ghi chú hay bếp/bar đều đổi vân tay', () => {
    const base = menuItemDigest(snapshotOf([row()]))
    for (const variantRow of [
      row({ name: 'MOJITO ĐẶC BIỆT' }),
      row({ description: 'Công thức mới' }),
      row({ note: 'Hết hàng cuối tuần' }),
      row({ group: 'Đồ ăn', category: 'Khai vị', sellingUnit: 'phần' }),
    ]) {
      expect(menuItemDigest(snapshotOf([variantRow])), JSON.stringify(variantRow.name)).not.toBe(base)
    }
  })

  it('thứ tự biến thể trong vân tay không phụ thuộc thứ tự đọc', () => {
    const snapshot = snapshotOf([row({ sellingUnit: 'ly / chai', bottlePriceThousands: 900 })])
    const shuffled: MenuItemSnapshot = { ...snapshot, variants: [...snapshot.variants].reverse() }
    expect(menuItemDigest(shuffled)).not.toBe(menuItemDigest(snapshot))
    // ...nhưng `menuItemSnapshot` luôn sắp xếp, nên hai lần dựng từ nguồn thì bằng nhau.
    expect(menuItemDigest(snapshotOf([row({ sellingUnit: 'ly / chai', bottlePriceThousands: 900 })])))
      .toBe(menuItemDigest(snapshot))
  })
})

describe('trạng thái khi nguồn thay đổi', () => {
  it('VERIFIED không bị hạ về PENDING_VERIFICATION', () => {
    expect(nextSourceStatus('VERIFIED')).toBe('REVIEW_REQUIRED')
  })

  it('REJECTED giữ nguyên: một lần sửa Excel không gỡ được quyết định loại món', () => {
    expect(nextSourceStatus('REJECTED')).toBe('REJECTED')
  })

  it('món chưa ai xem vẫn là chưa ai xem', () => {
    expect(nextSourceStatus('PENDING_VERIFICATION')).toBe('PENDING_VERIFICATION')
    expect(nextSourceStatus('REVIEW_REQUIRED')).toBe('REVIEW_REQUIRED')
  })
})

function candidate(overrides: Partial<VerificationCandidate> = {}): VerificationCandidate {
  const snapshot = snapshotOf([row()])
  return {
    itemId: 1,
    code: 'XLSX_ITEM_AAAA',
    name: 'MOJITO',
    normalizedName: 'mojito',
    sourceStatus: 'PENDING_VERIFICATION',
    isActive: true,
    sameNameCount: 1,
    variants: [{ code: 'XLSX_VAR_1', unitCode: 'GLASS', displayName: 'Ly', isSellable: true, amountVnd: 150_000 }],
    snapshot,
    verifiedSnapshot: null,
    ...overrides,
  }
}

describe('điều kiện chặn khi duyệt', () => {
  it('món bình thường, có giá, bán được thì duyệt được', () => {
    expect(verificationBlockers(candidate())).toEqual([])
  })

  it('biến thể đang khoá bán bị chặn — đây là dòng 300++', () => {
    const blockers = verificationBlockers(candidate({
      variants: [{ code: 'V', unitCode: 'GLASS', displayName: 'Ly', isSellable: false, amountVnd: 300_000 }],
    }))
    expect(blockers.map((blocker) => blocker.code)).toContain('VARIANT_NOT_SELLABLE')
  })

  it('đơn vị OTHER bị chặn — đây là sáu dòng lon / chai', () => {
    const blockers = verificationBlockers(candidate({
      variants: [{ code: 'V', unitCode: 'OTHER', displayName: 'Lon / chai', isSellable: false, amountVnd: 25_000 }],
    }))
    expect(blockers.map((blocker) => blocker.code)).toEqual(
      expect.arrayContaining(['VARIANT_NOT_SELLABLE', 'AMBIGUOUS_UNIT']),
    )
  })

  it('tên trùng bị chặn cho tới khi nêu đích danh mã món', () => {
    const duplicate = candidate({ sameNameCount: 2 })
    expect(verificationBlockers(duplicate).map((blocker) => blocker.code)).toContain('DUPLICATE_NAME')
    expect(verificationBlockers(duplicate, { allowDuplicateNameCodes: ['XLSX_ITEM_AAAA'] })).toEqual([])
    // Mã của món khác không mở khoá cho món này.
    expect(verificationBlockers(duplicate, { allowDuplicateNameCodes: ['XLSX_ITEM_BBBB'] })
      .map((blocker) => blocker.code)).toContain('DUPLICATE_NAME')
  })

  it('thiếu giá hiện hành hoặc không có biến thể đều bị chặn', () => {
    expect(verificationBlockers(candidate({
      variants: [{ code: 'V', unitCode: 'GLASS', displayName: 'Ly', isSellable: true, amountVnd: null }],
    })).map((blocker) => blocker.code)).toContain('MISSING_PRICE')
    expect(verificationBlockers(candidate({ variants: [] })).map((blocker) => blocker.code)).toContain('NO_VARIANT')
  })

  it('món đang tắt không được duyệt', () => {
    expect(verificationBlockers(candidate({ isActive: false })).map((blocker) => blocker.code))
      .toContain('ITEM_INACTIVE')
  })
})

describe('diff giữa nội dung đã duyệt và nội dung hiện tại', () => {
  it('chưa từng duyệt thì không có gì để so', () => {
    expect(diffMenuSnapshots(null, snapshotOf([row()]))).toEqual([])
  })

  it('nêu đúng trường đã đổi, kèm giá trị trước và sau', () => {
    const before = snapshotOf([row()])
    const after = snapshotOf([row({ glassShotPriceThousands: 170 })])
    const changes = diffMenuSnapshots(before, after)
    const price = changes.find((change) => change.field.endsWith('.amountVnd'))
    expect(price).toBeDefined()
    expect(price?.before).toBe(150_000)
    expect(price?.after).toBe(170_000)
  })

  it('biến thể mới và biến thể biến mất đều hiện ra', () => {
    const single = snapshotOf([row()])
    const pair = snapshotOf([row({ sellingUnit: 'ly / chai', bottlePriceThousands: 900 })])
    expect(diffMenuSnapshots(single, pair).some((change) => change.before === null)).toBe(true)
    expect(diffMenuSnapshots(pair, single).some((change) => change.after === null)).toBe(true)
  })

  it('đổi tên món hiện ở trường name', () => {
    const changes = diffMenuSnapshots(snapshotOf([row()]), snapshotOf([row({ name: 'MOJITO ĐẶC BIỆT' })]))
    expect(changes).toContainEqual({ field: 'name', before: 'MOJITO', after: 'MOJITO ĐẶC BIỆT' })
  })
})

describe('tình trạng migration', () => {
  const sql = '-- migrate:up\nSELECT 1;\n'

  it('chưa chạy thì là pending', () => {
    expect(classifyMigration('0001_x.sql', sql, null).state).toBe('pending')
  })

  it('đã chạy và nội dung khớp thì là applied, kể cả khi khác kiểu xuống dòng', () => {
    const crlf = classifyMigration('0001_x.sql', sql.replace(/\n/g, '\r\n'), null).fileChecksum
    expect(classifyMigration('0001_x.sql', sql, crlf).state).toBe('applied')
  })

  it('nội dung đổi sau khi chạy thì báo lệch checksum, không im lặng', () => {
    const entry = classifyMigration('0001_x.sql', sql, 'a'.repeat(64))
    expect(entry.state).toBe('checksum-mismatch')
    expect(entry.recordedChecksum).toBe('a'.repeat(64))
    expect(entry.fileChecksum).not.toBe(entry.recordedChecksum)
  })
})

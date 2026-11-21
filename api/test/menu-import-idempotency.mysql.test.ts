/**
 * Module Phục vụ 2 — chạy lại importer không được phá kết quả đối chiếu.
 *
 * Bản trước đạt "idempotent ở mức bản ghi": chạy hai lần vẫn ra 178 món. Điều
 * đó không đủ. Mỗi lần chạy nó vẫn UPDATE mọi dòng, và vì `source_status` nằm
 * trong câu UPDATE đó, mọi món đã VERIFIED rơi về PENDING_VERIFICATION — tức
 * là biến mất khỏi menu production. Test này kiểm đúng điều đó, trên database
 * thật, qua đúng hàm mà script `menu:import` gọi.
 */
import type { RowDataPacket } from 'mysql2/promise'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { databasePool } from '../src/database/pool.js'
import {
  buildMenuImportPlan,
  MENU_IMPORT_SOURCE,
  type MenuWorkbookRow,
} from '../src/modules/menu/import-mapping.js'
import { applyMenuImportPlan } from '../src/modules/menu/menu-import.repository.js'
import { applyVerification, buildVerificationPlan } from '../src/modules/menu/menu-verification.repository.js'
import { actor, clearFixture, initializeFixture, resetFixture } from './support/integration-fixture.js'

const mysqlDescribe = process.env.RUN_MYSQL_INTEGRATION === '1' && /_test$/.test(process.env.DB_NAME ?? '')
  ? describe
  : describe.skip

const scope = { organizationId: actor.organizationId, venueId: actor.venueId }
const FIRST_RUN = new Date('2030-01-01T00:00:00.000Z')
const SECOND_RUN = new Date('2030-02-01T00:00:00.000Z')

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

/**
 * Dòng luôn bị chặn duyệt: giá nguồn `300++` là giá khởi điểm, nên biến thể
 * được lưu mà không được phép bán.
 *
 * L10 đã lấy đi dòng "lon / chai" khỏi vai này — nó không còn mơ hồ kể từ câu
 * trả lời Q5 — nên hàng đợi đối chiếu cần một dòng khác thực sự còn bị chặn,
 * nếu không các test dưới đây chỉ còn kiểm một hàng đợi rỗng.
 */
function blockedRow(): MenuWorkbookRow {
  return row({
    rowNumber: 11,
    sequence: 2,
    name: '(SPECIAL COCKTAIL)',
    description: null,
    glassShotPriceThousands: 300,
    sellingUnit: 'ly',
    note: '300++',
  })
}

/** Món nước ngọt "lon / chai" một giá: sau L10 là Lon + Chai, cùng giá, bán được. */
function softDrinkRow(overrides: Partial<MenuWorkbookRow> = {}): MenuWorkbookRow {
  return row({
    rowNumber: 12,
    sequence: 3,
    group: 'Nước ngọt',
    category: 'Soft drink',
    name: 'COCA-COLA',
    description: null,
    glassShotPriceThousands: 25,
    sellingUnit: 'lon / chai',
    ...overrides,
  })
}

function runImport(rows: MenuWorkbookRow[], effectiveFrom: Date) {
  return applyMenuImportPlan(scope, buildMenuImportPlan(rows), { effectiveFrom })
}

async function itemRow(code = 'MOJITO'): Promise<RowDataPacket & {
  id: number
  version: number
  source_status: string
  verified_at: Date | null
  verified_by_user_id: number | null
  updated_at: Date
}> {
  const [rows] = await databasePool.execute<(RowDataPacket & {
    id: number; version: number; source_status: string; verified_at: Date | null
    verified_by_user_id: number | null; updated_at: Date
  })[]>(
    `SELECT id, version, source_status, verified_at, verified_by_user_id, updated_at
     FROM menu_items WHERE venue_id = ? AND name = ?`,
    [actor.venueId, code],
  )
  const found = rows[0]
  if (!found) throw new Error(`Không tìm thấy món ${code}`)
  return found
}

async function priceRows(): Promise<(RowDataPacket & {
  id: number; amount_vnd: string; effective_from: Date; effective_to: Date | null
})[]> {
  const [rows] = await databasePool.execute<(RowDataPacket & {
    id: number; amount_vnd: string; effective_from: Date; effective_to: Date | null
  })[]>(
    `SELECT p.id, p.amount_vnd, p.effective_from, p.effective_to
     FROM menu_variant_prices AS p
     JOIN menu_item_variants AS v ON v.id = p.variant_id
     JOIN menu_items AS mi ON mi.id = v.menu_item_id
     WHERE p.venue_id = ? AND mi.name = 'MOJITO'
     ORDER BY p.effective_from, p.id`,
    [actor.venueId],
  )
  return rows
}

async function venueChangeSeq(): Promise<bigint> {
  const [rows] = await databasePool.execute<(RowDataPacket & { change_seq: string })[]>(
    'SELECT change_seq FROM venues WHERE organization_id = ? AND id = ?',
    [actor.organizationId, actor.venueId],
  )
  return BigInt(rows[0]!.change_seq)
}

/** Duyệt mọi món duyệt được, bằng tài khoản OWNER của fixture. */
async function verifyEverything(): Promise<string[]> {
  const [owner] = await databasePool.execute<(RowDataPacket & { id: number; membership_id: number })[]>(
    `SELECT u.id, m.id AS membership_id FROM users AS u
     JOIN memberships AS m ON m.user_id = u.id
     WHERE u.username = 'integration_owner'`,
  )
  const verifier = owner[0]!
  const plan = await buildVerificationPlan(scope, { source: MENU_IMPORT_SOURCE })
  const result = await applyVerification(
    scope,
    { userId: Number(verifier.id), membershipId: Number(verifier.membership_id) },
    plan.verifiable,
  )
  return result.verified
}

mysqlDescribe('Module Phục vụ 2 — import lại và đối chiếu', () => {
  beforeAll(initializeFixture)
  beforeEach(resetFixture)
  afterAll(async () => {
    await clearFixture()
    await databasePool.end()
  })

  describe('1. Chạy lại trên nguồn không đổi', () => {
    it('không ghi gì cả: không version, không updated_at, không change_seq', async () => {
      const first = await runImport([row()], FIRST_RUN)
      expect(first.tally.itemsCreated).toBe(1)
      expect(first.tally.pricesCreated).toBe(1)
      const before = await itemRow()
      const seqBefore = await venueChangeSeq()

      const second = await runImport([row()], SECOND_RUN)

      expect(second.tally.itemsUnchanged).toBe(1)
      expect(second.tally.itemsCreated).toBe(0)
      expect(second.tally.itemsUpdated).toBe(0)
      expect(second.tally.categoriesUpdated).toBe(0)
      expect(second.tally.changed).toBe(false)
      const after = await itemRow()
      expect(Number(after.version)).toBe(Number(before.version))
      expect(after.updated_at.getTime()).toBe(before.updated_at.getTime())
      expect(await venueChangeSeq()).toBe(seqBefore)
    })

    it('món đã VERIFIED vẫn VERIFIED, nên không biến mất khỏi menu', async () => {
      await runImport([row()], FIRST_RUN)
      expect(await verifyEverything()).toHaveLength(1)
      expect((await itemRow()).source_status).toBe('VERIFIED')

      await runImport([row()], SECOND_RUN)

      const after = await itemRow()
      expect(after.source_status).toBe('VERIFIED')
      expect(after.verified_at).not.toBeNull()
      expect(Number(after.verified_by_user_id)).toBeGreaterThan(0)
    })
  })

  describe('2. Nguồn đổi sau khi đã duyệt', () => {
    it('chuyển sang REVIEW_REQUIRED, không âm thầm về PENDING_VERIFICATION', async () => {
      await runImport([row()], FIRST_RUN)
      await verifyEverything()

      const outcome = await runImport([row({ glassShotPriceThousands: 170 })], SECOND_RUN)

      expect(outcome.tally.itemsSentToReview).toBe(1)
      const after = await itemRow()
      expect(after.source_status).toBe('REVIEW_REQUIRED')
      // Dấu vết lần duyệt trước được giữ, nên lần duyệt sau còn gì để so.
      expect(after.verified_at).not.toBeNull()
    })

    it('giá cũ được đóng lại thành lịch sử, không bị ghi đè', async () => {
      await runImport([row()], FIRST_RUN)
      await runImport([row({ glassShotPriceThousands: 170 })], SECOND_RUN)

      const prices = await priceRows()
      expect(prices).toHaveLength(2)
      expect(Number(prices[0]!.amount_vnd)).toBe(150_000)
      expect(prices[0]!.effective_to?.getTime()).toBe(SECOND_RUN.getTime())
      expect(Number(prices[1]!.amount_vnd)).toBe(170_000)
      expect(prices[1]!.effective_to).toBeNull()
    })

    it('lùi mốc hiệu lực bị từ chối thay vì tạo khoảng giá âm', async () => {
      await runImport([row()], SECOND_RUN)
      await expect(runImport([row({ glassShotPriceThousands: 170 })], FIRST_RUN))
        .rejects.toMatchObject({ code: 'MENU_PRICE_BACKDATED' })
      // Rollback: giá cũ còn nguyên và vẫn đang mở.
      const prices = await priceRows()
      expect(prices).toHaveLength(1)
      expect(prices[0]!.effective_to).toBeNull()
    })

    it('món đã REJECTED không bị một lần import đưa trở lại hàng đợi duyệt', async () => {
      await runImport([row()], FIRST_RUN)
      await databasePool.execute(
        "UPDATE menu_items SET source_status = 'REJECTED' WHERE venue_id = ? AND name = 'MOJITO'",
        [actor.venueId],
      )

      const outcome = await runImport([row({ glassShotPriceThousands: 170 })], SECOND_RUN)

      expect(outcome.tally.itemsRejectedKept).toBe(1)
      expect((await itemRow()).source_status).toBe('REJECTED')
    })

    it('tắt một món rồi import lại không bật nó lên', async () => {
      await runImport([row()], FIRST_RUN)
      await databasePool.execute(
        "UPDATE menu_items SET is_active = 0 WHERE venue_id = ? AND name = 'MOJITO'",
        [actor.venueId],
      )
      await runImport([row({ glassShotPriceThousands: 170 })], SECOND_RUN)
      const [rows] = await databasePool.execute<(RowDataPacket & { is_active: number })[]>(
        "SELECT is_active FROM menu_items WHERE venue_id = ? AND name = 'MOJITO'",
        [actor.venueId],
      )
      expect(Number(rows[0]!.is_active)).toBe(0)
    })
  })

  describe('3. Quy trình đối chiếu', () => {
    it('hàng đợi chỉ gồm món chờ duyệt, và món giá khởi điểm bị chặn', async () => {
      await runImport([row(), blockedRow()], FIRST_RUN)
      const plan = await buildVerificationPlan(scope, { source: MENU_IMPORT_SOURCE })

      expect(plan.entries).toHaveLength(2)
      expect(plan.verifiable.map((entry) => entry.candidate.name)).toEqual(['MOJITO'])
      const blocked = plan.blocked[0]!
      expect(blocked.candidate.name).toBe('(SPECIAL COCKTAIL)')
      expect(blocked.blockers.map((blocker) => blocker.code))
        .toEqual(expect.arrayContaining(['VARIANT_NOT_SELLABLE']))
    })

    it('duyệt xong thì món lên VERIFIED và có một dòng nhật ký mang tên người duyệt', async () => {
      await runImport([row(), blockedRow()], FIRST_RUN)
      const verified = await verifyEverything()
      expect(verified).toHaveLength(1)

      const after = await itemRow()
      expect(after.source_status).toBe('VERIFIED')
      const [audit] = await databasePool.execute<(RowDataPacket & {
        action: string; actor_user_id: number; entity_id: number
      })[]>(
        "SELECT action, actor_user_id, entity_id FROM operation_log WHERE action = 'MENU_ITEM_VERIFIED'",
      )
      expect(audit).toHaveLength(1)
      expect(Number(audit[0]!.entity_id)).toBe(Number(after.id))
      expect(Number(audit[0]!.actor_user_id)).toBe(Number(after.verified_by_user_id))

      // Món bị chặn vẫn nằm ngoài menu.
      expect((await itemRow('(SPECIAL COCKTAIL)')).source_status).toBe('PENDING_VERIFICATION')
    })

    it('từ chối duyệt cả lô nếu trong lô còn món bị chặn', async () => {
      await runImport([row(), blockedRow()], FIRST_RUN)
      const plan = await buildVerificationPlan(scope, { source: MENU_IMPORT_SOURCE })
      await expect(applyVerification(scope, { userId: 9802, membershipId: 9802 }, plan.entries))
        .rejects.toMatchObject({ code: 'MENU_VERIFICATION_BLOCKED' })
    })

    it('import xen vào giữa plan và apply thì bỏ qua món đó, không duyệt nhầm', async () => {
      await runImport([row()], FIRST_RUN)
      const plan = await buildVerificationPlan(scope, { source: MENU_IMPORT_SOURCE })
      // Nguồn đổi sau khi người vận hành đã đọc diff.
      await runImport([row({ glassShotPriceThousands: 170 })], SECOND_RUN)

      const result = await applyVerification(scope, { userId: 9802, membershipId: 9802 }, plan.verifiable)

      expect(result.verified).toEqual([])
      expect(result.skippedStale).toHaveLength(1)
      expect((await itemRow()).source_status).toBe('PENDING_VERIFICATION')
    })

    it('duyệt lại sau khi nguồn đổi: diff nêu đúng giá trước và sau', async () => {
      await runImport([row()], FIRST_RUN)
      await verifyEverything()
      await runImport([row({ glassShotPriceThousands: 170 })], SECOND_RUN)

      const plan = await buildVerificationPlan(scope, { source: MENU_IMPORT_SOURCE })
      const entry = plan.entries.find((candidate) => candidate.candidate.name === 'MOJITO')!
      expect(entry.candidate.sourceStatus).toBe('REVIEW_REQUIRED')
      const priceChange = entry.diff.find((change) => change.field.endsWith('.amountVnd'))
      expect(priceChange?.before).toBe(150_000)
      expect(priceChange?.after).toBe(170_000)
    })
  })

  describe('4. Món biến mất khỏi nguồn', () => {
    it('được báo tên chứ không bị tự xoá hay tự ẩn', async () => {
      await runImport([row(), blockedRow()], FIRST_RUN)
      const outcome = await runImport([row()], SECOND_RUN)

      expect(outcome.orphanedItemCodes).toHaveLength(1)
      expect((await itemRow('(SPECIAL COCKTAIL)')).source_status).toBe('PENDING_VERIFICATION')
    })
  })

  describe('5. L10 — nước ngọt lon / chai một giá', () => {
    async function variantRows(): Promise<(RowDataPacket & {
      unit_code: string; display_name: string; is_active: number; is_sellable: number
      import_key: string | null; amount_vnd: string | null
    })[]> {
      const [rows] = await databasePool.execute<(RowDataPacket & {
        unit_code: string; display_name: string; is_active: number; is_sellable: number
        import_key: string | null; amount_vnd: string | null
      })[]>(
        `SELECT v.unit_code, v.display_name, v.is_active, v.is_sellable, v.import_key, p.amount_vnd
         FROM menu_item_variants AS v
         JOIN menu_items AS mi ON mi.id = v.menu_item_id
         LEFT JOIN menu_variant_prices AS p
           ON p.variant_id = v.id AND p.is_active = 1 AND p.effective_to IS NULL
         WHERE v.venue_id = ? AND mi.name = 'COCA-COLA'
         ORDER BY v.display_order, v.id`,
        [actor.venueId],
      )
      return rows
    }

    /** Dòng mà importer CŨ để lại: một biến thể OTHER bị khoá bán. */
    async function insertLegacyOtherVariant(importKey: string | null): Promise<void> {
      const [items] = await databasePool.execute<(RowDataPacket & { id: number })[]>(
        "SELECT id FROM menu_items WHERE venue_id = ? AND name = 'COCA-COLA'",
        [actor.venueId],
      )
      await databasePool.execute(
        `INSERT INTO menu_item_variants
           (venue_id, menu_item_id, code, import_key, unit_code, display_name,
            is_active, is_sellable, availability_status, display_order)
         VALUES (?, ?, ?, ?, 'OTHER', 'Lon / chai (cần xác minh)', 1, 0, 'AVAILABLE', 9)`,
        [actor.venueId, Number(items[0]!.id), `LEGACY_${importKey ?? 'MANUAL'}`, importKey],
      )
    }

    it('nhập thành Lon và Chai cùng giá, cả hai bán được', async () => {
      const outcome = await runImport([softDrinkRow()], FIRST_RUN)

      expect(outcome.tally.variantsCreated).toBe(2)
      expect(outcome.tally.pricesCreated).toBe(2)
      const variants = await variantRows()
      expect(variants.map((variant) => [variant.unit_code, variant.display_name]))
        .toEqual([['CAN', 'Lon'], ['BOTTLE', 'Chai']])
      for (const variant of variants) {
        expect(Number(variant.is_sellable)).toBe(1)
        expect(Number(variant.is_active)).toBe(1)
        expect(Number(variant.amount_vnd)).toBe(25_000)
      }
    })

    it('duyệt được: không còn blocker đơn vị mơ hồ', async () => {
      await runImport([softDrinkRow()], FIRST_RUN)
      const plan = await buildVerificationPlan(scope, { source: MENU_IMPORT_SOURCE })
      const entry = plan.entries.find((candidate) => candidate.candidate.name === 'COCA-COLA')!
      expect(entry.blockers).toEqual([])
      expect(await verifyEverything()).toContain(entry.candidate.code)
    })

    it('biến thể OTHER cũ của cùng nguồn bị tắt khi nhập lại, không bị xoá', async () => {
      await runImport([softDrinkRow()], FIRST_RUN)
      await insertLegacyOtherVariant('legacy-other-import-key')

      // Nguồn đổi giá, nên món được ghi lại và việc dọn biến thể mới chạy.
      const outcome = await runImport([softDrinkRow({ glassShotPriceThousands: 26 })], SECOND_RUN)

      expect(outcome.tally.variantsDeactivated).toBe(1)
      const variants = await variantRows()
      // Vẫn còn ba dòng: không có DELETE nào.
      expect(variants).toHaveLength(3)
      const legacy = variants.find((variant) => variant.unit_code === 'OTHER')!
      expect(Number(legacy.is_active)).toBe(0)
      for (const variant of variants.filter((value) => value.unit_code !== 'OTHER')) {
        expect(Number(variant.is_active)).toBe(1)
      }
      // Và hàng đợi đối chiếu không còn thấy nó, nên món duyệt được.
      const plan = await buildVerificationPlan(scope, { source: MENU_IMPORT_SOURCE })
      const entry = plan.entries.find((candidate) => candidate.candidate.name === 'COCA-COLA')!
      expect(entry.blockers).toEqual([])
    })

    it('không tắt biến thể thêm tay, vì nó không có import_key', async () => {
      await runImport([softDrinkRow()], FIRST_RUN)
      await insertLegacyOtherVariant(null)

      const outcome = await runImport([softDrinkRow({ glassShotPriceThousands: 26 })], SECOND_RUN)

      expect(outcome.tally.variantsDeactivated).toBe(0)
      const manual = (await variantRows()).find((variant) => variant.import_key === null)!
      expect(Number(manual.is_active)).toBe(1)
    })

    it('chạy lại trên cùng file không tắt thêm gì và không tăng change_seq', async () => {
      await runImport([softDrinkRow()], FIRST_RUN)
      const seqBefore = await venueChangeSeq()

      const second = await runImport([softDrinkRow()], SECOND_RUN)

      expect(second.tally.variantsDeactivated).toBe(0)
      expect(second.tally.itemsUnchanged).toBe(1)
      expect(second.tally.changed).toBe(false)
      expect(await venueChangeSeq()).toBe(seqBefore)
    })
  })
})

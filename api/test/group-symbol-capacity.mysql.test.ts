/**
 * Ký hiệu ghép bàn: đủ cho mọi bàn, và trả lại được khi nhóm tan.
 *
 * Lỗi gốc: `venues.group_symbol_count` mặc định 12 vì bộ hình vẽ có 12 hình.
 * Quán có 23 bàn và 21 ghế bar, nên lễ tân ghép tới nhóm thứ 13 là nhận
 * "Đã dùng hết ký hiệu nhóm trong ngày nghiệp vụ" giữa ca.
 */
import type { PoolConnection, RowDataPacket } from 'mysql2/promise'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { databasePool } from '../src/database/pool.js'
import { createTableGroup } from '../src/modules/tables/table-group.repository.js'
import { groupDisplayCode } from '../src/modules/tables/floor-projection.repository.js'
import { actor, businessDate, clearFixture, initializeFixture, resetFixture } from './support/integration-fixture.js'

const mysqlDescribe = process.env.RUN_MYSQL_INTEGRATION === '1' && /_test$/.test(process.env.DB_NAME ?? '')
  ? describe
  : describe.skip

async function symbolCount(): Promise<number> {
  const [rows] = await databasePool.execute<(RowDataPacket & { group_symbol_count: number })[]>(
    'SELECT group_symbol_count FROM venues WHERE organization_id = ? AND id = ?',
    [actor.organizationId, actor.venueId],
  )
  return Number(rows[0]!.group_symbol_count)
}

async function setSymbolCount(value: number): Promise<void> {
  await databasePool.execute(
    'UPDATE venues SET group_symbol_count = ? WHERE organization_id = ? AND id = ?',
    [value, actor.organizationId, actor.venueId],
  )
}

/** Cấp `count` nhóm liên tiếp trong cùng một ngày nghiệp vụ. */
async function formGroups(count: number): Promise<number[]> {
  const connection: PoolConnection = await databasePool.getConnection()
  const symbols: number[] = []
  try {
    for (let index = 0; index < count; index += 1) {
      await connection.beginTransaction()
      const group = await createTableGroup(connection, actor, { businessDate })
      await connection.commit()
      symbols.push(group.symbolNo)
    }
    return symbols
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

mysqlDescribe('ký hiệu ghép bàn', () => {
  beforeAll(initializeFixture)
  beforeEach(resetFixture)
  afterAll(async () => {
    await clearFixture()
    await databasePool.end()
  })

  it('venue mới nhận trần lớn hơn hẳn 12 hình vẽ gốc', async () => {
    // 0035 đổi DEFAULT của cột, nên venue do fixture tạo cũng được hưởng.
    expect(await symbolCount()).toBeGreaterThanOrEqual(44)
  })

  it('cấp được nhóm thứ 13 — đúng chỗ trước đây lễ tân bị chặn', async () => {
    const symbols = await formGroups(13)
    expect(symbols).toEqual(Array.from({ length: 13 }, (_, index) => index + 1))
    expect(groupDisplayCode(symbols[12]!)).toBe('G13')
  })

  it('cấp đủ số nhóm bằng số bàn của quán, rồi mới báo hết', async () => {
    const maximum = await symbolCount()
    const symbols = await formGroups(maximum)
    expect(new Set(symbols).size).toBe(maximum)
    expect(Math.max(...symbols)).toBe(maximum)

    await expect(formGroups(1)).rejects.toMatchObject({ code: 'GROUP_SYMBOL_UNAVAILABLE' })
  })

  it('ký hiệu được trả lại khi nhóm tan, nên trần là số nhóm CÙNG LÚC', async () => {
    await setSymbolCount(3)
    const symbols = await formGroups(3)
    expect(symbols).toEqual([1, 2, 3])
    await expect(formGroups(1)).rejects.toMatchObject({ code: 'GROUP_SYMBOL_UNAVAILABLE' })

    await databasePool.execute(
      `UPDATE table_groups SET dissolved_at = UTC_TIMESTAMP(3), dissolved_by_user_id = ?
       WHERE organization_id = ? AND venue_id = ? AND symbol_no = 2`,
      [actor.userId, actor.organizationId, actor.venueId],
    )
    // Ký hiệu nhỏ nhất còn trống, không phải số tiếp theo.
    expect(await formGroups(1)).toEqual([2])
  })

  it('mã hiển thị vẫn đọc được ở số lớn', () => {
    expect(groupDisplayCode(9)).toBe('G09')
    expect(groupDisplayCode(13)).toBe('G13')
    expect(groupDisplayCode(44)).toBe('G44')
  })

  it('database từ chối trần ngoài khoảng 1..255', async () => {
    await expect(setSymbolCount(0)).rejects.toThrow()
    await expect(setSymbolCount(256)).rejects.toThrow()
    // 50 từng là trần cũ của CHECK; giờ phải qua được.
    await setSymbolCount(200)
    expect(await symbolCount()).toBe(200)
  })
})

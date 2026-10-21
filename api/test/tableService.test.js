import assert from 'node:assert/strict'
import test from 'node:test'
import { InvalidTransitionError } from '../src/errors.js'
import { TableService } from '../src/modules/tables/tableService.js'
import { isAllowedTransition } from '../src/modules/tables/tableStatuses.js'

class FakeTableRepository {
  constructor(status = 'AVAILABLE') { this.status = status }
  async listByDate() { return [{ id: 1, code: 'B1', status: this.status }] }
  async updateStatus({ id, businessDate, status }) {
    if (!isAllowedTransition(this.status, status)) throw new InvalidTransitionError(this.status, status)
    const previousStatus = this.status
    this.status = status
    return { id, date: businessDate, previousStatus, status }
  }
}

test('trả danh sách bàn theo ngày hợp lệ', async () => {
  const result = await new TableService(new FakeTableRepository()).list('2026-10-21')
  assert.equal(result.date, '2026-10-21')
  assert.equal(result.tables[0].status, 'AVAILABLE')
})

test('từ chối ngày không hợp lệ', async () => {
  await assert.rejects(() => new TableService(new FakeTableRepository()).list('2026-02-30'), {
    code: 'VALIDATION_ERROR',
  })
})

test('cho phép chuyển AVAILABLE sang OCCUPIED', async () => {
  const result = await new TableService(new FakeTableRepository()).updateStatus('1', {
    date: '2026-10-21', status: 'OCCUPIED',
  })
  assert.equal(result.previousStatus, 'AVAILABLE')
  assert.equal(result.status, 'OCCUPIED')
})

test('từ chối chuyển OCCUPIED trực tiếp sang RESERVED', async () => {
  await assert.rejects(
    () => new TableService(new FakeTableRepository('OCCUPIED')).updateStatus('1', {
      date: '2026-10-21', status: 'RESERVED',
    }),
    { code: 'INVALID_TABLE_STATUS_TRANSITION' },
  )
})

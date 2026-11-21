import { describe, expect, it } from 'vitest'

import {
  ORDERING_PRESENCE_TTL_MS,
  waiterVisitPhase,
  waiterVisitPhases,
  type WaiterVisitActivity,
} from '../src/modules/tables/waiter-visit-phase.js'

const NOW = new Date('2026-11-22T14:00:00.000Z')

function activity(overrides: Partial<WaiterVisitActivity> = {}): WaiterVisitActivity {
  return {
    visitId: 9001,
    paid: false,
    orderCount: 0,
    pendingTicketCount: 0,
    orderingSince: null,
    ...overrides,
  }
}

describe('waiterVisitPhase — sáu trạng thái của một lượt khách', () => {
  it('1. Mới vào: Phiên vừa mở, chưa ai gọi gì', () => {
    expect(waiterVisitPhase(activity(), NOW)).toBe('ARRIVED')
  })

  it('2. Đang gọi món: có máy đang mở màn Gọi món', () => {
    const orderingSince = new Date(NOW.getTime() - 30_000)
    expect(waiterVisitPhase(activity({ orderingSince }), NOW)).toBe('ORDERING')
  })

  it('3. Chờ đồ: đã gửi đơn, còn phiếu chưa mang ra', () => {
    expect(waiterVisitPhase(activity({ orderCount: 1, pendingTicketCount: 2 }), NOW)).toBe('AWAITING_FOOD')
  })

  it('4. Đang dùng: mọi phiếu đã mang ra', () => {
    expect(waiterVisitPhase(activity({ orderCount: 2, pendingTicketCount: 0 }), NOW)).toBe('DINING')
  })

  it('5. Thanh toán: Phiên đã đánh dấu đã trả tiền', () => {
    expect(waiterVisitPhase(activity({ paid: true, orderCount: 3 }), NOW)).toBe('PAYMENT')
  })

  /**
   * Hình 0 của tài liệu: khách đang dùng mà gọi thêm thì bàn về 2 rồi mới sang
   * 3. Nếu "còn phiếu chờ" thắng "đang gọi món" thì lần gọi thêm thứ hai sẽ
   * không đổi màu, và Phục vụ không thấy được rằng có người đang đứng ở bàn đó.
   */
  it('đang gọi món thắng chờ đồ: khách gọi thêm thì bàn về màu cam trước', () => {
    const orderingSince = new Date(NOW.getTime() - 10_000)
    expect(waiterVisitPhase(activity({ orderCount: 1, pendingTicketCount: 3, orderingSince }), NOW)).toBe('ORDERING')
  })

  it('đã thanh toán thắng tất cả, kể cả khi còn phiếu chờ', () => {
    const orderingSince = new Date(NOW.getTime() - 10_000)
    const input = activity({ paid: true, orderCount: 1, pendingTicketCount: 1, orderingSince })
    expect(waiterVisitPhase(input, NOW)).toBe('PAYMENT')
  })

  /**
   * Máy hết pin giữa lúc mở menu thì không có cú thoát nào để xoá dấu. Thiếu
   * hạn sống, bàn đó cam tới hết ca.
   */
  it('dấu đang gọi món hết hạn: bàn không kẹt màu cam khi máy mất kết nối', () => {
    const stale = new Date(NOW.getTime() - ORDERING_PRESENCE_TTL_MS - 1)
    expect(waiterVisitPhase(activity({ orderingSince: stale }), NOW)).toBe('ARRIVED')
    expect(waiterVisitPhase(activity({ orderCount: 1, orderingSince: stale }), NOW)).toBe('DINING')
  })

  it('đúng tại mốc hạn đã là hết hạn', () => {
    const edge = new Date(NOW.getTime() - ORDERING_PRESENCE_TTL_MS)
    expect(waiterVisitPhase(activity({ orderingSince: edge }), NOW)).toBe('ARRIVED')
  })

  it('waiterVisitPhases dựng bản đồ theo visitId', () => {
    const phases = waiterVisitPhases(
      [activity({ visitId: 1 }), activity({ visitId: 2, orderCount: 1 }), activity({ visitId: 3, paid: true })],
      NOW,
    )
    expect(phases.get(1)).toBe('ARRIVED')
    expect(phases.get(2)).toBe('DINING')
    expect(phases.get(3)).toBe('PAYMENT')
    expect(phases.size).toBe(3)
  })
})

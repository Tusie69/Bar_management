/**
 * Module Phục vụ 1 — phép chiếu sơ đồ bàn cho WAITER không chở dữ liệu khách.
 *
 * Test này KHÔNG cần MySQL vì nó kiểm đúng chỗ quyết định: hàm thuần biến
 * projection đầy đủ của Lễ tân thành payload của Phục vụ. Phần "ai được gọi
 * endpoint nào" là chuyện của RBAC và được kiểm qua HTTP + database thật ở
 * waiter-module1.mysql.test.ts.
 */
import { describe, expect, it } from 'vitest'

import type {
  FloorClaimProjection,
  FloorProjection,
  FloorTableProjection,
} from '../src/modules/tables/floor-projection.repository.js'
import {
  WAITER_FORBIDDEN_KEYS,
  toWaiterFloorProjection,
} from '../src/modules/tables/waiter-floor-projection.js'

const GUEST_NAME = 'Nguyễn Văn Khách'
const GUEST_PHONE_LAST3 = '789'

function claim(overrides: Partial<FloorClaimProjection> = {}): FloorClaimProjection {
  return {
    kind: 'VISIT',
    reservationId: 4242,
    visitId: 9001,
    waitlistEntryId: null,
    holdId: null,
    guestName: GUEST_NAME,
    phoneLast3: GUEST_PHONE_LAST3,
    partySize: 4,
    turnNo: null,
    flags: ['BIRTHDAY', 'RETURNING'],
    honorific: 'MR',
    iconKeys: ['star'],
    groupId: null,
    groupDisplayCode: null,
    groupMemberTableIds: [],
    startsAt: '2026-11-20T13:05:00.000Z',
    deadlineAt: null,
    holdOverdue: false,
    paid: false,
    origin: 'RESERVATION',
    sourceCode: 'HOTLINE',
    version: 3,
    lateConfirmedAt: null,
    canCall: true,
    ...overrides,
  }
}

function table(overrides: Partial<FloorTableProjection> = {}): FloorTableProjection {
  const tableClaim = overrides.claim === undefined ? claim() : overrides.claim
  return {
    id: 11,
    code: 'A1',
    displayName: 'A1',
    type: 'TABLE',
    capacity: 4,
    area: { code: 'A', name: 'Khu A', floor: 1 },
    position: { x: 10, y: 20 },
    state: 'IN_USE',
    isBackup: false,
    version: 2,
    staleFromPreviousDay: false,
    allocationBusinessDate: '2026-11-20',
    activeVisit: tableClaim !== null && tableClaim.kind === 'VISIT'
      ? {
          id: tableClaim.visitId!,
          version: tableClaim.version,
          tableCodes: ['A1'],
          displayName: GUEST_NAME,
          phoneLast3: GUEST_PHONE_LAST3,
          guestCount: tableClaim.partySize,
          startedAt: tableClaim.startsAt,
          origin: 'RESERVATION',
          paid: tableClaim.paid,
          note: null,
        }
      : null,
    tableId: 11,
    tableCode: 'A1',
    catalogStatus: 'ACTIVE',
    isSpare: false,
    displayState: 'IN_USE',
    arrivalPhase: null,
    arrivalTime: null,
    minutesLate: 0,
    claim: tableClaim,
    groupId: null,
    groupDisplayCode: null,
    groupMemberTableIds: [],
    claimOwner: tableClaim === null ? null : 'TABLE',
    seatedTurnCount: 2,
    ...overrides,
  }
}

function projection(overrides: Partial<FloorProjection> = {}): FloorProjection {
  return {
    businessDate: '2026-11-20',
    serverNow: '2026-11-20T14:00:00.000Z',
    changeSeq: '5120',
    tables: [table()],
    groups: [],
    ...overrides,
  }
}

/** Mọi khoá xuất hiện ở bất kỳ độ sâu nào trong payload. */
function allKeys(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) allKeys(item, found)
    return found
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      found.add(key)
      allKeys(nested, found)
    }
  }
  return found
}

/** Mọi giá trị chuỗi trong payload, để so khớp chính xác thay vì substring. */
function allStrings(value: unknown, found: string[] = []): string[] {
  if (typeof value === 'string') found.push(value)
  else if (Array.isArray(value)) for (const item of value) allStrings(item, found)
  else if (value !== null && typeof value === 'object') {
    for (const nested of Object.values(value)) allStrings(nested, found)
  }
  return found
}

describe('toWaiterFloorProjection — dữ liệu khách không rời máy chủ', () => {
  it('không có khoá nào thuộc danh sách cấm, ở bất kỳ độ sâu nào', () => {
    const keys = allKeys(toWaiterFloorProjection(projection({
      tables: [table(), table({ tableId: 12, tableCode: 'A2', claim: claim({ visitId: 9002 }) })],
      groups: [{
        id: 7,
        symbolNo: 1,
        displayCode: 'G01',
        tableIds: [11, 12],
        origin: 'LAYOUT',
        version: 4,
        name: 'G01',
        zoneId: 1,
        totalSeats: 8,
        isOutOfService: false,
        displayState: 'IN_USE',
        claim: claim({ groupId: 7, groupDisplayCode: 'G01', groupMemberTableIds: [11, 12] }),
        businessDate: '2026-11-20',
        seatedTurnCount: 2,
      }],
    })))
    for (const forbidden of WAITER_FORBIDDEN_KEYS) {
      expect([...keys], `khoá bị cấm: ${forbidden}`).not.toContain(forbidden)
    }
  })

  it('không có chuỗi nào chứa tên, ba số cuối, nguồn đặt hay cờ nhận dạng khách', () => {
    const result = toWaiterFloorProjection(projection())
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain(GUEST_NAME)
    expect(serialized).not.toContain('Nguyễn')
    expect(serialized).not.toContain('HOTLINE')
    expect(serialized).not.toContain('BIRTHDAY')
    expect(serialized).not.toContain('RETURNING')
    // Ba số cuối so khớp chính xác trên từng giá trị chuỗi: '789' có thể xuất
    // hiện hợp lệ bên trong một id hoặc một mốc thời gian.
    expect(allStrings(result)).not.toContain(GUEST_PHONE_LAST3)
  })

  it('giữ nguyên thông tin vận hành mà Phục vụ cần để làm việc', () => {
    const [seated] = toWaiterFloorProjection(projection()).tables
    expect(seated).toMatchObject({
      tableId: 11,
      tableCode: 'A1',
      displayState: 'IN_USE',
      catalogStatus: 'ACTIVE',
      seatedTurnCount: 2,
      claimOwner: 'TABLE',
    })
    expect(seated?.claim).toEqual({
      kind: 'VISIT',
      visitId: 9001,
      partySize: 4,
      startsAt: '2026-11-20T13:05:00.000Z',
      deadlineAt: null,
      holdOverdue: false,
      paid: false,
      version: 3,
      groupId: null,
      groupDisplayCode: null,
      groupMemberTableIds: [],
      flags: [],
      origin: null,
      sourceCode: null,
      turnNo: null,
    })
  })

  it('bàn ghép: mọi ô bàn trỏ về MỘT visitId chung, không sinh Phiên riêng', () => {
    const shared = { groupId: 7, groupDisplayCode: 'G01', groupMemberTableIds: [11, 12] }
    const result = toWaiterFloorProjection(projection({
      tables: [
        table({
          claim: claim({ ...shared }),
          groupId: 7, groupDisplayCode: 'G01', groupMemberTableIds: [11, 12], claimOwner: 'GROUP',
        }),
        table({
          tableId: 12, tableCode: 'A2', claim: claim({ ...shared }),
          groupId: 7, groupDisplayCode: 'G01', groupMemberTableIds: [11, 12], claimOwner: 'GROUP',
        }),
      ],
    }))
    const visitIds = new Set(result.tables.map((entry) => entry.claim?.visitId))
    expect(visitIds).toEqual(new Set([9001]))
    for (const entry of result.tables) {
      expect(entry.claim?.groupMemberTableIds).toEqual([11, 12])
      expect(entry.claimOwner).toBe('GROUP')
    }
  })

  /**
   * v1.1: sơ đồ Phục vụ chỉ nói về khách ĐANG NGỒI.
   *
   * Một bàn đã đặt mà khách chưa tới phải ra khỏi payload hoàn toàn — không
   * `BOOKED`, không giờ hẹn, không claim đặt bàn — chứ không phải được frontend
   * lờ đi. Giữ lại trong payload nghĩa là "B2 có khách đặt lúc 22:00 cho 4
   * người" vẫn đọc được từ DevTools của bất kỳ máy Phục vụ nào, và đó đúng là
   * thứ biên bản 15/11 không cấp cho cấp thứ sáu.
   */
  it('bàn đã đặt chưa tới được chiếu thành bàn trống, không còn dấu vết đặt bàn', () => {
    const result = toWaiterFloorProjection(projection({
      tables: [
        table({ tableId: 21, tableCode: 'B1', displayState: 'EMPTY', claim: null, activeVisit: null }),
        table({
          tableId: 22, tableCode: 'B2', displayState: 'BOOKED', arrivalPhase: 'SCHEDULED',
          arrivalTime: '2026-11-20T15:00:00.000Z', activeVisit: null,
          claim: claim({ kind: 'RESERVATION', visitId: null, paid: false }),
        }),
      ],
    }))
    expect(result.tables[0]?.claim).toBeNull()
    expect(result.tables[1]?.claim).toBeNull()
    expect(result.tables[1]?.displayState).toBe('EMPTY')
    expect(result.tables[1]?.waiterPhase).toBeNull()
    expect(result.tables[1]?.arrivalTime).toBeNull()
    expect(result.tables[1]?.arrivalPhase).toBeNull()
    expect(JSON.stringify(result)).not.toContain('2026-11-20T15:00:00.000Z')
    expect(JSON.stringify(result)).not.toContain(GUEST_NAME)
  })

  it('trạng thái lượt khách đi theo visitId, không theo ô bàn', () => {
    const shared = { groupId: 7, groupDisplayCode: 'G01', groupMemberTableIds: [11, 12] }
    const result = toWaiterFloorProjection(
      projection({
        tables: [
          table({ claim: claim({ ...shared }), ...shared, claimOwner: 'GROUP' }),
          table({ tableId: 12, tableCode: 'A2', claim: claim({ ...shared }), ...shared, claimOwner: 'GROUP' }),
        ],
      }),
      new Map([[9001, 'AWAITING_FOOD' as const]]),
    )
    expect(result.tables.map((entry) => entry.waiterPhase)).toEqual(['AWAITING_FOOD', 'AWAITING_FOOD'])
  })

  /**
   * Thiếu số liệu thì đoán về phía làm Phục vụ đi tới bàn, không đoán về phía
   * "bàn này ổn rồi".
   */
  it('Phiên không có trong bản đồ trạng thái được coi là vừa ngồi xuống', () => {
    const result = toWaiterFloorProjection(projection({ tables: [table({ claim: claim({}) })] }), new Map())
    expect(result.tables[0]?.waiterPhase).toBe('ARRIVED')
  })

  it('bàn ngừng phục vụ không mang trạng thái lượt khách nào', () => {
    const result = toWaiterFloorProjection(
      projection({
        tables: [table({ tableId: 31, tableCode: 'C1', displayState: 'OUT_OF_SERVICE', claim: null, activeVisit: null })],
      }),
    )
    expect(result.tables[0]?.displayState).toBe('OUT_OF_SERVICE')
    expect(result.tables[0]?.waiterPhase).toBeNull()
  })

  it('cờ đã thanh toán đi qua được, vì đó là thứ khoá gửi món mới', () => {
    const result = toWaiterFloorProjection(projection({
      tables: [table({ claim: claim({ paid: true }) })],
    }))
    expect(result.tables[0]?.claim?.paid).toBe(true)
  })

  it('không làm thay đổi projection gốc mà Lễ tân đang dùng', () => {
    const source = projection()
    const snapshot = JSON.stringify(source)
    toWaiterFloorProjection(source)
    expect(JSON.stringify(source)).toBe(snapshot)
    expect(source.tables[0]?.claim?.guestName).toBe(GUEST_NAME)
  })
})

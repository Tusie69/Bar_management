/**
 * TU-34/TU-32 — Luật của mô hình quyền riêng từng tài khoản.
 *
 * Chạy không cần MySQL: đây là phần quyết định "ai được sửa gì, cấp thêm được
 * tới đâu, và một tick checkbox nghĩa là gì". Phần đi qua database nằm ở
 * `tu34-account-permissions.mysql.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import { AppError } from '../src/errors/app-error.js'
import {
  assertCanEditPermissions,
  assertCanViewPermissions,
  effectivePermissions,
  grantableCeiling,
  OWNER_ONLY_PERMISSIONS,
  permissionViews,
  planOverrideChanges,
  PROTECTED_PERMISSIONS,
} from '../src/modules/accounts/permission-model.js'

const adminBase = ['audit.read', 'report.read', 'reservation.cancel', 'reservation.update', 'user.manage', 'user.read']

const ALL_PERMISSIONS = [
  'audit.read', 'customer.anonymize', 'customer.phone.reveal', 'customer.view_masked',
  'payment.collect', 'report.read', 'reservation.cancel', 'reservation.update',
  'user.manage', 'user.read', 'venue.configure', 'visit.checkin',
]
const READ_ONLY_PERMISSIONS = ['audit.read', 'customer.phone.reveal', 'customer.view_masked', 'report.read', 'user.read']

const ceilingFor = (kind: 'ADMIN' | 'STAFF', accessLevel: 'WRITE' | 'READ_ONLY' | null = null) =>
  grantableCeiling(ALL_PERMISSIONS, { kind, accessLevel }, READ_ONLY_PERMISSIONS)

function codeOf(error: unknown): string {
  return error instanceof AppError ? error.code : `not-an-AppError:${String(error)}`
}

function catchError(operation: () => void): unknown {
  try {
    operation()
    return new Error('expected a throw')
  } catch (error) {
    return error
  }
}

describe('trần quyền của một tài khoản', () => {
  it('không ai được cấp lẻ việc của riêng SuperAdmin', () => {
    const ceiling = ceilingFor('ADMIN', 'WRITE')
    for (const code of OWNER_ONLY_PERMISSIONS) expect(ceiling.has(code)).toBe(false)
    expect(ceilingFor('STAFF').has('venue.configure')).toBe(false)
  })

  it('Admin Read-Only chỉ được cấp thêm quyền đọc', () => {
    const ceiling = ceilingFor('ADMIN', 'READ_ONLY')
    expect(ceiling.has('report.read')).toBe(true)
    expect(ceiling.has('reservation.cancel')).toBe(false)
    expect(ceiling.has('payment.collect')).toBe(false)
  })

  it('nhân viên được cấp thêm mọi quyền còn lại', () => {
    const ceiling = ceilingFor('STAFF')
    expect(ceiling.has('report.read')).toBe(true)
    expect(ceiling.has('customer.phone.reveal')).toBe(true)
    expect(ceiling.has('payment.collect')).toBe(true)
  })
})

describe('quyền hiệu dụng', () => {
  it('tài khoản chưa có override giữ nguyên quyền vai trò', () => {
    expect(effectivePermissions(adminBase, new Map(), ceilingFor('ADMIN', 'WRITE'))).toEqual(adminBase)
  })

  it('tắt một quyền thì mất quyền đó', () => {
    const overrides = new Map([['report.read', false]])
    const effective = effectivePermissions(adminBase, overrides, ceilingFor('ADMIN', 'WRITE'))
    expect(effective).not.toContain('report.read')
    expect(effective).toContain('user.read')
  })

  it('SuperAdmin cấp thêm được quyền ngoài vai trò', () => {
    // Thay đổi so với bản đầu của TU-34: Lễ tân nhận được quyền xem SĐT đầy đủ
    // khi SuperAdmin tick, chứ không bị từ chối nữa.
    const receptionistBase = ['customer.view_masked', 'reservation.update', 'visit.checkin']
    const overrides = new Map([['customer.phone.reveal', true]])
    expect(effectivePermissions(receptionistBase, overrides, ceilingFor('STAFF')))
      .toContain('customer.phone.reveal')
  })

  it('cấp thêm vẫn bị trần chặn: không ai nhận được quyền của riêng SuperAdmin', () => {
    const overrides = new Map([['venue.configure', true], ['customer.anonymize', true]])
    const effective = effectivePermissions(adminBase, overrides, ceilingFor('ADMIN', 'WRITE'))
    expect(effective).not.toContain('venue.configure')
    expect(effective).not.toContain('customer.anonymize')
  })

  it('Admin Read-Only không nhận được quyền ghi dù bật override', () => {
    const readOnlyBase = ['audit.read', 'report.read', 'user.read']
    const overrides = new Map([['user.manage', true], ['reservation.cancel', true]])
    expect(effectivePermissions(readOnlyBase, overrides, ceilingFor('ADMIN', 'READ_ONLY')))
      .toEqual(readOnlyBase)
  })
})

describe('bảng checkbox', () => {
  const staffBase = ['customer.view_masked', 'reservation.update']

  it('quyền ngoài vai trò nhưng trong trần thì tick được', () => {
    const views = permissionViews(ALL_PERMISSIONS, staffBase, new Map(), ceilingFor('STAFF'))
    expect(views.find((view) => view.code === 'report.read'))
      .toMatchObject({ grantedByRole: false, enabled: false, editable: true, grantable: true })
  })

  it('quyền ngoài trần thì khóa hẳn', () => {
    const views = permissionViews(ALL_PERMISSIONS, staffBase, new Map(), ceilingFor('STAFF'))
    expect(views.find((view) => view.code === 'venue.configure'))
      .toMatchObject({ enabled: false, editable: false, grantable: false })
  })

  it('checkbox phản ánh quyền hiệu dụng, kể cả quyền vừa được cấp thêm', () => {
    const views = permissionViews(
      ALL_PERMISSIONS,
      staffBase,
      new Map([['report.read', true], ['reservation.update', false]]),
      ceilingFor('STAFF'),
    )
    expect(views.find((view) => view.code === 'report.read')).toMatchObject({ enabled: true, overridden: true })
    expect(views.find((view) => view.code === 'reservation.update')).toMatchObject({ enabled: false, overridden: true })
  })

  it('quyền được bảo vệ thì không cho tắt', () => {
    const views = permissionViews(ALL_PERMISSIONS, ALL_PERMISSIONS, new Map(), ceilingFor('ADMIN', 'WRITE'))
    for (const code of PROTECTED_PERMISSIONS) {
      expect(views.find((view) => view.code === code)!.editable).toBe(false)
    }
  })
})

describe('ai được đổi quyền của ai', () => {
  const staff = { id: 11, kind: 'STAFF' as const }
  const admin = { id: 12, kind: 'ADMIN' as const }
  const owner = { id: 13, kind: 'OWNER' as const }

  it('SuperAdmin đổi được quyền Admin và nhân viên', () => {
    expect(() => assertCanEditPermissions(1, 'OWNER', null, admin)).not.toThrow()
    expect(() => assertCanEditPermissions(1, 'OWNER', null, staff)).not.toThrow()
  })

  it('Admin Edit không đụng được vào phân quyền, kể cả với nhân viên', () => {
    // TU-32: cấp 2 dùng mọi tính năng vận hành nhưng KHÔNG phân quyền.
    expect(codeOf(catchError(() => assertCanEditPermissions(1, 'ADMIN', 'WRITE', staff))))
      .toBe('PERMISSION_MANAGEMENT_DENIED')
    expect(codeOf(catchError(() => assertCanEditPermissions(1, 'ADMIN', 'WRITE', admin))))
      .toBe('PERMISSION_MANAGEMENT_DENIED')
  })

  it('Admin Read-Only cũng không sửa được gì', () => {
    expect(codeOf(catchError(() => assertCanEditPermissions(1, 'ADMIN', 'READ_ONLY', staff))))
      .toBe('PERMISSION_MANAGEMENT_DENIED')
  })

  it('chỉ SuperAdmin xem được bảng phân quyền', () => {
    expect(() => assertCanViewPermissions('OWNER')).not.toThrow()
    expect(codeOf(catchError(() => assertCanViewPermissions('ADMIN')))).toBe('PERMISSION_MANAGEMENT_DENIED')
  })

  it('không ai sửa được quyền của chính mình hay của SuperAdmin', () => {
    expect(codeOf(catchError(() => assertCanEditPermissions(11, 'OWNER', null, staff)))).toBe('CANNOT_MANAGE_SELF')
    expect(codeOf(catchError(() => assertCanEditPermissions(1, 'OWNER', null, owner)))).toBe('OWNER_PROTECTED')
  })
})

describe('lọc thay đổi trước khi ghi', () => {
  const staffCeiling = ceilingFor('STAFF')

  it('chỉ ghi những ô thật sự đổi', () => {
    const changes = planOverrideChanges(
      new Map([['report.read', false], ['reservation.cancel', true]]),
      adminBase,
      new Map(),
      staffCeiling,
    )
    expect(changes).toEqual([{ code: 'report.read', from: true, to: false }])
  })

  it('bật một quyền ngoài vai trò là một thay đổi hợp lệ', () => {
    const changes = planOverrideChanges(
      new Map([['payment.collect', true]]),
      ['reservation.update'],
      new Map(),
      staffCeiling,
    )
    expect(changes).toEqual([{ code: 'payment.collect', from: false, to: true }])
  })

  it('bật lại một quyền đã tắt là một thay đổi', () => {
    const changes = planOverrideChanges(
      new Map([['report.read', true]]),
      adminBase,
      new Map([['report.read', false]]),
      staffCeiling,
    )
    expect(changes).toEqual([{ code: 'report.read', from: false, to: true }])
  })

  it('từ chối quyền ngoài trần thay vì âm thầm bỏ qua', () => {
    expect(codeOf(catchError(() => planOverrideChanges(
      new Map([['venue.configure', true]]), adminBase, new Map(), ceilingFor('ADMIN', 'WRITE'),
    )))).toBe('PERMISSION_NOT_GRANTABLE')
  })

  it('từ chối cấp quyền ghi cho Admin Read-Only', () => {
    expect(codeOf(catchError(() => planOverrideChanges(
      new Map([['user.manage', true]]), ['report.read'], new Map(), ceilingFor('ADMIN', 'READ_ONLY'),
    )))).toBe('PERMISSION_NOT_GRANTABLE')
  })

  it('từ chối tắt quyền được bảo vệ', () => {
    expect(codeOf(catchError(() => planOverrideChanges(
      new Map([['user.read', false]]), adminBase, new Map(), staffCeiling,
    )))).toBe('PERMISSION_PROTECTED')
  })

  it('sửa một tài khoản không đụng tới quyền nào khác', () => {
    const changes = planOverrideChanges(new Map([['report.read', false]]), adminBase, new Map(), staffCeiling)
    expect(changes.map((change) => change.code)).toEqual(['report.read'])
  })
})

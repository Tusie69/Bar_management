/**
 * TU-34 — Luật của mô hình quyền riêng từng tài khoản.
 *
 * Chạy không cần MySQL: đây là phần quyết định "ai được sửa gì, và một tick
 * checkbox nghĩa là gì". Phần đi qua database nằm ở
 * `tu34-account-permissions.mysql.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import { AppError } from '../src/errors/app-error.js'
import {
  assertCanEditPermissions,
  effectivePermissions,
  permissionViews,
  planOverrideChanges,
  PROTECTED_PERMISSIONS,
} from '../src/modules/accounts/permission-model.js'

const adminBase = ['audit.read', 'report.read', 'reservation.cancel', 'reservation.update', 'user.manage', 'user.read']

function codeOf(error: unknown): string {
  return error instanceof AppError ? error.code : `not-an-AppError:${String(error)}`
}

describe('giao điểm quyền', () => {
  it('tài khoản chưa có override giữ nguyên quyền vai trò', () => {
    expect(effectivePermissions(adminBase, new Map())).toEqual(adminBase)
  })

  it('override chỉ tắt bớt trong trần vai trò', () => {
    const overrides = new Map([['report.read', false]])
    expect(effectivePermissions(adminBase, overrides)).not.toContain('report.read')
    expect(effectivePermissions(adminBase, overrides)).toContain('user.read')
  })

  it('không thể dùng override để nâng quyền vượt vai trò', () => {
    // Lễ tân không có payment.collect trong vai trò. Một hàng override bật
    // quyền đó cũng không đưa nó vào quyền hiệu dụng.
    const receptionistBase = ['reservation.create', 'visit.checkin']
    const overrides = new Map([['payment.collect', true]])
    expect(effectivePermissions(receptionistBase, overrides)).toEqual(receptionistBase)
  })

  it('Admin Read-Only không có quyền mutation dù bật override', () => {
    // Quyền nền của Admin Read-Only đã bị lọc trước khi tới đây.
    const readOnlyBase = ['audit.read', 'report.read', 'user.read']
    const overrides = new Map([['user.manage', true], ['reservation.cancel', true]])
    expect(effectivePermissions(readOnlyBase, overrides)).toEqual(readOnlyBase)
  })
})

describe('bảng checkbox', () => {
  const all = ['audit.read', 'payment.collect', 'report.read', 'user.read']

  it('quyền ngoài vai trò hiện tắt và không sửa được', () => {
    const views = permissionViews(all, ['audit.read', 'report.read', 'user.read'], new Map())
    const payment = views.find((view) => view.code === 'payment.collect')!
    expect(payment).toMatchObject({ grantedByRole: false, enabled: false, editable: false })
  })

  it('checkbox phản ánh quyền hiệu dụng, không phải quyền vai trò', () => {
    const views = permissionViews(all, ['audit.read', 'report.read'], new Map([['report.read', false]]))
    expect(views.find((view) => view.code === 'report.read')).toMatchObject({
      grantedByRole: true, enabled: false, overridden: true, editable: true,
    })
    expect(views.find((view) => view.code === 'audit.read')).toMatchObject({ enabled: true, overridden: false })
  })

  it('quyền được bảo vệ thì không cho sửa', () => {
    const views = permissionViews(all, all, new Map())
    for (const view of views) {
      expect(view.editable).toBe(view.grantedByRole && !PROTECTED_PERMISSIONS.has(view.code))
    }
    expect(views.find((view) => view.code === 'user.read')!.editable).toBe(false)
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

  it('Admin Edit chỉ đổi được quyền nhân viên', () => {
    expect(() => assertCanEditPermissions(1, 'ADMIN', 'WRITE', staff)).not.toThrow()
    expect(codeOf(catchError(() => assertCanEditPermissions(1, 'ADMIN', 'WRITE', admin)))).toBe('ADMIN_TARGET_DENIED')
  })

  it('Admin Read-Only không sửa được gì', () => {
    expect(codeOf(catchError(() => assertCanEditPermissions(1, 'ADMIN', 'READ_ONLY', staff)))).toBe('READ_ONLY_ACCOUNT')
  })

  it('không ai sửa được quyền của chính mình hay của SuperAdmin', () => {
    expect(codeOf(catchError(() => assertCanEditPermissions(11, 'OWNER', null, staff)))).toBe('CANNOT_MANAGE_SELF')
    expect(codeOf(catchError(() => assertCanEditPermissions(1, 'OWNER', null, owner)))).toBe('OWNER_PROTECTED')
  })
})

describe('lọc thay đổi trước khi ghi', () => {
  it('chỉ ghi những ô thật sự đổi', () => {
    const changes = planOverrideChanges(
      new Map([['report.read', false], ['audit.read', true]]),
      adminBase,
      new Map(),
    )
    expect(changes).toEqual([{ code: 'report.read', from: true, to: false }])
  })

  it('bật lại một quyền đã tắt là một thay đổi', () => {
    const changes = planOverrideChanges(
      new Map([['report.read', true]]),
      adminBase,
      new Map([['report.read', false]]),
    )
    expect(changes).toEqual([{ code: 'report.read', from: false, to: true }])
  })

  it('từ chối quyền ngoài vai trò thay vì âm thầm bỏ qua', () => {
    expect(codeOf(catchError(() => planOverrideChanges(
      new Map([['payment.collect', true]]), adminBase, new Map(),
    )))).toBe('PERMISSION_NOT_IN_ROLE')
  })

  it('từ chối tắt quyền được bảo vệ', () => {
    expect(codeOf(catchError(() => planOverrideChanges(
      new Map([['user.read', false]]), adminBase, new Map(),
    )))).toBe('PERMISSION_PROTECTED')
  })

  it('sửa một tài khoản không đụng tới quyền nào khác', () => {
    // Danh sách thay đổi chỉ chứa mã được gửi lên; mọi mã khác không có mặt,
    // nên UPDATE không chạm tới chúng.
    const changes = planOverrideChanges(new Map([['report.read', false]]), adminBase, new Map())
    expect(changes.map((change) => change.code)).toEqual(['report.read'])
  })
})

function catchError(operation: () => void): unknown {
  try {
    operation()
    return new Error('expected a throw')
  } catch (error) {
    return error
  }
}

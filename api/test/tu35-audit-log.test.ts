/**
 * TU-35 — Phân loại hành động, cấu hình và kết xuất CSV của nhật ký.
 *
 * Chạy không cần MySQL. Phần đi qua database nằm ở `tu35-audit-log.mysql.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import {
  accessLevelKey,
  actionsForTypes,
  AUDIT_ACTIONS,
  AUDIT_FILTERS,
  canExportAudit,
  DEFAULT_AUDIT_EXPORT_LEVELS,
  DEFAULT_AUDIT_RETENTION_DAYS,
  isAuditFilterType,
  parseExportLevels,
  parseRetentionDays,
} from '../src/modules/operations/audit-actions.js'
import { toCsv } from '../src/modules/operations/audit-csv.js'
import type { AuditEntry } from '../src/modules/operations/audit.repository.js'

function entry(partial: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 1,
    occurredAt: '2026-11-12T14:48:12.000Z',
    actor: 'Lễ tân ca 1',
    actorUsername: 'letan1',
    action: 'RESERVATION_CANCELLED',
    actionLabel: 'Hủy booking',
    actionType: 'booking_cancel',
    target: 'Booking #12 · Mai Minh Thịnh',
    device: 'Chrome trên Windows',
    detail: 'reason: CUSTOMER_REQUEST',
    ...partial,
  }
}

describe('các loại thao tác phải ghi vết', () => {
  it.each([
    ['hủy booking', 'RESERVATION_CANCELLED', 'booking_cancel'],
    ['đổi bàn', 'VISIT_TABLES_MOVED', 'table_move'],
    ['ghép bàn', 'VISIT_TABLES_MERGED', 'table_move'],
    ['tách bàn', 'TABLES_SPLIT', 'table_move'],
    ['xem SĐT đầy đủ', 'CUSTOMER_PHONE_REVEAL', 'phone_reveal'],
    ['đăng nhập', 'AUTH_LOGIN_SUCCEEDED', 'login'],
    ['bị đẩy ra do máy khác đăng nhập', 'AUTH_SESSION_REVOKED', 'login'],
    ['đổi quyền', 'USER_PERMISSIONS_CHANGED', 'permission'],
    ['đổi cấp truy cập', 'ADMIN_ACCESS_LEVEL_CHANGED', 'permission'],
    ['tạo tài khoản', 'USER_ACCOUNT_CREATED', 'account'],
    ['khóa tài khoản', 'USER_ACCOUNT_LOCKED', 'account'],
  ])('%s thuộc nhóm lọc đúng và có nhãn tiếng Việt', (_name, action, type) => {
    const info = AUDIT_ACTIONS[action]
    expect(info, action).toBeDefined()
    expect(info!.type).toBe(type)
    expect(info!.label.length).toBeGreaterThan(0)
  })

  it('bảy nhóm lọc, đúng thứ tự prototype', () => {
    expect(AUDIT_FILTERS.map((filter) => filter.label)).toEqual([
      'Hủy booking', 'Đổi bàn', 'Xem SĐT đầy đủ', 'Giảm giá / hủy món', 'Đăng nhập', 'Đổi quyền', 'Tài khoản',
    ])
  })

  it('nhóm giảm giá chưa có hành động nào và nói rõ lý do', () => {
    const discount = AUDIT_FILTERS.find((filter) => filter.type === 'discount')!
    expect(discount.actions).toEqual([])
    expect(discount.unsupportedNote).toBeTruthy()
  })
})

describe('lọc theo loại', () => {
  it('không chọn nhóm nào thì không lọc', () => {
    expect(actionsForTypes([])).toEqual([])
  })

  it('chọn một nhóm thì trả về đúng mã của nhóm đó', () => {
    expect(actionsForTypes(['booking_cancel'])).toContain('RESERVATION_CANCELLED')
    expect(actionsForTypes(['booking_cancel'])).not.toContain('AUTH_LOGIN_SUCCEEDED')
  })

  it('chọn nhiều nhóm thì gộp, không trùng mã', () => {
    const actions = actionsForTypes(['login', 'permission'])
    expect(new Set(actions).size).toBe(actions.length)
    expect(actions).toContain('AUTH_LOGIN_SUCCEEDED')
    expect(actions).toContain('USER_PERMISSIONS_CHANGED')
  })

  it('nhóm chưa hỗ trợ trả về rỗng, không âm thầm bỏ bộ lọc', () => {
    expect(actionsForTypes(['discount'])).toEqual([])
  })

  it('từ chối loại không có thật', () => {
    expect(isAuditFilterType('login')).toBe(true)
    expect(isAuditFilterType('mọi-thứ')).toBe(false)
  })
})

describe('cấu hình thời gian lưu và quyền xuất', () => {
  it('thiếu cấu hình thì dùng mặc định 90 ngày', () => {
    expect(parseRetentionDays(undefined)).toBe(DEFAULT_AUDIT_RETENTION_DAYS)
    expect(parseRetentionDays('linh tinh')).toBe(DEFAULT_AUDIT_RETENTION_DAYS)
    expect(parseRetentionDays(0)).toBe(DEFAULT_AUDIT_RETENTION_DAYS)
  })

  it('đọc được giá trị đặt trong cấu hình', () => {
    expect(parseRetentionDays(30)).toBe(30)
    expect(parseRetentionDays(365)).toBe(365)
  })

  it('mặc định chỉ SuperAdmin và Admin Edit được xuất file', () => {
    expect(parseExportLevels(undefined)).toEqual([...DEFAULT_AUDIT_EXPORT_LEVELS])
    expect(canExportAudit('OWNER', DEFAULT_AUDIT_EXPORT_LEVELS)).toBe(true)
    expect(canExportAudit('ADMIN_WRITE', DEFAULT_AUDIT_EXPORT_LEVELS)).toBe(true)
    expect(canExportAudit('ADMIN_READ_ONLY', DEFAULT_AUDIT_EXPORT_LEVELS)).toBe(false)
    expect(canExportAudit('RECEPTIONIST', DEFAULT_AUDIT_EXPORT_LEVELS)).toBe(false)
  })

  it('cấu hình đổi được mà không sửa code', () => {
    const configured = parseExportLevels(['OWNER'])
    expect(canExportAudit('ADMIN_WRITE', configured)).toBe(false)
    expect(canExportAudit('OWNER', configured)).toBe(true)
  })

  it('đọc đúng cấp của người đang thao tác', () => {
    expect(accessLevelKey(['OWNER'], null)).toBe('OWNER')
    expect(accessLevelKey(['ADMIN'], 'WRITE')).toBe('ADMIN_WRITE')
    expect(accessLevelKey(['ADMIN'], 'READ_ONLY')).toBe('ADMIN_READ_ONLY')
    expect(accessLevelKey(['RECEPTIONIST'], null)).toBe('RECEPTIONIST')
  })
})

describe('file xuất ra', () => {
  it('có đủ năm cột của prototype cộng cột chi tiết', () => {
    const csv = toCsv([entry()])
    expect(csv.replace('﻿', '').split('\r\n')[0]).toBe(
      '"Thời gian","Người thực hiện","Hành động","Đối tượng","Thiết bị","Chi tiết"',
    )
  })

  it('mở được bằng Excel: có BOM và xuống dòng CRLF', () => {
    const csv = toCsv([entry()])
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv.endsWith('\r\n')).toBe(true)
  })

  it('bọc dấu nháy kép trong nội dung', () => {
    expect(toCsv([entry({ target: 'Bàn "A1"' })])).toContain('"Bàn ""A1"""')
  })

  it('chặn công thức Excel ở đầu ô', () => {
    // Tên khách bắt đầu bằng = sẽ chạy như công thức trên máy người mở file.
    const csv = toCsv([entry({ target: '=1+1' })])
    expect(csv).toContain('"\'=1+1"')
  })

  it('không chứa số điện thoại', () => {
    // Nhật ký ghi việc đã xem số, không ghi số. Dòng xem SĐT dựng từ tên khách.
    const csv = toCsv([entry({
      action: 'CUSTOMER_PHONE_REVEAL',
      actionLabel: 'Xem SĐT đầy đủ',
      target: 'Booking #7 · Lý Mỹ Anh',
      detail: '',
    })])
    expect(csv).not.toMatch(/\d{9,}/)
  })
})

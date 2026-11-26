import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { PORTAL_ROLE_CODES } from '../src/auth/auth-portal.js'
import { DEV_ACCOUNTS } from '../src/modules/dev/dev-accounts.js'
import { DEV_KEEP_TABLES, DEV_WIPE_TABLES, parseDevScenario } from '../src/modules/dev/dev-data.repository.js'

describe('TU-43 kịch bản dữ liệu mẫu', () => {
  it('chỉ nhận ba kịch bản', () => {
    expect(parseDevScenario({ scenario: 'busy' })).toBe('busy')
    expect(parseDevScenario({ scenario: 'quiet' })).toBe('quiet')
    expect(parseDevScenario({ scenario: 'empty' })).toBe('empty')
    expect(() => parseDevScenario({ scenario: 'prod' })).toThrow()
    expect(() => parseDevScenario({})).toThrow()
    expect(() => parseDevScenario(null)).toThrow()
  })
})

describe('TU-43 phân loại bảng khi xoá sạch Dev', () => {
  it('hai danh sách không chồng nhau', () => {
    const keep = new Set<string>(DEV_KEEP_TABLES)
    expect(DEV_WIPE_TABLES.filter((table) => keep.has(table))).toEqual([])
  })

  it('mọi bảng do migration tạo ra đều đã được xếp loại', async () => {
    // Đọc CREATE TABLE từ migration thay vì MySQL để test chạy không cần database.
    // Một migration mới thêm bảng mà quên xếp loại sẽ làm test này đỏ trước khi
    // nút "Xoá sạch" trên Dev báo DEV_RESET_UNCLASSIFIED_TABLE.
    const directory = path.resolve(import.meta.dirname, '../database/migrations')
    const created = new Set<string>()
    const dropped = new Set<string>()
    for (const file of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
      const sql = await readFile(path.join(directory, file), 'utf8')
      for (const match of sql.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?`?([a-z0-9_]+)`?/gi)) {
        created.add(match[1]!.toLowerCase())
        dropped.delete(match[1]!.toLowerCase())
      }
      for (const match of sql.matchAll(/DROP TABLE\s+(?:IF EXISTS\s+)?`?([a-z0-9_]+)`?/gi)) {
        dropped.add(match[1]!.toLowerCase())
      }
      for (const match of sql.matchAll(/RENAME TABLE\s+`?([a-z0-9_]+)`?\s+TO\s+`?([a-z0-9_]+)`?/gi)) {
        dropped.add(match[1]!.toLowerCase())
        created.add(match[2]!.toLowerCase())
      }
    }
    const live = [...created].filter((table) => !dropped.has(table))
    const known = new Set<string>([...DEV_WIPE_TABLES, ...DEV_KEEP_TABLES, 'schema_migrations'])
    expect(live.filter((table) => !known.has(table)).sort()).toEqual([])
  })
})

describe('TU-43 tài khoản mẫu', () => {
  it('phủ đủ mọi vai mà một cổng đăng nhập chấp nhận', () => {
    const portalRoles = new Set(Object.values(PORTAL_ROLE_CODES).flat())
    const accountRoles = new Set(DEV_ACCOUNTS.map((account) => account.roleCode))
    expect([...portalRoles].filter((role) => !accountRoles.has(role)).sort()).toEqual([])
  })

  it('có đủ ba cấp quản trị và tên đăng nhập không trùng', () => {
    const admins = DEV_ACCOUNTS.filter((account) => account.roleCode === 'ADMIN').map((account) => account.accessLevel)
    expect(admins.sort()).toEqual(['READ_ONLY', 'WRITE'])
    expect(DEV_ACCOUNTS.some((account) => account.roleCode === 'OWNER')).toBe(true)
    const usernames = DEV_ACCOUNTS.map((account) => account.username)
    expect(new Set(usernames).size).toBe(usernames.length)
    expect(usernames.every((name) => name.endsWith('_dev'))).toBe(true)
  })

  it('không có mật khẩu nào viết trong code', async () => {
    const source = await readFile(path.resolve(import.meta.dirname, '../src/modules/dev/dev-accounts.ts'), 'utf8')
    expect(source).not.toMatch(/DEV_DEMO_PASSWORD\s*\?\?\s*['"]/)
    expect(source).not.toMatch(/password\s*[:=]\s*['"][^'"]{6,}['"]/i)
  })
})

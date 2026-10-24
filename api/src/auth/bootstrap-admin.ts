import { emitKeypressEvents } from 'node:readline'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'

import { databasePool } from '../database/pool.js'
import { hashPassword } from './password.js'

function argument(name: string): string {
  const index = process.argv.indexOf(`--${name}`)
  const value = index >= 0 ? process.argv[index + 1] : undefined
  if (!value || value.startsWith('--')) throw new Error(`Thiếu tham số --${name}`)
  return value
}

function positiveIntegerArgument(name: string): number {
  const value = Number(argument(name))
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`--${name} phải là số nguyên dương`)
  return value
}

async function hiddenQuestion(prompt: string): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY) throw new Error('Bootstrap yêu cầu terminal tương tác để nhập mật khẩu an toàn.')
  stdout.write(prompt)
  emitKeypressEvents(stdin)
  stdin.setRawMode(true)
  stdin.resume()
  let answer = ''
  try {
    return await new Promise<string>((resolve, reject) => {
      function onKeypress(character: string, key: { name?: string; ctrl?: boolean }): void {
        if (key.ctrl && key.name === 'c') {
          stdin.off('keypress', onKeypress)
          reject(new Error('Đã hủy bootstrap.'))
          return
        }
        if (key.name === 'return') {
          stdin.off('keypress', onKeypress)
          stdout.write('\n')
          resolve(answer)
          return
        }
        if (key.name === 'backspace') {
          answer = answer.slice(0, -1)
          return
        }
        if (character && !key.ctrl) answer += character
      }
      stdin.on('keypress', onKeypress)
    })
  } finally {
    stdin.setRawMode(false)
    stdin.pause()
  }
}

const username = argument('username').trim()
const displayName = argument('display-name').trim()
const organizationId = positiveIntegerArgument('organization-id')
const venueId = positiveIntegerArgument('venue-id')
const roleCode = argument('role-code').trim()

if (!username || username.length > 80) throw new Error('Username không hợp lệ.')
if (!displayName || displayName.length > 120) throw new Error('Display name không hợp lệ.')

const [targetRows] = await databasePool.execute<(RowDataPacket & {
  organization_code: string
  venue_code: string
  role_id: number
})[]>(
  `SELECT o.code AS organization_code, v.code AS venue_code, r.id AS role_id
   FROM organizations AS o
   JOIN venues AS v ON v.organization_id = o.id AND v.id = ?
   JOIN roles AS r ON r.code = ?
   WHERE o.id = ? AND o.status = 'ACTIVE' AND v.status = 'ACTIVE'`,
  [venueId, roleCode, organizationId],
)
const target = targetRows[0]
if (!target) throw new Error('Không tìm thấy organization, venue hoặc role hợp lệ.')

const [existingRows] = await databasePool.execute<RowDataPacket[]>(
  'SELECT 1 FROM users WHERE username = ?',
  [username],
)
if (existingRows[0]) throw new Error('Username đã tồn tại; bootstrap không cập nhật tài khoản hiện có.')

const confirmation = `${username}@${target.organization_code}/${target.venue_code}:${roleCode}`
const prompts = createInterface({ input: stdin, output: stdout })
const suppliedConfirmation = await prompts.question(`Nhập chính xác "${confirmation}" để tạo tài khoản ACTIVE: `)
prompts.close()
if (suppliedConfirmation !== confirmation) throw new Error('Xác nhận không khớp. Không có dữ liệu nào được ghi.')

const password = await hiddenQuestion('Mật khẩu mới (tối thiểu 12 ký tự): ')
const passwordConfirmation = await hiddenQuestion('Nhập lại mật khẩu: ')
if (password.length < 12) throw new Error('Mật khẩu phải có ít nhất 12 ký tự.')
if (password !== passwordConfirmation) throw new Error('Mật khẩu nhập lại không khớp.')
const passwordHash = await hashPassword(password)

const connection = await databasePool.getConnection()
try {
  await connection.beginTransaction()
  const [userResult] = await connection.execute<ResultSetHeader>(
    `INSERT INTO users (username, display_name, password_hash, status)
     VALUES (?, ?, ?, 'ACTIVE')`,
    [username, displayName, passwordHash],
  )
  const [membershipResult] = await connection.execute<ResultSetHeader>(
    'INSERT INTO memberships (organization_id, user_id) VALUES (?, ?)',
    [organizationId, userResult.insertId],
  )
  await connection.execute(
    `INSERT INTO membership_roles (organization_id, membership_id, role_id, venue_id)
     VALUES (?, ?, ?, ?)`,
    [organizationId, membershipResult.insertId, target.role_id, venueId],
  )
  await connection.commit()
  stdout.write(`Đã tạo tài khoản ${username} với role ${roleCode} tại venue ${target.venue_code}.\n`)
} catch (error) {
  await connection.rollback()
  throw error
} finally {
  connection.release()
  await databasePool.end()
}

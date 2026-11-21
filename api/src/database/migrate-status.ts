/**
 * Tình trạng migration của database đang trỏ tới, và cách sửa một checksum lệch.
 *
 * `db:migrate` dừng lại ở migration đầu tiên có checksum khác với lúc chạy, và
 * nó chỉ nói "Migration đã bị thay đổi sau khi chạy: <file>". Câu đó đúng
 * nhưng không đủ để quyết định: người đọc vẫn chưa biết còn bao nhiêu file
 * chưa chạy, file nào lệch, và lệch vì nội dung thật hay vì CRLF.
 *
 *   pnpm --filter @21gam/api db:migrate:status
 *   pnpm --filter @21gam/api db:migrate:status -- --repair=0031_x.sql --reason="..."
 *
 * `--repair` CHỈ ghi lại checksum, không chạy một câu SQL nào. Nó dành cho
 * đúng một tình huống: file đã chạy rồi, schema trong database đúng như file
 * hiện tại mô tả, và chỉ dòng ghi nhận là cũ — thường là vì ai đó sửa file sau
 * khi đã chạy nó trên máy mình. Nếu schema thật sự khác file thì sửa checksum
 * là giấu đi sự khác nhau đó, nên lệnh bắt buộc có `--reason` và in cả hai
 * checksum ra trước khi ghi.
 *
 * Với database dùng một lần (integration test), cách đúng hơn luôn là dựng
 * lại từ đầu: `DROP DATABASE` rồi `db:migrate`. `--repair` là lối thoát cho
 * database có dữ liệu không dựng lại được.
 */
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import mysql from 'mysql2/promise'

export type MigrationState = 'applied' | 'pending' | 'checksum-mismatch'

export interface MigrationStatusEntry {
  filename: string
  state: MigrationState
  recordedChecksum: string | null
  fileChecksum: string
  /** True khi hai checksum chỉ khác nhau ở kiểu xuống dòng. */
  lineEndingOnly: boolean
}

export interface MigrationChecksums {
  canonical: string
  accepted: Set<string>
}

/** Giống hệt `migrate.ts`: khác kiểu xuống dòng không bị coi là đổi nội dung. */
export function migrationChecksums(sql: string): MigrationChecksums {
  const normalized = sql.replace(/\r\n/g, '\n')
  const digest = (value: string) => createHash('sha256').update(value).digest('hex')
  return {
    canonical: digest(normalized),
    accepted: new Set([digest(sql), digest(normalized), digest(normalized.replace(/\n/g, '\r\n'))]),
  }
}

export function classifyMigration(
  filename: string,
  sql: string,
  recordedChecksum: string | null,
): MigrationStatusEntry {
  const checksums = migrationChecksums(sql)
  if (recordedChecksum === null) {
    return { filename, state: 'pending', recordedChecksum: null, fileChecksum: checksums.canonical, lineEndingOnly: false }
  }
  if (checksums.accepted.has(recordedChecksum)) {
    return { filename, state: 'applied', recordedChecksum, fileChecksum: checksums.canonical, lineEndingOnly: false }
  }
  return {
    filename,
    state: 'checksum-mismatch',
    recordedChecksum,
    fileChecksum: checksums.canonical,
    lineEndingOnly: false,
  }
}

async function main(): Promise<void> {
  const { env } = await import('../config/env.js')
  const migrationsDirectory = path.resolve(process.cwd(), 'database', 'migrations')
  let repair: string | null = null
  let reason: string | null = null
  for (const argument of process.argv.slice(2)) {
    if (argument.startsWith('--repair=')) repair = argument.slice('--repair='.length)
    else if (argument.startsWith('--reason=')) reason = argument.slice('--reason='.length)
    else throw new Error(`Tham số không hỗ trợ: ${argument}`)
  }
  if (repair && !reason?.trim()) {
    throw new Error('--repair bắt buộc đi kèm --reason="vì sao checksum được ghi lại".')
  }

  const connection = await mysql.createConnection({
    host: env.database.host,
    port: env.database.port,
    database: env.database.name,
    user: env.database.user,
    password: env.database.password,
    charset: 'utf8mb4',
  })
  try {
    const [recordedRows] = await connection.execute<mysql.RowDataPacket[]>(
      'SELECT filename, checksum FROM schema_migrations',
    )
    const recorded = new Map(recordedRows.map((row) => [String(row.filename), String(row.checksum)]))
    const filenames = (await readdir(migrationsDirectory)).filter((name) => name.endsWith('.sql')).sort()
    const entries: MigrationStatusEntry[] = []
    for (const filename of filenames) {
      const sql = await readFile(path.join(migrationsDirectory, filename), 'utf8')
      entries.push(classifyMigration(filename, sql, recorded.get(filename) ?? null))
    }

    if (repair) {
      const entry = entries.find((candidate) => candidate.filename === repair)
      if (!entry) throw new Error(`Không có migration tên ${repair}.`)
      if (entry.state !== 'checksum-mismatch') {
        throw new Error(`${repair} đang ở trạng thái "${entry.state}", không có checksum nào để sửa.`)
      }
      console.error(`Ghi lại checksum cho ${repair}`)
      console.error(`  đã ghi nhận : ${entry.recordedChecksum}`)
      console.error(`  theo file   : ${entry.fileChecksum}`)
      console.error(`  lý do       : ${reason}`)
      console.error('  KHÔNG chạy SQL nào. Hãy chắc chắn schema đã khớp với file.')
      await connection.execute('UPDATE schema_migrations SET checksum = ? WHERE filename = ?', [entry.fileChecksum, repair])
      entry.state = 'applied'
      entry.recordedChecksum = entry.fileChecksum
    }

    const mismatched = entries.filter((entry) => entry.state === 'checksum-mismatch')
    console.log(JSON.stringify({
      database: env.database.name,
      total: entries.length,
      applied: entries.filter((entry) => entry.state === 'applied').length,
      pending: entries.filter((entry) => entry.state === 'pending').map((entry) => entry.filename),
      mismatched,
    }, null, 2))
    if (mismatched.length) process.exitCode = 1
  } finally {
    await connection.end()
  }
}

// Chỉ chạy khi được gọi trực tiếp; test import các hàm thuần ở trên.
if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('database', 'migrate-status.ts'))) {
  await main()
}

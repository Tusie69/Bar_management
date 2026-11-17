/**
 * TU-35 — Kết xuất CSV của nhật ký thao tác.
 *
 * Tách khỏi repository vì đây là định dạng thuần: không chạm database, nên
 * test được trực tiếp, kể cả phần chặn công thức.
 */
import type { AuditEntry } from './audit.repository.js'

const CSV_HEADERS = ['Thời gian', 'Người thực hiện', 'Hành động', 'Đối tượng', 'Thiết bị', 'Chi tiết']
const CRLF = '\r\n'
/** Excel trên Windows đọc CSV không BOM theo bảng mã hệ thống → tiếng Việt vỡ. */
const BOM = '﻿'

/**
 * Một ô CSV.
 *
 * Dấu nháy ở đầu ô chặn công thức: Excel coi `=`, `+`, `-`, `@` đầu ô là công
 * thức, nên một tên khách bắt đầu bằng `=` sẽ chạy như công thức trên máy
 * người mở file.
 */
function csvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return `"${guarded.replace(/"/g, '""')}"`
}

export function toCsv(entries: readonly AuditEntry[]): string {
  const lines = [CSV_HEADERS.map(csvCell).join(',')]
  for (const entry of entries) {
    lines.push([
      entry.occurredAt,
      entry.actorUsername ? `${entry.actor} (@${entry.actorUsername})` : entry.actor,
      entry.actionLabel,
      entry.target,
      entry.device,
      entry.detail,
    ].map(csvCell).join(','))
  }
  return BOM + lines.join(CRLF) + CRLF
}

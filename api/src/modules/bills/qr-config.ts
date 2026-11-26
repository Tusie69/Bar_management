/**
 * HU-44 v1.1 — tài khoản nhận tiền cho mã QR, đọc từ `venue_settings`.
 *
 * Tách khỏi `payment.repository.ts` vì từ v1.1 có HAI nơi cần nó: lúc XUẤT HOÁ
 * ĐƠN (QR in lên hoá đơn để khách cầm ra quầy) và lúc GHI NHẬN thanh toán (chép
 * lại chuỗi đã dùng vào giao dịch để đối soát). Để nó ở một module riêng cũng
 * tránh vòng import giữa bill và payment.
 *
 * Ngân hàng là Techcombank (Hưng 26/11, thay MoMo), nhưng mã BIN vẫn nằm trong
 * cấu hình chứ không viết thẳng vào code: đổi ngân hàng là việc của quán, không
 * phải việc của một lần deploy.
 *
 * KHÔNG có giá trị mặc định cho số tài khoản. Một số mặc định là cách để tiền
 * của khách chạy vào một tài khoản không ai kiểm.
 */
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise'

import type { AuthenticatedActor } from '../../auth/authenticated-actor.js'

type Queryable = Pool | PoolConnection

export const SETTING_BANK_BIN = 'payment.vietqr.bank_bin'
export const SETTING_ACCOUNT_NUMBER = 'payment.vietqr.account_number'
export const SETTING_ACCOUNT_NAME = 'payment.vietqr.account_name'
export const SETTING_IS_DEMO = 'payment.vietqr.is_demo'
export const SETTING_VENUE_SHORT_NAME = 'payment.transfer.venue_short_name'

/** Tên viết tắt mặc định trong nội dung chuyển khoản, đúng như mockup NA-44. */
export const DEFAULT_VENUE_SHORT_NAME = '21GAM'

export interface QrConfiguration {
  bankBin: string
  accountNumber: string
  accountName: string
  venueShortName: string
  /** Quán chưa cung cấp tài khoản thật → màn hình phủ nhãn DEMO lên mã. */
  isDemo: boolean
}

interface SettingRow extends RowDataPacket {
  key: string
  value: unknown
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

/**
 * Đọc một cấu hình dạng chuỗi từ cột JSON.
 *
 * `mysql2` ĐÃ parse cột JSON, nên `"970415"` về tới đây là chuỗi `970415` chứ
 * không phải chuỗi `"970415"`. Gọi `JSON.parse` lên nó một lần nữa là cái bẫy
 * im lặng của hàm này: `JSON.parse('970415')` thành công và trả về SỐ 970415,
 * rồi kiểm `typeof === 'string'` trượt, và cấu hình biến mất như thể chưa ai
 * nhập. Tên chủ tài khoản thì không parse được nên vẫn đọc ra — nghĩa là lỗi
 * chỉ xảy ra với đúng hai trường toàn chữ số, và chỉ ở môi trường có dữ liệu
 * thật.
 */
export function settingString(raw: unknown): string | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw)
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  const unquoted = trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2
    ? safeJsonParse(trimmed)
    : trimmed
  if (typeof unquoted !== 'string') return null
  const value = unquoted.trim()
  return value.length > 0 ? value : null
}

/**
 * Cấu hình tài khoản nhận tiền, hoặc `null` khi quán chưa khai báo.
 *
 * Trả `null` thay vì ném lỗi: từ v1.1, thiếu cấu hình KHÔNG chặn việc xuất hoá
 * đơn (hoá đơn vẫn ra, chỉ không có QR), nên người gọi phải tự quyết nó muốn
 * làm gì — và chỉ màn thu tiền mới biến việc thiếu QR thành một lỗi.
 */
export async function readQrConfiguration(
  connection: Queryable,
  actor: AuthenticatedActor,
): Promise<QrConfiguration | null> {
  const [rows] = await connection.execute<SettingRow[]>(
    'SELECT `key`, `value` FROM venue_settings WHERE organization_id = ? AND venue_id = ?',
    [actor.organizationId, actor.venueId],
  )
  const settings = new Map(rows.map((row) => [row.key, row.value]))
  const bankBin = settingString(settings.get(SETTING_BANK_BIN))
  const accountNumber = settingString(settings.get(SETTING_ACCOUNT_NUMBER))
  const accountName = settingString(settings.get(SETTING_ACCOUNT_NAME))
  if (bankBin === null || accountNumber === null || accountName === null) return null

  const rawDemo = settings.get(SETTING_IS_DEMO)
  const demoValue = typeof rawDemo === 'string' ? safeJsonParse(rawDemo) : rawDemo
  return {
    bankBin,
    accountNumber,
    accountName,
    venueShortName: settingString(settings.get(SETTING_VENUE_SHORT_NAME)) ?? DEFAULT_VENUE_SHORT_NAME,
    // Thiếu cờ thì coi như DEMO. Mặc định an toàn là một cái nhãn thừa, không
    // phải một màn hình nói "chuyển tiền thật" khi chưa ai xác nhận điều đó.
    isDemo: demoValue !== false,
  }
}

/** Trường nào còn thiếu — để màn hình nói đúng cái quán cần khai báo. */
export async function missingQrSettings(
  connection: Queryable,
  actor: AuthenticatedActor,
): Promise<string[]> {
  const [rows] = await connection.execute<SettingRow[]>(
    'SELECT `key`, `value` FROM venue_settings WHERE organization_id = ? AND venue_id = ?',
    [actor.organizationId, actor.venueId],
  )
  const settings = new Map(rows.map((row) => [row.key, row.value]))
  return [SETTING_BANK_BIN, SETTING_ACCOUNT_NUMBER, SETTING_ACCOUNT_NAME]
    .filter((key) => settingString(settings.get(key)) === null)
}

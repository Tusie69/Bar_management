import { stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import ExcelJS from 'exceljs'

import { env } from '../src/config/env.js'
import { databasePool } from '../src/database/pool.js'
import {
  buildMenuImportPlan,
  MENU_IMPORT_EFFECTIVE_FROM,
  type MenuImportPlan,
  type MenuWorkbookRow,
} from '../src/modules/menu/import-mapping.js'
import { applyMenuImportPlan, type MenuImportOutcome } from '../src/modules/menu/menu-import.repository.js'

interface Arguments {
  file: string
  apply: boolean
  organizationId: number
  venueId: number
  effectiveFrom: string
}

function positiveInteger(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} phải là số nguyên dương.`)
  return parsed
}

function argumentsFrom(argv: string[]): Arguments {
  const values = new Map<string, string>()
  let apply = false
  for (const argument of argv) {
    if (argument === '--apply') apply = true
    else if (argument === '--dry-run') apply = false
    else if (argument.startsWith('--') && argument.includes('=')) {
      const separator = argument.indexOf('=')
      values.set(argument.slice(2, separator), argument.slice(separator + 1))
    } else throw new Error(`Tham số không hỗ trợ: ${argument}`)
  }
  const file = values.get('file')
  if (!file) throw new Error('Thiếu --file=<đường dẫn xlsx>.')
  const effectiveFrom = values.get('effective-from') ?? MENU_IMPORT_EFFECTIVE_FROM
  if (Number.isNaN(Date.parse(effectiveFrom))) throw new Error('--effective-from phải là ISO-8601 hợp lệ.')
  return {
    file: path.resolve(file),
    apply,
    organizationId: positiveInteger(values.get('organization-id'), 'organization-id', env.organizationId),
    venueId: positiveInteger(values.get('venue-id'), 'venue-id', env.venueId),
    effectiveFrom: new Date(effectiveFrom).toISOString(),
  }
}

function text(value: ExcelJS.CellValue): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text.trim() || null
    if ('richText' in value) return value.richText.map((part) => part.text).join('').trim() || null
  }
  return String(value).trim() || null
}

async function readWorkbook(file: string): Promise<MenuWorkbookRow[]> {
  await stat(file)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(file)
  const sheet = workbook.getWorksheet('Danh mục món')
  if (!sheet) throw new Error('Không tìm thấy sheet “Danh mục món”.')
  const headers = Array.from({ length: 9 }, (_, index) => text(sheet.getRow(5).getCell(index + 1).value))
  const expected = ['STT', 'Nhóm', 'Phân loại', 'Tên món', 'Mô tả / Thành phần', 'Giá ly-shot (nghìn đ)', 'Giá chai (nghìn đ)', 'Đơn vị bán', 'Ghi chú']
  if (headers.some((header, index) => header !== expected[index])) {
    throw new Error(`Header workbook không đúng mẫu: ${JSON.stringify(headers)}`)
  }
  const rows: MenuWorkbookRow[] = []
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= 5 || typeof row.getCell(1).value !== 'number') return
    const sequence = row.getCell(1).value
    const group = text(row.getCell(2).value)
    const category = text(row.getCell(3).value)
    const name = text(row.getCell(4).value)
    const sellingUnit = text(row.getCell(8).value)
    if (!Number.isSafeInteger(sequence) || !group || !category || !name || !sellingUnit) {
      throw new Error(`Dòng ${rowNumber}: thiếu STT/nhóm/phân loại/tên/đơn vị bán.`)
    }
    rows.push({
      rowNumber,
      sequence,
      group,
      category,
      name,
      description: text(row.getCell(5).value),
      glassShotPriceThousands: row.getCell(6).value,
      bottlePriceThousands: row.getCell(7).value,
      sellingUnit,
      note: text(row.getCell(9).value),
    })
  })
  return rows
}

function summary(plan: MenuImportPlan, args: Arguments, outcome: MenuImportOutcome | null) {
  return {
    mode: args.apply ? 'apply' : 'dry-run',
    source: plan.source,
    /** Trạng thái của món MỚI. Món đã có giữ nguyên trạng thái của nó. */
    newItemStatus: 'PENDING_VERIFICATION',
    file: args.file,
    groups: plan.groups,
    classifications: plan.classifications,
    categoryRecords: plan.categories.length,
    items: plan.items.length,
    variants: plan.variantCount,
    prices: plan.priceCount,
    warnings: plan.warnings.length,
    errors: plan.errors.length,
    verificationRows: plan.verificationRowCount,
    ...(outcome === null ? {} : { written: outcome.tally, orphanedItemCodes: outcome.orphanedItemCodes }),
    warningDetails: plan.warnings,
    errorDetails: plan.errors,
  }
}

const args = argumentsFrom(process.argv.slice(2))
const plan = buildMenuImportPlan(await readWorkbook(args.file))
const outcome = args.apply
  ? await applyMenuImportPlan(
      { organizationId: args.organizationId, venueId: args.venueId },
      plan,
      { effectiveFrom: new Date(args.effectiveFrom) },
    )
  : null
console.log(JSON.stringify(summary(plan, args, outcome), null, 2))
if (plan.errors.length) process.exitCode = 1
await databasePool.end()

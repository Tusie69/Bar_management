/**
 * Module Phục vụ 2 — `menu:verify`.
 *
 * Importer nhập món ở trạng thái chờ, và catalog production chỉ trả `VERIFIED`.
 * Không có lệnh này thì sau một lần import toàn bộ 178 món đều ẩn, và cách duy
 * nhất để mở là UPDATE tay thẳng vào database — không diff, không ai ký tên,
 * không nhật ký.
 *
 * Mặc định là dry-run: in ra diff và danh sách chặn, không ghi gì.
 *
 *   pnpm --filter @21gam/api menu:verify -- --venue-id=1 --source=21GAM_MARKETING_MENU_V1
 *   pnpm --filter @21gam/api menu:verify -- --venue-id=1 --source=... --verified-by=3 --apply
 *
 * Người duyệt phải là một tài khoản có thật trong organization và có quyền
 * `venue.configure` tại địa điểm đó. Lệnh chạy từ máy có quyền vào database,
 * nên nếu nó tự nhận quyền thì nó trở thành đường vòng qua RBAC.
 */
import process from 'node:process'

import type { RowDataPacket } from 'mysql2/promise'

import { hasPermission } from '../src/auth/auth.service.js'
import { env } from '../src/config/env.js'
import { databasePool } from '../src/database/pool.js'
import { MENU_IMPORT_SOURCE } from '../src/modules/menu/import-mapping.js'
import {
  applyVerification,
  buildVerificationPlan,
  type VerificationEntry,
} from '../src/modules/menu/menu-verification.repository.js'

interface Arguments {
  apply: boolean
  organizationId: number
  venueId: number
  source: string
  verifiedBy: number | null
  itemCodes: string[]
  allowDuplicateNameCodes: string[]
}

function positiveInteger(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} phải là số nguyên dương.`)
  return parsed
}

function codeList(value: string | undefined): string[] {
  if (!value) return []
  return value.split(',').map((part) => part.trim()).filter(Boolean)
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
  const verifiedByRaw = values.get('verified-by')
  const verifiedBy = verifiedByRaw === undefined ? null : positiveInteger(verifiedByRaw, 'verified-by', 0)
  if (apply && verifiedBy === null) {
    throw new Error('--apply cần --verified-by=<userId>: mỗi lần duyệt phải ghi tên người chịu trách nhiệm.')
  }
  return {
    apply,
    organizationId: positiveInteger(values.get('organization-id'), 'organization-id', env.organizationId),
    venueId: positiveInteger(values.get('venue-id'), 'venue-id', env.venueId),
    source: values.get('source') ?? MENU_IMPORT_SOURCE,
    verifiedBy,
    itemCodes: codeList(values.get('item-code')),
    allowDuplicateNameCodes: codeList(values.get('allow-duplicate-name')),
  }
}

interface MembershipRow extends RowDataPacket {
  membership_id: number
  display_name: string
}

/**
 * Người duyệt phải tồn tại, thuộc organization, và có `venue.configure` tại
 * địa điểm này — kiểm bằng đúng `hasPermission` mà API dùng, kể cả override
 * quyền ở cấp tài khoản.
 */
async function resolveVerifier(args: Arguments): Promise<{ userId: number; membershipId: number; displayName: string }> {
  const userId = args.verifiedBy!
  const [rows] = await databasePool.execute<MembershipRow[]>(
    `SELECT m.id AS membership_id, u.display_name
     FROM memberships AS m
     JOIN users AS u ON u.id = m.user_id
     WHERE m.organization_id = ? AND m.user_id = ?`,
    [args.organizationId, userId],
  )
  const membership = rows[0]
  if (!membership) throw new Error(`Tài khoản #${userId} không thuộc organization #${args.organizationId}.`)
  // `listPermissions` trả mảng rỗng khi actor không có portal, nên thiếu dòng
  // này thì `hasPermission` luôn false và `--apply` không bao giờ chạy được,
  // kể cả với OWNER. Cổng `admin` là cổng của OWNER/ADMIN — đúng cổng mà một
  // người duyệt menu sẽ dùng nếu thao tác qua giao diện thay vì script.
  const actor = {
    userId,
    membershipId: Number(membership.membership_id),
    organizationId: args.organizationId,
    venueId: args.venueId,
    portal: 'admin' as const,
  }
  if (!(await hasPermission(actor, 'venue.configure'))) {
    throw new Error(`Tài khoản #${userId} không có quyền venue.configure tại địa điểm #${args.venueId}.`)
  }
  return { userId, membershipId: actor.membershipId, displayName: membership.display_name }
}

function describe(entry: VerificationEntry) {
  return {
    code: entry.candidate.code,
    name: entry.candidate.name,
    status: entry.candidate.sourceStatus,
    variants: entry.candidate.variants.map((variant) => ({
      displayName: variant.displayName,
      unitCode: variant.unitCode,
      amountVnd: variant.amountVnd,
      isSellable: variant.isSellable,
    })),
    ...(entry.diff.length ? { changes: entry.diff } : {}),
    ...(entry.blockers.length ? { blockers: entry.blockers } : {}),
  }
}

const args = argumentsFrom(process.argv.slice(2))
const plan = await buildVerificationPlan(
  { organizationId: args.organizationId, venueId: args.venueId },
  {
    source: args.source,
    ...(args.itemCodes.length ? { itemCodes: args.itemCodes } : {}),
    ...(args.allowDuplicateNameCodes.length ? { allowDuplicateNameCodes: args.allowDuplicateNameCodes } : {}),
  },
)

let applied: { verified: string[]; skippedStale: string[] } | null = null
let verifier: { userId: number; displayName: string } | null = null
if (args.apply) {
  const resolved = await resolveVerifier(args)
  verifier = { userId: resolved.userId, displayName: resolved.displayName }
  applied = await applyVerification(
    { organizationId: args.organizationId, venueId: args.venueId },
    { userId: resolved.userId, membershipId: resolved.membershipId },
    plan.verifiable,
  )
}

console.log(JSON.stringify({
  mode: args.apply ? 'apply' : 'dry-run',
  source: args.source,
  organizationId: args.organizationId,
  venueId: args.venueId,
  pending: plan.entries.length,
  verifiable: plan.verifiable.length,
  blocked: plan.blocked.length,
  ...(verifier ? { verifiedBy: verifier } : {}),
  ...(applied ? { verified: applied.verified.length, skippedStale: applied.skippedStale } : {}),
  verifiableItems: plan.verifiable.map(describe),
  blockedItems: plan.blocked.map(describe),
}, null, 2))

// Dry-run với toàn bộ hàng đợi bị chặn là một kết quả cần biết trong CI, không
// phải một lần chạy thành công.
if (!args.apply && plan.entries.length > 0 && plan.verifiable.length === 0) process.exitCode = 2
await databasePool.end()

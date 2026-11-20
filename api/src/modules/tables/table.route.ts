import { Router } from 'express'

import {
  requireAnyPermission,
  requireAuthentication,
  requireCsrfProtection,
  requirePermission,
} from '../../auth/auth.middleware.js'
import { getAuthentication, requireAuthenticatedActor } from '../../auth/authenticated-actor.js'
import { hasPermission, inspectSession } from '../../auth/auth.service.js'
import { AppError } from '../../errors/app-error.js'
import { afterIdempotencyCommit, idempotent, idempotencyTransaction } from '../../middleware/idempotency.js'
import { getFloorProjection } from './floor-projection.repository.js'
import { toWaiterFloorProjection } from './waiter-floor-projection.js'
import { publishFloorChange, subscribeToFloorChanges } from './floor-change-stream.js'
import {
  addLayoutGroupMembers,
  createLayoutGroup,
  dissolveLayoutGroup,
  getLayoutGroup,
  listLayoutGroups,
} from './table-layout-group.repository.js'
import { configureTable, getTableCatalog, updateTableState } from './table.repository.js'
import { splitTableGroup } from './table-split.repository.js'
import { isTableState } from './table-state.js'

export const tableRouter: Router = Router()

function parseBusinessDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AppError(400, 'INVALID_BUSINESS_DATE', 'Ngày làm việc phải có dạng YYYY-MM-DD.')
  }
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new AppError(400, 'INVALID_BUSINESS_DATE', 'Ngày làm việc không hợp lệ.')
  }
  return value
}

function parseBody(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AppError(400, 'INVALID_BODY', 'Nội dung yêu cầu phải là một object JSON.')
  }
  return value as Record<string, unknown>
}

tableRouter.get('/', requireAuthentication, requirePermission('customer.view_masked'), async (request, response) => {
  const businessDate = parseBusinessDate(request.query.date)
  const actor = requireAuthenticatedActor(request)
  response.json(await getFloorProjection(actor, businessDate))
})

/**
 * Danh mục bàn: mặt bằng, khu vực, sức chứa, toạ độ. KHÔNG có dữ liệu khách,
 * nên Phục vụ (`order.read`) đọc được cùng một payload mà Lễ tân đang đọc —
 * không có phép chiếu riêng, và vì thế không có hai phiên bản mặt bằng để
 * lệch nhau. Mọi thứ thuộc về khách nằm ở projection sơ đồ, không ở đây.
 */
tableRouter.get(
  '/catalog',
  requireAuthentication,
  requireAnyPermission('customer.view_masked', 'order.read', 'preparation.bar.read', 'preparation.kitchen.read'),
  async (request, response) => {
    response.json(await getTableCatalog(requireAuthenticatedActor(request)))
  },
)

/**
 * Module Phục vụ 1 — sơ đồ bàn của ca hiện tại cho WAITER.
 *
 * Endpoint RIÊNG thay vì nhét một nhánh `if (role === WAITER)` vào `GET /`:
 * payload của Lễ tân không đổi một byte nào, nên không có cách nào làm hỏng
 * màn Điều phối khi sửa phần của Phục vụ. Cả hai dùng chung một
 * `getFloorProjection`, nên hai màn hình không thể thấy hai trạng thái bàn
 * khác nhau.
 *
 * `toWaiterFloorProjection` xoá tên, số điện thoại, nguồn đặt và mọi cờ nhận
 * dạng khách TRƯỚC khi payload rời máy chủ. Đây là chốt thật: gọi thẳng
 * endpoint bằng cookie phiên của một tài khoản Phục vụ cũng không lấy được
 * những trường đó.
 */
tableRouter.get(
  '/service',
  requireAuthentication,
  requirePermission('order.read'),
  async (request, response) => {
    const businessDate = parseBusinessDate(request.query.date)
    const actor = requireAuthenticatedActor(request)
    response.json(toWaiterFloorProjection(await getFloorProjection(actor, businessDate)))
  },
)

tableRouter.patch(
  '/:id/status',
  requireAuthentication,
  requireCsrfProtection,
  requirePermission('table.assign'),
  async (request, response) => {
    const tableId = Number(request.params.id)
    if (!Number.isSafeInteger(tableId) || tableId <= 0) {
      throw new AppError(400, 'INVALID_TABLE_ID', 'Mã bàn không hợp lệ.')
    }

    const body = parseBody(request.body as unknown)
    const businessDate = parseBusinessDate(body.businessDate)
    const state = body.state
    const isBackup = body.isBackup
    const expectedVersion = body.expectedVersion

    if (state !== undefined && !isTableState(state)) {
      throw new AppError(400, 'INVALID_TABLE_STATE', 'Trạng thái bàn không hợp lệ.')
    }
    if (isBackup !== undefined && typeof isBackup !== 'boolean') {
      throw new AppError(400, 'INVALID_BACKUP_FLAG', 'Cờ bàn sơ cua phải là true hoặc false.')
    }
    if (isBackup !== undefined) {
      throw new AppError(400, 'FIXED_SPARE_TABLE', 'Bàn sơ cua là cấu hình cố định và không thể thay đổi theo ngày.')
    }
    if (expectedVersion !== undefined && (!Number.isSafeInteger(expectedVersion) || Number(expectedVersion) < 0)) {
      throw new AppError(400, 'INVALID_VERSION', 'Phiên bản bàn không hợp lệ.')
    }
    if (state === undefined) {
      throw new AppError(400, 'EMPTY_UPDATE', 'Cần gửi trạng thái bàn.')
    }

    const table = await updateTableState(requireAuthenticatedActor(request), {
      tableId,
      businessDate,
      ...(state === undefined ? {} : { state }),
      ...(expectedVersion === undefined ? {} : { expectedVersion: Number(expectedVersion) }),
      ...(typeof body.reason === 'string' ? { reason: body.reason } : {}),
    })
    response.json({ table })
  },
)

tableRouter.patch(
  '/:id/configuration',
  requireAuthentication,
  requireCsrfProtection,
  requireAnyPermission('venue.configure', 'table.spare.configure'),
  async (request, response) => {
    const tableId = Number(request.params.id)
    if (!Number.isSafeInteger(tableId) || tableId <= 0)
      throw new AppError(400, 'INVALID_TABLE_ID', 'Mã bàn không hợp lệ.')
    const body = parseBody(request.body as unknown)
    if (body.isSpare !== undefined && typeof body.isSpare !== 'boolean')
      throw new AppError(400, 'INVALID_BACKUP_FLAG', 'Cờ bàn sơ cua phải là true hoặc false.')
    if (body.status !== undefined && body.status !== 'ACTIVE' && body.status !== 'OUT_OF_SERVICE')
      throw new AppError(400, 'INVALID_TABLE_STATUS', 'Table status must be ACTIVE or OUT_OF_SERVICE.')
    if (body.isSpare === undefined && body.status === undefined)
      throw new AppError(400, 'EMPTY_UPDATE', 'Provide isSpare or status.')
    if (!Number.isSafeInteger(body.version) || Number(body.version) < 1)
      throw new AppError(400, 'INVALID_VERSION', 'Phiên bản bàn không hợp lệ.')
    if (typeof body.reason !== 'string' || !body.reason.trim())
      throw new AppError(400, 'REASON_REQUIRED', 'Cần nhập lý do thay đổi cấu hình bàn.')
    if (body.reason.trim().length > 500)
      throw new AppError(400, 'REASON_TOO_LONG', 'Lý do không được vượt quá 500 ký tự.')
    const actor = requireAuthenticatedActor(request)
    if (body.status !== undefined && !(await hasPermission(actor, 'venue.configure'))) {
      throw new AppError(403, 'PERMISSION_DENIED', 'Bạn không có quyền thay đổi trạng thái phục vụ của bàn.')
    }
    if (body.isSpare !== undefined && !(await hasPermission(actor, 'table.spare.configure'))) {
      throw new AppError(403, 'PERMISSION_DENIED', 'Bạn không có quyền quản lý bàn sơ cua.')
    }
    const result = await configureTable(actor, {
      tableId,
      ...(typeof body.isSpare === 'boolean' ? { isSpare: body.isSpare } : {}),
      ...(body.status === 'ACTIVE' || body.status === 'OUT_OF_SERVICE' ? { status: body.status } : {}),
      expectedVersion: Number(body.version),
      reason: body.reason.trim(),
    })
    const { changeSeq, ...table } = result
    response.json({ table })
    void publishFloorChange({
      organizationId: actor.organizationId,
      venueId: actor.venueId,
      changeSeq,
    })
  },
)

/* ------------------------------------------------------------------ *
 * C1 — layout clusters (cụm bàn), independent of booking and visit.
 * ------------------------------------------------------------------ */

/**
 * Managing a cluster is a layout action, not an action on a guest, so it has its
 * own permission (anh Luân, 10/11/2026): table.group.manage, granted to Lễ tân and
 * to the management roles. The BA-021 split-with-keepTableIds branch still serves
 * a seated party, so that route also accepts the older visit.split.
 */
const requireGroupManage = requirePermission('table.group.manage')
const requireGroupSplit = requireAnyPermission('table.group.manage', 'visit.split')

function parseGroupId(value: unknown): number {
  const groupId = Number(value)
  if (!Number.isSafeInteger(groupId) || groupId <= 0) {
    throw new AppError(400, 'INVALID_GROUP_ID', 'Mã cụm bàn không hợp lệ.')
  }
  return groupId
}

/**
 * Both spellings are accepted: tableIds is what the shipped client sends,
 * tableCodes is what a receptionist reads off the floor.
 */
function parseTableSelection(body: Record<string, unknown>): { tableIds?: number[]; tableCodes?: string[] } {
  if (Array.isArray(body.tableIds)) return { tableIds: body.tableIds.map(Number) }
  if (Array.isArray(body.tableCodes)) return { tableCodes: body.tableCodes.map(String) }
  throw new AppError(400, 'INVALID_TABLE_CODES', 'Cần gửi tableIds hoặc tableCodes dạng mảng.')
}

/** Reads the spare-table confirmation, rejecting any value that is not a boolean. */
function parseSpareOverride(body: Record<string, unknown>): { spareOverrideConfirmed?: boolean } {
  const value = body.spareOverrideConfirmed
  if (value === undefined || value === null) return {}
  if (typeof value !== 'boolean') {
    throw new AppError(400, 'INVALID_SPARE_OVERRIDE', 'spareOverrideConfirmed phải là true hoặc false.')
  }
  return { spareOverrideConfirmed: value }
}

function parseGroupVersion(value: unknown): number {
  const version = Number(value)
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new AppError(400, 'INVALID_VERSION', 'Phiên bản cụm bàn không hợp lệ.')
  }
  return version
}

/** Pushes the committed change so other devices see it well inside two seconds. */
function announce(response: Parameters<typeof afterIdempotencyCommit>[0], actor: { organizationId: number; venueId: number }, changeSeq: number): void {
  afterIdempotencyCommit(response, () => publishFloorChange({
    organizationId: actor.organizationId,
    venueId: actor.venueId,
    changeSeq: String(changeSeq),
  }))
}

tableRouter.get(
  '/groups',
  requireAuthentication,
  requirePermission('customer.view_masked'),
  async (request, response) => {
    response.json(await listLayoutGroups(requireAuthenticatedActor(request), {
      includeDissolved: request.query.includeDissolved === 'true',
    }))
  },
)

/**
 * §10 — push channel for the floor. The client refetches the projection when a
 * frame arrives, so a frame is a staleness signal, never data; an old frame can
 * therefore not overwrite newer state.
 *
 * Declared before '/groups/:id' so 'stream' is never read as a group id.
 */
tableRouter.get(
  '/stream',
  requireAuthentication,
  requireAnyPermission('customer.view_masked', 'order.read', 'preparation.bar.read', 'preparation.kitchen.read'),
  (request, response) => {
    const authentication = getAuthentication(request)!
    const actor = authentication.actor
    subscribeToFloorChanges({
      organizationId: actor.organizationId,
      venueId: actor.venueId,
      authSessionId: actor.authSessionId!,
      userId: actor.userId,
      response,
      authorize: async () => {
        const current = await inspectSession(authentication.sessionToken)
        if (!current.ok) return current.code
        // Khung SSE chỉ nói "sơ đồ đã đổi", không chở dữ liệu nào, nên Phục vụ
        // nghe được bằng `order.read`: client nhận khung rồi gọi lại đúng
        // endpoint của mình (`/tables/service`) và nhận đúng phép chiếu của
        // mình. Mở kênh này KHÔNG mở thêm một byte dữ liệu khách nào.
        const actor = current.authentication.actor
        if (await hasPermission(actor, 'customer.view_masked')) return null
        if (await hasPermission(actor, 'order.read')) return null
        if (await hasPermission(actor, 'preparation.bar.read')) return null
        return await hasPermission(actor, 'preparation.kitchen.read') ? null : 'SESSION_REVOKED'
      },
    })
  },
)

tableRouter.get(
  '/groups/:id',
  requireAuthentication,
  requirePermission('customer.view_masked'),
  async (request, response) => {
    response.json(await getLayoutGroup(requireAuthenticatedActor(request), parseGroupId(request.params.id)))
  },
)

/** Ghép bàn. No guest name, phone, party size or arrival time is required. */
tableRouter.post(
  '/groups',
  requireAuthentication,
  requireCsrfProtection,
  requireGroupManage,
  idempotent('table.group.create'),
  async (request, response) => {
    const body = parseBody(request.body)
    const actor = requireAuthenticatedActor(request)
    const result = await createLayoutGroup(
      actor,
      {
        ...parseTableSelection(body),
        ...(typeof body.name === 'string' ? { name: body.name } : {}),
        ...parseSpareOverride(body),
      },
      idempotencyTransaction(response),
    )
    announce(response, actor, result.changeSeq)
    response.status(201).json(result)
  },
)

/** Adds tables to an existing cluster instead of forcing a split and re-merge. */
tableRouter.post(
  '/groups/:id/members',
  requireAuthentication,
  requireCsrfProtection,
  requireGroupManage,
  idempotent('table.group.add_members'),
  async (request, response) => {
    const body = parseBody(request.body)
    const actor = requireAuthenticatedActor(request)
    const result = await addLayoutGroupMembers(
      actor,
      {
        groupId: parseGroupId(request.params.id),
        version: parseGroupVersion(body.version),
        ...parseTableSelection(body),
        ...parseSpareOverride(body),
      },
      idempotencyTransaction(response),
    )
    announce(response, actor, result.changeSeq)
    response.json(result)
  },
)

/**
 * Tách bàn. The only thing that ever ends a layout cluster: paying, Close Visit,
 * a cancelled booking, a No-show, the end of a shift, the business-day rollover
 * and a server restart all leave the cluster standing.
 */
tableRouter.post(
  '/groups/:id/dissolve',
  requireAuthentication,
  requireCsrfProtection,
  requireGroupManage,
  idempotent('table.group.dissolve'),
  async (request, response) => {
    const body = parseBody(request.body)
    const actor = requireAuthenticatedActor(request)
    const result = await dissolveLayoutGroup(
      actor,
      {
        groupId: parseGroupId(request.params.id),
        ...(body.version === undefined ? {} : { version: parseGroupVersion(body.version) }),
      },
      idempotencyTransaction(response),
    )
    announce(response, actor, result.changeSeq)
    response.json(result)
  },
)

/*
 * BA-021 Split: identified by the merge group, keeping the chosen tables.
 * mode ALL_TO_SINGLE is the shipped client's spelling of Tách bàn on an empty
 * cluster and delegates to the same dissolve path — one implementation, two
 * spellings, so the two can never drift apart.
 */
tableRouter.post(
  '/groups/:id/split',
  requireAuthentication,
  requireCsrfProtection,
  requireGroupSplit,
  idempotent('table.group.split'),
  async (request, response) => {
    const body = parseBody(request.body)
    const actor = requireAuthenticatedActor(request)
    const groupId = parseGroupId(request.params.id)
    // Module Phục vụ 1: route này nhận `table.group.manage` HOẶC `visit.split`.
    // Người chỉ có `visit.split` (Phục vụ) được tách đoàn khách đang ngồi,
    // không được xếp mặt bằng, nên mọi nhánh dưới đây phải tự biết điều đó.
    const canManageLayout = await hasPermission(actor, 'table.group.manage')

    // Only an explicit mode selects the dissolve branch, so a body with neither
    // mode nor keepTableIds still reports the missing table list it is missing.
    if (body.mode !== undefined) {
      if (body.mode !== 'ALL_TO_SINGLE') {
        throw new AppError(400, 'INVALID_SPLIT_MODE', 'Cách tách cụm bàn không hợp lệ.')
      }
      // ALL_TO_SINGLE đi thẳng vào `dissolveLayoutGroup`: nó rã cả cụm, kể cả
      // cụm chưa có khách. Đó là thao tác mặt bằng, không phải tách một Phiên.
      if (!canManageLayout) {
        throw new AppError(403, 'PERMISSION_DENIED',
          'Rã cả cụm bàn là thao tác sắp xếp mặt bằng. Chỉ tách được cụm đang có khách.')
      }
      const dissolved = await dissolveLayoutGroup(
        actor,
        { groupId, version: parseGroupVersion(body.version) },
        idempotencyTransaction(response),
      )
      announce(response, actor, dissolved.changeSeq)
      response.json(dissolved)
      return
    }

    if (!Array.isArray(body.keepTableIds)) {
      throw new AppError(400, 'TABLES_REQUIRED', 'Danh sách bàn giữ lại không hợp lệ.')
    }
    const result = await splitTableGroup(
      actor,
      {
        groupId,
        keepTableIds: body.keepTableIds.map(Number),
        ...(canManageLayout ? {} : { requireSeatedVisit: true }),
      },
      idempotencyTransaction(response),
    )
    announce(response, actor, result.changeSeq)
    response.json(result)
  },
)


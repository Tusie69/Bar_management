/**
 * BA-022 — Account Management routes (US-11).
 *
 * Listing uses `user.read`; delegated mutations use `user.manage` plus
 * repository-level actor/target checks. Self password change only requires the
 * authenticated account and CSRF. Nothing returns credential material.
 */
import { Router } from 'express'

import { requireAuthentication, requireCsrfProtection, requirePermission } from '../../auth/auth.middleware.js'
import { requireAuthenticatedActor } from '../../auth/authenticated-actor.js'
import { AppError } from '../../errors/app-error.js'
import {
  assertConfiguredOrganization,
  changeOwnPassword,
  createAccount,
  listAccounts,
  listAssignableRoles,
  resetAccountPassword,
  setAdminAccessLevel,
  setAccountStatus,
  type AdminAccessLevel,
  type AccountStatus,
} from './account.repository.js'

export const accountRouter: Router = Router()

const statuses = new Set<AccountStatus>(['ACTIVE', 'DISABLED'])
const accessLevels = new Set<AdminAccessLevel>(['WRITE', 'READ_ONLY'])

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(400, 'INVALID_BODY', 'Dữ liệu gửi lên không hợp lệ.')
  }
  return value as Record<string, unknown>
}

function text(value: unknown, code: string, message: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new AppError(400, code, message)
  return value
}

function positiveInteger(value: unknown, code: string, message: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new AppError(400, code, message)
  return parsed
}

accountRouter.get(
  '/',
  requireAuthentication,
  requirePermission('user.read'),
  async (request, response) => {
    const actor = requireAuthenticatedActor(request)
    assertConfiguredOrganization(actor)
    response.json({ accounts: await listAccounts(actor), roles: await listAssignableRoles(actor) })
  },
)

accountRouter.post(
  '/',
  requireAuthentication,
  requireCsrfProtection,
  requirePermission('user.manage'),
  async (request, response) => {
    const actor = requireAuthenticatedActor(request)
    assertConfiguredOrganization(actor)
    const body = objectBody(request.body)
    const account = await createAccount(actor, {
      username: text(body.username, 'INVALID_USERNAME', 'Tên đăng nhập không hợp lệ.'),
      displayName: text(body.displayName, 'INVALID_DISPLAY_NAME', 'Tên hiển thị không hợp lệ.'),
      password: text(body.password, 'WEAK_PASSWORD', 'Mật khẩu không hợp lệ.'),
      roleCode: text(body.roleCode, 'ROLE_NOT_FOUND', 'Vai trò không hợp lệ.'),
      ...(body.accessLevel === undefined
        ? {}
        : { accessLevel: text(body.accessLevel, 'INVALID_ACCESS_LEVEL', 'Cấp truy cập không hợp lệ.') as AdminAccessLevel }),
    })
    response.status(201).json({ account })
  },
)

accountRouter.post(
  '/me/password',
  requireAuthentication,
  requireCsrfProtection,
  async (request, response) => {
    const actor = requireAuthenticatedActor(request)
    assertConfiguredOrganization(actor)
    const body = objectBody(request.body)
    response.json(await changeOwnPassword(
      actor,
      text(body.currentPassword, 'INVALID_PASSWORD', 'Mật khẩu hiện tại không hợp lệ.'),
      text(body.newPassword, 'WEAK_PASSWORD', 'Mật khẩu mới không hợp lệ.'),
    ))
  },
)

accountRouter.post(
  '/:id/access-level',
  requireAuthentication,
  requireCsrfProtection,
  requirePermission('user.manage'),
  async (request, response) => {
    const actor = requireAuthenticatedActor(request)
    assertConfiguredOrganization(actor)
    const body = objectBody(request.body)
    if (typeof body.accessLevel !== 'string' || !accessLevels.has(body.accessLevel as AdminAccessLevel)) {
      throw new AppError(400, 'INVALID_ACCESS_LEVEL', 'Cấp truy cập ADMIN không hợp lệ.')
    }
    response.json(await setAdminAccessLevel(
      actor,
      positiveInteger(request.params.id, 'INVALID_ACCOUNT_ID', 'Mã tài khoản không hợp lệ.'),
      positiveInteger(body.version, 'INVALID_VERSION', 'Phiên bản tài khoản không hợp lệ.'),
      body.accessLevel as AdminAccessLevel,
    ))
  },
)

accountRouter.post(
  '/:id/password-reset',
  requireAuthentication,
  requireCsrfProtection,
  requirePermission('user.manage'),
  async (request, response) => {
    const actor = requireAuthenticatedActor(request)
    assertConfiguredOrganization(actor)
    const body = objectBody(request.body)
    response.json(await resetAccountPassword(
      actor,
      positiveInteger(request.params.id, 'INVALID_ACCOUNT_ID', 'Mã tài khoản không hợp lệ.'),
      positiveInteger(body.version, 'INVALID_VERSION', 'Phiên bản tài khoản không hợp lệ.'),
      text(body.newPassword, 'WEAK_PASSWORD', 'Mật khẩu mới không hợp lệ.'),
    ))
  },
)

accountRouter.post(
  '/:id/status',
  requireAuthentication,
  requireCsrfProtection,
  requirePermission('user.manage'),
  async (request, response) => {
    const actor = requireAuthenticatedActor(request)
    assertConfiguredOrganization(actor)
    const body = objectBody(request.body)
    if (typeof body.status !== 'string' || !statuses.has(body.status as AccountStatus)) {
      throw new AppError(400, 'INVALID_ACCOUNT_STATUS', 'Trạng thái tài khoản không hợp lệ.')
    }
    response.json(await setAccountStatus(
      actor,
      positiveInteger(request.params.id, 'INVALID_ACCOUNT_ID', 'Mã tài khoản không hợp lệ.'),
      positiveInteger(body.version, 'INVALID_VERSION', 'Phiên bản tài khoản không hợp lệ.'),
      body.status as AccountStatus,
    ))
  },
)

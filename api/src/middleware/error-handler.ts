import type { ErrorRequestHandler } from 'express'

import { AppError } from '../errors/app-error.js'

interface MysqlFailure {
  code?: string
  errno?: number
}

function mysqlConflict(error: unknown): AppError | null {
  if (!error || typeof error !== 'object') return null
  const failure = error as MysqlFailure
  if (failure.code === 'ER_DUP_ENTRY' || failure.errno === 1062) {
    return new AppError(409, 'RESOURCE_CONFLICT', 'Dữ liệu vừa bị thay đổi hoặc tài nguyên đã được sử dụng.')
  }
  if (
    failure.code === 'ER_LOCK_DEADLOCK'
    || failure.code === 'ER_LOCK_WAIT_TIMEOUT'
    || failure.errno === 1213
    || failure.errno === 1205
  ) {
    return new AppError(409, 'CONCURRENT_UPDATE_RETRY', 'Có thao tác đồng thời. Vui lòng tải lại và thử lại.')
  }
  return null
}

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  void _next

  if (error instanceof AppError) {
    response.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
      },
    })
    return
  }

  const conflict = mysqlConflict(error)
  if (conflict) {
    response.status(conflict.status).json({ error: { code: conflict.code, message: conflict.message } })
    return
  }

  console.error(error)

  response.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Hệ thống đang gặp lỗi, vui lòng thử lại sau.',
    },
  })
}


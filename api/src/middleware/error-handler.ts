import type { ErrorRequestHandler } from 'express'

import { AppError } from '../errors/app-error.js'

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

  console.error(error)

  response.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Hệ thống đang gặp lỗi, vui lòng thử lại sau.',
    },
  })
}


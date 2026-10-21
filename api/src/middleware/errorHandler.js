import { AppError } from '../errors.js'

export const notFoundHandler = (request, response) => {
  response.status(404).json({
    error: { code: 'ROUTE_NOT_FOUND', message: `Không tìm thấy ${request.method} ${request.originalUrl}.` },
  })
}

export const errorHandler = (error, _request, response, _next) => {
  void _next
  if (error instanceof AppError) {
    return response.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    })
  }
  console.error(error)
  return response.status(500).json({
    error: { code: 'INTERNAL_SERVER_ERROR', message: 'Máy chủ gặp lỗi. Vui lòng thử lại sau.' },
  })
}

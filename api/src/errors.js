export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.name = 'AppError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export class ValidationError extends AppError {
  constructor(message, details) {
    super(400, 'VALIDATION_ERROR', message, details)
  }
}

export class NotFoundError extends AppError {
  constructor(message) {
    super(404, 'NOT_FOUND', message)
  }
}

export class InvalidTransitionError extends AppError {
  constructor(from, to) {
    super(400, 'INVALID_TABLE_STATUS_TRANSITION', `Không thể chuyển trạng thái bàn từ ${from} sang ${to}.`, { from, to })
  }
}

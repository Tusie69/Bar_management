import { ValidationError } from '../../errors.js'
import { TABLE_STATUSES } from './tableStatuses.js'

export const validateBusinessDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ValidationError('Ngày kinh doanh phải có định dạng YYYY-MM-DD.', { field: 'date' })
  }
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ValidationError('Ngày kinh doanh không hợp lệ.', { field: 'date' })
  }
  return value
}

export const validateTableId = (value) => {
  const id = Number(value)
  if (!Number.isInteger(id) || id < 1) throw new ValidationError('Mã bàn không hợp lệ.', { field: 'id' })
  return id
}

export const validateStatus = (value) => {
  if (!TABLE_STATUSES.includes(value)) {
    throw new ValidationError('Trạng thái bàn không hợp lệ.', { field: 'status', allowedValues: TABLE_STATUSES })
  }
  return value
}

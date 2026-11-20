import { env } from '../../config/env.js'

/**
 * Hai vị từ SQL quyết định "món nào được bán" và "giá nào đang áp dụng".
 *
 * Chúng nằm riêng ở đây vì Module 3 phải kiểm lại ĐÚNG những điều kiện mà
 * Module 2 dùng để hiện món lên máy Phục vụ. Hai bản sao của cùng một luật sẽ
 * lệch nhau ở lần sửa đầu tiên, và lúc đó máy Phục vụ bán được một món mà
 * catalog đã ẩn — hoặc ngược lại, gửi đơn báo lỗi một món đang hiện rõ trên
 * màn hình.
 */
export function menuSourcePredicate(alias = 'mi'): string {
  return env.menu.allowPendingDemo
    ? `${alias}.source_status IN ('VERIFIED','PENDING_VERIFICATION')`
    : `${alias}.source_status = 'VERIFIED'`
}

export function currentPricePredicate(alias = 'p'): string {
  return `${alias}.is_active = 1
    AND ${alias}.effective_from <= UTC_TIMESTAMP(3)
    AND (${alias}.effective_to IS NULL OR ${alias}.effective_to > UTC_TIMESTAMP(3))`
}

import { AppError } from '../../errors/app-error.js'

/**
 * Phát hiện số điện thoại trong ghi chú: bỏ khoảng trắng, dấu chấm, gạch ngang, ngoặc rồi tìm chuỗi từ 8 chữ số.
 * Dùng chung cho booking và Bàn chờ (quy tắc "Không ghi số điện thoại vào ghi chú").
 */
export function containsPhoneNumber(value: string): boolean {
  return /\d{8,}/.test(value.replace(/[\s.\-()]/g, ''))
}

/** FX-03: SĐT chỉ được lưu mã hóa ở trường riêng (hiển thị 3 số cuối), không được nằm trần trong ghi chú. */
export function assertNoPhoneInNote(note: string | undefined): void {
  if (note && containsPhoneNumber(note)) {
    throw new AppError(422, 'PHONE_IN_NOTE_FORBIDDEN', 'Không ghi số điện thoại vào ghi chú.')
  }
}

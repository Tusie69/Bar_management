export interface BookingCallEligibility {
  /** Whether a number is stored on the booking or its customer. */
  hasPhone: boolean
}

/**
 * Lễ tân gọi khách được bất cứ lúc nào, miễn là có số điện thoại.
 *
 * Quy tắc cũ chặn theo trạng thái bàn và theo cửa sổ thời gian: chỉ gọi được
 * khi booking đang BOOKED và đã bước vào khung UPCOMING/LATE/NO_SHOW. Hệ quả
 * là đúng những lúc cần gọi nhất thì nút lại biến mất - khách đặt lúc 22h mà
 * giờ mới 19h (chưa tới khung), khách vừa bị hủy cần gọi xác nhận lại, khách
 * đã check-in bỏ quên đồ, hay khách của ngày mai cần nhắc. Giữ số liên lạc
 * là việc của lễ tân, không phải một trạng thái của sơ đồ bàn.
 *
 * Mọi lần gọi vẫn được ghi vào booking_call_logs và operation_log
 * (BOOKING_CALL_INITIATED) kèm người gọi, nên việc mở rộng này vẫn truy vết
 * được; phần kiểm soát thật nằm ở quyền booking.phone.call.
 */
export function canCallBooking(input: BookingCallEligibility): boolean {
  return input.hasPhone
}

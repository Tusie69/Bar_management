/**
 * Module Phục vụ 1 (v1.1) — sáu trạng thái của một LƯỢT KHÁCH trên sơ đồ Phục vụ.
 *
 * Sơ đồ của Phục vụ chỉ nói về khách đang ngồi. Mọi thông tin đặt bàn là việc
 * của Lễ tân, nên nó không có mặt ở đây; thứ thay vào đó là "đoàn khách này
 * đang cần gì": vừa ngồi xuống, đang gọi món, đang chờ đồ, đang dùng, đang
 * thanh toán, đã về.
 *
 * Trạng thái được tính Ở MÁY CHỦ, không ở trình duyệt. Hai máy cùng nhìn một
 * bàn phải thấy cùng một màu; suy ra từ giờ của máy khách thì hai điện thoại
 * lệch giờ sẽ tô hai màu khác nhau cho cùng một đoàn khách, và không ai biết
 * máy nào đúng.
 *
 * Hàm dưới đây THUẦN và nhận vào số liệu đã đọc sẵn, nên nó test được không
 * cần MySQL — xem api/test/waiter-visit-phase.test.ts.
 */

/**
 * Sáu trạng thái, theo đúng thứ tự của tài liệu thiết kế v1.1.
 *
 * Tên bằng tiếng Anh để khớp quy ước của các enum khác đi qua HTTP; nhãn tiếng
 * Việt mà nhân viên đọc nằm ở phía web (`web/src/features/waiter/waiter-phase.ts`),
 * vì nhãn là việc của màn hình còn đây là hợp đồng dữ liệu.
 */
export type WaiterVisitPhase =
  /** 1. Mới vào — Lễ tân vừa Check-in, chưa ai mở màn Gọi món. */
  | 'ARRIVED'
  /** 2. Đang gọi món — một máy đang mở màn Gọi món của Phiên này. */
  | 'ORDERING'
  /** 3. Chờ đồ — đã gửi đơn, còn phiếu Bar/Bếp chưa mang ra đủ. */
  | 'AWAITING_FOOD'
  /** 4. Đang dùng — mọi phiếu của mọi đơn đã ở bước cuối "Đã mang ra". */
  | 'DINING'
  /** 5. Thanh toán — Phiên đã được đánh dấu đã thanh toán. */
  | 'PAYMENT'
  /** 6. Đã checkout — Phiên đã đóng. Xem ghi chú ở `waiterVisitPhase`. */
  | 'CHECKED_OUT'

/**
 * Số liệu của một Phiên đang mở, đọc từ database.
 *
 * Đây là TOÀN BỘ đầu vào của luật: thêm một tín hiệu mới sau này phải thêm vào
 * đây, nên không có đường nào để luật lặng lẽ phụ thuộc vào một thứ mà test
 * không dựng được.
 */
export interface WaiterVisitActivity {
  visitId: number
  /** `paid_marked_at IS NOT NULL`. */
  paid: boolean
  /** Số đơn đã gửi của Phiên. 0 nghĩa là chưa ai gọi món. */
  orderCount: number
  /** Số phiếu Bar/Bếp của Phiên chưa ở trạng thái `COLLECTED`. */
  pendingTicketCount: number
  /**
   * Thời điểm một máy mở màn Gọi món của Phiên, hoặc `null` khi không máy nào
   * đang mở. Đây là PRESENCE, không phải lịch sử: nó bị xoá khi người dùng
   * thoát màn hoặc gửi đơn.
   */
  orderingSince: Date | null
}

/**
 * Hạn của dấu "đang gọi món" khi không có cú thoát nào.
 *
 * Màn Gọi món xoá dấu này lúc thoát và lúc gửi đơn, nên trong đời thường nó
 * không bao giờ chạm tới hạn. Hạn tồn tại cho trường hợp KHÔNG có cú thoát
 * nào: máy hết pin, mất sóng giữa chừng, app bị hệ điều hành đóng. Thiếu nó
 * thì một bàn kẹt màu cam tới hết ca, và một sơ đồ nói dối một lần là một sơ
 * đồ không ai còn tin.
 *
 * Ba phút: đủ dài để một lần mất sóng ngắn không làm ô bàn nhấp nháy, đủ ngắn
 * để không ai kịp hỏi "sao bàn kia vẫn cam".
 */
export const ORDERING_PRESENCE_TTL_MS = 3 * 60_000

/**
 * Trạng thái của một lượt khách. Thứ tự các nhánh LÀ luật, không phải ngẫu nhiên:
 *
 * 1. Đã thanh toán thì không còn gì khác quan trọng.
 * 2. Đang có người mở màn Gọi món thì đó là việc đang diễn ra — kể cả khi bàn
 *    còn món chờ. Khách gọi thêm thì bàn về "Đang gọi món" rồi mới sang "Chờ
 *    đồ", đúng Hình 0 của tài liệu.
 * 3. Còn phiếu chưa mang ra đủ thì khách đang chờ.
 * 4. Có đơn mà không còn phiếu nào chờ thì khách đang dùng.
 * 5. Chưa gọi gì thì mới vào.
 *
 * `CHECKED_OUT` KHÔNG được sinh ra ở đây. Phiên đã đóng thì biến mất khỏi phép
 * chiếu sơ đồ và ô bàn trở lại trắng ngay — muốn giữ nó mờ một lúc thì phép
 * chiếu phải mang theo cả Phiên vừa đóng, và "mờ bao lâu" là câu V2 chưa ai
 * chốt. Giá trị này có trong kiểu để hợp đồng đủ sáu trạng thái, và sẽ được
 * dùng khi V2 có câu trả lời.
 */
export function waiterVisitPhase(activity: WaiterVisitActivity, now: Date): WaiterVisitPhase {
  if (activity.paid) return 'PAYMENT'
  if (activity.orderingSince !== null && now.getTime() - activity.orderingSince.getTime() < ORDERING_PRESENCE_TTL_MS) {
    return 'ORDERING'
  }
  if (activity.pendingTicketCount > 0) return 'AWAITING_FOOD'
  if (activity.orderCount > 0) return 'DINING'
  return 'ARRIVED'
}

/** Bản đồ `visitId → trạng thái`, dạng mà phép chiếu sơ đồ nhận vào. */
export function waiterVisitPhases(
  activities: readonly WaiterVisitActivity[],
  now: Date,
): Map<number, WaiterVisitPhase> {
  return new Map(activities.map((activity) => [activity.visitId, waiterVisitPhase(activity, now)]))
}

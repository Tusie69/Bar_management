import type { CallTarget, ClaimView } from "./models"

/**
 * Khóa định danh một người đang được gọi, dùng chung cho bộ nhớ cuộc gọi dở,
 * cache lịch sử gọi và mock server.
 *
 * Phải có tiền tố loại: id booking, id đơn chờ và id lượt ghé là ba dãy số
 * độc lập, nên chỉ lấy số không thì booking 4 và đơn chờ 4 sẽ đè lên nhau -
 * cuộc gọi dở của bàn này hiện lên ở bàn kia.
 */
export function callTargetKey(target: CallTarget): string {
  return `${target.kind}:${target.id}`
}

/**
 * Một chỗ giữ bàn trên sơ đồ thì gọi ai.
 *
 * Booking đứng trước vì nó là danh tính bền nhất: một lượt ghé check-in từ
 * booking vẫn giữ reservationId, nên lịch sử gọi không bị tách đôi khi khách
 * ngồi xuống. Trả về null khi chỗ giữ không có đối tượng nào để ghi log -
 * trên thực tế là dữ liệu hỏng, không phải việc thường gặp.
 */
export function claimCallTarget(claim: ClaimView): CallTarget | null {
  if (claim.reservationId) {
    return { kind: "booking", id: claim.reservationId, version: claim.kind === "reservation" ? claim.version : null }
  }
  if (claim.visitId) return { kind: "visit", id: claim.visitId }
  if (claim.waitlistEntryId) return { kind: "waitlist", id: claim.waitlistEntryId }
  return null
}

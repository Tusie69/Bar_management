/**
 * Enum values copied verbatim from the CHECK constraints of
 * database/verification/ddl_draft.sql. Vietnamese labels follow the wording
 * staff use (docs/GAM_APP_Tong_hop_yeu_cau, db05).
 */

export type RoleCode = "OWNER_ADMIN" | "RECEPTIONIST" | "CUSTOMER_CARE" | "CASHIER"
export type TableKind = "TABLE" | "BAR_SEAT"
export type TableStatus = "ACTIVE" | "OUT_OF_SERVICE" | "RETIRED"
export type CustomerStatus = "ACTIVE" | "MERGED" | "ANONYMIZED"
export type ReservationHoldPolicy = "SEQUENTIAL" | "WINDOWED"

export type ReservationStatus = "BOOKED" | "CHECKED_IN" | "CANCELLED" | "NO_SHOW"
export type BookingClassification = "RETURNING" | "NEW" | "UNCLASSIFIED"
export type ReservationCloseReason =
  "CUSTOMER_REQUEST" | "NO_SHOW_CONFIRMED" | "DUPLICATE" | "ENTRY_ERROR" | "VENUE_DECISION" | "OTHER"

export type VisitOrigin = "RESERVATION" | "WALK_IN" | "WAITLIST"
export type VisitEndReason = "GUEST_LEFT" | "MERGED" | "ENTRY_ERROR" | "BUSINESS_DAY_END"

export type WaitlistKind = "ADVANCE_RESERVATION" | "WALK_IN"
export type WaitlistStatus = "WAITING" | "CONTACTING" | "OFFERED" | "HOLD_ACTIVE" | "SEATED" | "DECLINED" | "CANCELLED"
export type WaitlistPreferenceMode = "ANY" | "PREFERRED_FIRST" | "PREFERRED_ONLY"
export type WaitlistChannel = "IN_PERSON" | "PHONE_CALLBACK" | "ZALO_THREAD" | "FANPAGE_THREAD" | "OTHER"
export type WaitlistCloseReason =
  | "CUSTOMER_DECLINED"
  | "CUSTOMER_WITHDREW"
  | "NO_SHOW_AFTER_ACCEPT"
  | "RESERVATION_CANCELLED"
  | "SEATED_OTHERWISE"
  | "DUPLICATE"
  | "ENTRY_ERROR"
  | "OTHER"
export type ContactAttemptChannel = "IN_PERSON" | "PHONE_BY_AUTHORIZED" | "ZALO_THREAD" | "FANPAGE_THREAD" | "OTHER"
export type ContactOutcome =
  | "NO_ANSWER"
  | "CALLBACK_REQUESTED"
  | "OFFER_PENDING"
  | "ACCEPTED"
  | "DECLINED_OFFER"
  | "KEEP_WAITING"
  | "WITHDREW"
  | "WRONG_CONTACT"

export type HoldKind = "RESERVATION" | "WAITLIST_OFFER"
export type HoldStatus = "ACTIVE" | "CONVERTED" | "RELEASED"
export type DeadlineBasis = "DEFAULT" | "NEGOTIATED"
export type HoldReleaseReason =
  | "CUSTOMER_NO_SHOW"
  | "CUSTOMER_CANCELLED"
  | "RESERVATION_CANCELLED"
  | "STAFF_REASSIGNED"
  | "ENTRY_ERROR"
  | "UNDO"
  | "OTHER"

export type AllocationKind = "HOLD" | "USAGE"
export type AllocationReleaseReason =
  | "CONVERTED_TO_USAGE"
  | "MOVED"
  | "REGROUPED"
  | "SPLIT"
  | "MERGED"
  | "GUEST_LEFT"
  | "BUSINESS_DAY_END"
  | "HOLD_RELEASED"
  | "RESERVATION_CANCELLED"
  | "NO_SHOW"
  | "ENTRY_ERROR"
  | "UNDO"

export type BookingSourceCode = "HOTLINE" | "FANPAGE" | "ZALO" | "SHAREHOLDER" | "STAFF" | "SOCIAL" | "OTHER"

/* ---------------- Labels ---------------- */

export const ROLE_LABEL: Record<RoleCode, string> = {
  OWNER_ADMIN: "Chủ quán / Admin",
  RECEPTIONIST: "Lễ tân",
  CUSTOMER_CARE: "CSKH",
  CASHIER: "Thu ngân",
}

export const SOURCE_LABEL: Record<BookingSourceCode, string> = {
  HOTLINE: "Hotline",
  FANPAGE: "Fanpage",
  ZALO: "Zalo",
  SHAREHOLDER: "Cổ đông",
  STAFF: "Nhân viên",
  SOCIAL: "Social",
  OTHER: "Khác",
}

export const RESERVATION_STATUS_LABEL: Record<ReservationStatus, string> = {
  BOOKED: "Đã đặt",
  CHECKED_IN: "Đã check-in",
  CANCELLED: "Đã hủy",
  NO_SHOW: "Không đến",
}

export const CLOSE_REASON_LABEL: Record<ReservationCloseReason, string> = {
  CUSTOMER_REQUEST: "Khách yêu cầu hủy",
  NO_SHOW_CONFIRMED: "Xác nhận không đến",
  DUPLICATE: "Trùng booking",
  ENTRY_ERROR: "Nhập sai",
  VENUE_DECISION: "Quán quyết định",
  OTHER: "Lý do khác",
}

export const WAITLIST_KIND_LABEL: Record<WaitlistKind, string> = {
  ADVANCE_RESERVATION: "Đặt trước, chưa có bàn",
  WALK_IN: "Walk-in, chưa có bàn",
}

export const WAITLIST_STATUS_LABEL: Record<WaitlistStatus, string> = {
  WAITING: "Đang chờ",
  CONTACTING: "Đang liên hệ",
  OFFERED: "Đã đề nghị bàn",
  HOLD_ACTIVE: "Đang giữ bàn",
  SEATED: "Đã nhận bàn",
  DECLINED: "Từ chối",
  CANCELLED: "Đã hủy",
}

export const WAITLIST_CHANNEL_LABEL: Record<WaitlistChannel, string> = {
  IN_PERSON: "Tại quầy",
  PHONE_CALLBACK: "Gọi lại",
  ZALO_THREAD: "Zalo",
  FANPAGE_THREAD: "Fanpage",
  OTHER: "Khác",
}

export const PREFERENCE_MODE_LABEL: Record<WaitlistPreferenceMode, string> = {
  ANY: "Bàn nào cũng được",
  PREFERRED_FIRST: "Ưu tiên chỗ đã chọn",
  PREFERRED_ONLY: "Chỉ chỗ đã chọn",
}

export const CONTACT_OUTCOME_LABEL: Record<ContactOutcome, string> = {
  NO_ANSWER: "Không liên lạc được",
  CALLBACK_REQUESTED: "Khách hẹn gọi lại",
  OFFER_PENDING: "Đã đề nghị, chờ khách trả lời",
  ACCEPTED: "Khách nhận bàn (giữ bàn)",
  DECLINED_OFFER: "Khách chưa nhận bàn này",
  KEEP_WAITING: "Khách tiếp tục chờ",
  WITHDREW: "Khách rút khỏi danh sách",
  WRONG_CONTACT: "Sai thông tin liên hệ",
}

export const WAITLIST_CLOSE_LABEL: Record<WaitlistCloseReason, string> = {
  CUSTOMER_DECLINED: "Khách từ chối",
  CUSTOMER_WITHDREW: "Khách rút",
  NO_SHOW_AFTER_ACCEPT: "Nhận bàn nhưng không đến",
  RESERVATION_CANCELLED: "Booking đã hủy",
  SEATED_OTHERWISE: "Đã có chỗ theo cách khác",
  DUPLICATE: "Trùng",
  ENTRY_ERROR: "Nhập sai",
  OTHER: "Lý do khác",
}

export const HOLD_RELEASE_LABEL: Record<HoldReleaseReason, string> = {
  CUSTOMER_NO_SHOW: "Khách không đến",
  CUSTOMER_CANCELLED: "Khách hủy",
  RESERVATION_CANCELLED: "Booking đã hủy",
  STAFF_REASSIGNED: "Nhân viên xếp lại",
  ENTRY_ERROR: "Nhập sai",
  UNDO: "Hoàn tác",
  OTHER: "Lý do khác",
}

export const ORIGIN_LABEL: Record<VisitOrigin, string> = {
  RESERVATION: "Đặt trước",
  WALK_IN: "Walk-in",
  WAITLIST: "Từ danh sách chờ",
}

export const RELEASE_REASON_LABEL: Record<AllocationReleaseReason, string> = {
  CONVERTED_TO_USAGE: "Chuyển thành đang dùng",
  MOVED: "Đổi bàn",
  REGROUPED: "Ghép bàn",
  SPLIT: "Tách bàn",
  MERGED: "Gộp lượt",
  GUEST_LEFT: "Khách rời, nhả bàn",
  BUSINESS_DAY_END: "Tự đóng cuối ngày kinh doanh",
  HOLD_RELEASED: "Nhả giữ bàn",
  RESERVATION_CANCELLED: "Hủy booking",
  NO_SHOW: "Không đến",
  ENTRY_ERROR: "Nhập sai",
  UNDO: "Hoàn tác",
}

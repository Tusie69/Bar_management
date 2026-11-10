const messages: Record<string, string> = {
  MERGE_REQUIRES_MULTIPLE_TABLES: "Chọn ít nhất hai bàn để ghép.",
  TABLE_NOT_FOUND: "Có bàn không tồn tại hoặc đã ngừng phục vụ. Vui lòng tải lại sơ đồ.",
  TABLE_ALREADY_GROUPED: "Có bàn đã thuộc nhóm khác. Vui lòng tải lại sơ đồ.",
  SPARE_TABLE_NOT_BOOKABLE: "Không thể đặt hoặc ghép trực tiếp bàn sơ cua.",
  TABLE_KIND_MISMATCH: "Không thể ghép bàn thường với ghế Bar.",
  TABLE_ZONE_MISMATCH: "Chỉ ghép các bàn trong cùng một khu vực.",
  TABLE_GROUP_MIXED_STATE: "Không thể ghép bàn trống với bàn đang có khách hoặc đang được giữ.",
  TABLE_GROUP_MULTIPLE_CLAIMS: "Các bàn đang thuộc những booking hoặc lượt khách khác nhau, không thể ghép.",
  INVALID_GROUP_ID: "Mã nhóm bàn không hợp lệ.",
  TABLES_REQUIRED: "Chọn ít nhất một bàn giữ lại cho đoàn khách.",
  INVALID_SPLIT_MODE: "Cách tách nhóm không hợp lệ. Vui lòng tải lại sơ đồ.",
  TABLE_GROUP_VERSION_CONFLICT: "Nhóm bàn vừa thay đổi trên máy khác. Đã yêu cầu tải lại sơ đồ, vui lòng chọn lại.",
  PAYMENT_SOURCE_INVALID: "Nguồn xác nhận thanh toán phải là ứng dụng hoặc iPOS.",
  PAYMENT_ALREADY_CONFIRMED: "Lượt khách này đã được xác nhận thanh toán.",
  VISIT_NOT_OPEN: "Lượt khách đã kết thúc. Vui lòng tải lại sơ đồ.",
  PAYMENT_VERIFICATION_UNAVAILABLE: "Chưa có xác nhận thanh toán. Vui lòng kiểm tra trước khi nhả bàn.",
  EXPECTED_AT_OFF_SLOT:
    "Máy chủ chưa nhận mốc giờ này. Chọn mốc 00, 15, 30 hoặc 45 phút cho đến khi máy chủ hỗ trợ bước 5 phút; thông tin đã nhập vẫn được giữ.",
  INVALID_PHONE_NUMBER: "Thông tin điện thoại đang trống hoặc vượt độ dài cho phép.",
  PHONE_NOT_DIALABLE: "Thông tin điện thoại này không thể dùng để gọi.",
}

export function apiErrorMessage(code: string, fallback: string, details: Record<string, unknown> = {}) {
  const message = messages[code] ?? fallback
  const ids = details.conflictingTableIds
  return (code === "TABLE_GROUP_MULTIPLE_CLAIMS" || code === "TABLE_GROUP_MIXED_STATE") &&
    Array.isArray(ids) &&
    ids.length
    ? `${message} Bàn: ${ids
        .filter((id) => Number.isSafeInteger(id) && id > 0)
        .map((id) => `#${id}`)
        .join(", ")}.`
    : message
}

const messages: Record<string, string> = {
  MERGE_REQUIRES_MULTIPLE_TABLES: "Chọn ít nhất hai bàn để ghép.",
  TABLE_NOT_FOUND: "Có bàn không tồn tại hoặc đã ngừng phục vụ. Vui lòng tải lại sơ đồ.",
  TABLE_ALREADY_GROUPED: "Có bàn đã thuộc nhóm khác. Vui lòng tải lại sơ đồ.",
  SPARE_TABLE_NOT_BOOKABLE: "Không thể đặt hoặc ghép trực tiếp bàn sơ cua.",
  TABLE_KIND_MISMATCH: "Không thể ghép bàn thường với ghế Bar.",
  TABLE_ZONE_MISMATCH: "Chỉ ghép các bàn trong cùng một khu vực.",
  TABLE_GROUP_MIXED_STATE: "Không thể ghép bàn trống với bàn đang có khách hoặc đang được giữ.",
  TABLE_GROUP_MULTIPLE_CLAIMS: "Các bàn đang thuộc những booking hoặc lượt khách khác nhau, không thể ghép.",
  TABLE_NOT_ADJACENT: "Các bàn đã chọn không liền nhau theo sơ đồ mặt bằng.",
  CROSS_ZONE_MERGE_DISABLED: "Ghép bàn khác khu đang tắt. Liên hệ quản lý để bật.",
  TABLE_GROUP_NOT_FOUND: "Cụm bàn không còn tồn tại. Vui lòng tải lại sơ đồ.",
  TABLE_GROUP_ALREADY_DISSOLVED: "Cụm bàn đã được tách trước đó.",
  TABLE_GROUP_IN_USE: "Cụm bàn đang có khách hoặc đang giữ cho booking. Nhả bàn hoặc đổi bàn trước khi tách.",
  TABLE_GROUP_CONFLICT: "Cụm bàn vừa thay đổi trên máy khác. Vui lòng tải lại sơ đồ.",
  SPARE_TABLE_OVERRIDE_REQUIRED: "Trong cụm có bàn sơ cua. Cần xác nhận trước khi ghép.",
  CAPACITY_OVERRIDE_REQUIRED: "Số khách vượt sức chứa đề xuất. Cần xác nhận trước khi lưu.",
  INVALID_TABLE_CODES: "Danh sách bàn không hợp lệ.",
  DUPLICATE_TABLE_CODE: "Danh sách bàn có mã trùng lặp.",
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

/**
 * Maps a table id to the code the receptionist sees. The services layer has no
 * catalog of its own, so the floor model registers one here; without it the
 * message falls back to "#12", which means nothing to anyone on the floor.
 */
let tableCodeOf: ((id: number) => string | null) | null = null

export function setTableCodeResolver(resolver: ((id: number) => string | null) | null) {
  tableCodeOf = resolver
}

export function apiErrorMessage(code: string, fallback: string, details: Record<string, unknown> = {}) {
  const message = messages[code] ?? fallback
  const ids = details.conflictingTableIds
  return (code === "TABLE_GROUP_MULTIPLE_CLAIMS" || code === "TABLE_GROUP_MIXED_STATE") &&
    Array.isArray(ids) &&
    ids.length
    ? `${message} Bàn: ${ids
        .filter((id): id is number => Number.isSafeInteger(id) && (id as number) > 0)
        .map((id) => tableCodeOf?.(id) ?? `#${id}`)
        .join(", ")}.`
    : message
}

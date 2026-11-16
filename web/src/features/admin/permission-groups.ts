/**
 * TU-34 — Bảy checkbox trong prototype, ánh xạ sang permission thật.
 *
 * Prototype nói bằng ngôn ngữ của quán ("Duyệt giảm giá, hủy món"), backend
 * nói bằng mã permission. Một dòng chữ có thể ứng với nhiều mã (sửa và hủy
 * booking là hai permission riêng), nên ánh xạ là 1-nhiều và nằm đúng một chỗ.
 *
 * Nhóm không có mã nào (`codes` rỗng) là tính năng CHƯA có trong hệ thống.
 * Nó vẫn hiện để bảng khớp biên bản, nhưng ở trạng thái "chưa hỗ trợ" và
 * không gửi gì lên server — tạo một permission giả để checkbox bấm được sẽ là
 * một lời hứa sai với người quản trị.
 */
import type { AccountPermissionView } from "@/services/contracts"

export interface PermissionGroup {
  key: string
  label: string
  /** Permission thật; rỗng = chưa triển khai. */
  codes: readonly string[]
  /** Giải thích khi nhóm chưa dùng được. */
  unsupportedNote?: string
}

export const PERMISSION_GROUPS: readonly PermissionGroup[] = [
  { key: "report", label: "Xem báo cáo doanh thu", codes: ["report.read"] },
  {
    key: "phone",
    label: "Xem số điện thoại đầy đủ",
    // Hai mã: một cho hồ sơ khách, một cho booking. Biên bản coi đây là một
    // quyết định duy nhất, nên chúng bật tắt cùng nhau.
    codes: ["customer.phone.reveal", "booking.phone.reveal"],
  },
  { key: "booking", label: "Sửa / hủy booking", codes: ["reservation.update", "reservation.cancel"] },
  {
    key: "discount",
    label: "Duyệt giảm giá, hủy món",
    codes: [],
    unsupportedNote: "Chưa có module gọi món và thanh toán, nên chưa có quyền này để cấp.",
  },
  { key: "accounts", label: "Quản lý tài khoản nhân viên", codes: ["user.manage"] },
  { key: "venue", label: "Cấu hình vận hành", codes: ["venue.configure"] },
  { key: "audit", label: "Xem nhật ký thao tác", codes: ["audit.read"] },
]

export interface GroupState {
  group: PermissionGroup
  /** Các mã SuperAdmin tick được cho tài khoản này (nằm trong trần). */
  availableCodes: string[]
  checked: boolean
  editable: boolean
  /** Nhóm chưa có permission tương ứng trong backend. */
  unsupported: boolean
  /** Nhóm nằm ngoài trần của tài khoản: không cấp được, không phải "chưa làm". */
  outOfCeiling: boolean
}

/**
 * Trạng thái checkbox của một nhóm.
 *
 * `checked` chỉ đúng khi MỌI mã cấp được trong nhóm đều đang bật: nửa bật nửa
 * tắt mà hiện dấu tick sẽ nói dối về quyền thực tế.
 *
 * Từ TU-32 (quyết định 16/11), một quyền ngoài vai trò vẫn tick được miễn là
 * nằm trong trần của tài khoản — backend trả `grantable` cho đúng việc đó.
 */
export function groupStates(permissions: readonly AccountPermissionView[]): GroupState[] {
  const byCode = new Map(permissions.map((permission) => [permission.code, permission]))
  return PERMISSION_GROUPS.map((group) => {
    const views = group.codes.map((code) => byCode.get(code)).filter((view) => view !== undefined)
    const grantable = views.filter((view) => view.grantable)
    return {
      group,
      availableCodes: views.filter((view) => view.editable).map((view) => view.code),
      checked: grantable.length > 0 && grantable.every((view) => view.enabled),
      editable: views.some((view) => view.editable),
      unsupported: group.codes.length === 0,
      outOfCeiling: group.codes.length > 0 && grantable.length === 0,
    }
  })
}

/** Payload gửi lên server khi bấm một nhóm: chỉ các mã nằm trong trần vai trò. */
export function groupPayload(state: GroupState, enabled: boolean): Record<string, boolean> {
  return Object.fromEntries(state.availableCodes.map((code) => [code, enabled]))
}

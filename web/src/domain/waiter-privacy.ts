/**
 * Module Phục vụ 1 — luật "Phục vụ không thấy khách là ai", viết thành hàm thuần.
 *
 * Chốt thật nằm ở máy chủ: endpoint `GET /tables/service` chỉ trả về phép
 * chiếu đã lược (xem api/src/modules/tables/waiter-floor-projection.ts), nên
 * tên và số điện thoại không bao giờ tới được trình duyệt của Phục vụ. Hàm ở
 * đây KHÔNG phải lớp bảo mật thứ hai; nó có hai việc cụ thể:
 *
 * 1. Chế độ mock của prototype không có máy chủ, nên nó phải tự lược trước khi
 *    đưa dữ liệu vào màn Phục vụ. Nếu không, bản demo sẽ hiện tên khách và
 *    người xem demo sẽ tin rằng đó là thiết kế.
 * 2. Nó là nơi duy nhất mô tả "trường nào là dữ liệu khách", nên test kiểm
 *    được bằng một assert thay vì đọc mắt qua từng component.
 *
 * Không dùng hàm này để "che" dữ liệu đã nhận từ một endpoint đầy đủ. Nếu một
 * màn hình của Phục vụ phải lược dữ liệu ở trình duyệt thì nó đang gọi sai
 * endpoint.
 */
import type { ClaimView, FloorGroup, FloorState } from "./models"

/** Các trường của `ClaimView` mang thông tin nhận dạng khách. */
export const WAITER_REDACTED_CLAIM_FIELDS = [
  "displayName",
  "phoneLast3",
  "honorific",
  "iconKeys",
  "flags",
  "sourceCode",
  "origin",
  "note",
  "canCall",
  "contactStatus",
  "contactedAt",
] as const

function redactClaim(claim: ClaimView | null | undefined): ClaimView | null {
  if (!claim) return null
  return {
    ...claim,
    displayName: "",
    phoneLast3: null,
    honorific: null,
    iconKeys: [],
    flags: [],
    sourceCode: null,
    origin: null,
    note: null,
    canCall: false,
    contactStatus: null,
    contactedAt: null,
  }
}

function redactGroup(group: FloorGroup): FloorGroup {
  if (group.claim === undefined) return group
  return { ...group, claim: redactClaim(group.claim) }
}

/**
 * Giữ nguyên mọi thông tin vận hành (trạng thái bàn, số khách, giờ mở Phiên,
 * cờ đã thanh toán, cụm bàn, version) và xoá mọi thông tin nhận dạng khách.
 */
export function redactFloorForWaiter(floor: FloorState): FloorState {
  return {
    ...floor,
    tables: floor.tables.map((table) => ({ ...table, claim: redactClaim(table.claim) })),
    groups: floor.groups.map(redactGroup),
  }
}

/** True khi không còn trường nhận dạng khách nào mang giá trị. Dùng cho test. */
export function isRedactedForWaiter(floor: FloorState): boolean {
  const claims = [...floor.tables.map((table) => table.claim), ...floor.groups.map((group) => group.claim ?? null)]
  return claims.every((claim) => {
    if (!claim) return true
    return (
      claim.displayName === "" &&
      claim.phoneLast3 === null &&
      (claim.honorific ?? null) === null &&
      (claim.iconKeys?.length ?? 0) === 0 &&
      (claim.flags?.length ?? 0) === 0 &&
      claim.sourceCode === null &&
      claim.origin === null &&
      claim.note === null &&
      claim.canCall !== true &&
      (claim.contactStatus ?? null) === null &&
      (claim.contactedAt ?? null) === null
    )
  })
}

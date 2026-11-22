import type { PreparationTicketStatus } from "./preparation-layout"
import { PREPARATION_NEXT_STATUS, type PreparationQueueStatus } from "./preparation-presentation"

/**
 * Thả một phiếu vào một cột nghĩa là gì.
 *
 * Hàm thuần, cùng quy ước với `preparation-presentation.ts`: component chỉ kéo
 * và vẽ, còn "được hay không, và vì sao không" assert được bằng test mà không
 * cần chuột thật. Đây cũng là chỗ duy nhất biết luật, nên nút bấm và cú kéo
 * không bao giờ nói hai điều khác nhau.
 *
 * Luật ở đây PHẢI khớp máy chủ (`preparation.repository.ts`): một bước mỗi
 * lần, lùi chỉ từ "Đã tiếp nhận" và "Đang pha". Chặn ở
 * đây chỉ để quầy không gửi đi một yêu cầu đã biết trước là bị từ chối — máy
 * chủ vẫn là nơi quyết định.
 */
export type PreparationDropKind = "forward" | "revert" | "same" | "blocked"

export interface PreparationDropPlan {
  kind: PreparationDropKind
  /** Trạng thái sẽ gửi lên; `null` khi không làm gì. */
  toStatus: PreparationTicketStatus | null
  /** Câu nói cho người dùng khi không thả được; `null` khi thả được. */
  blockedReason: string | null
}

const ORDER: readonly PreparationQueueStatus[] = ["SUBMITTED", "ACCEPTED", "PREPARING", "READY"]

const ALLOW: PreparationDropPlan = { kind: "forward", toStatus: null, blockedReason: null }

function blocked(blockedReason: string): PreparationDropPlan {
  return { kind: "blocked", toStatus: null, blockedReason }
}

export function planPreparationDrop(
  from: PreparationTicketStatus,
  to: PreparationQueueStatus,
  canTransition: boolean,
): PreparationDropPlan {
  if (from === to) return { ...ALLOW, kind: "same" }
  if (!canTransition) return blocked("Phiên này không có quyền đổi trạng thái phiếu.")

  const fromIndex = ORDER.indexOf(from as PreparationQueueStatus)
  const toIndex = ORDER.indexOf(to)
  // COLLECTED đã rời hàng đợi, nên nó không có cột và không kéo được.
  if (fromIndex === -1) return blocked("Phiếu đã bàn giao xong, không đổi được nữa.")

  const step = toIndex - fromIndex
  if (step > 1) return blocked("Mỗi lần chỉ chuyển được một bước. Kéo sang cột ngay bên cạnh.")
  if (step < -1) return blocked("Mỗi lần chỉ lùi được một bước. Kéo về cột ngay bên trái.")

  if (step === 1) {
    return { kind: "forward", toStatus: PREPARATION_NEXT_STATUS[from] ?? null, blockedReason: null }
  }

  // Lùi từ READY thì không: lúc phiếu thành READY, máy chủ đã đẩy thông báo
  // "món xong" tới Phục vụ và Thu ngân, và có thể đã có người đi lấy món. Rút
  // lại thông báo đó không phải việc một cú kéo trên màn hình quầy quyết định.
  if (from === "READY") {
    return blocked("Phiếu đã báo xong và Phục vụ đã nhận thông báo. Món phải làm lại thì đi đường xin hủy / ghi hao.")
  }
  return { kind: "revert", toStatus: to, blockedReason: null }
}

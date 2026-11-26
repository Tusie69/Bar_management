/**
 * Module Phục vụ 1 (v1.1) — bảng màu và chữ của sáu trạng thái lượt khách.
 *
 * Đây là một bảng DỮ LIỆU riêng, không phải một nhánh thêm vào `STATE_META`.
 * `STATE_META` là từ vựng của Lễ tân (trống, đã đặt, tới muộn, no-show) và nó
 * đang điều khiển màu của màn Điều phối; thêm sáu trạng thái của Phục vụ vào
 * đó nghĩa là một lần sửa màu bên này đổi màu bên kia, và không ai thấy cho
 * tới khi Lễ tân gọi điện hỏi vì sao bàn đã đặt đổi sang màu tím.
 *
 * Màu lấy thẳng từ mockup đã duyệt ngày 22/11, viết bằng mã hex chứ không
 * bằng token `--st-*`: những token đó thuộc về bảng trạng thái của Lễ tân, và
 * mượn chúng là buộc hai bảng màu phải thay đổi cùng nhau mãi mãi.
 */
import type { FloorTableState, WaiterVisitPhase } from "@/domain/models"

/** Một tông màu ô bàn: viền, nền, chữ, và nhãn ngắn hiện trong ô. */
export interface WaiterPhaseTone {
  /** Nhãn đầy đủ, dùng ở chú giải và ở khối màu trên bảng thao tác. */
  label: string
  /** Nhãn ngắn in bên dưới mã bàn trong ô. Ô bàn rộng chừng 56px. */
  short: string
  /** Viền ô bàn, ghế, và nền của badge số khách. */
  color: string
  /** Nền ô bàn. */
  tint: string
  /** Chữ trong ô bàn. */
  ink: string
}

/**
 * Sáu trạng thái theo đúng thứ tự tài liệu. Thứ tự của object này LÀ thứ tự
 * hiện trong chú giải, nên nó không được sắp lại theo bảng chữ cái.
 */
export const WAITER_PHASE_TONE: Record<WaiterVisitPhase, WaiterPhaseTone> = {
  ARRIVED: {
    label: "Mới vào",
    short: "mới vào",
    color: "#1A73E8",
    tint: "#E8F0FE",
    ink: "#174EA6",
  },
  ORDERING: {
    label: "Đang gọi món",
    short: "đang gọi",
    color: "#E8710A",
    tint: "#FEF2E0",
    ink: "#A1500A",
  },
  AWAITING_FOOD: {
    label: "Chờ đồ",
    short: "chờ đồ",
    color: "#7B3FF2",
    tint: "#F1EAFE",
    ink: "#5A24C4",
  },
  DINING: {
    label: "Đang dùng",
    short: "đang dùng",
    color: "#1E8E3E",
    tint: "#E6F4EA",
    ink: "#146C2E",
  },
  /**
   * TU-45 — "Chờ thanh toán": đã chốt bill, CHƯA nhận tiền.
   *
   * Màu GIỮ NGUYÊN họ xanh của "Đang dùng", đúng yêu cầu mockup NA-44: ô bàn
   * vẫn xanh vì khách vẫn đang ngồi đó, chỉ thêm một tín hiệu nữa. Tín hiệu đó
   * là CHỮ ("chờ TT") chứ không phải màu — nguyên tắc "không dùng màu làm tín
   * hiệu duy nhất" của bảng Hành vi, và cũng là thứ duy nhất đọc được trên một
   * ô bàn 56px đối với người không phân biệt được xanh với xanh đậm.
   */
  AWAITING_PAYMENT: {
    label: "Chờ thanh toán",
    short: "chờ TT",
    color: "#0B7C57",
    tint: "#DFF3EA",
    ink: "#075239",
  },
  PAYMENT: {
    label: "Đã thanh toán",
    short: "đã trả",
    color: "#E52E5B",
    tint: "#FDE8EE",
    ink: "#A81541",
  },
  CHECKED_OUT: {
    label: "Đã checkout",
    short: "đã về",
    color: "#9AA0A6",
    tint: "#F1F3F4",
    ink: "#5F6368",
  },
}

/** Thứ tự hiện trong chú giải nút "!" và trong mọi danh sách sáu trạng thái. */
export const WAITER_PHASE_ORDER: readonly WaiterVisitPhase[] = [
  "ARRIVED",
  "ORDERING",
  "AWAITING_FOOD",
  "DINING",
  "AWAITING_PAYMENT",
  "PAYMENT",
  "CHECKED_OUT",
]

/** Câu giải thích ngắn trong chú giải: trạng thái này nghĩa là gì ngoài sàn. */
export const WAITER_PHASE_HINT: Record<WaiterVisitPhase, string> = {
  ARRIVED: "Lễ tân vừa Check-in. Ra chào khách và mở Gọi món.",
  ORDERING: "Đang có người lên đơn cho bàn này.",
  AWAITING_FOOD: "Đơn đã gửi, Bar hoặc Bếp chưa mang ra đủ.",
  DINING: "Đã nhận đủ món. Gọi thêm hoặc chốt bill được.",
  AWAITING_PAYMENT: "Đã chốt bill, chưa nhận tiền. Gọi thêm bị khoá.",
  PAYMENT: "Đã nhận tiền. Bàn sắp trả về trống.",
  CHECKED_OUT: "Khách đã về. Bàn sắp trả về trống.",
}

/**
 * Tông màu của từng ô bàn, để truyền cho `FloorCanvas`.
 *
 * Chỉ ô bàn CÓ KHÁCH mới có tông riêng. Bàn trống, bàn sơ cua và bàn ngừng
 * phục vụ không nằm trong bản đồ này, nên chúng giữ nguyên cách vẽ mặc định —
 * trắng, viền đứt, gạch chéo — y như mọi màn khác trong hệ thống.
 */
export function waiterCellTones(states: ReadonlyMap<number, FloorTableState>): Map<number, WaiterPhaseTone> {
  const tones = new Map<number, WaiterPhaseTone>()
  for (const [tableId, state] of states) {
    const phase = state.waiterPhase
    if (!phase) continue
    tones.set(tableId, WAITER_PHASE_TONE[phase])
  }
  return tones
}

/** Đếm số LƯỢT KHÁCH ở mỗi trạng thái, không đếm số ô bàn. */
export function waiterPhaseCounts(states: ReadonlyMap<number, FloorTableState>): Record<WaiterVisitPhase, number> {
  const counts: Record<WaiterVisitPhase, number> = {
    ARRIVED: 0,
    ORDERING: 0,
    AWAITING_FOOD: 0,
    DINING: 0,
    AWAITING_PAYMENT: 0,
    PAYMENT: 0,
    CHECKED_OUT: 0,
  }
  // Một cụm bốn bàn ghép là MỘT đoàn khách. Đếm theo ô bàn thì chú giải báo
  // "4 bàn đang dùng" cho một đoàn, và con số đó không trả lời được câu hỏi
  // duy nhất mà Phục vụ hỏi nó: tối nay còn mấy bàn phải để mắt tới.
  const seen = new Set<string>()
  for (const state of states.values()) {
    const phase = state.waiterPhase
    if (!phase) continue
    const visitId = state.claim?.visitId ?? null
    const key = visitId === null ? `t:${state.tableId}` : `v:${visitId}`
    if (seen.has(key)) continue
    seen.add(key)
    counts[phase] += 1
  }
  return counts
}

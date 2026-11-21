import { describe, expect, it } from "vitest"

import {
  PREPARATION_EMPTY_QUEUE_TEXT,
  PREPARATION_WAIT_CRITICAL_SECONDS,
  PREPARATION_WAIT_WARNING_SECONDS,
  preparationColumns,
  preparationGuestFlagBadges,
  preparationMetaLine,
  preparationNextAction,
  preparationPendingCancellationLabel,
  preparationQueueViewState,
  preparationStationLabel,
  preparationSubmittedAtLabel,
  preparationTableLabel,
  preparationWaitAccessibleLabel,
  preparationWaitLabel,
  preparationWaitTone,
} from "./preparation-presentation"

/**
 * L3-A — hai quầy, hai thứ tiếng, một state machine.
 *
 * Bartender không "làm" một ly Negroni và không "nhận món" từ chính mình; Bếp
 * không "pha" một khay thịt. Nhãn phải khác nhau, nhưng status gửi lên API thì
 * tuyệt đối không được khác — đó là chỗ một bản dịch sai sẽ thành một transition
 * sai.
 */
describe("L3 — ngôn ngữ theo quầy", () => {
  it("BAR nói bằng ngôn ngữ Bartender", () => {
    expect(preparationColumns("BAR").map((column) => column.label)).toEqual([
      "Mới nhận",
      "Đã tiếp nhận",
      "Đang pha",
      "Hoàn thành · chờ bàn giao",
    ])
    expect(preparationNextAction("BAR", "SUBMITTED")?.label).toBe("Tiếp nhận")
    expect(preparationNextAction("BAR", "ACCEPTED")?.label).toBe("Bắt đầu pha")
    expect(preparationNextAction("BAR", "PREPARING")?.label).toBe("Báo hoàn thành")
    expect(preparationNextAction("BAR", "READY")?.label).toBe("Đã bàn giao món")
  })

  it("KITCHEN giữ nguyên ngôn ngữ Bếp đã có trong codebase", () => {
    expect(preparationColumns("KITCHEN").map((column) => column.label)).toEqual([
      "Mới nhận",
      "Đã tiếp nhận",
      "Đang làm",
      "Hoàn thành",
    ])
    expect(preparationNextAction("KITCHEN", "ACCEPTED")?.label).toBe("Bắt đầu làm")
    expect(preparationNextAction("KITCHEN", "READY")?.label).toBe("Đã nhận món")
  })

  it("status gửi lên API giống nhau ở cả hai quầy", () => {
    for (const status of ["SUBMITTED", "ACCEPTED", "PREPARING", "READY"] as const) {
      expect(preparationNextAction("BAR", status)?.status).toBe(preparationNextAction("KITCHEN", status)?.status)
    }
    expect(preparationNextAction("BAR", "SUBMITTED")?.status).toBe("ACCEPTED")
    expect(preparationNextAction("BAR", "ACCEPTED")?.status).toBe("PREPARING")
    expect(preparationNextAction("BAR", "PREPARING")?.status).toBe("READY")
    expect(preparationNextAction("BAR", "READY")?.status).toBe("COLLECTED")
  })

  it("phiếu đã COLLECTED không còn hành động nào", () => {
    expect(preparationNextAction("BAR", "COLLECTED")).toBeNull()
    expect(preparationNextAction("KITCHEN", "COLLECTED")).toBeNull()
  })

  it("cột của hai quầy luôn cùng một thứ tự status và cùng tone", () => {
    const bar = preparationColumns("BAR")
    const kitchen = preparationColumns("KITCHEN")
    expect(bar.map((column) => column.status)).toEqual(["SUBMITTED", "ACCEPTED", "PREPARING", "READY"])
    expect(bar.map((column) => column.status)).toEqual(kitchen.map((column) => column.status))
    expect(bar.map((column) => column.tone)).toEqual(kitchen.map((column) => column.tone))
  })

  it("tên quầy trên tiêu đề", () => {
    expect(preparationStationLabel("BAR")).toBe("Bar")
    expect(preparationStationLabel("KITCHEN")).toBe("Bếp")
  })
})

/** L3-B — những gì quầy cần để biết phiếu này của ai, lúc nào. */
describe("L3 — metadata đầu phiếu", () => {
  it("giờ gọi đọc theo giờ quán", () => {
    // 21:44 giờ Việt Nam = 14:44Z.
    expect(preparationSubmittedAtLabel("2026-11-22T14:44:00.000Z")).toBe("21:44")
  })

  it("timestamp lỗi hiện — chứ không throw và không hiện NaN", () => {
    expect(preparationSubmittedAtLabel("không-phải-ngày")).toBe("—")
    expect(preparationSubmittedAtLabel("")).toBe("—")
    expect(preparationSubmittedAtLabel(null)).toBe("—")
    expect(preparationSubmittedAtLabel(undefined)).toBe("—")
  })

  it("dòng metadata ghép đơn thứ mấy, giờ gọi và người gọi", () => {
    expect(
      preparationMetaLine({
        visitSequence: 2,
        submittedAt: "2026-11-22T14:44:00.000Z",
        orderedByDisplayName: "Minh",
      }),
    ).toBe("Đơn 2 · gọi lúc 21:44 · Minh")
  })

  it("không nối thêm vai vào display name mà contract trả về", () => {
    const line = preparationMetaLine({
      visitSequence: 1,
      submittedAt: "2026-11-22T14:44:00.000Z",
      orderedByDisplayName: "Minh",
    })
    expect(line).not.toContain("Phục vụ")
    expect(line).not.toContain("Bartender")
  })

  it("thiếu người gọi thì bỏ hẳn phần đó, không để dấu phân cách trống", () => {
    expect(preparationMetaLine({ visitSequence: 3, submittedAt: "2026-11-22T14:44:00.000Z" })).toBe(
      "Đơn 3 · gọi lúc 21:44",
    )
    expect(
      preparationMetaLine({ visitSequence: 3, submittedAt: "2026-11-22T14:44:00.000Z", orderedByDisplayName: "  " }),
    ).toBe("Đơn 3 · gọi lúc 21:44")
  })

  it("timestamp lỗi vẫn giữ nguyên phần còn lại của dòng metadata", () => {
    expect(preparationMetaLine({ visitSequence: 4, submittedAt: "", orderedByDisplayName: "Minh" })).toBe(
      "Đơn 4 · gọi lúc — · Minh",
    )
  })

  it("cụm nhiều bàn đọc thành một chuỗi, phiếu chưa có bàn nói rõ đang đổi bàn", () => {
    expect(preparationTableLabel(["B21", "B22"])).toBe("B21 · B22")
    expect(preparationTableLabel([])).toBe("Đang đổi bàn")
    expect(preparationTableLabel(undefined)).toBe("Đang đổi bàn")
  })
})

/** L3-C — ba cờ vận hành, không suy diễn gì thêm. */
describe("L3 — cờ vận hành", () => {
  it("mỗi cờ true cho đúng một badge có chữ", () => {
    expect(preparationGuestFlagBadges({ vip: true, birthday: false, designated: false })).toEqual([
      { key: "vip", glyph: "⭐", label: "VIP" },
    ])
    expect(preparationGuestFlagBadges({ vip: false, birthday: true, designated: false })).toEqual([
      { key: "birthday", glyph: "🎂", label: "Sinh nhật" },
    ])
    expect(preparationGuestFlagBadges({ vip: false, birthday: false, designated: true })).toEqual([
      { key: "designated", glyph: "📌", label: "Chỉ định" },
    ])
  })

  it("ba cờ false thì không có badge nào, không placeholder", () => {
    expect(preparationGuestFlagBadges({ vip: false, birthday: false, designated: false })).toEqual([])
    expect(preparationGuestFlagBadges(null)).toEqual([])
    expect(preparationGuestFlagBadges(undefined)).toEqual([])
  })

  it("nhiều cờ cùng lúc render đủ, không trùng, theo thứ tự ưu tiên của sơ đồ bàn", () => {
    const badges = preparationGuestFlagBadges({ vip: true, birthday: true, designated: true })
    expect(badges.map((badge) => badge.key)).toEqual(["vip", "designated", "birthday"])
    expect(new Set(badges.map((badge) => badge.key)).size).toBe(3)
  })

  it("badge nào cũng có chữ, không bao giờ chỉ có emoji", () => {
    for (const badge of preparationGuestFlagBadges({ vip: true, birthday: true, designated: true })) {
      expect(badge.label.trim().length).toBeGreaterThan(0)
    }
  })
})

/**
 * L3-D — hủy đang chờ duyệt.
 *
 * Yêu cầu hủy chưa được duyệt là một thông tin của một dòng, không phải một
 * lệnh dừng phiếu: quầy vẫn pha phần còn lại. Nhãn chỉ nói số phần đang chờ, vì
 * contract không trả lý do và một lý do bịa ra sẽ thành một lý do được tin.
 */
describe("L3 — yêu cầu hủy chờ duyệt", () => {
  it("không có yêu cầu thì không có cảnh báo", () => {
    expect(preparationPendingCancellationLabel({ pendingCancellation: null })).toBeNull()
    expect(preparationPendingCancellationLabel({})).toBeNull()
  })

  it("nhãn nói đúng số phần đang chờ duyệt", () => {
    expect(preparationPendingCancellationLabel({ pendingCancellation: { quantity: 2 } })).toBe(
      "Đang chờ duyệt hủy 2 phần",
    )
    expect(preparationPendingCancellationLabel({ pendingCancellation: { quantity: 1 } })).toBe(
      "Đang chờ duyệt hủy 1 phần",
    )
  })

  it("nhãn không bịa lý do và không nói là hủy cả đơn", () => {
    const label = preparationPendingCancellationLabel({ pendingCancellation: { quantity: 3 } }) ?? ""
    expect(label).not.toContain("lý do")
    expect(label).not.toContain("cả đơn")
  })

  it("số bất thường vẫn không thành số âm trên màn hình", () => {
    expect(preparationPendingCancellationLabel({ pendingCancellation: { quantity: -4 } })).toBe(
      "Đang chờ duyệt hủy 0 phần",
    )
    expect(preparationPendingCancellationLabel({ pendingCancellation: { quantity: Number.NaN } })).toBe(
      "Đang chờ duyệt hủy 0 phần",
    )
  })
})

/**
 * L3-E — ngưỡng chờ.
 *
 * Tám phút là lúc Phục vụ bắt đầu bị khách hỏi, mười hai phút là lúc khách bỏ
 * đi. Biên phải chính xác, vì một phiếu 8 phút không được đọc như một phiếu vừa
 * vào.
 */
describe("L3 — cảnh báo thời gian chờ", () => {
  it("ngưỡng là hằng tập trung, không rải trong component", () => {
    expect(PREPARATION_WAIT_WARNING_SECONDS).toBe(8 * 60)
    expect(PREPARATION_WAIT_CRITICAL_SECONDS).toBe(12 * 60)
  })

  it.each([
    [0, "normal"],
    [59, "normal"],
    [7 * 60 + 59, "normal"],
    [8 * 60, "warning"],
    [8 * 60 + 1, "warning"],
    [11 * 60 + 59, "warning"],
    [12 * 60, "critical"],
    [30 * 60, "critical"],
  ])("chờ %i giây là %s", (seconds, tone) => {
    expect(preparationWaitTone(seconds)).toBe(tone)
  })

  it("thời gian âm hoặc không phải số được clamp về bình thường", () => {
    expect(preparationWaitTone(-60)).toBe("normal")
    expect(preparationWaitTone(Number.NaN)).toBe("normal")
    expect(preparationWaitLabel(-60)).toBe("< 1 phút")
    expect(preparationWaitAccessibleLabel(-60)).toBe("Chờ < 1 phút")
  })

  it("nhãn ngắn đếm phút tròn xuống", () => {
    expect(preparationWaitLabel(30)).toBe("< 1 phút")
    expect(preparationWaitLabel(119)).toBe("1 phút")
    expect(preparationWaitLabel(14 * 60)).toBe("14 phút")
  })

  it("accessible label nói rõ mức độ, không để màu làm tín hiệu duy nhất", () => {
    expect(preparationWaitAccessibleLabel(3 * 60)).toBe("Chờ 3 phút")
    expect(preparationWaitAccessibleLabel(9 * 60)).toBe("Chờ 9 phút, cần chú ý")
    expect(preparationWaitAccessibleLabel(14 * 60)).toBe("Chờ 14 phút, quá lâu")
  })

  it("critical ưu tiên hơn warning", () => {
    expect(preparationWaitTone(PREPARATION_WAIT_CRITICAL_SECONDS)).toBe("critical")
    expect(preparationWaitAccessibleLabel(PREPARATION_WAIT_CRITICAL_SECONDS)).toContain("quá lâu")
    expect(preparationWaitAccessibleLabel(PREPARATION_WAIT_CRITICAL_SECONDS)).not.toContain("cần chú ý")
  })
})

/**
 * L3-F — loading, rỗng và refetch nền.
 *
 * Bốn cột trống lúc chưa có dữ liệu đọc đúng như "không có đơn nào" — và một
 * quầy tin điều đó sẽ ngồi chờ trong khi phiếu đang nằm ở server.
 */
describe("L3 — trạng thái màn hình", () => {
  it("lần tải đầu là loading, không phải rỗng", () => {
    expect(preparationQueueViewState({ hasSnapshot: false, ticketCount: 0 })).toBe("loading")
  })

  it("tải xong mà không có phiếu thì có empty state tổng", () => {
    expect(preparationQueueViewState({ hasSnapshot: true, ticketCount: 0 })).toBe("empty")
    expect(PREPARATION_EMPTY_QUEUE_TEXT).toBe("Chưa có phiếu đang chờ.")
  })

  it("refetch nền giữ snapshot cũ, màn hình không nháy về loading", () => {
    expect(preparationQueueViewState({ hasSnapshot: true, ticketCount: 4 })).toBe("tickets")
  })
})

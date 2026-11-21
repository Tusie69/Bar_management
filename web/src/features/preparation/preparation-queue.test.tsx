import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { PreparationTicketCard } from "./preparation-ticket-card"
import type { PreparationStationCode } from "./preparation-presentation"
import type { PreparationTicket } from "./preparation-queue-data"

type PreparationLine = PreparationTicket["lines"][number]

function line(overrides: Partial<PreparationLine> = {}): PreparationLine {
  return {
    lineNo: 1,
    itemName: "Nước suối",
    variantDisplayName: "Chai",
    quantity: 1,
    cancelledQuantity: 0,
    originalQuantity: 1,
    note: null,
    pendingCancellation: null,
    ...overrides,
  }
}

function ticket(overrides: Partial<PreparationTicket> = {}): PreparationTicket {
  return {
    ticketId: 1,
    orderId: 2,
    visitId: 3,
    visitSequence: 4,
    station: "BAR",
    status: "SUBMITTED",
    version: 1,
    submittedAt: "2026-11-22T10:00:00.000Z",
    acceptedAt: null,
    startedAt: null,
    readyAt: null,
    collectedAt: null,
    waitSeconds: 999,
    tableCodes: ["A1"],
    orderedByDisplayName: "Nhân viên",
    guestFlags: { vip: false, birthday: false, designated: false },
    lines: [line()],
    ...overrides,
  }
}

function renderTicket(
  value: PreparationTicket,
  now: Date,
  options: { station?: PreparationStationCode; canTransition?: boolean; canRetry?: boolean } = {},
): string {
  return renderToString(
    createElement(PreparationTicketCard, {
      ticket: value,
      station: options.station ?? "BAR",
      now,
      canTransition: options.canTransition ?? false,
      canRetry: options.canRetry ?? false,
      pending: false,
      onTransition: () => undefined,
      onRetry: () => undefined,
    }),
  )
}

const NOW = new Date("2026-11-22T10:03:00.000Z")

describe("phiếu trong hàng đợi", () => {
  it("UI tính lại nhãn chờ từ current time, không giữ waitSeconds của snapshot", () => {
    const value = ticket()
    const first = renderTicket(value, new Date("2026-11-22T10:00:30.000Z"))
    const afterTick = renderTicket(value, NOW)
    expect(first).toContain("&lt; 1 phút")
    expect(first).not.toContain("16 phút")
    expect(afterTick).toContain("3 phút")
  })

  it("dòng hủy toàn bộ có class tách đúng", () => {
    const html = renderTicket(ticket({ lines: [line({ quantity: 0, cancelledQuantity: 1 })] }), NOW)
    expect(html).toContain("opacity-60")
    expect(html).toContain("line-through")
    expect(html).not.toContain("first:pt-0opacity-60")
    expect(html).not.toContain("text-smline-through")
  })
})

/** L3-A — nhãn hành động đi theo quầy, status gửi API thì không. */
describe("L3 — card theo ngôn ngữ quầy", () => {
  it("BAR dùng nhãn Bartender trên nút hành động", () => {
    const accepted = renderTicket(ticket({ status: "ACCEPTED" }), NOW, { canTransition: true })
    const ready = renderTicket(ticket({ status: "READY" }), NOW, { canTransition: true })
    expect(accepted).toContain("Bắt đầu pha")
    expect(ready).toContain("Đã bàn giao món")
  })

  it("KITCHEN giữ nhãn Bếp trên cùng một card", () => {
    const accepted = renderTicket(ticket({ status: "ACCEPTED" }), NOW, {
      station: "KITCHEN",
      canTransition: true,
    })
    const ready = renderTicket(ticket({ status: "READY" }), NOW, { station: "KITCHEN", canTransition: true })
    expect(accepted).toContain("Bắt đầu làm")
    expect(accepted).not.toContain("Bắt đầu pha")
    expect(ready).toContain("Đã nhận món")
  })

  it("không có quyền chuyển trạng thái thì không có nút nào", () => {
    const html = renderTicket(ticket({ status: "ACCEPTED" }), NOW)
    expect(html).not.toContain("Bắt đầu pha")
  })
})

/** L3-B — quầy đọc được phiếu này của bàn nào, đơn thứ mấy, ai gọi, lúc nào. */
describe("L3 — metadata trên card", () => {
  it("hiện bàn, số đơn, giờ gọi và người gọi", () => {
    const html = renderTicket(
      ticket({
        visitSequence: 2,
        tableCodes: ["B21"],
        submittedAt: "2026-11-22T14:44:00.000Z",
        orderedByDisplayName: "Minh",
      }),
      new Date("2026-11-22T14:47:00.000Z"),
    )
    expect(html).toContain("B21")
    expect(html).toContain("Đơn 2 · gọi lúc 21:44 · Minh")
  })

  it("timestamp lỗi hiện — thay vì làm vỡ card", () => {
    const html = renderTicket(ticket({ submittedAt: "không-phải-ngày", waitSeconds: 120 }), NOW)
    expect(html).toContain("gọi lúc —")
    expect(html).not.toContain("NaN")
    expect(html).toContain("2 phút")
  })

  it("không hiện Phiên # như thông tin chính, chỉ giữ visitId để debug", () => {
    const html = renderTicket(ticket({ visitId: 77 }), NOW)
    expect(html).not.toContain("Phiên #")
    expect(html).toContain('data-visit-id="77"')
  })

  it("card không bao giờ mang tên khách, số điện thoại hay ghi chú booking", () => {
    const html = renderTicket(
      ticket({
        guestFlags: { vip: true, birthday: true, designated: true },
        orderedByDisplayName: "Minh",
      }),
      NOW,
    )
    expect(html).not.toContain("Khách")
    expect(html).not.toContain("09")
    expect(html).not.toContain("Ghi chú đặt bàn")
  })

  it("tên món dài và nhiều bàn vẫn wrap chứ không đẩy ngang", () => {
    const html = renderTicket(
      ticket({
        tableCodes: ["B21", "B22", "B23", "B24"],
        lines: [line({ itemName: "Cocktail signature nền rum ủ thùng sồi kèm siro quế nhà làm" })],
      }),
      NOW,
    )
    expect(html).toContain("break-words")
    expect(html).toContain("min-w-0")
  })
})

/** L3-C — cờ vận hành trên card. */
describe("L3 — cờ vận hành trên card", () => {
  it("cờ true render badge có chữ", () => {
    const html = renderTicket(ticket({ guestFlags: { vip: true, birthday: false, designated: true } }), NOW)
    expect(html).toContain("VIP")
    expect(html).toContain("Chỉ định")
    expect(html).not.toContain("Sinh nhật")
    expect(html).toContain('data-flag="vip"')
  })

  it("ba cờ false không render vùng badge nào", () => {
    const html = renderTicket(ticket(), NOW)
    expect(html).not.toContain("Cờ vận hành")
    expect(html).not.toContain("data-flag=")
  })
})

/**
 * L3-D — hủy đã duyệt và hủy đang chờ duyệt trên cùng một phiếu.
 *
 * Hai trạng thái này nói hai việc khác nhau: một phần đã bị hủy và không phải
 * làm, một phần vẫn đang phải làm cho tới khi có người duyệt. Nếu card trộn
 * chúng lại, quầy sẽ dừng pha phần chưa ai duyệt hủy.
 */
describe("L3 — hủy chờ duyệt trên card", () => {
  it("pendingCancellation null thì không có cảnh báo", () => {
    const html = renderTicket(ticket(), NOW)
    expect(html).not.toContain("Đang chờ duyệt hủy")
  })

  it("pendingCancellation hiện đúng số phần và có role status", () => {
    const html = renderTicket(
      ticket({ lines: [line({ quantity: 3, pendingCancellation: { cancellationId: 9, quantity: 2 } })] }),
      NOW,
    )
    expect(html).toContain("Đang chờ duyệt hủy 2 phần")
    expect(html).toContain('role="status"')
    expect(html).toContain("text-destructive")
    expect(html).toContain('data-pending-cancellation="true"')
  })

  it("pending không khóa phiếu và không làm mất nút chuyển trạng thái", () => {
    const html = renderTicket(
      ticket({
        status: "ACCEPTED",
        lines: [
          line({ quantity: 3, pendingCancellation: { cancellationId: 9, quantity: 2 } }),
          line({ lineNo: 2, itemName: "Gin tonic", quantity: 1 }),
        ],
      }),
      NOW,
      { canTransition: true },
    )
    expect(html).toContain("Bắt đầu pha")
    expect(html).not.toContain('disabled=""')
    // Dòng còn lại vẫn hiển thị bình thường.
    expect(html).toContain("Gin tonic")
  })

  it("hủy một phần đã duyệt vẫn hiện số còn phải làm và số đã hủy", () => {
    const html = renderTicket(
      ticket({ lines: [line({ quantity: 1, cancelledQuantity: 1, originalQuantity: 2 })] }),
      NOW,
    )
    expect(html).toContain("Đã hủy 1, chỉ làm 1")
    expect(html).toContain('data-cancelled="partial"')
    expect(html).not.toContain("line-through")
  })

  it("hủy toàn bộ đã duyệt vẫn gạch và làm mờ dòng", () => {
    const html = renderTicket(
      ticket({ lines: [line({ quantity: 0, cancelledQuantity: 2, originalQuantity: 2 })] }),
      NOW,
    )
    expect(html).toContain("Đã hủy toàn bộ, không làm")
    expect(html).toContain('data-cancelled="all"')
    expect(html).toContain("opacity-60")
    expect(html).toContain("line-through")
  })

  it("một dòng vừa có phần đã duyệt hủy vừa có yêu cầu mới thì đọc được cả hai", () => {
    const html = renderTicket(
      ticket({
        lines: [
          line({
            quantity: 2,
            cancelledQuantity: 1,
            originalQuantity: 4,
            pendingCancellation: { cancellationId: 11, quantity: 1 },
          }),
        ],
      }),
      NOW,
    )
    expect(html).toContain("Đã hủy 1, chỉ làm 2")
    expect(html).toContain("Đang chờ duyệt hủy 1 phần")
    expect(html).toContain('data-cancelled="partial"')
    expect(html).toContain('data-pending-cancellation="true"')
  })
})

/** L3-E — tone chờ xuất hiện trên card, kèm nhãn chữ cho screen reader. */
describe("L3 — tone chờ trên card", () => {
  const submittedAt = "2026-11-22T10:00:00.000Z"

  it.each([
    ["2026-11-22T10:07:59.000Z", "normal", "Chờ 7 phút"],
    ["2026-11-22T10:08:00.000Z", "warning", "Chờ 8 phút, cần chú ý"],
    ["2026-11-22T10:11:59.000Z", "warning", "Chờ 11 phút, cần chú ý"],
    ["2026-11-22T10:12:00.000Z", "critical", "Chờ 12 phút, quá lâu"],
  ])("lúc %s card ở tone %s", (nowIso, tone, accessibleLabel) => {
    const html = renderTicket(ticket({ submittedAt }), new Date(nowIso))
    expect(html).toContain(`data-wait-tone="${tone}"`)
    expect(html).toContain(accessibleLabel)
  })
})

/** L3-G — hồi quy: nút in lại chỉ xuất hiện khi được phép. */
describe("L3 — hồi quy card", () => {
  it("không có quyền/không có máy in thì không có nút in lại", () => {
    expect(renderTicket(ticket(), NOW)).not.toContain("Yêu cầu in lại")
    expect(renderTicket(ticket(), NOW, { canRetry: true })).toContain("Yêu cầu in lại")
  })
})

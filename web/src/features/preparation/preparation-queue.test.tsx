import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { PreparationTicketCard } from "./preparation-ticket-card"
import type { PreparationQueueFilter, PreparationStationCode } from "./preparation-presentation"
import { PreparationQueueFilterBar } from "./preparation-queue"
import type { PreparationTicket } from "./preparation-queue-data"
import type { PreparationAggregateItem } from "./preparation-totals"
import { PreparationTotalsPanel } from "./preparation-totals-panel"

type PreparationLine = PreparationTicket["lines"][number]

function line(overrides: Partial<PreparationLine> = {}): PreparationLine {
  return {
    lineNo: 1,
    itemName: "Nước suối",
    variantDisplayName: "Chai",
    menuItemVariantId: 101,
    unitCode: "BOTTLE",
    quantity: 1,
    cancelledQuantity: 0,
    originalQuantity: 1,
    doneQuantity: 0,
    progressVersion: 0,
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
  options: {
    station?: PreparationStationCode
    canTransition?: boolean
    canRetry?: boolean
    draggable?: boolean
    revertable?: boolean
  } = {},
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
      onProgress: () => undefined,
      ...(options.revertable ? { onRevert: () => undefined } : {}),
      ...(options.draggable ? { onDragHandlePointerDown: () => undefined } : {}),
    }),
  )
}

const NOW = new Date("2026-11-22T10:03:00.000Z")

describe("tiến độ theo số lượng", () => {
  it("hiện done/total và stepper chỉ khi phiếu đang được xử lý", () => {
    const html = renderTicket(
      ticket({ status: "PREPARING", lines: [line({ quantity: 3, doneQuantity: 1, progressVersion: 2 })] }),
      NOW,
      { canTransition: true },
    )
    expect(html).toContain("Đã làm <!-- -->1<!-- -->/<!-- -->3")
    expect(html).toContain("Tăng số đã làm của Nước suối")
    expect(html).toContain("Giảm số đã làm của Nước suối")
    expect(html).toContain("1 dòng chưa đủ số lượng")
    expect(html).toContain("Bạn vẫn có thể báo xong")
    const warningId = "preparation-ticket-1-incomplete-warning"
    expect(html).toContain(`id="${warningId}"`)
    expect(html).toContain(`aria-describedby="${warningId}"`)
    const headerEnd = html.indexOf("</header>")
    const warningIdx = html.indexOf(warningId)
    const actionsIdx = html.indexOf("data-ticket-actions")
    expect(warningIdx).toBeGreaterThan(-1)
    expect(warningIdx).toBeLessThan(actionsIdx)
    expect(actionsIdx).toBeLessThan(headerEnd)
  })

  it("không hiện stepper khi chưa nhận phiếu và không cảnh báo khi đã đủ", () => {
    const submitted = renderTicket(ticket(), NOW, { canTransition: true })
    expect(submitted).toContain("Đã làm <!-- -->0<!-- -->/<!-- -->1")
    expect(submitted).not.toContain("Cập nhật tiến độ")
    const complete = renderTicket(
      ticket({ status: "PREPARING", lines: [line({ doneQuantity: 1, progressVersion: 1 })] }),
      NOW,
      { canTransition: true },
    )
    expect(complete).not.toContain("chưa đủ số lượng")
    expect(complete).not.toContain("aria-describedby")
  })
})

function renderFilterBar(input: {
  filter: PreparationQueueFilter
  totalCount: number
  visibleCount: number
  hiddenCount: number
  hiddenCriticalCount: number
}): string {
  return renderToString(createElement(PreparationQueueFilterBar, { ...input, onFilterChange: () => undefined }))
}

function aggregateItem(overrides: Partial<PreparationAggregateItem> = {}): PreparationAggregateItem {
  return {
    menuItemVariantId: 987654,
    itemName: "Negroni",
    variantDisplayName: "Ly",
    unitCode: "GLASS",
    quantity: 5,
    notedLineCount: 0,
    pendingCancellationQuantity: 0,
    ...overrides,
  }
}

function renderTotalsPanel(station: PreparationStationCode, items: readonly PreparationAggregateItem[]): string {
  return renderToString(createElement(PreparationTotalsPanel, { station, items }))
}

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
      ticket({
        lines: [line({ quantity: 3, pendingCancellation: { cancellationId: 9, quantity: 2, groupId: null } })],
      }),
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
          line({ quantity: 3, pendingCancellation: { cancellationId: 9, quantity: 2, groupId: null } }),
          line({ lineNo: 2, itemName: "Gin tonic", quantity: 1 }),
        ],
      }),
      NOW,
      { canTransition: true },
    )
    expect(html).toContain("Bắt đầu pha")
    expect(html.match(/<button[^>]*>Bắt đầu pha<\/button>/)?.[0]).not.toContain('disabled=""')
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
            pendingCancellation: { cancellationId: 11, quantity: 1, groupId: 11 },
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

  it("group phủ toàn bộ phần Bar hiện banner nhưng không khóa transition", () => {
    const html = renderTicket(
      ticket({
        status: "ACCEPTED",
        lines: [line({ pendingCancellation: { cancellationId: 901, quantity: 1, groupId: 77 } })],
      }),
      NOW,
      { canTransition: true },
    )
    expect(html).toContain("Toàn bộ phần Bar của phiếu đang chờ duyệt hủy theo đơn.")
    expect(html).toContain("1 dòng · 1 phần đang chờ duyệt.")
    expect(html).toContain("Thuộc yêu cầu hủy theo đơn")
    expect(html).toContain('data-grouped-cancellation="all"')
    expect(html).toContain("Bắt đầu pha")
    expect(html.match(/<button[^>]*>Bắt đầu pha<\/button>/)?.[0]).not.toContain('disabled=""')
    expect(html).not.toContain("901")
    expect(html).not.toContain("77")
  })

  it("group chỉ phủ một phần dùng wording station và báo pending riêng song song", () => {
    const lines = [
      line({ pendingCancellation: { cancellationId: 1, quantity: 1, groupId: 10 } }),
      line({
        lineNo: 2,
        pendingCancellation: { cancellationId: 2, quantity: 1, groupId: null },
      }),
    ]
    const bar = renderTicket(ticket({ lines }), NOW)
    const kitchen = renderTicket(ticket({ station: "KITCHEN", lines }), NOW, { station: "KITCHEN" })
    expect(bar).toContain("Một phần phiếu Bar thuộc yêu cầu hủy theo đơn đang chờ duyệt.")
    expect(kitchen).toContain("Một phần phiếu Bếp thuộc yêu cầu hủy theo đơn đang chờ duyệt.")
    expect(bar).toContain("Phiếu này đồng thời có yêu cầu hủy riêng từng món.")
    expect(bar).toContain('data-grouped-cancellation="partial"')
  })

  it("chỉ pending riêng không tạo banner hoặc nhãn group", () => {
    const html = renderTicket(
      ticket({ lines: [line({ pendingCancellation: { cancellationId: 3, quantity: 1, groupId: null } })] }),
      NOW,
    )
    expect(html).toContain("Đang chờ duyệt hủy 1 phần")
    expect(html).not.toContain("Yêu cầu hủy theo đơn đang chờ duyệt")
    expect(html).not.toContain("Thuộc yêu cầu hủy theo đơn")
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

describe("BT-07 — controls bộ lọc", () => {
  it("snapshot thật sự rỗng không render filter controls", () => {
    expect(
      renderFilterBar({ filter: "all", totalCount: 0, visibleCount: 0, hiddenCount: 0, hiddenCriticalCount: 0 }),
    ).toBe("")
  })

  it("mặc định all là lựa chọn duy nhất được nhấn và chưa có dải nhắc", () => {
    const html = renderFilterBar({
      filter: "all",
      totalCount: 5,
      visibleCount: 5,
      hiddenCount: 0,
      hiddenCriticalCount: 0,
    })
    expect(html).toContain('aria-label="Lọc hàng đợi"')
    expect(html).not.toContain('aria-label="Bộ lọc hàng đợi"')
    expect(html).toContain('aria-pressed="true">Tất cả')
    expect(html).toContain('aria-pressed="false">VIP')
    expect(html).toContain('aria-pressed="false">Chỉ định')
    expect(html).not.toContain("phiếu bị ẩn")
  })

  it("filter hiện số bị ẩn, số critical và nút Xem tất cả trong flow mobile", () => {
    const html = renderFilterBar({
      filter: "vip",
      totalCount: 5,
      visibleCount: 2,
      hiddenCount: 3,
      hiddenCriticalCount: 1,
    })
    expect(html).toContain("Đang lọc VIP — 3 phiếu bị ẩn.")
    expect(html).toContain("1 phiếu bị ẩn đã chờ quá lâu.")
    expect(html).toContain("Xem tất cả")
    expect(html).toContain("flex-col")
    expect(html).toContain("min-h-11")
  })

  it("không có ticket khớp filter dùng empty state riêng, không dùng empty queue", () => {
    const html = renderFilterBar({
      filter: "designated",
      totalCount: 4,
      visibleCount: 0,
      hiddenCount: 4,
      hiddenCriticalCount: 2,
    })
    expect(html).toContain("Không có phiếu nào khớp bộ lọc.")
    expect(html).not.toContain("Chưa có phiếu đang chờ.")
    expect(html).toContain("Xem tất cả")
  })
})

describe("BT-11 — panel tổng món", () => {
  it("BAR có title và empty text đúng", () => {
    const html = renderTotalsPanel("BAR", [])
    expect(html).toContain("Tổng món đang chờ pha")
    expect(html).toContain("Không còn món đang chờ pha.")
  })

  it("KITCHEN có title và empty text đúng, không dùng chữ pha", () => {
    const html = renderTotalsPanel("KITCHEN", [])
    expect(html).toContain("Tổng món đang chờ làm")
    expect(html).toContain("Không còn món đang chờ làm.")
    expect(html).not.toContain("chờ pha")
  })

  it("không render raw identity hoặc unit code", () => {
    const html = renderTotalsPanel("BAR", [aggregateItem({ menuItemVariantId: 987654, unitCode: "BOTTLE" })])
    expect(html).not.toContain("987654")
    expect(html).not.toContain("BOTTLE")
    expect(html).toContain("Negroni")
  })

  it("mặc định mở trên SSR/desktop, hiện tổng số phần, mô tả toàn queue và header đủ target 44px", () => {
    const html = renderTotalsPanel("BAR", [
      aggregateItem({ quantity: 5 }),
      aggregateItem({ menuItemVariantId: 2, quantity: 3 }),
    ])
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain("8 phần")
    expect(html).toContain("Tính trên toàn bộ hàng đợi, không phụ thuộc bộ lọc.")
    expect(html).toContain("min-h-11")
  })

  it("nút hành động chính của phiếu nằm trong header phía trước danh sách món", () => {
    const html = renderTicket(ticket({ status: "SUBMITTED" }), NOW, { canTransition: true })
    const headerEnd = html.indexOf("</header>")
    const actionIdx = html.indexOf("Tiếp nhận")
    const listIdx = html.indexOf('aria-label="Món trên phiếu"')
    expect(actionIdx).toBeGreaterThan(-1)
    expect(actionIdx).toBeLessThan(headerEnd)
    expect(headerEnd).toBeLessThan(listIdx)
  })

  it("danh sách có list semantics và vùng cuộn dọc giới hạn chiều cao", () => {
    const html = renderTotalsPanel("BAR", [aggregateItem()])
    expect(html).toContain("<ul")
    expect(html).toContain("<li")
    expect(html).toContain("max-h-72")
    expect(html).toContain("overflow-y-auto")
  })

  it("hiện noted-line label số ít và số nhiều", () => {
    const html = renderTotalsPanel("BAR", [
      aggregateItem({ menuItemVariantId: 1, notedLineCount: 1 }),
      aggregateItem({ menuItemVariantId: 2, notedLineCount: 3 }),
    ])
    expect(html).toContain("1 dòng có ghi chú")
    expect(html).toContain("3 dòng có ghi chú")
  })

  it("hiện pending cancellation quantity nhưng không lộ cancellation ID hoặc group ID", () => {
    const html = renderTotalsPanel("BAR", [aggregateItem({ quantity: 5, pendingCancellationQuantity: 2 })])
    expect(html).toContain("5×")
    expect(html).toContain("2 phần đang chờ duyệt hủy")
    expect(html).not.toContain("cancellationId")
    expect(html).not.toContain("groupId")
  })

  it("không render note hoặc pending label khi count bằng 0", () => {
    const html = renderTotalsPanel("BAR", [aggregateItem()])
    expect(html).not.toContain("dòng có ghi chú")
    expect(html).not.toContain("phần đang chờ duyệt hủy")
  })
})

describe("kéo thả và lùi một bước", () => {
  it("thẻ có tay nắm kéo khi màn hình cho kéo", () => {
    const html = renderTicket(ticket({ status: "ACCEPTED", version: 2 }), NOW, {
      canTransition: true,
      draggable: true,
    })
    expect(html).toContain("Kéo phiếu A1 sang cột khác")
  })

  it("không có tay nắm khi phiên không được đổi trạng thái", () => {
    const html = renderTicket(ticket({ status: "ACCEPTED" }), NOW, { canTransition: false })
    expect(html).not.toContain("sang cột khác")
  })

  it("nút lùi chỉ có ở hai bước giữa", () => {
    for (const status of ["ACCEPTED", "PREPARING"] as const) {
      const html = renderTicket(ticket({ status }), NOW, { canTransition: true, revertable: true })
      expect(html, status).toContain("Lùi phiếu về bước trước")
    }
    // Mới nhận thì không có bước nào để lùi; Hoàn thành thì đã bắn thông báo
    // ra ngoài quầy, nên cả hai đều không có nút.
    for (const status of ["SUBMITTED", "READY"] as const) {
      const html = renderTicket(ticket({ status }), NOW, { canTransition: true, revertable: true })
      expect(html, status).not.toContain("Lùi phiếu về bước trước")
    }
  })
})

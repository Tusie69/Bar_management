import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { VisitBill } from "@/features/waiter-menu/waiter-order-api"
import { formatVatRate, VisitBillBody } from "./waiter-bill-sheet"

function bill(overrides: Partial<VisitBill> = {}): VisitBill {
  return {
    visitId: 1,
    tableCodes: ["A7", "A6"],
    orderCount: 3,
    lines: [
      {
        itemName: "VỎ ỐC THÌ THẦM",
        variantDisplayName: "Ly",
        note: "Ít đá",
        quantity: 2,
        unitPriceVnd: 280_000,
        amountVnd: 560_000,
      },
      {
        itemName: "KHOAI TÂY CHIÊN",
        variantDisplayName: "Phần",
        note: null,
        quantity: 1,
        unitPriceVnd: 120_000,
        amountVnd: 120_000,
      },
    ],
    subtotalVnd: 680_000,
    vatRateBasisPoints: 1000,
    vatVnd: 68_000,
    totalVnd: 748_000,
    printedAt: "2026-11-22T16:45:00.000Z",
    ...overrides,
  }
}

describe("formatVatRate", () => {
  it("dựng nhãn từ điểm cơ bản, không hard-code 10%", () => {
    expect(formatVatRate(1000)).toBe("10%")
    expect(formatVatRate(800)).toBe("8%")
    expect(formatVatRate(1050)).toBe("10,5%")
  })
})

describe("VisitBillBody", () => {
  it("hiện đủ ba dòng tiền của mockup P13", () => {
    const html = renderToStaticMarkup(createElement(VisitBillBody, { bill: bill() }))
    expect(html).toContain("Tạm tính")
    expect(html).toContain("680.000đ")
    expect(html).toContain("VAT 10%")
    expect(html).toContain("68.000đ")
    expect(html).toContain("Khách cần trả")
    expect(html).toContain("748.000đ")
  })

  it("thuế suất đổi thì nhãn đổi theo", () => {
    const html = renderToStaticMarkup(
      createElement(VisitBillBody, { bill: bill({ vatRateBasisPoints: 800, vatVnd: 54_400, totalVnd: 734_400 }) }),
    )
    expect(html).toContain("VAT 8%")
    expect(html).not.toContain("VAT 10%")
  })

  /**
   * "Bill" là từ khách hiểu là "xong rồi". Màn phải nói ngược lại, nếu không
   * Phục vụ đưa tờ này ra và khách tưởng không gọi thêm được nữa.
   */
  it("nói rõ bàn vẫn đang dùng và gọi thêm được", () => {
    const html = renderToStaticMarkup(createElement(VisitBillBody, { bill: bill() }))
    expect(html).toContain("tạm tính")
    expect(html).toContain("gọi thêm được")
  })

  it("bàn chưa gọi gì không phải một lỗi", () => {
    const html = renderToStaticMarkup(
      createElement(VisitBillBody, {
        bill: bill({ lines: [], orderCount: 0, subtotalVnd: 0, vatVnd: 0, totalVnd: 0 }),
      }),
    )
    expect(html).toContain("chưa gọi món nào")
    expect(html).not.toContain("NaN")
  })

  it("mang mã bàn, số đơn và giờ in", () => {
    const html = renderToStaticMarkup(createElement(VisitBillBody, { bill: bill() }))
    expect(html).toContain("A7 + A6")
    expect(html).toContain("3 đơn")
    expect(html).toContain("Ít đá")
  })
})

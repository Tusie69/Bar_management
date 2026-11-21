import { describe, expect, it } from "vitest"
import type { WaiterVisitItem } from "@/features/waiter-menu/waiter-order-api"
import {
  MAX_REORDER_PER_ITEM,
  addReorder,
  removeReorder,
  reorderBlockedReason,
  reorderItemCount,
  reorderKey,
  reorderLines,
  reorderPayload,
  reorderPriceChange,
  reorderSummary,
  reorderTotalVnd,
} from "./reorder-model"

function item(overrides: Partial<WaiterVisitItem> = {}): WaiterVisitItem {
  return {
    variantId: 501,
    menuItemId: 90,
    itemName: "VỎ ỐC THÌ THẦM",
    variantDisplayName: "Ly",
    unitCode: "GLASS",
    preparationStation: "BAR",
    note: null,
    quantity: 2,
    unitPriceVnd: 280_000,
    totalVnd: 560_000,
    reorder: { priceId: 11, priceVersion: 3, amountVnd: 280_000 },
    ...overrides,
  }
}

describe("reorderKey", () => {
  /**
   * Hai ly cùng món, một ly ít đá, là hai dòng khác nhau trên phiếu Bar. Gộp
   * chúng lại thì một trong hai lời nhắn biến mất trên đường tới quầy.
   */
  it("cùng món khác ghi chú là hai khoá khác nhau", () => {
    expect(reorderKey(item({ note: null }))).not.toBe(reorderKey(item({ note: "Ít đá" })))
  })

  it("cùng món khác giá lúc gọi là hai khoá khác nhau", () => {
    expect(reorderKey(item({ unitPriceVnd: 280_000 }))).not.toBe(reorderKey(item({ unitPriceVnd: 300_000 })))
  })
})

describe("addReorder / removeReorder", () => {
  it("mỗi lần bấm + là thêm một phần", () => {
    const line = item()
    let draft = addReorder({}, line)
    draft = addReorder(draft, line)
    expect(draft[reorderKey(line)]).toBe(2)
  })

  it("bớt về 0 thì bỏ hẳn khoá, giỏ rỗng là object rỗng", () => {
    const line = item()
    const draft = removeReorder(addReorder({}, line), line)
    expect(draft).toEqual({})
  })

  it("không vượt trần mỗi món", () => {
    const line = item()
    let draft: Record<string, number> = {}
    for (let index = 0; index < MAX_REORDER_PER_ITEM + 5; index += 1) draft = { ...addReorder(draft, line) }
    expect(draft[reorderKey(line)]).toBe(MAX_REORDER_PER_ITEM)
  })

  it("món không còn bán thì bấm + không làm gì", () => {
    const sold = item({ reorder: null })
    expect(addReorder({}, sold)).toEqual({})
  })
})

describe("reorderBlockedReason / reorderPriceChange", () => {
  it("nói lý do trước khi người dùng bấm", () => {
    expect(reorderBlockedReason(item())).toBeNull()
    expect(reorderBlockedReason(item({ reorder: null }))).toContain("không còn bán")
  })

  it("giá đổi thì nói ra, giá y như cũ thì im", () => {
    expect(reorderPriceChange(item())).toBeNull()
    expect(reorderPriceChange(item({ reorder: { priceId: 11, priceVersion: 4, amountVnd: 300_000 } }))).toEqual({
      from: 280_000,
      to: 300_000,
    })
  })
})

describe("giỏ gọi thêm", () => {
  const ốc = item()
  const khoai = item({
    variantId: 777,
    menuItemId: 91,
    itemName: "KHOAI TÂY CHIÊN",
    variantDisplayName: "Phần",
    preparationStation: "KITCHEN",
    note: "Ít cay",
    unitPriceVnd: 120_000,
    reorder: { priceId: 44, priceVersion: 1, amountVnd: 120_000 },
  })

  it("dòng giỏ theo đúng thứ tự món trên màn", () => {
    const draft = addReorder(addReorder(addReorder({}, khoai), ốc), ốc)
    const lines = reorderLines(draft, [ốc, khoai])
    expect(lines.map((line) => line.item.itemName)).toEqual(["VỎ ỐC THÌ THẦM", "KHOAI TÂY CHIÊN"])
    expect(reorderItemCount(lines)).toBe(3)
  })

  /** Tổng phải theo giá HIỆN TẠI: đó là số máy chủ sẽ tính. */
  it("tổng tính theo giá hiện tại, không theo giá lúc gọi", () => {
    const tăngGiá = item({ reorder: { priceId: 11, priceVersion: 4, amountVnd: 300_000 } })
    const lines = reorderLines(addReorder(addReorder({}, tăngGiá), tăngGiá), [tăngGiá])
    expect(reorderTotalVnd(lines)).toBe(600_000)
  })

  it("câu tóm tắt mang đơn vị và ghi chú", () => {
    const lines = reorderLines(addReorder(addReorder({}, ốc), khoai), [ốc, khoai])
    expect(reorderSummary(lines)).toBe("1× VỎ ỐC THÌ THẦM (Ly) · 1× KHOAI TÂY CHIÊN (Phần · Ít cay)")
  })
})

describe("reorderPayload", () => {
  it("gửi mã giá HIỆN TẠI, không gửi mã giá của dòng đơn cũ", () => {
    const tăngGiá = item({ reorder: { priceId: 99, priceVersion: 7, amountVnd: 300_000 } })
    const lines = reorderLines(addReorder({}, tăngGiá), [tăngGiá])
    const payload = reorderPayload({ visitId: 9001, idempotencyKey: "abc", lines })
    expect(payload.lines).toEqual([{ variantId: 501, priceId: 99, priceVersion: 7, quantity: 1 }])
  })

  it("mang theo ghi chú để Bar nhận đúng dòng", () => {
    const ítĐá = item({ note: "Ít đá" })
    const lines = reorderLines(addReorder({}, ítĐá), [ítĐá])
    expect(reorderPayload({ visitId: 1, idempotencyKey: "k", lines }).lines[0]?.note).toBe("Ít đá")
  })

  it("món không còn bán bị loại khỏi payload thay vì gửi lên rồi nhận lỗi", () => {
    const lines = [{ key: "x", item: item({ reorder: null }), quantity: 2 }]
    expect(reorderPayload({ visitId: 1, idempotencyKey: "k", lines }).lines).toEqual([])
  })
})

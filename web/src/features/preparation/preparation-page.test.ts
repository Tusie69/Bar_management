import { describe, expect, it } from "vitest"

import { roleCan } from "@/domain/access"
import {
  PREPARATION_ACTION_CLASS,
  PREPARATION_COLUMNS,
  PREPARATION_NEXT_ACTION,
  PREPARATION_QUEUE_LAYOUT_CLASS,
  canShowPrintRetry,
  preparationLineDisplay,
} from "./preparation-layout"

describe("màn hàng đợi chế biến", () => {
  it("có bốn lane, mục tiêu chạm mobile và breakpoint tablet/desktop", () => {
    expect(PREPARATION_COLUMNS.map((column) => column.label)).toEqual(["Mới nhận", "Đã tiếp nhận", "Đang làm", "Hoàn thành"])
    expect(PREPARATION_QUEUE_LAYOUT_CLASS).toContain("md:grid-cols-2")
    expect(PREPARATION_QUEUE_LAYOUT_CLASS).toContain("xl:grid-cols-4")
    expect(PREPARATION_ACTION_CLASS).toContain("min-h-11")
  })

  it("ma trận giao diện không trao chéo quyền Bar và Kitchen", () => {
    expect(roleCan("BAR", "preparation.bar.transition")).toBe(true)
    expect(roleCan("BAR", "preparation.kitchen.transition")).toBe(false)
    expect(roleCan("KITCHEN", "preparation.kitchen.transition")).toBe(true)
    expect(roleCan("KITCHEN", "preparation.bar.transition")).toBe(false)
  })

  it("READY chỉ rời queue qua acknowledgement COLLECTED", () => {
    expect(PREPARATION_NEXT_ACTION.READY).toEqual({ status: "COLLECTED", label: "Đã nhận món" })
    expect(PREPARATION_NEXT_ACTION.COLLECTED).toBeUndefined()
  })

  it("không render chức năng in giả khi worker chưa hoạt động", () => {
    expect(canShowPrintRetry(true, false)).toBe(false)
    expect(canShowPrintRetry(false, true)).toBe(false)
    expect(canShowPrintRetry(true, true)).toBe(true)
  })

  it.each([
    [360, 800, 1], [390, 844, 1], [768, 1024, 2], [1280, 800, 4],
  ])("layout %ix%i dùng đúng số lane responsive", (width, _height, columns) => {
    const actual = width >= 1280 ? 4 : width >= 768 ? 2 : 1
    expect(actual).toBe(columns)
  })
})

/**
 * L2 — con số mà Bar/Bếp hành động theo.
 *
 * Trường hợp "2× khay thịt muối" trong báo cáo kiểm thử ngày 21/11: Phục vụ gọi
 * 2 khay, xin hủy 1, Thu ngân duyệt, và phiếu Bếp vẫn ghi 2 — Bếp làm thừa một
 * khay mà không ai biết cho tới lúc tính tiền.
 */
describe("L2 — dòng phiếu sau khi có người duyệt hủy", () => {
  it("không có gì bị hủy thì hiển thị bình thường, không nhãn", () => {
    expect(preparationLineDisplay({ quantity: 2, cancelledQuantity: 0, originalQuantity: 2 })).toEqual({
      quantity: 2,
      fullyCancelled: false,
      cancelledLabel: null,
    })
  })

  it("hủy 1 trong 2 thì hiện 1× kèm nhãn nói rõ chỉ làm 1", () => {
    expect(preparationLineDisplay({ quantity: 1, cancelledQuantity: 1, originalQuantity: 2 })).toEqual({
      quantity: 1,
      fullyCancelled: false,
      cancelledLabel: "Đã hủy 1, chỉ làm 1",
    })
  })

  it("hủy 2 trong 5 thì nhãn ghi đúng cả hai con số", () => {
    expect(preparationLineDisplay({ quantity: 3, cancelledQuantity: 2, originalQuantity: 5 })).toEqual({
      quantity: 3,
      fullyCancelled: false,
      cancelledLabel: "Đã hủy 2, chỉ làm 3",
    })
  })

  it("hủy toàn bộ thì gạch/mờ dòng và nói thẳng là không làm", () => {
    expect(preparationLineDisplay({ quantity: 0, cancelledQuantity: 2, originalQuantity: 2 })).toEqual({
      quantity: 0,
      fullyCancelled: true,
      cancelledLabel: "Đã hủy toàn bộ, không làm",
    })
  })

  it("không bao giờ hiện số âm, kể cả khi dữ liệu vào đã sai", () => {
    // Database có CHECK `cancelled_quantity <= quantity` và cột sinh UNSIGNED,
    // nên trường hợp này không tới được từ API. Nó ở đây để một con số âm không
    // bao giờ trở thành "làm -1 món" trên màn hình của quầy.
    const display = preparationLineDisplay({ quantity: -1, cancelledQuantity: 3, originalQuantity: 2 })
    expect(display.quantity).toBe(0)
    expect(display.fullyCancelled).toBe(true)
  })

  it("nhãn hủy toàn bộ không bao giờ đọc như một việc còn phải làm", () => {
    const display = preparationLineDisplay({ quantity: 0, cancelledQuantity: 4, originalQuantity: 4 })
    expect(display.cancelledLabel).not.toContain("chỉ làm")
  })
})

import { describe, expect, it } from "vitest"

import { roleCan } from "@/domain/access"
import {
  PREPARATION_ACTION_CLASS,
  PREPARATION_COLUMNS,
  PREPARATION_NEXT_ACTION,
  PREPARATION_QUEUE_LAYOUT_CLASS,
  canShowPrintRetry,
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

/**
 * Bộ ký hiệu ghép bàn phải phủ được mọi nhóm có thể tồn tại cùng lúc.
 *
 * Trần cũ là 12 vì bộ hình có 12 hình. Quán có 23 bàn và 21 ghế bar, nên lễ
 * tân chạm trần giữa ca. Test này giữ hai con số đi cùng nhau: số hình vẽ
 * được, và số nhóm tối đa mà sơ đồ thật có thể sinh ra.
 */
import { describe, expect, it } from "vitest"
import { BAR_SEATS, TABLES } from "@/domain/venue-layout"
import {
  GROUP_SYMBOLS,
  GROUP_SYMBOL_COUNT_MAX,
  GROUP_SYMBOL_DRAWN_COUNT,
  groupSymbolPathAttributes,
  symbolByNo,
} from "./symbols"

/** Một nhóm luôn có ít nhất hai bàn, nên số nhóm cùng lúc tối đa là một nửa. */
const POSITIONS = TABLES.length + BAR_SEATS.length
const MAX_CONCURRENT_GROUPS = Math.floor(POSITIONS / 2)

describe("bộ ký hiệu ghép bàn", () => {
  it("phủ hết số nhóm có thể tồn tại cùng lúc trên sơ đồ thật", () => {
    expect(GROUP_SYMBOL_DRAWN_COUNT).toBeGreaterThanOrEqual(MAX_CONCURRENT_GROUPS)
  })

  it("số thứ tự liên tục từ 1, không trùng, không hổng", () => {
    expect(GROUP_SYMBOLS.map((symbol) => symbol.no)).toEqual(
      Array.from({ length: GROUP_SYMBOL_DRAWN_COUNT }, (_, index) => index + 1),
    )
  })

  it("mỗi ký hiệu phân biệt được: không trùng cặp (hình, kiểu) và không trùng tên", () => {
    const shapes = GROUP_SYMBOLS.map((symbol) => `${symbol.path}|${symbol.fill}`)
    expect(new Set(shapes).size).toBe(GROUP_SYMBOLS.length)
    expect(new Set(GROUP_SYMBOLS.map((symbol) => symbol.name)).size).toBe(GROUP_SYMBOLS.length)
  })

  it("nửa đầu tô đặc, nửa sau là đúng những hình đó ở dạng viền", () => {
    const half = GROUP_SYMBOL_DRAWN_COUNT / 2
    for (let index = 0; index < half; index += 1) {
      const filled = GROUP_SYMBOLS[index]
      const outlined = GROUP_SYMBOLS[index + half]
      expect(filled.fill).toBe(true)
      expect(outlined.fill).toBe(false)
      expect(outlined.path).toBe(filled.path)
      expect(outlined.name).toBe(`${filled.name} viền`)
    }
  })

  it("trần cấu hình lớn hơn số hình vẽ, để phủ cả khi mỗi bàn là một nhóm", () => {
    expect(GROUP_SYMBOL_COUNT_MAX).toBeGreaterThanOrEqual(POSITIONS)
    // Khớp `ck_venues_symbols` của migration 0035 (TINYINT UNSIGNED).
    expect(GROUP_SYMBOL_COUNT_MAX).toBe(255)
  })

  it("số vượt bộ hình trả null, để giao diện rơi về mã G##", () => {
    expect(symbolByNo(GROUP_SYMBOL_DRAWN_COUNT)).not.toBeNull()
    expect(symbolByNo(GROUP_SYMBOL_DRAWN_COUNT + 1)).toBeNull()
    expect(symbolByNo(0)).toBeNull()
    expect(symbolByNo(null)).toBeNull()
  })
})

describe("thuộc tính vẽ", () => {
  const attributesOf = (no: number) => groupSymbolPathAttributes(symbolByNo(no)!)

  it("hình đặc được tô, không có nét", () => {
    expect(attributesOf(1)).toEqual({ fill: "currentColor" })
  })

  it("hình viền ra nét, không ra khối đặc", () => {
    const outlined = attributesOf(1 + GROUP_SYMBOL_DRAWN_COUNT / 2)
    expect(outlined.fill).toBe("none")
    expect(outlined.stroke).toBe("currentColor")
    expect(outlined.strokeWidth).toBeGreaterThan(0)
  })

  it("mọi ký hiệu đều vẽ ra được một thứ nhìn thấy", () => {
    for (const symbol of GROUP_SYMBOLS) {
      const attributes = groupSymbolPathAttributes(symbol)
      expect(attributes.fill === "currentColor" || attributes.stroke === "currentColor").toBe(true)
    }
  })
})

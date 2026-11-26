import { describe, expect, it } from "vitest"
import { MAX_CASH_DIGITS, evaluateCash, formatCashInput, parseCashInput, quickTenderOptions } from "./cash-model"

/** Bill mẫu của mockup: 231.000đ, thiếu 31.000đ khi đưa 200k, thừa 69.000đ khi đưa 300k. */
const TOTAL = 231_000

describe("parseCashInput", () => {
  it("chỉ lấy chữ số — dán '250.000' vào ô nghĩa là 250000", () => {
    expect(parseCashInput("250.000")).toBe(250_000)
    expect(parseCashInput("250 000đ")).toBe(250_000)
    expect(parseCashInput("1,000,000")).toBe(1_000_000)
  })

  it("ô trống hoặc không có chữ số nào thì chưa có số", () => {
    expect(parseCashInput("")).toBeNull()
    expect(parseCashInput("   ")).toBeNull()
    expect(parseCashInput("abc")).toBeNull()
  })

  it("cắt ở 9 chữ số, đúng trần mockup", () => {
    const parsed = parseCashInput("1234567890123")
    expect(String(parsed)).toHaveLength(MAX_CASH_DIGITS)
    expect(parsed).toBe(123_456_789)
  })
})

describe("formatCashInput", () => {
  it("thêm dấu chấm nghìn kiểu Việt", () => {
    expect(formatCashInput("250000")).toBe("250.000")
    expect(formatCashInput("1000000")).toBe("1.000.000")
  })

  it("ô trống vẫn trống, không thành '0'", () => {
    expect(formatCashInput("")).toBe("")
    expect(formatCashInput("abc")).toBe("")
  })

  it("gõ thêm chữ số vào chuỗi đã định dạng không làm hỏng nó", () => {
    expect(formatCashInput("250.0005")).toBe("2.500.005")
  })
})

describe("evaluateCash — ba trạng thái của khối kết quả", () => {
  it("rỗng: nút khoá, lý do là hướng dẫn chứ không phải lỗi", () => {
    const result = evaluateCash(TOTAL, "")
    expect(result.state).toBe("EMPTY")
    expect(result.tenderedVnd).toBeNull()
    expect(result.canConfirm).toBe(false)
    expect(result.disabledReason).toBe("Nhập số tiền khách đưa")
  })

  it("thiếu: 'Còn thiếu 31.000đ', nút khoá", () => {
    const result = evaluateCash(TOTAL, "200000")
    expect(result.state).toBe("SHORT")
    expect(result.shortfallVnd).toBe(31_000)
    expect(result.changeVnd).toBe(0)
    expect(result.canConfirm).toBe(false)
    expect(result.disabledReason).toBe("Chưa đủ tiền")
  })

  it("đủ: 'Tiền thừa 69.000đ', nút mở", () => {
    const result = evaluateCash(TOTAL, "300000")
    expect(result.state).toBe("ENOUGH")
    expect(result.changeVnd).toBe(69_000)
    expect(result.shortfallVnd).toBe(0)
    expect(result.canConfirm).toBe(true)
    expect(result.disabledReason).toBeNull()
  })

  it("đưa vừa đủ: nút mở, tiền thừa 0", () => {
    const result = evaluateCash(TOTAL, "231000")
    expect(result.state).toBe("ENOUGH")
    expect(result.changeVnd).toBe(0)
    expect(result.canConfirm).toBe(true)
  })

  it("thiếu đúng 1đ vẫn là thiếu — tiền không có chỗ cho 'gần đủ'", () => {
    const result = evaluateCash(TOTAL, "230999")
    expect(result.state).toBe("SHORT")
    expect(result.shortfallVnd).toBe(1)
    expect(result.canConfirm).toBe(false)
  })

  it("nút chỉ bật ở đúng trạng thái ENOUGH", () => {
    for (const raw of ["", "0", "1", "230999"]) {
      expect(evaluateCash(TOTAL, raw).canConfirm, `"${raw}" không được bật nút`).toBe(false)
    }
    expect(evaluateCash(TOTAL, "231000").canConfirm).toBe(true)
  })
})

describe("quickTenderOptions", () => {
  it("bill 231.000đ: vừa đủ rồi tới các mức tròn lớn hơn", () => {
    expect(quickTenderOptions(231_000)).toEqual([231_000, 250_000, 300_000, 400_000, 500_000, 1_000_000])
  })

  it("không có mệnh giá nào NHỎ hơn tổng — một nút bấm xong bị khoá là cái bẫy", () => {
    for (const total of [45_000, 231_000, 1_250_000]) {
      for (const option of quickTenderOptions(total)) {
        expect(option, `${option} phải >= ${total}`).toBeGreaterThanOrEqual(total)
      }
    }
  })

  it("mỗi nút bấm vào đều làm nút Xác nhận bật", () => {
    for (const option of quickTenderOptions(TOTAL)) {
      expect(evaluateCash(TOTAL, String(option)).canConfirm).toBe(true)
    }
  })

  it("không có hai nút trùng số", () => {
    const options = quickTenderOptions(500_000)
    expect(new Set(options).size).toBe(options.length)
  })

  it("tổng đã là một mức tròn thì không sinh nút thừa", () => {
    expect(quickTenderOptions(1_000_000)).toEqual([1_000_000])
  })

  it("tổng không hợp lệ thì không có nút nào", () => {
    expect(quickTenderOptions(0)).toEqual([])
    expect(quickTenderOptions(-1)).toEqual([])
    expect(quickTenderOptions(1.5)).toEqual([])
  })
})

import { describe, expect, it } from "vitest"
import {
  BILL_FILTER_ORDER,
  IN_DEVELOPMENT_LABEL,
  amountRows,
  blockerDisplays,
  canCloseBill,
  chargeRows,
  formatVatRate,
  inDevelopmentLabels,
  matchesFilter,
  seatedDurationLabel,
  seatingLabel,
} from "./bill-display"
import type { BillAmounts, BillCharge } from "./billing-api"

const amounts: BillAmounts = {
  subtotalVnd: 209_600,
  vatRateBasisPoints: 1000,
  vatVnd: 20_960,
  preRoundTotalVnd: 230_560,
  roundingAdjustmentVnd: 440,
  totalVnd: 231_000,
}

describe("amountRows", () => {
  it("bốn dòng theo đúng thứ tự tính, tổng cuối được nhấn", () => {
    const rows = amountRows(amounts)
    expect(rows.map((row) => row.key)).toEqual(["subtotal", "vat", "rounding", "total"])
    expect(rows.map((row) => row.amountVnd)).toEqual([209_600, 20_960, 440, 231_000])
    expect(rows.at(-1)?.emphasis).toBe(true)
    expect(rows.slice(0, -1).every((row) => !row.emphasis)).toBe(true)
  })

  it("ẩn dòng làm tròn khi không làm tròn thêm đồng nào", () => {
    const rows = amountRows({
      subtotalVnd: 100_000,
      vatRateBasisPoints: 1000,
      vatVnd: 10_000,
      preRoundTotalVnd: 110_000,
      roundingAdjustmentVnd: 0,
      totalVnd: 110_000,
    })
    expect(rows.map((row) => row.key)).toEqual(["subtotal", "vat", "total"])
  })

  it("nhãn VAT dựng từ điểm cơ bản của bill, không hard-code 10%", () => {
    const rows = amountRows({ ...amounts, vatRateBasisPoints: 800 })
    expect(rows[1]?.label).toBe("VAT 8%")
  })

  it("ba dòng đầu cộng lại đúng tổng cuối", () => {
    const rows = amountRows(amounts)
    const total = rows.filter((row) => !row.emphasis).reduce((sum, row) => sum + row.amountVnd, 0)
    expect(total).toBe(rows.at(-1)?.amountVnd)
  })
})

describe("formatVatRate", () => {
  it("dấu phẩy thập phân kiểu Việt", () => {
    expect(formatVatRate(1000)).toBe("10%")
    expect(formatVatRate(800)).toBe("8%")
    expect(formatVatRate(1050)).toBe("10,5%")
  })
})

describe("chargeRows", () => {
  it("giữ nguyên mọi hàng ledger, kể cả hàng làm tròn 0đ", () => {
    const charges: BillCharge[] = [
      {
        sequenceNo: 1,
        chargeCode: "ITEM_SUBTOTAL",
        basisAmountVnd: 0,
        rateBasisPoints: null,
        signedAmountVnd: 100_000,
        explanation: "Tạm tính 2 món",
      },
      {
        sequenceNo: 2,
        chargeCode: "VAT",
        basisAmountVnd: 100_000,
        rateBasisPoints: 1000,
        signedAmountVnd: 10_000,
        explanation: "VAT 10%",
      },
      {
        sequenceNo: 3,
        chargeCode: "FINAL_ROUNDING",
        basisAmountVnd: 110_000,
        rateBasisPoints: null,
        signedAmountVnd: 0,
        explanation: "Làm tròn lên nghìn",
      },
    ]
    const rows = chargeRows(charges)
    expect(rows).toHaveLength(3)
    expect(rows[2]?.label).toBe("Làm tròn lên nghìn")
    expect(rows[2]?.amountVnd).toBe(0)
    expect(rows.reduce((sum, row) => sum + row.amountVnd, 0)).toBe(110_000)
  })
})

describe("bộ lọc Màn 1", () => {
  it("ba nhóm theo đúng thứ tự mockup", () => {
    expect(BILL_FILTER_ORDER).toEqual(["all", "serving", "awaitingPayment"])
  })

  it("lọc đúng trạng thái", () => {
    expect(matchesFilter("SERVING", "all")).toBe(true)
    expect(matchesFilter("AWAITING_PAYMENT", "all")).toBe(true)
    expect(matchesFilter("SERVING", "serving")).toBe(true)
    expect(matchesFilter("AWAITING_PAYMENT", "serving")).toBe(false)
    expect(matchesFilter("AWAITING_PAYMENT", "awaitingPayment")).toBe(true)
    expect(matchesFilter("SERVING", "awaitingPayment")).toBe(false)
  })
})

describe("blockerDisplays", () => {
  it("giữ nguyên câu của máy chủ và thêm chỗ đi tới khi có", () => {
    const displays = blockerDisplays([
      { code: "ORDER_CANCELLATION_PENDING", message: "Còn 1 yêu cầu hủy món chờ duyệt." },
      { code: "BILL_EMPTY", message: "Bàn chưa gọi món nào." },
      { code: "BILL_ALREADY_OPEN", message: "Phiên đã có bill B261126-0412 đang chờ thanh toán." },
    ])
    expect(displays[0]?.message).toBe("Còn 1 yêu cầu hủy món chờ duyệt.")
    expect(displays[0]?.actionLabel).toBe("Mở màn duyệt hủy món")
    expect(displays[1]?.actionLabel).toBeNull()
    expect(displays[2]?.actionLabel).toBe("Mở bill đang chờ")
  })
})

describe("canCloseBill", () => {
  it("chỉ chốt được khi không còn lý do nào", () => {
    expect(canCloseBill([])).toBe(true)
    expect(canCloseBill([{ code: "BILL_EMPTY", message: "x" }])).toBe(false)
  })
})

describe("inDevelopmentLabels", () => {
  it("dựng nhãn từ dữ liệu máy chủ, không từ một danh sách viết cứng ở màn hình", () => {
    const labels = inDevelopmentLabels([
      { feature: "DISCOUNT", status: "IN_DEVELOPMENT", label: "Giảm giá" },
      { feature: "SPLIT_BILL", status: "IN_DEVELOPMENT", label: "Tách bill" },
    ])
    expect(labels).toEqual(["Giảm giá", "Tách bill"])
    expect(IN_DEVELOPMENT_LABEL).toBe("Đang phát triển")
  })
})

describe("seatedDurationLabel", () => {
  const now = new Date("2026-11-26T15:00:00.000Z")

  it("dưới một giờ thì đếm phút", () => {
    expect(seatedDurationLabel("2026-11-26T14:40:00.000Z", now)).toBe("20 phút")
  })

  it("tròn giờ thì không đọc số phút", () => {
    expect(seatedDurationLabel("2026-11-26T13:00:00.000Z", now)).toBe("2 giờ")
  })

  it("quá một giờ thì đọc cả giờ và phút", () => {
    expect(seatedDurationLabel("2026-11-26T13:40:00.000Z", now)).toBe("1 giờ 20")
  })

  it("không trả số âm khi giờ máy lệch", () => {
    expect(seatedDurationLabel("2026-11-26T16:00:00.000Z", now)).toBe("0 phút")
  })

  it("mốc thời gian không đọc được thì nói thẳng là không biết", () => {
    expect(seatedDurationLabel("khong-phai-ngay", now)).toBe("—")
  })
})

describe("seatingLabel", () => {
  it("một bàn", () => {
    expect(seatingLabel(["A1"], null)).toBe("A1")
  })

  it("cụm bàn ghép hiện đủ mã bàn và ký hiệu cụm", () => {
    expect(seatingLabel(["A1", "A2"], "G01")).toBe("A1 + A2 · G01")
  })

  it("Phiên chưa gắn bàn thì nói thẳng là chưa có", () => {
    expect(seatingLabel([], null)).toBe("—")
  })
})

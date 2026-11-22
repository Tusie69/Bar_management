import { describe, expect, it } from "vitest"
import type { PreparationTicket } from "./preparation-queue-data"
import { aggregatePreparationItems } from "./preparation-totals"

type PreparationLine = PreparationTicket["lines"][number]

function line(overrides: Partial<PreparationLine> = {}): PreparationLine {
  return {
    lineNo: 1,
    itemName: "Negroni",
    variantDisplayName: "Ly",
    menuItemVariantId: 101,
    unitCode: "GLASS",
    quantity: 2,
    cancelledQuantity: 0,
    originalQuantity: 2,
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
    orderId: 1,
    visitId: 1,
    visitSequence: 1,
    station: "BAR",
    status: "SUBMITTED",
    version: 1,
    submittedAt: "2030-10-24T12:00:00.000Z",
    acceptedAt: null,
    startedAt: null,
    readyAt: null,
    collectedAt: null,
    waitSeconds: 0,
    tableCodes: ["A1"],
    orderedByDisplayName: "Minh",
    guestFlags: { vip: false, birthday: false, designated: false },
    lines: [line()],
    ...overrides,
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

describe("aggregatePreparationItems", () => {
  it("gộp cùng variant ID qua nhiều ticket", () => {
    const result = aggregatePreparationItems([
      ticket({ ticketId: 1, lines: [line({ quantity: 2 })] }),
      ticket({ ticketId: 2, status: "ACCEPTED", lines: [line({ lineNo: 2, quantity: 3 })] }),
    ])
    expect(result).toEqual([expect.objectContaining({ menuItemVariantId: 101, quantity: 5 })])
  })

  it("giữ thứ tự xuất hiện đầu tiên của ticket rồi line", () => {
    const result = aggregatePreparationItems([
      ticket({ lines: [line({ menuItemVariantId: 30 }), line({ lineNo: 2, menuItemVariantId: 10 })] }),
      ticket({ ticketId: 2, lines: [line({ menuItemVariantId: 20 }), line({ lineNo: 2, menuItemVariantId: 30 })] }),
    ])
    expect(result.map((item) => item.menuItemVariantId)).toEqual([30, 10, 20])
  })

  it("không gộp hai variant khác ID dù item và variant label trùng nhau", () => {
    const result = aggregatePreparationItems([
      ticket({
        lines: [
          line({ menuItemVariantId: 101, unitCode: "GLASS" }),
          line({ lineNo: 2, menuItemVariantId: 202, unitCode: "BOTTLE" }),
        ],
      }),
    ])
    expect(result).toHaveLength(2)
    expect(result.map((item) => [item.menuItemVariantId, item.unitCode])).toEqual([
      [101, "GLASS"],
      [202, "BOTTLE"],
    ])
  })

  it("tính SUBMITTED, ACCEPTED và PREPARING", () => {
    const result = aggregatePreparationItems([
      ticket({ ticketId: 1, status: "SUBMITTED", lines: [line({ quantity: 1 })] }),
      ticket({ ticketId: 2, status: "ACCEPTED", lines: [line({ quantity: 2 })] }),
      ticket({ ticketId: 3, status: "PREPARING", lines: [line({ quantity: 3 })] }),
    ])
    expect(result[0]?.quantity).toBe(6)
  })

  it("loại READY và COLLECTED ngay cả khi có quantity", () => {
    const result = aggregatePreparationItems([
      ticket({ ticketId: 1, status: "READY", lines: [line({ quantity: 7 })] }),
      ticket({ ticketId: 2, status: "COLLECTED", lines: [line({ quantity: 9 })] }),
    ])
    expect(result).toEqual([])
  })

  it("dùng net quantity trực tiếp, không dùng originalQuantity", () => {
    const result = aggregatePreparationItems([
      ticket({ lines: [line({ quantity: 2, originalQuantity: 10, cancelledQuantity: 8 })] }),
    ])
    expect(result[0]?.quantity).toBe(2)
  })

  it("bỏ quantity bằng 0 hoặc âm", () => {
    const result = aggregatePreparationItems([
      ticket({ lines: [line({ quantity: 0 }), line({ lineNo: 2, menuItemVariantId: 202, quantity: -1 })] }),
    ])
    expect(result).toEqual([])
  })

  it("cộng pending cancellation nhưng không trừ khỏi quantity", () => {
    const result = aggregatePreparationItems([
      ticket({
        lines: [
          line({ quantity: 3, pendingCancellation: { cancellationId: 1, quantity: 2, groupId: null } }),
          line({
            lineNo: 2,
            quantity: 4,
            pendingCancellation: { cancellationId: 2, quantity: 1, groupId: 2 },
          }),
        ],
      }),
    ])
    expect(result[0]).toMatchObject({ quantity: 7, pendingCancellationQuantity: 3 })
  })

  it("note không tách group, trim whitespace và chỉ đếm line quantity dương", () => {
    const result = aggregatePreparationItems([
      ticket({
        lines: [
          line({ quantity: 1, note: "Ít đá" }),
          line({ lineNo: 2, quantity: 2, note: "   " }),
          line({ lineNo: 3, quantity: 3, note: "  Không đường  " }),
          line({ lineNo: 4, quantity: 0, note: "Không được đếm" }),
        ],
      }),
    ])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ quantity: 6, notedLineCount: 2 })
  })

  it("metadata khác nhau cùng ID dùng lần xuất hiện đầu tiên", () => {
    const result = aggregatePreparationItems([
      ticket({
        lines: [
          line({ itemName: "Tên đầu", variantDisplayName: "Nhãn đầu", unitCode: "GLASS" }),
          line({ lineNo: 2, itemName: "Tên sau", variantDisplayName: "Nhãn sau", unitCode: "BOTTLE" }),
        ],
      }),
    ])
    expect(result[0]).toMatchObject({
      itemName: "Tên đầu",
      variantDisplayName: "Nhãn đầu",
      unitCode: "GLASS",
      quantity: 4,
    })
  })

  it("không mutate input đã deep-freeze", () => {
    const input = deepFreeze([
      ticket({
        lines: [line({ note: "Ít đá", pendingCancellation: { cancellationId: 1, quantity: 1, groupId: null } })],
      }),
    ] as const)
    const before = JSON.stringify(input)
    expect(() => aggregatePreparationItems(input)).not.toThrow()
    expect(JSON.stringify(input)).toBe(before)
  })

  it("trả aggregate rỗng cho snapshot rỗng", () => {
    expect(aggregatePreparationItems([])).toEqual([])
  })
})

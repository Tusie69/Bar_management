import { describe, expect, it } from "vitest"
import { planPreparationDrop } from "./preparation-drag"

describe("planPreparationDrop", () => {
  it("đi tới đúng một bước", () => {
    expect(planPreparationDrop("SUBMITTED", "ACCEPTED", true)).toMatchObject({
      kind: "forward",
      toStatus: "ACCEPTED",
    })
    expect(planPreparationDrop("PREPARING", "READY", true)).toMatchObject({ kind: "forward", toStatus: "READY" })
  })

  it("lùi được đúng một bước, không hỏi thêm gì", () => {
    for (const [from, to] of [
      ["ACCEPTED", "SUBMITTED"],
      ["PREPARING", "ACCEPTED"],
    ] as const) {
      expect(planPreparationDrop(from, to, true)).toMatchObject({
        kind: "revert",
        toStatus: to,
        blockedReason: null,
      })
    }
  })

  it("không lùi được từ Hoàn thành, và nói rõ vì sao", () => {
    const plan = planPreparationDrop("READY", "PREPARING", true)
    expect(plan.kind).toBe("blocked")
    // Lý do phải nhắc tới thông báo đã gửi: người đọc cần biết việc đã lan ra
    // ngoài quầy, không chỉ biết là "không được".
    expect(plan.blockedReason).toContain("thông báo")
  })

  it("không cho nhảy nhiều hơn một bước, cả hai chiều", () => {
    expect(planPreparationDrop("SUBMITTED", "PREPARING", true).kind).toBe("blocked")
    expect(planPreparationDrop("SUBMITTED", "READY", true).kind).toBe("blocked")
    expect(planPreparationDrop("READY", "SUBMITTED", true).kind).toBe("blocked")
  })

  it("thả lại đúng cột cũ là không làm gì", () => {
    expect(planPreparationDrop("ACCEPTED", "ACCEPTED", true)).toMatchObject({ kind: "same", toStatus: null })
  })

  it("thiếu quyền thì chặn trước khi gửi", () => {
    const plan = planPreparationDrop("SUBMITTED", "ACCEPTED", false)
    expect(plan.kind).toBe("blocked")
    expect(plan.blockedReason).toContain("quyền")
  })

  it("phiếu đã bàn giao không còn cột để kéo", () => {
    expect(planPreparationDrop("COLLECTED", "READY", true).kind).toBe("blocked")
  })
})

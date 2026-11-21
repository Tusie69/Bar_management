/**
 * Chế độ mock KHÔNG giả lập việc gửi đơn.
 *
 * Yêu cầu của module là "mock phải tuân cùng hợp đồng, không giả thành công
 * khác backend thật". Cách duy nhất giữ được điều đó ở đây là từ chối: bản
 * prototype không có máy chủ, không có danh mục món (`GET /waiter/menu` cũng
 * trả 501 từ Module 2), nên một đơn "đã gửi" trong mock là một đơn không tồn
 * tại ở Bar — đúng cái sai mà giàn giáo của Module 1 đã cảnh báo.
 *
 * Test này canh rằng không ai thêm một đường giả thành công vào sau.
 */
import { describe, expect, it, vi } from "vitest"

// `httpClient` là null ở chế độ mock. Mock nó ở đây thay vì dựa vào `.env` của
// máy đang chạy test: hợp đồng này phải đúng bất kể máy đó đang trỏ vào đâu.
vi.mock("@/services", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services")>()),
  httpClient: null,
}))

import { isApiError } from "@/services"
import {
  adjustOrderLineQuantity,
  decideCancellation,
  fetchCancellationQueue,
  fetchReadyNotifications,
  fetchVisitOrders,
  fetchWaiterOrder,
  requestLineCancellation,
  submitWaiterOrder,
} from "./waiter-order-api"

const payload = {
  visitId: 42,
  idempotencyKey: "mock-order-key-0001",
  lines: [{ variantId: 1, priceId: 11, priceVersion: 1, quantity: 2 }],
}

describe("waiter order API ở chế độ mock", () => {
  it("gửi đơn bị từ chối với 501 và câu nói rõ lý do", async () => {
    const error = await submitWaiterOrder(payload).then(
      () => null,
      (reason: unknown) => reason,
    )
    expect(isApiError(error)).toBe(true)
    expect(error).toMatchObject({ status: 501, code: "ORDER_REQUIRES_HTTP" })
    expect((error as Error).message).toContain("không tạo đơn")
  })

  it("đọc đơn cũng bị từ chối thay vì trả một danh sách giả", async () => {
    for (const call of [() => fetchVisitOrders(42), () => fetchWaiterOrder(7)]) {
      const error = await call().then(
        () => null,
        (reason: unknown) => reason,
      )
      expect(error).toMatchObject({ status: 501, code: "ORDER_REQUIRES_HTTP" })
    }
  })

  it("Module 5 cũng từ chối: không sửa số lượng, không hủy, không duyệt trong bản demo", async () => {
    const calls: (() => Promise<unknown>)[] = [
      () => adjustOrderLineQuantity(55, 1, { expectedLineVersion: 1, quantity: 2, idempotencyKey: "mock-key-0001" }),
      () =>
        requestLineCancellation(55, 1, {
          expectedLineVersion: 1,
          quantity: 1,
          reason: "Khách đổi ý",
          idempotencyKey: "mock-key-0002",
        }),
      () => fetchCancellationQueue("PENDING"),
      () => decideCancellation(9, "approve", { expectedVersion: 1, idempotencyKey: "mock-key-0003" }),
      () => fetchReadyNotifications(),
    ]
    for (const call of calls) {
      const error = await call().then(
        () => null,
        (reason: unknown) => reason,
      )
      // Một "đã hủy" trong bản demo là một món vẫn đang được làm ở Bar, và một
      // "đã duyệt" là một quyết định không ai chịu trách nhiệm.
      expect(error).toMatchObject({ status: 501, code: "ORDER_REQUIRES_HTTP" })
    }
  })
})

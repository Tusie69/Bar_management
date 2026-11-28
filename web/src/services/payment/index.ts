/**
 * TEMPORARY PAYMENT SERVICE ENTRYPOINT (NA-45/46)
 *
 * Màn thanh toán chỉ import `paymentApi` và các kiểu từ `@/services/payment`.
 * Chế độ `mock` dùng máy chủ giả trong trình duyệt; chế độ `http` đi qua
 * `http-payment.ts` tới API bill thật của TU-45/46.
 */
import { api, clock } from "@/services"
import type { PaymentApi } from "./contracts"
import { httpPaymentApi } from "./http-payment"
import {
  addPaymentOrderLines,
  getPaymentAttemptKeys,
  mockPaymentApi,
  setPaymentMockFault,
  simulatePaymentVersionBump,
} from "./mock-payment"

/**
 * Cổng bật/tắt màn thanh toán.
 *
 * Trước khi `http-payment.ts` tồn tại, dòng này là `api.mode === "mock"`: bản
 * chạy thật không có màn Thu ngân nào cả. Giờ cả hai chế độ đều có API đứng
 * sau, nên không còn lý do để một vai trò đăng nhập vào rồi nhìn màn trống.
 */
export const isPaymentAvailable = api.mode === "mock" || api.mode === "http"

export const paymentApi: PaymentApi = api.mode === "mock" ? mockPaymentApi : httpPaymentApi

// Expose mock fault injector for Playwright E2E scripts only (no product UI control bar).
if (api.mode === "mock" && !import.meta.env.PROD && typeof window !== "undefined") {
  ;(window as unknown as Record<string, unknown>).__21gamPaymentMock = {
    setFault: setPaymentMockFault,
    bumpVersion: simulatePaymentVersionBump,
    getAttemptKeys: getPaymentAttemptKeys,
    addOrderLines: addPaymentOrderLines,
    listOpen: () => mockPaymentApi.listOpen(),
    paymentApi: mockPaymentApi,
    visitIdForTable: async (code: string) => {
      const [catalog, floor] = await Promise.all([api.getCatalog(), api.getFloorState(clock.now())])
      const table = catalog.tables.find((t) => t.code === code)
      const claim = table ? floor.tables.find((t) => t.tableId === table.id)?.claim : undefined
      return claim?.visitId ? String(claim.visitId) : null
    },
    reset: () => (api as unknown as { reset?: () => void }).reset?.(),
  }
}

export * from "./contracts"
export * from "./calc"

/**
 * TEMPORARY PAYMENT SERVICE ENTRYPOINT (NA-45/46)
 *
 * Swap point for TU-45/46:
 * - Payment screens import `paymentApi` and types ONLY from `@/services/payment`.
 * - When Tú's TU-45/46 HTTP endpoints land, implement `httpPaymentApi: PaymentApi`
 *   using `httpClient` and select it here when `api.mode === "http"`.
 */
import { ApiError, api, clock } from "@/services"
import type { PaymentApi } from "./contracts"
import {
  getPaymentAttemptKeys,
  mockPaymentApi,
  setPaymentMockFault,
  simulatePaymentVersionBump,
} from "./mock-payment"

const unimplementedHttpPaymentApi: PaymentApi = {
  listOpen: async () => {
    throw new ApiError(501, "NOT_SUPPORTED_BY_BACKEND", "API thanh toán TU-45/46 chưa được kết nối.")
  },
  getBill: async () => {
    throw new ApiError(501, "NOT_SUPPORTED_BY_BACKEND", "API thanh toán TU-45/46 chưa được kết nối.")
  },
  createPrebill: async () => {
    throw new ApiError(501, "NOT_SUPPORTED_BY_BACKEND", "API thanh toán TU-45/46 chưa được kết nối.")
  },
  requestPayment: async () => {
    throw new ApiError(501, "NOT_SUPPORTED_BY_BACKEND", "API thanh toán TU-45/46 chưa được kết nối.")
  },
  confirmCash: async () => {
    throw new ApiError(501, "NOT_SUPPORTED_BY_BACKEND", "API thanh toán TU-45/46 chưa được kết nối.")
  },
  confirmTransfer: async () => {
    throw new ApiError(501, "NOT_SUPPORTED_BY_BACKEND", "API thanh toán TU-45/46 chưa được kết nối.")
  },
  listNotifications: async () => {
    throw new ApiError(501, "NOT_SUPPORTED_BY_BACKEND", "API thanh toán TU-45/46 chưa được kết nối.")
  },
  checkTransfer: async () => {
    throw new ApiError(501, "NOT_SUPPORTED_BY_BACKEND", "API thanh toán TU-45/46 chưa được kết nối.")
  },
  previewBill: async () => {
    throw new ApiError(501, "NOT_IMPLEMENTED_YET", "Đang phát triển")
  },
  issueInvoice: async () => {
    throw new ApiError(501, "NOT_IMPLEMENTED_YET", "Đang phát triển")
  },
  getSessionBills: async () => {
    throw new ApiError(501, "NOT_IMPLEMENTED_YET", "Đang phát triển")
  },
  requestCancel: async () => {
    throw new ApiError(501, "NOT_IMPLEMENTED_YET", "Đang phát triển")
  },
  listCancelRequests: async () => {
    throw new ApiError(501, "NOT_IMPLEMENTED_YET", "Đang phát triển")
  },
  decideCancel: async () => {
    throw new ApiError(501, "NOT_IMPLEMENTED_YET", "Đang phát triển")
  },
  cancelPaid: async () => {
    throw new ApiError(501, "NOT_IMPLEMENTED_YET", "Đang phát triển")
  },
  listAudit: async () => {
    throw new ApiError(501, "NOT_IMPLEMENTED_YET", "Đang phát triển")
  },
}

/**
 * Availability gate for the payment UI.
 * True in mock mode; false in HTTP mode until TU-45/46 endpoints are wired here.
 */
export const isPaymentAvailable = api.mode === "mock"

export const paymentApi: PaymentApi = api.mode === "mock" ? mockPaymentApi : unimplementedHttpPaymentApi

// Expose mock fault injector for Playwright E2E scripts only (no product UI control bar).
if (api.mode === "mock" && !import.meta.env.PROD && typeof window !== "undefined") {
  ;(window as unknown as Record<string, unknown>).__21gamPaymentMock = {
    setFault: setPaymentMockFault,
    bumpVersion: simulatePaymentVersionBump,
    getAttemptKeys: getPaymentAttemptKeys,
    listOpen: () => mockPaymentApi.listOpen(),
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

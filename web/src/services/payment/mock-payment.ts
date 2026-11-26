import { api, ApiError } from "@/services"
import type { MockGamApi } from "@/services/mock/server"
import type { PaymentApi } from "./contracts"

function mockServer(): MockGamApi {
  if (api.mode !== "mock") {
    throw new ApiError(501, "NOT_SUPPORTED_BY_BACKEND", "Payment mock adapter chỉ hoạt động ở chế độ mock.")
  }
  return api as unknown as MockGamApi
}

/**
 * TEMPORARY mock implementation of PaymentApi backed by MockGamApi.
 * Swap point for TU-45/46: replace in `web/src/services/payment/index.ts`.
 */
export const mockPaymentApi: PaymentApi = {
  listOpen: () => mockServer().listPaymentOpen(),
  getBill: (visitId) => mockServer().getPaymentBill(visitId),
  createPrebill: (visitId, version) => mockServer().createPaymentPrebill(visitId, version),
  requestPayment: (visitId) => mockServer().requestPayment(visitId),
  confirmCash: (visitId, givenVnd, version, idempotencyKey) =>
    mockServer().confirmPaymentCash(visitId, givenVnd, version, idempotencyKey),
  confirmTransfer: (visitId, manual, version, idempotencyKey) =>
    mockServer().confirmPaymentTransfer(visitId, manual, version, idempotencyKey),
  listNotifications: () => mockServer().listPaymentNotifications(),
  checkTransfer: (visitId) => mockServer().checkPaymentTransfer(visitId),
}

export function setPaymentMockFault(patch: {
  nextConfirm?: "net" | "dup" | null
  qrFound?: boolean
  billDelayMs?: number
}) {
  mockServer().setPaymentTestFault(patch)
}

export function simulatePaymentVersionBump(visitId: string) {
  mockServer().simulatePaymentVersionBump(visitId)
}

export function getPaymentAttemptKeys(): string[] {
  return mockServer().getPaymentAttemptKeys()
}

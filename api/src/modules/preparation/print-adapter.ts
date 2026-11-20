import type { PreparationStation } from './preparation.model.js'

/**
 * Điểm cắm duy nhất cho nhà cung cấp máy in. Core chỉ commit một outbox record;
 * worker ở rìa hệ thống dựng payload này rồi gọi adapter. Không có giả định về
 * USB/LAN, ESC/POS, cloud API hay format byte trong module nghiệp vụ.
 */
export interface PreparationPrintPayload {
  outboxId: number
  ticketId: number
  station: PreparationStation
  deduplicationKey: string
  tableCodes: string[]
  lines: Array<{ itemName: string; variantDisplayName: string; quantity: number; note: string | null }>
}

export interface PreparationPrintAdapter {
  readonly adapterName: string
  deliver(payload: PreparationPrintPayload): Promise<{ providerReference?: string }>
}

export class PrintAdapterNotConfiguredError extends Error {
  constructor() {
    super('Chưa cấu hình nhà cung cấp và giao thức máy in.')
    this.name = 'PrintAdapterNotConfiguredError'
  }
}

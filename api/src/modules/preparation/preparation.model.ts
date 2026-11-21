export type PreparationStation = 'BAR' | 'KITCHEN'
export type PreparationStatus = 'SUBMITTED' | 'ACCEPTED' | 'PREPARING' | 'READY' | 'COLLECTED'

export interface PreparationLineView {
  lineNo: number
  itemName: string
  variantDisplayName: string
  quantity: number
  note: string | null
}

export interface PreparationTicketView {
  ticketId: number
  orderId: number
  visitId: number
  visitSequence: number
  station: PreparationStation
  status: PreparationStatus
  version: number
  submittedAt: string
  acceptedAt: string | null
  startedAt: string | null
  readyAt: string | null
  collectedAt: string | null
  waitSeconds: number
  tableCodes: string[]
  lines: PreparationLineView[]
}

export interface PreparationQueueSnapshot {
  station: PreparationStation
  changeCursor: string
  generatedAt: string
  printing: { enabled: boolean }
  limit: number
  tickets: PreparationTicketView[]
}

export type ReadyAudience = 'ORDERED_BY_USER' | 'CASHIER_ROLE'

export interface ReadyNotificationView {
  eventId: number
  ticketId: number
  visitId: number
  orderedByUserId: number
  station: PreparationStation
  audience: ReadyAudience
  createdAt: string
  acknowledgedAt: string | null
}

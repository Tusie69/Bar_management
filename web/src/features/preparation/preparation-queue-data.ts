import { useQuery } from "@tanstack/react-query"
import { httpClient } from "@/services"
import { useSession } from "@/state/session"
import type { MenuUnitCode } from "../waiter-menu/menu-model"
import type { PreparationTicketStatus } from "./preparation-layout"

export type PreparationStation = "BAR" | "KITCHEN"

export interface PreparationTicket {
  ticketId: number
  orderId: number
  visitId: number
  visitSequence: number
  station: PreparationStation
  status: PreparationTicketStatus
  version: number
  submittedAt: string
  acceptedAt: string | null
  startedAt: string | null
  readyAt: string | null
  collectedAt: string | null
  waitSeconds: number
  tableCodes: string[]
  orderedByDisplayName: string
  guestFlags: {
    vip: boolean
    birthday: boolean
    designated: boolean
  }
  lines: Array<{
    lineNo: number
    itemName: string
    variantDisplayName: string
    menuItemVariantId: number
    unitCode: MenuUnitCode
    quantity: number
    cancelledQuantity: number
    originalQuantity: number
    doneQuantity: number
    progressVersion: number
    note: string | null
    pendingCancellation: {
      cancellationId: number
      quantity: number
      groupId: number | null
    } | null
  }>
}

export interface PreparationQueueSnapshot {
  station: PreparationStation
  changeCursor: string
  generatedAt: string
  printing: { enabled: boolean }
  limit: number
  tickets: PreparationTicket[]
}

export function preparationQueueKey(venueId: number | null, station: PreparationStation) {
  return ["preparation-queue", venueId, station] as const
}

async function fetchPreparationQueue(station: PreparationStation): Promise<PreparationQueueSnapshot> {
  if (!httpClient) throw new Error("HTTP client chưa được cấu hình.")
  return httpClient.get<PreparationQueueSnapshot>(`/preparation/${station}/tickets`)
}

export function usePreparationQueue(station: PreparationStation, enabled: boolean, poll = false) {
  const venueId = useSession((state) => state.principal?.venueId ?? null)
  return useQuery({
    queryKey: preparationQueueKey(venueId, station),
    queryFn: () => fetchPreparationQueue(station),
    enabled: enabled && httpClient !== null,
    staleTime: 10_000,
    refetchInterval: poll ? 20_000 : false,
  })
}

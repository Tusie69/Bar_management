import type { HttpClient } from "./http-client"

/**
 * §3.1: the server refuses a write that exceeds the tables''' capacity until the
 * request says an operator confirmed it. Sent as-is so the server, not the
 * browser, decides whether the confirmation is present.
 */
export interface CapacityConfirmation {
  capacityOverrideConfirmed?: boolean
}

export interface MovedVisit {
  id: number
  businessDate: string
  version: number
  previousTables: Array<{ id: number; code: string }>
  tables: Array<{ id: number; code: string }>
}

export interface MergedVisit {
  visit: MovedVisit
  group: { id: number; symbolNo: number; tableIds: number[] }
}

export class HttpVisitApi {
  private readonly client: HttpClient

  constructor(client: HttpClient) {
    this.client = client
  }

  async close(id: number, version: number): Promise<void> {
    await this.client.post(`/visits/${id}/close`, { version, mode: "MANUAL", reason: "GUEST_LEFT" })
  }

  async move(
    id: number,
    version: number,
    tableIds: number[],
    confirmations: CapacityConfirmation = {},
  ): Promise<MovedVisit> {
    const response = await this.client.post<{ visit: MovedVisit }>(`/visits/${id}/move`, {
      version,
      tableIds,
      ...confirmations,
    })
    return response.visit
  }

  async merge(
    id: number,
    version: number,
    tableIds: number[],
    confirmations: CapacityConfirmation = {},
  ): Promise<MergedVisit> {
    return this.client.post<MergedVisit>(`/visits/${id}/merge`, { version, tableIds, ...confirmations })
  }
}

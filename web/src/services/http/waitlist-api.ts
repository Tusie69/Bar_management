import type { BusinessDate } from "@/lib/time"
import type { HttpClient } from "./http-client"

export type HttpWaitlistStatus =
  "WAITING" | "CONTACTING" | "OFFERED" | "HOLD_ACTIVE" | "SEATED" | "DECLINED" | "CANCELLED"

export interface HttpWaitlistEntry {
  id: number
  kind: "ADVANCE_RESERVATION" | "WALK_IN"
  guestName: string
  phoneLast3: string | null
  partySize: number
  businessDate: BusinessDate
  queuedAt: Date
  status: HttpWaitlistStatus
  contactChannel: string
  reservationId: number | null
  visitId: number | null
  note: string | null
  version: number
}

const ACTIVE_WAITLIST_STATUSES = new Set<HttpWaitlistStatus>(["WAITING", "CONTACTING", "OFFERED"])

/** Preserve the FIFO order returned by the server while excluding non-waiting terminal/hold states. */
export function activeWaitlistEntries(entries: readonly HttpWaitlistEntry[]): HttpWaitlistEntry[] {
  return entries.filter((entry) => ACTIVE_WAITLIST_STATUSES.has(entry.status))
}

const dateReviver = (key: string, value: unknown) =>
  key.endsWith("At") && typeof value === "string" ? new Date(value) : value

export class HttpWaitlistApi {
  private readonly client: HttpClient

  constructor(client: HttpClient) {
    this.client = client
  }

  async list(businessDate: BusinessDate): Promise<HttpWaitlistEntry[]> {
    const response = await this.client.get<{ entries: HttpWaitlistEntry[] }>(`/waitlist?date=${businessDate}`, {
      reviver: dateReviver,
    })
    return response.entries
  }

  async create(input: {
    guestName: string
    phoneNumber?: string
    partySize: number
    businessDate: BusinessDate
    note?: string
  }): Promise<HttpWaitlistEntry> {
    const response = await this.client.post<{ entry: HttpWaitlistEntry }>(
      "/waitlist",
      { ...input, contactChannel: "IN_PERSON" },
      { reviver: dateReviver },
    )
    return response.entry
  }

  async assign(
    entryId: number,
    version: number,
    tableIds: number[],
  ): Promise<{ entry: HttpWaitlistEntry; reservationId: number; groupId: number | null }> {
    return this.client.post(`/waitlist/${entryId}/seat`, { version, tableIds }, { reviver: dateReviver })
  }
}

import { ApiError } from "../contracts"
import type { BusinessDate } from "@/lib/time"
import type { ReceptionSearchResult } from "@/domain/models"
import type { HttpClient } from "./http-client"
import {
  assignmentPayload,
  cancelBookingPayload,
  createBookingPayload,
  directBookingCreatePayload,
  fullUpdateBookingPayload,
  mapBooking,
  type BackendBookingPayload,
  type BookingWriteFields,
  type HttpBooking,
} from "./booking-adapter"

const dateReviver = (key: string, value: unknown) =>
  key.endsWith("At") && typeof value === "string" ? new Date(value) : value

export class HttpBookingApi {
  private readonly client: HttpClient

  constructor(client: HttpClient) {
    this.client = client
  }

  async list(businessDate: BusinessDate, search = ""): Promise<HttpBooking[]> {
    const query = search.trim()
    const path = query
      ? `/bookings/search?date=${businessDate}&q=${encodeURIComponent(query)}`
      : `/bookings?date=${businessDate}`
    const response = await this.client.get<{ businessDate: string; bookings: BackendBookingPayload[] }>(path, {
      reviver: dateReviver,
    })
    if (response.businessDate !== businessDate || response.bookings.some((row) => row.businessDate !== businessDate)) {
      throw new ApiError(502, "BUSINESS_DATE_RESPONSE_MISMATCH", "Unexpected business date in bookings response.")
    }
    return response.bookings.map(mapBooking)
  }

  async searchReception(
    businessDate: BusinessDate,
    query: { last3?: string; name?: string },
  ): Promise<ReceptionSearchResult> {
    const params = new URLSearchParams({ date: businessDate })
    if (query.last3) params.set("last3", query.last3)
    if (query.name) params.set("name", query.name)
    const response = await this.client.get<ReceptionSearchResult>(`/bookings/search?${params}`)
    if (response.businessDate !== businessDate) {
      throw new ApiError(502, "BUSINESS_DATE_RESPONSE_MISMATCH", "Unexpected business date in search response.")
    }
    return response
  }

  exportDailyText(businessDate: BusinessDate): Promise<string> {
    return this.client.get<string>(`/bookings/export?date=${encodeURIComponent(businessDate)}`)
  }

  async detail(id: number): Promise<HttpBooking> {
    const response = await this.client.get<{ booking: BackendBookingPayload }>(`/bookings/${id}`, {
      reviver: dateReviver,
    })
    return mapBooking(response.booking)
  }

  async create(fields: BookingWriteFields, idempotencyKey?: string): Promise<HttpBooking> {
    const response = await this.client.post<{ booking: BackendBookingPayload }>(
      "/bookings",
      createBookingPayload(fields),
      { reviver: dateReviver, idempotencyKey },
    )
    return mapBooking(response.booking)
  }

  async createAndAssign(fields: BookingWriteFields, tableIds: number[], idempotencyKey?: string): Promise<HttpBooking> {
    const response = await this.client.post<{ booking: BackendBookingPayload }>(
      "/bookings/direct",
      directBookingCreatePayload(fields, tableIds),
      { reviver: dateReviver, idempotencyKey },
    )
    return mapBooking(response.booking)
  }

  async update(current: HttpBooking, fields: Partial<BookingWriteFields>): Promise<HttpBooking> {
    const response = await this.client.put<{ booking: BackendBookingPayload }>(
      `/bookings/${current.id}`,
      fullUpdateBookingPayload(current, fields),
      { reviver: dateReviver },
    )
    return mapBooking(response.booking)
  }

  async cancelVersion(id: number, version: number, reasonNote?: string): Promise<HttpBooking> {
    const response = await this.client.post<{ booking: BackendBookingPayload }>(
      `/bookings/${id}/cancel`,
      cancelBookingPayload(version, reasonNote),
      { reviver: dateReviver },
    )
    return mapBooking(response.booking)
  }

  async markNoShow(id: number, version: number): Promise<HttpBooking> {
    const response = await this.client.post<{ booking: BackendBookingPayload }>(
      `/bookings/${id}/no-show`,
      { version },
      { reviver: dateReviver },
    )
    return mapBooking(response.booking)
  }

  async confirmLate(
    id: number,
    version: number,
  ): Promise<{
    bookingId: number
    lateConfirmed: true
    lateConfirmedAt: Date
    version: number
    changeSeq: string
  }> {
    return this.client.post<{
      bookingId: number
      lateConfirmed: true
      lateConfirmedAt: Date
      version: number
      changeSeq: string
    }>(`/bookings/${id}/late-confirm`, { version }, { reviver: dateReviver })
  }

  async startCall(id: number): Promise<{ callId: number; bookingId: number; initiatedAt: Date; telUri: string }> {
    return this.client.post(`/bookings/${id}/call`, {}, { reviver: dateReviver })
  }

  async recordCallOutcome(
    bookingId: number,
    callId: number,
    outcome: "CONTACTED" | "NO_ANSWER" | "LATE_CONFIRMED",
    bookingVersion?: number,
  ): Promise<void> {
    await this.client.post(
      `/bookings/${bookingId}/calls/${callId}/outcome`,
      {
        outcome,
        ...(bookingVersion === undefined ? {} : { bookingVersion }),
      },
      { reviver: dateReviver },
    )
  }

  async assignVersion(id: number, version: number, tableIds: number[]): Promise<HttpBooking> {
    const response = await this.client.post<{ booking: BackendBookingPayload }>(
      `/bookings/${id}/assign`,
      assignmentPayload(version, tableIds),
      { reviver: dateReviver },
    )
    return mapBooking(response.booking)
  }

  async merge(id: number, version: number, tableIds: number[]): Promise<{ booking: HttpBooking; groupId: number }> {
    const response = await this.client.post<{
      booking: BackendBookingPayload
      group: { id: number; symbolNo: number; tableIds: number[] }
    }>(`/bookings/${id}/merge`, { version, tableIds }, { reviver: dateReviver })
    return { booking: mapBooking(response.booking), groupId: response.group.id }
  }

  async checkIn(current: HttpBooking): Promise<HttpBooking> {
    const response = await this.client.post<{ booking: BackendBookingPayload }>(
      `/bookings/${current.id}/check-in`,
      { version: current.version },
      { reviver: dateReviver },
    )
    return mapBooking(response.booking)
  }

  async revealPhone(id: number): Promise<string> {
    const response = await this.client.post<{ phoneNumber: string }>(`/bookings/${id}/phone:reveal`, {})
    return response.phoneNumber
  }
}

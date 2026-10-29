import type { BusinessDate } from "@/lib/time"
import type { HttpClient } from "./http-client"
import {
  assignmentPayload,
  cancelBookingPayload,
  createBookingPayload,
  fullUpdateBookingPayload,
  mapBooking,
  mapAssignmentTable,
  type AssignmentTable,
  type BackendAssignmentTablePayload,
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
    const response = await this.client.get<{ bookings: BackendBookingPayload[] }>(path, { reviver: dateReviver })
    return response.bookings.map(mapBooking)
  }

  async detail(id: number): Promise<HttpBooking> {
    const response = await this.client.get<{ booking: BackendBookingPayload }>(`/bookings/${id}`, {
      reviver: dateReviver,
    })
    return mapBooking(response.booking)
  }

  async create(fields: BookingWriteFields): Promise<HttpBooking> {
    const response = await this.client.post<{ booking: BackendBookingPayload }>(
      "/bookings",
      createBookingPayload(fields),
      { reviver: dateReviver },
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

  async cancel(current: HttpBooking, reasonNote?: string): Promise<HttpBooking> {
    const response = await this.client.post<{ booking: BackendBookingPayload }>(
      `/bookings/${current.id}/cancel`,
      cancelBookingPayload(current.version, reasonNote),
      { reviver: dateReviver },
    )
    return mapBooking(response.booking)
  }

  async assignmentTables(businessDate: BusinessDate): Promise<AssignmentTable[]> {
    const response = await this.client.get<{ tables: BackendAssignmentTablePayload[] }>(
      `/tables?date=${businessDate}`,
      { reviver: dateReviver },
    )
    return response.tables.map(mapAssignmentTable)
  }

  async assign(current: HttpBooking, tableIds: number[]): Promise<HttpBooking> {
    return this.assignVersion(current.id, current.version, tableIds)
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

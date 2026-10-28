import type { BusinessDate } from "@/lib/time"
import type { HttpClient } from "./http-client"
import {
  cancelBookingPayload,
  createBookingPayload,
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
}

import { describe, expect, it } from "vitest"
import type { HttpWaitlistEntry } from "@/services"
import { activeWaitlistEntries } from "@/services/http/waitlist-api"

const entry = (id: number, status: HttpWaitlistEntry["status"]): HttpWaitlistEntry => ({
  id,
  kind: "WALK_IN",
  guestName: `Khách ${id}`,
  phoneLast3: null,
  partySize: 2,
  businessDate: "2030-10-24",
  queuedAt: new Date(`2030-10-24T12:00:0${id}.000Z`),
  status,
  contactChannel: "IN_PERSON",
  reservationId: null,
  visitId: null,
  note: null,
  version: 1,
})

describe("layout waitlist counter", () => {
  it("counts only active waiting states and preserves backend FIFO order", () => {
    const result = activeWaitlistEntries([
      entry(2, "WAITING"),
      entry(3, "HOLD_ACTIVE"),
      entry(4, "CONTACTING"),
      entry(5, "SEATED"),
      entry(6, "OFFERED"),
    ])
    expect(result.map((item) => item.id)).toEqual([2, 4, 6])
  })
})

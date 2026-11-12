import { describe, expect, it } from "vitest"
import { mapFloorProjection, type BackendFloorTableProjection } from "@/services/http/floor-adapter"
import { MockGamApi } from "@/services/mock/server"

describe("HTTP floor birthday flag", () => {
  it.each(["BOOKED", "IN_USE"] as const)(
    "preserves the server flag for %s table and group claims",
    async (displayState) => {
      const catalog = await new MockGamApi().getCatalog()
      const startsAt = new Date("2026-11-09T15:00:00Z")
      const claim = {
        kind: displayState === "BOOKED" ? ("RESERVATION" as const) : ("VISIT" as const),
        reservationId: 11,
        visitId: displayState === "IN_USE" ? 21 : null,
        waitlistEntryId: null,
        holdId: null,
        guestName: "Birthday guest",
        phoneLast3: "123",
        partySize: 2,
        turnNo: null,
        flags: ["RETURNING", "BIRTHDAY"] as ("RETURNING" | "BIRTHDAY")[],
        groupId: 31,
        groupDisplayCode: "A",
        groupMemberTableIds: [13, 115],
        startsAt,
        deadlineAt: null,
        holdOverdue: false,
        paid: false,
        origin: null,
        sourceCode: "HOTLINE",
        version: 4,
      }
      const table: BackendFloorTableProjection = {
        tableId: 13,
        tableCode: "B5",
        catalogStatus: "ACTIVE",
        isSpare: false,
        displayState,
        arrivalPhase: null,
        arrivalTime: startsAt,
        minutesLate: 0,
        claim,
        groupId: 31,
        groupDisplayCode: "A",
        groupMemberTableIds: [13, 115],
        staleFromPreviousDay: false,
      }
      const floor = mapFloorProjection(
        {
          businessDate: "2026-11-09",
          serverNow: startsAt.toISOString(),
          changeSeq: "1",
          tables: [table],
          groups: [{ id: 31, symbolNo: 1, displayCode: "A", tableIds: [13, 115], displayState, claim }],
        },
        catalog,
      )
      expect(floor.tables[0].claim?.flags).toEqual(["RETURNING", "BIRTHDAY"])
      expect(floor.groups[0].claim?.flags).toEqual(["RETURNING", "BIRTHDAY"])
      expect(claim.flags).toEqual(["RETURNING", "BIRTHDAY"])
    },
  )
})

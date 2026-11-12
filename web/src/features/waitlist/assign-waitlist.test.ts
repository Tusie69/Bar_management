import { beforeEach, describe, expect, it, vi } from "vitest"
import type { WaitlistEntryView } from "@/domain/models"
import { api } from "@/services"
import { assignWaitlistTables } from "./assign-waitlist"

vi.mock("@/services", () => ({ api: { mode: "http", seatWaitlist: vi.fn() } }))

describe("waitlist table transfer", () => {
  beforeEach(() => vi.clearAllMocks())

  it.each(["WALK_IN", "ADVANCE_RESERVATION"] as const)("preserves %s arrival semantics", async (kind) => {
    const entry = { id: 7, version: 2, partySize: 4, kind } as WaitlistEntryView
    await assignWaitlistTables(entry, [3], "approved")
    expect(api.seatWaitlist).toHaveBeenCalledExactlyOnceWith({
      entryId: 7, version: 2, guestCount: 4, tableIds: [3], overrideReason: "approved",
      ...(kind === "WALK_IN" ? { arrived: true } : {}),
    })
  })
})

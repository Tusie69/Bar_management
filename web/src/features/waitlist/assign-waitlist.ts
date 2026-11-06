import type { WaitlistEntryView } from "@/domain/models"
import { api } from "@/services"

/** Waitlist -> real table: holds the table. It creates no Visit; check-in stays a separate step on arrival. */
export function assignWaitlistTables(entry: WaitlistEntryView, tableIds: number[], overrideReason?: string) {
  const guestCount = entry.partySize || 1
  if (api.mode === "http")
    return api.seatWaitlist({ entryId: entry.id, version: entry.version, guestCount, tableIds, overrideReason })
  return (async () => {
    if (!overrideReason) await api.claimWaitlist(entry.id, entry.version)
    const fresh = (await api.listWaitlist(entry.businessDate)).find((x) => x.id === entry.id) ?? entry
    return api.recordContact({
      entryId: entry.id,
      version: fresh.version,
      channel: "IN_PERSON",
      outcome: "ACCEPTED",
      offeredTableIds: tableIds,
      overrideReason,
    })
  })()
}

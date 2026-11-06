import type { WaitlistEntryView } from "@/domain/models"
import { api } from "@/services"

/** Present Walk-ins open a Visit; advance reservations hold tables until check-in. */
export function assignWaitlistTables(entry: WaitlistEntryView, tableIds: number[], overrideReason?: string) {
  const guestCount = entry.partySize || 1
  if (api.mode === "http")
    return api.seatWaitlist({ entryId: entry.id, version: entry.version, guestCount, tableIds, ...(entry.kind === "WALK_IN" ? { arrived: true } : {}), overrideReason })
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

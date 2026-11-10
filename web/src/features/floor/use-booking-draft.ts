/**
 * Floor side of the inline booking draft, shared by Điều phối and the phone map:
 * availability for the draft's date, which tables can be tapped, and what a tap does.
 */
import { useMemo } from "react"
import { toast } from "sonner"
import { useAvailability } from "@/hooks/use-data"
import { atBusinessTime } from "@/lib/time"
import { useUi } from "@/state/ui"
import { checkDirectTableCompatibility, draftPickable, type AvailabilityStatus } from "./quick-form"
import type { FloorModel } from "./use-floor-model"

import { layoutMembers } from "./layout-merge"

export function useBookingDraft(model: FloorModel) {
  const draft = useUi((s) => s.draft)
  const toggleDraftTable = useUi((s) => s.toggleDraftTable)
  const bookingDraft = draft?.kind === "booking" ? draft : null
  const date = bookingDraft?.date
  const time = bookingDraft?.time
  const at = useMemo(() => (date && time ? atBusinessTime(date, time) : null), [date, time])
  const availability = useAvailability(at, draft?.party ?? 2)
  const snapshot = availability.isPlaceholderData || availability.isError ? undefined : availability.data
  const availabilityMap = useMemo(() => new Map((snapshot?.tables ?? []).map((t) => [t.tableId, t])), [snapshot])
  // keepPreviousData would otherwise show the old date's answer as if it were this one.
  const status: AvailabilityStatus = !bookingDraft
    ? "ready"
    : availability.isError
      ? "error"
      : availability.isPlaceholderData || !availability.data
        ? "checking"
        : "ready"

  const pickable = useMemo(() => {
    if (!bookingDraft) return null
    const selected = bookingDraft.replacing ? [] : bookingDraft.tableIds
    const first = selected.length ? model.byId.get(selected[0]) : null
    if (selected.length && !first) return null
    const set = new Set<number>()
    for (const t of model.tables) {
      const members = layoutMembers(model, t.id)
      if (checkDirectTableCompatibility([...selected, ...members], model.byId, model.floor?.groups)) continue
      if (members.every((id) => draftPickable("booking", id, model, snapshot, selected))) set.add(t.id)
    }
    return set
  }, [bookingDraft, model, snapshot])

  const onTableClick = (id: number) => {
    if (!draft) return
    const selected = draft.replacing ? [] : draft.tableIds
    const members = layoutMembers(model, id)
    if (members.every((i) => selected.includes(i))) {
      return useUi.getState().setDraft({ tableIds: selected.filter((i) => !members.includes(i)), replacing: false })
    }
    const compatibility = checkDirectTableCompatibility([...selected, ...members], model.byId, model.floor?.groups)
    if (draft.kind === "booking" && compatibility) return toast.info(compatibility)
    if (members.every((i) => draftPickable(draft.kind, i, model, snapshot, selected))) {
      if (members.length === 1) return toggleDraftTable(id)
      return useUi.getState().setDraft({ tableIds: [...new Set([...selected, ...members])], replacing: false })
    }
    return toast.info(`${model.label(id)}: không trống · chọn vị trí trống`)
  }

  return { draft, bookingDraft, availability, availabilityMap, status, pickable, onTableClick }
}

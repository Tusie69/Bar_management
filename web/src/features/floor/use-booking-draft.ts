/**
 * Floor side of the inline booking draft, shared by Điều phối and the phone map:
 * availability for the draft's date, which tables can be tapped, and what a tap does.
 */
import { useMemo } from "react"
import { toast } from "sonner"
import { useAvailability } from "@/hooks/use-data"
import { atBusinessTime } from "@/lib/time"
import { useUi } from "@/state/ui"
import { draftPickable, type AvailabilityStatus } from "./quick-form"
import type { FloorModel } from "./use-floor-model"

export function useBookingDraft(model: FloorModel) {
  const draft = useUi((s) => s.draft)
  const toggleDraftTable = useUi((s) => s.toggleDraftTable)
  const bookingDraft = draft?.kind === "booking" ? draft : null
  const date = bookingDraft?.date
  const time = bookingDraft?.time
  const at = useMemo(() => (date && time ? atBusinessTime(date, time) : null), [date, time])
  const availability = useAvailability(at, draft?.party ?? 2)
  const availabilityMap = useMemo(
    () => new Map((availability.data?.tables ?? []).map((t) => [t.tableId, t])),
    [availability.data],
  )
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
      if (first && (t.zoneId !== first.zoneId || t.kind !== first.kind)) continue
      if (draftPickable("booking", t.id, model, availability.data, selected)) set.add(t.id)
    }
    return set
  }, [bookingDraft, model, availability.data])

  const onTableClick = (id: number) => {
    if (!draft) return
    const selected = draft.replacing ? [] : draft.tableIds
    if (selected.includes(id)) return toggleDraftTable(id)
    if (draft.kind === "booking" && selected.length > 0) {
      const first = model.byId.get(selected[0])
      const target = model.byId.get(id)
      if (first && target) {
        if (target.zoneId !== first.zoneId) return toast.info("Chỉ có thể chọn các bàn trong cùng một khu vực")
        if (target.kind !== first.kind) return toast.info("Không thể ghép bàn thường với ghế Bar")
      }
    }
    if (draftPickable(draft.kind, id, model, availability.data, selected) || draft.tableIds.includes(id))
      return toggleDraftTable(id)
    return toast.info(`${model.label(id)}: không trống · chọn vị trí trống`)
  }

  return { draft, bookingDraft, availability, availabilityMap, status, pickable, onTableClick }
}

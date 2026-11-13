import { useEffect, useMemo } from "react"
import type { FloorTableState, TableLiveState, TableView } from "@/domain/models"
import { useCatalog, useFloorState } from "@/hooks/use-data"
import type { BusinessDate } from "@/lib/time"
import { setTableCodeResolver } from "@/services/error-messages"

export function useFloorModel(businessDate?: BusinessDate) {
  const catalog = useCatalog()
  const floor = useFloorState(businessDate)
  const model = useMemo(() => {
    const snapshot = floor.isPlaceholderData || floor.isError ? undefined : floor.data
    const tables = catalog.data?.tables ?? []
    const byId = new Map<number, TableView>(tables.map((t) => [t.id, t]))
    const states = new Map<number, FloorTableState>((snapshot?.tables ?? []).map((t) => [t.tableId, t]))
    const counts = {} as Record<TableLiveState, number>
    // Physical positions: one per table/seat state. Merged-group dedup lives only in StatusLegend.
    for (const s of states.values()) counts[s.state] = (counts[s.state] ?? 0) + 1
    const codes = (ids: number[]) => ids.map((id) => byId.get(id)?.code ?? `#${id}`)
    const label = (id: number) => {
      const t = byId.get(id)
      if (!t) return `#${id}`
      return t.kind === "BAR_SEAT" ? `Bar ${t.seqNo}` : t.code
    }
    const freeIds = new Set(
      tables
        .filter((t) => {
          const st = states.get(t.id)?.state
          const zone = catalog.data?.zones.find((z) => z.id === t.zoneId)
          return (st === "free" || st === "spare") && zone?.isBookable
        })
        .map((t) => t.id),
    )
    return {
      loading: catalog.isLoading || floor.isLoading || floor.isPlaceholderData,
      error: catalog.error || floor.error,
      catalog: catalog.data,
      floor: snapshot,
      tables,
      byId,
      states,
      counts,
      codes,
      label,
      freeIds,
    }
  }, [catalog.data, floor.data, catalog.isLoading, floor.isLoading, floor.isPlaceholderData, floor.isError, catalog.error, floor.error])

  // Lets a server error name the tables it is complaining about.
  useEffect(() => {
    setTableCodeResolver((id) => model.byId.get(id)?.code ?? null)
    return () => setTableCodeResolver(null)
  }, [model])

  return model
}

export type FloorModel = ReturnType<typeof useFloorModel>

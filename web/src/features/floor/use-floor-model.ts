import { useMemo } from "react"
import type { FloorTableState, TableLiveState, TableView } from "@/domain/models"
import { useCatalog, useFloorState } from "@/hooks/use-data"

export function useFloorModel() {
  const catalog = useCatalog()
  const floor = useFloorState()
  return useMemo(() => {
    const tables = catalog.data?.tables ?? []
    const byId = new Map<number, TableView>(tables.map((t) => [t.id, t]))
    const states = new Map<number, FloorTableState>((floor.data?.tables ?? []).map((t) => [t.tableId, t]))
    const counts = {} as Record<TableLiveState, number>
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
      loading: catalog.isLoading || floor.isLoading,
      catalog: catalog.data,
      floor: floor.data,
      tables,
      byId,
      states,
      counts,
      codes,
      label,
      freeIds,
    }
  }, [catalog.data, floor.data, catalog.isLoading, floor.isLoading])
}

export type FloorModel = ReturnType<typeof useFloorModel>

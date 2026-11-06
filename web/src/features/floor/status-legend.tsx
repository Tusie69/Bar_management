import { STATE_META } from "@/components/status-meta"
import type { FloorTableState, TableView } from "@/domain/models"
import { countFloorStates } from "./floor-visual-rules"

export function StatusLegend({ tables, states }: { tables: TableView[]; states: Map<number, FloorTableState> }) {
  const counts = countFloorStates(tables, states)
  return (
    <ul aria-label="Chú giải trạng thái bàn" className="flex shrink-0 flex-wrap gap-x-3 gap-y-1 border-b px-3 py-1 text-xs">
      {[...counts].map(([state, count]) => {
        const { short, color, icon: Icon } = STATE_META[state]
        return (
          <li key={state} className="inline-flex items-center gap-1">
            <Icon aria-hidden="true" className="size-3" style={{ color }} />
            <span>{short}</span>
            <span className="tnum">{count}</span>
          </li>
        )
      })}
    </ul>
  )
}

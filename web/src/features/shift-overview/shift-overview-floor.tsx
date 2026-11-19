import { Eye } from "lucide-react"
import type { FloorGroup, FloorTableState, TableView, ZoneView } from "@/domain/models"
import { ReadOnlyFloorMap } from "@/features/floor/floor-canvas"
import { StatusLegend } from "@/features/floor/status-legend"
import { useCanViewMaskedCustomer } from "./shift-overview-hooks"

export interface ShiftOverviewFloorProps {
  tables: TableView[]
  states: Map<number, FloorTableState>
  zones?: ZoneView[]
  groups?: FloorGroup[]
  now: Date
}

export function ShiftOverviewFloor({ tables, states, zones = [], groups = [], now }: ShiftOverviewFloorProps) {
  const canViewGuestNames = useCanViewMaskedCustomer()

  return (
    <section
      className="so-panel so-panel--stretch"
      aria-labelledby="so-floor-heading"
      data-testid="shift-overview-floor"
      data-so-reveal
    >
      <div className="so-panel-header so-panel-header--bordered">
        <div className="so-panel-heading-group">
          <h2 id="so-floor-heading" className="so-panel-title">
            Sơ đồ bàn — chỉ xem
          </h2>
          <p className="so-panel-subtitle">Chủ quán không thao tác lên bàn của Lễ tân</p>
        </div>
        <div className="so-panel-header-actions">
          <span className="so-readonly-pill" aria-hidden="true">
            <Eye className="size-3.5" />
            <span>Chỉ xem</span>
          </span>
          <StatusLegend variant="admin" tables={tables} states={states} />
        </div>
      </div>

      <div className="so-floor-stage" data-testid="shift-overview-floor-stage">
        <ReadOnlyFloorMap
          tables={tables}
          zones={zones}
          states={states}
          groups={groups}
          now={now}
          canViewGuestNames={canViewGuestNames}
          ariaLabel="Sơ đồ bàn — chỉ xem"
        />
      </div>
    </section>
  )
}

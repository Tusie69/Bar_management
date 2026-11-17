import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { FLOOR_LEGEND_ITEMS, type FloorChipItem, type FloorZoneRow } from "./shift-overview-selectors"

function ReadOnlyTableChip({ chip }: { chip: FloorChipItem }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={chip.ariaLabel}
          title={chip.tooltipText}
          className={`so-chip so-chip--${chip.status}`}
          data-testid={`floor-chip-${chip.code}`}
          data-status={chip.status}
        >
          <span>{chip.code}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="so-tooltip-content">
        {chip.tooltipText}
      </TooltipContent>
    </Tooltip>
  )
}

export function ShiftOverviewFloor({ zones }: { zones: FloorZoneRow[] }) {
  return (
    <section
      className="so-panel so-panel--stretch"
      aria-labelledby="so-floor-heading"
      data-testid="shift-overview-floor"
    >
      <div className="so-panel-header">
        <div className="so-panel-heading-group">
          <h2 id="so-floor-heading" className="so-panel-title">
            Sơ đồ bàn — chỉ xem
          </h2>
          <p className="so-panel-subtitle">Chủ quán không thao tác lên bàn của Lễ tân</p>
        </div>
      </div>

      <div className="so-legend" role="list" aria-label="Chú giải trạng thái bàn">
        {FLOOR_LEGEND_ITEMS.map((item) => (
          <div key={item.status} className="so-legend-item" role="listitem">
            <span className="so-status-dot" style={{ backgroundColor: item.colorToken }} aria-hidden="true" />
            <span>{item.label}</span>
          </div>
        ))}
      </div>

      <div className="so-zones-list">
        {zones.map((zone) => (
          <div key={zone.zone} className="so-zone-block" data-testid={`floor-zone-${zone.zone}`}>
            <h3 className="so-zone-heading">{zone.heading}</h3>
            <div className="so-chip-grid" role="list" aria-label={`Bàn tại ${zone.heading}`}>
              {zone.chips.map((chip) => (
                <div key={chip.id} role="listitem">
                  <ReadOnlyTableChip chip={chip} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

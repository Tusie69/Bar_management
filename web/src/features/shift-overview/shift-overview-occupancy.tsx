import type { ZoneOccupancyItem } from "./shift-overview-selectors"

export function ShiftOverviewOccupancy({ items }: { items: ZoneOccupancyItem[] }) {
  return (
    <section className="so-panel" aria-labelledby="so-occupancy-heading" data-testid="shift-overview-occupancy">
      <div className="so-panel-header">
        <div className="so-panel-heading-group">
          <h2 id="so-occupancy-heading" className="so-panel-title">
            Tỷ lệ lấp bàn theo khu
          </h2>
          <p className="so-panel-subtitle">tính trên số chỗ đang dùng</p>
        </div>
      </div>

      <div className="so-occupancy-list">
        {items.map((item) => (
          <div key={item.zone} className="so-occupancy-row" data-testid={`occupancy-row-${item.zone}`}>
            <div className="so-occupancy-head">
              <span className="so-occupancy-label">{item.name}</span>
              <div className="so-occupancy-meta">
                <span className="so-occupancy-fraction">
                  {item.inUse}/{item.available} {item.unitLabel}
                </span>
                <span className="so-occupancy-percent">{item.percent}%</span>
              </div>
            </div>
            <div
              className="so-occupancy-track"
              role="meter"
              aria-label={`${item.name}: ${item.percent}% (${item.inUse} trên ${item.available} ${item.unitLabel} đang dùng)`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={item.percent}
              aria-valuetext={`${item.percent}% (${item.inUse}/${item.available} ${item.unitLabel})`}
            >
              <div className="so-occupancy-fill" style={{ width: `${item.percent}%` }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

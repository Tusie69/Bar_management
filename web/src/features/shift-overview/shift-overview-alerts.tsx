import { CheckCircle2 } from "lucide-react"
import type { OperationalAlertItem } from "./shift-overview-selectors"

export function ShiftOverviewAlerts({ alerts }: { alerts: OperationalAlertItem[] }) {
  return (
    <section
      className="so-panel so-panel--alerts"
      aria-labelledby="so-alerts-heading"
      data-testid="shift-overview-alerts"
      data-so-reveal
    >
      <div className="so-panel-header so-panel-header--bordered">
        <div className="so-panel-heading-group">
          <h2 id="so-alerts-heading" className="so-panel-title">
            Cảnh báo điều hành
          </h2>
          <p className="so-panel-subtitle">gom mọi việc cần xử lý trong ca</p>
        </div>
        {alerts.length > 0 ? (
          <span className="so-alerts-count" aria-label={`${alerts.length} cảnh báo`}>
            {alerts.length}
          </span>
        ) : null}
      </div>

      {alerts.length === 0 ? (
        <div className="so-alerts-empty" role="status" data-testid="alerts-empty-state">
          <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
          <span>Không có cảnh báo</span>
        </div>
      ) : (
        <div className="so-alerts-scroll-shell">
          <ul className="so-alert-list" tabIndex={0} aria-label="Danh sách cảnh báo điều hành">
            {alerts.map((alert) => (
              <li
                key={alert.key}
                className={`so-alert-card so-alert-card--${alert.severityType}`}
                data-testid={`alert-item-${alert.key}`}
              >
                <span className={`so-alert-dot so-alert-dot--${alert.severityType}`} aria-hidden="true" />
                <div className="so-alert-body">
                  <div className="so-alert-title-row">
                    <span className={`so-alert-badge so-alert-badge--${alert.severityType}`}>
                      {alert.severityLabel}
                    </span>
                    <span className="so-alert-title">{alert.title}</span>
                  </div>
                  <span className="so-alert-detail">{alert.detail}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

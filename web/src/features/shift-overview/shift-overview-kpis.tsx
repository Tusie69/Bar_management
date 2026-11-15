import { Activity, AlertTriangle, Info, PencilLine } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { OverviewKpiCard } from "./shift-overview-selectors"

function KpiCardItem({ card }: { card: OverviewKpiCard }) {
  const valueClassName = [
    "so-kpi-value",
    card.isUnentered ? "so-kpi-value--unentered" : "",
    !card.isUnentered && card.tone === "inuse" ? "so-kpi-value--inuse" : "",
    !card.isUnentered && card.tone === "soon" ? "so-kpi-value--soon" : "",
    !card.isUnentered && card.tone === "danger" ? "so-kpi-value--danger" : "",
  ]
    .filter(Boolean)
    .join(" ")

  const isSystem = card.sourceKind === "system"

  return (
    <article
      className="so-kpi-card"
      data-testid={`kpi-card-${card.id}`}
      data-source-kind={card.sourceKind}
      aria-label={`${card.title}: ${card.displayValue}`}
    >
      <div className="so-kpi-top">
        <div className="so-kpi-title-row">
          <span className="so-kpi-title">{card.title}</span>
          {card.warningTooltip ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="so-warning-trigger"
                  aria-label={card.warningTooltip}
                  data-testid="kpi-mismatch-warning"
                >
                  <AlertTriangle className="size-3.5" aria-hidden="true" />
                  <span>Lệch</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="so-tooltip-content">
                {card.warningTooltip}
              </TooltipContent>
            </Tooltip>
          ) : card.infoTooltip ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="so-info-trigger"
                  aria-label={card.infoTooltip}
                  title={card.infoTooltip}
                  data-testid={`kpi-info-${card.id}`}
                >
                  <Info className="size-3.5" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="so-tooltip-content">
                {card.infoTooltip}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
        <span className="so-kpi-caption">
          {card.description ? `${card.caption} · ${card.description}` : card.caption}
        </span>
        {card.subcaption ? <span className="so-kpi-subcaption">{card.subcaption}</span> : null}
      </div>

      <div className="so-kpi-middle">
        <span className={valueClassName} data-testid={`kpi-value-${card.id}`}>
          {card.displayValue}
        </span>
      </div>

      <div className="so-kpi-footer">
        <span
          className={`so-source-note ${isSystem ? "so-source-note--system" : ""}`}
          title={card.sourceNote}
        >
          {isSystem ? (
            <Activity className="size-3 shrink-0" aria-hidden="true" />
          ) : (
            <PencilLine className="size-3 shrink-0" aria-hidden="true" />
          )}
          <span>{card.sourceNote}</span>
        </span>
      </div>
    </article>
  )
}

export function ShiftOverviewKpis({
  row1,
  row2,
}: {
  row1: OverviewKpiCard[]
  row2: OverviewKpiCard[]
}) {
  return (
    <>
      <section className="so-kpi-row-1" aria-label="Chỉ số tổng quan ca">
        {row1.map((card) => (
          <KpiCardItem key={card.id} card={card} />
        ))}
      </section>
      <section className="so-kpi-row-2" aria-label="Phân loại khách trong ca">
        {row2.map((card) => (
          <KpiCardItem key={card.id} card={card} />
        ))}
      </section>
    </>
  )
}

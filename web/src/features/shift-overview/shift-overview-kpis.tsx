import { Activity, AlertTriangle, Info, PencilLine } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { OverviewKpiCard } from "./shift-overview-selectors"

function resolveAccentKind(card: OverviewKpiCard): string {
  if (!card.isUnentered && card.tone === "danger") return "danger"
  if (!card.isUnentered && card.tone === "inuse") return "inuse"
  if (!card.isUnentered && card.tone === "soon") return "soon"
  if (card.sourceKind === "system") return "system"
  return "manual"
}

function KpiCardItem({ card, tier }: { card: OverviewKpiCard; tier: "primary" | "secondary" }) {
  const valueClassName = [
    "so-kpi-value",
    tier === "secondary" ? "so-kpi-value--secondary" : "",
    card.isUnentered ? "so-kpi-value--unentered" : "",
    !card.isUnentered && card.tone === "inuse" ? "so-kpi-value--inuse" : "",
    !card.isUnentered && card.tone === "soon" ? "so-kpi-value--soon" : "",
    !card.isUnentered && card.tone === "danger" ? "so-kpi-value--danger" : "",
  ]
    .filter(Boolean)
    .join(" ")

  const isSystem = card.sourceKind === "system"
  const accent = resolveAccentKind(card)

  return (
    <article
      className={`so-kpi-card so-kpi-card--${tier}`}
      data-testid={`kpi-card-${card.id}`}
      data-source-kind={card.sourceKind}
      data-accent={accent}
      data-unentered={card.isUnentered ? "true" : "false"}
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
                  <span className="so-info-glyph" aria-hidden="true">
                    <Info className="size-3.5" />
                  </span>
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
        <span className={`so-source-note ${isSystem ? "so-source-note--system" : ""}`} title={card.sourceNote}>
          {isSystem ? (
            <Activity className="size-3 shrink-0" aria-hidden="true" />
          ) : (
            <PencilLine className="size-3 shrink-0" aria-hidden="true" />
          )}
          <span className="truncate">{card.sourceNote}</span>
        </span>
      </div>
    </article>
  )
}

export function ShiftOverviewKpis({ row1, row2 }: { row1: OverviewKpiCard[]; row2: OverviewKpiCard[] }) {
  return (
    <>
      <section className="so-kpi-row-1" aria-label="Chỉ số tổng quan ca" data-so-reveal>
        {row1.map((card) => (
          <KpiCardItem key={card.id} card={card} tier="primary" />
        ))}
      </section>
      <section className="so-kpi-row-2" aria-label="Phân loại khách trong ca" data-so-reveal>
        {row2.map((card) => (
          <KpiCardItem key={card.id} card={card} tier="secondary" />
        ))}
      </section>
    </>
  )
}

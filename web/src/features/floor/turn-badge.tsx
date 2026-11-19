/**
 * TurnBadge - Presentational badge showing the table turn count on the floor map.
 * Follows HU-32 H4 with Nam's & Hưng's decisions:
 * - Black circle (or capsule for 2+ digits), white number
 * - Positioned at top-right corner of a cell
 * - Shows from the SECOND turn only (2, 3, ...): the first turn of the day is
 *   the normal case and needs no badge (chốt với Hưng 12/11/2026)
 * - Absent, null, undefined, 0, 1, or negative renders nothing (returns null)
 * - Readable at the smallest map scale (high-contrast black fill, white text, bold font)
 *
 * Props:
 * - count?: number | null - Turn count (e.g. seatedTurnCount / currentTurnNo). If null/undefined/<2, renders nothing.
 * - x?: number, y?: number - Position coordinates in SVG context (anchored to top-right of cell via getTableCornerGeometry).
 * - as?: "svg" | "html" - Render mode (default "svg").
 * - size?: number - Circle radius in SVG mode (default TURN_BADGE_RADIUS = 5.5) or size in HTML mode (default 16).
 * - className?: string - Additional CSS classes.
 * - data-testid?: string - Optional test identifier.
 */

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { TURN_BADGE_RADIUS, TURN_BADGE_STROKE, turnBadgeWidth } from "./floor-visual-rules"

export interface TurnBadgeProps {
  /**
   * Turn number (seatedTurnCount or turn ordinal).
   * Renders from 2 upwards. The first turn of the business day carries no badge.
   * If null, undefined, below 2, or NaN, renders nothing (null).
   */
  count?: number | null
  /** Position coordinates in SVG context. */
  x?: number
  y?: number
  /** Render mode: "svg" (default SVG <g>) or "html" (HTML <span>). */
  as?: "svg" | "html"
  /** Radius in SVG mode (default TURN_BADGE_RADIUS = 5.5) or height in HTML mode (default 16). */
  size?: number
  /** Additional CSS class names. */
  className?: string
  /** Optional test identifier. */
  "data-testid"?: string
}

export function TurnBadge({
  count,
  x = 0,
  y = 0,
  as = "svg",
  size,
  className,
  "data-testid": testId = "turn-badge",
}: TurnBadgeProps): ReactNode {
  // Shows from 2 upwards. Absent, null, or <2 renders nothing.
  if (count === null || count === undefined || typeof count !== "number" || Number.isNaN(count) || count < 2) {
    return null
  }

  const label = `Lượt ${count}`

  if (as === "html") {
    const s = size ?? 16
    return (
      <span
        className={cn(
          "turn-badge-html pointer-events-none inline-flex items-center justify-center rounded-full border border-white/90 bg-black text-[9px] leading-none font-extrabold text-white tabular-nums shadow-xs select-none",
          count >= 10 && "px-1",
          className,
        )}
        style={{ minWidth: s, height: s }}
        aria-label={label}
        data-testid={testId}
      >
        {count}
      </span>
    )
  }

  // SVG mode: black disc (or pill for 2+ digits), white number, readable at smallest scale
  const r = size ?? TURN_BADGE_RADIUS
  const isMultiDigit = count >= 10
  const pillW = isMultiDigit ? turnBadgeWidth(count, r) : r * 2
  const fontSize = count >= 100 ? r * 1.08 : isMultiDigit ? r * 1.2 : r * 1.32
  const textY = count >= 100 ? r * 0.36 : isMultiDigit ? r * 0.4 : r * 0.44

  return (
    <g
      transform={`translate(${x} ${y})`}
      role="img"
      className={cn("turn-badge-svg select-none", className)}
      aria-label={label}
      data-testid={testId}
      pointerEvents="none"
    >
      {/* Black disc/pill with thin white border for strong separation against dark/light tables */}
      {isMultiDigit ? (
        <rect
          x={-pillW / 2}
          y={-r}
          width={pillW}
          height={r * 2}
          rx={r}
          fill="#000000"
          stroke="#ffffff"
          strokeWidth={TURN_BADGE_STROKE}
        />
      ) : (
        <circle r={r} fill="#000000" stroke="#ffffff" strokeWidth={TURN_BADGE_STROKE} />
      )}
      <text
        y={textY}
        textAnchor="middle"
        fontSize={fontSize}
        fontWeight={800}
        fill="#ffffff"
        fontFamily="var(--font-sans, system-ui, sans-serif)"
        letterSpacing={-0.35}
        className="tabular-nums select-none"
      >
        {count}
      </text>
    </g>
  )
}

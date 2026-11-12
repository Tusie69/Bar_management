/**
 * TurnBadge - Presentational badge showing the table turn count on the floor map.
 * Follows HU-32 H4 with Nam's decisions:
 * - Black circle, white number
 * - Positioned at bottom-left of a cell
 * - Shows from the SECOND turn only (2, 3, ...): the first turn of the day is
 *   the normal case and needs no badge (chốt với Hưng 12/11/2026)
 * - Absent, null, undefined, 0, or negative renders nothing (returns null)
 * - Readable at the smallest map scale (high-contrast black fill, white text, bold font)
 *
 * Props:
 * - count?: number | null - Turn count (e.g. seatedTurnCount / currentTurnNo). If null/undefined/<=0, renders nothing.
 * - x?: number, y?: number - Position coordinates in SVG context (anchored to bottom-left of cell: -hw, hh).
 * - as?: "svg" | "html" - Render mode (default "svg").
 * - size?: number - Circle radius in SVG mode (default 5.8) or size in HTML mode (default 13.5).
 * - className?: string - Additional CSS classes.
 * - data-testid?: string - Optional test identifier.
 */

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

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
  /** Radius in SVG mode (default 5.8) or diameter in HTML mode (default 13.5). */
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
  // Shows from 1, not from 2. Absent or null renders nothing.
  if (count === null || count === undefined || typeof count !== "number" || Number.isNaN(count) || count < 2) {
    return null
  }

  const label = `Lượt ${count}`

  if (as === "html") {
    const s = size ?? 14
    return (
      <span
        className={cn(
          "turn-badge-html inline-flex items-center justify-center rounded-full bg-black text-white font-extrabold text-[9px] tabular-nums shadow-xs border border-white/90 select-none pointer-events-none",
          className,
        )}
        style={{ width: s, height: s }}
        aria-label={label}
        data-testid={testId}
      >
        {count}
      </span>
    )
  }

  // SVG mode: black circle, white number, readable at smallest scale
  const r = size ?? 5.8
  return (
    <g
      transform={`translate(${x} ${y})`}
      role="img"
      className={cn("turn-badge-svg select-none", className)}
      aria-label={label}
      data-testid={testId}
      pointerEvents="none"
    >
      {/* Black circle with thin white border for strong separation against dark/light tables */}
      <circle
        r={r}
        fill="#000000"
        stroke="#ffffff"
        strokeWidth={0.85}
      />
      <text
        y={r * 0.44}
        textAnchor="middle"
        fontSize={r * 1.3}
        fontWeight={800}
        fill="#ffffff"
        fontFamily="var(--font-sans, system-ui, sans-serif)"
        letterSpacing={-0.3}
        className="tabular-nums select-none"
      >
        {count}
      </text>
    </g>
  )
}

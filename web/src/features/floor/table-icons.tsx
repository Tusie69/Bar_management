/**
 * TableIcons - Presentational component for small icons overlapping the top right of a table cell.
 * Follows HU-32 H4 with Nam's decisions:
 * - 4 supported icons:
 *     star: Bàn sếp (VIP / Boss table)
 *     fire: Khách quen (Regular / Returning customer)
 *     pin:  Chỉ định (Designated table)
 *     cake: Sinh nhật (Birthday customer)
 * - Multiple icons show together in one small row anchored at the top-right
 * - Icons sit on the top border, never covering the center table code
 * - Empty input renders nothing (returns null)
 *
 * Props:
 * - iconKeys?: TableIconKey[] | null - Array of icon keys ("star", "fire", "pin", "cake" or domain flags).
 * - icons?: TableIconKey[] | null - Alias for iconKeys.
 * - x?: number, y?: number - Position coordinates in SVG context (anchored to cell top-right: hw, -hh).
 * - as?: "svg" | "html" - Render mode (default "svg").
 * - className?: string - Additional CSS classes.
 * - data-testid?: string - Optional test identifier.
 */

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { normalizeIconKey } from "./floor-visual-rules"

export type TableIconKey =
  | "star"
  | "fire"
  | "pin"
  | "cake"
  | "new"
  | "VIP"
  | "RETURNING"
  | "DESIGNATED"
  | "BIRTHDAY"
  | "NEW"
  | string

export interface TableIconMeta {
  key: "star" | "fire" | "pin" | "cake" | "new"
  glyph: string
  label: string
}

const TABLE_ICON_DEFS: Record<"star" | "fire" | "pin" | "cake" | "new", TableIconMeta> = {
  star: { key: "star", glyph: "⭐", label: "Bàn sếp" },
  fire: { key: "fire", glyph: "🔥", label: "Khách quen" },
  pin: { key: "pin", glyph: "📌", label: "Chỉ định" },
  cake: { key: "cake", glyph: "🎂", label: "Sinh nhật" },
  new: { key: "new", glyph: "🆕", label: "Khách mới" },
}

export interface TableIconsProps {
  /** Array of icon keys to display. */
  iconKeys?: TableIconKey[] | null
  /** Alias for iconKeys. */
  icons?: TableIconKey[] | null
  /** Position coordinates in SVG mode (anchored to corner of cell). */
  x?: number
  y?: number
  /** Expansion direction when multiple icons are present ("left" default, or "right"). */
  direction?: "left" | "right"
  /** Optional circle radius in SVG mode (default 5.2). */
  radius?: number
  /** Render mode: "svg" (default SVG <g>) or "html" (HTML <div>). */
  as?: "svg" | "html"
  /** Additional CSS classes. */
  className?: string
  /** Optional test identifier. */
  "data-testid"?: string
}

export function TableIcons({
  iconKeys,
  icons,
  x = 0,
  y = 0,
  direction = "left",
  radius = 5.2,
  as = "svg",
  className,
  "data-testid": testId = "table-icons",
}: TableIconsProps): ReactNode {
  const rawList = iconKeys ?? icons
  if (!rawList || !Array.isArray(rawList) || rawList.length === 0) {
    return null
  }

  // Deduplicate and resolve normalized metadata in fixed priority order
  const resolvedKeys = new Set<"star" | "fire" | "pin" | "cake" | "new">()
  for (const item of rawList) {
    if (!item) continue
    const norm = normalizeIconKey(String(item))
    if (norm) resolvedKeys.add(norm)
  }

  // Never render both "fire" (regular) and "new" (new guest) together
  if (resolvedKeys.has("fire") && resolvedKeys.has("new")) {
    resolvedKeys.delete("new")
  }

  if (resolvedKeys.size === 0) {
    return null
  }

  // Desired ordering: star > fire > new > pin > cake
  const priorityOrder: Array<"star" | "fire" | "new" | "pin" | "cake"> = ["star", "fire", "new", "pin", "cake"]
  const activeItems: TableIconMeta[] = []
  for (const k of priorityOrder) {
    if (resolvedKeys.has(k)) {
      activeItems.push(TABLE_ICON_DEFS[k])
    }
  }

  const combinedLabel = activeItems.map((item) => item.label).join(", ")

  if (as === "html") {
    return (
      <div
        className={cn(
          "table-icons-container inline-flex items-center gap-0.5 pointer-events-none select-none",
          className,
        )}
        role="group"
        aria-label={combinedLabel}
        data-testid={testId}
      >
        {activeItems.map((item) => (
          <span
            key={item.key}
            className="inline-flex size-3.5 items-center justify-center rounded-full bg-background border border-border shadow-2xs text-[8.5px] leading-none"
            title={item.label}
            aria-label={item.label}
            data-icon={item.key}
          >
            {item.glyph}
          </span>
        ))}
      </div>
    )
  }

  const step = 12
  const sign = direction === "right" ? 1 : -1
  return (
    <g
      transform={`translate(${x} ${y})`}
      className={cn("table-icons-svg select-none", className)}
      role="group"
      aria-label={combinedLabel}
      data-testid={testId}
      pointerEvents="none"
    >
      {activeItems.map((item, index) => {
        const offsetX = index * step * sign
        return (
          <g
            key={item.key}
            transform={`translate(${offsetX} 0)`}
            role="img"
            aria-label={item.label}
            data-icon={item.key}
          >
            <circle
              r={radius}
              fill="var(--background, #ffffff)"
              stroke="var(--border-strong, #b4b2a9)"
              strokeWidth={0.8}
            />
            <text
              y={radius * 0.5}
              textAnchor="middle"
              fontSize={radius * 1.35}
              fontFamily="Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif"
            >
              {item.glyph}
            </text>
          </g>
        )
      })}
    </g>
  )
}

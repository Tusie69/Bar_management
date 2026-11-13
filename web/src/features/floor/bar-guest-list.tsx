/**
 * BarGuestList - Presentational guest list component sitting inside
 * the empty inner rectangle of the bar zone ("Khu pha chế" area).
 *
 * Implements M1 requirements:
 * - Title "Khách quầy bar" 12-13px, medium bold.
 * - Content 10-12px, line height 1.3-1.4, small padding, not touching the frame.
 * - Long names wrap to at most 2 lines with min-width: 0, overflow-wrap, line-clamp.
 * - No white-space: nowrap on the whole row.
 * - Internal scrolling when long, nothing overflows the frame.
 * - Scales to real screen pixels via mapScale prop counter-scaling.
 * - Accessible list semantics with full name in aria-label and status icon cues.
 * - Configurable empty state ("title-only" or "hidden").
 */

import { Users } from "lucide-react"
import { useEffect, useMemo, useRef, type CSSProperties, type ReactElement } from "react"
import { STATE_META } from "@/components/status-meta"
import type { FloorGroup, FloorTableState, TableView } from "@/domain/models"
import { cn } from "@/lib/utils"
import { buildBarGuestRows, DEFAULT_BAR_GUEST_LIST_BOUNDS, type BarGuestRow } from "./bar-guest-rows"

export interface BarGuestListProps {
  /** Floor tables to derive bar rows from */
  tables?: TableView[]
  /** Live states for tables */
  states?: Map<number, FloorTableState> | FloorTableState[] | null
  /** Floor groups */
  groups?: FloorGroup[] | null
  /** Pre-computed rows (takes precedence over tables & states if provided) */
  rows?: BarGuestRow[]
  /** Current zoom/fit scale factor (view.k in FloorCanvas) for real screen pixel rendering */
  mapScale?: number
  /** Bounds inside SVG floor space (defaults to DEFAULT_BAR_GUEST_LIST_BOUNDS) */
  x?: number
  y?: number
  width?: number
  height?: number
  /** Render as SVG <foreignObject> (default) or standalone HTML <div> */
  as?: "svg" | "html"
  /** Empty state behavior when no rows are active: "title-only" (default) or "hidden" */
  emptyState?: "title-only" | "hidden"
  /** Title text (defaults to "Khách quầy bar") */
  title?: string
  /** Contextual accessible name when multiple floor maps are exposed. */
  ariaLabel?: string
  /** Click handler for selecting a row */
  onRowClick?: (row: BarGuestRow) => void
  /** Additional CSS class names */
  className?: string
  /** Optional test identifier */
  "data-testid"?: string
}

export function BarGuestList({
  tables,
  states,
  groups,
  rows: directRows,
  mapScale = 1,
  x = DEFAULT_BAR_GUEST_LIST_BOUNDS.x,
  y = DEFAULT_BAR_GUEST_LIST_BOUNDS.y,
  width = DEFAULT_BAR_GUEST_LIST_BOUNDS.width,
  height = DEFAULT_BAR_GUEST_LIST_BOUNDS.height,
  as = "svg",
  emptyState = "title-only",
  title = "Khách quầy bar",
  ariaLabel = title,
  onRowClick,
  className,
  "data-testid": testId = "bar-guest-list",
}: BarGuestListProps): ReactElement | null {
  const rows = useMemo(() => {
    if (directRows) return directRows
    if (tables) return buildBarGuestRows(tables, states, groups)
    return []
  }, [directRows, tables, states, groups])

  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const stopNative = (e: Event) => {
      e.stopPropagation()
    }
    el.addEventListener("wheel", stopNative, { passive: true })
    el.addEventListener("pointerdown", stopNative, { passive: true })
    el.addEventListener("pointermove", stopNative, { passive: true })
    el.addEventListener("pointerup", stopNative, { passive: true })
    el.addEventListener("touchstart", stopNative, { passive: true })
    el.addEventListener("touchmove", stopNative, { passive: true })
    el.addEventListener("touchend", stopNative, { passive: true })
    return () => {
      el.removeEventListener("wheel", stopNative)
      el.removeEventListener("pointerdown", stopNative)
      el.removeEventListener("pointermove", stopNative)
      el.removeEventListener("pointerup", stopNative)
      el.removeEventListener("touchstart", stopNative)
      el.removeEventListener("touchmove", stopNative)
      el.removeEventListener("touchend", stopNative)
    }
  }, [])

  if (rows.length === 0 && emptyState === "hidden") {
    return null
  }

  // Counter-scaling: inside an SVG <foreignObject>, an element scaled by (1 / mapScale)
  // renders at 1:1 screen pixels because the outer SVG scales it by mapScale.
  const scale = Math.max(0.1, mapScale || 1)
  const isSvg = as === "svg"

  // In SVG mode, the inner content dimensions are in real screen pixels:
  const innerPixelWidth = isSvg ? Math.round(width * scale) : width
  const innerPixelHeight = isSvg ? Math.round(height * scale) : height

  const containerStyle: CSSProperties = isSvg
    ? {
        width: `${innerPixelWidth}px`,
        height: `${innerPixelHeight}px`,
        transform: `scale(${1 / scale})`,
        transformOrigin: "top left",
      }
    : {
        width: `${width}px`,
        height: `${height}px`,
      }

  const content = (
    <div
      ref={containerRef}
      data-testid={testId}
      style={containerStyle}
      className={cn(
        "flex flex-col select-none overflow-hidden rounded-md border border-border/80 bg-card/95 text-card-foreground shadow-xs backdrop-blur-xs pointer-events-auto",
        className,
      )}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onPointerCancel={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
      onTouchEnd={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      {/* Title bar: 12-13px, medium bold, line-height 1.3-1.4 */}
      <div className="shrink-0 border-b border-border/60 px-2 py-1 bg-muted/30">
        <div className="text-[12px] font-semibold leading-[1.3] tracking-tight text-foreground break-words">
          {title}
        </div>
      </div>

      {/* Guest list with internal scroll */}
      <div
        role="region"
        tabIndex={0}
        aria-label={ariaLabel}
        className="flex-1 overflow-y-auto overflow-x-hidden p-1 space-y-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-border-strong [&::-webkit-scrollbar-thumb]:rounded touch-pan-y overscroll-contain"
      >
        {rows.length === 0 ? (
          <div
            data-testid="bar-guest-list-empty"
            className="flex h-full items-center justify-center p-2 text-center text-[11px] italic text-muted-foreground/70 leading-[1.35]"
          >
            Chưa có khách
          </div>
        ) : (
          <ul
            role="list"
            aria-label="Danh sách khách quầy bar"
            className="space-y-1"
          >
            {rows.map((row) => {
              const meta = STATE_META[row.state] ?? STATE_META.free
              const statusColor = meta.color
              const statusLabel = meta.label
              const statusShort = meta.short

              // Collect active metadata icons in standard priority order
              const activeIcons: { key: string; emoji: string; label: string }[] = []
              if (row.icons.cake) activeIcons.push({ key: "cake", emoji: "🎂", label: "Sinh nhật" })
              if (row.icons.vip) activeIcons.push({ key: "vip", emoji: "⭐", label: "VIP" })
              if (row.icons.returning) activeIcons.push({ key: "returning", emoji: "🔥", label: "Đã từng đặt bàn" })
              if (row.icons.newGuest) activeIcons.push({ key: "newGuest", emoji: "🆕", label: "Chưa từng đặt bàn" })
              if (row.icons.pin) activeIcons.push({ key: "pin", emoji: "📌", label: "Chỉ định" })

              // Display at most 2 icons + (+N) marker; full list in accessible label
              const maxVisibleIcons = 2
              const visibleIcons = activeIcons.slice(0, maxVisibleIcons)
              const overflowIcons = activeIcons.slice(maxVisibleIcons)
              const overflowCount = overflowIcons.length
              const overflowLabels = overflowIcons.map((i) => i.label).join(", ")
              const allIconLabels = activeIcons.map((i) => i.label).join(", ")

              const rowAriaLabel = [
                row.seatsLabel,
                row.time ? `lúc ${row.time}` : row.seatedTime ? `vào lúc ${row.seatedTime}` : "",
                `${row.partySize} khách`,
                row.guestName,
                allIconLabels,
                `Trạng thái: ${statusLabel}`,
              ]
                .filter(Boolean)
                .join(", ")

              return (
                <li
                  key={row.bookingKey}
                  role="listitem"
                  className="rounded text-[10.5px] leading-[1.25] overflow-hidden min-w-0"
                >
                  <button
                    type="button"
                    onClick={() => onRowClick?.(row)}
                    aria-label={rowAriaLabel}
                    className={cn(
                      "flex flex-col w-full text-left rounded px-0.5 py-0.5 transition-colors space-y-0.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring overflow-hidden min-w-0",
                      onRowClick ? "cursor-pointer hover:bg-muted/60" : "hover:bg-muted/30 cursor-default",
                    )}
                  >
                    {/* Line 1: seats & metadata icons */}
                    <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 min-w-0 w-full">
                      <span className="inline-flex items-center gap-1 min-w-0 max-w-full">
                        <span
                          className="inline-block size-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: statusColor }}
                          aria-hidden="true"
                        />
                        <span className="font-semibold text-foreground text-[10px] tracking-tight break-words">
                          {row.seatsLabel}
                        </span>
                      </span>

                      {/* Metadata icons: wrap to own line when needed, show max 2 + marker */}
                      {activeIcons.length > 0 && (
                        <span className="inline-flex items-center gap-0.5 min-w-0 text-[9px] ml-auto shrink-0">
                          {visibleIcons.map((icon) => (
                            <span key={icon.key} title={icon.label} aria-label={icon.label}>
                              {icon.emoji}
                            </span>
                          ))}
                          {overflowCount > 0 && (
                            <span
                              title={overflowLabels}
                              aria-label={`và ${overflowCount} mục khác: ${overflowLabels}`}
                              className="text-[9px] font-semibold text-muted-foreground/80 select-none"
                            >
                              {`+${overflowCount}`}
                            </span>
                          )}
                          {overflowIcons.length > 0 && (
                            <span className="sr-only">
                              {overflowIcons.map((icon) => (
                                <span key={icon.key} title={icon.label} aria-label={icon.label}>
                                  {icon.emoji}
                                </span>
                              ))}
                            </span>
                          )}
                        </span>
                      )}
                      <span className="sr-only">{` (${statusShort})`}</span>
                    </div>

                    {/* Line 2: time and guest count (count never clipped) */}
                    <div className="flex items-center gap-0.5 text-[10px] text-muted-foreground min-w-0 w-full font-medium tracking-tight">
                      {row.time || row.seatedTime ? (
                        <>
                          <span className="shrink-0">
                            {/* "vào" marks an entry time, so a walk-in row is never
                                read as if the guest had booked that hour. */}
                            {row.time ?? `vào ${row.seatedTime}`}
                          </span>
                          <span className="text-muted-foreground/60 select-none shrink-0 text-[9px]">·</span>
                          <span className="inline-flex items-center gap-0.5 shrink-0">
                            <Users className="size-2 opacity-70 shrink-0" aria-hidden="true" />
                            <span className="shrink-0">{row.partySize}</span>
                          </span>
                        </>
                      ) : (
                        <span className="inline-flex items-center gap-0.5 shrink-0">
                          <Users className="size-2 opacity-70 shrink-0" aria-hidden="true" />
                          <span className="shrink-0">{row.partySize} khách</span>
                        </span>
                      )}
                    </div>

                    {/* Line 3: name with an ellipsis */}
                    <div
                      className="truncate font-medium text-foreground text-[10.5px] min-w-0 w-full"
                      title={row.guestName}
                    >
                      {row.guestName}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )

  if (isSvg) {
    return (
      <foreignObject
        x={x}
        y={y}
        width={width}
        height={height}
        className="overflow-hidden pointer-events-auto"
        data-testid={`${testId}-foreign-object`}
      >
        {content}
      </foreignObject>
    )
  }

  return content
}

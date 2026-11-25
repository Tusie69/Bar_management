/**
 * BarGuestList - Presentational guest list component sitting inside
 * the empty inner rectangle of the bar zone ("Khu pha chế" area).
 *
 * Implements M1 requirements:
 * - Title "Khách quầy bar" 12-13px, medium bold.
 * - Content 10-12px, line height 1.3-1.4, small padding, not touching the frame.
 * - Mỗi khách một dòng: ghế, giờ, số khách rồi tên khách ở cuối dòng.
 * - Tên khách dài thì cắt bớt bằng truncate (vẫn xem đủ qua title/aria-label).
 * - Internal scrolling when long, nothing overflows the frame.
 * - Scales to real screen pixels via mapScale prop counter-scaling.
 * - Accessible list semantics with full name in aria-label and status icon cues.
 * - Configurable empty state ("title-only" or "hidden").
 */

import { Users } from "lucide-react"
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from "react"
import { STATE_META } from "@/components/status-meta"
import type { FloorGroup, FloorTableState, TableView } from "@/domain/models"
import { cn } from "@/lib/utils"
import {
  buildBarGuestRows,
  DEFAULT_BAR_GUEST_LIST_BOUNDS,
  isPhoneLikeGuestName,
  type BarGuestRow,
} from "./bar-guest-rows"

/**
 * Chiều cao thật của từng phần, tính bằng pixel màn hình (xem markup bên dưới).
 *
 * Đây chỉ là ước lượng cho lần vẽ đầu (và cho render phía máy chủ); sau khi gắn
 * vào DOM thì chiều cao được đo thật bằng ResizeObserver, nên tên khách dài
 * xuống hai dòng cũng không bị cắt.
 */
// tiêu đề: py-1.5 (12) + 12px * 1.3 + viền dưới 1
const HEADER_PIXEL_HEIGHT = 29
// một dòng khách gồm thông tin ghế/giờ/số khách và tên khách: py-1 (8) + 2 dòng 12px * 1.35
const ROW_BASE_PIXEL_HEIGHT = 40
// divide-y giữa hai dòng
const ROW_DIVIDER_PIXEL_HEIGHT = 1

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
  /**
   * Co chiều cao về đúng số dòng đang có, thay vì luôn chiếm trọn `height`.
   *
   * Dùng cho điện thoại: khung mặc định rộng 166 x 334 trong hệ toạ độ sơ đồ
   * 374 x 732, tức 44% chiều ngang và 46% chiều cao bản vẽ. Trên màn hình to
   * đó là khoảng trống của khu pha chế; trên điện thoại nó là một mảng trắng
   * che gần nửa sơ đồ, và khi chưa có khách thì che chỗ mà không nói gì.
   */
  fitToRows?: boolean
  /** Title text (defaults to "Khách quầy bar") */
  title?: string
  /** Contextual accessible name when multiple floor maps are exposed. */
  ariaLabel?: string
  /** Click handler for selecting a row */
  onRowClick?: (row: BarGuestRow) => void
  /** Read-only mode: render static non-interactive rows (never <button>) and ignore clicks. */
  readOnly?: boolean
  /** Redact guest names from text, title, and accessible labels. */
  hideGuestNames?: boolean
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
  fitToRows = false,
  title = "Khách quầy bar",
  ariaLabel = title,
  onRowClick,
  readOnly = false,
  hideGuestNames = false,
  className,
  "data-testid": testId = "bar-guest-list",
}: BarGuestListProps): ReactElement | null {
  const rows = useMemo(() => {
    if (directRows) {
      if (hideGuestNames) return directRows.map((row) => ({ ...row, guestName: "" }))
      if (readOnly) {
        return directRows.map((row) => (isPhoneLikeGuestName(row.guestName) ? { ...row, guestName: "" } : row))
      }
      return directRows
    }
    if (tables) return buildBarGuestRows({ tables, states, groups, hideGuestNames, maskPhoneNames: readOnly })
    return []
  }, [directRows, tables, states, groups, hideGuestNames, readOnly])

  const containerRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLUListElement>(null)
  /** Chiều cao thật của nội dung (pixel màn hình), đo sau khi đã vẽ. */
  const [measuredPixelHeight, setMeasuredPixelHeight] = useState<number | null>(null)

  const shouldMeasure = fitToRows && as === "svg" && rows.length > 0

  useLayoutEffect(() => {
    if (!shouldMeasure) {
      setMeasuredPixelHeight(null)
      return
    }
    const header = headerRef.current
    const body = bodyRef.current
    if (!header || !body) return

    const measure = () => {
      const next = header.offsetHeight + body.offsetHeight
      if (next > 0) setMeasuredPixelHeight((prev) => (prev !== null && Math.abs(prev - next) < 0.5 ? prev : next))
    }
    measure()

    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(measure)
    observer.observe(header)
    observer.observe(body)
    return () => {
      observer.disconnect()
    }
  }, [shouldMeasure, rows])

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

  // Chiều cao vừa đủ số dòng, tính bằng pixel màn hình thật rồi mới đổi về đơn
  // vị sơ đồ. Mỗi khách chiếm đúng một dòng; tên khách nằm cuối dòng đó và tự
  // cắt bớt nếu không đủ chỗ, nên không có dòng nào cao gấp đôi.
  const estimatedPixelHeight =
    HEADER_PIXEL_HEIGHT + rows.length * ROW_BASE_PIXEL_HEIGHT + Math.max(0, rows.length - 1) * ROW_DIVIDER_PIXEL_HEIGHT
  const contentPixelHeight = measuredPixelHeight ?? estimatedPixelHeight
  const effectiveHeight =
    fitToRows && rows.length > 0 && isSvg ? Math.min(height, Math.ceil(contentPixelHeight / scale)) : height

  // In SVG mode, the inner content dimensions are in real screen pixels:
  const innerPixelWidth = isSvg ? Math.round(width * scale) : width
  const innerPixelHeight = isSvg ? Math.round(effectiveHeight * scale) : effectiveHeight

  const containerStyle: CSSProperties = isSvg
    ? {
        width: `${innerPixelWidth}px`,
        height: `${innerPixelHeight}px`,
        transform: `scale(${1 / scale})`,
        transformOrigin: "top left",
      }
    : {
        width: `${width}px`,
        height: `${effectiveHeight}px`,
      }

  const content = (
    <div
      ref={containerRef}
      data-testid={testId}
      style={containerStyle}
      className={cn(
        "pointer-events-auto flex flex-col overflow-hidden rounded-lg border border-border bg-surface-1/95 text-card-foreground shadow-xs select-none",
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
      <div ref={headerRef} className="shrink-0 border-b border-border-subtle bg-surface-2/80 px-2.5 py-1.5">
        <div className="text-[12px] leading-[1.3] font-semibold tracking-tight break-words text-foreground">
          {title}
        </div>
      </div>

      {/* Guest list with internal scroll */}
      <div
        role="region"
        tabIndex={0}
        aria-label={ariaLabel}
        className="flex-1 touch-pan-y [scrollbar-width:thin] overflow-x-hidden overflow-y-auto overscroll-contain focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:outline-none [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded [&::-webkit-scrollbar-thumb]:bg-border-strong"
      >
        {rows.length === 0 ? (
          <div
            data-testid="bar-guest-list-empty"
            className="flex h-full items-center justify-center p-2 text-center text-xs leading-[1.35] text-muted-foreground/80 italic"
          >
            Chưa có khách
          </div>
        ) : (
          <ul
            ref={bodyRef}
            role="list"
            aria-label="Danh sách khách quầy bar"
            className="divide-y divide-border-subtle/80"
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

              const displayGuestName =
                hideGuestNames || (readOnly && isPhoneLikeGuestName(row.guestName)) ? "" : row.guestName
              const rowAriaLabel = [
                row.seatsLabel,
                row.time ? `lúc ${row.time}` : row.seatedTime ? `vào lúc ${row.seatedTime}` : "",
                `${row.partySize} khách`,
                displayGuestName,
                allIconLabels,
                `Trạng thái: ${statusLabel}`,
              ]
                .filter(Boolean)
                .join(", ")

              const rowBody = (
                <>
                  <div className="flex w-full min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
                    <span className="inline-flex shrink-0 items-center gap-1">
                      <span
                        className="inline-block size-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: statusColor }}
                        aria-hidden="true"
                      />
                      <span className="text-xs leading-[1.3] font-semibold tracking-tight text-foreground">
                        {row.seatsLabel}
                      </span>
                    </span>
                    {row.time || row.seatedTime ? (
                      <span className="tnum shrink-0 text-xs leading-[1.3] text-muted-foreground">
                        {row.time ?? `vào ${row.seatedTime}`}
                      </span>
                    ) : null}
                    <span className="tnum inline-flex shrink-0 items-center gap-0.5 text-xs leading-[1.3] text-muted-foreground">
                      <Users className="size-3 opacity-70" aria-hidden="true" />
                      {row.partySize}
                    </span>
                    {activeIcons.length > 0 ? (
                      <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-xs leading-none">
                        {visibleIcons.map((icon) => (
                          <span key={icon.key} title={icon.label} aria-label={icon.label}>
                            {icon.emoji}
                          </span>
                        ))}
                        {overflowCount > 0 ? (
                          <span
                            title={overflowLabels}
                            aria-label={`và ${overflowCount} mục khác: ${overflowLabels}`}
                            className="text-xs font-semibold text-muted-foreground/80 select-none"
                          >
                            {`+${overflowCount}`}
                          </span>
                        ) : null}
                        {overflowIcons.length > 0 ? (
                          <span className="sr-only">
                            {overflowIcons.map((icon) => (
                              <span key={icon.key} title={icon.label} aria-label={icon.label}>
                                {icon.emoji}
                              </span>
                            ))}
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                  </div>
                  {displayGuestName ? (
                    <span
                      className="block w-full min-w-0 truncate text-xs leading-[1.35] font-medium text-foreground"
                      title={displayGuestName}
                    >
                      {displayGuestName}
                    </span>
                  ) : null}
                  <span className="sr-only">{` (${statusShort})`}</span>
                </>
              )

              return (
                <li
                  key={row.bookingKey}
                  role="listitem"
                  className="min-w-0 overflow-hidden rounded-none text-xs leading-[1.35]"
                >
                  {readOnly ? (
                    <div
                      aria-label={rowAriaLabel}
                      data-bar-guest-row=""
                      className="flex min-h-[26px] w-full min-w-0 cursor-default flex-col items-stretch overflow-hidden rounded-none px-1.5 py-1 text-left"
                    >
                      {rowBody}
                    </div>
                  ) : (
                    <button
                      type="button"
                      data-bar-guest-row=""
                      onClick={() => onRowClick?.(row)}
                      aria-label={rowAriaLabel}
                      className={cn(
                        "flex min-h-[26px] w-full min-w-0 flex-col items-stretch overflow-hidden rounded-none px-1.5 py-1 text-left transition-colors focus-visible:bg-surface-2 focus-visible:ring-1 focus-visible:ring-primary focus-visible:outline-none focus-visible:ring-inset",
                        onRowClick ? "cursor-pointer hover:bg-surface-2/80" : "cursor-default hover:bg-surface-2/40",
                      )}
                    >
                      {rowBody}
                    </button>
                  )}
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
        height={effectiveHeight}
        className="pointer-events-auto overflow-hidden"
        data-testid={`${testId}-foreign-object`}
      >
        {content}
      </foreignObject>
    )
  }

  return content
}

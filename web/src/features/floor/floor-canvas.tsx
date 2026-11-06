/**
 * FloorCanvas: the 21GAM floorplan rebuilt as SVG from venue-layout.ts.
 * Coordinate space 589 x 754 (the survey image). Pan (drag), zoom (wheel,
 * pinch), fit-to-screen, zoom-to-zone, keyboard focus per table.
 */
import { List } from "lucide-react"
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import type {
  AvailabilityStatus,
  FloorGroup,
  FloorTableState,
  TableAvailability,
  TableLiveState,
  TableView,
  ZoneView,
} from "@/domain/models"
import { FIXTURES, FLOOR_H, FLOOR_W, ZONES, type ZoneCode } from "@/domain/venue-layout"
import { fmtTime } from "@/lib/time"
import { cn } from "@/lib/utils"
import { STATE_META } from "@/components/status-meta"
import { useUi } from "@/state/ui"
import {
  activeGroupForSelection,
  computeZoneBounds,
  connectorIsSafe,
  formatGroupCode,
  formatOccupiedLabel,
  GUEST_FLAG_META,
  pickPrimaryGuestFlag,
  supportedFlags,
  tableCanActivate,
  type GuestFlag,
} from "./floor-visual-rules"

export type CanvasMode = "live" | "availability"

interface Props {
  tables: TableView[]
  zones: ZoneView[]
  mode: CanvasMode
  states?: Map<number, FloorTableState>
  availability?: Map<number, TableAvailability>
  groups?: FloorGroup[]
  selectedIds: number[]
  /** Visual-only reception search overlay; never participates in selection or group derivation. */
  searchHighlightedIds?: number[]
  /** When set, only these tables accept taps (pick mode). */
  pickable?: Set<number> | null
  zoneFocus?: ZoneCode | "ALL"
  now: Date
  onTableClick: (tableId: number) => void
  /** Reports a tap on a dimmed table without activating it. */
  onBlockedTableClick?: (tableId: number) => void
  onBackgroundClick?: () => void
  compact?: boolean
  className?: string
  ariaLabel?: string

  // New optional props for P2 contract
  waitingCount?: number
  onOpenWaitlist?: () => void
}

interface View {
  k: number
  x: number
  y: number
}

const PAD = 18

/** A drag ends with a click event; ignore clicks right after a drag. */
function markSuppressed(ref: { current: number }) {
  ref.current = performance.now()
}

function isSuppressed(ref: { current: number }) {
  return performance.now() - ref.current < 250
}

export function FloorCanvas(props: Props) {
  const {
    tables,
    zones,
    mode,
    states,
    availability,
    groups = [],
    selectedIds,
    searchHighlightedIds = [],
    pickable,
    zoneFocus = "ALL",
    now,
    onTableClick,
    onBlockedTableClick,
    onBackgroundClick,
    compact,
    className,
    ariaLabel,
    waitingCount,
    onOpenWaitlist,
  } = props

  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const measuredSize = useRef({ w: 0, h: 0 })
  /** A manual view only applies to the zone it was made in; otherwise the view is fitted. */
  const [userView, setUserView] = useState<{ zone: string; view: View } | null>(null)
  const [isInteracting, setIsInteracting] = useState(false)
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => {
    if (typeof window === "undefined") return false
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches
  })

  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{
    startX: number
    startY: number
    view: View
    dragging: boolean
    pinchDist?: number
    pinchMid?: { x: number; y: number }
  } | null>(null)
  const suppressClick = useRef(0)

  // Listen to zoneRefitTick from useUi to support re-clicking active zone tab
  const zoneRefitTick = useUi((s) => s.zoneRefitTick)
  const prevZoneRefitTick = useRef(zoneRefitTick)

  useEffect(() => {
    if (prevZoneRefitTick.current !== zoneRefitTick) {
      prevZoneRefitTick.current = zoneRefitTick
      setUserView(null)
    }
  }, [zoneRefitTick])

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)")
    const listener = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches)
    media.addEventListener("change", listener)
    return () => media.removeEventListener("change", listener)
  }, [])

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      const previous = measuredSize.current
      const changed =
        previous.w > 0 && previous.h > 0 && (Math.abs(previous.w - width) >= 1 || Math.abs(previous.h - height) >= 1)
      measuredSize.current = { w: width, h: height }
      if (changed) setUserView(null)
      setSize({ w: width, h: height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    let frame = 0
    const refitWhenVisible = () => {
      if (document.visibilityState === "hidden") return
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const el = wrapRef.current
        if (!el) return
        const { width, height } = el.getBoundingClientRect()
        measuredSize.current = { w: width, h: height }
        setSize({ w: width, h: height })
        setUserView(null)
      })
    }
    const onVisibilityChange = () => refitWhenVisible()
    window.addEventListener("focus", refitWhenVisible)
    window.addEventListener("pageshow", refitWhenVisible)
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener("focus", refitWhenVisible)
      window.removeEventListener("pageshow", refitWhenVisible)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [])

  // Camera fit bounds computed from the REAL tables and bar seats coordinates
  const fitView = useMemo<View>(() => {
    if (!size.w || !size.h) return { k: 1, x: 0, y: 0 }
    const isAll = zoneFocus === "ALL"
    const b = computeZoneBounds(tables, zoneFocus, isAll ? 0 : compact ? 12 : 24) ?? {
      x: 20,
      y: 20,
      w: FLOOR_W - 40,
      h: FLOOR_H - 20,
    }

    const isPhone =
      !compact &&
      (size.w <= 480 ||
        (typeof window !== "undefined" && window.innerWidth < 640 && size.w < 640))

    if (isPhone) {
      if (isAll) {
        // Horizontal padding on phones so floor frame lines up with tabs and legend edges (16px at 360/390)
        // Use largest scale that fits
        const padH = 16
        const scaleX = (size.w - padH * 2) / b.w
        const scaleY = (size.h - 16) / b.h
        const isWidthLimited = scaleX <= scaleY

        if (isWidthLimited) {
          const k = scaleX
          // Aligns the floor to the top of the viewport instead of centering, so slack goes below
          // Center horizontally with exactly 16px padding on left and right
          return {
            k,
            x: padH - b.x * k,
            y: -b.y * k,
          }
        }
        const k = Math.min(scaleX, scaleY)
        return {
          k,
          x: (size.w - b.w * k) / 2 - b.x * k,
          y: (size.h - b.h * k) / 2 - b.y * k,
        }
      }

      // Zone zoom on phone
      const pad = 12
      const scaleX = (size.w - pad * 2) / b.w
      const scaleY = (size.h - pad * 2) / b.h
      const k = Math.min(scaleX, scaleY)
      const isWidthLimited = scaleX <= scaleY
      return {
        k,
        x: (size.w - b.w * k) / 2 - b.x * k,
        y: isWidthLimited ? pad - b.y * k : (size.h - b.h * k) / 2 - b.y * k,
      }
    }

    // Desktop or compact mode: center
    const pad = compact ? 6 : PAD
    const k = Math.min((size.w - pad * 2) / b.w, (size.h - pad * 2) / b.h)
    return {
      k,
      x: (size.w - b.w * k) / 2 - b.x * k,
      y: (size.h - b.h * k) / 2 - b.y * k,
    }
  }, [size.w, size.h, zoneFocus, tables, compact])

  const view = userView && userView.zone === zoneFocus ? userView.view : fitView

  const setView = useCallback(
    (next: View | ((v: View) => View)) => {
      setUserView((prev) => {
        const current = prev && prev.zone === zoneFocus ? prev.view : fitView
        return { zone: zoneFocus, view: typeof next === "function" ? next(current) : next }
      })
    },
    [zoneFocus, fitView],
  )

  const baseK = useMemo(() => fitView.k, [fitView.k])

  const zoomBy = useCallback(
    (factor: number, cx = size.w / 2, cy = size.h / 2) => {
      setView((v) => {
        const k = Math.min(baseK * 5, Math.max(baseK * 0.6, v.k * factor))
        const f = k / v.k
        return { k, x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f }
      })
    },
    [baseK, size.w, size.h, setView],
  )

  // Wheel zoom (non-passive so the page does not scroll)
  useEffect(() => {
    const el = wrapRef.current
    if (!el || compact) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      zoomBy(Math.exp(-e.deltaY * 0.0016), e.clientX - rect.left, e.clientY - rect.top)
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [zoomBy, compact])

  const local = (e: React.PointerEvent) => {
    const rect = wrapRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (compact) return
    pointers.current.set(e.pointerId, local(e))
    const pts = [...pointers.current.values()]
    if (pts.length === 1) {
      gesture.current = { startX: pts[0].x, startY: pts[0].y, view, dragging: false }
    } else if (pts.length === 2) {
      const [a, b] = pts
      gesture.current = {
        startX: 0,
        startY: 0,
        view,
        dragging: true,
        pinchDist: Math.hypot(a.x - b.x, a.y - b.y),
        pinchMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      }
      setIsInteracting(true)
      wrapRef.current?.setPointerCapture(e.pointerId)
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return
    pointers.current.set(e.pointerId, local(e))
    const pts = [...pointers.current.values()]
    const g = gesture.current
    if (pts.length >= 2 && g.pinchDist && g.pinchMid) {
      const [a, b] = pts
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const k = Math.min(baseK * 5, Math.max(baseK * 0.6, g.view.k * (dist / g.pinchDist)))
      const f = k / g.view.k
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      setView({ k, x: mid.x - (g.pinchMid.x - g.view.x) * f, y: mid.y - (g.pinchMid.y - g.view.y) * f })
      return
    }
    const p = pts[0]
    const dx = p.x - g.startX
    const dy = p.y - g.startY
    if (!g.dragging && Math.hypot(dx, dy) > 6) {
      g.dragging = true
      setIsInteracting(true)
      wrapRef.current?.setPointerCapture(e.pointerId)
    }
    if (g.dragging) {
      setView({ k: g.view.k, x: g.view.x + dx, y: g.view.y + dy })
    }
  }

  const endPointer = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (gesture.current?.dragging) markSuppressed(suppressClick)
    if (pointers.current.size === 0) {
      gesture.current = null
      setIsInteracting(false)
    } else if (pointers.current.size === 1) {
      const [p] = [...pointers.current.values()]
      gesture.current = { startX: p.x, startY: p.y, view, dragging: true }
    }
  }

  const selected = useMemo(() => new Set(selectedIds), [selectedIds])
  const searchHighlighted = useMemo(() => new Set(searchHighlightedIds), [searchHighlightedIds])
  const activeGroup = useMemo(
    () => activeGroupForSelection(groups, selectedIds, mode === "live"),
    [groups, mode, selectedIds],
  )
  const highlighted = useMemo(
    () => new Set(activeGroup ? [...selectedIds, ...activeGroup.tableIds] : selectedIds),
    [activeGroup, selectedIds],
  )

  const handleTable = (id: number) => {
    if (isSuppressed(suppressClick)) return
    if (!tableCanActivate(id, pickable, selected)) {
      onBlockedTableClick?.(id)
      return
    }
    onTableClick(id)
  }

  const zoneOf = useMemo(() => new Map(zones.map((z) => [z.code, z])), [zones])
  const focusZone = zoneFocus === "ALL" ? null : zoneFocus
  const isAllZone = zoneFocus === "ALL"
  const tableById = useMemo(() => new Map(tables.map((t) => [t.id, t])), [tables])

  // Compute waitlist marker position in floor space between Khu A and the bar
  const waitlistPos = useMemo(() => {
    const khuATables = tables.filter((t) => t.zoneCode === "A" && t.code !== "A10")
    const barTables = tables.filter((t) => t.zoneCode === "BAR")
    const khuBTables = tables.filter((t) => t.zoneCode === "B")
    const a10 = tables.find((t) => t.code === "A10")

    const maxKhuAX = khuATables.length
      ? Math.max(...khuATables.map((t) => t.x + (t.w || 46) / 2))
      : 103
    const minBarX = barTables.length
      ? Math.min(...barTables.map((t) => t.x - (t.w || 22) / 2))
      : 342

    const posX = Math.round((maxKhuAX + minBarX) / 2) // ~222

    const maxKhuBY = khuBTables.length
      ? Math.max(...khuBTables.map((t) => t.y + (t.h || 30) / 2))
      : 306
    const a10TopY = a10 ? a10.y - (a10.h || 38) / 2 : 666
    const posY = Math.round((maxKhuBY + a10TopY) / 2) // ~486

    return { x: posX, y: posY }
  }, [tables])

  // Zone tracking chip state (Item 2b)
  const isZoomed = userView !== null && Math.abs(userView.view.k - baseK) > 0.05
  const isZoneActive = zoneFocus !== "ALL"
  const showTrackingChip = isZoneActive || isZoomed

  const zoneLabel =
    zoneFocus === "A"
      ? "Khu A"
      : zoneFocus === "B"
        ? "Khu B"
        : zoneFocus === "C"
          ? "Khu C"
          : zoneFocus === "BAR"
            ? "Bar"
            : "Sơ đồ"

  const handleResetToAll = () => {
    setUserView(null)
    useUi.getState().setZone("ALL")
  }

  return (
    <div
      ref={wrapRef}
      className={cn("touch-none-pan relative h-full w-full overflow-hidden bg-floor select-none", className)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onClick={(e) => {
        if (e.target === e.currentTarget || (e.target as Element).getAttribute?.("data-bg") === "1") {
          if (!isSuppressed(suppressClick)) onBackgroundClick?.()
        }
      }}
    >
      <svg
        width={size.w}
        height={size.h}
        className="absolute inset-0 block"
        role="group"
        aria-label={ariaLabel ?? "Sơ đồ bàn 21GAM"}
      >
        <defs>
          <pattern id="dot-grid" width="12" height="12" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="0.7" fill="var(--floor-grid)" />
          </pattern>
          <pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="5" stroke="var(--st-oos)" strokeWidth="1.2" />
          </pattern>
          <pattern id="avail-lines" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
            <line x1="0" y1="0" x2="0" y2="7" stroke="var(--floor-grid)" strokeWidth="0.8" />
          </pattern>
        </defs>
        <g
          transform={`translate(${view.x} ${view.y}) scale(${view.k})`}
          style={{
            transition:
              isInteracting || prefersReducedMotion
                ? "none"
                : "transform 320ms cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          <rect
            data-bg="1"
            x={20}
            y={20}
            width={FLOOR_W - 40}
            height={FLOOR_H - 20}
            fill={mode === "availability" ? "url(#avail-lines)" : "url(#dot-grid)"}
          />
          {ZONES.map((z) => {
            const zone = zoneOf.get(z.code)
            const dim = focusZone && focusZone !== z.code
            return (
              <g key={z.code} opacity={dim ? 0.35 : 1} data-bg="1">
                {z.rects.map(([x, y, w, h], i) => (
                  <rect key={i} data-bg="1" x={x} y={y} width={w} height={h} rx={10} fill="var(--floor-zone)" />
                ))}
                {z.label ? (
                  <text
                    x={z.label.x}
                    y={z.label.y}
                    textAnchor={z.label.anchor ?? "start"}
                    fontSize={8.5}
                    fontWeight={600}
                    letterSpacing={1.1}
                    fill="var(--text-subtle)"
                    style={{ textTransform: "uppercase" }}
                  >
                    {z.name}
                    {zone?.isWaitingArea ? (
                      <tspan
                        x={z.label.x}
                        dy={11}
                        fontWeight={500}
                        letterSpacing={0.4}
                        style={{ textTransform: "none" }}
                      >
                        khu chờ
                      </tspan>
                    ) : null}
                  </text>
                ) : null}
              </g>
            )
          })}
          <Fixtures />
          <GroupThreads groups={activeGroup ? [activeGroup] : []} tableById={tableById} />

          {/* Waitlist marker button anchored to floor space for Zone Tất cả */}
          {onOpenWaitlist && isAllZone ? (
            <foreignObject
              x={waitlistPos.x - 72}
              y={waitlistPos.y - 20}
              width={144}
              height={40}
              className="overflow-visible"
              pointerEvents="auto"
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  // The marker sits mid-floor: a finger landing on it must still pan and pinch.
                  if (!isSuppressed(suppressClick)) onOpenWaitlist()
                }}
                aria-label={
                  waitingCount !== undefined
                    ? `Bàn chờ, ${waitingCount} khách đang chờ`
                    : "Bàn chờ"
                }
                className="group flex h-10 w-full items-center justify-center gap-2 rounded-full border border-border/80 bg-background/95 px-3 py-1.5 text-foreground shadow-lg backdrop-blur transition-transform hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-[#1e232d]/95 dark:border-slate-700/80"
              >
                <List className="size-4 shrink-0 text-foreground" />
                <span className="text-xs font-bold whitespace-nowrap">
                  {waitingCount && waitingCount > 0 ? `Bàn chờ +${waitingCount}` : "Bàn chờ"}
                </span>
              </button>
            </foreignObject>
          ) : null}

          {tables.map((t) => {
            const dim =
              (focusZone && t.zoneCode !== focusZone) || (pickable && !pickable.has(t.id) && !selected.has(t.id))
            const common = {
              table: t,
              selected: selected.has(t.id),
              groupHighlighted: highlighted.has(t.id) && !selected.has(t.id),
              searchHighlighted: searchHighlighted.has(t.id),
              dim: !!dim,
              pickHint: !!pickable && pickable.has(t.id),
              disabled: !!pickable && !pickable.has(t.id) && !selected.has(t.id),
              onActivate: handleTable,
            }
            if (mode === "availability") {
              return <AvailabilityGlyph key={t.id} {...common} avail={availability?.get(t.id)} />
            }
            return <LiveGlyph key={t.id} {...common} state={states?.get(t.id)} now={now} />
          })}
        </g>
      </svg>

      {/* Zone tracking chip (Item 2b) */}
      {showTrackingChip && !compact ? (
        <div className="pointer-events-auto absolute top-2.5 left-2.5 z-10 flex items-center gap-2 rounded-full border border-slate-700/40 bg-[#162238]/90 py-1 pr-1.5 pl-3 text-white shadow-md backdrop-blur dark:bg-[#1a2639]/95 dark:border-slate-600/50">
          <span className="text-[11px] font-semibold tracking-wide">
            {zoneLabel} · Đang theo dõi
          </span>
          <button
            type="button"
            onClick={handleResetToAll}
            className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-slate-900 shadow-xs hover:bg-slate-100 active:scale-95 transition-transform"
          >
            Thu về toàn bộ
          </button>
        </div>
      ) : null}

      {/* Floating HTML overlay waitlist marker for Zone Khu A/B/C/Bar (outside camera transform) */}
      {onOpenWaitlist && !isAllZone ? (
        <div className="pointer-events-auto absolute bottom-3 right-3 z-10">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onOpenWaitlist()
            }}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label={
              waitingCount !== undefined
                ? `Bàn chờ, ${waitingCount} khách đang chờ`
                : "Bàn chờ"
            }
            className="group flex h-10 items-center justify-center gap-2 rounded-full border border-border/80 bg-background/95 px-3 py-1.5 text-foreground shadow-lg backdrop-blur transition-transform hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-[#1e232d]/95 dark:border-slate-700/80"
          >
            <List className="size-4 shrink-0 text-foreground" />
            <span className="text-xs font-bold whitespace-nowrap">
              {waitingCount && waitingCount > 0 ? `Bàn chờ +${waitingCount}` : "Bàn chờ"}
            </span>
          </button>
        </div>
      ) : null}
    </div>
  )
}

/* ---------------- architectural layer ---------------- */

const Fixtures = memo(function Fixtures() {
  return (
    <g aria-hidden pointerEvents="none">
      {FIXTURES.map((f) => {
        switch (f.kind) {
          case "wall":
            return (
              <path
                key={f.id}
                d={f.d}
                fill="none"
                stroke="var(--floor-wall)"
                strokeWidth={2.4}
                strokeLinejoin="round"
              />
            )
          case "entrance":
            return (
              <g key={f.id}>
                <path d={f.d} fill="none" stroke="var(--floor-wall)" strokeWidth={0.9} strokeDasharray="2.5 2" />
                <text
                  x={f.labelAt!.x}
                  y={f.labelAt!.y}
                  textAnchor="middle"
                  fontSize={7.5}
                  fontWeight={600}
                  letterSpacing={1.2}
                  fill="var(--text-subtle)"
                >
                  LỐI VÀO
                </text>
              </g>
            )
          case "sofa":
            return (
              <path key={f.id} d={f.d} fill="var(--floor-fixture)" stroke="var(--border-strong)" strokeWidth={0.8} />
            )
          case "bar-counter":
            return (
              <g key={f.id}>
                <path
                  d={f.d}
                  fill="var(--floor-fixture)"
                  stroke="var(--floor-wall)"
                  strokeWidth={1.2}
                  strokeLinejoin="round"
                />
                <text
                  transform={`translate(${f.labelAt!.x} ${f.labelAt!.y}) rotate(${f.labelAt!.rotate ?? 0})`}
                  textAnchor="middle"
                  fontSize={8}
                  fontWeight={600}
                  letterSpacing={2}
                  fill="var(--text-subtle)"
                >
                  QUẦY BAR
                </text>
              </g>
            )
          case "back-bar":
            return (
              <g key={f.id}>
                <path d={f.d} fill="var(--floor-fixture)" stroke="var(--border-strong)" strokeWidth={0.8} />
                <text
                  x={f.labelAt!.x}
                  y={f.labelAt!.y}
                  textAnchor="middle"
                  fontSize={7.5}
                  letterSpacing={1}
                  fill="var(--text-subtle)"
                >
                  KHU PHA CHẾ
                </text>
              </g>
            )
          case "block":
            // The two decorative blocks "Chỗ phục vụ sinh uống" are removed (Item 7)
            return null
          default:
            return null
        }
      })}
    </g>
  )
})

function GroupThreads({ groups, tableById }: { groups: FloorGroup[]; tableById: Map<number, TableView> }) {
  return (
    <g aria-hidden pointerEvents="none">
      {groups.map((g) => {
        const pts = g.tableIds.map((id) => tableById.get(id)).filter(Boolean) as TableView[]
        if (pts.length < 2) return null
        const ordered = [...pts].sort((a, b) => a.y - b.y || a.x - b.x)
        if (!connectorIsSafe(ordered, [...tableById.values()])) return null
        const d = ordered.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ")
        return (
          <path
            key={g.id}
            data-group-id={g.id}
            data-group-code={formatGroupCode(g.displayCode ?? g.symbolNo)}
            d={d}
            fill="none"
            stroke="var(--foreground)"
            strokeOpacity={0.45}
            strokeWidth={1.4}
            strokeDasharray="0.1 3.6"
            strokeLinecap="round"
          />
        )
      })}
    </g>
  )
}

/* ---------------- glyphs ---------------- */

interface GlyphBase {
  table: TableView
  selected: boolean
  groupHighlighted: boolean
  searchHighlighted: boolean
  dim: boolean
  pickHint: boolean
  disabled: boolean
  onActivate: (id: number) => void
}

function onKey(e: KeyboardEvent, id: number, cb: (id: number) => void) {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault()
    cb(id)
  }
}

function Chairs({ t, color }: { t: TableView; color: string }) {
  const hw = t.w / 2
  const hh = t.h / 2
  const chairs: [number, number, number, number][] = []
  const H = (x: number, y: number) => chairs.push([x - 4.5, y - 2, 9, 4])
  const V = (x: number, y: number) => chairs.push([x - 2, y - 4.5, 4, 9])
  switch (t.seating) {
    case "banquette":
      V(hw + 4.5, -hh / 2)
      V(hw + 4.5, hh / 2)
      break
    case "pairs-tb":
      H(-hw / 2, -hh - 4.5)
      H(hw / 2, -hh - 4.5)
      H(-hw / 2, hh + 4.5)
      H(hw / 2, hh + 4.5)
      break
    case "pairs-lr":
      V(-hw - 4.5, -hh / 2)
      V(-hw - 4.5, hh / 2)
      V(hw + 4.5, -hh / 2)
      V(hw + 4.5, hh / 2)
      break
    case "four-sides":
      H(0, -hh - 4.5)
      H(0, hh + 4.5)
      V(-hw - 4.5, 0)
      V(hw + 4.5, 0)
      break
    default:
      break
  }
  return (
    <g aria-hidden>
      {chairs.map(([x, y, w, h], i) => (
        <rect key={i} x={x} y={y} width={w} height={h} rx={1.6} fill="var(--floor)" stroke={color} strokeWidth={0.9} />
      ))}
    </g>
  )
}

function GroupBadge({
  code,
  x,
  y,
  compact = false,
}: {
  code: string | number | null | undefined
  x: number
  y: number
  compact?: boolean
}) {
  const formatted = formatGroupCode(code)
  if (!formatted) return null
  const width = Math.max(compact ? 17 : 21, formatted.length * (compact ? 4.8 : 5.5) + 7)
  return (
    <g transform={`translate(${x} ${y})`} aria-hidden pointerEvents="none">
      <rect
        x={-width / 2}
        y={-5.5}
        width={width}
        height={11}
        rx={5.5}
        fill="var(--background)"
        stroke="var(--foreground)"
        strokeWidth={0.9}
      />
      <text y={2.5} textAnchor="middle" fontSize={compact ? 6.5 : 7.2} fontWeight={800} fill="var(--foreground)">
        {formatted}
      </text>
    </g>
  )
}

function CustomerBadges({
  flags,
  x,
  y,
}: {
  flags: string[]
  x: number
  y: number
}) {
  const primary = pickPrimaryGuestFlag(flags)
  if (!primary) return null
  const meta = GUEST_FLAG_META[primary]
  return (
    <g transform={`translate(${x} ${y})`} aria-hidden pointerEvents="none">
      <circle r={5.7} fill="var(--background)" stroke="var(--border-strong)" strokeWidth={0.8} />
      <text y={2.8} textAnchor="middle" fontSize={7.2}>
        {meta.glyph}
      </text>
    </g>
  )
}

function liveLabel(state: TableLiveState, fs: FloorTableState | undefined, t: TableView): string {
  const c = fs?.claim
  switch (state) {
    case "seated":
      // Occupied shows guest count as "{n} khách" and never elapsed time (Item 4)
      return c ? formatOccupiedLabel(c.partySize) : ""
    case "reserved":
    case "upcoming":
      return c ? fmtTime(c.startsAt) : ""
    case "late":
    case "late_confirmed":
    case "noshow":
      return c ? `+${c.minutesLate}'` : ""
    case "hold":
      return "giữ"
    case "hold_overdue":
      return "quá hạn"
    case "spare":
      return "sơ cua"
    case "oos":
      return "ngưng"
    default:
      return t.kind === "BAR_SEAT" ? "" : `${t.capacity} chỗ`
  }
}

function describe(t: TableView, state: TableLiveState, fs?: FloorTableState) {
  const lateConfirmed = state === "late_confirmed" || !!fs?.claim?.lateConfirmedAt
  const statusLabel = `${STATE_META[state].label}${lateConfirmed ? " (đã báo tới muộn)" : ""}`
  const base = `${t.kind === "BAR_SEAT" ? `Ghế Bar ${t.seqNo}` : `Bàn ${t.code}`}, ${statusLabel}`
  const c = fs?.claim
  const spare = t.isSpare ? ", bàn sơ cua" : ""
  if (!c) return `${base}${spare}`
  const flags = supportedFlags(c.flags ?? [])
  const flagLabels = flags.map((flag: GuestFlag) => GUEST_FLAG_META[flag]?.label ?? flag)
  const code = formatGroupCode(c.groupDisplayCode ?? c.symbolNo)
  return `${base}${spare}, ${c.displayName}, ${c.partySize} khách${flagLabels.length ? `, ${flagLabels.join(", ")}` : ""}${code ? `, nhóm ${code}, ${c.tableIds.length} bàn` : ""}`
}

const LiveGlyph = memo(function LiveGlyph({
  table: t,
  selected,
  groupHighlighted,
  searchHighlighted,
  dim,
  pickHint,
  disabled,
  onActivate,
  state: fs,
}: GlyphBase & { state?: FloorTableState; now: Date }) {
  const rawState: TableLiveState = fs?.state ?? "free"
  const state = rawState === "late_confirmed" ? "late" : rawState
  const meta = STATE_META[state]
  const seated = state === "seated"
  // Sơ cua uses dashed border (Item 3); late/late_confirmed uses solid border
  const isSpare = state === "spare" || (t.isSpare && state === "free")
  const dashed = isSpare
  const stroke = state === "free" ? "var(--table-line)" : meta.color
  const fill = seated
    ? "var(--st-seated-fill)"
    : state === "oos"
      ? "url(#hatch)"
      : state === "free" || state === "spare"
        ? "var(--surface-1)"
        : meta.tint
  const textColor = seated
    ? "var(--on-seated)"
    : state === "free" || state === "spare" || state === "oos"
      ? "var(--foreground)"
      : meta.ink
  const label = liveLabel(rawState, fs, t)
  const claim = fs?.claim
  const code = claim?.groupDisplayCode ?? claim?.symbolNo
  const flags = claim?.flags ?? []

  if (t.kind === "BAR_SEAT") {
    return (
      <g
        transform={`translate(${t.x} ${t.y})`}
        role="button"
        tabIndex={dim ? -1 : 0}
        aria-label={describe(t, rawState, fs)}
        aria-pressed={selected}
        aria-disabled={disabled}
        data-group-highlighted={groupHighlighted || undefined}
        data-search-highlighted={searchHighlighted || undefined}
        className={`${disabled ? "cursor-not-allowed" : "cursor-pointer"} outline-none [&:focus-visible_.focus-ring]:opacity-100`}
        opacity={dim ? 0.3 : 1}
        onClick={() => onActivate(t.id)}
        onKeyDown={(e) => onKey(e, t.id, onActivate)}
      >
        <circle r={16} fill="transparent" />
        <circle
          className="focus-ring opacity-0"
          r={15}
          fill="none"
          stroke="var(--ring)"
          strokeWidth={1.5}
          strokeDasharray="2 2"
        />
        {searchHighlighted ? (
          <circle className="animate-pulse" r={16} fill="none" stroke="var(--primary)" strokeWidth={3} />
        ) : null}
        {selected ? (
          <circle r={14.5} fill="none" stroke="var(--ring)" strokeWidth={2.2} />
        ) : groupHighlighted ? (
          <circle r={14.5} fill="none" stroke="var(--ring)" strokeWidth={1.7} strokeDasharray="3 1.5" />
        ) : pickHint ? (
          <circle
            r={14.5}
            fill="none"
            stroke="var(--foreground)"
            strokeOpacity={0.35}
            strokeWidth={1}
            strokeDasharray="2 2"
          />
        ) : null}
        <circle
          key={state}
          r={10.5}
          fill={fill}
          stroke={stroke}
          strokeWidth={seated ? 0 : 1.4}
          strokeDasharray={dashed ? "2.5 2" : undefined}
          className="animate-[glyph-in_420ms_var(--ease-out-quart)]"
        />
        <text
          y={3.4}
          textAnchor="middle"
          fontSize={9.5}
          fontWeight={700}
          fontFamily="var(--font-sans)"
          fill={textColor}
        >
          {t.seqNo}
        </text>
        <CustomerBadges flags={flags} x={-11} y={-11} />
        <GroupBadge code={code} x={11} y={-11} compact />
        {claim?.paid ? <PaidDot x={-9} y={9} /> : null}
        {t.isSpare ? <SpareMark x={0} y={13} /> : null}
      </g>
    )
  }

  const hw = t.w / 2
  const hh = t.h / 2
  return (
    <g
      transform={`translate(${t.x} ${t.y})`}
      role="button"
      tabIndex={dim ? -1 : 0}
      aria-label={describe(t, rawState, fs)}
      aria-pressed={selected}
      aria-disabled={disabled}
      data-group-highlighted={groupHighlighted || undefined}
      data-search-highlighted={searchHighlighted || undefined}
      className={`${disabled ? "cursor-not-allowed" : "cursor-pointer"} outline-none [&:focus-visible_.focus-ring]:opacity-100`}
      opacity={dim ? 0.3 : 1}
      onClick={() => onActivate(t.id)}
      onKeyDown={(e) => onKey(e, t.id, onActivate)}
    >
      <rect x={-hw - 8} y={-hh - 8} width={t.w + 16} height={t.h + 16} fill="transparent" />
      <rect
        className="focus-ring opacity-0"
        x={-hw - 6}
        y={-hh - 6}
        width={t.w + 12}
        height={t.h + 12}
        rx={7}
        fill="none"
        stroke="var(--ring)"
        strokeWidth={1.5}
        strokeDasharray="3 2"
      />
      {searchHighlighted ? (
        <rect
          className="animate-pulse"
          x={-hw - 9}
          y={-hh - 9}
          width={t.w + 18}
          height={t.h + 18}
          rx={9}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={3}
        />
      ) : null}
      {selected ? (
        <rect
          x={-hw - 7}
          y={-hh - 7}
          width={t.w + 14}
          height={t.h + 14}
          rx={8}
          fill="none"
          stroke="var(--ring)"
          strokeWidth={2.2}
        />
      ) : groupHighlighted ? (
        <rect
          x={-hw - 7}
          y={-hh - 7}
          width={t.w + 14}
          height={t.h + 14}
          rx={8}
          fill="none"
          stroke="var(--ring)"
          strokeWidth={1.7}
          strokeDasharray="4 2"
        />
      ) : pickHint ? (
        <rect
          x={-hw - 7}
          y={-hh - 7}
          width={t.w + 14}
          height={t.h + 14}
          rx={8}
          fill="none"
          stroke="var(--foreground)"
          strokeOpacity={0.35}
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      ) : null}
      <Chairs t={t} color={state === "free" || state === "spare" ? "var(--table-line)" : meta.color} />
      <rect
        key={state}
        x={-hw}
        y={-hh}
        width={t.w}
        height={t.h}
        rx={4.5}
        fill={fill}
        stroke={stroke}
        strokeWidth={seated ? 0 : state === "free" ? 1.2 : 1.8}
        strokeDasharray={dashed ? "3.5 2.5" : undefined}
        className="animate-[glyph-in_420ms_var(--ease-out-quart)]"
      />
      <text
        y={label ? -1.2 : 4}
        textAnchor="middle"
        fontSize={11.5}
        fontWeight={700}
        fontFamily="var(--font-sans)"
        letterSpacing={-0.4}
        fill={textColor}
      >
        {t.code}
      </text>
      {label ? (
        <text
          y={9.6}
          textAnchor="middle"
          fontSize={8.4}
          fontWeight={600}
          fontFamily="var(--font-sans)"
          letterSpacing={-0.3}
          fill={textColor}
          opacity={state === "free" ? 0.72 : 0.95}
        >
          {label}
        </text>
      ) : null}
      <CustomerBadges flags={flags} x={-hw} y={-hh} />
      <GroupBadge code={code} x={hw} y={-hh} />
      {claim?.paid ? <PaidDot x={-hw} y={hh} /> : null}
      {fs?.staleFromPreviousDay ? <StaleMark x={-hw} y={-hh} /> : null}
      {t.isSpare ? <SpareMark x={hw} y={hh} /> : null}
    </g>
  )
})

function SpareMark({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} aria-hidden pointerEvents="none">
      <circle r={5.5} fill="var(--background)" stroke="var(--table-line)" strokeWidth={0.9} strokeDasharray="2 1" />
      <text y={2.2} textAnchor="middle" fontSize={6} fontWeight={800} fill="var(--foreground)">
        S
      </text>
    </g>
  )
}

function PaidDot({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} aria-hidden>
      <circle r={6} fill="var(--background)" stroke="var(--st-seated)" strokeWidth={0.9} />
      <path
        d="M-2.4 0.1 L-0.6 1.9 L2.6 -1.6"
        fill="none"
        stroke="var(--st-seated)"
        strokeWidth={1.3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  )
}

function StaleMark({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} aria-hidden>
      <circle r={5.5} fill="var(--st-late)" />
      <text y={2.6} textAnchor="middle" fontSize={7.5} fontWeight={700} fill="var(--background)">
        !
      </text>
    </g>
  )
}

const AVAIL_LABEL: Record<AvailabilityStatus, string> = {
  available: "trống",
  too_small: "",
  reserved: "đã đặt",
  occupied_unknown_end: "có khách",
  spare: "sơ cua",
  oos: "ngưng",
  not_bookable: "khu chờ",
  past: "",
}

const AvailabilityGlyph = memo(function AvailabilityGlyph({
  table: t,
  selected,
  dim,
  pickHint,
  disabled,
  onActivate,
  avail,
}: GlyphBase & { avail?: TableAvailability }) {
  const status = avail?.status ?? "available"
  const ok = status === "available"
  const blocked = status === "reserved" || status === "occupied_unknown_end"
  const faded = !ok && !blocked && status !== "spare"
  const stroke = selected
    ? "var(--primary)"
    : ok
      ? "var(--foreground)"
      : blocked
        ? "var(--st-reserved)"
        : "var(--table-line)"
  const fill = selected
    ? "var(--primary)"
    : ok
      ? "var(--surface-2)"
      : blocked
        ? "var(--st-reserved-tint)"
        : status === "oos"
          ? "url(#hatch)"
          : "var(--surface-1)"
  const textColor = selected ? "var(--primary-foreground)" : blocked ? "var(--st-reserved-ink)" : "var(--foreground)"
  const sub =
    status === "reserved" && avail?.claimStartsAt
      ? fmtTime(avail.claimStartsAt)
      : status === "too_small"
        ? `${t.capacity} chỗ`
        : AVAIL_LABEL[status]
  const desc = `${t.kind === "BAR_SEAT" ? `Ghế Bar ${t.seqNo}` : `Bàn ${t.code}`}: ${avail?.reason || AVAIL_LABEL[status] || ""}`
  const opacity = dim ? 0.3 : faded ? 0.45 : 1

  if (t.kind === "BAR_SEAT") {
    return (
      <g
        transform={`translate(${t.x} ${t.y})`}
        role="button"
        tabIndex={dim ? -1 : 0}
        aria-label={desc}
        aria-pressed={selected}
        aria-disabled={disabled}
        className={`${disabled ? "cursor-not-allowed" : "cursor-pointer"} outline-none [&:focus-visible_.focus-ring]:opacity-100`}
        opacity={opacity}
        onClick={() => onActivate(t.id)}
        onKeyDown={(e) => onKey(e, t.id, onActivate)}
      >
        <circle r={15} fill="transparent" />
        <circle
          className="focus-ring opacity-0"
          r={14}
          fill="none"
          stroke="var(--ring)"
          strokeWidth={1.5}
          strokeDasharray="2 2"
        />
        {pickHint && !selected ? (
          <circle r={13.5} fill="none" stroke="var(--foreground)" strokeOpacity={0.3} strokeDasharray="2 2" />
        ) : null}
        <circle
          r={10.5}
          fill={fill}
          stroke={stroke}
          strokeWidth={1.4}
          strokeDasharray={status === "spare" ? "2.5 2" : undefined}
        />
        <text
          y={3.4}
          textAnchor="middle"
          fontSize={9.5}
          fontWeight={700}
          fontFamily="var(--font-sans)"
          fill={textColor}
        >
          {t.seqNo}
        </text>
      </g>
    )
  }
  const hw = t.w / 2
  const hh = t.h / 2
  return (
    <g
      transform={`translate(${t.x} ${t.y})`}
      role="button"
      tabIndex={dim ? -1 : 0}
      aria-label={desc}
      aria-pressed={selected}
      aria-disabled={disabled}
      className={`${disabled ? "cursor-not-allowed" : "cursor-pointer"} outline-none [&:focus-visible_.focus-ring]:opacity-100`}
      opacity={opacity}
      onClick={() => onActivate(t.id)}
      onKeyDown={(e) => onKey(e, t.id, onActivate)}
    >
      <rect x={-hw - 8} y={-hh - 8} width={t.w + 16} height={t.h + 16} fill="transparent" />
      <rect
        className="focus-ring opacity-0"
        x={-hw - 6}
        y={-hh - 6}
        width={t.w + 12}
        height={t.h + 12}
        rx={7}
        fill="none"
        stroke="var(--ring)"
        strokeWidth={1.5}
        strokeDasharray="3 2"
      />
      {pickHint && !selected ? (
        <rect
          x={-hw - 7}
          y={-hh - 7}
          width={t.w + 14}
          height={t.h + 14}
          rx={8}
          fill="none"
          stroke="var(--foreground)"
          strokeOpacity={0.3}
          strokeDasharray="3 3"
        />
      ) : null}
      <Chairs t={t} color={ok || selected ? "var(--foreground)" : "var(--table-line)"} />
      <rect
        x={-hw}
        y={-hh}
        width={t.w}
        height={t.h}
        rx={4.5}
        fill={fill}
        stroke={stroke}
        strokeWidth={ok ? 1.6 : 1.2}
        strokeDasharray={status === "spare" ? "3.5 2.5" : undefined}
      />
      <text
        y={sub ? -1.2 : 4}
        textAnchor="middle"
        fontSize={11.5}
        fontWeight={700}
        fontFamily="var(--font-sans)"
        letterSpacing={-0.4}
        fill={textColor}
      >
        {t.code}
      </text>
      {sub ? (
        <text
          y={9.6}
          textAnchor="middle"
          fontSize={8.4}
          fontWeight={600}
          fontFamily="var(--font-sans)"
          letterSpacing={-0.3}
          fill={textColor}
          opacity={0.9}
        >
          {sub}
        </text>
      ) : null}
    </g>
  )
})

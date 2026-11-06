/**
 * FloorCanvas: the 21GAM floorplan rebuilt as SVG from venue-layout.ts.
 * Coordinate space 589 x 754 (the survey image). Pan (drag), zoom (wheel,
 * pinch, buttons), fit-to-screen, zoom-to-zone, keyboard focus per table.
 */
import { Maximize, Minus, Plus } from "lucide-react"
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { Button } from "@/components/ui/button"
import type {
  AvailabilityStatus,
  FloorGroup,
  FloorTableState,
  TableAvailability,
  TableLiveState,
  TableView,
  ZoneView,
} from "@/domain/models"
import { FIXTURES, FLOOR_H, FLOOR_W, ZONES, zoneBounds, type ZoneCode } from "@/domain/venue-layout"
import { fmtElapsed, fmtTime, MS } from "@/lib/time"
import { cn } from "@/lib/utils"
import { STATE_META } from "@/components/status-meta"
import {
  activeGroupForSelection,
  connectorIsSafe,
  glyphLevel,
  groupCode,
  supportedFlags,
  tableCanActivate,
  wholeFloorBounds,
  type ClaimViewFlags,
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
  } = props
  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const measuredSize = useRef({ w: 0, h: 0 })
  /** A manual view only applies to the zone it was made in; otherwise the view is fitted. */
  const [userView, setUserView] = useState<{ zone: string; view: View } | null>(null)
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

  const fitView = useMemo<View>(() => {
    if (!size.w || !size.h) return { k: 1, x: 0, y: 0 }
    const zb = zoneFocus === "ALL" ? null : zoneBounds(zoneFocus)
    const b = zb
      ? { x: zb.x - 16, y: zb.y - 16, w: zb.w + 32, h: zb.h + 32 }
      : wholeFloorBounds(tables, FLOOR_W, FLOOR_H)
    const pad = compact ? 6 : size.w < 640 ? 8 : PAD
    const k = Math.min(Math.max(1, size.w - pad * 2) / b.w, Math.max(1, size.h - pad * 2) / b.h)
    return { k, x: (size.w - b.w * k) / 2 - b.x * k, y: (size.h - b.h * k) / 2 - b.y * k }
  }, [size.w, size.h, zoneFocus, compact, tables])

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
  const fitAll = () => setUserView(null)

  const baseK = useMemo(
    () => (size.w && size.h ? Math.min((size.w - PAD * 2) / FLOOR_W, (size.h - PAD * 2) / FLOOR_H) : 1),
    [size],
  )

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

  // Wheel zoom (non-passive so the page does not scroll).
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
      wrapRef.current?.setPointerCapture(e.pointerId)
    }
    if (g.dragging) {
      setView({ k: g.view.k, x: g.view.x + dx, y: g.view.y + dy })
    }
  }

  const endPointer = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (gesture.current?.dragging) markSuppressed(suppressClick)
    if (pointers.current.size === 0) gesture.current = null
    else if (pointers.current.size === 1) {
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
    // A remotely occupied selection must remain tappable so the operator can deselect it.
    if (!tableCanActivate(id, pickable, selected)) {
      onBlockedTableClick?.(id)
      return
    }
    onTableClick(id)
  }

  const zoneOf = useMemo(() => new Map(zones.map((z) => [z.code, z])), [zones])
  const focusZone = zoneFocus === "ALL" ? null : zoneFocus
  const tableById = useMemo(() => new Map(tables.map((t) => [t.id, t])), [tables])

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
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
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

      {mode === "live" ? <FloorLegend /> : null}

      {!compact ? (
        <div
          className="absolute right-2 bottom-2 flex flex-col overflow-hidden rounded-lg border bg-popover/95 shadow-float backdrop-blur sm:right-3 sm:bottom-3 sm:rounded-xl"
          role="group"
          aria-label="Điều khiển thu phóng"
        >
          <Button className="size-9" variant="ghost" size="icon" aria-label="Phóng to" onClick={() => zoomBy(1.25)}>
            <Plus />
          </Button>
          <Button className="size-9" variant="ghost" size="icon" aria-label="Thu nhỏ" onClick={() => zoomBy(0.8)}>
            <Minus />
          </Button>
          <Button className="size-9" variant="ghost" size="icon" aria-label="Vừa màn hình" onClick={fitAll}>
            <Maximize />
          </Button>
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
            return (
              <g key={f.id}>
                <path
                  d={f.d}
                  fill="var(--floor-fixture)"
                  stroke="var(--border-strong)"
                  strokeWidth={0.8}
                  strokeDasharray="3 2.5"
                />
                <text
                  x={f.labelAt!.x}
                  y={f.labelAt!.y - 2}
                  textAnchor="middle"
                  fontSize={6.5}
                  fill="var(--text-subtle)"
                >
                  {f.label}
                </text>
                <text
                  x={f.labelAt!.x}
                  y={f.labelAt!.y + 7}
                  textAnchor="middle"
                  fontSize={5.5}
                  fill="var(--text-subtle)"
                >
                  ước lượng
                </text>
              </g>
            )
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
            data-group-code={g.displayCode ?? groupCode(g.symbolNo)}
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
  code: string | null | undefined
  x: number
  y: number
  compact?: boolean
}) {
  if (!code) return null
  const width = Math.max(compact ? 17 : 21, code.length * (compact ? 4.8 : 5.5) + 7)
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
        {code}
      </text>
    </g>
  )
}

function CustomerBadges({
  flags,
  x,
  y,
  expanded = false,
}: {
  flags: ClaimViewFlags
  x: number
  y: number
  expanded?: boolean
}) {
  const visible = supportedFlags(flags)
  if (!visible.length) return null
  const shown = expanded ? visible.slice(0, 2) : visible.slice(0, 1)
  return (
    <g transform={`translate(${x} ${y})`} aria-hidden pointerEvents="none">
      {shown.map((flag, index) => (
        <g key={flag} transform={`translate(${index * 12} 0)`}>
          <circle r={5.7} fill="var(--background)" stroke="var(--border-strong)" strokeWidth={0.8} />
          <text y={2.8} textAnchor="middle" fontSize={7.2}>
            {flag === "BIRTHDAY" ? "🎂" : flag === "RETURNING" ? "🔥" : "🆕"}
          </text>
        </g>
      ))}
      {!expanded && visible.length > 1 ? (
        <text x={7} y={6} fontSize={5.2} fontWeight={800} fill="var(--foreground)">
          +{visible.length - 1}
        </text>
      ) : null}
    </g>
  )
}

function liveLabel(state: TableLiveState, fs: FloorTableState | undefined, t: TableView, now: Date): string {
  const c = fs?.claim
  switch (state) {
    case "seated":
      return c ? `${c.partySize}·${fmtElapsed(now.getTime() - c.startsAt.getTime())}` : ""
    case "reserved":
    case "upcoming":
      return c ? fmtTime(c.startsAt) : ""
    case "late":
    case "late_confirmed":
    case "noshow":
      return c ? `+${c.minutesLate}'` : ""
    case "hold":
      return c?.deadlineAt ? `giữ ${Math.max(0, Math.ceil((c.deadlineAt.getTime() - now.getTime()) / MS.MIN))}'` : "giữ"
    case "hold_overdue":
      return c?.deadlineAt ? `quá ${Math.floor((now.getTime() - c.deadlineAt.getTime()) / MS.MIN)}'` : "quá hạn"
    case "spare":
      return "sơ cua"
    case "oos":
      return "ngưng"
    default:
      return t.kind === "BAR_SEAT" ? "" : `${t.capacity} chỗ`
  }
}

function describe(t: TableView, state: TableLiveState, fs?: FloorTableState) {
  const base = `${t.kind === "BAR_SEAT" ? `Ghế Bar ${t.seqNo}` : `Bàn ${t.code}`}, ${STATE_META[state].label}`
  const c = fs?.claim
  const spare = t.isSpare ? ", bàn sơ cua" : ""
  if (!c) return `${base}${spare}`
  const flagLabels = supportedFlags(c.flags ?? []).map((flag) =>
    flag === "BIRTHDAY" ? "sinh nhật" : flag === "RETURNING" ? "khách quen" : "khách mới",
  )
  const code = c.groupDisplayCode ?? groupCode(c.symbolNo)
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
  now,
}: GlyphBase & { state?: FloorTableState; now: Date }) {
  const state: TableLiveState = fs?.state ?? "free"
  const meta = STATE_META[state]
  const seated = state === "seated"
  const dashed =
    state === "late" || state === "late_confirmed" || state === "spare" || state === "hold" || state === "hold_overdue"
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
  const label = liveLabel(state, fs, t, now)
  const claim = fs?.claim
  const code = claim?.groupDisplayCode ?? groupCode(claim?.symbolNo)
  const flags = claim?.flags ?? []

  if (t.kind === "BAR_SEAT") {
    return (
      <g
        transform={`translate(${t.x} ${t.y})`}
        role="button"
        tabIndex={dim ? -1 : 0}
        aria-label={describe(t, state, fs)}
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
        <CustomerBadges flags={flags} x={-14} y={(t.seqNo ?? 0) % 2 ? -12 : 12} />
        <GroupBadge code={code} x={14} y={(t.seqNo ?? 0) % 2 ? 12 : -12} compact />
        {state === "late_confirmed" ? <LateConfirmedMark x={0} y={-13} /> : null}
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
      aria-label={describe(t, state, fs)}
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
      <CustomerBadges flags={flags} x={-hw} y={-hh} expanded={glyphLevel(t) === "expanded"} />
      <GroupBadge code={code} x={hw} y={-hh} />
      {state === "late_confirmed" ? <LateConfirmedMark x={0} y={-hh} /> : null}
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

function LateConfirmedMark({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} aria-hidden pointerEvents="none">
      <circle r={5.5} fill="var(--background)" stroke="var(--st-late)" strokeWidth={1.1} />
      <path d="M-2.5 0 L-0.5 2 L3 -2" fill="none" stroke="var(--st-late-ink)" strokeWidth={1.4} strokeLinecap="round" />
    </g>
  )
}

function FloorLegend() {
  const states: TableLiveState[] = ["free", "reserved", "upcoming", "late", "late_confirmed", "noshow", "seated", "oos"]
  return (
    <div
      className="pointer-events-none absolute bottom-2 left-2 z-[2] max-w-[calc(100%-64px)] rounded-lg border bg-popover/94 p-1.5 shadow-float backdrop-blur"
      aria-label="Chú giải trạng thái bàn"
    >
      <div className="flex flex-wrap gap-x-2 gap-y-1 text-[10px] leading-none sm:text-[11px]">
        {states.map((state) => (
          <span key={state} className="inline-flex items-center gap-1 whitespace-nowrap">
            <span
              className="size-2 rounded-full border"
              style={{ background: STATE_META[state].tint, borderColor: STATE_META[state].color }}
              aria-hidden
            />
            {STATE_META[state].short}
          </span>
        ))}
        <span className="inline-flex items-center gap-1 whitespace-nowrap">
          <span className="font-bold" aria-hidden>
            S
          </span>
          Sơ cua
        </span>
      </div>
    </div>
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

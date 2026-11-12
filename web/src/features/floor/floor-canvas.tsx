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
import { FIXTURES, FLOOR_H, FLOOR_W, TABLES, ZONES, type ZoneCode } from "@/domain/venue-layout"
import { fmtTime } from "@/lib/time"
import { cn } from "@/lib/utils"
import { STATE_META } from "@/components/status-meta"
import { useUi } from "@/state/ui"
import {
  computeZoneBounds,
  findGroupRepresentativeId,
  formatCellGuestName,
  formatGroupCode,
  GUEST_FLAG_META,
  resolveCellCornerIcons,
  supportedFlags,
  tableCanActivate,
  type GuestFlag,
} from "./floor-visual-rules"
import { TableIcons } from "./table-icons"
import { TurnBadge } from "./turn-badge"
import { BarGuestList } from "./bar-guest-list"

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
const TABLE_SPEC_BY_CODE = new Map(TABLES.map((s) => [s.code, s]))

/** Ensure tables and Bar seats use the grown J1 dimensions even if HTTP catalog sends older DB widths. */
function normalizeTableGeometry(t: TableView): TableView {
  if (t.kind === "BAR_SEAT") {
    if (t.w >= 24 && t.h >= 24) return t
    return { ...t, w: Math.max(t.w, 24), h: Math.max(t.h, 24) }
  }
  const spec = TABLE_SPEC_BY_CODE.get(t.code)
  if (!spec) return t
  if (t.w >= spec.w && t.h >= spec.h) return t
  return { ...t, w: Math.max(t.w, spec.w), h: Math.max(t.h, spec.h), seating: t.seating ?? spec.seating }
}

/** A drag ends with a click event; ignore clicks right after a drag. */
function markSuppressed(ref: { current: number }) {
  ref.current = performance.now()
}

function isSuppressed(ref: { current: number }) {
  return performance.now() - ref.current < 250
}

export function FloorCanvas(props: Props) {
  const {
    tables: rawTables,
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

  const tables = useMemo(() => rawTables.map(normalizeTableGeometry), [rawTables])

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

  // A phone shows the WHOLE floor fitted to the viewport. While that is the
  // case the camera is locked: no pan, no pinch, no wheel zoom. Lễ tân never
  // has to drag the map, and the plan never jumps back to the top after an
  // action. Zone focus still allows the old free camera.
  const phoneViewport =
    !compact && (size.w <= 480 || (typeof window !== "undefined" && window.innerWidth < 640 && size.w < 640))
  const planLocked = phoneViewport && zoneFocus === "ALL"

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

    const isPhone = phoneViewport

    if (isPhone) {
      if (isAll) {
        // Fit the floor on BOTH axes, then centre the leftover space.
        // Fitting width only (the previous behaviour) let the plan run past the
        // bottom of the screen, which is why the lower tables needed scrolling.
        // One single k for the whole plan is also what keeps the spacing ratios
        // between seats, tables and zones identical on every device.
        const padH = 8
        const padV = 6
        const k = Math.min((size.w - padH * 2) / b.w, (size.h - padV * 2) / b.h)
        return {
          k,
          x: (size.w - b.w * k) / 2 - b.x * k,
          y: (size.h - b.h * k) / 2 - b.y * k,
        }
      }

      // Zone zoom on phone
      const pad = 8
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

    // Desktop or tablet mode:
    // Use width well with a maximum rendered map width of ~640px, centered horizontally,
    // so the map stays close to one screen without shrinking back to 330px at 1366x768.
    if (!compact && isAll) {
      const padH = 16
      const MAX_MAP_WIDTH = 640
      const availableWidth = Math.max(320, size.w - padH * 2)
      const targetMapWidth = Math.min(MAX_MAP_WIDTH, availableWidth)
      const k = targetMapWidth / b.w
      return {
        k,
        x: (size.w - b.w * k) / 2 - b.x * k,
        y: 12 - b.y * k,
      }
    }

    const pad = compact ? 6 : PAD
    const k = Math.min((size.w - pad * 2) / b.w, (size.h - pad * 2) / b.h)
    return {
      k,
      x: (size.w - b.w * k) / 2 - b.x * k,
      y: (size.h - b.h * k) / 2 - b.y * k,
    }
  }, [size.w, size.h, zoneFocus, tables, compact, phoneViewport])

  const view = !planLocked && userView && userView.zone === zoneFocus ? userView.view : fitView

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

  // Wheel zoom: Ctrl+wheel / trackpad pinch zooms; regular wheel allows natural vertical scrolling of the map
  useEffect(() => {
    const el = wrapRef.current
    if (!el || compact || planLocked) return
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const rect = el.getBoundingClientRect()
        zoomBy(Math.exp(-e.deltaY * 0.0016), e.clientX - rect.left, e.clientY - rect.top)
      }
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [zoomBy, compact, planLocked])

  const local = (e: React.PointerEvent) => {
    const rect = wrapRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (compact || planLocked) return
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
  const highlighted = useMemo(() => {
    if (mode !== "live" || selectedIds.length === 0) return new Set<number>()
    const set = new Set(selectedIds)
    for (const sid of selectedIds) {
      const g = groups.find((group) => group.tableIds?.includes(sid))
      if (g) {
        for (const id of g.tableIds) set.add(id)
      }
      if (states) {
        const fs = states.get(sid)
        if (fs?.claim?.tableIds) {
          for (const id of fs.claim.tableIds) set.add(id)
        }
      }
    }
    return set
  }, [groups, mode, selectedIds, states])
  const tableGroupMap = useMemo(() => {
    const map = new Map<number, FloorGroup>()
    for (const g of groups) {
      for (const id of g.tableIds) map.set(id, g)
    }
    return map
  }, [groups])
  const tableById = useMemo(() => new Map(tables.map((t) => [t.id, t])), [tables])

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

  // Compute waitlist marker position in floor space between Khu A and the bar
  const waitlistPos = useMemo(() => {
    const khuATables = tables.filter((t) => t.zoneCode === "A" && t.code !== "A10")
    const barTables = tables.filter((t) => t.zoneCode === "BAR")
    const khuBTables = tables.filter((t) => t.zoneCode === "B")
    const a10 = tables.find((t) => t.code === "A10")

    const maxKhuAX = khuATables.length ? Math.max(...khuATables.map((t) => t.x + (t.w || 52) / 2)) : 106
    const minBarX = barTables.length ? Math.min(...barTables.map((t) => t.x - (t.w || 24) / 2)) : 341

    const posX = Math.round((maxKhuAX + minBarX) / 2)

    const maxKhuBY = khuBTables.length ? Math.max(...khuBTables.map((t) => t.y + (t.h || 33) / 2)) : 322
    const a10TopY = a10 ? a10.y - (a10.h || 42) / 2 : 664
    const posY = Math.round((maxKhuBY + a10TopY) / 2)

    return { x: posX, y: posY }
  }, [tables])

  // Single representative member ID per multi-table booking or group (K1 Section 7: one guest badge per group)
  const groupRepresentativeMap = useMemo(() => {
    const repMap = new Map<number, boolean>()
    const processedGroups = new Set<string>()

    for (const g of groups) {
      if (g.tableIds && g.tableIds.length > 1) {
        const key = [...g.tableIds].sort((a, b) => a - b).join(",")
        if (!processedGroups.has(key)) {
          processedGroups.add(key)
          const memberTables = g.tableIds.map((id) => tableById.get(id)).filter((t): t is TableView => !!t)
          const repId = findGroupRepresentativeId(memberTables)
          for (const id of g.tableIds) {
            repMap.set(id, id === repId)
          }
        }
      }
    }

    if (states) {
      for (const fs of states.values()) {
        const claimIds = fs?.claim?.tableIds
        if (claimIds && claimIds.length > 1) {
          const key = [...claimIds].sort((a, b) => a - b).join(",")
          if (!processedGroups.has(key)) {
            processedGroups.add(key)
            const memberTables = claimIds.map((id) => tableById.get(id)).filter((t): t is TableView => !!t)
            const repId = findGroupRepresentativeId(memberTables)
            for (const id of claimIds) {
              repMap.set(id, id === repId)
            }
          }
        }
      }
    }

    return repMap
  }, [groups, states, tableById])

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

  const isPhone = phoneViewport
  // When the plan is fitted to the viewport the SVG must not grow past it:
  // any extra height brings the vertical scrollbar straight back.
  const neededHeight = isAllZone ? Math.ceil((FLOOR_H - 20) * view.k + (isPhone ? 4 : 28)) : size.h
  const svgHeight = planLocked ? size.h : Math.max(size.h, neededHeight)

  return (
    <div
      ref={wrapRef}
      className={cn(
        "touch-none-pan relative h-full w-full overflow-x-hidden bg-floor select-none",
        planLocked ? "overflow-y-hidden" : "overflow-y-auto",
        className,
      )}
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
        height={svgHeight}
        className="block"
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
              isInteracting || prefersReducedMotion ? "none" : "transform 320ms cubic-bezier(0.16, 1, 0.3, 1)",
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

          {/* Bar guest list inside floor SVG */}
          <BarGuestList
            ariaLabel={ariaLabel ? `Khách quầy bar - ${ariaLabel}` : undefined}
            tables={tables}
            states={states}
            groups={groups}
            mapScale={view.k}
            onRowClick={(row) => {
              const table = tables.find(
                (t) => (t.kind === "BAR_SEAT" || t.zoneCode === "BAR") && row.seatNumbers.includes(t.seqNo ?? -1),
              )
              if (table) handleTable(table.id)
            }}
          />

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
                aria-label={waitingCount !== undefined ? `Bàn chờ, ${waitingCount} khách đang chờ` : "Bàn chờ"}
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
            const group = tableGroupMap.get(t.id) ?? null
            const isRepresentative = groupRepresentativeMap.get(t.id) ?? true
            const dim =
              (focusZone && t.zoneCode !== focusZone) || (pickable && !pickable.has(t.id) && !selected.has(t.id))
            const common = {
              table: t,
              group,
              isRepresentative,
              tableMap: tableById,
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
            return (
              <LiveGlyph
                key={t.id}
                {...common}
                state={states?.get(t.id)}
                now={now}
              />
            )
          })}
        </g>
      </svg>

      {/* Zone tracking chip (Item 2b) */}
      {showTrackingChip && !compact ? (
        <div className="pointer-events-auto absolute top-2.5 left-2.5 z-10 flex items-center gap-2 rounded-full border border-slate-700/40 bg-[#162238]/90 py-1 pr-1.5 pl-3 text-white shadow-md backdrop-blur dark:bg-[#1a2639]/95 dark:border-slate-600/50">
          <span className="text-[11px] font-semibold tracking-wide">{zoneLabel} · Đang theo dõi</span>
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
            aria-label={waitingCount !== undefined ? `Bàn chờ, ${waitingCount} khách đang chờ` : "Bàn chờ"}
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
            return null
          default:
            return null
        }
      })}
    </g>
  )
})

/* ---------------- glyphs ---------------- */

interface GlyphBase {
  table: TableView
  group?: FloorGroup | null
  isRepresentative?: boolean
  tableMap?: Map<number, TableView>
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

/**
 * Single total guest badge for a booking or group (K1 Section 7):
 * - Number only (e.g. `7`), centered inside status-colored pill, thin white border
 * - No people icon, no "7 khach", never multiplied by tables
 */
function GuestCountBadge({
  count,
  x,
  y,
  color,
}: {
  count?: number | null
  x: number
  y: number
  color: string
}) {
  if (!count || count <= 0) return null
  const w = count >= 100 ? 18 : count >= 10 ? 15 : 12
  const h = 11
  return (
    <g
      transform={`translate(${x} ${y})`}
      role="img"
      data-testid="guest-count-badge"
      aria-label={`${count} khách`}
      pointerEvents="none"
    >
      <rect
        x={-w / 2}
        y={-h / 2}
        width={w}
        height={h}
        rx={h / 2}
        fill={color}
        stroke="#ffffff"
        strokeWidth={0.9}
      />
      <text
        x={0}
        y={2.8}
        textAnchor="middle"
        fontSize={7.5}
        fontWeight={800}
        fill="#ffffff"
        fontFamily="var(--font-sans)"
        letterSpacing={-0.3}
        className="tabular-nums select-none"
      >
        {count}
      </text>
    </g>
  )
}

const LiveGlyph = memo(function LiveGlyph({
  table: t,
  group,
  isRepresentative,
  tableMap,
  selected,
  groupHighlighted,
  searchHighlighted,
  dim,
  pickHint,
  disabled,
  onActivate,
  state: fs,
}: GlyphBase & {
  state?: FloorTableState
  now: Date
}) {
  const rawState: TableLiveState = fs?.state ?? "free"
  const state = rawState === "late_confirmed" ? "late" : rawState
  const meta = STATE_META[state]
  const seated = state === "seated"
  const isSpare = state === "spare" || (t.isSpare && state === "free")
  const dashed = isSpare || t.isSpare
  const fill = seated
    ? "var(--st-seated-fill)"
    : state === "oos"
      ? "url(#hatch)"
      : isSpare
        ? STATE_META.spare.tint
        : state === "free"
          ? "var(--surface-1)"
          : meta.tint
  const textColor = seated
    ? "var(--on-seated)"
    : state === "free" || state === "spare" || state === "oos"
      ? "var(--foreground)"
      : meta.ink
  const claim = fs?.claim
  const isGroup =
    !!group ||
    (!!claim && ((claim.tableIds && claim.tableIds.length > 1) || !!claim.symbolNo || !!claim.groupDisplayCode))
  const groupId = group?.id ?? claim?.groupId

  const isAnchor =
    isRepresentative ?? (!isGroup || (group ? group.tableIds?.[0] === t.id : claim?.tableIds ? claim.tableIds[0] === t.id : true))
  const isTurnAnchor = isAnchor

  // Corner icons per J1 Section 3
  const cornerIcons = resolveCellCornerIcons(claim)
  const turnCount = fs?.seatedTurnCount ?? group?.seatedTurnCount

  // Booked time for booked (not checked-in) states
  const bookedTime = claim
    ? claim.reservedExpectedAt
      ? fmtTime(claim.reservedExpectedAt)
      : claim.startsAt
        ? fmtTime(claim.startsAt)
        : null
    : null

  const isBookedState =
    state === "reserved" ||
    state === "upcoming" ||
    state === "late" ||
    state === "noshow" ||
    state === "hold" ||
    state === "hold_overdue"

  const maxNameChars = Math.max(6, Math.floor((t.w - 6) / 4.2))
  let cellSubText = ""
  let showTimeIcon = false

  if (seated) {
    // J1 Section 2: Checked in shows code plus GUEST NAME instead of time or "N khách"
    cellSubText = formatCellGuestName(claim?.displayName, maxNameChars, false)
  } else if (isBookedState) {
    // J1 Section 2: Booked, not checked in shows code plus booked time (e.g. 22:30)
    if (state === "hold" && !claim?.reservationId && !claim?.reservedExpectedAt) {
      cellSubText = "giữ"
    } else if (state === "hold_overdue" && !claim?.reservationId && !claim?.reservedExpectedAt) {
      cellSubText = "quá hạn"
    } else if (bookedTime) {
      cellSubText = bookedTime
      showTimeIcon = t.w >= 44
    } else {
      cellSubText = STATE_META[state].short
    }
  } else if (isSpare) {
    cellSubText = t.kind !== "BAR_SEAT" && t.w >= 36 && t.h >= 30 ? "sơ cua" : ""
  } else if (state === "oos") {
    cellSubText = "ngưng"
  }

  const stroke = state === "free" || isSpare ? "var(--table-line)" : meta.color
  const strokeWidth = isGroup ? 3 : 2
  const hasActiveClaim = !!claim && state !== "free" && state !== "spare" && state !== "oos"
  const showCountBadgeOnCell = hasActiveClaim && isAnchor

  const combinedCodes = isGroup
    ? group?.tableIds
      ? group.tableIds
          .map((id) => tableMap?.get(id)?.code)
          .filter(Boolean)
          .join(" ")
      : claim?.tableIds
        ? claim.tableIds
            .map((id) => tableMap?.get(id)?.code)
            .filter(Boolean)
            .join(" ")
        : undefined
    : undefined

  if (t.kind === "BAR_SEAT") {
    const r = Math.max(12, (t.w || 24) / 2)
    const hasRoom = r >= 10
    const barSubText = hasRoom
      ? seated
        ? formatCellGuestName(claim?.displayName, 4, true)
        : isBookedState
          ? (bookedTime ?? cellSubText)
          : ""
      : ""
    return (
      <g
        transform={`translate(${t.x} ${t.y})`}
        role="button"
        tabIndex={dim ? -1 : 0}
        aria-label={describe(t, rawState, fs)}
        aria-pressed={selected}
        aria-disabled={disabled}
        data-group-id={groupId ?? undefined}
        data-group-highlighted={groupHighlighted || undefined}
        data-combined-codes={combinedCodes || undefined}
        data-is-group={isGroup ? "true" : undefined}
        data-is-anchor={isGroup ? (isAnchor ? "true" : "false") : undefined}
        data-search-highlighted={searchHighlighted || undefined}
        className={`${disabled ? "cursor-not-allowed" : "cursor-pointer"} outline-none [&:focus-visible_.focus-ring]:opacity-100`}
        opacity={dim ? 0.3 : 1}
        onClick={() => onActivate(t.id)}
        onKeyDown={(e) => onKey(e, t.id, onActivate)}
      >
        <circle r={r + 5} fill="transparent" />
        <circle
          className="focus-ring opacity-0"
          r={r + 4}
          fill="none"
          stroke="var(--ring)"
          strokeWidth={1.5}
          strokeDasharray="2 2"
        />
        {searchHighlighted ? (
          <circle className="animate-pulse" r={r + 5} fill="none" stroke="var(--primary)" strokeWidth={3} />
        ) : null}
        {selected || groupHighlighted ? (
          <circle
            r={r + 2.8}
            fill="none"
            stroke="#64748B"
            strokeWidth={1.6}
            strokeDasharray="5 3"
            data-selection-ring="1"
          />
        ) : pickHint ? (
          <circle
            r={r + 2.8}
            fill="none"
            stroke="var(--foreground)"
            strokeOpacity={0.35}
            strokeWidth={1}
            strokeDasharray="2 2"
          />
        ) : null}
        <circle
          key={state}
          r={r}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeDasharray={dashed ? "2.5 2" : undefined}
          className="animate-[glyph-in_420ms_var(--ease-out-quart)]"
        />
        <text
          y={barSubText ? -1.2 : 3.4}
          textAnchor="middle"
          fontSize={barSubText ? 8.2 : 9.5}
          fontWeight={700}
          fontFamily="var(--font-sans)"
          fill={textColor}
        >
          {t.seqNo}
        </text>
        {barSubText ? (
          <text
            y={6.2}
            textAnchor="middle"
            fontSize={isBookedState ? 5.2 : 5.5}
            fontWeight={600}
            fontFamily="var(--font-sans)"
            letterSpacing={-0.2}
            fill={textColor}
          >
            {barSubText}
          </text>
        ) : null}
        {showCountBadgeOnCell ? (
          <GuestCountBadge count={claim?.partySize} x={-r + 2} y={-r - 0.5} color={meta.color} />
        ) : null}
        {hasActiveClaim && isAnchor && cornerIcons.topRight.length > 0 ? (
          <TableIcons
            iconKeys={cornerIcons.topRight}
            x={r - 1}
            y={-r + 1}
            radius={4.5}
            data-testid="table-icons"
          />
        ) : null}
        {hasActiveClaim && isAnchor && cornerIcons.bottomLeft.length > 0 ? (
          <TableIcons
            iconKeys={cornerIcons.bottomLeft}
            x={-r + 2}
            y={r - 1}
            direction="right"
            radius={4.5}
            data-testid="table-icons-bottom-left"
          />
        ) : null}
        {hasActiveClaim && isAnchor && cornerIcons.bottomRight.length > 0 ? (
          <TableIcons
            iconKeys={cornerIcons.bottomRight}
            x={r - 1}
            y={r - 1}
            direction="left"
            radius={4.5}
            data-testid="table-icons-bottom-right"
          />
        ) : null}
        <TurnBadge count={isTurnAnchor ? turnCount : null} x={r + 0.5} y={0} size={4.5} />
        {claim?.paid ? <PaidDot x={r - 1} y={r - 1} /> : null}
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
      data-group-id={groupId ?? undefined}
      data-group-highlighted={groupHighlighted || undefined}
      data-combined-codes={combinedCodes || undefined}
      data-is-group={isGroup ? "true" : undefined}
      data-is-anchor={isGroup ? (isAnchor ? "true" : "false") : undefined}
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
      {selected || groupHighlighted ? (
        <rect
          x={-hw - 2.6}
          y={-hh - 2.6}
          width={t.w + 5.2}
          height={t.h + 5.2}
          rx={6}
          fill="none"
          stroke="#64748B"
          strokeWidth={1.5}
          strokeDasharray="5 3"
          data-selection-ring="1"
        />
      ) : pickHint ? (
        <rect
          x={-hw - 2.6}
          y={-hh - 2.6}
          width={t.w + 5.2}
          height={t.h + 5.2}
          rx={6}
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
        strokeWidth={strokeWidth}
        strokeDasharray={dashed ? "3.5 2.5" : undefined}
        className="animate-[glyph-in_420ms_var(--ease-out-quart)]"
      />
      <text
        y={cellSubText ? -1.5 : 4}
        textAnchor="middle"
        fontSize={11}
        fontWeight={700}
        fontFamily="var(--font-sans)"
        letterSpacing={-0.4}
        fill={textColor}
      >
        {t.code}
      </text>
      {cellSubText ? (
        <g>
          {showTimeIcon ? (
            <g transform="translate(-12.5 6.4)" aria-hidden pointerEvents="none">
              <rect
                x={-2.6}
                y={-2.4}
                width={5.2}
                height={4.8}
                rx={0.9}
                fill="none"
                stroke={textColor}
                strokeWidth={0.75}
                opacity={0.85}
              />
              <line x1={-2.6} y1={-0.8} x2={2.6} y2={-0.8} stroke={textColor} strokeWidth={0.7} opacity={0.85} />
            </g>
          ) : null}
          <text
            x={showTimeIcon ? 3 : 0}
            y={9.4}
            textAnchor="middle"
            fontSize={8.2}
            fontWeight={600}
            fontFamily="var(--font-sans)"
            letterSpacing={-0.3}
            fill={textColor}
            opacity={state === "free" || isSpare ? 0.72 : 0.96}
          >
            {cellSubText}
          </text>
        </g>
      ) : null}

      {/* Top-left: guest count badge (number only, once per booking on first member) */}
      {showCountBadgeOnCell ? (
        <GuestCountBadge count={claim?.partySize} x={-hw + 3} y={-hh - 0.5} color={meta.color} />
      ) : null}

      {/* Top-right: birthday cake icon when present */}
      {hasActiveClaim && isAnchor && cornerIcons.topRight.length > 0 ? (
        <TableIcons
          iconKeys={cornerIcons.topRight}
          x={hw - 1}
          y={-hh + 0.5}
          direction="left"
          radius={5}
          data-testid="table-icons"
        />
      ) : null}

      {/* Bottom-left: new/regular guest icon */}
      {hasActiveClaim && isAnchor && cornerIcons.bottomLeft.length > 0 ? (
        <TableIcons
          iconKeys={cornerIcons.bottomLeft}
          x={-hw + 2.5}
          y={hh - 0.5}
          direction="right"
          radius={5}
          data-testid="table-icons-bottom-left"
        />
      ) : null}

      {/* Bottom-right: Bàn sếp (star) or Chỉ định (pin) when present */}
      {hasActiveClaim && isAnchor && cornerIcons.bottomRight.length > 0 ? (
        <TableIcons
          iconKeys={cornerIcons.bottomRight}
          x={hw - 2}
          y={hh - 0.5}
          direction="left"
          radius={5}
          data-testid="table-icons-bottom-right"
        />
      ) : null}

      {/* Middle of right edge: TurnBadge showing checked-in turn count from 1 */}
      <TurnBadge count={isTurnAnchor ? turnCount : null} x={hw} y={0} size={4.8} />

      {claim?.paid && cornerIcons.bottomRight.length === 0 ? <PaidDot x={hw - 2} y={hh - 0.5} /> : null}
      {fs?.staleFromPreviousDay ? <StaleMark x={-hw} y={-hh} /> : null}
    </g>
  )
})

function PaidDot({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} aria-hidden pointerEvents="none">
      <circle r={5.2} fill="var(--background)" stroke="var(--st-seated)" strokeWidth={0.9} />
      <path
        d="M-2.2 0.1 L-0.5 1.7 L2.3 -1.4"
        fill="none"
        stroke="var(--st-seated)"
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  )
}

function StaleMark({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} aria-hidden pointerEvents="none">
      <circle r={5} fill="var(--st-late)" />
      <text y={2.4} textAnchor="middle" fontSize={7} fontWeight={700} fill="var(--background)">
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
  group,
  tableMap,
  selected,
  groupHighlighted,
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
  const isGroup = !!group
  const groupId = group?.id
  const stroke = ok
    ? "var(--foreground)"
    : blocked
      ? "var(--st-reserved)"
      : "var(--table-line)"
  const strokeWidth = isGroup ? 3 : 2
  const fill = selected
    ? "var(--primary)"
    : ok
      ? "var(--surface-2)"
      : blocked
        ? "var(--st-reserved-tint)"
        : status === "oos"
          ? "url(#hatch)"
          : status === "spare"
            ? STATE_META.spare.tint
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
  const combinedCodes =
    isGroup && group?.tableIds
      ? group.tableIds
          .map((id) => tableMap?.get(id)?.code)
          .filter(Boolean)
          .join(" ")
      : undefined

  if (t.kind === "BAR_SEAT") {
    const r = Math.max(12, (t.w || 24) / 2)
    return (
      <g
        transform={`translate(${t.x} ${t.y})`}
        role="button"
        tabIndex={dim ? -1 : 0}
        aria-label={desc}
        aria-pressed={selected}
        aria-disabled={disabled}
        data-group-id={groupId ?? undefined}
        data-group-highlighted={groupHighlighted || undefined}
        data-combined-codes={combinedCodes || undefined}
        data-is-group={isGroup ? "true" : undefined}
        className={`${disabled ? "cursor-not-allowed" : "cursor-pointer"} outline-none [&:focus-visible_.focus-ring]:opacity-100`}
        opacity={opacity}
        onClick={() => onActivate(t.id)}
        onKeyDown={(e) => onKey(e, t.id, onActivate)}
      >
        <circle r={r + 4.5} fill="transparent" />
        <circle
          className="focus-ring opacity-0"
          r={r + 3.5}
          fill="none"
          stroke="var(--ring)"
          strokeWidth={1.5}
          strokeDasharray="2 2"
        />
        {selected || groupHighlighted ? (
          <circle
            r={r + 2.8}
            fill="none"
            stroke="#64748B"
            strokeWidth={1.6}
            strokeDasharray="5 3"
            data-selection-ring="1"
          />
        ) : pickHint && !selected ? (
          <circle r={r + 2.8} fill="none" stroke="var(--foreground)" strokeOpacity={0.3} strokeDasharray="2 2" />
        ) : null}
        <circle
          r={r}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
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
      data-group-id={groupId ?? undefined}
      data-group-highlighted={groupHighlighted || undefined}
      data-combined-codes={combinedCodes || undefined}
      data-is-group={isGroup ? "true" : undefined}
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
      {selected || groupHighlighted ? (
        <rect
          x={-hw - 2.6}
          y={-hh - 2.6}
          width={t.w + 5.2}
          height={t.h + 5.2}
          rx={6}
          fill="none"
          stroke="#64748B"
          strokeWidth={1.5}
          strokeDasharray="5 3"
          data-selection-ring="1"
        />
      ) : pickHint && !selected ? (
        <rect
          x={-hw - 2.6}
          y={-hh - 2.6}
          width={t.w + 5.2}
          height={t.h + 5.2}
          rx={6}
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
        strokeWidth={strokeWidth}
        strokeDasharray={status === "spare" ? "3.5 2.5" : undefined}
      />
      <text
        y={sub ? -1.5 : 4}
        textAnchor="middle"
        fontSize={11}
        fontWeight={700}
        fontFamily="var(--font-sans)"
        letterSpacing={-0.4}
        fill={textColor}
      >
        {t.code}
      </text>
      {sub ? (
        <text
          y={9.4}
          textAnchor="middle"
          fontSize={8.2}
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

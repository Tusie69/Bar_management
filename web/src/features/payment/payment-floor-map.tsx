import { Info } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import {
  BAR_SEATS,
  BAR_SEAT_SIZE,
  FIXTURES,
  FLOOR_H,
  FLOOR_W,
  TABLES,
  ZONES,
  barSeatCode,
} from "@/domain/venue-layout"
import { cn } from "@/lib/utils"
import { formatCompactVnd, formatVnd, type PayBillSummary } from "@/services/payment"

interface SpotBox {
  code: string
  label: string
  seat: boolean
  x: number
  y: number
  w: number
  h: number
}

interface ViewBox {
  x: number
  y: number
  w: number
  h: number
}

interface Geo {
  w: number
  x: number
  y: number
  pt: number
}

function buildSpots(): SpotBox[] {
  // venue-layout.ts stores centres (x, y); convert to top-left (x - w/2, y - h/2)
  // so A10 (right edge 138) stays clear of bar seats 1-2 (left edge 146).
  const tableSpots: SpotBox[] = TABLES.map((t) => ({
    code: t.code,
    label: t.code,
    seat: false,
    x: t.x - t.w / 2,
    y: t.y - t.h / 2,
    w: t.w,
    h: t.h,
  }))
  const seatSpots: SpotBox[] = BAR_SEATS.map((s) => ({
    code: barSeatCode(s.no),
    label: String(s.no),
    seat: true,
    x: s.x - BAR_SEAT_SIZE / 2,
    y: s.y - BAR_SEAT_SIZE / 2,
    w: BAR_SEAT_SIZE,
    h: BAR_SEAT_SIZE,
  }))
  return [...tableSpots, ...seatSpots]
}

const SPOTS = buildSpots()
const SPOT_BY_CODE = new Map(SPOTS.map((s) => [s.code, s]))
const FULL_VB: ViewBox = { x: 0, y: 0, w: FLOOR_W, h: FLOOR_H }

function groupByProximity(boxes: SpotBox[]): SpotBox[][] {
  const groups: SpotBox[][] = []
  for (const box of boxes) {
    const match = groups.find((g) =>
      g.some((q) => Math.hypot(q.x + q.w / 2 - (box.x + box.w / 2), q.y + q.h / 2 - (box.y + box.h / 2)) < 110),
    )
    if (match) match.push(box)
    else groups.push([box])
  }
  return groups
}

function fitViewBox(boxes: SpotBox[]): ViewBox {
  const x0 = Math.min(...boxes.map((r) => r.x))
  const y0 = Math.min(...boxes.map((r) => r.y))
  const x1 = Math.max(...boxes.map((r) => r.x + r.w))
  const y1 = Math.max(...boxes.map((r) => r.y + r.h))
  let w = Math.max(x1 - x0 + 80, 190)
  let h = Math.max(y1 - y0 + 80, 146)
  if (w / h < 1.3) w = h * 1.3
  else h = w / 1.3
  const clamp = (v: number, size: number, max: number) =>
    size >= max ? (max - size) / 2 : Math.max(0, Math.min(v, max - size))
  return {
    x: clamp((x0 + x1) / 2 - w / 2, w, FLOOR_W),
    y: clamp((y0 + y1) / 2 - h / 2, h, FLOOR_H),
    w,
    h,
  }
}

function toGeo(vb: ViewBox): Geo {
  return {
    w: (FLOOR_W / vb.w) * 100,
    x: (-vb.x / FLOOR_W) * 100,
    y: (-vb.y / FLOOR_H) * 100,
    pt: (vb.h / vb.w) * 100,
  }
}

function boxStyle(r: { x: number; y: number; w: number; h: number }) {
  return {
    left: `${(r.x / FLOOR_W) * 100}%`,
    top: `${(r.y / FLOOR_H) * 100}%`,
    width: `${(r.w / FLOOR_W) * 100}%`,
    height: `${(r.h / FLOOR_H) * 100}%`,
  }
}

function normalizeTableCode(code: string): string {
  const m = /^Bar(\d+)$/i.exec(code.trim())
  if (m) return barSeatCode(Number(m[1]))
  return code
}

export function PaymentFloorMap({
  sessions,
  selectedId,
  onSelectSession,
  onClearSelection,
}: {
  sessions: PayBillSummary[]
  selectedId: string | null
  onSelectSession: (visitId: string) => void
  onClearSelection: () => void
}) {
  const [legendOpen, setLegendOpen] = useState(false)
  const target = useMemo(
    () => (selectedId ? sessions.find((s) => s.visitId === selectedId) ?? null : null),
    [selectedId, sessions],
  )

  const sessionByTable = useMemo(() => {
    const map = new Map<string, PayBillSummary>()
    for (const s of sessions) {
      for (const rawCode of s.tables) {
        map.set(normalizeTableCode(rawCode), s)
      }
    }
    return map
  }, [sessions])

  const views = useMemo(() => {
    if (!target) return [{ vb: FULL_VB, label: "", full: true }]
    const boxes = target.tables
      .map((code) => SPOT_BY_CODE.get(normalizeTableCode(code)))
      .filter((b): b is SpotBox => Boolean(b))
    if (!boxes.length) return [{ vb: FULL_VB, label: "", full: true }]
    const groups = groupByProximity(boxes).slice(0, 2)
    return groups.map((g, idx) => ({
      vb: fitViewBox(g),
      label: groups.length > 1 ? `Phần ${idx + 1}: ${g.map((r) => r.code).join(" + ")}` : "",
      full: false,
    }))
  }, [target])

  const viewKey = target ? target.visitId : "full"
  const currentGeos = useMemo(() => views.map((v) => toGeo(v.vb)), [views])
  const [zoomAnim, setZoomAnim] = useState<{
    key: string
    geos: Geo[]
    prev: Geo[] | null
    flip: boolean
  }>(() => ({
    key: viewKey,
    geos: currentGeos,
    prev: null,
    flip: false,
  }))

  if (zoomAnim.key !== viewKey) {
    setZoomAnim({
      key: viewKey,
      prev: zoomAnim.geos,
      geos: currentGeos,
      flip: !zoomAnim.flip,
    })
  }

  useEffect(() => {
    if (!zoomAnim.prev) return
    const timer = window.setTimeout(() => {
      setZoomAnim((cur) => (cur.prev ? { ...cur, prev: null } : cur))
    }, 650)
    return () => window.clearTimeout(timer)
  }, [zoomAnim.key, zoomAnim.prev])

  const clusterOutlines = useMemo(() => {
    const outlines: { tag: string; style: ReturnType<typeof boxStyle> }[] = []
    for (const s of sessions) {
      if (!s.clusterCode || s.tables.length < 2) continue
      const boxes = s.tables
        .map((c) => SPOT_BY_CODE.get(normalizeTableCode(c)))
        .filter((b): b is SpotBox => Boolean(b))
      for (const group of groupByProximity(boxes)) {
        const x0 = Math.min(...group.map((r) => r.x)) - 4
        const y0 = Math.min(...group.map((r) => r.y)) - 4
        const x1 = Math.max(...group.map((r) => r.x + r.w)) + 4
        const y1 = Math.max(...group.map((r) => r.y + r.h)) + 4
        outlines.push({ tag: s.clusterCode, style: boxStyle({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }) })
      }
    }
    return outlines
  }, [sessions])

  const isSplit = views.length > 1

  return (
    <section
      id="floor-map"
      aria-label="Sơ đồ bàn"
      className="pay-floor-card rounded-2xl border border-border bg-surface-1 shadow-xs"
    >
      <div className="relative flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <h2 className="mr-auto text-[15px] font-semibold tracking-[-0.01em]">Sơ đồ bàn</h2>
        <button
          type="button"
          aria-pressed={!target}
          onClick={onClearSelection}
          className={cn(
            "inline-flex min-h-10 items-center rounded-[10px] border px-3 text-[13px] font-medium cursor-pointer transition-colors",
            !target
              ? "border-primary bg-primary-tint text-primary-ink"
              : "border-border-strong bg-surface-1 text-foreground hover:bg-surface-2",
          )}
        >
          Toàn sơ đồ
        </button>
        <button
          type="button"
          onClick={() => setLegendOpen((v) => !v)}
          aria-expanded={legendOpen}
          aria-controls="pay-floor-legend"
          aria-label="Ký hiệu trạng thái bàn"
          className={cn(
            "grid size-11 place-items-center rounded-full border cursor-pointer transition-colors",
            legendOpen
              ? "border-primary bg-primary-tint text-primary-ink"
              : "border-border bg-surface-1 text-foreground hover:bg-surface-2",
          )}
        >
          <Info className="size-5" aria-hidden />
        </button>

        {legendOpen ? (
          <div
            id="pay-floor-legend"
            role="dialog"
            aria-label="Ký hiệu trạng thái bàn"
            className="absolute top-[calc(100%+6px)] right-3 z-20 grid gap-2.5 rounded-xl border border-border bg-surface-1 px-4 py-3.5 text-[13px] shadow-float"
          >
            <span className="inline-flex items-center gap-2">
              <i
                className="inline-block size-3.5 rounded-[4px] border-2 border-dashed"
                style={{ background: "var(--surface-2)", borderColor: "var(--st-free)" }}
              />
              Trống
            </span>
            <span className="inline-flex items-center gap-2">
              <i
                className="inline-block size-3.5 rounded-[4px] border-2"
                style={{ background: "var(--st-seated-tint)", borderColor: "var(--st-seated)" }}
              />
              Đang dùng
            </span>
            <span className="inline-flex items-center gap-2">
              <i
                className="inline-block size-3.5 rounded-[4px] border-2"
                style={{ background: "var(--st-pending)", borderColor: "var(--st-pending-ink)" }}
              />
              Chờ thanh toán
            </span>
            <span className="inline-flex items-center gap-2">
              <i
                className="inline-block size-3.5 rounded-[4px] border-2"
                style={{ borderColor: "var(--cluster)" }}
              />
              Cụm bàn ghép
            </span>
          </div>
        ) : null}
      </div>

      {isSplit && target ? (
        <p className="flex items-start gap-2 px-4 pt-2.5 text-[13px] text-[var(--text-muted)]">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{`Cụm ${target.clusterCode || target.code} có bàn ở xa nhau nên sơ đồ tách thành 2 khung.`}</span>
        </p>
      ) : null}

      <div className={cn("pay-fgrid", isSplit && "two")}>
        {views.map((view, idx) => {
          const geo = toGeo(view.vb)
          const prevGeo = zoomAnim.prev ? (zoomAnim.prev[idx] ?? zoomAnim.prev[0]) : null
          const szStyle = {
            paddingTop: `${geo.pt}%`,
            ...(prevGeo
              ? {
                  "--fpt": `${prevGeo.pt}%`,
                  animationName: zoomAnim.flip ? "pay-szA" : "pay-szB",
                }
              : {}),
          } as React.CSSProperties

          const viewStyle = {
            width: `${geo.w}%`,
            transform: `translate(${geo.x}%, ${geo.y}%)`,
            ...(prevGeo
              ? {
                  "--fw": `${prevGeo.w}%`,
                  "--fx": `${prevGeo.x}%`,
                  "--fy": `${prevGeo.y}%`,
                  animationName: zoomAnim.flip ? "pay-mzA" : "pay-mzB",
                }
              : {}),
          } as React.CSSProperties

          const wall = FIXTURES.find((f) => f.kind === "wall")
          const barCounter = FIXTURES.find((f) => f.kind === "bar-counter")
          const entrance = FIXTURES.find((f) => f.kind === "entrance")

          return (
            <figure
              key={`${idx}-${view.full ? "full" : "zoom"}`}
              className={cn("pay-fpanel mv", view.full && "full")}
            >
              {view.label ? (
                <figcaption className="absolute top-2 left-2 z-[3] rounded-md border border-border bg-surface-1 px-2 py-0.5 text-xs font-semibold">
                  {view.label}
                </figcaption>
              ) : null}
              <div className="pay-fsz" style={szStyle} />
              <div className="pay-fview" style={viewStyle}>
                <button
                  type="button"
                  onClick={onClearSelection}
                  disabled={view.full}
                  aria-label="Thu về toàn sơ đồ"
                  className="absolute inset-0 border-0 bg-transparent p-0 enabled:cursor-zoom-out disabled:cursor-default"
                />
                {/* Zone rects matching venue-layout.ts */}
                {ZONES.filter((z) => z.code !== "BAR").map((z) => {
                  const [rx, ry, rw, rh] = z.rects[0]
                  return (
                    <div
                      key={z.code}
                      className="pointer-events-none absolute rounded-[calc(4*var(--u))]"
                      style={{ ...boxStyle({ x: rx, y: ry, w: rw, h: rh }), background: "var(--floor-zone)" }}
                    />
                  )
                })}
                {/* Outer wall & entrance */}
                {wall ? (
                  <div
                    className="pointer-events-none absolute"
                    style={{
                      ...boxStyle({ x: 2, y: 2, w: 370, h: 702 }),
                      border: "calc(2 * var(--u)) solid var(--floor-wall)",
                    }}
                  />
                ) : null}
                {entrance ? (
                  <div
                    className="pointer-events-none absolute grid place-items-end justify-center font-semibold tracking-[0.08em]"
                    style={{
                      ...boxStyle({ x: 82, y: 696, w: 68, h: 14 }),
                      background: "var(--floor)",
                      fontSize: "calc(7 * var(--u))",
                      color: "var(--text-subtle)",
                    }}
                  >
                    <span>LỐI VÀO</span>
                  </div>
                ) : null}
                {barCounter ? (
                  <div
                    className="pointer-events-none absolute grid place-items-center bg-surface-3"
                    style={{
                      ...boxStyle({ x: 170, y: 340, w: 26, h: 334 }),
                      border: "calc(1 * var(--u)) solid var(--border-strong)",
                    }}
                  >
                    <span
                      className="font-bold tracking-[0.12em] text-[var(--text-muted)]"
                      style={{
                        writingMode: "vertical-rl",
                        transform: "rotate(180deg)",
                        fontSize: "calc(7 * var(--u))",
                      }}
                    >
                      QUẦY BAR
                    </span>
                  </div>
                ) : null}
                {ZONES.map((z) =>
                  z.label ? (
                    <div
                      key={`${z.code}-lbl`}
                      className="pointer-events-none absolute grid place-items-center font-bold tracking-[0.08em]"
                      style={{
                        ...boxStyle({ x: z.label.x - 16, y: z.label.y - 9, w: 60, h: 14 }),
                        fontSize: "calc(7 * var(--u))",
                        color: "var(--text-subtle)",
                      }}
                    >
                      <span>{z.name.toUpperCase()}</span>
                    </div>
                  ) : null,
                )}

                {/* Cluster outlines with tag drawn ABOVE the tiles */}
                {clusterOutlines.map((o) => (
                  <div key={o.tag + o.style.left + o.style.top} className="pay-f-cl" style={o.style}>
                    <span className="pay-f-cltag">{o.tag}</span>
                  </div>
                ))}

                {/* Interactive tables & bar seats */}
                {SPOTS.map((spot) => {
                  const session = sessionByTable.get(spot.code)
                  const baseCls = cn("pay-ft", spot.seat && "pay-ft-seat")
                  if (!session) {
                    return (
                      <button
                        key={spot.code}
                        type="button"
                        disabled
                        style={boxStyle(spot)}
                        className={cn(baseCls, "pay-ft-free")}
                        aria-label={`${spot.seat ? "Ghế bar" : "Bàn"} ${spot.label}, trống`}
                      >
                        <b>{spot.label}</b>
                      </button>
                    )
                  }
                  const isPending = session.status === "AWAITING_PAYMENT"
                  const isSelected = session.visitId === selectedId
                  const firstTableNormalized = normalizeTableCode(session.tables[0] ?? "")
                  const showAmount = !spot.seat && firstTableNormalized === spot.code
                  return (
                    <button
                      key={spot.code}
                      type="button"
                      style={boxStyle(spot)}
                      onClick={() => onSelectSession(session.visitId)}
                      className={cn(
                        baseCls,
                        isPending ? "pay-ft-pend" : "pay-ft-on",
                        isSelected && "pay-ft-sel",
                      )}
                      aria-label={`${spot.code}, ${isPending ? "chờ thanh toán" : "đang dùng"}, ${formatVnd(session.dueVnd)}${session.clusterCode ? `, cụm ${session.clusterCode}` : ""}`}
                    >
                      <b>{spot.label}</b>
                      {showAmount ? <small className="font-semibold tnum">{formatCompactVnd(session.dueVnd)}</small> : null}
                    </button>
                  )
                })}
              </div>
            </figure>
          )
        })}
      </div>
    </section>
  )
}

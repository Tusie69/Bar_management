/**
 * Minimal accessible bar chart (SVG). One or two series, one y-axis.
 * Series identity is carried by fill vs. texture (monochrome system: hue is
 * reserved for table state), plus a legend and a table view.
 * Hover / focus a column to see its values.
 */
import { useLayoutEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

export interface BarDatum {
  key: string
  label: string
  values: number[]
  highlight?: boolean
}

interface Props {
  data: BarDatum[]
  series: string[]
  height?: number
  unit?: string
  ariaLabel: string
  className?: string
  /** Show every Nth x label (dense series). */
  labelEvery?: number
  marker?: { key: string; label: string } | null
}

export function BarChart({
  data,
  series,
  height = 180,
  unit = "",
  ariaLabel,
  className,
  labelEvery = 1,
  marker,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState<number | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const padL = 28
  const padB = 22
  const padT = 10
  const plotW = Math.max(0, width - padL)
  const plotH = height - padB - padT
  const max = Math.max(1, ...data.flatMap((d) => d.values))
  const step = niceStep(max)
  const top = Math.ceil(max / step) * step
  const ticks = Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step)
  const band = data.length ? plotW / data.length : 0
  const groupW = Math.min(band * 0.7, 44)
  const barW = series.length > 1 ? Math.max(2, (groupW - 2) / series.length) : Math.max(2, groupW)
  const y = (v: number) => padT + plotH - (v / top) * plotH

  return (
    <figure className={cn("grid gap-2", className)}>
      {series.length > 1 ? (
        <figcaption className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          {series.map((s, i) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <svg width="12" height="12" aria-hidden>
                <SeriesRect i={i} x={0} y={0} w={12} h={12} />
              </svg>
              {s}
            </span>
          ))}
        </figcaption>
      ) : null}
      <div ref={ref} className="relative" style={{ height }}>
        {width > 0 ? (
          <svg width={width} height={height} role="group" aria-label={ariaLabel}>
            <defs>
              <pattern
                id="bar-texture"
                width="4"
                height="4"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <rect width="4" height="4" fill="var(--surface-3)" />
                <line x1="0" y1="0" x2="0" y2="4" stroke="var(--text-muted)" strokeWidth="1.2" />
              </pattern>
            </defs>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={padL} x2={width} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
                <text
                  x={padL - 6}
                  y={y(t) + 3.5}
                  textAnchor="end"
                  fontSize={10}
                  fill="var(--text-subtle)"
                  className="tnum"
                >
                  {t}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const cx = padL + band * i + band / 2
              const x0 = cx - (barW * series.length + (series.length - 1) * 2) / 2
              return (
                <g key={d.key}>
                  {d.values.map((v, si) => {
                    const h = Math.max(0, y(0) - y(v))
                    return (
                      <SeriesRect
                        key={si}
                        i={si}
                        x={x0 + si * (barW + 2)}
                        y={y(v)}
                        w={barW}
                        h={h}
                        muted={hover !== null && hover !== i}
                      />
                    )
                  })}
                  {i % labelEvery === 0 ? (
                    <text
                      x={cx}
                      y={height - 6}
                      textAnchor="middle"
                      fontSize={10}
                      fill={d.highlight ? "var(--foreground)" : "var(--text-subtle)"}
                      fontWeight={d.highlight ? 600 : 400}
                      className="tnum"
                    >
                      {d.label}
                    </text>
                  ) : null}
                  <rect
                    x={padL + band * i}
                    y={padT}
                    width={band}
                    height={plotH}
                    fill="transparent"
                    tabIndex={0}
                    role="button"
                    aria-label={`${d.label}: ${d.values.map((v, si) => `${series[si]} ${v}${unit}`).join(", ")}`}
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                    className="outline-none"
                  />
                </g>
              )
            })}
            {marker
              ? (() => {
                  const i = data.findIndex((d) => d.key === marker.key)
                  if (i < 0) return null
                  const x = padL + band * i
                  return (
                    <g aria-hidden pointerEvents="none">
                      <line
                        x1={x}
                        x2={x}
                        y1={padT - 4}
                        y2={padT + plotH}
                        stroke="var(--foreground)"
                        strokeWidth={1}
                        strokeDasharray="2 3"
                      />
                      <text x={x + 4} y={padT + 2} fontSize={10} fill="var(--foreground)">
                        {marker.label}
                      </text>
                    </g>
                  )
                })()
              : null}
          </svg>
        ) : null}
        {hover !== null && data[hover] ? (
          <div
            className="pointer-events-none absolute z-10 rounded-lg border bg-popover px-2.5 py-1.5 text-xs shadow-float"
            style={{
              left: Math.min(Math.max(0, padL + band * hover + band / 2 - 70), Math.max(0, width - 140)),
              top: 0,
              width: 140,
            }}
          >
            <p className="font-medium">{data[hover].label}</p>
            {data[hover].values.map((v, si) => (
              <p key={si} className="flex justify-between gap-2 text-muted-foreground">
                <span>{series[si]}</span>
                <span className="tnum text-foreground">
                  {v}
                  {unit}
                </span>
              </p>
            ))}
          </div>
        ) : null}
      </div>
      <details className="text-xs text-muted-foreground">
        <summary className="w-fit cursor-pointer py-1 select-none hover:text-foreground">Xem dạng bảng</summary>
        <div className="mt-2 max-h-48 scrollbar-thin overflow-auto rounded-lg border">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-surface-2">
              <tr>
                <th className="px-2 py-1 font-medium">Mốc</th>
                {series.map((s) => (
                  <th key={s} className="px-2 py-1 text-right font-medium">
                    {s}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.key} className="border-t">
                  <td className="px-2 py-1">{d.label}</td>
                  {d.values.map((v, i) => (
                    <td key={i} className="tnum px-2 py-1 text-right text-foreground">
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  )
}

function SeriesRect({
  i,
  x,
  y,
  w,
  h,
  muted,
}: {
  i: number
  x: number
  y: number
  w: number
  h: number
  muted?: boolean
}) {
  if (h <= 0) return null
  const r = Math.min(4, w / 2, h)
  const d = `M${x} ${y + h} V${y + r} Q${x} ${y} ${x + r} ${y} H${x + w - r} Q${x + w} ${y} ${x + w} ${y + r} V${y + h} Z`
  return (
    <path
      d={d}
      fill={i === 0 ? "var(--foreground)" : "url(#bar-texture)"}
      opacity={muted ? 0.45 : i === 0 ? 0.88 : 1}
    />
  )
}

function niceStep(max: number) {
  const raw = max / 4
  const pow = 10 ** Math.floor(Math.log10(raw))
  const n = raw / pow
  return Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow)
}

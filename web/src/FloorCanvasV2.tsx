import type { CSSProperties } from 'react'

type MapState = 'AVAILABLE' | 'RESERVED' | 'IN_USE'

export interface FloorCanvasTable {
  id: number
  code: string
  type: 'TABLE' | 'BAR_SEAT' | 'WAITING'
  capacity: number | null
  position: { x: number; y: number }
  state: MapState
  isBackup: boolean
}

export interface FloorCanvasBooking {
  tableCodes: string[]
  status: 'BOOKED' | 'CHECKED_IN' | 'CANCELLED' | 'NO_SHOW'
  displayStatus: 'UPCOMING' | 'WAITING' | 'LATE' | 'NO_SHOW' | 'CHECKED_IN' | 'CANCELLED'
  minutesLate: number
}

interface Props {
  tables: FloorCanvasTable[]
  selectedId: number | null
  selectedIds?: number[]
  onTableClick: (tableId: number) => void
  theme?: 'dark' | 'light'
  bookings?: FloorCanvasBooking[]
}

const W = 589
const H = 754

const zones = [
  { code: 'C', x: 250, y: 44, w: 220, h: 108, label: 'KHU C', sub: 'khu chờ' },
  { code: 'B', x: 42, y: 174, w: 386, h: 172, label: 'KHU B' },
  { code: 'A', x: 42, y: 352, w: 220, h: 380, label: 'KHU A' },
]

const fixtures = [
  { d: 'M268 738 V708 A30 30 0 0 1 298 738 M328 738 V708 A30 30 0 0 0 298 738', kind: 'entrance' },
  { d: 'M396 722 V404 H552 V430 H424 V722 Z', kind: 'bar' },
  { d: 'M540 444 H552 V716 H540 Z', kind: 'back-bar' },
  { d: 'M44 362 H54 V716 H44 Z', kind: 'sofa' },
  { d: 'M182 420 H240 V462 H182 Z', kind: 'block' },
  { d: 'M182 548 H240 V590 H182 Z', kind: 'block' },
]

// The API positions remain authoritative. These tiny presentation offsets only
// prevent chair outlines from touching in the scaled SVG and leave all table
// identity/state/interaction mapping unchanged.
const visualOffsets: Record<string, { x: number; y: number }> = {
  B8: { x: 0, y: 0 },
  B6: { x: 12, y: 0 },
  B5: { x: 12, y: 0 },
  B7: { x: 12, y: 0 },
  C4: { x: 34, y: 0 },
  C1: { x: 34, y: 0 },
  C2: { x: 34, y: 0 },
  C5: { x: 34, y: 0 },
  A7: { x: 22, y: 4 },
  A6: { x: 22, y: 4 },
  A5: { x: 22, y: 4 },
  A4: { x: 22, y: 4 },
  A3: { x: 22, y: 4 },
  A2: { x: 22, y: 4 },
  A1: { x: 22, y: 4 },
  A0: { x: 22, y: 4 },
}

function dimensions(table: FloorCanvasTable): { w: number; h: number } {
  if (table.type === 'BAR_SEAT') return { w: 21, h: 21 }
  const code = table.code.toUpperCase()
  if (code === 'B3' || code === 'B4') return { w: 42, h: 42 }
  if (['B21', 'B22', 'B11', 'B12'].includes(code)) return { w: 48, h: 30 }
  if (['C1', 'C2'].includes(code)) return { w: 44, h: 32 }
  if (['C4', 'C5'].includes(code)) return { w: 34, h: 34 }
  if (code === 'A10') return { w: 38, h: 38 }
  return { w: 46, h: 32 }
}

function statusColors(table: FloorCanvasTable, theme: 'dark' | 'light', booking?: FloorCanvasBooking): { fill: string; stroke: string; text: string; dashed?: boolean } {
  const dashed = table.isBackup
  if (booking?.status === 'CHECKED_IN' || table.state === 'IN_USE') return { fill: '#10b981', stroke: 'none', text: '#06251a', dashed }
  if (booking?.displayStatus === 'LATE') return { fill: theme === 'light' ? '#fff7ed' : 'transparent', stroke: '#f97316', text: theme === 'light' ? '#c2410c' : '#fb923c', dashed }
  if (booking?.displayStatus === 'WAITING' || booking?.displayStatus === 'UPCOMING' || table.state === 'RESERVED') return theme === 'light'
    ? { fill: '#eaf2ff', stroke: '#2563eb', text: '#1d4ed8', dashed }
    : { fill: '#1e293b', stroke: '#60a5fa', text: '#93c5fd', dashed }
  return theme === 'light'
    ? { fill: 'transparent', stroke: '#64748b', text: '#475569', dashed }
    : { fill: 'transparent', stroke: '#6b7280', text: '#9ca3af', dashed }
}

function ChairSet({ w, h, color, seating }: { w: number; h: number; color: string; seating: 'tb' | 'lr' | 'four' | 'right' }) {
  const chairs = seating === 'tb'
    ? [
        { x: -4, y: -h / 2 - 7, width: 8, height: 4 },
        { x: -4, y: h / 2 + 3, width: 8, height: 4 },
      ]
    : seating === 'lr'
      ? [
          { x: -w / 2 - 7, y: -4, width: 4, height: 8 },
          { x: w / 2 + 3, y: -4, width: 4, height: 8 },
        ]
      : seating === 'right'
        ? [{ x: w / 2 + 3, y: -h / 4, width: 4, height: 8 }, { x: w / 2 + 3, y: h / 4 - 8, width: 4, height: 8 }]
        : [
            { x: -4, y: -h / 2 - 7, width: 8, height: 4 },
            { x: -4, y: h / 2 + 3, width: 8, height: 4 },
            { x: -w / 2 - 7, y: -4, width: 4, height: 8 },
            { x: w / 2 + 3, y: -4, width: 4, height: 8 },
          ]
  return <g aria-hidden>{chairs.map((chair, index) => <rect key={index} {...chair} rx="1.5" fill="transparent" stroke={color} strokeWidth="1" />)}</g>
}

function bookingBadge(booking?: FloorCanvasBooking): { label: string; color: string } | null {
  if (!booking || booking.status === 'CANCELLED' || booking.status === 'NO_SHOW') return null
  if (booking.status === 'CHECKED_IN' || booking.displayStatus === 'CHECKED_IN') return { label: 'Đang dùng', color: '#10b981' }
  if (booking.displayStatus === 'LATE') return { label: `Trễ ${booking.minutesLate}p`, color: '#f97316' }
  if (booking.displayStatus === 'WAITING') return { label: 'Đang chờ', color: '#3b82f6' }
  return { label: 'Đã đặt', color: '#3b82f6' }
}

export function FloorCanvasV2({ tables, selectedId, selectedIds = [], onTableClick, theme = 'dark', bookings = [] }: Props) {
  const light = theme === 'light'
  const palette = light
    ? { bg: '#f8fafc', dot: '#94a3b8', zone: '#eef2f7', frame: '#64748b', fixture: '#cbd5e1', block: '#e2e8f0', label: '#475569', sub: '#64748b' }
    : { bg: '#171a1d', dot: '#6b7280', zone: '#222', frame: '#6b7280', fixture: '#4b5563', block: '#1f2937', label: '#9ca3af', sub: '#6b7280' }
  const bookingsByTable = new Map<string, FloorCanvasBooking>()
  for (const booking of bookings) {
    for (const code of booking.tableCodes) {
      const normalized = code.replace(/^BAR0?/, '')
      const current = bookingsByTable.get(normalized)
      const rank = (item: FloorCanvasBooking) => item.status === 'CHECKED_IN' ? 4 : item.displayStatus === 'LATE' ? 3 : item.displayStatus === 'WAITING' ? 2 : 1
      if (!current || rank(booking) > rank(current)) bookingsByTable.set(normalized, booking)
    }
  }
  return (
    <svg className={`floor-canvas-v2 floor-canvas-v2--${theme}`} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Sơ đồ bàn 21GAM">
      <defs>
        <pattern id="floor-v2-dots" width="12" height="12" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r=".8" fill={palette.dot} opacity={light ? '.28' : '.22'} />
        </pattern>
      </defs>
      <rect x="20" y="20" width={W - 40} height={H - 20} fill={palette.bg} />
      <rect x="20" y="20" width={W - 40} height={H - 20} fill="url(#floor-v2-dots)" />
      {zones.map((zone) => {
        const labelX = zone.code === 'A' ? zone.x + zone.w - 10 : zone.x + 10
        const labelY = zone.y + 14
        const labelAnchor = zone.code === 'A' ? 'end' : 'start'
        return <g key={zone.code} aria-label={zone.label}>
        <rect x={zone.x} y={zone.y} width={zone.w} height={zone.h} rx="10" fill={palette.zone} />
        <text x={labelX} y={labelY} textAnchor={labelAnchor} fill={palette.label} fontSize="8" fontFamily="ui-sans-serif, system-ui" fontWeight="700" letterSpacing="1.2">{zone.label}</text>
        {zone.sub ? <text x={labelX} y={labelY + 11} textAnchor={labelAnchor} fill={palette.sub} fontSize="7" fontFamily="ui-sans-serif, system-ui">{zone.sub}</text> : null}
      </g>
      })}
      <path d="M32 738 V32 H560 V738 H328" fill="none" stroke={palette.frame} strokeWidth="2.4" />
      {fixtures.map((fixture, index) => fixture.kind === 'bar' ? (
        <g key={index}><path d={fixture.d} fill="transparent" stroke={palette.frame} strokeWidth="1.4" /><text x="468" y="600" fill={palette.label} fontSize="8" fontFamily="ui-sans-serif, system-ui" textAnchor="middle" transform="rotate(-90 468 600)">KHU PHA CHẾ</text></g>
      ) : fixture.kind === 'back-bar' ? <path key={index} d={fixture.d} fill="transparent" stroke={palette.fixture} strokeWidth="1" />
        : fixture.kind === 'entrance' ? <g key={index}><path d={fixture.d} fill="none" stroke={palette.frame} strokeWidth="1" strokeDasharray="3 2" /><text x="298" y="751" fill={palette.label} fontSize="8" fontFamily="ui-sans-serif, system-ui" textAnchor="middle" letterSpacing="1">LỐI VÀO</text></g>
          : <path key={index} d={fixture.d} fill={palette.block} stroke={palette.fixture} strokeWidth=".8" strokeDasharray={fixture.kind === 'block' ? '3 2' : undefined} />)}
      {tables.map((table) => {
        const offset = visualOffsets[table.code.toUpperCase()] ?? { x: 0, y: 0 }
        const x = table.position.x * 5.6 + offset.x
        const y = table.position.y * 7.6 + offset.y
        const selected = selectedId === table.id || selectedIds.includes(table.id)
        const booking = bookingsByTable.get(table.code.toUpperCase())
        const color = statusColors(table, theme, booking)
        const badge = bookingBadge(booking)
        const badgeWidth = badge ? Math.max(34, badge.label.length * 4.2) : 0
        if (table.type === 'BAR_SEAT') {
          return <g key={table.id} transform={`translate(${x} ${y})`} role="button" tabIndex={0} aria-label={`Ghế bar ${table.code}`} onClick={() => onTableClick(table.id)}>
            <circle r="10.5" fill={color.fill} stroke={selected ? '#f8fafc' : color.stroke} strokeWidth={selected ? 2.2 : 1.4} strokeDasharray={color.dashed ? '2.5 2' : undefined} />
            <text y="3.4" textAnchor="middle" fill={color.text} fontSize="9" fontWeight="700" fontFamily="ui-sans-serif, system-ui">{table.code}</text>
          </g>
        }
        const size = dimensions(table)
        const style: CSSProperties = { cursor: 'pointer' }
        const code = table.code.toUpperCase()
        const seating = code.startsWith('A') && code !== 'A10' ? 'right' :
          ['B7', 'B8', 'B6', 'B5', 'C1', 'C2'].includes(code) ? 'tb' :
            ['B21', 'B22', 'B11', 'B12'].includes(code) ? 'lr' : 'four'
        return <g key={table.id} transform={`translate(${x} ${y})`} role="button" tabIndex={0} aria-label={`${table.code}, ${table.state}`} style={style} onClick={() => onTableClick(table.id)}>
          <ChairSet w={size.w} h={size.h} seating={seating} color={color.stroke === 'none' ? color.fill : color.stroke} />
          <rect x={-size.w / 2} y={-size.h / 2} width={size.w} height={size.h} rx="5" fill={color.fill} stroke={selected ? '#f8fafc' : color.stroke} strokeWidth={selected ? 2.4 : 1.6} strokeDasharray={color.dashed ? '3.5 2.5' : undefined} />
          <text y={table.capacity ? -1 : 3} textAnchor="middle" fill={color.text} fontSize="10" fontWeight="700" fontFamily="ui-sans-serif, system-ui">{table.code}</text>
          {table.capacity ? <text y="9" textAnchor="middle" fill={color.text} fontSize="5.8" fontFamily="ui-sans-serif, system-ui">{table.capacity} chỗ</text> : null}
          {badge ? <g transform={`translate(${-size.w / 2} ${-size.h / 2 - 13})`} aria-label={badge.label}><rect width={badgeWidth} height="10" rx="5" fill={badge.color} opacity=".95" /><text x={badgeWidth / 2} y="7" textAnchor="middle" fill="#fff" fontSize="5.2" fontWeight="700" fontFamily="ui-sans-serif, system-ui">{badge.label}</text></g> : null}
        </g>
      })}
    </svg>
  )
}

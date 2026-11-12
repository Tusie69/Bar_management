/**
 * 21GAM spatial reference, rebuilt as data (coordinate space 414 x 752).
 *
 * Source of truth for positions: the mobile floor-plan mockup approved on
 * 12/11/2026 (frame 374 x 732), mapped into this space with a +20 offset so
 * the venue wall lands on the frame the renderer draws at
 * (x 20, y 20, w FLOOR_W-40, h FLOOR_H-20). The room was then widened by 28
 * units on the right and the bar block moved 14 right, so the plan covers more
 * of a phone's width and the counter is not pressed against Khu A.
 *
 * CAUTION: these are NOT the surveyed coordinates from the product brief any
 * more. The plan is laid out for a phone screen, so distances on it no longer
 * match the real room. Changing it back means restoring the brief's table
 * centres here and in api/database/seeds/demo.sql together.
 *
 * Edit this file only: the renderer draws whatever is declared here.
 */

export const FLOOR_W = 442
export const FLOOR_H = 752

/**
 * Inner face of the venue wall. Chrome that must read as being "inside the
 * plan" (Đếm khách, the date button, the legend) is positioned against this.
 */
export const WALL_BOUNDS = { x: 22, y: 22, w: 398, h: 702 } as const

/**
 * Waitlist marker, placed by hand in the gap between Khu B and Khu A.
 * `height` is the pill people see; `touchHeight` is the invisible area around it
 * that catches the tap, because mobile.css enforces a 44px minimum on buttons
 * inside a foreignObject. Keeping them apart lets the pill stay clear of the
 * tables above and below while the target stays big enough to hit.
 */
export const WAITLIST_MARKER = { x: 112, y: 295, width: 112, height: 30, touchHeight: 44 } as const

export type ZoneCode = "A" | "B" | "C" | "BAR"

/** How chairs are drawn around a table top. "none" = no chairs, as the mockup shows. */
export type SeatingStyle = "none" | "banquette" | "pairs-tb" | "pairs-lr" | "four-sides"

export interface TableSpec {
  code: string
  zone: ZoneCode
  x: number
  y: number
  w: number
  h: number
  capacity: number
  isSpare: boolean
  seating: SeatingStyle
}

export interface BarSeatSpec {
  no: number
  x: number
  y: number
}

/** Seat diameter. Pitch is 24, so 18 leaves a 6-unit gap between neighbours. */
export const BAR_SEAT_SIZE = 18

export interface ZoneSpec {
  code: ZoneCode
  name: string
  /** One or more rectangles [x, y, w, h]. */
  rects: [number, number, number, number][]
  /** Null = no floating label (the bar counter carries its own). */
  label: { x: number; y: number; anchor?: "start" | "end" } | null
  isBookable: boolean
  isWaitingArea: boolean
}

export interface CombinationSpec {
  code: string
  displayName: string
  members: string[]
  /** Pending confirmation of the physical catalogue (BL-04 / BQ3). */
  pendingConfirmation: boolean
}

export type FixtureKind = "wall" | "bar-counter" | "back-bar" | "block" | "entrance" | "sofa"

export interface FixtureSpec {
  id: string
  kind: FixtureKind
  d: string // SVG path in floor units
  label?: string
  labelAt?: { x: number; y: number; rotate?: number }
  estimated: boolean
}

/** Khu A is one banquette run down the west wall; every table is the same box. */
const A = (code: string, y: number, isSpare = false): TableSpec => ({
  code,
  zone: "A",
  x: 64,
  y,
  w: 56,
  h: 34,
  capacity: 4,
  isSpare,
  seating: "none",
})

/** Khu B and Khu C share one box size per zone. */
const B = (code: string, x: number, y: number, isSpare = false): TableSpec => ({
  code,
  zone: "B",
  x,
  y,
  w: 46,
  h: 34,
  capacity: 4,
  isSpare,
  seating: "none",
})

const C = (code: string, x: number, y: number): TableSpec => ({
  code,
  zone: "C",
  x,
  y,
  w: 40,
  h: 32,
  capacity: 4,
  isSpare: false,
  seating: "none",
})

export const TABLES: TableSpec[] = [
  // Khu A: banquette run along the west wall, pitch 44, + A10 (spare)
  A("A7", 339),
  A("A6", 385),
  A("A5", 431),
  A("A4", 477),
  A("A3", 523),
  A("A2", 569),
  A("A1", 615),
  A("A0", 661, true),
  { code: "A10", zone: "A", x: 131, y: 661, w: 54, h: 34, capacity: 4, isSpare: true, seating: "none" },

  // Khu B: left cluster (B7, B8, B6, B5) and right cluster (B3, B4, B21, B22, B11, B12)
  B("B7", 83, 160),
  B("B8", 59, 206, true),
  B("B6", 109, 206),
  B("B5", 83, 252),
  B("B3", 183, 160),
  B("B4", 183, 216),
  B("B21", 277, 160),
  B("B22", 277, 206),
  B("B11", 277, 252),
  B("B12", 277, 298),

  // Khu C (C4, C5 normal per HU-32)
  C("C4", 196, 46),
  C("C5", 196, 90),
  C("C1", 240, 46),
  C("C2", 284, 46),
]

/**
 * Bar seats 1..21. Seats 1-14 run down the LEFT edge of the bar block
 * (14 at the top, 1 at the bottom) and 15-21 along its TOP edge,
 * left to right, so together they wrap the counter.
 */
export const BAR_SEATS: BarSeatSpec[] = [
  { no: 1, x: 190, y: 682 },
  { no: 2, x: 190, y: 658 },
  { no: 3, x: 190, y: 634 },
  { no: 4, x: 190, y: 610 },
  { no: 5, x: 190, y: 586 },
  { no: 6, x: 190, y: 562 },
  { no: 7, x: 190, y: 538 },
  { no: 8, x: 190, y: 514 },
  { no: 9, x: 190, y: 490 },
  { no: 10, x: 190, y: 466 },
  { no: 11, x: 190, y: 442 },
  { no: 12, x: 190, y: 418 },
  { no: 13, x: 190, y: 394 },
  { no: 14, x: 190, y: 370 },
  { no: 15, x: 214, y: 346 },
  { no: 16, x: 243, y: 346 },
  { no: 17, x: 273, y: 346 },
  { no: 18, x: 302, y: 346 },
  { no: 19, x: 331, y: 346 },
  { no: 20, x: 361, y: 346 },
  { no: 21, x: 390, y: 346 },
]

export const barSeatCode = (no: number) => `BAR${String(no).padStart(2, "0")}`

export const ZONES: ZoneSpec[] = [
  {
    code: "C",
    name: "Khu C",
    rects: [[170, 24, 142, 98]],
    label: { x: 220, y: 116 },
    // Mock catalog follows 08/11; HTTP keeps the zone flags supplied by the server.
    isBookable: true,
    isWaitingArea: false,
  },
  {
    code: "B",
    name: "Khu B",
    // Two clusters, so the gap between them stays untinted for the waitlist marker.
    rects: [
      [30, 136, 108, 142],
      [154, 136, 152, 184],
    ],
    label: { x: 216, y: 316 },
    isBookable: true,
    isWaitingArea: false,
  },
  {
    code: "A",
    name: "Khu A",
    rects: [
      [30, 316, 68, 378],
      [98, 638, 66, 56],
    ],
    label: { x: 36, y: 690 },
    isBookable: true,
    isWaitingArea: false,
  },
  { code: "BAR", name: "Quầy Bar", rects: [[174, 330, 240, 370]], label: null, isBookable: true, isWaitingArea: false },
]

/**
 * Special configurations. A combination is not a bookable resource: booking
 * "B1" creates allocations on B11 and B12 sharing one group (db04 §3.4).
 * The A6 long configuration is coded A6L so it never collides with the
 * physical A6 (TABLE-06, db10 seed plan).
 */
export const COMBINATIONS: CombinationSpec[] = [
  { code: "B1", displayName: "B1 (B11 + B12)", members: ["B11", "B12"], pendingConfirmation: true },
  { code: "B2", displayName: "B2 (B21 + B22)", members: ["B21", "B22"], pendingConfirmation: true },
  { code: "A6L", displayName: "A6 dài (A6 + A7)", members: ["A6", "A7"], pendingConfirmation: true },
]

export const FIXTURES: FixtureSpec[] = [
  {
    id: "outer-wall",
    kind: "wall",
    // Building outline with the entrance gap on the bottom wall (x 100..172).
    d: "M100 724 H22 V22 H420 V724 H172",
    estimated: true,
  },
  {
    id: "entrance",
    kind: "entrance",
    // Double door swinging into the room, plus the threshold tick.
    d: "M108 724 V696 A28 28 0 0 1 136 724 M164 724 V696 A28 28 0 0 0 136 724 M136 726 V730",
    label: "Lối vào",
    labelAt: { x: 136, y: 738 },
    estimated: true,
  },
  {
    id: "bar-counter",
    kind: "bar-counter",
    // Straight counter; seats 1-14 sit to its left and 15-21 above it.
    d: "M204 360 H230 V694 H204 Z",
    label: "Quầy Bar",
    labelAt: { x: 217, y: 527, rotate: -90 },
    estimated: true,
  },
]

/** Bounding box of a zone for zoom-to-zone. */
export function zoneBounds(code: ZoneCode) {
  const z = ZONES.find((zone) => zone.code === code)
  if (!z) return { x: 0, y: 0, w: FLOOR_W, h: FLOOR_H }
  const xs = z.rects.flatMap(([x, , w]) => [x, x + w])
  const ys = z.rects.flatMap(([, y, , h]) => [y, y + h])
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

/** 23 tables + 21 bar seats = 44 positions. Asserted in tests/layout check. */
export const POSITION_COUNT = TABLES.length + BAR_SEATS.length

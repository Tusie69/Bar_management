/**
 * 21GAM spatial reference, rebuilt as data (coordinate space 374 x 732).
 *
 * Source of truth for positions: the mobile floor-plan mockup approved on
 * 12/11/2026. The coordinate space IS the mockup's own plan frame, 374 x 732,
 * and every number below is read straight off it, so a value here can be
 * checked against the mockup without arithmetic. An earlier pass mapped the
 * mockup into a 442 x 752 space with a +20 offset, widened the room by 28 and
 * pushed the bar block 14 right; that is reverted - those nudges made the
 * plan 15% wider than the approved frame and the zone spacing no longer
 * matched the mockup anywhere.
 *
 * The approved responsive rule depends on this frame being exact:
 * k = min(availableWidth / 374, availableHeight / 732), uniform on both axes,
 * then centred. The top bar (48px) and bottom bar (52px) stay real pixels.
 *
 * CAUTION: these are NOT the surveyed coordinates from the product brief any
 * more. The plan is laid out for a phone screen, so distances on it no longer
 * match the real room. Changing it back means restoring the brief's table
 * centres here and in api/database/seeds/demo.sql together.
 *
 * Edit this file only: the renderer draws whatever is declared here.
 */

export const FLOOR_W = 374
export const FLOOR_H = 732

/**
 * Inner face of the venue wall. Chrome that must read as being "inside the
 * plan" (Đếm khách, the date button, the legend) is positioned against this.
 */
export const WALL_BOUNDS = { x: 2, y: 2, w: 370, h: 702 } as const

/**
 * Waitlist marker. The mockup puts it top right, under C1/C2 and clear of
 * every table - not in the Khu B / Khu A gap, where it covered B5.
 * Mockup rect: left 244, top 88, 120 x 34; x/y here are its centre.
 * `height` is the pill people see; `touchHeight` is the invisible area around it
 * that catches the tap, because mobile.css enforces a 44px minimum on buttons
 * inside a foreignObject.
 */
export const WAITLIST_MARKER = { x: 304, y: 105, width: 120, height: 34, touchHeight: 44 } as const

export type ZoneCode = "A" | "B" | "C" | "BAR"

/** How chairs are drawn around a table top. "none" = no chairs, as the mockup shows. */
export type SeatingStyle = "none" | "banquette" | "pairs-tb" | "pairs-lr" | "four-sides"

/** x/y are the CENTRE of the box, as the renderer and the database expect. */
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

/** Seat diameter as drawn in the mockup. Vertical pitch is 24, so a 4-unit gap. */
export const BAR_SEAT_SIZE = 20

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
  x: 44,
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
  // Khu A: banquette run along the west wall, mockup pitch 44, + A10 (spare)
  A("A7", 319),
  A("A6", 363),
  A("A5", 407),
  A("A4", 451),
  A("A3", 495),
  A("A2", 539),
  A("A1", 583),
  A("A0", 627, true),
  { code: "A10", zone: "A", x: 111, y: 627, w: 54, h: 34, capacity: 4, isSpare: true, seating: "none" },

  // Khu B: left cluster (B7, B8, B6, B5) and right cluster (B3, B4, B21, B22, B11, B12)
  B("B7", 63, 147),
  B("B8", 39, 187, true),
  B("B6", 89, 187),
  B("B5", 63, 227),
  B("B3", 163, 147),
  B("B4", 163, 203),
  B("B21", 257, 147),
  B("B22", 257, 189),
  B("B11", 257, 231),
  B("B12", 257, 273),

  // Khu C (C4, C5 normal per HU-32)
  C("C4", 176, 26),
  C("C5", 176, 64),
  C("C1", 220, 26),
  C("C2", 264, 26),
]

/**
 * Bar seats 1..21. Seats 1-14 run down the LEFT edge of the bar block
 * (14 at the top, 1 at the bottom) and 15-21 along its TOP edge,
 * left to right, so together they wrap the counter.
 */
export const BAR_SEATS: BarSeatSpec[] = [
  { no: 1, x: 156, y: 662 },
  { no: 2, x: 156, y: 638 },
  { no: 3, x: 156, y: 614 },
  { no: 4, x: 156, y: 590 },
  { no: 5, x: 156, y: 566 },
  { no: 6, x: 156, y: 542 },
  { no: 7, x: 156, y: 518 },
  { no: 8, x: 156, y: 494 },
  { no: 9, x: 156, y: 470 },
  { no: 10, x: 156, y: 446 },
  { no: 11, x: 156, y: 422 },
  { no: 12, x: 156, y: 398 },
  { no: 13, x: 156, y: 374 },
  { no: 14, x: 156, y: 350 },
  { no: 15, x: 180, y: 326 },
  { no: 16, x: 209, y: 326 },
  { no: 17, x: 239, y: 326 },
  { no: 18, x: 268, y: 326 },
  { no: 19, x: 297, y: 326 },
  { no: 20, x: 327, y: 326 },
  { no: 21, x: 356, y: 326 },
]

export const barSeatCode = (no: number) => `BAR${String(no).padStart(2, "0")}`

/**
 * Zones. `rects` is the zone's extent, used for zoom-to-zone and for dimming
 * the other zones; it is NO LONGER painted as a tinted block, because the
 * approved mockup has no zone blocks - a zone reads from its label and from
 * the way its tables are grouped. Each rect is the bounding box of that zone's
 * own tables, so zoom-to-zone frames exactly the tables it names.
 */
export const ZONES: ZoneSpec[] = [
  {
    code: "C",
    name: "Khu C",
    rects: [[156, 10, 128, 70]],
    label: { x: 200, y: 95 },
    // Khu C nhận đặt bàn từ migration 0019; HTTP vẫn dùng cờ do server trả về.
    isBookable: true,
    isWaitingArea: false,
  },
  {
    code: "B",
    name: "Khu B",
    rects: [[16, 130, 264, 160]],
    label: { x: 196, y: 263 },
    isBookable: true,
    isWaitingArea: false,
  },
  {
    code: "A",
    name: "Khu A",
    rects: [[16, 302, 122, 342]],
    label: { x: 16, y: 661 },
    isBookable: true,
    isWaitingArea: false,
  },
  { code: "BAR", name: "Quầy Bar", rects: [[146, 316, 220, 358]], label: null, isBookable: true, isWaitingArea: false },
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
    // Mockup frame (2, 2, 370 x 702) with the entrance gap on the bottom wall
    // (x 80..152), matching the notch the mockup draws there.
    d: "M80 704 H2 V2 H372 V704 H152",
    estimated: true,
  },
  {
    id: "entrance",
    kind: "entrance",
    // Double door swinging into the room, plus the threshold tick.
    d: "M88 704 V676 A28 28 0 0 1 116 704 M144 704 V676 A28 28 0 0 0 116 704 M116 706 V710",
    label: "Lối vào",
    labelAt: { x: 116, y: 718 },
    estimated: true,
  },
  {
    id: "bar-counter",
    kind: "bar-counter",
    // Mockup strip (170, 340, 26 x 334); seats 1-14 to its left, 15-21 above.
    d: "M170 340 H196 V674 H170 Z",
    label: "Quầy Bar",
    labelAt: { x: 183, y: 507, rotate: -90 },
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

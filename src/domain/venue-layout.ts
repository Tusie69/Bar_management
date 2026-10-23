/**
 * 21GAM spatial reference, rebuilt as data (coordinate space 589 x 754).
 *
 * Source of truth for positions: the coordinate table in the product brief
 * (table centres + 21 bar seats). The floorplan image itself was not attached
 * (db02 §2 lists it as MISSING_SOURCE), so every fixture flagged
 * `estimated: true` (walls, bar counter outline, the two auxiliary furniture
 * blocks, entrance) must be checked against the real survey image.
 * Edit this file only: the renderer draws whatever is declared here.
 */

export const FLOOR_W = 589
export const FLOOR_H = 754

export type ZoneCode = "A" | "B" | "C" | "BAR"

/** How chairs are drawn around a table top. UI-only, not part of the DDL. */
export type SeatingStyle = "banquette" | "pairs-tb" | "pairs-lr" | "four-sides"

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

const A = (code: string, y: number): TableSpec => ({
  code,
  zone: "A",
  x: 80,
  y,
  w: 46,
  h: 32,
  capacity: 4,
  isSpare: false,
  seating: "banquette",
})

export const TABLES: TableSpec[] = [
  // Khu A: banquette run along the west wall + A10 (spare)
  A("A7", 382),
  A("A6", 419),
  A("A5", 468),
  A("A4", 516),
  A("A3", 562),
  A("A2", 609),
  A("A1", 654),
  A("A0", 696),
  { code: "A10", zone: "A", x: 231, y: 685, w: 38, h: 38, capacity: 4, isSpare: true, seating: "four-sides" },

  // Khu B
  { code: "B7", zone: "B", x: 107, y: 213, w: 34, h: 30, capacity: 4, isSpare: false, seating: "pairs-tb" },
  { code: "B8", zone: "B", x: 67, y: 259, w: 34, h: 30, capacity: 4, isSpare: false, seating: "pairs-tb" },
  { code: "B6", zone: "B", x: 107, y: 259, w: 34, h: 30, capacity: 4, isSpare: false, seating: "pairs-tb" },
  { code: "B5", zone: "B", x: 107, y: 306, w: 34, h: 30, capacity: 4, isSpare: false, seating: "pairs-tb" },
  { code: "B3", zone: "B", x: 248, y: 223, w: 42, h: 42, capacity: 4, isSpare: false, seating: "four-sides" },
  { code: "B4", zone: "B", x: 248, y: 285, w: 42, h: 42, capacity: 4, isSpare: false, seating: "four-sides" },
  { code: "B21", zone: "B", x: 381, y: 205, w: 48, h: 30, capacity: 4, isSpare: false, seating: "pairs-lr" },
  { code: "B22", zone: "B", x: 381, y: 243, w: 48, h: 30, capacity: 4, isSpare: false, seating: "pairs-lr" },
  { code: "B11", zone: "B", x: 381, y: 286, w: 48, h: 30, capacity: 4, isSpare: false, seating: "pairs-lr" },
  { code: "B12", zone: "B", x: 381, y: 325, w: 48, h: 30, capacity: 4, isSpare: false, seating: "pairs-lr" },

  // Khu C (C4, C5 marked spare on the survey)
  { code: "C4", zone: "C", x: 284, y: 80, w: 34, h: 34, capacity: 4, isSpare: true, seating: "pairs-lr" },
  { code: "C5", zone: "C", x: 284, y: 127, w: 34, h: 34, capacity: 4, isSpare: true, seating: "pairs-lr" },
  { code: "C1", zone: "C", x: 337, y: 75, w: 44, h: 32, capacity: 4, isSpare: false, seating: "pairs-tb" },
  { code: "C2", zone: "C", x: 391, y: 75, w: 44, h: 32, capacity: 4, isSpare: false, seating: "pairs-tb" },
]

/** Bar seats in counter order 1..21 (exact centres from the brief). */
export const BAR_SEATS: BarSeatSpec[] = [
  { no: 1, x: 353, y: 696 },
  { no: 2, x: 378, y: 672 },
  { no: 3, x: 353, y: 648 },
  { no: 4, x: 378, y: 623 },
  { no: 5, x: 353, y: 600 },
  { no: 6, x: 378, y: 575 },
  { no: 7, x: 353, y: 551 },
  { no: 8, x: 378, y: 525 },
  { no: 9, x: 353, y: 502 },
  { no: 10, x: 378, y: 478 },
  { no: 11, x: 353, y: 454 },
  { no: 12, x: 378, y: 428 },
  { no: 13, x: 353, y: 405 },
  { no: 14, x: 378, y: 377 },
  { no: 15, x: 409, y: 358 },
  { no: 16, x: 428, y: 387 },
  { no: 17, x: 445, y: 358 },
  { no: 18, x: 462, y: 387 },
  { no: 19, x: 481, y: 358 },
  { no: 20, x: 499, y: 387 },
  { no: 21, x: 514, y: 358 },
]

export const barSeatCode = (no: number) => `BAR${String(no).padStart(2, "0")}`

export const ZONES: ZoneSpec[] = [
  {
    code: "C",
    name: "Khu C",
    rects: [[250, 44, 220, 108]],
    label: { x: 462, y: 60, anchor: "end" },
    isBookable: false,
    isWaitingArea: true,
  },
  {
    code: "B",
    name: "Khu B",
    rects: [[42, 174, 386, 172]],
    label: { x: 52, y: 187 },
    isBookable: true,
    isWaitingArea: false,
  },
  {
    code: "A",
    name: "Khu A",
    rects: [
      [42, 352, 92, 380],
      [200, 650, 62, 80],
    ],
    label: { x: 62, y: 726 },
    isBookable: true,
    isWaitingArea: false,
  },
  { code: "BAR", name: "Quầy Bar", rects: [[332, 338, 226, 392]], label: null, isBookable: true, isWaitingArea: false },
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
    // Building outline with the entrance gap on the bottom wall (x 268..328).
    d: "M268 738 H32 V32 H560 V738 H328",
    estimated: true,
  },
  {
    id: "entrance",
    kind: "entrance",
    // Double door swinging into the room.
    d: "M268 738 V708 A30 30 0 0 1 298 738 M328 738 V708 A30 30 0 0 0 298 738",
    label: "Lối vào",
    labelAt: { x: 298, y: 751 },
    estimated: true,
  },
  {
    id: "sofa-west",
    kind: "sofa",
    d: "M44 362 H54 V716 H44 Z",
    estimated: true,
  },
  {
    id: "bar-counter",
    kind: "bar-counter",
    // L-shaped counter hugging seats 1-14 (vertical run) and 15-21 (top run).
    d: "M396 722 V404 H552 V430 H424 V722 Z",
    label: "Quầy Bar",
    labelAt: { x: 410, y: 600, rotate: -90 },
    estimated: true,
  },
  {
    id: "back-bar",
    kind: "back-bar",
    d: "M540 444 H552 V716 H540 Z",
    label: "Pha chế",
    labelAt: { x: 488, y: 600 },
    estimated: true,
  },
  {
    id: "block-1",
    kind: "block",
    d: "M182 420 H240 V462 H182 Z",
    label: "Khối phụ 1",
    labelAt: { x: 211, y: 444 },
    estimated: true,
  },
  {
    id: "block-2",
    kind: "block",
    d: "M182 548 H240 V590 H182 Z",
    label: "Khối phụ 2",
    labelAt: { x: 211, y: 572 },
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

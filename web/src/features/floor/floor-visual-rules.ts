import { formatHonorificName } from "@/domain/booking-identity"
import { groupCodeFromSymbol, normalizeGroupCode } from "@/domain/group-code"
import type { FloorGroup, FloorTableState, TableLiveState, TableView } from "@/domain/models"
import { FIXTURES, FLOOR_H, FLOOR_W, WAITLIST_MARKER, WALL_BOUNDS, ZONES, type ZoneCode } from "@/domain/venue-layout"
import { DEFAULT_BAR_GUEST_LIST_BOUNDS } from "./bar-guest-rows"

/**
 * Approved icon priority (Nam 2026-11-04):
 * ⭐ VIP > 📌 Chỉ định > 🎂 Sinh nhật > 🔥 Đã từng đặt bàn > 🆕 Chưa từng đặt bàn
 */
export const GUEST_ICON_PRIORITY = ["VIP", "DESIGNATED", "BIRTHDAY", "RETURNING", "NEW"] as const
export type GuestFlag = (typeof GUEST_ICON_PRIORITY)[number]

export const GUEST_FLAG_META: Record<GuestFlag, { glyph: string; label: string }> = {
  VIP: { glyph: "⭐", label: "VIP" },
  DESIGNATED: { glyph: "📌", label: "Chỉ định" },
  BIRTHDAY: { glyph: "🎂", label: "Sinh nhật" },
  RETURNING: { glyph: "🔥", label: "Đã từng đặt bàn" },
  NEW: { glyph: "🆕", label: "Chưa từng đặt bàn" },
}

/**
 * Formats the guest name shown only on a compact floor/table label.
 * - Walk-ins without a real customer name show a short suitable label ("Khách lẻ" / "Lẻ"), never a fake name.
 * - Whitespace is normalized for display without changing the source value.
 * - Non-bar table cells preserve the beginning of the name (including honorifics like "Anh", "Chị") and truncate at the end with "…".
 * - Bar seats keep the compact trailing word when long.
 * - Unicode code points are truncated safely so a surrogate pair is never split.
 */
export function formatCellGuestName(displayName?: string | null, maxChars = 9, isBarSeat = false): string {
  const raw = (displayName ?? "").trim().replace(/\s+/gu, " ")
  if (!raw || /^(khách walk-in|walk-in|khách vãng lai|khách lẻ|khách)$/i.test(raw)) {
    return isBarSeat ? "Lẻ" : "Khách lẻ"
  }
  const candidate = isBarSeat && Array.from(raw).length > maxChars ? (raw.split(" ").at(-1) ?? raw) : raw
  const chars = Array.from(candidate)
  if (chars.length <= maxChars) return candidate
  return `${chars
    .slice(0, Math.max(2, maxChars - 1))
    .join("")
    .trimEnd()}…`
}

function estimateCellCharWidth(ch: string): number {
  if (ch === "…") return 7.4
  if ("iíìỉĩịlI1trfj.,:;'\"- ".includes(ch)) return 2.5
  if ("MWQĐƠƯmw".includes(ch)) return 6.0
  if (
    (ch >= "A" && ch <= "Z") ||
    (ch >= "0" && ch <= "9") ||
    (ch.toUpperCase() !== ch.toLowerCase() && ch === ch.toUpperCase())
  ) {
    return 4.9
  }
  return 4.0
}

function estimateCellLabelWidth(text: string): number {
  let width = 0
  for (const ch of text) width += estimateCellCharWidth(ch)
  return width
}

/**
 * Formats the single-line ordinary table label ("<code> - <guest>") at the
 * fixed 8.2 SVG unit font size, applying honorific metadata before end-ellipsis
 * truncation so the prefix and honorific stay intact and the text fits inside `cellWidth`.
 */
export function formatTableCellLabel(
  tableCode: string,
  displayName?: string | null,
  honorific?: "MR" | "MS" | null,
  cellWidth = 46,
): string {
  const raw = (displayName ?? "").trim().replace(/\s+/gu, " ")
  const isWalkInFallback = !raw || /^(khách walk-in|walk-in|khách vãng lai|khách lẻ|khách)$/i.test(raw)
  const fullName = isWalkInFallback ? "Khách lẻ" : formatHonorificName(raw, honorific)
  const prefix = `${tableCode} - `
  const fullLabel = `${prefix}${fullName}`
  const maxWidth = Math.max(24, cellWidth - 3)
  if (estimateCellLabelWidth(fullLabel) <= maxWidth) return fullLabel

  const chars = Array.from(fullName)
  const minKeep = Math.min(chars.length, honorific ? 2 : 2)
  for (let len = chars.length - 1; len >= minKeep; len--) {
    const trimmed = chars.slice(0, len).join("").trimEnd()
    if (!trimmed) continue
    const candidate = `${prefix}${trimmed}…`
    if (estimateCellLabelWidth(candidate) <= maxWidth) return candidate
  }
  return `${prefix}${chars.slice(0, minKeep).join("").trimEnd()}…`
}

export interface CellCornerIcons {
  /**
   * Empty since the approved mockup gave the top right corner to the turn
   * badge alone. Kept so a caller that still reads it does not crash.
   */
  topRight: never[]
  bottomLeft: Array<"fire" | "new">
  bottomRight: Array<"star" | "pin" | "cake">
}

/**
 * Resolves the corner icons for a table cell per J1 Section 3:
 * - Top right: nothing. The mockup puts the turn badge there, so an icon in
 *   that corner would sit on top of it.
 * - Bottom left: new or regular guest icon. Never both (RETURNING > NEW). UNCLASSIFIED shows none.
 * - Bottom right: table flags - Bàn sếp (star), Chỉ định (pin), Sinh nhật
 *   (cake). The mockup lists all three together in that corner.
 */
export function resolveCellCornerIcons(
  claim?: { flags?: string[] | null; iconKeys?: string[] | null } | null,
): CellCornerIcons {
  const result: CellCornerIcons = {
    topRight: [],
    bottomLeft: [],
    bottomRight: [],
  }
  if (!claim) return result

  const tokens = [
    ...(Array.isArray(claim.flags) ? claim.flags : []),
    ...(Array.isArray(claim.iconKeys) ? claim.iconKeys : []),
  ]
    .filter(Boolean)
    .map((t) => String(t).trim().toLowerCase())

  const hasBirthday = tokens.some(
    (k) => k === "birthday" || k === "cake" || k === "is_birthday" || k === "sinh nhật" || k === "sinh nhat",
  )
  const hasReturning = tokens.some(
    (k) => k === "returning" || k === "fire" || k === "regular" || k === "khách quen" || k === "khach quen",
  )
  const hasNew = tokens.some((k) => k === "new" || k === "khách mới" || k === "khach moi")
  if (hasReturning) {
    result.bottomLeft.push("fire")
  } else if (hasNew) {
    result.bottomLeft.push("new")
  }

  const hasStar = tokens.some((k) => k === "star" || k === "vip" || k === "boss" || k === "bàn sếp" || k === "ban sep")
  const hasPin = tokens.some((k) => k === "pin" || k === "designated" || k === "chỉ định" || k === "chi dinh")
  // Order follows the mockup's own list for this corner: VIP, then Chỉ định,
  // then Sinh nhật.
  if (hasStar) result.bottomRight.push("star")
  if (hasPin) result.bottomRight.push("pin")
  if (hasBirthday) result.bottomRight.push("cake")

  return result
}

export type LegendStatusKey = "free" | "reserved" | "upcoming" | "noshow" | "seated" | "spare"

export function calculateStatusCounts(
  tables: (TableView & { state?: TableLiveState; liveState?: TableLiveState; claim?: FloorTableState["claim"] })[],
  states?: Map<number, FloorTableState>,
): Record<LegendStatusKey, number> {
  const counts: Record<LegendStatusKey, number> = {
    free: 0,
    reserved: 0,
    upcoming: 0,
    noshow: 0,
    seated: 0,
    spare: 0,
  }

  const countedGroups = new Set<string>()

  for (const t of tables) {
    const fs = states?.get(t.id)
    const rawState: TableLiveState = fs?.state ?? t.state ?? t.liveState ?? (t.isSpare ? "spare" : "free")
    const claim = fs?.claim ?? t.claim

    let key: LegendStatusKey
    if (rawState === "late" || rawState === "late_confirmed" || rawState === "noshow" || rawState === "hold_overdue") {
      key = "noshow"
    } else if (rawState === "reserved" || rawState === "hold") {
      key = "reserved"
    } else if (rawState === "upcoming") {
      key = "upcoming"
    } else if (rawState === "seated") {
      key = "seated"
    } else if (rawState === "spare" || (t.isSpare && rawState === "free")) {
      key = "spare"
    } else {
      key = "free"
    }

    const groupId =
      claim?.groupId ??
      (claim?.groupDisplayCode || claim?.symbolNo ? (claim.groupDisplayCode ?? String(claim.symbolNo)) : null)

    if (groupId) {
      const groupKey = `${key}:${groupId}`
      if (countedGroups.has(groupKey)) {
        continue
      }
      countedGroups.add(groupKey)
    }

    counts[key] = (counts[key] ?? 0) + 1
  }

  return counts
}

/**
 * Giữ tên cũ cho ba chỗ gọi trong sơ đồ sàn. Luật đặt mã cụm giờ nằm ở
 * `@/domain/group-code`, để sổ lượt và các màn khác dùng chung một nguồn —
 * trước đây mỗi nơi tự quy đổi một kiểu nên cùng một cụm mang hai tên.
 */
export const groupCode = groupCodeFromSymbol
export const formatGroupCode = normalizeGroupCode

export interface ClusterOutlineCandidate {
  /** Hàng `table_groups` mà khung này thuộc về; null khi không suy ra được. */
  groupId: number | null
  tableIds: number[]
  code: string | null
}

/**
 * Mỗi cụm đúng một khung viền trên sơ đồ.
 *
 * Sơ đồ nhận hai nguồn cho cùng một cụm: `groups[]` (thành viên cụm, đọc từ
 * `table_group_members`) và `claim.tableIds` (bàn khách đang chiếm, đọc từ
 * `table_allocations`). Hai danh sách này LỆCH NHAU được: ghép thêm một bàn
 * cho khách đang ngồi trên cụm dùng lại `group_id` nhưng không thêm thành
 * viên vào cụm. Khử trùng theo danh sách bàn vì thế để lọt hai khung lồng
 * nhau, và vì chúng cùng toạ độ gốc nên hai chữ mã cụm bị vẽ đè khít lên
 * nhau — nhìn chỉ như một chữ hơi dày.
 *
 * Khử trùng theo `groupId` và giữ khung ôm nhiều bàn hơn: lúc khách ngồi thì
 * khung bao trọn tốp khách, lúc khách về thì chỉ còn khung của cụm. Dữ liệu
 * không bị đụng tới — cụm không tự lớn lên sau lưng lễ tân.
 */
export function oneOutlinePerCluster(candidates: readonly ClusterOutlineCandidate[]): ClusterOutlineCandidate[] {
  const byGroup = new Map<number, ClusterOutlineCandidate>()
  const ungrouped: ClusterOutlineCandidate[] = []

  for (const candidate of candidates) {
    if (candidate.groupId === null) {
      ungrouped.push(candidate)
      continue
    }
    const kept = byGroup.get(candidate.groupId)
    // Bằng nhau thì giữ cái tới trước: `groups[]` đi trước nên mã cụm vẫn lấy
    // từ cụm, không phải từ claim.
    if (!kept || candidate.tableIds.length > kept.tableIds.length) {
      byGroup.set(candidate.groupId, candidate)
    }
  }

  const seen = new Set<string>()
  const out: ClusterOutlineCandidate[] = []
  for (const candidate of [...byGroup.values(), ...ungrouped]) {
    const key = [...candidate.tableIds].sort((a, b) => a - b).join(",")
    if (seen.has(key)) continue
    seen.add(key)
    out.push(candidate)
  }
  return out
}

export function supportedFlags(flags: string[]): GuestFlag[] {
  return flags.filter(
    (flag, index): flag is GuestFlag =>
      GUEST_ICON_PRIORITY.includes(flag as GuestFlag) && flags.indexOf(flag) === index,
  )
}

export function tableCanActivate(tableId: number, pickable: Set<number> | null | undefined, selected: Set<number>) {
  return !pickable || pickable.has(tableId) || selected.has(tableId)
}

export interface Bounds {
  x: number
  y: number
  w: number
  h: number
}

export const CELL_CORNER_INSET_X = 4.2
export const CELL_CORNER_INSET_Y = 3.1
export const GUEST_BADGE_HEIGHT = 11.0
export const GUEST_BADGE_STROKE = 0.9
export const TURN_BADGE_RADIUS = 5.5
export const TURN_BADGE_STROKE = 0.85
export const TABLE_ICON_RADIUS = 5.5
export const TABLE_ICON_STROKE = 0.8
export const TABLE_ICON_MAX_STEP = 12.0

export function guestBadgeWidth(count: number): number {
  if (count >= 100) return 18.2
  if (count >= 10) return 15.0
  return 12.0
}

export function turnBadgeWidth(count: number, radius = TURN_BADGE_RADIUS): number {
  if (count >= 100) return Number((radius * 3.12).toFixed(2))
  if (count >= 10) return Number((radius * 2.58).toFixed(2))
  return radius * 2
}

export interface TableCornerGeometry {
  hw: number
  hh: number
  guestBadge: {
    y: number
    height: number
    strokeWidth: number
    widthFor: (count: number) => number
    centerXFor: (count: number) => number
  }
  turnBadge: {
    y: number
    r: number
    strokeWidth: number
    widthFor: (count: number) => number
    centerXFor: (count: number) => number
  }
  bottomLeftIcons: {
    x: number
    y: number
    radius: number
    strokeWidth: number
    radiusFor: (count: number, oppositeCount?: number) => number
    stepFor: (count: number, oppositeCount?: number) => number
  }
  bottomRightIcons: {
    x: number
    y: number
    radius: number
    strokeWidth: number
    radiusFor: (count: number, oppositeCount?: number) => number
    stepFor: (count: number, oppositeCount?: number) => number
  }
  staleMark: {
    xFor: (guestCount?: number | null) => number
    y: number
    r: number
  }
}

/**
 * Shared corner geometry for a regular table cell (local coordinates around
 * cell center 0,0). Used by both FloorCanvas and computeClusterDecorations so
 * rendered corner badges/icons and collision-avoidance boxes stay identical.
 */
export function getTableCornerGeometry(w: number, h: number): TableCornerGeometry {
  const hw = w / 2
  const hh = h / 2
  const topY = -hh + CELL_CORNER_INSET_Y
  const bottomY = hh - CELL_CORNER_INSET_Y
  // Outer left edge of guest badge stays aligned with icon circle outer left edge
  const guestLeftInner = -hw + CELL_CORNER_INSET_X - TURN_BADGE_RADIUS
  // Outer right edge of turn badge stays aligned with icon circle outer right edge
  const turnRightInner = hw - CELL_CORNER_INSET_X + TURN_BADGE_RADIUS

  const totalIntervalsFor = (count: number, oppositeCount = 0): number => {
    const total = count + oppositeCount
    return Math.max(1, total - 1)
  }

  const iconStepFor = (count: number, oppositeCount = 0): number => {
    if (count <= 1) return TABLE_ICON_MAX_STEP
    const fullSpan = w - 2 * CELL_CORNER_INSET_X
    const candidate = fullSpan / totalIntervalsFor(count, oppositeCount)
    return Math.min(TABLE_ICON_MAX_STEP, Number(candidate.toFixed(2)))
  }

  const iconRadiusFor = (count: number, oppositeCount = 0): number => {
    const total = count + oppositeCount
    if (total <= 1) return TABLE_ICON_RADIUS
    const fullSpan = w - 2 * CELL_CORNER_INSET_X
    const minCenterStep = fullSpan / (total - 1)
    const maxRadiusForGap = (minCenterStep - TABLE_ICON_STROKE - 0.12) / 2
    return Math.min(TABLE_ICON_RADIUS, Number(maxRadiusForGap.toFixed(2)))
  }

  return {
    hw,
    hh,
    guestBadge: {
      y: topY,
      height: GUEST_BADGE_HEIGHT,
      strokeWidth: GUEST_BADGE_STROKE,
      widthFor: guestBadgeWidth,
      centerXFor: (count: number) => guestLeftInner + guestBadgeWidth(count) / 2,
    },
    turnBadge: {
      y: topY,
      r: TURN_BADGE_RADIUS,
      strokeWidth: TURN_BADGE_STROKE,
      widthFor: (count: number) => turnBadgeWidth(count, TURN_BADGE_RADIUS),
      centerXFor: (count: number) => turnRightInner - turnBadgeWidth(count, TURN_BADGE_RADIUS) / 2,
    },
    bottomLeftIcons: {
      x: -hw + CELL_CORNER_INSET_X,
      y: bottomY,
      radius: TABLE_ICON_RADIUS,
      strokeWidth: TABLE_ICON_STROKE,
      radiusFor: iconRadiusFor,
      stepFor: iconStepFor,
    },
    bottomRightIcons: {
      x: hw - CELL_CORNER_INSET_X,
      y: bottomY,
      radius: TABLE_ICON_RADIUS,
      strokeWidth: TABLE_ICON_STROKE,
      radiusFor: iconRadiusFor,
      stepFor: iconStepFor,
    },
    staleMark: {
      xFor: (guestCount?: number | null) =>
        guestCount && guestCount > 0 ? guestLeftInner + guestBadgeWidth(guestCount) + 6 : -hw + CELL_CORNER_INSET_X,
      y: topY,
      r: 5,
    },
  }
}

export interface TableCornerObstacleBoxes {
  guestBadge: RectBox | null
  turnBadge: RectBox | null
  bottomLeftIcons: RectBox | null
  bottomRightIcons: RectBox | null
  paidDot: RectBox | null
  staleMark: RectBox | null
}

/**
 * Computes stroke-inclusive bounding boxes (in floor SVG space) for every
 * corner badge/icon on a regular table cell using `getTableCornerGeometry`.
 */
export function getTableCornerObstacleBoxes(
  table: Pick<TableView, "x" | "y" | "w" | "h" | "kind">,
  opts: {
    claim?: FloorTableState["claim"] | null
    turnCount?: number | null
    isAnchor?: boolean
    hasActiveClaim?: boolean
    staleFromPreviousDay?: boolean
  },
  margin = 0.5,
): TableCornerObstacleBoxes {
  const empty: TableCornerObstacleBoxes = {
    guestBadge: null,
    turnBadge: null,
    bottomLeftIcons: null,
    bottomRightIcons: null,
    paidDot: null,
    staleMark: null,
  }
  if (table.kind === "BAR_SEAT") return empty

  const geo = getTableCornerGeometry(table.w, table.h)
  const isAnchor = opts.isAnchor ?? true
  const hasActiveClaim = opts.hasActiveClaim ?? Boolean(opts.claim)
  const claim = opts.claim ?? null

  let guestBadge: RectBox | null = null
  let bottomLeftIcons: RectBox | null = null
  let bottomRightIcons: RectBox | null = null
  let paidDot: RectBox | null = null
  const icons = resolveCellCornerIcons(claim)

  if (hasActiveClaim && isAnchor && claim) {
    if (claim.partySize && claim.partySize > 0) {
      const bw = geo.guestBadge.widthFor(claim.partySize)
      const bh = geo.guestBadge.height
      const halfStroke = geo.guestBadge.strokeWidth / 2
      const cx = table.x + geo.guestBadge.centerXFor(claim.partySize)
      const cy = table.y + geo.guestBadge.y
      guestBadge = {
        left: cx - bw / 2 - halfStroke - margin,
        top: cy - bh / 2 - halfStroke - margin,
        right: cx + bw / 2 + halfStroke + margin,
        bottom: cy + bh / 2 + halfStroke + margin,
      }
    }

    if (icons.bottomLeft.length > 0) {
      const cx = table.x + geo.bottomLeftIcons.x
      const cy = table.y + geo.bottomLeftIcons.y
      const r = geo.bottomLeftIcons.radiusFor(icons.bottomLeft.length, icons.bottomRight.length)
      const iconPad = r + TABLE_ICON_STROKE / 2 + margin
      const step = geo.bottomLeftIcons.stepFor(icons.bottomLeft.length, icons.bottomRight.length)
      bottomLeftIcons = {
        left: cx - iconPad,
        top: cy - iconPad,
        right: cx + iconPad + (icons.bottomLeft.length - 1) * step,
        bottom: cy + iconPad,
      }
    }

    if (icons.bottomRight.length > 0) {
      const cx = table.x + geo.bottomRightIcons.x
      const cy = table.y + geo.bottomRightIcons.y
      const r = geo.bottomRightIcons.radiusFor(icons.bottomRight.length, icons.bottomLeft.length)
      const iconPad = r + TABLE_ICON_STROKE / 2 + margin
      const step = geo.bottomRightIcons.stepFor(icons.bottomRight.length, icons.bottomLeft.length)
      bottomRightIcons = {
        left: cx - iconPad - (icons.bottomRight.length - 1) * step,
        top: cy - iconPad,
        right: cx + iconPad,
        bottom: cy + iconPad,
      }
    }
  }
  if (claim?.paid && icons.bottomRight.length === 0) {
    const cx = table.x + geo.bottomRightIcons.x
    const cy = table.y + geo.bottomRightIcons.y
    const iconPad = TABLE_ICON_RADIUS + TABLE_ICON_STROKE / 2 + margin
    paidDot = {
      left: cx - iconPad,
      top: cy - iconPad,
      right: cx + iconPad,
      bottom: cy + iconPad,
    }
  }

  let turnBadge: RectBox | null = null
  if (isAnchor && typeof opts.turnCount === "number" && opts.turnCount >= 2) {
    const tw = geo.turnBadge.widthFor(opts.turnCount)
    const th = geo.turnBadge.r * 2
    const halfStroke = geo.turnBadge.strokeWidth / 2
    const cx = table.x + geo.turnBadge.centerXFor(opts.turnCount)
    const cy = table.y + geo.turnBadge.y
    turnBadge = {
      left: cx - tw / 2 - halfStroke - margin,
      top: cy - th / 2 - halfStroke - margin,
      right: cx + tw / 2 + halfStroke + margin,
      bottom: cy + th / 2 + halfStroke + margin,
    }
  }

  let staleMark: RectBox | null = null
  if (opts.staleFromPreviousDay) {
    const activeGuestCount = hasActiveClaim && isAnchor ? claim?.partySize : null
    const cx = table.x + geo.staleMark.xFor(activeGuestCount)
    const cy = table.y + geo.staleMark.y
    const rPad = geo.staleMark.r + margin
    staleMark = {
      left: cx - rPad,
      top: cy - rPad,
      right: cx + rPad,
      bottom: cy + rPad,
    }
  }

  return { guestBadge, turnBadge, bottomLeftIcons, bottomRightIcons, paidDot, staleMark }
}

export function normalizeIconKey(raw: string): "star" | "fire" | "pin" | "cake" | "new" | null {
  const k = raw.trim().toLowerCase()
  if (k === "star" || k === "vip" || k === "boss" || k === "bàn sếp" || k === "ban sep") return "star"
  if (k === "fire" || k === "returning" || k === "regular" || k === "khách quen" || k === "khach quen") return "fire"
  if (k === "pin" || k === "designated" || k === "chỉ định" || k === "chi dinh") return "pin"
  if (k === "cake" || k === "birthday" || k === "is_birthday" || k === "sinh nhật" || k === "sinh nhat") return "cake"
  if (k === "new" || k === "khách mới" || k === "khach moi") return "new"
  return null
}

/**
 * Resolves the representative member of a group or multi-table booking (K1 Section 7):
 * - One total guest badge on one representative member with enough room.
 * - Prefers regular tables over Bar seats (more room for badges).
 * - Sorts by code / seqNo so anchor is deterministic.
 */
export function findGroupRepresentativeId(members: TableView[]): number {
  if (members.length === 0) return 0
  if (members.length === 1) return members[0].id
  const regular = members.filter((m) => m.kind !== "BAR_SEAT")
  const pool = regular.length > 0 ? regular : members
  const sorted = [...pool].sort((a, b) => {
    if (a.kind === "BAR_SEAT" && b.kind === "BAR_SEAT") {
      return (a.seqNo ?? a.id) - (b.seqNo ?? b.id)
    }
    const codeA = a.code ?? String(a.id)
    const codeB = b.code ?? String(b.id)
    return codeA.localeCompare(codeB, undefined, { numeric: true })
  })
  return sorted[0].id
}

export function groupDisplayName(members: TableView[], group?: FloorGroup | null): string {
  if (group?.displayCode) return group.displayCode
  const sorted = [...members].sort((a, b) =>
    a.kind === "BAR_SEAT"
      ? (a.seqNo ?? 0) - (b.seqNo ?? 0)
      : a.code.localeCompare(b.code, undefined, { numeric: true }),
  )
  if (sorted[0]?.kind === "BAR_SEAT") {
    const numbers = sorted.map((t) => t.seqNo ?? 0)
    const consecutive = numbers.every((n, i) => n === numbers[0] + i)
    return `Bar${consecutive ? `${numbers[0]}-${numbers.at(-1)}` : numbers.join("-")}`
  }
  return sorted.map((t) => t.code).join("-")
}

/**
 * Every point an absolute SVG path names. Fixture paths use only M, L, H, V, A
 * and Z with absolute values, and an arc never leaves the box its endpoints
 * make, so the points alone bound the path.
 */
export function fixturePathPoints(d: string): [number, number][] {
  const out: [number, number][] = []
  let cur: [number, number] = [0, 0]
  const re = /([MLHVA])([^MLHVAZ]*)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(d)) !== null) {
    const cmd = m[1].toUpperCase()
    const n = (m[2].match(/-?\d*\.?\d+/g) ?? []).map(Number)
    if (cmd === "M" || cmd === "L") {
      for (let i = 0; i + 1 < n.length; i += 2) {
        cur = [n[i], n[i + 1]]
        out.push(cur)
      }
    } else if (cmd === "H") {
      for (const v of n) {
        cur = [v, cur[1]]
        out.push(cur)
      }
    } else if (cmd === "V") {
      for (const v of n) {
        cur = [cur[0], v]
        out.push(cur)
      }
    } else if (cmd === "A") {
      // rx ry rotation large-arc sweep x y
      for (let i = 0; i + 6 < n.length; i += 7) {
        cur = [n[i + 5], n[i + 6]]
        out.push(cur)
      }
    }
  }
  return out
}

export function computeZoneBounds(tables: TableView[], zone: ZoneCode | "ALL", padding?: number): Bounds | null {
  if (zone === "ALL") {
    const pad = padding !== undefined ? padding : 0

    // The whole plan container, 374 x 732 - the frame plus the small margin
    // the mockup leaves around it for the entrance label. Fitting against the
    // container (not the frame) is what makes the camera scale exactly
    // k = min(W / 374, H / 732), the rule the approved mockup states.
    let minX: number = 0
    let minY: number = 0
    let maxX: number = FLOOR_W
    let maxY: number = FLOOR_H

    // Union with every fixture, read from its own path. These used to be
    // hardcoded numbers per fixture kind, which silently kept the old floor's
    // extents after the layout was redrawn and shrank the whole plan on screen.
    for (const f of FIXTURES) {
      for (const [px, py] of fixturePathPoints(f.d)) {
        minX = Math.min(minX, px)
        maxX = Math.max(maxX, px)
        minY = Math.min(minY, py)
        maxY = Math.max(maxY, py)
      }
      if (f.labelAt) {
        minX = Math.min(minX, f.labelAt.x - 20)
        maxX = Math.max(maxX, f.labelAt.x + 20)
        minY = Math.min(minY, f.labelAt.y - 8)
        maxY = Math.max(maxY, f.labelAt.y + 3)
      }
    }

    // The waitlist marker is drawn in floor space too, so it must stay in view.
    minX = Math.min(minX, WAITLIST_MARKER.x - WAITLIST_MARKER.width / 2)
    maxX = Math.max(maxX, WAITLIST_MARKER.x + WAITLIST_MARKER.width / 2)
    minY = Math.min(minY, WAITLIST_MARKER.y - WAITLIST_MARKER.height / 2)
    maxY = Math.max(maxY, WAITLIST_MARKER.y + WAITLIST_MARKER.height / 2)

    // Union with all tables and seats
    for (const t of tables) {
      const hw = (t.w || 24) / 2
      const hh = (t.h || 24) / 2
      minX = Math.min(minX, t.x - hw)
      maxX = Math.max(maxX, t.x + hw)
      minY = Math.min(minY, t.y - hh)
      maxY = Math.max(maxY, t.y + hh)
    }

    return {
      x: minX - pad,
      y: minY - pad,
      w: maxX - minX + pad * 2,
      h: maxY - minY + pad * 2,
    }
  }

  const pad = padding !== undefined ? padding : 24
  const inZone = tables.filter((t) => t.zoneCode === zone)
  if (!inZone.length && zone !== "BAR") {
    return null
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const t of inZone) {
    const hw = (t.w || 24) / 2
    const hh = (t.h || 24) / 2
    minX = Math.min(minX, t.x - hw)
    maxX = Math.max(maxX, t.x + hw)
    minY = Math.min(minY, t.y - hh)
    maxY = Math.max(maxY, t.y + hh)
  }

  // Include zone fixtures and labels
  if (zone === "BAR") {
    minX = Math.min(minX, 396 - 0.6)
    maxX = Math.max(maxX, 552 + 0.6)
    minY = Math.min(minY, 404 - 0.6)
    maxY = Math.max(maxY, 722 + 0.6)
    minX = Math.min(minX, 453)
    maxX = Math.max(maxX, 552.4)
    minY = Math.min(minY, 443.6)
    maxY = Math.max(maxY, 716.4)
  } else if (zone === "A") {
    minX = Math.min(minX, 62)
    maxX = Math.max(maxX, 62 + 35)
    minY = Math.min(minY, 726 - 8)
    maxY = Math.max(maxY, 726 + 2)
    minX = Math.min(minX, 44)
    maxX = Math.max(maxX, 54)
    minY = Math.min(minY, 362)
    maxY = Math.max(maxY, 716)
  } else if (zone === "B") {
    minX = Math.min(minX, 62)
    maxX = Math.max(maxX, 62 + 35)
    minY = Math.min(minY, 194 - 8)
    maxY = Math.max(maxY, 194 + 2)
  } else if (zone === "C") {
    minX = Math.min(minX, 442 - 40)
    maxX = Math.max(maxX, 442)
    minY = Math.min(minY, 84 - 8)
    maxY = Math.max(maxY, 84 + 14)
  }

  return {
    x: minX - pad,
    y: minY - pad,
    w: maxX - minX + pad * 2,
    h: maxY - minY + pad * 2,
  }
}

export const CLUSTER_OUTLINE_STROKE = 1.6
export const CLUSTER_CODE_STROKE = 1.4
const CLUSTER_OUTLINE_HALF_STROKE = CLUSTER_OUTLINE_STROKE / 2
const CLUSTER_CODE_HEIGHT = 14
const CLUSTER_CODE_HALF_STROKE = CLUSTER_CODE_STROKE / 2
const BAR_CLUSTER_PAD = 2
const TABLE_CLUSTER_MAX_PAD = 3.0
const TABLE_CLUSTER_MIN_PAD = 1.8
const CLUSTER_MIN_STROKE_GAP = 1.2

interface RectBox {
  left: number
  top: number
  right: number
  bottom: number
}

export interface ClusterDecoration {
  key: string
  x: number
  y: number
  w: number
  h: number
  code: string | null
  isBar: boolean
  orientation: "horizontal" | "vertical" | null
  cornerCuts: RectBox[]
  label: {
    x: number
    y: number
    width: number
    height: number
    side: "left" | "right" | "top" | "bottom"
  } | null
}

/** Pill width for a cluster code such as "G01" or "◆A". */
export function formatGroupCodeWidth(code: string): number {
  return Math.max(18, code.length * 5.6 + 8)
}

function rectsOverlapWithGap(a: RectBox, b: RectBox, gap = 0): boolean {
  return !(a.right + gap <= b.left || b.right + gap <= a.left || a.bottom + gap <= b.top || b.bottom + gap <= a.top)
}

function deriveTableClusterPad(raw: RectBox, memberIds: Set<number>, tables: TableView[]): number {
  let minNeighborGap = Infinity
  for (const other of tables) {
    if (memberIds.has(other.id)) continue
    const oLeft = other.x - other.w / 2
    const oRight = other.x + other.w / 2
    const oTop = other.y - other.h / 2
    const oBottom = other.y + other.h / 2
    const dx = Math.max(0, raw.left - oRight, oLeft - raw.right)
    const dy = Math.max(0, raw.top - oBottom, oTop - raw.bottom)
    if (dx === 0 && dy > 0) {
      minNeighborGap = Math.min(minNeighborGap, dy)
    } else if (dy === 0 && dx > 0) {
      minNeighborGap = Math.min(minNeighborGap, dx)
    } else if (dx > 0 && dy > 0 && Math.max(dx, dy) < 10) {
      minNeighborGap = Math.min(minNeighborGap, Math.hypot(dx, dy))
    }
  }
  if (!Number.isFinite(minNeighborGap)) return TABLE_CLUSTER_MAX_PAD
  // Reserve half the gap per cluster so two adjacent outlines (including their
  // 1.6-unit strokes) stay separated by at least CLUSTER_MIN_STROKE_GAP.
  const available = minNeighborGap / 2 - CLUSTER_OUTLINE_HALF_STROKE - CLUSTER_MIN_STROKE_GAP / 2
  return Math.min(TABLE_CLUSTER_MAX_PAD, Math.max(TABLE_CLUSTER_MIN_PAD, available))
}

/**
 * Computes non-overlapping cluster outline frames and collision-free group
 * label pill coordinates in SVG floor space without moving any table or seat.
 */
export function computeClusterDecorations({
  tables,
  groups,
  states,
  mode,
  groupRepresentativeMap,
  tableById,
  includeWaitlistMarker = false,
}: {
  tables: TableView[]
  groups: FloorGroup[]
  states?: Map<number, FloorTableState>
  mode: "live" | "availability"
  groupRepresentativeMap: Map<number, boolean>
  tableById: Map<number, TableView>
  includeWaitlistMarker?: boolean
}): ClusterDecoration[] {
  const seen = new Set<string>()
  const rawClusters: {
    key: string
    x: number
    y: number
    w: number
    h: number
    code: string | null
    isBar: boolean
    orientation: "horizontal" | "vertical" | null
    members: TableView[]
  }[] = []

  const add = (ids: number[], code: string | null) => {
    const members = ids.map((id) => tableById.get(id)).filter((t): t is TableView => !!t)
    if (members.length < 2) return
    const key = [...ids].sort((a, b) => a - b).join(",")
    if (seen.has(key)) return
    seen.add(key)
    const isBar = members.every((t) => t.kind === "BAR_SEAT")
    const spreadX = Math.max(...members.map((t) => t.x)) - Math.min(...members.map((t) => t.x))
    const spreadY = Math.max(...members.map((t) => t.y)) - Math.min(...members.map((t) => t.y))
    const orientation = isBar ? (spreadY > spreadX ? "vertical" : "horizontal") : null
    const raw: RectBox = {
      left: Math.min(...members.map((t) => t.x - t.w / 2)),
      right: Math.max(...members.map((t) => t.x + t.w / 2)),
      top: Math.min(...members.map((t) => t.y - t.h / 2)),
      bottom: Math.max(...members.map((t) => t.y + t.h / 2)),
    }
    const memberIds = new Set(members.map((m) => m.id))
    const pad = isBar ? BAR_CLUSTER_PAD : deriveTableClusterPad(raw, memberIds, tables)
    rawClusters.push({
      key,
      x: raw.left - pad,
      y: raw.top - pad,
      w: raw.right - raw.left + pad * 2,
      h: raw.bottom - raw.top + pad * 2,
      code,
      isBar,
      orientation,
      members,
    })
  }

  // Gom ứng viên từ cả hai nguồn rồi mới chọn. `add` khử trùng theo DANH SÁCH
  // BÀN, mà cùng một cụm có thể xuất hiện ở hai nguồn với hai danh sách lệch
  // nhau: ghép thêm bàn cho khách đang ngồi trên cụm dùng lại `group_id` nhưng
  // không thêm thành viên vào cụm. Khi đó sơ đồ vẽ hai khung lồng nhau và hai
  // chữ mã cụm đè khít lên nhau. Xem `oneOutlinePerCluster`.
  const candidates: ClusterOutlineCandidate[] = groups.map((g) => ({
    groupId: g.id ?? null,
    tableIds: g.tableIds,
    code: formatGroupCode(g.displayCode ?? g.symbolNo),
  }))
  if (states) {
    for (const fs of states.values()) {
      const claim = fs?.claim
      if (claim?.tableIds && claim.tableIds.length > 1) {
        candidates.push({
          groupId: claim.groupId ?? null,
          tableIds: claim.tableIds,
          code: formatGroupCode(claim.groupDisplayCode ?? claim.symbolNo),
        })
      }
    }
  }
  for (const candidate of oneOutlinePerCluster(candidates)) add(candidate.tableIds, candidate.code)

  rawClusters.sort((a, b) => a.y - b.y || a.x - b.x || (a.code ?? a.key).localeCompare(b.code ?? b.key))

  const groupTurnMap = new Map<number, FloorGroup["seatedTurnCount"]>()
  for (const g of groups) {
    for (const id of g.tableIds) {
      groupTurnMap.set(id, g.seatedTurnCount)
    }
  }

  const baseObstacles: RectBox[] = []
  const cornerObstacles: RectBox[] = []
  for (const t of tables) {
    if (t.kind === "BAR_SEAT") {
      const r = Math.max(9, (t.w || 20) / 2)
      baseObstacles.push({ left: t.x - r - 1.5, top: t.y - r - 1.5, right: t.x + r + 1.5, bottom: t.y + r + 1.5 })
    } else {
      const hw = t.w / 2
      const hh = t.h / 2
      const chairPad = t.seating === "none" ? 0 : 6.5
      baseObstacles.push({
        left: t.x - hw - 1.5 - chairPad,
        top: t.y - hh - 1.5 - chairPad,
        right: t.x + hw + 1.5 + chairPad,
        bottom: t.y + hh + 1.5 + chairPad,
      })
    }

    if (mode !== "live") continue
    const fs = states?.get(t.id)
    const rawState: TableLiveState = fs?.state ?? "free"
    const state = rawState === "late_confirmed" ? "late" : rawState
    const claim = fs?.claim
    const isAnchor = groupRepresentativeMap.get(t.id) ?? true
    const hasActiveClaim = !!claim && state !== "free" && state !== "spare" && state !== "oos"

    if (t.kind !== "BAR_SEAT") {
      const boxes = getTableCornerObstacleBoxes(t, {
        claim,
        turnCount: fs?.seatedTurnCount ?? groupTurnMap.get(t.id),
        isAnchor,
        hasActiveClaim,
        staleFromPreviousDay: fs?.staleFromPreviousDay,
      })
      for (const box of [
        boxes.guestBadge,
        boxes.turnBadge,
        boxes.bottomLeftIcons,
        boxes.bottomRightIcons,
        boxes.paidDot,
        boxes.staleMark,
      ]) {
        if (box) cornerObstacles.push(box)
      }
    }
  }

  for (const z of ZONES) {
    if (!z.label) continue
    if (z.label.anchor === "end") {
      baseObstacles.push({ left: z.label.x - 42, top: z.label.y - 9, right: z.label.x + 2, bottom: z.label.y + 3 })
    } else {
      baseObstacles.push({ left: z.label.x - 2, top: z.label.y - 9, right: z.label.x + 42, bottom: z.label.y + 3 })
    }
  }
  baseObstacles.push({ left: 170, top: 340, right: 196, bottom: 674 })
  baseObstacles.push({
    left: DEFAULT_BAR_GUEST_LIST_BOUNDS.x,
    top: DEFAULT_BAR_GUEST_LIST_BOUNDS.y,
    right: DEFAULT_BAR_GUEST_LIST_BOUNDS.x + DEFAULT_BAR_GUEST_LIST_BOUNDS.width,
    bottom: DEFAULT_BAR_GUEST_LIST_BOUNDS.y + DEFAULT_BAR_GUEST_LIST_BOUNDS.height,
  })
  if (includeWaitlistMarker) {
    baseObstacles.push({
      left: WAITLIST_MARKER.x - WAITLIST_MARKER.width / 2,
      top: WAITLIST_MARKER.y - WAITLIST_MARKER.height / 2,
      right: WAITLIST_MARKER.x + WAITLIST_MARKER.width / 2,
      bottom: WAITLIST_MARKER.y + WAITLIST_MARKER.height / 2,
    })
  }

  const wallInner: RectBox = {
    left: WALL_BOUNDS.x + 2,
    top: WALL_BOUNDS.y + 2,
    right: WALL_BOUNDS.x + WALL_BOUNDS.w - 2,
    bottom: WALL_BOUNDS.y + WALL_BOUNDS.h - 2,
  }

  const placedLabels: RectBox[] = []

  return rawClusters.map((c) => {
    const frameBounds = { left: c.x, top: c.y, right: c.x + c.w, bottom: c.y + c.h }
    const cornerCuts = cornerObstacles.filter((box) =>
      rectsOverlapWithGap(frameBounds, box, CLUSTER_OUTLINE_HALF_STROKE),
    )
    if (!c.code) {
      return {
        key: c.key,
        x: c.x,
        y: c.y,
        w: c.w,
        h: c.h,
        code: null,
        isBar: c.isBar,
        orientation: c.orientation,
        cornerCuts,
        label: null,
      }
    }

    const pw = formatGroupCodeWidth(c.code)
    const ph = CLUSTER_CODE_HEIGHT
    const otherOutlines: RectBox[] = rawClusters
      .filter((o) => o.key !== c.key)
      .map((o) => ({
        left: o.x - CLUSTER_OUTLINE_HALF_STROKE,
        top: o.y - CLUSTER_OUTLINE_HALF_STROKE,
        right: o.x + o.w + CLUSTER_OUTLINE_HALF_STROKE,
        bottom: o.y + o.h + CLUSTER_OUTLINE_HALF_STROKE,
      }))
    const obstacles = [...baseObstacles, ...cornerObstacles, ...otherOutlines, ...placedLabels]

    const candidates: { x: number; y: number; side: "left" | "right" | "top" | "bottom" }[] = []
    if (c.isBar && c.orientation === "vertical") {
      candidates.push(
        { x: c.x - pw - 4, y: c.y + 2, side: "left" },
        { x: c.x - pw - 4, y: c.y + (c.h - ph) / 2, side: "left" },
        { x: c.x - pw - 4, y: c.y + c.h - ph - 2, side: "left" },
        { x: c.x + c.w + 4, y: c.y + 2, side: "right" },
        { x: c.x + c.w + 4, y: c.y + (c.h - ph) / 2, side: "right" },
        { x: c.x + (c.w - pw) / 2, y: c.y - ph - 1.5, side: "top" },
        { x: c.x + (c.w - pw) / 2, y: c.y + c.h + 1.5, side: "bottom" },
      )
    } else if (c.isBar && c.orientation === "horizontal") {
      candidates.push(
        { x: c.x + 3, y: c.y - ph - 1.5, side: "top" },
        { x: c.x + c.w - pw - 3, y: c.y - ph - 1.5, side: "top" },
        { x: c.x + 3, y: c.y + c.h + 1.5, side: "bottom" },
        { x: c.x + c.w - pw - 3, y: c.y + c.h + 1.5, side: "bottom" },
        { x: c.x - pw - 4, y: c.y + (c.h - ph) / 2, side: "left" },
        { x: c.x + c.w + 4, y: c.y + (c.h - ph) / 2, side: "right" },
      )
    } else {
      const sortedMembers = [...c.members].sort((a, b) => a.y - b.y || a.x - b.x)
      candidates.push(
        { x: c.x + 2, y: c.y - ph - 1.2, side: "top" },
        { x: c.x + c.w - pw - 2, y: c.y - ph - 1.2, side: "top" },
        { x: c.x, y: c.y - ph - 1.2, side: "top" },
        { x: c.x + c.w - pw, y: c.y - ph - 1.2, side: "top" },
        { x: c.x - 2, y: c.y - ph - 1.2, side: "top" },
        { x: c.x + (c.w - pw) / 2, y: c.y - ph - 1.2, side: "top" },
      )
      for (const m of sortedMembers) {
        candidates.push({ x: c.x - pw - 3, y: m.y - ph / 2, side: "left" })
      }
      for (const m of sortedMembers) {
        candidates.push({ x: c.x + c.w + 3, y: m.y - ph / 2, side: "right" })
      }
      candidates.push(
        { x: c.x + 2, y: c.y + c.h + 1.2, side: "bottom" },
        { x: c.x + c.w - pw - 2, y: c.y + c.h + 1.2, side: "bottom" },
        { x: c.x, y: c.y + c.h + 1.2, side: "bottom" },
        { x: c.x + c.w - pw, y: c.y + c.h + 1.2, side: "bottom" },
        { x: c.x - 2, y: c.y + c.h + 1.2, side: "bottom" },
        { x: c.x + (c.w - pw) / 2, y: c.y + c.h + 1.2, side: "bottom" },
      )
    }

    const toBox = (cand: { x: number; y: number }): RectBox => ({
      left: cand.x - CLUSTER_CODE_HALF_STROKE,
      top: cand.y - CLUSTER_CODE_HALF_STROKE,
      right: cand.x + pw + CLUSTER_CODE_HALF_STROKE,
      bottom: cand.y + ph + CLUSTER_CODE_HALF_STROKE,
    })

    const fitsInWall = (box: RectBox) =>
      box.left >= wallInner.left &&
      box.right <= wallInner.right &&
      box.top >= wallInner.top &&
      box.bottom <= wallInner.bottom

    const gap = 0.4
    const canPlace = (point: { x: number; y: number }) => {
      const box = toBox(point)
      return fitsInWall(box) && obstacles.every((obs) => !rectsOverlapWithGap(box, obs, gap))
    }
    let chosen = candidates.find(canPlace)
    if (!chosen) {
      obstacles.push(frameBounds)
      const nearby = candidates[0]
      const margin = CLUSTER_CODE_HALF_STROKE + gap + 0.01
      // Axis-aligned clearance changes only at obstacle edges, so test the clear sides of each edge.
      const xs = new Set([
        nearby.x,
        wallInner.left + CLUSTER_CODE_HALF_STROKE,
        ...obstacles.flatMap((box) => [box.left - pw - margin, box.right + margin]),
      ])
      const ys = new Set([
        nearby.y,
        wallInner.top + CLUSTER_CODE_HALF_STROKE,
        ...obstacles.flatMap((box) => [box.top - ph - margin, box.bottom + margin]),
      ])
      let bestDistance = Infinity
      for (const x of xs) {
        for (const y of ys) {
          const distance = (x - nearby.x) ** 2 + (y - nearby.y) ** 2
          if (distance >= bestDistance || !canPlace({ x, y })) continue
          bestDistance = distance
          const side = y + ph <= c.y ? "top" : y >= c.y + c.h ? "bottom" : x + pw <= c.x ? "left" : "right"
          chosen = { x, y, side }
        }
      }
    }

    if (chosen) placedLabels.push(toBox(chosen))
    return {
      key: c.key,
      x: c.x,
      y: c.y,
      w: c.w,
      h: c.h,
      code: c.code,
      isBar: c.isBar,
      orientation: c.orientation,
      cornerCuts,
      label: chosen ? { ...chosen, width: pw, height: ph } : null,
    }
  })
}

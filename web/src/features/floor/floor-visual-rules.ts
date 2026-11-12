import type { FloorGroup, FloorTableState, TableLiveState, TableView } from "@/domain/models"
import { FIXTURES, FLOOR_H, FLOOR_W, WAITLIST_MARKER, type ZoneCode } from "@/domain/venue-layout"

/**
 * Approved icon priority (Nam 2026-11-04):
 * ⭐ VIP > 📌 Chỉ định > 🎂 Sinh nhật > 🔥 Khách quen > 🆕 Khách mới
 */
export const GUEST_ICON_PRIORITY = ["VIP", "DESIGNATED", "BIRTHDAY", "RETURNING", "NEW"] as const
export type GuestFlag = (typeof GUEST_ICON_PRIORITY)[number]

export const GUEST_FLAG_META: Record<GuestFlag, { glyph: string; label: string }> = {
  VIP: { glyph: "⭐", label: "VIP" },
  DESIGNATED: { glyph: "📌", label: "Chỉ định" },
  BIRTHDAY: { glyph: "🎂", label: "Sinh nhật" },
  RETURNING: { glyph: "🔥", label: "Khách quen" },
  NEW: { glyph: "🆕", label: "Khách mới" },
}

/**
 * Formats the guest name shown inside a checked-in table or Bar seat cell (J1 Section 2 & 5).
 * - Walk-ins without a real customer name show a short suitable label ("Khách lẻ" / "Lẻ"), never a fake name.
 * - Long names are truncated with an ellipsis so they never overflow the cell.
 */
export function formatCellGuestName(
  displayName?: string | null,
  maxChars = 9,
  isBarSeat = false,
): string {
  const raw = (displayName ?? "").trim()
  if (!raw || /^(khách walk-in|walk-in|khách vãng lai|khách lẻ|khách)$/i.test(raw)) {
    return isBarSeat ? "Lẻ" : "Khách lẻ"
  }
  if (isBarSeat) {
    const parts = raw.split(/\s+/).filter(Boolean)
    const shortWord = parts[parts.length - 1] ?? raw
    if (shortWord.length > maxChars) {
      return `${shortWord.slice(0, Math.max(2, maxChars - 1))}…`
    }
    return shortWord
  }
  if (raw.length > maxChars) {
    return `${raw.slice(0, Math.max(3, maxChars - 1)).trimEnd()}…`
  }
  return raw
}

export interface CellCornerIcons {
  topRight: Array<"cake">
  bottomLeft: Array<"fire" | "new">
  bottomRight: Array<"star" | "pin">
}

/**
 * Resolves the corner icons for a table cell per J1 Section 3:
 * - Top right: cake if birthday.
 * - Bottom left: new or regular guest icon. Never both (RETURNING > NEW). UNCLASSIFIED shows none.
 * - Bottom right: Bàn sếp (star) or Chỉ định (pin) when data exists. Hidden when absent.
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
  if (hasBirthday) {
    result.topRight.push("cake")
  }

  const hasReturning = tokens.some(
    (k) => k === "returning" || k === "fire" || k === "regular" || k === "khách quen" || k === "khach quen",
  )
  const hasNew = tokens.some((k) => k === "new" || k === "khách mới" || k === "khach moi")
  if (hasReturning) {
    result.bottomLeft.push("fire")
  } else if (hasNew) {
    result.bottomLeft.push("new")
  }

  const hasStar = tokens.some(
    (k) => k === "star" || k === "vip" || k === "boss" || k === "bàn sếp" || k === "ban sep",
  )
  const hasPin = tokens.some(
    (k) => k === "pin" || k === "designated" || k === "chỉ định" || k === "chi dinh",
  )
  if (hasStar) result.bottomRight.push("star")
  if (hasPin) result.bottomRight.push("pin")

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

export function groupCode(symbolNo: number | null | undefined): string | null {
  if (!symbolNo || symbolNo < 1) return null
  return `G${String(symbolNo).padStart(2, "0")}`
}

export function formatGroupCode(groupRef: number | string | null | undefined): string | null {
  if (groupRef === null || groupRef === undefined || groupRef === "" || groupRef === 0) return null
  if (typeof groupRef === "number") {
    if (groupRef < 1) return null
    return `G${String(groupRef).padStart(2, "0")}`
  }
  const str = String(groupRef).trim()
  if (!str) return null
  if (/^G\d+$/i.test(str)) {
    const numPart = parseInt(str.slice(1), 10)
    return `G${String(numPart).padStart(2, "0")}`
  }
  const matchLetter = str.match(/^[◆#]?([A-Za-z]+)$/)
  if (matchLetter) {
    const letters = matchLetter[1].toUpperCase()
    let n = 0
    for (let i = 0; i < letters.length; i++) {
      n = n * 26 + (letters.charCodeAt(i) - 64)
    }
    return `G${String(n).padStart(2, "0")}`
  }
  const matchNum = str.match(/\d+/)
  if (matchNum) {
    const n = parseInt(matchNum[0], 10)
    if (n > 0) return `G${String(n).padStart(2, "0")}`
  }
  return str
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
    a.kind === "BAR_SEAT" ? (a.seqNo ?? 0) - (b.seqNo ?? 0) : a.code.localeCompare(b.code, undefined, { numeric: true }),
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

    // Floor frame rect the canvas draws: x=20, y=20, w=FLOOR_W-40, h=FLOOR_H-20
    let minX = 20
    let minY = 20
    let maxX = 20 + FLOOR_W - 40
    let maxY = 20 + FLOOR_H - 20

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

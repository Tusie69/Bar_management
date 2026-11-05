import type { FloorGroup, FloorTableState, TableLiveState, TableView } from "@/domain/models"
import type { ZoneCode } from "@/domain/venue-layout"

export type GlyphLevel = "compact" | "standard" | "expanded"
export type ClaimViewFlags = Array<"BIRTHDAY" | "NEW" | "RETURNING" | "VIP" | "DESIGNATED">

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

export function pickPrimaryGuestFlag(flags: string[]): GuestFlag | null {
  for (const priority of GUEST_ICON_PRIORITY) {
    if (flags.includes(priority)) return priority
  }
  return null
}

export function formatOccupiedLabel(partySize: number): string {
  return `${partySize} khách`
}

export type LegendStatusKey = "free" | "reserved" | "upcoming" | "late" | "noshow" | "seated" | "spare"

export function calculateStatusCounts(
  tables: (TableView & { state?: TableLiveState; liveState?: TableLiveState; claim?: any })[],
  states?: Map<number, FloorTableState>,
): Record<LegendStatusKey, number> {
  const counts: Record<LegendStatusKey, number> = {
    free: 0,
    reserved: 0,
    upcoming: 0,
    late: 0,
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
    if (rawState === "late" || rawState === "late_confirmed" || rawState === "hold_overdue") {
      key = "late"
    } else if (rawState === "reserved" || rawState === "hold") {
      key = "reserved"
    } else if (rawState === "upcoming") {
      key = "upcoming"
    } else if (rawState === "noshow") {
      key = "noshow"
    } else if (rawState === "seated") {
      key = "seated"
    } else if (rawState === "spare" || (t.isSpare && rawState === "free")) {
      key = "spare"
    } else {
      key = "free"
    }

    const groupId =
      claim?.groupId ??
      (claim?.groupDisplayCode || claim?.symbolNo
        ? claim.groupDisplayCode ?? String(claim.symbolNo)
        : null)

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

export function glyphLevel(table: Pick<TableView, "kind" | "w" | "h">): GlyphLevel {
  if (table.kind === "BAR_SEAT" || Math.min(table.w, table.h) < 25) return "compact"
  return table.w >= 62 && table.h >= 34 ? "expanded" : "standard"
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

export function activeGroupForSelection(groups: FloorGroup[], selectedIds: number[], live: boolean) {
  if (!live || selectedIds.length !== 1) return null
  return groups.find((group) => group.tableIds.includes(selectedIds[0])) ?? null
}

export function tableCanActivate(tableId: number, pickable: Set<number> | null | undefined, selected: Set<number>) {
  return !pickable || pickable.has(tableId) || selected.has(tableId)
}

export function connectorIsSafe(group: TableView[], all: TableView[]) {
  if (group.length < 2) return false
  const memberIds = new Set(group.map((table) => table.id))
  for (let index = 1; index < group.length; index += 1) {
    const a = group[index - 1]
    const b = group[index]
    if (Math.hypot(a.x - b.x, a.y - b.y) > 145) return false
    for (const other of all) {
      if (memberIds.has(other.id)) continue
      const dx = b.x - a.x
      const dy = b.y - a.y
      const lengthSquared = dx * dx + dy * dy
      const along = lengthSquared
        ? Math.max(0, Math.min(1, ((other.x - a.x) * dx + (other.y - a.y) * dy) / lengthSquared))
        : 0
      const distance = Math.hypot(other.x - (a.x + along * dx), other.y - (a.y + along * dy))
      if (distance < Math.max(12, Math.min(other.w, other.h) / 2 + 4)) return false
    }
  }
  return true
}

export interface Bounds {
  x: number
  y: number
  w: number
  h: number
}

export function computeZoneBounds(
  tables: TableView[],
  zone: ZoneCode | "ALL",
  padding = 24,
): Bounds | null {
  if (zone === "ALL") {
    if (!tables.length) {
      return { x: 20, y: 20, w: 549, h: 714 }
    }
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const t of tables) {
      const hw = (t.w || 22) / 2
      const hh = (t.h || 22) / 2
      minX = Math.min(minX, t.x - hw)
      maxX = Math.max(maxX, t.x + hw)
      minY = Math.min(minY, t.y - hh)
      maxY = Math.max(maxY, t.y + hh)
    }
    return {
      x: minX - padding,
      y: minY - padding,
      w: maxX - minX + padding * 2,
      h: maxY - minY + padding * 2,
    }
  }

  const inZone = tables.filter((t) => t.zoneCode === zone)
  if (!inZone.length) {
    return null
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const t of inZone) {
    const hw = (t.w || 22) / 2
    const hh = (t.h || 22) / 2
    minX = Math.min(minX, t.x - hw)
    maxX = Math.max(maxX, t.x + hw)
    minY = Math.min(minY, t.y - hh)
    maxY = Math.max(maxY, t.y + hh)
  }

  return {
    x: minX - padding,
    y: minY - padding,
    w: maxX - minX + padding * 2,
    h: maxY - minY + padding * 2,
  }
}

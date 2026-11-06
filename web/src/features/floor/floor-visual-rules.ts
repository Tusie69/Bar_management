import type { FloorGroup, FloorTableState, TableLiveState, TableView } from "@/domain/models"
import { FIXTURES, FLOOR_H, FLOOR_W, type ZoneCode } from "@/domain/venue-layout"

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

export type LegendStatusKey = "free" | "reserved" | "upcoming" | "noshow" | "seated" | "spare"

export function calculateStatusCounts(
  tables: (TableView & { state?: TableLiveState; liveState?: TableLiveState; claim?: any })[],
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
    if (
      rawState === "late" ||
      rawState === "late_confirmed" ||
      rawState === "noshow" ||
      rawState === "hold_overdue"
    ) {
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
  padding?: number,
): Bounds | null {
  if (zone === "ALL") {
    const pad = padding !== undefined ? padding : 0

    // Floor frame rect: x=20, y=20, w=FLOOR_W-40 (549), h=FLOOR_H-20 (734)
    let minX = 20
    let minY = 20
    let maxX = 20 + FLOOR_W - 40 // 569
    let maxY = 20 + FLOOR_H - 20 // 754

    // Union with outer wall, entrance doors + label, and all fixtures
    for (const f of FIXTURES) {
      if (f.kind === "wall") {
        minX = Math.min(minX, 32 - 1.2)
        maxX = Math.max(maxX, 560 + 1.2)
        minY = Math.min(minY, 32 - 1.2)
        maxY = Math.max(maxY, 738 + 1.2)
      } else if (f.kind === "entrance") {
        minX = Math.min(minX, 268 - 0.45)
        maxX = Math.max(maxX, 328 + 0.45)
        minY = Math.min(minY, 708 - 0.45)
        maxY = Math.max(maxY, 738 + 0.45)
        if (f.labelAt) {
          minX = Math.min(minX, f.labelAt.x - 20)
          maxX = Math.max(maxX, f.labelAt.x + 20)
          minY = Math.min(minY, f.labelAt.y - 8)
          maxY = Math.max(maxY, f.labelAt.y + 3)
        }
      } else if (f.kind === "bar-counter") {
        minX = Math.min(minX, 396 - 0.6)
        maxX = Math.max(maxX, 552 + 0.6)
        minY = Math.min(minY, 404 - 0.6)
        maxY = Math.max(maxY, 722 + 0.6)
      } else if (f.kind === "back-bar") {
        minX = Math.min(minX, 540 - 0.4)
        maxX = Math.max(maxX, 552 + 0.4)
        minY = Math.min(minY, 444 - 0.4)
        maxY = Math.max(maxY, 716 + 0.4)
        if (f.labelAt) {
          minX = Math.min(minX, f.labelAt.x - 35)
          maxX = Math.max(maxX, f.labelAt.x + 35)
          minY = Math.min(minY, f.labelAt.y - 6)
          maxY = Math.max(maxY, f.labelAt.y + 6)
        }
      } else if (f.kind === "sofa") {
        minX = Math.min(minX, 44)
        maxX = Math.max(maxX, 54)
        minY = Math.min(minY, 362)
        maxY = Math.max(maxY, 716)
      }
    }

    // Union with all tables and seats
    for (const t of tables) {
      const hw = (t.w || 22) / 2
      const hh = (t.h || 22) / 2
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
    const hw = (t.w || 22) / 2
    const hh = (t.h || 22) / 2
    minX = Math.min(minX, t.x - hw)
    maxX = Math.max(maxX, t.x + hw)
    minY = Math.min(minY, t.y - hh)
    maxY = Math.max(maxY, t.y + hh)
  }

  // Include zone fixtures and labels
  if (zone === "BAR") {
    // Bar counter: QUẦY BAR
    minX = Math.min(minX, 396 - 0.6)
    maxX = Math.max(maxX, 552 + 0.6)
    minY = Math.min(minY, 404 - 0.6)
    maxY = Math.max(maxY, 722 + 0.6)
    // Back bar: KHU PHA CHẾ
    minX = Math.min(minX, 453)
    maxX = Math.max(maxX, 552.4)
    minY = Math.min(minY, 443.6)
    maxY = Math.max(maxY, 716.4)
  } else if (zone === "A") {
    // Khu A label
    minX = Math.min(minX, 62)
    maxX = Math.max(maxX, 62 + 35)
    minY = Math.min(minY, 726 - 8)
    maxY = Math.max(maxY, 726 + 2)
    // Sofa along Khu A
    minX = Math.min(minX, 44)
    maxX = Math.max(maxX, 54)
    minY = Math.min(minY, 362)
    maxY = Math.max(maxY, 716)
  } else if (zone === "B") {
    // Khu B label
    minX = Math.min(minX, 62)
    maxX = Math.max(maxX, 62 + 35)
    minY = Math.min(minY, 194 - 8)
    maxY = Math.max(maxY, 194 + 2)
  } else if (zone === "C") {
    // Khu C label
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

/** Fit the visible frame and any catalogue tables extending beyond it. */
export function wholeFloorBounds(tables: readonly TableView[], floorWidth: number, floorHeight: number) {
  let left = 20
  let top = 20
  let right = floorWidth - 20
  let bottom = floorHeight
  for (const table of tables) {
    left = Math.min(left, table.x - table.w / 2)
    right = Math.max(right, table.x + table.w / 2)
    top = Math.min(top, table.y - table.h / 2)
    bottom = Math.max(bottom, table.y + table.h / 2)
  }
  return { x: left, y: top, w: right - left, h: bottom - top }
}

export function countFloorStates(tables: readonly TableView[], states: ReadonlyMap<number, FloorTableState>) {
  const counts = new Map<TableLiveState, number>()
  for (const table of tables) {
    const state = states.get(table.id)?.state ?? (table.isSpare ? "spare" : "free")
    counts.set(state, (counts.get(state) ?? 0) + 1)
  }
  return counts
}

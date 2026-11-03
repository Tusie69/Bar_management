import type { FloorGroup, TableView } from "@/domain/models"

export type GlyphLevel = "compact" | "standard" | "expanded"
export type ClaimViewFlags = Array<"NEW" | "RETURNING">

export function glyphLevel(table: Pick<TableView, "kind" | "w" | "h">): GlyphLevel {
  if (table.kind === "BAR_SEAT" || Math.min(table.w, table.h) < 25) return "compact"
  return table.w >= 62 && table.h >= 34 ? "expanded" : "standard"
}

export function groupCode(symbolNo: number | null | undefined) {
  if (!symbolNo || symbolNo < 1) return null
  let n = symbolNo
  let letters = ""
  while (n > 0) {
    n -= 1
    letters = String.fromCharCode(65 + (n % 26)) + letters
    n = Math.floor(n / 26)
  }
  return `◆${letters}`
}

export function supportedFlags(flags: ClaimViewFlags): ClaimViewFlags {
  return flags.filter((flag, index) => (flag === "RETURNING" || flag === "NEW") && flags.indexOf(flag) === index)
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

import type { FloorTableState, TableView } from "@/domain/models"

const occupiedReason: Partial<Record<FloorTableState["state"], string>> = {
  reserved: "đã được đặt trước",
  upcoming: "đang giữ cho khách sắp đến",
  late: "đang giữ cho khách đến muộn",
  noshow: "đang chờ xử lý khách không tới",
  seated: "đang có khách",
  hold: "đang được giữ",
  hold_overdue: "đang giữ quá hạn và cần xử lý",
  oos: "đang ngưng phục vụ",
  spare: "là bàn sơ cua",
}

export function walkInBlockReason(
  table: TableView,
  state: FloorTableState | undefined,
  bookableZoneIds: ReadonlySet<number>,
  anchor?: TableView,
): string | null {
  const label = table.kind === "BAR_SEAT" ? `Ghế Bar ${table.seqNo}` : `Bàn ${table.code}`
  if (!bookableZoneIds.has(table.zoneId)) return `${label} không thuộc khu vực nhận khách.`
  if (table.status !== "ACTIVE" || state?.state === "oos") return `${label} đang ngưng phục vụ.`
  if (table.isSpare || state?.state === "spare") return `${label} là bàn sơ cua và không được chọn cho Walk-in.`
  if (!state) return `Chưa tải được trạng thái của ${label}.`
  if (state.state !== "free") return `${label} ${occupiedReason[state.state] ?? "không còn khả dụng"}.`
  if (anchor && table.zoneId !== anchor.zoneId) return "Chỉ có thể chọn thêm bàn trong cùng một khu vực."
  if (anchor && table.kind !== anchor.kind) return "Không thể ghép bàn thường với ghế Bar."
  return null
}

export function walkInPickableIds(
  tables: TableView[],
  states: ReadonlyMap<number, FloorTableState>,
  bookableZoneIds: ReadonlySet<number>,
  selectedIds: number[],
): Set<number> {
  const byId = new Map(tables.map((table) => [table.id, table]))
  const anchor = selectedIds.length ? byId.get(selectedIds[0]) : undefined
  return new Set(
    tables
      .filter((table) => walkInBlockReason(table, states.get(table.id), bookableZoneIds, anchor) === null)
      .map((table) => table.id),
  )
}

export function walkInSelectionIssues(
  selectedIds: number[],
  byId: ReadonlyMap<number, TableView>,
  states: ReadonlyMap<number, FloorTableState>,
  bookableZoneIds: ReadonlySet<number>,
): string[] {
  const anchor = selectedIds.length ? byId.get(selectedIds[0]) : undefined
  return selectedIds.flatMap((id) => {
    const table = byId.get(id)
    if (!table) return [`Bàn #${id} không còn trong sơ đồ.`]
    const reason = walkInBlockReason(table, states.get(id), bookableZoneIds, anchor)
    return reason ? [reason] : []
  })
}

export function selectedCapacity(selectedIds: number[], byId: ReadonlyMap<number, TableView>): number {
  return selectedIds.reduce((total, id) => total + (byId.get(id)?.capacity ?? 0), 0)
}
